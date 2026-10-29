(function(){
'use strict';
var CACHE='ru_asset_master_cache_v1', CONFIG='ru_sync_cfg_v1';
function read(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch(e){return null}}
function stamp(){return new Date().toLocaleString('th-TH',{hour12:false})}
var bar=document.createElement('div');
bar.id='ru-master-bar';
bar.style.cssText='max-width:1120px;margin:12px auto;padding:10px 14px;border:2px solid #a78bfa;border-radius:14px;background:#f4f0ff;color:#30225d;display:flex;align-items:center;gap:9px;flex-wrap:wrap;font:600 14px system-ui,sans-serif';
var caption=document.createElement('span');caption.style.flex='1 1 230px';
var button=document.createElement('button');button.type='button';button.textContent='🔄 ดึงข้อมูลล่าสุดจาก RU Asset DB';button.style.cssText='border:none;border-radius:10px;background:#6d28d9;color:white;padding:10px 14px;cursor:pointer;font:700 14px system-ui,sans-serif';
bar.append(caption,button);
var anchor=document.querySelector('.wrap')||document.querySelector('main')||document.body.firstElementChild;
if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(bar,anchor);else document.body.prepend(bar);
function note(msg){caption.textContent=msg}
var hook=window.RUAssetPage;
if(!hook||typeof hook.apply!=='function'){note('⚠️ ไม่พบตัวเชื่อมหน้าปัจจุบัน');button.disabled=true;return}
function apply(data,source){
 if(!data||!Array.isArray(data.assets)||data.assets.length<1)throw new Error('ไม่มีรายการครุภัณฑ์จาก DB');
 var keys=new Set();
 for(var a of data.assets){if(!a||!/^r\d+$/.test(String(a.key||''))||keys.has(a.key))throw new Error('พบข้อมูล key ไม่ถูกต้องหรือซ้ำใน DB');keys.add(a.key)}
 hook.apply(data.assets);
 note((source==='online'?'✅ อ่าน RU Asset DB ล่าสุด':'📋 แสดงข้อมูล DB ที่เคยดึงไว้')+' · '+data.assets.length+' รายการ · '+(data.fetched_at||'ไม่ทราบเวลา'));
}
var old=read(CACHE);
if(old){try{apply(old,'cache')}catch(e){note('⚠️ แคชผิดรูปแบบ: '+e.message)}}
else note('📦 ข้อมูลในหน้าเป็นชุดเริ่มต้น · กดดึงจาก RU Asset DB เพื่อใช้ข้อมูลจริง');
async function refresh(){
 var cfg=read(CONFIG);
 if(!cfg||!cfg.api||!cfg.token){note('⚠️ ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูลในหน้าจัดให้พนักงาน');return}
 button.disabled=true;button.textContent='⏳ กำลังอ่านฐานข้อมูล…';
 try{
  var ctrl=new AbortController(),timer=setTimeout(function(){ctrl.abort()},20000);
  var r;
  try{r=await fetch(cfg.api,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({token:cfg.token,action:'getAssets'}),redirect:'follow',cache:'no-store',signal:ctrl.signal})}
  finally{clearTimeout(timer)}
  if(!r.ok)throw new Error('HTTP '+r.status);
  var j=await r.json();
  if(!j.ok)throw new Error(j.error||'เซิร์ฟเวอร์ไม่ตอบรับ');
  if(!Array.isArray(j.assets)||j.assets.length<100)throw new Error('จำนวนรายการจาก DB ต่ำผิดปกติ — ไม่แทนข้อมูลเก่า');
  var data={assets:j.assets,fetched_at:stamp()};
  // Commit cache only after verifying and successfully rendering the new data.
  apply(data,'online');
  try{localStorage.setItem(CACHE,JSON.stringify(data))}
  catch(e){note('✅ ดึงข้อมูลแล้ว แต่พื้นที่แคชไม่พอ (ข้อมูลในหน้ายังเป็นรุ่นล่าสุด)')}
  window.dispatchEvent(new Event('ru-asset-db-updated'));
 }catch(e){note('❌ อ่าน RU Asset DB ไม่สำเร็จ: '+(e.name==='AbortError'?'หมดเวลารอคำตอบ':e.message||e)+' — ข้อมูลเดิมยังอยู่')}
 finally{button.disabled=false;button.textContent='🔄 ดึงข้อมูลล่าสุดจาก RU Asset DB'}
}
button.onclick=refresh;
window.RUAssetHub={refresh:refresh,readCache:function(){return read(CACHE)}};
window.addEventListener('storage',function(e){if(e.key===CACHE){var v=read(CACHE);if(v)try{apply(v,'cache')}catch(err){note('⚠️ อัปเดตจากอีกแท็บไม่สำเร็จ: '+err.message)}}});
})();