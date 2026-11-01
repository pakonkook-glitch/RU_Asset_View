(function(){
'use strict';

/*
 * RU Asset View -> Supabase bridge.
 * The browser only carries the public/anon key.  Every asset/storage request
 * is authenticated, and every mutation is followed by an authoritative GET.
 */
const CFGKEY='ru_supabase_config_cmmcyyonkpihqlfhtnzw';
const SESSKEY='ru_supabase_session_cmmcyyonkpihqlfhtnzw';
const LEGACY_CACHE='ru_supabase_verified_cache_v1';
const DEFAULT={url:'https://cmmcyyonkpihqlfhtnzw.supabase.co',anonKey:'sb_publishable_hqs6euCgystuRs5ns2WFEQ_pfAgJmCh'};
const PAGE_SIZE=1000;
const PUBLIC_COLUMNS='key,asset_name,asset_no,asset_no_alt,barcode,serial_no,category,location,condition,status,acquired_date_be,fiscal_year,quantity,serial_range,specs,ru_photo_thumb,ru_photo_removed';
const isPublicListing=()=>/(?:\/|\/index\.html)$/i.test(window.location.pathname);
const PHOTO_PATH_RE=/^r\d+\/[a-f0-9-]+\.jpg$/;
const ASSET_COLUMNS=['key','asset_name','asset_no','asset_no_alt','barcode','serial_no','category','location','condition','status','acquired_date_be','fiscal_year','assignee','quantity','serial_range','specs','ru_photo_id','ru_photo_thumb','ru_photo_url','ru_photo_removed','revision','updated_at','deleted_at'];
const MUTABLE_COLUMNS=new Set(['asset_name','asset_no','asset_no_alt','barcode','serial_no','category','location','condition','status','acquired_date_be','fiscal_year','assignee','quantity','serial_range','specs','ru_photo_id','ru_photo_thumb','ru_photo_url','ru_photo_removed','deleted_at']);
const EXPECTED_COLUMNS=new Set([...MUTABLE_COLUMNS]);

let cfg={...DEFAULT};
let session=null;
let assets=[];
let busy=false;
let refreshPromise=null;
let authRefreshPromise=null;
const photoConfirmations=new Map();
let lastPhotoWarningCount=0;

function store(){
  try{return window.localStorage||null}catch(_){return null}
}
function readStore(name,fallback){
  try{const s=store(),v=s&&s.getItem(name);return v==null?fallback:JSON.parse(v)}catch(_){return fallback}
}
function writeStore(name,value){try{const s=store();if(s)s.setItem(name,JSON.stringify(value))}catch(_){}
}
function removeStore(name){try{const s=store();if(s)s.removeItem(name)}catch(_){}
}
try{cfg={...DEFAULT,...(readStore(CFGKEY,{})||{})};session=readStore(SESSKEY,null)}catch(_){}
/* Old metadata was only a count/timestamp and must never be used as online state. */
removeStore(LEGACY_CACHE);

const hook=window.RUAssetPage;
const bar=document.createElement('section');
bar.id='ru-supabase-bar';
bar.style.cssText='max-width:1100px;margin:12px auto;padding:12px;border:2px solid #9d86d6;border-radius:12px;background:#f8f4ff;color:#31264b;font:14px system-ui';
bar.innerHTML='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="flex:1">RU Asset View · Supabase</b><span id="ru-sb-status">ยังไม่ได้เชื่อมต่อ</span><button id="ru-sb-connect">ตั้งค่าการเชื่อมต่อ</button><button id="ru-sb-refresh">อ่านข้อมูล</button><button id="ru-sb-create">สร้างทรัพย์สิน</button><button id="ru-sb-delete">ลบแบบ soft delete</button><button id="ru-sb-photo">จัดการรูปภาพ</button><a href="edit.html">ไปหน้าแก้ไข</a></div><div id="ru-sb-panel" style="display:none;margin-top:12px"><label>Supabase project URL <input id="ru-sb-url" style="width:85%" placeholder="https://your-project.supabase.co"></label><br><label>Publishable / anon key <input id="ru-sb-key" style="width:85%" type="password"></label><br><label>อีเมล <input id="ru-sb-email" type="email"></label><label>รหัสผ่าน <input id="ru-sb-pass" type="password"></label><button id="ru-sb-login">เข้าสู่ระบบ</button><button id="ru-sb-logout">ออกจากระบบ</button><p>ใช้ publishable/anon key เท่านั้น ห้ามใส่ service_role หรือ secret key</p></div>';
const anchor=document.querySelector('.wrap')||document.querySelector('main')||document.body.firstElementChild;
if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(bar,anchor);else document.body.prepend(bar);
const el=id=>bar.querySelector('#'+id);
const status=(msg,bad=false)=>{const s=el('ru-sb-status');if(!s)return;s.textContent=String(msg||'');s.style.color=bad?'#a21d32':'#27633a'};
for(const id of ['ru-sb-connect','ru-sb-refresh','ru-sb-create','ru-sb-delete','ru-sb-photo','ru-sb-login','ru-sb-logout']){
  const b=el(id);if(b)b.style.cssText='padding:7px;border-radius:7px;border:1px solid #9885c9;background:#f0eaff;cursor:pointer';
}

function supabaseUrl(){
  const u=String(cfg.url||'').replace(/\/+$/,'');
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(u))throw new Error('Supabase URL ไม่ถูกต้อง');
  return u;
}
function publicKey(){
  const k=String(cfg.anonKey||'').trim();
  if(!k||/service_role|sb_secret_/i.test(k))throw new Error('ต้องใช้ publishable/anon key เท่านั้น ห้ามใช้ secret key');
  return k;
}
function sessionWithExpiry(next,previous){
  const s={...(previous||{}),...(next||{})};
  if(!s.expires_at&&s.expires_in) s.expires_at=Math.floor(Date.now()/1000)+Number(s.expires_in);
  if(s.expires_at!=null){const n=Number(s.expires_at);if(Number.isFinite(n))s.expires_at=n}
  return s;
}
function saveSession(next){
  session=next?sessionWithExpiry(next,session):null;
  if(session)writeStore(SESSKEY,session);else removeStore(SESSKEY);
}
function sameValue(a,b){return String(a==null?'':a)===String(b==null?'':b)}
function sameColumnValue(name,a,b){return sameValue(a,b)||(name==='deleted_at'&&a!=null&&b!=null&&Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b))}
function authError(){return new Error('ต้องเข้าสู่ระบบ Supabase ก่อนอ่านหรือแก้ไขข้อมูลส่วนกลาง')}

