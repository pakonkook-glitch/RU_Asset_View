// export-pages.mjs — สร้างหน้าเว็บทะเบียนครุภัณฑ์ (GitHub Pages) จากฐานข้อมูล
// ใช้:  node --no-warnings scripts\export-pages.mjs [--db <path>] [--out <path>] [--readonly]
//   ค่าเริ่มต้น  = เวอร์ชัน "แก้ไขได้" (โหมดแก้ไข บันทึกใน localStorage + ส่งออก/นำเข้า JSON/CSV)
//   --readonly  = เวอร์ชันล็อก อ่านอย่างเดียว (ไม่มีปุ่ม/ฟอร์ม/ส่งออกการแก้ไข ปิดโหมดแก้ไขทั้งหมด)
// ค่าเริ่มต้น: --db  <project>\server\data\finance_assets.db
//              --out <project>\pages-export\index.html
// เปิดฐานข้อมูลแบบ readOnly เท่านั้น — ไม่แก้ไขข้อมูลใด ๆ
// ความเป็นส่วนตัว: ดึงเฉพาะคอลัมน์ใน ALLOWED_COLUMNS (ไม่มีชื่อบุคคล / ราคา / ค่าเสื่อม / หมายเหตุ / รูป / metadata การนำเข้า)
//   id ใช้เป็น row key คงที่เท่านั้น (k = "r" + id)
// ธีม: คัดลอกจาก OPC Card Sorter (TCG-Card-Tools\opc-card-sorter, "Collectr-style grid" .cx-tile)
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..');
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const dbPath = resolve(arg('--db', join(project, 'server', 'data', 'finance_assets.db')));
const outPath = resolve(arg('--out', join(project, 'pages-export', 'index.html')));
const READONLY = argv.includes('--readonly');

// Whitelist: only these columns are ever read from the DB.
const ALLOWED_COLUMNS = ['id', 'asset_no', 'asset_no_alt', 'barcode', 'asset_name', 'category',
  'acquired_date_be', 'quantity', 'location', 'condition', 'disposal_date'];

const db = new DatabaseSync(dbPath, { readOnly: true });
const raw = db.prepare(`SELECT ${ALLOWED_COLUMNS.join(', ')} FROM finance_assets ORDER BY id`).all();
db.close();

const clean = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s === '-' ? '' : s; };
function budgetYear(d) { // d/m/yyyy (พ.ศ.) -> ปีงบประมาณ (ต.ค. ขึ้นปีงบใหม่)
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean(d));
  if (!m) return '';
  const mon = +m[2], y = +m[3];
  return String(mon >= 10 ? y + 1 : y);
}
function status(r) {
  if (clean(r.disposal_date)) return 'จำหน่ายแล้ว';
  const c = clean(r.condition).replace(/ุุ/g, 'ุ').replace(/\s+/g, '');
  if (c.includes('ชำรุด')) return 'ชำรุด';
  if (c.includes('ใช้งานได้')) return 'ใช้งานได้';
  return c || 'ไม่ระบุ';
}
const rows = raw.map((r) => ({
  k: 'r' + Number(r.id),
  tag: clean(r.asset_no),
  tag2: clean(r.asset_no_alt) !== clean(r.asset_no) ? clean(r.asset_no_alt) : '',
  b: (clean(r.barcode).match(/B\d{6,}/i) || [''])[0].toUpperCase(),
  name: clean(r.asset_name).replace(/^"+|"+$/g, ''),
  type: clean(r.category).replace(/^ประเภท/, ''),
  date: clean(r.acquired_date_be),
  fy: budgetYear(r.acquired_date_be),
  qty: r.quantity == null ? '' : Number(r.quantity),
  loc: clean(r.location).replace(/\s+/g, ''),
  status: status(r),
  retired: clean(r.disposal_date) ? 1 : 0,
}));

const now = new Date();
const asOf = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now);
const json = JSON.stringify(rows).replace(/</g, '\\u003c');
const cfg = JSON.stringify({ edit: !READONLY, asOf, built: now.toISOString() });

