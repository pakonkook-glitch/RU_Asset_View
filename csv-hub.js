(function(){
'use strict';
// Shared CSV-only data layer. No Apps Script calls, no automatic writes.
const STORE='ru_csv_master_v1';
const FIELDS=['key','asset_name','asset_no','asset_no_alt','barcode','serial_no','category','location','condition','status','acquired_date_be','fiscal_year','assignee','updated_at','ru_photo_thumb','ru_photo_removed'];
const PUBLIC_URL='data/ru-assets.csv';
const hook=window.RUAssetPage;
let current=null;
const bar=document.createElement('div');
bar.id='ru-csv-bar';
bar.style.cssText='max-width:1120px;margin:12px auto;padding:12px 14px;border:2px solid #a78bfa;border-radius:14px;background:#f4f0ff;color:#30225d;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:600 14px system-ui,sans-serif';
const label=document.createElement('span');label.style.cssText='flex:1 1 100%;font-weight:700';
const file=document.createElement('input');file.type='file';file.accept='.csv,text/csv';file.hidden=true;
function btn(txt,fn){const b=document.createElement('button');b.type='button';b.textContent=txt;b.onclick=fn;b.style.cssText='border:1px solid #c4b5fd;border-radius:9px;background:#fff;color:#442280;padding:9px 12px;cursor:pointer;font:700 13px system-ui,sans-serif';return b;}
const openBtn=btn('📂 นำเข้า CSV',()=>file.click());
const loadBtn=btn('🔄 โหลด CSV กลาง',()=>loadPublic(true));
const saveBtn=btn('⬇️ ดาวน์โหลด CSV',download);
const commitBtn=btn('✅ อนุมัติเลขที่เสนอ → CSV',approveNumbers);
bar.append(label,openBtn,loadBtn,saveBtn,file);
if(hook&&typeof hook.pendingNumbers==='function')bar.append(commitBtn);
const anchor=document.querySelector('.wrap')||document.querySelector('main')||document.body.firstElementChild;
if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(bar,anchor);else document.body.prepend(bar);
function note(x){label.textContent=x;}
function csvParse(s){
 s=String(s).replace(/^\ufeff/,'');const out=[];let row=[],cell='',quoted=false;
 for(let i=0;i<s.length;i++){
  const c=s[i];
  if(quoted){if(c==='"'&&s[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
  else if(c==='"'&&cell==='')quoted=true;
  else if(c===','){row.push(cell);cell='';}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))out.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw new Error('CSV มีเครื่องหมายคำพูดไม่ครบ');
 if(cell!==''||row.length){row.push(cell);if(row.some(v=>v!==''))out.push(row);}
 return out;
}
function parse(s){
 const all=csvParse(s);if(!all.length)throw Error('CSV ว่าง');
 const header=all.shift().map(v=>String(v).trim().replace(/^\ufeff/,''));
 const at={};header.forEach((h,i)=>{if(h&&!Object.prototype.hasOwnProperty.call(at,h))at[h]=i;});
 if(at.key===undefined||at.asset_no===undefined||at.asset_name===undefined)throw Error('ต้องมีหัวคอลัมน์ key, asset_no, asset_name');
 const found=new Set(),assets=[];
 for(const row of all){
  const a={};FIELDS.forEach(f=>a[f]=at[f]===undefined?'':String(row[at[f]]??'').trim());
  if(!a.key)continue;
  if(!/^r\d+$/.test(a.key)||found.has(a.key))throw Error('รหัสรายการไม่ถูกต้องหรือซ้ำ: '+a.key);
  found.add(a.key);assets.push(a);
 }
 if(assets.length<100)throw Error('ข้อมูลเพียง '+assets.length+' รายการ — ไม่แทนตารางเดิม');
 return assets;
}
function protect(raw){return raw.map(a=>Object.fromEntries(FIELDS.map(k=>[k,String(a[k]??'')])));}
function apply(assets,source,store){
 if(!hook||typeof hook.apply!=='function')throw Error('ไม่พบตัวเชื่อมหน้าทะเบียน');
 hook.apply(assets);
 current={assets:protect(assets),source,at:new Date().toISOString()};
 if(store){
  try{localStorage.setItem(STORE,JSON.stringify(current));}
  catch(e){note('⚠️ เปิดตารางแล้ว แต่บันทึกในเบราว์เซอร์ไม่ผ่าน: '+e.message);return;}
 }
 note('✅ CSV กลาง · '+assets.length+' รายการ · '+source+' · '+new Date(current.at).toLocaleString('th-TH',{hour12:false}));
}
async function loadPublic(userInitiated){
 if(userInitiated&&current&&current.source!=='CSV กลางจากเว็บ'){
  if(!confirm('แทน CSV ที่นำเข้าในเครื่องด้วย CSV กลางบนเว็บหรือไม่?\nควรดาวน์โหลด CSV ที่แก้ไว้เก็บก่อน'))return;
 }
 const prev=label.textContent;note('⏳ กำลังโหลด CSV กลาง…');
 try{
  const r=await fetch(PUBLIC_URL,{cache:'no-store'});
  if(!r.ok)throw Error('HTTP '+r.status);
  const assets=parse(await r.text());
  apply(assets,'CSV กลางจากเว็บ',true);
 }catch(e){note('❌ โหลด CSV ไม่สำเร็จ: '+(e.message||e)+' · ข้อมูลเดิมยังอยู่');if(!userInitiated&&current)note(prev);}
}
function escapeCell(v){const s=String(v??'');return '"'+s.replace(/"/g,'""')+'"';}
function exportText(assets){return '\ufeff'+FIELDS.join(',')+'\r\n'+assets.map(a=>FIELDS.map(k=>escapeCell(a[k])).join(',')).join('\r\n')+'\r\n';}
function download(){
 if(!current){alert('ยังไม่มี CSV สำหรับดาวน์โหลด');return;}
 const blob=new Blob([exportText(current.assets)],{type:'text/csv;charset=utf-8'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='ru-assets-updated.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function importFile(){
 const f=file.files&&file.files[0];file.value='';if(!f)return;
 try{const assets=parse(await f.text());if(!confirm('นำเข้าครุภัณฑ์ '+assets.length+' รายการจาก '+f.name+' ใช้ร่วมกันในหน้าทะเบียน หน้าจัดสรร และสติกเกอร์หรือไม่?'))return;
 apply(assets,'ไฟล์ '+f.name,true);
 }catch(e){note('❌ นำเข้าไม่ได้: '+(e.message||e));}
}
file.addEventListener('change',importFile);
function approveNumbers(){
 if(!current){alert('กรุณาโหลด CSV ก่อน');return;}
 if(!hook||!hook.pendingNumbers){alert('เปิดหน้านี้จากหน้าจัดให้พนักงาน');return;}
 const proposed=hook.pendingNumbers(),valid=proposed.filter(x=>x&&/^r\d+$/.test(x.key)&&x.key!=='r108'&&String(x.asset_no||'').trim());
 if(!valid.length){alert('ไม่มีข้อเสนอแก้เลขที่พร้อมอนุมัติ (r108 ไม่ถูกนำไปใช้)');return;}
 const map=new Map(current.assets.map(a=>[a.key,a])),next=current.assets.map(a=>Object.assign({},a)),lookup=new Map(next.map(a=>[a.key,a]));
 const failed=[],changes=[];
 for(const p of valid){
  const row=lookup.get(p.key);if(!row){failed.push(p.key+': ไม่มีรายการ');continue;}
  const number=String(p.asset_no).trim();
  const collision=next.find(a=>a.key!==p.key&&String(a.asset_no).trim()===number);
  const proposalDup=valid.find(a=>a.key!==p.key&&String(a.asset_no).trim()===number);
  if(collision||proposalDup){failed.push(p.key+': เลขซ้ำ '+number);continue;}
  changes.push({key:p.key,old:row.asset_no,next:number});
 }
 if(failed.length){alert('ยังไม่อนุมัติ เนื่องจากเลขซ้ำหรือรายการไม่พบ:\n'+failed.slice(0,12).join('\n'));return;}
 const preview=changes.slice(0,6).map(x=>x.key+': '+x.old+' → '+x.next).join('\n');
 if(!confirm('อนุมัติแก้เลข '+changes.length+' รายการลง CSV ในเบราว์เซอร์?\n\n'+preview+(changes.length>6?'\n...':'')+'\n\nไม่มีการส่งไป Google Sheet\nจะดาวน์โหลดไฟล์ CSV ที่แก้แล้วให้ทันที'))return;
 changes.forEach(c=>lookup.get(c.key).asset_no=c.next);
 try{apply(next,'CSV แก้เลขในเครื่อง',true);hook.commitNumbers(changes.map(c=>c.key));download();}
 catch(e){note('❌ ไม่สามารถบันทึก CSV: '+(e.message||e));}
}
window.RUCSVHub={openImport:()=>file.click(),download,loadPublic:()=>loadPublic(true),approveNumbers,read:()=>current};
try{
 const old=JSON.parse(localStorage.getItem(STORE)||'null');
 if(old&&Array.isArray(old.assets)&&old.assets.length>=100){apply(old.assets,old.source||'CSV ในเครื่อง',false);}
 else note('📦 กำลังอ่าน CSV กลาง…');
}catch(e){note('⚠️ แคช CSV เก่าอ่านไม่ได้ จะโหลดใหม่');}
if(!current||current.source==='CSV กลางจากเว็บ')loadPublic(false);
window.addEventListener('storage',function(e){
 if(e.key!==STORE||!e.newValue)return;
 try{const pack=JSON.parse(e.newValue);if(pack&&Array.isArray(pack.assets))apply(pack.assets,pack.source||'CSV จากแท็บอื่น',false);}catch(err){note('⚠️ อ่าน CSV จากอีกแท็บไม่ได้: '+err.message);}
});
})();