function clearPrivateView(){
  assets=[];
  photoConfirmations.clear();
  lastPhotoWarningCount=0;
  if(recordDialog){recordDialog.close();recordDialog.querySelector('form')?.reset();formElement('ru-record-choice').replaceChildren();recordBase=null;photoDraft=null;formElement('ru-record-photo-preview').removeAttribute('src')}
  removeStore(LEGACY_CACHE);
  try{hook?.clearPrivate?.()}catch(_){}
  try{hook?.apply?.([])}catch(_){}
}
function invalidateSession(){
  saveSession(null);
  clearPrivateView();
}

async function decodeResponse(response){
  if(response.status===204)return null;
  const type=String(response.headers?.get?.('content-type')||'').toLowerCase();
  if(type.includes('application/json'))return response.json();
  if(response.blob)return response.blob();
  if(response.text)return response.text();
  return null;
}
async function errorMessage(response){
  let msg='HTTP '+response.status;
  try{
    const type=String(response.headers?.get?.('content-type')||'').toLowerCase();
    if(type.includes('json')){const e=await response.json();msg=e.message||e.error_description||e.error||e.hint||msg}
    else if(response.text){const t=await response.text();if(t)msg=t.slice(0,240)}
  }catch(_){}
  return msg;
}

async function refreshSession(){
  if(authRefreshPromise)return authRefreshPromise;
  const previous=session;
  if(!previous?.refresh_token){invalidateSession();throw authError()}
  authRefreshPromise=(async()=>{
    try{
      const r=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:previous.refresh_token}),authenticated:false,retry401:false});
      if(!r||!r.access_token)throw new Error('Supabase refresh token ใช้งานไม่ได้');
      saveSession(sessionWithExpiry(r,previous));
      return session;
    }catch(e){invalidateSession();throw new Error('เซสชันหมดอายุและต่ออายุไม่ได้: '+(e.message||e))}
    finally{authRefreshPromise=null}
  })();
  return authRefreshPromise;
}
async function ensureAuth(){
  if(!session?.access_token)throw authError();
  const exp=Number(session.expires_at||0);
  if(exp&&Date.now()/1000>=exp-60)await refreshSession();
  if(!session?.access_token)throw authError();
}

async function request(route,options={}){
  const authenticated=options.authenticated!==false;
  const retry401=options.retry401!==false;
  if(authenticated)await ensureAuth();
  const send=async()=>{
    const headers={apikey:publicKey(),...(options.headers||{})};
    if(authenticated){if(!session?.access_token)throw authError();headers.Authorization='Bearer '+session.access_token}
    return fetch(supabaseUrl()+route,{method:options.method||'GET',headers,body:options.body,cache:'no-store'});
  };
  let response=await send();
  if(response.status===401&&authenticated&&retry401&&session?.refresh_token){
    await refreshSession();
    response=await send();
  }
  if(!response.ok){
    const msg=await errorMessage(response);
    if(response.status===401&&authenticated)invalidateSession();
    throw new Error(msg);
  }
  const data=await decodeResponse(response);
  return options.withMeta?{data,response}:data;
}
async function raw(route,options={}){return request(route,options)}
async function table(path,options={}){
  return raw('/rest/v1/ru_assets'+path,{...options,headers:{'Content-Type':'application/json',Prefer:'return=representation',...(options.headers||{})}});
}

function validAssetRows(list){
  if(!Array.isArray(list))throw new Error('Supabase ru_assets response ไม่ใช่รายการข้อมูล');
  const seen=new Set();
  for(const a of list){
    if(!a||typeof a!=='object'||!/^r\d+$/.test(String(a.key||''))||seen.has(a.key))throw new Error('ru_assets มี key ไม่ถูกต้องหรือซ้ำ: '+(a&&a.key));
    seen.add(a.key);
  }
  return list;
}
function rangeTotal(response){
  const h=response?.headers?.get?.('content-range')||'';
  const m=/\/((?:\d+)|\*)$/.exec(h);
  return m&&m[1]!=='*'?Number(m[1]):null;
}
async function listAssetRows({includeDeleted=false,signPhotos=false}={}){
  let offset=0,total=null;
  const all=[];
  while(true){
    const deleted=includeDeleted?'':'&deleted_at=is.null';
    const q='?select=*&order=key.asc&limit='+PAGE_SIZE+'&offset='+offset+deleted;
    const packet=await table(q,{headers:{Prefer:'return=representation,count=exact'},withMeta:true});
    const rows=validAssetRows(packet.data||[]);
    total=rangeTotal(packet.response)??total;
    all.push(...rows);
    if((total!=null&&all.length>=total)||rows.length===0)break;
    offset+=rows.length;
  }
  if(signPhotos){
    lastPhotoWarningCount=await signPrivatePhotos(all);
  }
  return all;
}
/* The public index reads only explicitly granted inventory columns.
   Admin/edit/assign pages continue using authenticated Supabase reads. */