// ---------- CSS (tokens copied from OPC Card Sorter styles.css) ----------
const CSS = String.raw`
:root{--bg:#0f1419;--panel:#1a2332;--panel2:#243044;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;--accent:#38bdf8;--accent2:#a78bfa;--ok:#34d399;--warn:#fbbf24;--danger:#f87171;--teal:#2dd4bf;--teal2:#5eead4;--tile:#0f2a33;--tline:rgba(120,200,210,.18);
font-family:"Segoe UI","Noto Sans Thai","Sarabun",system-ui,sans-serif}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;color:var(--text);background:radial-gradient(1200px 600px at 20% -10%,#123a44 0%,transparent 60%),#0b1d26;background-attachment:fixed;overflow-x:hidden}
body{font-size:15px}
a{color:var(--accent);text-decoration:none}
button,input,select,textarea{font:inherit;color:inherit;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:.45rem .65rem}
button{cursor:pointer;background:linear-gradient(180deg,#2a3a52,#1e2a3c)}
button:hover{border-color:var(--accent)}
button.primary{background:linear-gradient(180deg,#0ea5e9,#0369a1);border-color:#0284c7;font-weight:600}
button.danger{background:#7f1d1d;border-color:#991b1b}
button.teal{background:transparent;border:1px solid var(--teal);color:var(--teal);font-weight:600}
button.teal:hover{background:rgba(45,212,191,.15)}
button:disabled{opacity:.5;cursor:not-allowed}
input:focus,select:focus,textarea:focus{outline:2px solid var(--teal);border-color:transparent}
.topbar{display:flex;align-items:center;gap:1rem;flex-wrap:wrap;padding:.75rem 1.25rem;background:var(--panel);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:20}
.topbar h1{font-size:1.15rem;margin:0;letter-spacing:.02em}
.topbar .sub{color:var(--muted);font-size:.8rem}
.topbar .sp{flex:1}
.main{padding:1rem 1.25rem 2rem;max-width:1400px;width:100%;margin:0 auto}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:1rem;margin-bottom:1rem}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center}
.row+.row{margin-top:.6rem}
#q{flex:1 1 260px;min-width:0}
.muted{color:var(--muted)}
.chip{display:inline-flex;gap:.3rem;align-items:center;padding:.2rem .6rem;border-radius:999px;background:rgba(56,189,248,.08);border:1px solid var(--border);font-size:.8rem;color:var(--muted)}
.chip b{color:var(--text)}
.view-toggle{display:inline-flex;border:1px solid var(--border);border-radius:10px;overflow:hidden}
.view-toggle button{border:none;border-radius:0;background:var(--panel2);padding:.4rem .85rem}
.view-toggle button+button{border-left:1px solid var(--border)}
.view-toggle button.toggle-active{background:linear-gradient(180deg,#0ea5e9,#0369a1);font-weight:700}
.badge{display:inline-block;padding:.15rem .45rem;border-radius:6px;font-size:.75rem;font-weight:700;white-space:nowrap}
.badge.ok{background:rgba(52,211,153,.2);color:var(--ok)}
.badge.bad{background:rgba(248,113,113,.2);color:var(--danger)}
.badge.ret{background:rgba(148,163,184,.2);color:var(--muted)}
.badge.off{background:rgba(251,191,36,.2);color:var(--warn)}
.badge.edited{background:rgba(45,212,191,.2);color:var(--teal)}
.badge.new{background:rgba(167,139,250,.2);color:var(--accent2)}
.badge.del{background:#7f1d1d;color:#fecaca}
.editnote{display:none;margin-top:.75rem;padding:.6rem .8rem;border-radius:10px;border:1px dashed var(--teal);background:rgba(45,212,191,.08);color:#ccfbf1;font-size:.85rem}
body.editing .editnote{display:block}
.edit-only{display:none!important}
body.editing .edit-only{display:inline-flex!important}
body.editing .edit-only.blk{display:flex!important}
/* ===== card grid (Collectr-style .cx-tile) ===== */
.card-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1rem}
@media (max-width:1280px){.card-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:1020px){.card-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:760px){.card-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}}
@media (max-width:359px){.card-grid{grid-template-columns:1fr}}
.cx-tile{position:relative;display:flex;flex-direction:column;gap:.18rem;min-width:0;background:var(--tile);border:1px solid var(--tline);border-radius:10px;padding:.6rem;box-shadow:0 2px 10px rgba(0,0,0,.25);transition:border-color .15s,box-shadow .15s}
.cx-tile:hover{border-color:var(--teal)}
.cx-tile.is-edited{border-color:var(--teal);box-shadow:0 0 0 2px rgba(45,212,191,.35)}
.cx-tile.is-del{opacity:.6;border-style:dashed;border-color:#991b1b;box-shadow:none}
.cx-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.35rem}
.cx-badges{display:flex;flex-wrap:wrap;gap:.25rem;justify-content:flex-end}
.cx-badges .badge{font-size:.68rem;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.cx-tag{font-family:ui-monospace,"Cascadia Code",Consolas,monospace;font-weight:800;color:#fff;font-size:1.12rem;line-height:1.2;overflow-wrap:break-word;padding:.15rem 0 .1rem}
.cx-tag2{color:#7f93a5;font-size:.7rem;font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere}
.cx-name{color:#fff;font-weight:700;font-size:.92rem;line-height:1.25;margin-top:.25rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.cx-set{color:var(--teal2);text-decoration:underline;text-underline-offset:2px;font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:ui-monospace,Consolas,monospace}
.cx-sub{color:var(--muted);font-size:.76rem;overflow-wrap:anywhere}
.cx-sub b{color:#cbd5e1;font-weight:600}
.cx-note{color:#ccfbf1;font-size:.72rem;background:rgba(45,212,191,.08);border-radius:6px;padding:.2rem .35rem;margin-top:.2rem;overflow-wrap:anywhere}
.cx-bottom{display:flex;align-items:center;justify-content:space-between;gap:.4rem;margin-top:auto;padding-top:.45rem}
.cx-bottom .badge{font-size:.72rem}
.cx-edit{border:1px solid var(--teal);background:transparent;color:var(--teal);border-radius:999px;padding:.15rem .7rem;font-size:.78rem;font-weight:700}
.cx-edit:hover{background:rgba(45,212,191,.15);border-color:var(--teal)}
.cx-tile.is-new{border-color:var(--accent2)}
/* ===== table view ===== */
table.data{width:100%;border-collapse:collapse;font-size:.9rem;background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden}
table.data th,table.data td{border-bottom:1px solid var(--border);padding:.45rem .5rem;text-align:left;vertical-align:middle}
table.data th{color:var(--muted);font-weight:600;background:var(--panel);cursor:pointer;white-space:nowrap;user-select:none}
table.data th.asc::after{content:" ▲";color:var(--teal)}table.data th.desc::after{content:" ▼";color:var(--teal)}
table.data tr:hover td{background:rgba(56,189,248,.06)}
table.data tr.is-edited td{background:rgba(45,212,191,.07)}
table.data tr.is-del td{opacity:.55;text-decoration:line-through}
.mono{font-family:ui-monospace,Consolas,monospace;white-space:nowrap}
.ttag{font-family:ui-monospace,Consolas,monospace;font-weight:800;color:#fff;white-space:nowrap}
@media (max-width:760px){
 table.data thead{display:none}table.data,table.data tbody,table.data tr,table.data td{display:block;width:100%}table.data{border:0;background:none}
 table.data tr{background:var(--tile);border:1px solid var(--tline);border-radius:10px;margin-bottom:10px;padding:8px 10px}
 table.data td{border:0;padding:3px 0;display:flex;gap:10px;overflow-wrap:anywhere}table.data td::before{content:attr(data-l);color:var(--muted);font-size:.78rem;flex:0 0 92px}
 .topbar{position:static}.main{padding:.75rem .6rem 2rem}.panel{padding:.75rem}
 .row select{flex:1 1 45%;min-width:0}
}
.empty{padding:2rem;text-align:center;color:var(--muted)}
footer{color:var(--muted);font-size:.78rem;padding:0 1.25rem 1.5rem;max-width:1400px;margin:0 auto}
/* ===== modal ===== */
.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:50;padding:1rem}
.modal-backdrop[hidden]{display:none}
.modal{background:var(--panel);border:1px solid var(--border);border-radius:12px;max-width:720px;width:100%;max-height:90vh;overflow:auto;padding:1rem}
.modal h2{margin:0 0 .25rem;font-size:1.05rem}
.modal .key{color:var(--muted);font-size:.75rem;font-family:ui-monospace,Consolas,monospace;margin-bottom:.75rem}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
@media (max-width:600px){.grid2{grid-template-columns:1fr}}
label{display:flex;flex-direction:column;gap:.25rem;font-size:.85rem;color:var(--muted)}
label>*{color:var(--text)}
label.full{grid-column:1/-1}
label .was{font-size:.7rem;color:#7f93a5}
label.changed>input,label.changed>select{border-color:var(--teal)}
.modal .acts{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:space-between;margin-top:1rem}
.modal .acts div{display:flex;gap:.5rem;flex-wrap:wrap}
textarea{min-height:4.2em;resize:vertical}
#toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#0f2a33;border:1px solid var(--teal);color:#ccfbf1;padding:.5rem .9rem;border-radius:10px;z-index:60;font-size:.85rem;box-shadow:0 6px 20px rgba(0,0,0,.4)}
#toast[hidden]{display:none}
/* ===== photos ===== */
.cx-ph{position:relative;margin:-.6rem -.6rem .35rem;aspect-ratio:4/3;overflow:hidden;border-radius:10px 10px 0 0;background:#08161c;cursor:zoom-in}
.cx-ph img{width:100%;height:100%;object-fit:cover;display:block}
.cx-phn{position:absolute;right:6px;bottom:6px;background:rgba(0,0,0,.65);color:#fff;font-size:.7rem;padding:.1rem .4rem;border-radius:6px}
.phbox{margin-top:.75rem;border:1px dashed var(--border);border-radius:10px;padding:.6rem}
.phhead{font-size:.85rem;color:var(--muted);margin-bottom:.4rem}
.phlist{display:flex;flex-wrap:wrap;gap:.5rem}
.phit{position:relative;width:88px;height:88px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:#08161c}
.phit img{width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in}
.phdel{position:absolute;top:3px;right:3px;width:26px;height:26px;padding:0;border-radius:50%;background:rgba(127,29,29,.9);border-color:#991b1b;font-size:.8rem;line-height:1}
.phbtns{display:flex;flex-wrap:wrap;gap:.5rem;margin:.5rem 0 .35rem}
.phhint{font-size:.72rem;color:#7f93a5}
.lb{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center}
.lb[hidden]{display:none}
.lb img{max-width:96vw;max-height:88vh;object-fit:contain;border-radius:6px}
.lb button{position:absolute;background:rgba(15,42,51,.85);border:1px solid var(--teal);color:#fff;border-radius:999px;width:44px;height:44px;padding:0;font-size:1.3rem}
.lb .lb-x{top:12px;right:12px}.lb .lb-p{left:10px;top:50%;transform:translateY(-50%)}.lb .lb-n{right:10px;top:50%;transform:translateY(-50%)}
.lb .lb-c{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);color:#cbd5e1;font-size:.85rem}
`;

