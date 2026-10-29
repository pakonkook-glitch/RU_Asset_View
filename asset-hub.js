(function(){
'use strict';
const CFGKEY='ru_supabase_config_v1',SESSKEY='ru_supabase_session_v1',CACHE='ru_supabase_verified_cache_v1';
const DEFAULT={url:'https://rxulhozzrmylcejnrdcm.supabase.co',anonKey:'sb_publishable_lpeG5taNXbOUVQH4x8ZgwA_5K5ceLNS'};
let cfg={...DEFAULT},session=null,assets=[],busy=false;
try{cfg={...DEFAULT,...JSON.parse(localStorage.getItem(CFGKEY)||'{}')};session=JSON.parse(localStorage.getItem(SESSKEY)||'null')}catch(e){}
const hook=window.RUAssetPage;
const bar=document.createElement('section');bar.id='ru-supabase-bar';bar.style.cssText='max-width:1100px;margin:12px auto;padding:12px;border:2px solid #9d86d6;border-radius:12px;background:#f8f4ff;color:#31264b;font:14px system-ui';
bar.innerHTML='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="flex:1">RU Asset View · Supabase</b><span id="ru-sb-status">ยังไม่ได้เชื่อมฐานข้อมูล</span><button id="ru-sb-connect">เชื่อมต่อ / เข้าสู่ระบบ</button><button id="ru-sb-refresh">โหลดฐานข้อมูลกลาง</button><button id="ru-sb-create">เพิ่มครุภัณฑ์</button><button id="ru-sb-delete">ลบรายการ</button><button id="ru-sb-photo">อัปโหลดรูป</button><a href="edit.html">แก้ไขข้อมูล</a></div><div id="ru-sb-panel" style="display:none;margin-top:12px"><label>Supabase project URL <input id="ru-sb-url" style="width:85%" placeholder="https://your-project.supabase.co"></label><label>Publishable / anon key <input id="ru-sb-key" style="width:85%" type="password"></label><label>อีเมล <input id="ru-sb-email" type="email"></label><label>รหัสผ่าน <input id="ru-sb-pass" type="password"></label><button id="ru-sb-login">เข้าสู่ระบบ</button><button id="ru-sb-signup">สร้างบัญชีครั้งแรก</button><button id="ru-sb-logout">ออกจากระบบ</button><p>ห้ามกรอก service_role หรือ secret key ในเว็บเด็ดขาด</p></div>';
const anchor=document.querySelector('.wrap')||document.querySelector('main')||document.body.firstElementChild;
if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(bar,anchor);else document.body.prepend(bar);
const el=id=>bar.querySelector('#'+id),status=(msg,bad=false)=>{el('ru-sb-status').textContent=msg;el('ru-sb-status').style.color=bad?'#a21d32':'#27633a'};
for(const [id,text] of [['ru-sb-connect','ตั้งค่า'],['ru-sb-refresh','รีเฟรช'],['ru-sb-create','เพิ่ม'],['ru-sb-delete','ลบ'],['ru-sb-photo','รูป'],['ru-sb-login','ลงชื่อเข้าใช้'],['ru-sb-signup','สร้างบัญชี']])el(id).style.cssText='padding:7px;border-radius:7px;border:1px solid #9885c9;background:#f0eaff;cursor:pointer';
function url(){const u=String(cfg.url||'').replace(/\/+$/,'');if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(u))throw Error('Supabase URL ไม่ถูกต้อง');return u}
function key(){const k=String(cfg.anonKey||'');if(!k||k.startsWith('sb_secret_')||k.includes('service_role'))throw Error('ต้องใช้ publishable หรือ anon key เท่านั้น');return k}
async function raw(route,{method='GET',body,headers={},authenticated=true}={}){
 const h={apikey:key(),...headers};
 if(authenticated){await ensureAuth();h.Authorization='Bearer '+session.access_token}
 let response=await fetch(url()+route,{method,headers:h,body,cache:'no-store'});
 if(!response.ok){let msg='HTTP '+response.status;try{const e=await response.json();msg=e.message||e.error_description||e.error||msg}catch(_){}throw Error(msg)}
 if(response.status===204)return null;
 if(response.headers.get('content-type')?.includes('application/json'))return response.json();
 return response.blob();
}
async function ensureAuth(){
 if(!session||!session.access_token)throw Error('กรุณาเข้าสู่ระบบ Supabase');
 if(session.expires_at&&Date.now()/1000>session.expires_at-80){
  if(!session.refresh_token)throw Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
  const r=await raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token}),authenticated:false});
  session=r;localStorage.setItem(SESSKEY,JSON.stringify(session));
 }
}
async function login(){
 cfg={url:el('ru-sb-url').value.trim(),anonKey:el('ru-sb-key').value.trim()};
 const email=el('ru-sb-email').value.trim(),password=el('ru-sb-pass').value;
 if(!email||!password)throw Error('กรอกอีเมลและรหัสผ่าน');
 const r=await raw('/auth/v1/token?grant_type=password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}),authenticated:false});
 if(!r.access_token)throw Error('เข้าสู่ระบบไม่สำเร็จ');
 session=r;localStorage.setItem(CFGKEY,JSON.stringify(cfg));localStorage.setItem(SESSKEY,JSON.stringify(session));el('ru-sb-pass').value='';
 el('ru-sb-panel').style.display='none';await refresh();
}
async function signup(){
 const email=el('ru-sb-email').value.trim();
 const password=el('ru-sb-pass').value;
 if(!email||password.length<12)throw Error('ระบุอีเมลและรหัสผ่านอย่างน้อย 12 ตัวอักษร');
 const data=await raw('/auth/v1/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}),authenticated:false});
 if(!data.user)throw Error('สร้างบัญชีไม่สำเร็จ');
 el('ru-sb-pass').value='';status('ส่งอีเมลยืนยันบัญชีแล้ว กรุณายืนยันอีเมล');
}
async function table(path,opts={}){
 return raw('/rest/v1/ru_assets'+path,{...opts,headers:{'Content-Type':'application/json',Prefer:'return=representation',...(opts.headers||{})}});
}
function assetsValid(list){
 if(!Array.isArray(list))throw Error('ฐานกลางส่งข้อมูลไม่ถูกต้อง');
 const seen=new Set();
 for(const a of list){if(!/^r\d+$/.test(a.key)||seen.has(a.key))throw Error('key ซ้ำหรือไม่ถูกต้อง: '+a.key);seen.add(a.key)}
 return list;
}
async function refresh(){
 if(busy)return false;busy=true;status('กำลังอ่าน Supabase…');
 try{
  const rows=assetsValid(await table('?select=*&deleted_at=is.null&limit=1000'));
  if(!rows.length)throw Error('ตาราง ru_assets ว่าง — ยังไม่แทนข้อมูลบนหน้าด้วยข้อมูลว่าง');
  const photoRows=rows.filter(a=>a.ru_photo_id&&a.ru_photo_removed!=='1');
  await Promise.all(photoRows.map(async a=>{
   const signed=await raw('/storage/v1/object/sign/ru-asset-photos/'+a.ru_photo_id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expiresIn:900})});
   if(!signed.signedURL)throw Error('Storage ไม่ยืนยันรูป '+a.key);
   const signedPath=signed.signedURL;
   a.ru_photo_url=signedPath.startsWith('https://')?signedPath:url()+(signedPath.startsWith('/storage/v1/')?'':'/storage/v1')+(signedPath.startsWith('/')?'':'/')+signedPath;
  }));
  assets=rows;hook?.apply?.(rows);localStorage.setItem(CACHE,JSON.stringify({at:new Date().toISOString(),count:rows.length}));
  status('✅ ยืนยันจาก Supabase '+rows.length+' รายการ '+new Date().toLocaleTimeString('th-TH'));return true;
 }catch(e){status('❌ '+e.message,true);return false}finally{busy=false}
}
async function update(keyname,changes,expectedRevision){
 const filter='?key=eq.'+encodeURIComponent(keyname)+'&revision=eq.'+expectedRevision+'&select=*';
 const got=await table(filter,{method:'PATCH',body:JSON.stringify(changes)});
 if(!Array.isArray(got)||got.length!==1)throw Error('ข้อมูลถูกแก้ไขจากเครื่องอื่น กรุณารีเฟรชก่อน');
 return got[0];
}
async function editBatch(changes,mode){
 const results=[];for(const c of changes){
  try{
   const current=(await table('?key=eq.'+encodeURIComponent(c.key)+'&select=*&limit=1'))[0];
   if(!current)throw Error('ไม่พบรหัสครุภัณฑ์');
   const fields={};
   if(mode==='fields'){
    for(const [name,spec] of Object.entries(c.fields||{})){
     if(!['asset_name','asset_no','asset_no_alt','barcode','serial_no','category','location','condition','status','acquired_date_be','fiscal_year'].includes(name))throw Error('ไม่อนุญาตฟิลด์ '+name);
     if(String(current[name]||'')!==String(spec.from||''))throw Error('ข้อมูล '+name+' ถูกแก้จากเครื่องอื่น');
     fields[name]=String(spec.to??'');
    }
   }else{
    if(c.asset_no!==undefined){if(String(current.asset_no||'')!==String(c.expectedOld??''))throw Error('เลขครุภัณฑ์ถูกแก้จากเครื่องอื่น');fields.asset_no=c.asset_no}
    if(c.assignee!==undefined)fields.assignee=c.assignee;
   }
   await update(c.key,fields,current.revision);
   results.push({key:c.key,ok:true,fields:Object.keys(fields)});
  }catch(e){results.push({key:c.key,ok:false,error:String(e.message||e)})}
 }
 return {ok:true,results};
}
async function createAsset(){
 const name=prompt('ชื่อครุภัณฑ์ใหม่');if(!name)return;
 const number=prompt('เลขครุภัณฑ์','');if(number===null)return;
 const location=prompt('สถานที่','');if(location===null)return;
 const keys=assets.map(a=>Number(a.key.slice(1))).filter(Number.isFinite);
 const next='r'+(Math.max(0,...keys)+1);
 const row={key:next,asset_name:name,asset_no:number,location};
 const r=await table('?select=*',{method:'POST',body:JSON.stringify(row)});
 if(!r||r.length!==1)throw Error('ฐานข้อมูลไม่ยืนยันการเพิ่มรายการ');
 await refresh();status('✅ เพิ่มรายการ '+next+' ลง Supabase');
}
async function deleteAsset(){
 const k=prompt('ระบุ key ครุภัณฑ์ที่ต้องการซ่อน (เช่น r12)');if(!k)return;
 const a=assets.find(x=>x.key===k);if(!a)throw Error('ไม่พบรายการ');
 if(!confirm('ยืนยันซ่อน '+k+' '+a.asset_name+' จากฐานข้อมูลกลาง?'))return;
 await update(k,{deleted_at:new Date().toISOString()},a.revision);
 await refresh();status('✅ ซ่อน '+k+' ในฐานข้อมูลกลาง');
}
const b64ToBytes=t=>Uint8Array.from(atob(t.replace(/^data:image\/jpeg;base64,/,'')),c=>c.charCodeAt(0));
async function putPhoto(k,b64,thumb){
 const bytes=b64ToBytes(b64);
 if(bytes.length<10||bytes.length>3900000||bytes[0]!==255||bytes[1]!==216)throw Error('รูป JPEG ไม่ถูกต้องหรือเกิน 3.9MB');
 const current=(await table('?key=eq.'+encodeURIComponent(k)+'&select=*&limit=1'))[0];if(!current)throw Error('ไม่พบรหัสครุภัณฑ์');
 const uuid=(crypto?.randomUUID?.()||Math.random().toString(16).slice(2)),p=k+'/'+uuid+'.jpg';
 await raw('/storage/v1/object/ru-asset-photos/'+p,{method:'POST',headers:{'Content-Type':'image/jpeg','x-upsert':'false'},body:bytes});
 const stored=await raw('/storage/v1/object/authenticated/ru-asset-photos/'+p);
 if(!(stored instanceof Blob)||stored.size!==bytes.length)throw Error('Storage ยังไม่ยืนยันขนาดไฟล์รูป');
 const diskBytes=new Uint8Array(await stored.arrayBuffer());
 const savedHash=new Uint8Array(await crypto.subtle.digest('SHA-256',diskBytes));
 const sentHash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 if(savedHash.some((b,i)=>b!==sentHash[i]))throw Error('รูปใน Storage ไม่ตรงกับไฟล์ที่ส่ง');
 const saved=await update(k,{ru_photo_id:p,ru_photo_thumb:thumb,ru_photo_url:'',ru_photo_removed:''},current.revision);
 if(saved.ru_photo_id!==p)throw Error('ฐานข้อมูลไม่ยืนยันการผูกภาพ');
 return {ok:true,status:'success',assetId:k,act:'set',fileId:p,imageUrl:'',thumbnail:thumb};
}
async function delPhoto(k){
 const current=(await table('?key=eq.'+encodeURIComponent(k)+'&select=*&limit=1'))[0];
 if(!current)throw Error('ไม่พบรหัสครุภัณฑ์');
 await update(k,{ru_photo_id:'',ru_photo_thumb:'',ru_photo_url:'',ru_photo_removed:'1'},current.revision);
 if(current.ru_photo_id)await raw('/storage/v1/object/ru-asset-photos',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[current.ru_photo_id]})});
 return {ok:true,status:'success',assetId:k,act:'del',fileId:'',imageUrl:''};
}
async function call(body){
 if(body.action==='getAssets')return {ok:true,assets:assetsValid(await table('?select=*&deleted_at=is.null&limit=1000'))};
 if(body.action==='applyAssetFields')return editBatch(body.changes,'fields');
 if(body.action==='applyAssetChanges')return editBatch(body.changes,'changes');
 if(body.action==='photoPut')return body.act==='del'?delPhoto(body.key):putPhoto(body.key,body.b64,body.th);
 throw Error('Supabase ไม่รองรับ action '+body.action);
}
async function uploadFromBar(){
 const k=prompt('รหัสครุภัณฑ์สำหรับอัปโหลดรูป (เช่น r1)');if(!k)return;
 if(!assets.some(a=>a.key===k))throw Error('ไม่พบรหัส '+k);
 const i=document.createElement('input');i.type='file';i.accept='image/jpeg';
 i.onchange=async()=>{try{const f=i.files[0];if(!f)return;const bytes=new Uint8Array(await f.arrayBuffer());
 const b64=btoa(Array.from(bytes,x=>String.fromCharCode(x)).join(''));
 await putPhoto(k,b64,'data:image/jpeg;base64,'+b64);
 await refresh();status('✅ อัปโหลดและยืนยันรูป '+k)}catch(e){status('❌ '+e.message,true)}};i.click();
}
function run(fn){return async()=>{try{await fn()}catch(e){status('❌ '+e.message,true)}}}
el('ru-sb-connect').onclick=()=>{el('ru-sb-panel').style.display=el('ru-sb-panel').style.display==='none'?'block':'none';el('ru-sb-url').value=cfg.url||'';el('ru-sb-key').value=cfg.anonKey||''};
el('ru-sb-login').onclick=run(login);
el('ru-sb-signup').onclick=run(signup);