async function listPublicAssetRows(){
  let offset=0,total=null;
  const all=[];
  while(true){
    const path='?select='+PUBLIC_COLUMNS+'&deleted_at=is.null&order=key.asc&limit='+PAGE_SIZE+'&offset='+offset;
    const packet=await raw('/rest/v1/ru_assets'+path,{authenticated:false,headers:{Prefer:'count=exact'},withMeta:true});
    const rows=validAssetRows(packet.data||[]);
    total=rangeTotal(packet.response)??total;
    all.push(...rows);
    if((total!==null&&all.length>=total)||rows.length===0)break;
    offset+=rows.length;
  }
  return all;
}
function readbackColumns(row){
  if(!row||typeof row!=='object')throw new Error('GET readback ไม่พบแถวข้อมูล');
  for(const c of ASSET_COLUMNS){if(!Object.prototype.hasOwnProperty.call(row,c))throw new Error('GET readback ไม่มี field '+c)}
  if(!Number.isInteger(Number(row.revision)))throw new Error('GET readback revision ไม่ถูกต้อง');
  return row;
}
async function getAssetRow(key){
  const rows=validAssetRows(await table('?key=eq.'+encodeURIComponent(String(key))+'&select=*&limit=1'));
  return rows.length===1?readbackColumns(rows[0]):null;
}

function signedPhotoUrl(value,path){
  const base=supabaseUrl();
  const prefix='/storage/v1/object/sign/ru-asset-photos/';
  let candidate=String(value||'');
  if(candidate.startsWith('/'))candidate=base+candidate;
  if(!candidate.startsWith(base+prefix))throw new Error('Storage sign response อยู่นอกขอบเขต bucket');
  let parsed;
  try{parsed=new URL(candidate)}catch(_){throw new Error('Storage sign response ไม่ใช่ URL ที่ถูกต้อง')}
  if(parsed.origin!==new URL(base).origin||!parsed.pathname.startsWith(prefix))throw new Error('Storage sign response origin/path ไม่ปลอดภัย');
  const tail=decodeURIComponent(parsed.pathname.slice(prefix.length));
  if(tail!==path)throw new Error('Storage sign response ไม่ตรงกับ photo metadata');
  return candidate;
}
async function signOnePhoto(row){
  const path=String(row.ru_photo_id||'');
  if(!PHOTO_PATH_RE.test(path))return false;
  const route='/storage/v1/object/sign/ru-asset-photos/'+path.split('/').map(encodeURIComponent).join('/');
  const signed=await raw(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:900})});
  const out=signedPhotoUrl(signed&&signed.signedURL,path);
  row.ru_photo_url=out;
  return true;
}
async function signPrivatePhotos(rows){
  let skipped=0;
  const candidates=rows.filter(a=>a.ru_photo_removed!=='1'&&a.ru_photo_id);
  for(let i=0;i<candidates.length;i+=4){
    await Promise.all(candidates.slice(i,i+4).map(async a=>{
      if(!PHOTO_PATH_RE.test(String(a.ru_photo_id||''))){a.ru_photo_url='';skipped++;return}
      await signOnePhoto(a);
    }));
  }
  rows.forEach(a=>{if(a.ru_photo_removed==='1')a.ru_photo_url=''});
  return skipped;
}

function normaliseExpected(expected){
  if(expected==null)return {fields:{}};
  if(typeof expected==='number'||typeof expected==='string')return {revision:Number(expected),fields:{}};
  const e={revision:expected.revision==null?undefined:Number(expected.revision),fields:{...(expected.fields||{})}};
  if(expected.assignee!==undefined)e.fields.assignee=expected.assignee;
  if(expected.expectedFields)Object.assign(e.fields,expected.expectedFields);
  return e;
}
function validateExpected(fields){
  for(const name of Object.keys(fields||{}))if(!EXPECTED_COLUMNS.has(name))throw new Error('expected field ไม่ได้รับอนุญาต: '+name);
}
function assertExpected(current,expected,key){
  const e=normaliseExpected(expected);
  validateExpected(e.fields);
  if(e.revision!==undefined&&Number(current.revision)!==e.revision)throw new Error('Optimistic concurrency conflict '+key+': revision เปลี่ยนจาก '+e.revision+' เป็น '+current.revision);
  for(const [name,value] of Object.entries(e.fields))if(!sameValue(current[name],value))throw new Error('Optimistic concurrency conflict '+key+': '+name+' ไม่ตรงกับค่าที่คาดไว้');
  return e;
}
function queryEq(name,value){
  if(value===null)return '&'+name+'=is.null';
  return '&'+name+'=eq.'+encodeURIComponent(String(value==null?'':value));
}
function writeFields(changes){
  if(!changes||typeof changes!=='object'||Array.isArray(changes))throw new Error('changes ต้องเป็น object');
  const out={};
  for(const [name,value] of Object.entries(changes)){
    if(!MUTABLE_COLUMNS.has(name))throw new Error('field ไม่ได้รับอนุญาตให้แก้ไข: '+name);
    out[name]=value===undefined?'':(name==='deleted_at'&&value===null?null:(value==null?'':value));
  }
  if(!Object.keys(out).length)throw new Error('ไม่มี field สำหรับเขียน');
  return out;
}
function assertChanged(row,changes,expected,key){
  for(const [name,value] of Object.entries(changes))if(!sameColumnValue(name,row[name],value))throw new Error('GET readback ไม่ตรงกับค่าที่เขียน '+key+'.'+name);
  const e=normaliseExpected(expected);
  if(e.revision!==undefined&&Number(row.revision)<=e.revision)throw new Error('GET readback revision ไม่เพิ่มหลังเขียน '+key);
  return row;
}
async function updateAsset(key,changes,expected){
  const k=String(key||'');if(!/^r\d+$/.test(k))throw new Error('key ไม่ถูกต้อง');
  const fields=writeFields(changes);
  const current=await getAssetRow(k);if(!current)throw new Error('ไม่พบ asset '+k);
  const e=normaliseExpected(expected);
  if(e.revision===undefined)e.revision=Number(current.revision);
  assertExpected(current,e,k);
  let filter='?key=eq.'+encodeURIComponent(k)+'&revision=eq.'+encodeURIComponent(String(e.revision))+'&select=*';
  for(const [name,value] of Object.entries(e.fields))filter+=queryEq(name,value);
  const written=await table(filter,{method:'PATCH',body:JSON.stringify(fields)});
  if(!Array.isArray(written)||written.length!==1||written[0].key!==k)throw new Error('ฐานกลางไม่ยืนยันการเขียนรายการเดียว กรุณาอ่านข้อมูลใหม่ก่อนบันทึก');
  const saved=await getAssetRow(k);
  if(!saved)throw new Error('GET readback ไม่พบ asset หลังเขียน '+k);
  if(Number(saved.revision)!==Number(written[0].revision))throw new Error('รายการเปลี่ยนอีกครั้งหลังเขียน กรุณาอ่านข้อมูลใหม่');
  assertChanged(saved,fields,e,k);
  return saved;
}