// ---------- client JS (no template interpolation inside) ----------
const JS = String.raw`
(function(){
var CFG=JSON.parse(document.getElementById('cfg').textContent);
var BASE=JSON.parse(document.getElementById('data').textContent);
var EDIT=!!CFG.edit;
var LS_KEY='ruAssetView.edits.v1', LS_MODE='ruAssetView.editMode.v1', LS_VIEW='ruAssetView.view.v1';
var FIELDS=[['tag','เลขครุภัณฑ์'],['tag2','เลขครุภัณฑ์อื่น'],['b','เลข B (บาร์โค้ด)'],['name','รายการ'],['type','ประเภท'],['date','วันที่ได้มา (ว/ด/ปี พ.ศ.)'],['loc','ห้อง/สถานที่'],['status','สถานะ'],['serial','Serial number'],['note','หมายเหตุการแก้']];
var FLABEL={};FIELDS.forEach(function(f){FLABEL[f[0]]=f[1]});
var EDITABLE=['tag','tag2','b','name','type','date','loc','status'];
var STATUSES=['ใช้งานได้','ชำรุด','จำหน่ายแล้ว','เลิกใช้งาน'];
var $=function(id){return document.getElementById(id)};
var baseByK={};BASE.forEach(function(r){baseByK[r.k]=r});
function fyOf(d){var m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d||'');if(!m)return '';return String(+m[2]>=10?+m[3]+1:+m[3])}
// ---- edits store ----
var store={v:1,edits:{}};
function load(){if(!EDIT)return;try{var s=JSON.parse(localStorage.getItem(LS_KEY)||'null');if(s&&s.v===1&&s.edits)store=s}catch(e){}}
function save(){try{localStorage.setItem(LS_KEY,JSON.stringify(store))}catch(e){toast('บันทึกไม่ได้: '+e.message)}}
load();
// ---- photos (IndexedDB, per item key; full + thumbnail JPEG data URLs) ----
var MAXPH=6,PH_MAX=1280,PH_Q=0.8,TH_MAX=360,TH_Q=0.7,PH={},PHT={},phDB=null,phBusy=0;
function idb(){return new Promise(function(res,rej){if(phDB)return res(phDB);if(!window.indexedDB)return rej(new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB'));
 var q;try{q=indexedDB.open('ruAssetView.photos',1)}catch(e){return rej(e)}
 q.onupgradeneeded=function(){q.result.createObjectStore('photos',{keyPath:'k'})};q.onsuccess=function(){phDB=q.result;res(phDB)};q.onerror=function(){rej(q.error||new Error('เปิด IndexedDB ไม่ได้'))}})}
function phPut(k){var list=PH[k]||[];return idb().then(function(db){return new Promise(function(res,rej){var tx=db.transaction('photos','readwrite');var os=tx.objectStore('photos');
 if(list.length)os.put({k:k,list:list,t:PHT[k]||''});else os.delete(k);tx.oncomplete=function(){res()};tx.onerror=tx.onabort=function(){rej(tx.error||new Error('IndexedDB error'))}})})
 .catch(function(e){toast('บันทึกรูปไม่ได้: '+(e&&e.message||e))})}
function phLoad(){return idb().then(function(db){return new Promise(function(res){var tx=db.transaction('photos','readonly');var q=tx.objectStore('photos').getAll();
 q.onsuccess=function(){(q.result||[]).forEach(function(o){if(o&&o.k&&o.list&&o.list.length){PH[o.k]=o.list;PHT[o.k]=o.t||''}});res()};q.onerror=function(){res()}})}).catch(function(){})}
function setPhotos(k,list){if(list&&list.length){PH[k]=list.slice(0,MAXPH);PHT[k]=new Date().toISOString()}else{delete PH[k];delete PHT[k]}return phPut(k)}
function photoKeys(){return Object.keys(PH).filter(function(k){return PH[k]&&PH[k].length})}
function photoOnlyKeys(){return photoKeys().filter(function(k){return !store.edits[k]})}
function clearPhotos(){PH={};PHT={};idb().then(function(db){db.transaction('photos','readwrite').objectStore('photos').clear()}).catch(function(){})}
function isImgUrl(s){return typeof s==='string'&&s.indexOf('data:image/')===0}
function loadImg(src){return new Promise(function(res,rej){var im=new Image();im.onload=function(){res(im)};im.onerror=function(){rej(new Error('เปิดไฟล์รูปไม่ได้ (รองรับ JPG/PNG/WebP — HEIC บางเครื่องอาจไม่รองรับ)'))};im.src=src})}
function draw(im,max,q){var w=im.naturalWidth||im.width,h=im.naturalHeight||im.height,s=Math.min(1,max/Math.max(w,h));var c=document.createElement('canvas');
 c.width=Math.max(1,Math.round(w*s));c.height=Math.max(1,Math.round(h*s));var g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/jpeg',q)}
function makePhoto(file){var u=URL.createObjectURL(file);return loadImg(u).then(function(im){var o={d:draw(im,PH_MAX,PH_Q),th:draw(im,TH_MAX,TH_Q)};URL.revokeObjectURL(u);return o},function(e){URL.revokeObjectURL(u);throw e})}
function photoFromUrl(d){return loadImg(d).then(function(im){return {d:d,th:draw(im,TH_MAX,TH_Q)}},function(){return {d:d,th:''}})}
function fullList(L){return (L||[]).map(function(p){return p.d})}
// ---- lightbox ----
var lb=null,lbList=[],lbI=0;
function lbGo(d){lbI=(lbI+d+lbList.length)%lbList.length;lb.querySelector('img').src=lbList[lbI];lb.querySelector('.lb-c').textContent=lbList.length>1?(lbI+1)+' / '+lbList.length:'';lb.querySelector('.lb-p').hidden=lb.querySelector('.lb-n').hidden=lbList.length<2}
function lbShow(list,i){if(!list||!list.length)return;if(!lb){lb=el('div','lb');lb.hidden=true;
  lb.innerHTML='<img alt=""><button type="button" class="lb-x" aria-label="ปิด">✕</button><button type="button" class="lb-p" aria-label="ก่อนหน้า">‹</button><button type="button" class="lb-n" aria-label="ถัดไป">›</button><div class="lb-c"></div>';
  document.body.appendChild(lb);
  lb.onclick=function(ev){var c=ev.target.className;if(c==='lb-p')lbGo(-1);else if(c==='lb-n')lbGo(1);else lb.hidden=true};
  window.addEventListener('keydown',function(ev){if(lb.hidden)return;if(ev.key==='Escape'){lb.hidden=true;ev.stopPropagation()}else if(ev.key==='ArrowLeft')lbGo(-1);else if(ev.key==='ArrowRight')lbGo(1)},true)}
 lbList=list;lbI=i||0;lbGo(0);lb.hidden=false}
function cardPhoto(t,r){var L=EDIT&&PH[r.k];if(!L||!L.length)return;var w=el('div','cx-ph');var im=document.createElement('img');im.src=L[0].th||L[0].d;im.alt='';im.loading='lazy';im.decoding='async';w.appendChild(im);
 if(L.length>1)w.appendChild(el('span','cx-phn','📷 '+L.length));w.title='แตะเพื่อดูรูปใหญ่';w.onclick=function(){lbShow(fullList(L),0)};t.appendChild(w)}
function emptyBase(){return {k:'',tag:'',tag2:'',b:'',name:'',type:'',date:'',fy:'',qty:'',loc:'',status:'ใช้งานได้',retired:0}}
function eff(base,e){var r={};for(var x in base)r[x]=base[x];r.serial='';r.note='';
 if(e){var f=e.f||{};for(var y in f)r[y]=f[y];r.serial=e.serial||'';r.note=e.note||'';r._del=!!e.del;r._new=!!e.isNew;r._edited=true}
 r.fy=fyOf(r.date)||(e&&e.f&&('date' in e.f)?'':base.fy);r.retired=(r.status==='จำหน่ายแล้ว'||r.status==='เลิกใช้งาน')?1:0;return r}
function allRows(){var out=BASE.map(function(b){return eff(b,EDIT?store.edits[b.k]:null)});
 if(EDIT){Object.keys(store.edits).forEach(function(k){var e=store.edits[k];if(e.isNew){var b=emptyBase();b.k=k;b.status='';var r=eff(b,e);out.push(r)}})}return out}
function editCount(){return Object.keys(store.edits).length}
// ---- UI setup ----
var sortKey='tag',sortDir=1,view=localStorage.getItem(LS_VIEW)==='table'?'table':'grid';
var SORTS=[['tag','เลขครุภัณฑ์'],['name','ชื่อรายการ'],['fy','ปีงบประมาณ'],['loc','สถานที่']];
SORTS.forEach(function(s){[1,-1].forEach(function(d){var o=document.createElement('option');o.value=s[0]+':'+d;o.textContent=s[1]+(d>0?' ▲ (น้อย→มาก)':' ▼ (มาก→น้อย)');$('sortm').appendChild(o)})});
$('sortm').value='tag:1';
$('sortm').onchange=function(){var p=this.value.split(':');sortKey=p[0];sortDir=+p[1];render()};
function uniq(rows,k){var s={};rows.forEach(function(r){if(r[k]!==''&&r[k]!=null)s[r[k]]=1});return Object.keys(s).sort(function(a,b){return a.localeCompare(b,'th',{numeric:true})})}
function refill(sel,vals,first){var cur=sel.value;sel.innerHTML='';var o=document.createElement('option');o.value='';o.textContent=first;sel.appendChild(o);vals.forEach(function(v){var o=document.createElement('option');o.value=o.textContent=v;sel.appendChild(o)});sel.value=vals.indexOf(cur)>=0?cur:''}
function refillFilters(rows){refill($('fs'),uniq(rows,'status'),'ทุกสถานะ');refill($('ft'),uniq(rows,'type'),'ทุกประเภท');refill($('fy'),uniq(rows,'fy').reverse(),'ทุกปีงบประมาณ')}
var COLS=[['tag','เลขครุภัณฑ์'],['b','เลข B'],['name','รายการ'],['type','ประเภท'],['date','วันที่ได้มา'],['fy','ปีงบ'],['qty','จำนวน'],['loc','ห้อง/สถานที่'],['status','สถานะ']];
COLS.forEach(function(c){var th=document.createElement('th');th.textContent=c[1];th.dataset.k=c[0];th.onclick=function(){sortDir=(sortKey===c[0])?-sortDir:1;sortKey=c[0];var v=c[0]+':'+sortDir;$('sortm').value=v;render()};$('hr').appendChild(th)});
if(EDIT){var th=document.createElement('th');th.className='edit-only';th.textContent='';$('hr').appendChild(th)}
function setView(v){view=v;localStorage.setItem(LS_VIEW,v);$('vgrid').className=v==='grid'?'toggle-active':'';$('vtable').className=v==='table'?'toggle-active':'';$('grid').hidden=v!=='grid';$('tablewrap').hidden=v!=='table';render()}
$('vgrid').onclick=function(){setView('grid')};$('vtable').onclick=function(){setView('table')};
function dkey(s){var m=/^(\d+)\/(\d+)\/(\d+)$/.exec(s||'');return m?(+m[3])*10000+(+m[2])*100+(+m[1]):-1}
function cmp(a,b){var x=a[sortKey],y=b[sortKey];if(sortKey==='date'){x=dkey(x);y=dkey(y)}
 if(x===''||x==null||x===-1)return 1;if(y===''||y==null||y===-1)return -1;
 if(typeof x==='number'&&typeof y==='number')return (x-y)*sortDir;
 var c=String(x).localeCompare(String(y),'th',{numeric:true})*sortDir;return c||String(a.tag).localeCompare(String(b.tag),'th',{numeric:true})}
function stClass(s){return s==='ใช้งานได้'?'ok':s==='ชำรุด'?'bad':s==='จำหน่ายแล้ว'?'ret':s==='เลิกใช้งาน'?'off':'ret'}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function tagEl(tag,cls,text){var e=el(tag,cls);String(text).split(/(?<=[.\-\/])|(?=\()/).forEach(function(part,i){if(i)e.appendChild(document.createElement('wbr'));e.appendChild(document.createTextNode(part))});return e}
function badge(cls,text){return el('span','badge '+cls,text)}
function card(r){var t=el('div','cx-tile'+(r._edited?' is-edited':'')+(r._del?' is-del':'')+(r._new?' is-new':''));t.dataset.k=r.k;
 cardPhoto(t,r);
 var top=el('div','cx-top');var tw=el('div');tw.style.minWidth='0';tw.appendChild(tagEl('div','cx-tag',r.tag||'—'));if(r.tag2)tw.appendChild(el('div','cx-tag2','เลขอื่น: '+r.tag2));top.appendChild(tw);
 var bs=el('div','cx-badges');if(r._new)bs.appendChild(badge('new','ใหม่'));else if(r._edited)bs.appendChild(badge('edited','แก้แล้ว'));if(r._del)bs.appendChild(badge('del','รอลบ'));top.appendChild(bs);t.appendChild(top);
 t.appendChild(el('div','cx-name',r.name||'(ไม่มีชื่อรายการ)'));
 t.appendChild(el('div','cx-set',r.b||'— ไม่มีเลข B'));
 var s1=el('div','cx-sub',r.type||'—');t.appendChild(s1);
 var s2=el('div','cx-sub');s2.appendChild(document.createTextNode('ห้อง '));s2.appendChild(el('b',null,r.loc||'—'));t.appendChild(s2);
 var s3=el('div','cx-sub');s3.appendChild(document.createTextNode('ได้มา '+(r.date||'—')+' · ปีงบ '));s3.appendChild(el('b',null,r.fy||'—'));t.appendChild(s3);
 if(r.serial)t.appendChild(el('div','cx-sub','S/N '+r.serial));
 if(r.note&&EDIT)t.appendChild(el('div','cx-note','✎ '+r.note));
 var bot=el('div','cx-bottom');bot.appendChild(badge(stClass(r.status),r.status||'ไม่ระบุ'));
 if(EDIT){var eb=el('button','cx-edit edit-only','แก้ไข');eb.onclick=function(){openEdit(r.k)};bot.appendChild(eb)}
 t.appendChild(bot);return t}
function td(tr,label,cls,text){var c=el('td',cls,text);c.dataset.l=label;tr.appendChild(c);return c}
function trow(r){var tr=el('tr',(r._edited?'is-edited':'')+(r._del?' is-del':''));
 var c=td(tr,'เลขครุภัณฑ์');c.appendChild(el('span','ttag',r.tag||'—'));if(r._new)c.appendChild(document.createTextNode(' '))&&c.appendChild(badge('new','ใหม่'));else if(r._edited){c.appendChild(document.createTextNode(' '));c.appendChild(badge('edited','แก้แล้ว'))}
 if(r._del){c.appendChild(document.createTextNode(' '));c.appendChild(badge('del','รอลบ'))}
 if(EDIT&&PH[r.k]&&PH[r.k].length){var pb=badge('edited','📷 '+PH[r.k].length);pb.style.cursor='zoom-in';pb.onclick=function(){lbShow(fullList(PH[r.k]),0)};c.appendChild(document.createTextNode(' '));c.appendChild(pb)}
 td(tr,'เลข B','mono',r.b||'—');td(tr,'รายการ','',r.name);td(tr,'ประเภท','muted',r.type);td(tr,'วันที่ได้มา','mono',r.date||'—');td(tr,'ปีงบ','mono',r.fy||'—');td(tr,'จำนวน','mono',r.qty===''?'—':r.qty);td(tr,'ห้อง/สถานที่','mono',r.loc||'—');
 var sc=td(tr,'สถานะ');sc.appendChild(badge(stClass(r.status),r.status||'ไม่ระบุ'));
 if(EDIT){var ec=el('td','edit-only');var eb=el('button','cx-edit','แก้ไข');eb.onclick=function(){openEdit(r.k)};ec.appendChild(eb);tr.appendChild(ec)}
 return tr}
var LIMIT_STEP=200,limit=LIMIT_STEP;
function render(){
 var all=allRows();refillFilters(all);
 var q=$('q').value.trim().toLowerCase(),fs=$('fs').value,ft=$('ft').value,fy=$('fy').value,fe=EDIT?$('fe').value:'';
 var rows=all.filter(function(r){
  if(fs&&r.status!==fs)return false;if(ft&&r.type!==ft)return false;if(fy&&r.fy!==fy)return false;
  if(fe==='edited'&&!r._edited)return false;if(fe==='del'&&!r._del)return false;if(fe==='new'&&!r._new)return false;if(fe==='ph'&&!(PH[r.k]&&PH[r.k].length))return false;
  if(!q)return true;var hay=[r.tag,r.tag2,r.b,r.name,r.loc,r.type,r.serial,r.note].join(' ').toLowerCase();
  return hay.replace(/\s+/g,' ').indexOf(q)>=0||hay.replace(/\s+/g,'').indexOf(q.replace(/\s+/g,''))>=0});
 rows.sort(cmp);
 document.querySelectorAll('#hr th').forEach(function(th){th.className=(th.className.indexOf('edit-only')>=0?'edit-only ':'')+(th.dataset.k===sortKey?(sortDir>0?'asc':'desc'):'')});
 var f=document.createDocumentFragment();
 if(view==='grid'){rows.forEach(function(r){f.appendChild(card(r))});$('grid').replaceChildren(f)}
 else{rows.forEach(function(r){f.appendChild(trow(r))});$('tb').replaceChildren(f)}
 $('empty').hidden=rows.length>0;
 var cnt=function(st){return rows.filter(function(r){return r.status===st}).length};
 var st=$('stats');st.innerHTML='';[['แสดง',rows.length+' / '+all.length],['ใช้งานได้',cnt('ใช้งานได้')],['ชำรุด',cnt('ชำรุด')],['จำหน่ายแล้ว',cnt('จำหน่ายแล้ว')],['เลิกใช้งาน',cnt('เลิกใช้งาน')]].forEach(function(x){if(x[0]==='เลิกใช้งาน'&&!x[1])return;var e=el('span','chip',x[0]+' ');e.appendChild(el('b',null,String(x[1])));st.appendChild(e)});
 if(EDIT){var n=editCount(),pc=photoKeys().length,n2=n+photoOnlyKeys().length;$('ecount').textContent=n+' รายการที่แก้'+(pc?' · 📷 '+pc+' รายการมีรูป':'');$('ecount').className='chip'+(n2?' has':'');['bexpj','bexpc','bclr'].forEach(function(id){$(id).disabled=!n2})}
}
['q','fs','ft','fy'].forEach(function(id){$(id).addEventListener('input',render)});
// ---- toast ----
var tt;function toast(m){var t=$('toast');t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(function(){t.hidden=true},2600)}
if(EDIT){
 $('fe').addEventListener('input',render);
 function setMode(on){document.body.classList.toggle('editing',on);$('bmode').className=on?'primary':'teal';$('bmode').textContent=on?'✎ โหมดแก้ไข: เปิด':'✎ โหมดแก้ไข';localStorage.setItem(LS_MODE,on?'1':'0')}
 $('bmode').onclick=function(){setMode(!document.body.classList.contains('editing'))};
 setMode(localStorage.getItem(LS_MODE)==='1');
 // ---- modal ----
 var curK=null;
 var stSel=$('m_status');STATUSES.forEach(function(s){var o=document.createElement('option');o.value=o.textContent=s;stSel.appendChild(o)});
 var dl=$('dl_type');uniq(BASE,'type').forEach(function(v){var o=document.createElement('option');o.value=v;dl.appendChild(o)});
 var dl2=$('dl_loc');uniq(BASE,'loc').forEach(function(v){var o=document.createElement('option');o.value=v;dl2.appendChild(o)});
 function baseOf(k){return baseByK[k]||(function(){var b=emptyBase();b.k=k;b.status='';return b})()}
 window.openEdit=openEdit;
 function openEdit(k,isNew){curK=k;var e=store.edits[k];var b=baseOf(k);var r=eff(b,e);
  var nw=isNew||(e&&e.isNew);
  $('m_title').textContent=nw?'เพิ่มรายการใหม่':'แก้ไขรายการ';
  $('m_key').textContent='key: '+k+(b.b?' · B เดิม: '+b.b:'')+(b.tag?' · เลขเดิม: '+b.tag:'');
  EDITABLE.concat(['serial','note']).forEach(function(f){var inp=$('m_'+f);inp.value=r[f]==null?'':r[f];if(f==='status'&&!inp.value)inp.value='ใช้งานได้';
   var lab=inp.closest('label');var was=lab.querySelector('.was');var bv=(f==='serial'||f==='note')?'':String(b[f]==null?'':b[f]);
   if(!nw&&f!=='serial'&&f!=='note'&&String(inp.value)!==bv){lab.classList.add('changed');was.textContent='เดิม: '+(bv||'(ว่าง)')}else{lab.classList.remove('changed');was.textContent=''}});
  $('m_del').textContent=(e&&e.del)?'ยกเลิกเครื่องหมายลบ':'ทำเครื่องหมายลบ';
  $('m_revert').hidden=!e;$('m_revert').textContent=nw?'ลบรายการใหม่นี้':'คืนค่าเดิม';
  mPhotosOpen(k);
  $('modal').hidden=false;$('modal').querySelector('.modal').scrollTop=0}
 function closeM(){$('modal').hidden=true;curK=null;mPh=null}
 $('m_cancel').onclick=closeM;$('modal').addEventListener('click',function(ev){if(ev.target===this)closeM()});
 document.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&!$('modal').hidden)closeM()});
 function collect(keepDel){var k=curK,b=baseOf(k),old=store.edits[k],nw=!baseByK[k];var e={f:{},serial:$('m_serial').value.trim(),note:$('m_note').value.trim(),del:old?!!old.del:false,isNew:nw,t:new Date().toISOString()};
  if(keepDel!=null)e.del=keepDel;
  EDITABLE.forEach(function(f){var v=$('m_'+f).value.replace(/\s+/g,' ').trim();if(f==='loc'||f==='b'||f==='tag'||f==='tag2')v=v.replace(/\s+/g,'');if(f==='b')v=v.toUpperCase();
   if(nw){if(v)e.f[f]=v}else if(v!==String(b[f]==null?'':b[f]))e.f[f]=v});
  var changed=nw||Object.keys(e.f).length||e.serial||e.note||e.del;
  if(changed)store.edits[k]=e;else delete store.edits[k];commitPhotos(k);save()}
 $('mform').onsubmit=function(ev){ev.preventDefault();if(phBusy){toast('กำลังย่อรูป รอสักครู่…');return}if(!baseByK[curK]&&!$('m_tag').value.trim()&&!$('m_name').value.trim()){toast('รายการใหม่ต้องมีเลขครุภัณฑ์หรือชื่อรายการ');return}collect(null);closeM();render();toast('บันทึกการแก้ไขในเครื่องนี้แล้ว')};
 $('m_del').onclick=function(){if(phBusy){toast('กำลังย่อรูป รอสักครู่…');return}var old=store.edits[curK];collect(!(old&&old.del));closeM();render();toast(store.edits[curK]&&store.edits[curK].del?'ทำเครื่องหมายลบแล้ว (ยังไม่ลบจริง)':'ยกเลิกเครื่องหมายลบแล้ว')};
 $('m_revert').onclick=function(){if(!confirm('ยกเลิกการแก้ไขของรายการนี้ทั้งหมด?'))return;if(!baseByK[curK])setPhotos(curK,[]);delete store.edits[curK];save();closeM();render();toast('คืนค่าเดิมแล้ว')};
 $('badd').onclick=function(){var k='n'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);openEdit(k,true)};
 $('bclr').onclick=function(){var n=editCount(),np=photoKeys().length;if(!n&&!np)return;if(!confirm('ล้างการแก้ไขทั้งหมด '+n+' รายการ'+(np?' และรูปภาพของ '+np+' รายการ':'')+' ในเครื่องนี้?\nแนะนำให้ส่งออกไฟล์เก็บไว้ก่อน — ล้างแล้วกู้คืนไม่ได้'))return;store={v:1,edits:{}};save();clearPhotos();render();toast('ล้างการแก้ไขแล้ว')};
 // ---- photos in edit form ----
 var mPh=null;
 function mPhotosOpen(k){mPh=(PH[k]||[]).slice();mPhRender()}
 function mPhRender(){var box=$('m_ph');box.replaceChildren();(mPh||[]).forEach(function(p,i){var w=el('div','phit');var im=document.createElement('img');im.src=p.th||p.d;im.alt='';im.onclick=function(){lbShow(fullList(mPh),i)};
   var x=el('button','phdel','✕');x.type='button';x.title='ลบรูปนี้';x.onclick=function(){mPh.splice(i,1);mPhRender()};w.appendChild(im);w.appendChild(x);box.appendChild(w)});
  var n=(mPh||[]).length;$('m_phn').textContent=phBusy?'(กำลังย่อรูป…)':n?'('+n+'/'+MAXPH+')':'(ยังไม่มีรูป)';$('m_bcam').disabled=$('m_bpick').disabled=n>=MAXPH||!!phBusy}
 function mAddFiles(fl){var files=Array.prototype.slice.call(fl||[]).filter(function(f){return !f.type||f.type.indexOf('image/')===0});if(!files.length||!mPh)return;var room=MAXPH-mPh.length;
  if(files.length>room){toast('เพิ่มได้อีก '+room+' รูป (สูงสุด '+MAXPH+' รูป/รายการ)');files=files.slice(0,room)}if(!files.length)return;
  var k0=curK,list=mPh;phBusy++;mPhRender();
  files.reduce(function(p,f){return p.then(function(){return makePhoto(f).then(function(o){list.push(o)},function(e){toast(e.message)})})},Promise.resolve())
   .then(function(){phBusy--;if(curK===k0&&mPh===list)mPhRender()})}
 $('m_bcam').onclick=function(){$('m_cam').value='';$('m_cam').click()};
 $('m_bpick').onclick=function(){$('m_pick').value='';$('m_pick').click()};
 $('m_cam').onchange=function(){mAddFiles(this.files)};$('m_pick').onchange=function(){mAddFiles(this.files)};
 function commitPhotos(k){if(!mPh)return;var old=PH[k]||[];if(old.length===mPh.length&&old.every(function(p,i){return p===mPh[i]}))return;setPhotos(k,mPh)}
 // ---- export ----
 function allKeys(){var s={};Object.keys(store.edits).concat(photoKeys()).forEach(function(k){s[k]=1});return Object.keys(s)}
 function items(withPh){return allKeys().sort().map(function(k){var e=store.edits[k]||{f:{},photoOnly:1},b=baseOf(k),nw=!!e.isNew||!baseByK[k];var ch={};
  EDITABLE.forEach(function(f){if(e.f&&(f in e.f))ch[f]={before:nw?'':String(b[f]==null?'':b[f]),after:e.f[f]}});
  if(e.serial)ch.serial={before:'',after:e.serial};
  return {key:k,origB:nw?'':b.b,origTag:nw?'':b.tag,action:nw?'add':(e.del?'delete':(e.photoOnly?'photo':'edit')),markedDelete:!!e.del,changes:ch,note:e.note||'',updatedAt:e.t||PHT[k]||'',photoCount:(PH[k]||[]).length,photos:withPh?fullList(PH[k]):undefined}})}
 function stamp(){var d=new Date(),p=function(n){return (n<10?'0':'')+n};return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())}
 function dl3(name,text,type){var blob=new Blob([text],{type:type});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500)}
 $('bexpj').onclick=function(){var its=items(true);var doc={format:'ru-asset-edits',version:1,exportedAt:new Date().toISOString(),dataAsOf:CFG.asOf,builtAt:CFG.built,count:its.length,photoItems:photoKeys().length,items:its};dl3('ru-asset-edits-'+stamp()+'.json',JSON.stringify(doc,null,2),'application/json');toast('ส่งออก JSON แล้ว'+(photoKeys().length?' (รวมรูป)':''))};
 function csvq(v){v=String(v==null?'':v);return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
 $('bexpc').onclick=function(){var L=[['key','origB','origTag','action','field','fieldLabel','before','after','note','updatedAt','photoCount']];
  items().forEach(function(it){var fs=Object.keys(it.changes);if(!fs.length)L.push([it.key,it.origB,it.origTag,it.action,'','','','',it.note,it.updatedAt,it.photoCount]);
   fs.forEach(function(f){L.push([it.key,it.origB,it.origTag,it.action,f,FLABEL[f]||f,it.changes[f].before,it.changes[f].after,it.note,it.updatedAt,it.photoCount])})});
  dl3('ru-asset-edits-'+stamp()+'.csv','\uFEFF'+L.map(function(r){return r.map(csvq).join(',')}).join('\r\n')+'\r\n','text/csv;charset=utf-8');toast('ส่งออก CSV แล้ว')};
 // ---- import ----
 $('bimp').onclick=function(){$('fimp').value='';$('fimp').click()};
 $('fimp').onchange=function(){var file=this.files&&this.files[0];if(!file)return;var rd=new FileReader();rd.onload=function(){try{var doc=JSON.parse(String(rd.result).replace(/^\uFEFF/,''));importDoc(doc)}catch(e){alert('อ่านไฟล์ไม่ได้: '+e.message)}};rd.readAsText(file,'utf-8')};
 function importDoc(doc){if(!doc||doc.format!=='ru-asset-edits'||!Array.isArray(doc.items))throw new Error('ไม่ใช่ไฟล์การแก้ไขของหน้านี้');
  var add=0,upd=0,skip=0,unk=0,nph=0,jobs=[];
  doc.items.forEach(function(it){var k=String(it.key||'');if(!k){skip++;return}var isNew=it.action==='add'||!baseByK[k];
   if(!isNew&&!baseByK[k]){unk++;return}if(it.action!=='add'&&!baseByK[k]){unk++;return}
   if(Array.isArray(it.photos)){var pl=it.photos.filter(isImgUrl).slice(0,MAXPH);if(pl.length){nph++;jobs.push(Promise.all(pl.map(photoFromUrl)).then(function(L){return setPhotos(k,L)}))}}
   if(it.action==='photo')return;
   var e={f:{},serial:'',note:String(it.note||''),del:!!it.markedDelete||it.action==='delete',isNew:isNew,t:String(it.updatedAt||doc.exportedAt||'')};
   var ch=it.changes||{};Object.keys(ch).forEach(function(f){var a=ch[f]&&ch[f].after;if(a==null)return;if(f==='serial')e.serial=String(a);else if(EDITABLE.indexOf(f)>=0)e.f[f]=String(a)});
   var old=store.edits[k];if(old&&old.t&&e.t&&old.t>e.t){skip++;return}
   if(old)upd++;else add++;store.edits[k]=e});
  save();render();Promise.all(jobs).then(function(){render();alert('นำเข้าแล้ว: ใหม่ '+add+' · ทับของเดิม '+upd+' · ข้าม (ในเครื่องใหม่กว่า) '+skip+(unk?' · ไม่พบ key '+unk:'')+(nph?' · รูปภาพ '+nph+' รายการ':''))})}
}
setView(view);
if(EDIT)phLoad().then(render);
})();
`;