el('ru-sb-logout').onclick=()=>{session=null;localStorage.removeItem(SESSKEY);status('ออกจากระบบแล้ว')};
el('ru-sb-refresh').onclick=run(refresh);
el('ru-sb-create').onclick=run(createAsset);
el('ru-sb-delete').onclick=run(deleteAsset);
el('ru-sb-photo').onclick=run(uploadFromBar);
const send=document.createElement('button');send.textContent='💾 ส่งรายการแก้ไขลง Supabase';send.style.cssText='margin:8px;padding:8px;background:#4f46a5;color:white;border-radius:8px';
bar.append(send);send.onclick=run(async()=>{
 const changes=hook?.pending?.()||[];if(!changes.length)throw Error('ไม่มีการแก้ไขรอส่ง');
 if(!confirm('ส่งรายการแก้ไข '+changes.length+' รายการลง Supabase?'))return;
 const result=await editBatch(changes,'fields'),done=result.results.filter(x=>x.ok),failed=result.results.filter(x=>!x.ok);
 if(done.length)hook?.committed?.(done,changes);
 await refresh();status('✅ บันทึก '+done.length+' รายการ'+(failed.length?' · ❌ ไม่ผ่าน '+failed.map(x=>x.key+':'+x.error).join('; '):''),!!failed.length);
});
window.RUAssetHub={refresh,connected:()=>!!(cfg.url&&cfg.anonKey&&session?.access_token),call,photoConfirmed:()=>true};
if(cfg.url&&cfg.anonKey&&session?.access_token)setTimeout(refresh,100);
})();