async function editBatch(changes,mode){
  const results=[];
  if(!Array.isArray(changes))return {ok:false,results:[],error:'changes ต้องเป็น array'};
  for(const c of changes){
    try{
      if(!c||!/^r\d+$/.test(String(c.key||'')))throw new Error('key ไม่ถูกต้อง');
      const current=await getAssetRow(c.key);if(!current)throw new Error('ไม่พบ asset '+c.key);
      const fields={};const expected={revision:c.expectedRevision==null?current.revision:Number(c.expectedRevision),fields:{...(c.expectedFields||{})}};
      if(mode==='fields'){
        for(const [name,spec] of Object.entries(c.fields||{})){
          if(!MUTABLE_COLUMNS.has(name)||name==='deleted_at'||name.indexOf('ru_photo_')===0)throw new Error('field ไม่ได้รับอนุญาตใน field batch: '+name);
          if(!spec||typeof spec!=='object')throw new Error('field spec ไม่ถูกต้อง: '+name);
          if(spec.from!==undefined){expected.fields[name]=spec.from;if(!sameValue(current[name],spec.from))throw new Error(name+' ไม่ตรงกับค่าต้นทาง')}
          fields[name]=String(spec.to??'');
        }
      }else{
        if(c.fields&&typeof c.fields==='object'){
          for(const [name,value] of Object.entries(c.fields)){
            if(value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'to')){fields[name]=String(value.to??'');if(value.from!==undefined)expected.fields[name]=value.from}
            else fields[name]=value;
          }
        }
        if(c.asset_no!==undefined){fields.asset_no=c.asset_no;if(c.expectedOld!==undefined)expected.fields.asset_no=c.expectedOld}
        if(c.assignee!==undefined){fields.assignee=c.assignee;expected.fields.assignee=c.expectedAssignee===undefined?current.assignee:c.expectedAssignee}
      }
      const saved=await updateAsset(c.key,fields,expected);
      results.push({key:c.key,ok:true,fields:Object.keys(fields),revision:saved.revision,row:saved});
    }catch(e){results.push({key:c&&c.key,ok:false,error:String(e.message||e)})}
  }
  const ok=results.length>0&&results.every(x=>x.ok);
  return {ok,results,error:ok?'':(results.some(x=>x.ok)?'บางรายการเขียนไม่สำเร็จ':'ไม่มีรายการเขียนสำเร็จ')};
}

async function createRecord(row){
  const fields=writeFields(row);
  const all=await listAssetRows({includeDeleted:true,signPhotos:false});
  const nums=all.map(a=>Number(String(a.key||'').slice(1))).filter(Number.isSafeInteger);
  const key='r'+(Math.max(0,...nums)+1);
  const insert={key,...fields};
  const written=await table('?select=*',{method:'POST',body:JSON.stringify(insert)});
  if(!Array.isArray(written)||written.length!==1||written[0].key!==key)throw new Error('ฐานกลางไม่ยืนยันการสร้างรายการเดียว');
  const saved=await getAssetRow(key);
  if(!saved)throw new Error('GET readback ไม่พบ asset ที่สร้าง '+key);
  for(const [name,value] of Object.entries(fields))if(!sameValue(saved[name],value))throw new Error('GET readback ไม่ตรงกับ asset ที่สร้าง '+key+'.'+name);
  return saved;
}
async function createAsset(){
  const name=prompt('ชื่อทรัพย์สิน');if(name==null||!String(name).trim())return null;
  const number=prompt('หมายเลขทรัพย์สิน','');if(number===null)return null;
  const location=prompt('สถานที่','');if(location===null)return null;
  const saved=await createRecord({asset_name:String(name),asset_no:String(number),location:String(location)});
  const refreshed=await refresh();
  status(refreshed?'สร้าง asset สำเร็จและยืนยันด้วย GET: '+saved.key:'เขียน asset และ GET readback สำเร็จ แต่ refresh รายการล้มเหลว: '+saved.key,!refreshed);
  return saved;
}
async function softDeleteAsset(key,expectedRevision){
  const current=await getAssetRow(key);if(!current)throw new Error('ไม่พบ asset '+key);
  const saved=await updateAsset(key,{deleted_at:new Date().toISOString()},{revision:expectedRevision==null?current.revision:expectedRevision});
  if(!saved.deleted_at)throw new Error('GET readback ไม่ยืนยัน soft delete '+key);
  return saved;
}
async function deleteAsset(){
  const k=prompt('key ของ asset ที่จะ soft delete (เช่น r12)');if(!k)return;
  const a=assets.find(x=>x.key===k);if(!a)throw new Error('ไม่พบ asset '+k+' ในข้อมูลที่อ่านมา');
  if(!confirm('ยืนยัน soft delete '+k+' '+a.asset_name+'? จะไม่ลบแถวหรือไฟล์ Storage'))return null;
  await softDeleteAsset(k,a.revision);
  const refreshed=await refresh();
  status(refreshed?'soft delete สำเร็จและยืนยันด้วย GET: '+k:'soft delete และ GET readback สำเร็จ แต่ refresh รายการล้มเหลว: '+k,!refreshed);
  return true;
}