const editUI = READONLY ? '' : `
  <div class="row" style="margin-top:.6rem">
   <button id="bmode" class="teal" type="button">✎ โหมดแก้ไข</button>
   <span id="ecount" class="chip">0 รายการที่แก้</span>
   <span class="edit-only" style="gap:.5rem;flex-wrap:wrap;align-items:center">
    <button id="badd" class="primary" type="button">+ เพิ่มรายการ</button>
    <select id="fe"><option value="">ทุกรายการ</option><option value="edited">เฉพาะที่แก้</option><option value="new">เฉพาะที่เพิ่มใหม่</option><option value="del">เฉพาะที่ทำเครื่องหมายลบ</option><option value="ph">เฉพาะที่มีรูป</option></select>
   </span>
   <span style="display:inline-flex;gap:.5rem;flex-wrap:wrap">
    <button id="bexpj" type="button">ส่งออกการแก้ไข (JSON)</button>
    <button id="bexpc" type="button">ส่งออกการแก้ไข (CSV)</button>
    <button id="bimp" type="button">นำเข้าไฟล์การแก้ไข</button>
    <button id="bclr" class="danger" type="button">ล้างการแก้ไข</button>
    <input id="fimp" type="file" accept=".json,application/json" hidden>
   </span>
  </div>
  <div class="editnote">⚠ การแก้ไขบันทึกไว้ <b>เฉพาะในเครื่อง/เบราว์เซอร์นี้</b> เท่านั้น ยังไม่เข้าฐานข้อมูล — กด “ส่งออกการแก้ไข” เพื่อเก็บเป็นไฟล์ แล้ว “นำเข้าไฟล์การแก้ไข” ในอีกเครื่อง (มือถือ ↔ PC) ได้ · <b>รูปภาพ</b>ก็เก็บเฉพาะในเบราว์เซอร์นี้เช่นกัน (ส่งออก JSON จะรวมรูปไปด้วย) · ถ้าล้างข้อมูลเบราว์เซอร์ การแก้ไขและรูปจะหาย</div>`;

const modal = READONLY ? '' : `
<div id="modal" class="modal-backdrop" hidden><div class="modal" role="dialog" aria-modal="true" aria-labelledby="m_title">
 <form id="mform" autocomplete="off">
  <h2 id="m_title">แก้ไขรายการ</h2><div class="key" id="m_key"></div>
  <div class="grid2">
   <label>เลขครุภัณฑ์<input id="m_tag"><span class="was"></span></label>
   <label>เลขครุภัณฑ์อื่น (ถ้ามี)<input id="m_tag2"><span class="was"></span></label>
   <label>เลข B (บาร์โค้ด)<input id="m_b" placeholder="B…"><span class="was"></span></label>
   <label>สถานะ<select id="m_status"></select><span class="was"></span></label>
   <label class="full">รายการ<input id="m_name"><span class="was"></span></label>
   <label>ประเภท<input id="m_type" list="dl_type"><span class="was"></span></label>
   <label>ห้อง/สถานที่<input id="m_loc" list="dl_loc"><span class="was"></span></label>
   <label>วันที่ได้มา (ว/ด/ปี พ.ศ.)<input id="m_date" placeholder="เช่น 22/10/2556" inputmode="numeric"><span class="was"></span></label>
   <label>Serial number (ไม่บังคับ)<input id="m_serial"><span class="was"></span></label>
   <label class="full">หมายเหตุการแก้<textarea id="m_note" placeholder="เช่น ตรวจนับแล้ว ย้ายห้อง ฯลฯ"></textarea><span class="was"></span></label>
  </div>
  <div class="phbox"><div class="phhead">รูปภาพ <span id="m_phn"></span></div><div id="m_ph" class="phlist"></div><div class="phbtns"><button type="button" id="m_bcam" class="teal">📷 ถ่ายรูป</button><button type="button" id="m_bpick">🖼 เลือกรูปจากเครื่อง</button><input id="m_cam" type="file" accept="image/*" capture="environment" hidden><input id="m_pick" type="file" accept="image/*" multiple hidden></div><div class="phhint">สูงสุด 6 รูป/รายการ · ย่อขนาดอัตโนมัติ (ด้านยาวไม่เกิน 1280px) · แตะรูปเพื่อดูใหญ่ · กด ✕ เพื่อลบ · รูปบันทึกเมื่อกด “บันทึก”</div></div>
  <datalist id="dl_type"></datalist><datalist id="dl_loc"></datalist>
  <div class="acts">
   <div><button type="button" id="m_del" class="danger">ทำเครื่องหมายลบ</button><button type="button" id="m_revert">คืนค่าเดิม</button></div>
   <div><button type="button" id="m_cancel">ยกเลิก</button><button type="submit" class="primary">บันทึก</button></div>
  </div>
 </form>
</div></div>`;