function base64Bytes(value){
  const text=String(value||'').replace(/^data:image\/jpeg;base64,/i,'').replace(/\s/g,'');
  if(!text||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw new Error('ข้อมูลรูป base64 ไม่ถูกต้อง');
  let binary;try{binary=atob(text)}catch(_){throw new Error('ถอดรหัสรูปไม่สำเร็จ')}
  return Uint8Array.from(binary,c=>c.charCodeAt(0));
}
async function sha256(bytes){
  if(!globalThis.crypto?.subtle)throw new Error('เบราว์เซอร์ไม่มี crypto.subtle สำหรับยืนยันไฟล์');
  return new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
}
function equalBytes(a,b){return a.length===b.length&&a.every((x,i)=>x===b[i])}
function newPhotoPath(key){
  const id=globalThis.crypto?.randomUUID?.()||Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('');
  const path=String(key)+'/'+String(id).toLowerCase()+'.jpg';
  if(!PHOTO_PATH_RE.test(path))throw new Error('ไม่สามารถสร้าง path รูปที่ปลอดภัย');
  return path;
}
async function verifyStoredPhoto(path,bytes){
  const stored=await raw('/storage/v1/object/authenticated/ru-asset-photos/'+path.split('/').map(encodeURIComponent).join('/'));
  if(!stored||typeof stored.arrayBuffer!=='function')throw new Error('Storage GET readback ไม่ใช่ไฟล์');
  const disk=new Uint8Array(await stored.arrayBuffer());
  if(disk.length!==bytes.length||!equalBytes(await sha256(disk),await sha256(bytes)))throw new Error('Storage GET readback hash ไม่ตรงกับไฟล์ที่ส่ง');
}
async function putPhoto(key,b64,thumb){
  const bytes=base64Bytes(b64);
  if(bytes.length<10||bytes.length>3900000||bytes[0]!==255||bytes[1]!==216)throw new Error('รองรับเฉพาะ JPEG ขนาดไม่เกิน 3.9MB');
  const current=await getAssetRow(key);if(!current)throw new Error('ไม่พบ asset '+key);
  const path=newPhotoPath(key);
  await raw('/storage/v1/object/ru-asset-photos/'+path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{'Content-Type':'image/jpeg','x-upsert':'false'},body:bytes});
  await verifyStoredPhoto(path,bytes);
  const saved=await updateAsset(key,{ru_photo_id:path,ru_photo_thumb:String(thumb||''),ru_photo_url:'',ru_photo_removed:''},{revision:current.revision,fields:{}});
  if(saved.ru_photo_id!==path||saved.ru_photo_removed!=='')throw new Error('GET readback ไม่ยืนยัน metadata รูปใหม่');
  photoConfirmations.set(String(key),saved);
  return {ok:true,status:'success',assetId:String(key),act:'set',fileId:path,imageUrl:'',thumbnail:String(thumb||''),revision:saved.revision};
}
async function delPhoto(key){
  const current=await getAssetRow(key);if(!current)throw new Error('ไม่พบ asset '+key);
  /* Keep ru_photo_id and Storage bytes. Only metadata marks the photo removed. */
  const saved=await updateAsset(key,{ru_photo_thumb:'',ru_photo_url:'',ru_photo_removed:'1'},{revision:current.revision});
  if(saved.ru_photo_removed!=='1')throw new Error('GET readback ไม่ยืนยันการซ่อนรูป');
  photoConfirmations.set(String(key),saved);
  return {ok:true,status:'success',assetId:String(key),act:'del',fileId:String(saved.ru_photo_id||''),imageUrl:'',revision:saved.revision,storageDeleted:false};
}
async function uploadFromBar(){
  const k=prompt('key ของ asset (เช่น r1)');if(!k)return;
  if(!assets.some(a=>a.key===k))throw new Error('ไม่พบ asset '+k+' ในข้อมูลที่อ่านมา');
  const i=document.createElement('input');i.type='file';i.accept='image/jpeg';
  i.onchange=async()=>{try{const f=i.files&&i.files[0];if(!f)return;const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let n=0;n<bytes.length;n+=0x8000)binary+=String.fromCharCode(...bytes.subarray(n,n+0x8000));const b64=btoa(binary);const bitmap=await createImageBitmap(f);const scale=Math.min(1,240/Math.max(bitmap.width,bitmap.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);bitmap.close();await putPhoto(k,b64,c.toDataURL('image/jpeg',0.65));const refreshed=await refresh();status(refreshed?'อัปโหลดรูปสำเร็จและยืนยันด้วย GET: '+k:'อัปโหลดและ GET readback สำเร็จ แต่ refresh รายการล้มเหลว: '+k,!refreshed)}catch(e){status('ผิดพลาด: '+(e.message||e),true)}};i.click();
}

async function readAssetsForPage(){
  const rows=!session?.access_token&&isPublicListing()
    ?await listPublicAssetRows()
    :await listAssetRows({includeDeleted:false,signPhotos:true});
  assets=rows;
  try{hook?.apply?.(rows)}catch(e){throw new Error('RUAssetPage.apply ล้มเหลว: '+e.message)}
  return rows;
}
async function refresh(){
  if(refreshPromise)return refreshPromise;
  refreshPromise=(async()=>{
    if(busy)return false;
    busy=true;status('กำลังอ่านข้อมูลจาก Supabase…');
    try{
      const rows=await readAssetsForPage();
      status('อ่านข้อมูลสำเร็จ '+rows.length+' รายการ'+(lastPhotoWarningCount?' (ข้าม photo path ที่ไม่อยู่ในขอบเขต '+lastPhotoWarningCount+' รายการ)':'')+' · '+new Date().toLocaleTimeString('th-TH'),lastPhotoWarningCount>0);
      return true;
    }catch(e){status('อ่านข้อมูลไม่สำเร็จ: '+(e.message||e),true);return false}
    finally{busy=false}
  })();
  try{return await refreshPromise}finally{refreshPromise=null}
}

async function call(body){
  if(!body||typeof body!=='object')throw new Error('Supabase action ไม่ถูกต้อง');
  if(body.action==='getAssets'){
    const rows=await readAssetsForPage();
    return {ok:true,assets:rows};
  }
  if(body.action==='applyAssetFields')return editBatch(body.changes,'fields');
  if(body.action==='applyAssetChanges')return editBatch(body.changes,'changes');
  if(body.action==='updateAsset'){
    const saved=await updateAsset(body.key,body.changes,body.expected||{revision:body.expectedRevision,fields:body.expectedFields});
    return {ok:true,status:'success',asset:saved,revision:saved.revision};
  }
  if(body.action==='softDelete'||body.action==='deleteAsset'){
    const saved=await softDeleteAsset(body.key,body.expectedRevision);
    return {ok:true,status:'success',asset:saved,revision:saved.revision};
  }
  if(body.action==='createAsset'){
    const saved=await createRecord(body.fields||body.asset||{});
    return {ok:true,status:'success',asset:saved,revision:saved.revision};
  }
  if(body.action==='photoPut')return body.act==='del'?delPhoto(body.key):putPhoto(body.key,body.b64,body.th);
  throw new Error('Supabase action ไม่รู้จัก: '+body.action);
}

/* Editable controls for the existing pages; no second data store or application. */
const recordFields=[['asset_name','ชื่อครุภัณฑ์'],['asset_no','เลขครุภัณฑ์'],['asset_no_alt','เลขสำรอง'],['barcode','บาร์โค้ด'],['serial_no','Serial Number'],['category','ประเภท'],['location','สถานที่'],['assignee','ผู้ถือครอง'],['status','สถานะ'],['condition','สภาพ'],['acquired_date_be','วันที่ได้มา (พ.ศ.)'],['fiscal_year','ปีงบประมาณ (พ.ศ.)'],['quantity','จำนวนหน่วย'],['serial_range','S/N ชุด'],['specs','สเปก']];
let recordDialog=null,recordMode='edit',recordBase=null,photoDraft=null,recordWriting=false;
const editButton=document.createElement('button');editButton.id='ru-sb-edit';editButton.textContent='แก้ไข / ย้ายผู้ถือครอง / สถานะ';editButton.style.cssText=el('ru-sb-create').style.cssText;
el('ru-sb-create').insertAdjacentElement('afterend',editButton);
function formElement(id){return recordDialog.querySelector('#'+id)}
function formMessage(text,bad=false){const e=formElement('ru-record-message');e.textContent=text;e.style.color=bad?'#a21d32':'#27633a'}
function buildRecordDialog(){
  if(recordDialog)return;
  recordDialog=document.createElement('dialog');recordDialog.id='ru-record-dialog';recordDialog.style.cssText='width:min(760px,92vw);max-height:90vh;overflow:auto;border:2px solid #9d86d6;border-radius:14px;color:#31264b;padding:20px;font:15px system-ui';
  recordDialog.innerHTML='<form id="ru-record-form"><h2 id="ru-record-title"></h2><label id="ru-record-choice-label">เลือกรายการจากฐานกลาง <select id="ru-record-choice" style="width:100%;padding:8px"></select></label><p id="ru-record-identity"></p><div id="ru-record-fields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px"></div><section id="ru-record-photo"><label>เลือกภาพ <input id="ru-record-photo-file" type="file" accept="image/*"></label><div><img id="ru-record-photo-preview" alt="ภาพครุภัณฑ์ที่เลือก" style="max-width:240px;max-height:200px;display:none"></div><button type="button" id="ru-record-photo-remove">ลบรูปจากรายการนี้</button></section><label id="ru-record-delete-label"><input type="checkbox" id="ru-record-delete-confirm"> ยืนยันลบรายการที่เลือก (ไม่ลบถาวร)</label><p id="ru-record-message" role="status" aria-live="polite"></p><div style="display:flex;gap:12px;margin-top:16px"><button type="submit" id="ru-record-save">บันทึกลง Supabase</button><button type="button" id="ru-record-close">ปิด</button></div></form>';
  for(const [field,labelText] of recordFields){const label=document.createElement('label');label.textContent=labelText;const input=document.createElement('input');input.id='ru-record-'+field;input.name=field;input.type='text';input.style.cssText='display:block;width:100%;box-sizing:border-box;padding:8px;border:1px solid #aaa;border-radius:6px';if(field==='asset_name')input.required=true;label.append(input);formElement('ru-record-fields').append(label);}
  document.body.append(recordDialog);
  formElement('ru-record-close').onclick=()=>{if(!recordWriting)recordDialog.close()};
  recordDialog.addEventListener('cancel',e=>{if(recordWriting)e.preventDefault()});
  formElement('ru-record-choice').onchange=()=>loadRecordForm(formElement('ru-record-choice').value);
  formElement('ru-record-form').onsubmit=async e=>{e.preventDefault();await saveRecordForm(false)};
  formElement('ru-record-photo-remove').onclick=async()=>{if(!recordBase){formMessage('เลือกรายการจากฐานกลางก่อน',true);return}if(!formElement('ru-record-delete-confirm').checked){formElement('ru-record-delete-label').style.display='block';formMessage('ติ๊กยืนยันก่อนลบรูป ระบบจะคงไฟล์เดิมไว้และซ่อนรูปจากรายการ',true);return}await saveRecordForm(true)};
  formElement('ru-record-photo-file').onchange=async e=>{
    const file=e.target.files&&e.target.files[0];photoDraft=null;if(!file)return;
    try{formMessage('กำลังเตรียมภาพ…');const bitmap=await createImageBitmap(file);const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(bitmap,0,0,c.width,c.height);bitmap.close();const data=c.toDataURL('image/jpeg',0.8);const bytes=base64Bytes(data);if(bytes.length>3900000)throw new Error('ภาพที่ย่อแล้วยังเกิน 3.9 MB กรุณาเลือกภาพเล็กลง');const th=document.createElement('canvas'),ratio=Math.min(1,240/Math.max(c.width,c.height));th.width=Math.max(1,Math.round(c.width*ratio));th.height=Math.max(1,Math.round(c.height*ratio));th.getContext('2d').drawImage(c,0,0,th.width,th.height);photoDraft={b64:data.split(',')[1],thumb:th.toDataURL('image/jpeg',0.65)};const image=formElement('ru-record-photo-preview');image.src=photoDraft.thumb;image.style.display='block';formMessage('ภาพอยู่ในแบบฟอร์ม ยังไม่บันทึก — กดบันทึกลง Supabase');}catch(err){formMessage(err.message,true)}
  };
}
function loadRecordForm(key){
  recordBase=assets.find(a=>a.key===key)||null;photoDraft=null;
  for(const [field] of recordFields){const input=formElement('ru-record-'+field);input.value=recordBase?String(recordBase[field]??''):'';input.disabled=recordMode==='photo'||recordMode==='delete';}
  formElement('ru-record-identity').textContent=recordBase?'รหัสอ้างอิง '+recordBase.key+' · revision '+recordBase.revision:'ยังไม่มีรายการที่เลือก';
  formElement('ru-record-delete-confirm').checked=false;formElement('ru-record-photo-file').value='';
  const image=formElement('ru-record-photo-preview');const src=recordBase&&recordBase.ru_photo_removed!=='1'&&(recordBase.ru_photo_url||recordBase.ru_photo_thumb);image.style.display=src?'block':'none';if(src)image.src=src;else image.removeAttribute('src');
  formMessage(session?.access_token?'การเปลี่ยนแปลงยังไม่บันทึก':'ยังไม่เข้าสู่ระบบ Supabase — กรอกข้อมูลได้ แต่ระบบจะไม่อ้างว่าบันทึกออนไลน์');
}
function openRecordDialog(mode,key){
  buildRecordDialog();recordMode=mode;const create=mode==='create';
  delete formElement('ru-record-save').dataset.confirmed;formElement('ru-record-save').disabled=false;
  formElement('ru-record-title').textContent=create?'เพิ่มครุภัณฑ์':mode==='photo'?'จัดการรูปภาพ':mode==='delete'?'ลบครุภัณฑ์ (soft delete)':'แก้ไขครุภัณฑ์ / ผู้ถือครอง / สถานะ';
  const select=formElement('ru-record-choice');select.replaceChildren(new Option('— เลือกรายการ —',''));
  for(const a of assets)select.add(new Option(a.key+' · '+a.asset_no+' · '+a.asset_name,a.key));
  formElement('ru-record-choice-label').style.display=create?'none':'block';formElement('ru-record-fields').style.display=mode==='photo'||mode==='delete'?'none':'grid';formElement('ru-record-photo').style.display=mode==='photo'?'block':'none';formElement('ru-record-delete-label').style.display=mode==='delete'?'block':'none';formElement('ru-record-delete-label').lastChild.textContent=mode==='delete'?' ยืนยันลบรายการที่เลือก (ไม่ลบถาวร)':' ยืนยันลบรูปที่เลือก (เก็บไฟล์เดิมไว้)';
  formElement('ru-record-save').textContent=mode==='delete'?'ยืนยันลบลง Supabase':mode==='photo'?'บันทึกรูปลง Supabase':'บันทึกลง Supabase';
  select.value=key||'';loadRecordForm(create?'':select.value);if(!recordDialog.open)recordDialog.showModal();
}
async function saveRecordForm(removePhoto){
  if(recordWriting)return;
  try{
    if(!session?.access_token)throw authError();
    if(recordMode!=='create'&&!recordBase)throw new Error('เลือกรายการที่อ่านจากฐานกลางก่อน');
    recordWriting=true;formElement('ru-record-save').disabled=true;formMessage('กำลังบันทึกและอ่านกลับจาก Supabase…');
    let saved;
    if(recordMode==='delete'){if(!formElement('ru-record-delete-confirm').checked)throw new Error('ต้องติ๊กยืนยันลบรายการก่อน');saved=await softDeleteAsset(recordBase.key,recordBase.revision)}
    else if(recordMode==='photo'){if(removePhoto)saved=await delPhoto(recordBase.key);else{if(!photoDraft)throw new Error('เลือกภาพก่อนบันทึก');saved=await putPhoto(recordBase.key,photoDraft.b64,photoDraft.thumb)}}
    else{const fields=Object.fromEntries(recordFields.map(([field])=>[field,formElement('ru-record-'+field).value]));if(!fields.asset_name.trim())throw new Error('กรอกชื่อครุภัณฑ์ก่อน');if(recordMode==='create')saved=await createRecord(fields);else{const changes=Object.fromEntries(Object.entries(fields).filter(([field,value])=>!sameValue(value,recordBase[field])));if(!Object.keys(changes).length){formMessage('ไม่มีข้อมูลเปลี่ยนแปลง');return}saved=await updateAsset(recordBase.key,changes,{revision:recordBase.revision,fields:Object.fromEntries(Object.keys(changes).map(field=>[field,recordBase[field]]))})}}
    const key=recordBase?.key||saved.key;const refreshed=await refresh();if(!refreshed){formMessage('ฐานกลางยืนยันบันทึกแล้ว แต่โหลดรายการใหม่ไม่สำเร็จ — อย่ากดส่งซ้ำ ให้กดอ่านข้อมูล',true);formElement('ru-record-save').dataset.confirmed='true';return}
    if(recordMode==='delete'){recordBase=null;formElement('ru-record-save').dataset.confirmed='true'}else if(recordMode==='create'){recordMode='edit';formElement('ru-record-title').textContent='รายการที่สร้างแล้ว';loadRecordForm(key)}else loadRecordForm(key);
    formMessage('บันทึกแล้ว และยืนยันข้อมูลด้วย GET จาก Supabase · '+key);status('ยืนยันการบันทึกจากฐานกลาง '+key);
  }catch(err){formMessage('ยังไม่ยืนยันการบันทึก: '+err.message+' — ข้อมูลในแบบฟอร์มยังอยู่',true)}
  finally{recordWriting=false;formElement('ru-record-save').disabled=formElement('ru-record-save').dataset.confirmed==='true'}
}