const title = READONLY ? 'ทะเบียนครุภัณฑ์ (อ่านอย่างเดียว)' : 'ทะเบียนครุภัณฑ์ (แก้ไขได้)';
const html = `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>${CSS}</style></head><body>
<header class="topbar"><div><h1>${READONLY ? 'ทะเบียนครุภัณฑ์ — มุมมองอ่านอย่างเดียว' : 'ทะเบียนครุภัณฑ์'}</h1>
 <div class="sub">ข้อมูล ณ ${asOf} น. · ไม่แสดงชื่อผู้ใช้งานและข้อมูลราคา</div></div>
 <span class="sp"></span>
 <div class="view-toggle"><button id="vgrid" type="button">การ์ด</button><button id="vtable" type="button">ตาราง</button></div>
</header>
<div class="main">
 <section class="panel">
  <div class="row">
   <input id="q" type="search" placeholder="ค้นหา เลขครุภัณฑ์ / เลข B / ชื่อ / ห้อง…" autocomplete="off">
   <select id="fs"><option value="">ทุกสถานะ</option></select>
   <select id="ft"><option value="">ทุกประเภท</option></select>
   <select id="fy"><option value="">ทุกปีงบประมาณ</option></select>
   <select id="sortm" aria-label="เรียงตาม"></select>
  </div>
  <div class="row" id="stats"></div>${editUI}
 </section>
 <div id="grid" class="card-grid"></div>
 <div id="tablewrap" hidden><table class="data"><thead><tr id="hr"></tr></thead><tbody id="tb"></tbody></table></div>
 <div id="empty" class="empty" hidden>ไม่พบรายการ</div>
</div>
<footer>ปีงบประมาณคำนวณจากวันที่ได้มา (ต.ค.–ก.ย.) · หน้านี้เป็นสำเนาแบบคงที่ ไม่เชื่อมต่อฐานข้อมูล${READONLY ? '' : ' · การแก้ไขเก็บในเบราว์เซอร์นี้จนกว่าจะส่งออก'}</footer>${modal}
<div id="toast" hidden></div>
<script id="cfg" type="application/json">${cfg.replace(/</g, '\\u003c')}</script>
<script id="data" type="application/json">${json}</script>
<script>${JS}</script></body></html>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(`OK: ${rows.length} rows -> ${outPath} (${READONLY ? 'READ-ONLY' : 'EDITABLE'})`);
console.log(`ข้อมูล ณ ${asOf}`);