function photoConfirmed(key,expected){
  if(key==null)return photoConfirmations.size>0;
  const row=photoConfirmations.get(String(key));
  if(!row)return false;
  if(expected==null)return true;
  for(const [name,value] of Object.entries(expected))if(!sameValue(row[name],value))return false;
  return true;
}
function run(fn){return async()=>{try{await fn()}catch(e){status('ผิดพลาด: '+(e.message||e),true)}}}
el('ru-sb-connect').onclick=()=>{const p=el('ru-sb-panel');p.style.display=p.style.display==='none'?'block':'none';el('ru-sb-url').value=cfg.url||'';el('ru-sb-key').value=cfg.anonKey||'';if(p.style.display==='block')el('ru-sb-email').focus()};
el('ru-sb-login').onclick=run(async()=>{
  const nextCfg={url:el('ru-sb-url').value.trim(),anonKey:el('ru-sb-key').value.trim()};
  const email=el('ru-sb-email').value.trim(),password=el('ru-sb-pass').value;
  if(!email||!password)throw new Error('กรุณากรอกอีเมลและรหัสผ่าน');
  cfg=nextCfg;publicKey();
  const r=await request('/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}),authenticated:false,retry401:false});
  if(!r?.access_token)throw new Error('Supabase login ไม่ได้ access token');
  saveSession(r);writeStore(CFGKEY,cfg);el('ru-sb-pass').value='';el('ru-sb-panel').style.display='none';
  if(!(await refresh()))throw new Error('เข้าสู่ระบบแล้ว แต่ initial GET อ่านข้อมูลไม่สำเร็จ');
});
const changePasswordButton=document.createElement('button');
changePasswordButton.id='ru-sb-change-password';changePasswordButton.type='button';
changePasswordButton.textContent='เปลี่ยนรหัสผ่านบัญชีนี้';
changePasswordButton.title='หลังเข้าสู่ระบบ กรอกรหัสผ่านใหม่ในช่องรหัสผ่าน แล้วกดปุ่มนี้';
changePasswordButton.style.cssText=el('ru-sb-login').style.cssText;
el('ru-sb-panel').append(changePasswordButton);
changePasswordButton.onclick=run(async()=>{
  if(!session?.access_token)throw authError();
  const password=el('ru-sb-pass').value;
  if(password.length<12)throw new Error('กรอกรหัสผ่านใหม่อย่างน้อย 12 ตัวในช่องรหัสผ่าน');
  const user=await request('/auth/v1/user',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
  if(!user?.id||user.id!==session.user?.id)throw new Error('Supabase ไม่ยืนยันผู้ใช้ที่เปลี่ยนรหัสผ่าน');
  el('ru-sb-pass').value='';status('Supabase ยืนยันเปลี่ยนรหัสผ่านบัญชีนี้แล้ว');
});
el('ru-sb-logout').onclick=()=>{invalidateSession();status('ออกจากระบบแล้ว และล้างข้อมูล private ในหน่วยความจำ')};
el('ru-sb-refresh').onclick=run(refresh);
el('ru-sb-create').onclick=()=>openRecordDialog('create');
editButton.onclick=()=>openRecordDialog('edit');
el('ru-sb-delete').onclick=()=>openRecordDialog('delete');
el('ru-sb-photo').onclick=()=>openRecordDialog('photo');
const send=document.createElement('button');send.textContent='ส่งการแก้ไขที่ค้างไป Supabase';send.style.cssText='margin:8px;padding:8px;background:#4f46a5;color:white;border-radius:8px';bar.append(send);
send.onclick=run(async()=>{
  const changes=hook?.pending?.()||[];
  if(!changes.length)throw new Error('ไม่มีรายการแก้ไขที่ค้าง');
  if(!confirm('ยืนยันส่ง '+changes.length+' รายการไป Supabase?'))return;
  const result=await editBatch(changes,'fields');
  const done=result.results.filter(x=>x.ok),failed=result.results.filter(x=>!x.ok);
  if(done.length)hook?.committed?.(done,changes);
  const refreshed=await refresh();
  status((result.ok&&refreshed?'สำเร็จ':result.ok?'เขียนยืนยันแล้ว แต่ refresh ล้มเหลว':'บางรายการไม่สำเร็จ')+' '+done.length+'/'+result.results.length+(failed.length?' · '+failed.map(x=>x.key+': '+x.error).join('; '):''),!result.ok||!refreshed);
});

window.RUAssetHub={refresh,connected:()=>{try{publicKey();return !!(cfg.url&&cfg.anonKey&&session?.access_token)}catch(_){return false}},call,photoConfirmed,openEditor:openRecordDialog};
if(cfg.url&&cfg.anonKey&&session?.access_token)setTimeout(()=>refresh(),100);
else{clearPrivateView();if(isPublicListing())setTimeout(()=>refresh(),100);}
})();
