// export-pages.mjs — สร้างหน้าเว็บ RU Asset Database (GitHub Pages) จากฐานข้อมูล
// ใช้:  node --no-warnings scripts\export-pages.mjs [--db <path>] [--out <path>] [--readonly] [--site-url <url>]
//   ค่าเริ่มต้น  = เวอร์ชัน "แก้ไขได้": เพิ่ม/แก้ไข/ทำเครื่องหมายลบ/รูป บันทึกในเบราว์เซอร์ (localStorage + IndexedDB) + ส่งออก/นำเข้า JSON/CSV
//   --readonly  = เวอร์ชันล็อก อ่านอย่างเดียว (ไม่มีปุ่มเพิ่ม/แก้ไข/ลบ; ยังเลือก/พิมพ์สติกเกอร์/Export CSV ที่เลือก/หน้า item ได้)
// ค่าเริ่มต้น: --db  <project>\server\data\finance_assets.db
//              --out <project>\pages-export\index.html
// ฟิลด์ทั้งหมดตั้งค่าที่ scripts\asset-fields.json (ที่เดียว)
// หน้าตา: ใช้ CSS ของโปรแกรม RU Asset Database (scripts\vendor\ra-base.css + ra-assets.css) แบบคัดลอกตรง
// เปิดฐานข้อมูลแบบ readOnly เท่านั้น — ไม่แก้ไขข้อมูลใด ๆ
// ความเป็นส่วนตัว: อ่านเฉพาะคอลัมน์ที่ asset-fields.json ระบุ (+ id/condition/disposal_date) — คอลัมน์ชื่อบุคคล/ราคา/ค่าเสื่อม/หมายเหตุ/รูป ถูกห้าม
//   และตรวจซ้ำผลลัพธ์: ต้องไม่มี 'นาย' 'นาง' 'บาท' และชื่อคอลัมน์ต้องห้าม
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..');
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const dbPath = resolve(arg('--db', join(project, 'server', 'data', 'finance_assets.db')));
const outPath = resolve(arg('--out', join(project, 'pages-export', 'index.html')));
const READONLY = argv.includes('--readonly');
// --unassigned <json>: list of keys whose hidden assignee field is empty (flag only; no names ever enter this page)
const UA = arg('--unassigned', '') ? new Set(JSON.parse(readFileSync(resolve(arg('--unassigned', '')), 'utf8'))) : null;
const CONF = JSON.parse(readFileSync(join(here, 'asset-fields.json'), 'utf8'));
if (arg('--site-url')) CONF.siteUrl = arg('--site-url');
const vendor = (f) => readFileSync(join(here, 'vendor', f), 'utf8');

// ---------- privacy gate on columns ----------
const DENY = /^(user_name|user_note|unit_price|total_value|net_value|yearly_depreciation.*|accumulated_depreciation|remarks|extra_notes|image_url|source_tab|source_tabs|appsheet_row|no3_row|match_method|imported_at|created_at|updated_at|acquire_method|useful_life|batch_info)$/i;
const db = new DatabaseSync(dbPath, { readOnly: true });
const have = new Set(db.prepare('PRAGMA table_info(finance_assets)').all().map((c) => c.name));
const wanted = ['id', 'condition', 'disposal_date', ...CONF.fields.filter((f) => f.column).map((f) => f.column)];
for (const c of wanted) if (DENY.test(c)) throw new Error(`Privacy gate: column '${c}' is not allowed online`);
const cols = [...new Set(wanted)].filter((c) => have.has(c));
const raw = db.prepare(`SELECT ${cols.join(', ')} FROM finance_assets ORDER BY id`).all();
db.close();

const clean = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s === '-' ? '' : s; };
function budgetYear(d) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean(d)); if (!m) return ''; return String(+m[2] >= 10 ? +m[3] + 1 : +m[3]); }
function status(r) {
  if (clean(r.disposal_date)) return 'จำหน่ายแล้ว';
  const c = clean(r.condition).replace(/ุุ/g, 'ุ').replace(/\s+/g, '');
  if (c.includes('ชำรุด')) return 'ชำรุด';
  if (c.includes('ใช้งานได้')) return 'ใช้งานได้';
  return c || 'ไม่ระบุ';
}
// per-field normalisers (key -> fn(raw value, row))
const NORM = {
  tag: (v) => clean(v),
  tag2: (v, r) => (clean(v) !== clean(r.asset_no) ? clean(v) : ''),
  b: (v) => (clean(v).match(/B\d{6,}/i) || [''])[0].toUpperCase(),
  name: (v) => clean(v).replace(/^"+|"+$/g, ''),
  type: (v) => clean(v).replace(/^ประเภท/, ''),
  loc: (v) => clean(v).replace(/\s+/g, ''),
  qty: (v) => (v == null || v === '' ? '' : Number(v)),
};
const rows = raw.map((r) => {
  const o = { k: 'r' + Number(r.id) };
  for (const f of CONF.fields) {
    if (!f.column) continue;
    const v = have.has(f.column) ? r[f.column] : '';
    o[f.key] = (NORM[f.key] || clean)(v, r);
  }
  o.fy = budgetYear(o.date);
  o.status = status(r);
  if (UA) o.ua = UA.has(o.k) ? 1 : 0;
  for (const k of Object.keys(o)) if (o[k] === '' && k !== 'k') delete o[k]; // compact
  return o;
});

const now = new Date();
const asOf = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(now);
const esc = (s) => s.replace(/</g, '\\u003c');
// รูปที่แสดงบนเว็บสำหรับทุกคน: scripts/asset-photos.json + โฟลเดอร์ images/ (ย่อแล้ว ไม่มี EXIF)
const SP = CONF.sitePhotos || {};
const sitePhotos = {};
if (SP.config && existsSync(join(here, SP.config))) {
  const pj = JSON.parse(readFileSync(join(here, SP.config), 'utf8'));
  const keys = new Set(rows.map((r) => r.k));
  const seenFiles = new Set();
  // RULE 3: รูปเครื่อง LQ-590 ต้องแยกไว้ (บันทึกที่อื่น) ห้ามใส่รูป
  const lqKeys = new Set(rows.filter((r) => /LQ\s*-?\s*590/i.test(r.name || '')).map((r) => r.k));
  // RULE 2: ชุดที่แยกเลข (1)/(2) (เช่น จอ+CPU) ใส่รูปเฉพาะแถว (1) เท่านั้น แถว (2) ห้ามมีรูป
  const pairBase = (t) => String(t || '').replace(/\s*\((\d+)\)\s*$/, '');
  const ones = new Set(rows.filter((r) => /\(1\)\s*$/.test(r.tag || '')).map((r) => pairBase(r.tag)));
  const twoKeys = new Map(rows.filter((r) => /\(2\)\s*$/.test(r.tag || '') && ones.has(pairBase(r.tag))).map((r) => [r.k, r.tag]));
  for (const p of pj.photos || []) {
    if (!/^[A-Za-z0-9._-]+\.jpg$/.test(p.file)) throw new Error('bad photo file name: ' + p.file);
    for (const f of [join(project, SP.dir, p.file), join(project, SP.thumbDir, p.file)]) if (!existsSync(f)) throw new Error('missing photo file: ' + f);
    const isReg = p.kind === 'register'; if (!Array.isArray(p.keys) || p.keys.length < 1 || (!isReg && !(p.file === 'r252.jpg' && p.multiUserOrdered === '1WgeG3qBhJw_Md0-ModdfWityNSkx1Bsz' && p.keys.length === 2) && p.keys.length !== 1)) throw new Error('RULE 1 photo = 1 asset: ' + p.file + ' is mapped to ' + (p.keys||[]).length + ' keys'); if (seenFiles.has(p.file)) throw new Error('RULE 1 photo = 1 asset: duplicate file ' + p.file); seenFiles.add(p.file);
    for (const k of p.keys) { if (!keys.has(k)) throw new Error('photo key not in DB: ' + k); if (lqKeys.has(k) && p.kind !== 'register') throw new Error('RULE 3 LQ-590: photos of EPSON LQ-590 rows are set aside, not mapped; ' + k + ' has ' + p.file); if (twoKeys.has(k)) throw new Error('RULE 2 (1)/(2) pair: only the (1) row may have a photo; ' + k + ' ' + twoKeys.get(k) + ' has ' + p.file); if (sitePhotos[k]) throw new Error('two photos for ' + k); sitePhotos[k] = { f: p.file, kind: p.kind || 'tag' }; }
  }
}
console.log('site photos:', Object.keys(sitePhotos).length, 'items');
const cfg = { edit: !READONLY, asOf, built: now.toISOString(), ...CONF, photos: sitePhotos };
delete cfg._comment;
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

// ---------- extra CSS (only what the local app has no class for) ----------
const EXTRA_CSS = String.raw`
.ra-app .main{max-width:none}
.ra-app a.ra-linklike{color:inherit;text-decoration:none}.ra-app a.ra-linklike:hover .ra-name{color:var(--accent)}
.ra-app a.ra-card-name{color:inherit;text-decoration:none}.ra-app a.ra-card-name:hover{color:var(--accent)}
.ra-badges{display:inline-flex;gap:.25rem;flex-wrap:wrap;vertical-align:middle;margin-left:.35rem}
.ra-chip.edited{background:rgba(45,212,191,.18);color:var(--accent)}
.ra-chip.new{background:rgba(167,139,250,.2);color:#c4b5fd}
.ra-chip.del{background:#7f1d1d;color:#fecaca}
.ra-chip.warn{background:rgba(251,191,36,.18);color:var(--warn)}
.ra-card.is-del,.ra-table tr.is-del td{opacity:.6}
.ra-card.is-edited{border-color:var(--accent-deep)}
.ra-card-photo .ra-photo,.ra-card-photo .ra-photo-empty{position:absolute;inset:0;height:100%}
.ra-thumb .ra-photo{width:100%;height:100%}
.ra-editbar{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.ra-editnote{margin-top:.6rem;padding:.55rem .8rem;border-radius:10px;border:1px dashed var(--accent-deep);background:var(--accent-soft);color:#ccfbf1;font-size:.85rem}
.ra-was{font-size:.72rem;color:var(--warn)}
.ra-form-grid label.changed input,.ra-form-grid label.changed select,.ra-form-grid label.changed textarea{border-color:var(--accent)}
.ra-phlist{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center}
.ra-phit{position:relative;width:72px;height:72px;border-radius:8px;overflow:hidden;border:1px solid var(--border)}
.ra-phit .ra-photo{width:100%;height:100%}
.ra-phit button{position:absolute;top:2px;right:2px;width:22px;height:22px;padding:0;border-radius:50%;font-size:.7rem;line-height:1;background:rgba(127,29,29,.9);border-color:#991b1b}
.ra-item{display:grid;grid-template-columns:minmax(220px,340px) 1fr;gap:1.25rem;align-items:start}
.ra-item-photo{aspect-ratio:4/3;border-radius:12px;overflow:hidden;border:1px solid var(--border);background:#0b1016;position:relative}
.ra-item-photo .ra-photo,.ra-item-photo .ra-photo-empty{position:absolute;inset:0;height:100%}
.ra-item-tag{font-family:ui-monospace,'Cascadia Code',monospace;font-weight:800;font-size:1.6rem;line-height:1.15;word-break:break-word;color:#fff}
.ra-item-name{font-size:1.15rem;font-weight:700;margin:.35rem 0 .6rem}
.ra-item-qr{margin-top:.8rem;display:flex;gap:.6rem;align-items:center}
.ra-item-qr .qrbox{width:96px;height:96px;background:#fff;padding:4px;border-radius:6px}
.qrbox svg{width:100%;height:100%;display:block}
.ra-sticker .qrbox{align-self:center;flex-shrink:0}
.ra-sticker-tag.long{white-space:normal;overflow-wrap:anywhere;font-size:1.35em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;text-overflow:clip}
.ra-toast{pointer-events:none;position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--panel);border:1px solid var(--accent);color:#ccfbf1;padding:.5rem .9rem;border-radius:10px;z-index:60;font-size:.85rem;box-shadow:0 6px 20px rgba(0,0,0,.4)}
.ra-toast[hidden],[hidden]{display:none!important}
.ra-count{color:var(--muted);font-weight:400}
@media (max-width:860px){.ra-item{grid-template-columns:1fr}.ra-listbar{position:static}.ra-app .topbar{position:static}}
@media (max-width:600px){.ra-app .main{padding:.75rem .6rem 2rem}.ra-hero h2{font-size:1.2rem}.ra-stat{min-width:0;flex:1 1 40%}.ra-btn.big{padding:.55rem .9rem;font-size:.95rem}
 .ra-table thead{display:none}.ra-table,.ra-table tbody,.ra-table tr,.ra-table td{display:block;width:100%}
 .ra-table tr{border:1px solid var(--border);border-radius:12px;margin-bottom:.6rem;padding:.4rem .6rem;background:var(--panel2)}
 .ra-table td{border:0!important;padding:.2rem 0!important;display:flex;gap:.6rem;align-items:center}.ra-table td[data-l]::before{content:attr(data-l);color:var(--muted);font-size:.75rem;flex:0 0 7.5rem}
 .ra-table td.ra-col-check,.ra-table td.ra-col-photo{display:inline-flex;width:auto}.ra-filters{grid-template-columns:1fr 1fr}.ra-filters .ra-search{grid-column:1/-1}}
@media print{.ra-toast,.ra-editnote{display:none!important}.sticker .qrbox{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

const JS = String.raw`
(function(){
'use strict';
var CFG=JSON.parse(document.getElementById('cfg').textContent);
var BASE=JSON.parse(document.getElementById('data').textContent);
var EDIT=!!CFG.edit;
var FIELDS=CFG.fields, FBY={};FIELDS.forEach(function(f){FBY[f.key]=f});
function fieldsFor(p){return FIELDS.filter(function(f){return f.show.indexOf(p)>=0})}
function labelOf(k){return FBY[k]?FBY[k].label:k}
var EDITABLE=FIELDS.filter(function(f){return f.type!=='image'&&!f.readOnly&&f.key!=='serial'&&f.key!=='note'}).map(function(f){return f.key});
var STATUSES=CFG.status.values;
var LS_KEY='ruAssetView.edits.v1',LS_MODE='ruAssetView.editMode.v2',LS_VIEW='ruAssetView.view.v2',LS_SEL='ruAssetView.sel.v1',LS_STK='ruAssetView.sticker.v1';
var $=function(id){return document.getElementById(id)};
var baseByK={};BASE.forEach(function(r){baseByK[r.k]=r});
function sv(r,k){var v=r[k];return v==null?'':String(v)}
function fyOf(d){var m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d||'');if(!m)return '';return String(+m[2]>=10?+m[3]+1:+m[3])}
function yearOf(d){var m=/(\d{4})\s*$/.exec(d||'');return m?m[1]:''}
function unitOf(r){return sv(r,CFG.unit.sourceField).replace(/\s+/g,'').toUpperCase()}
function lsGet(k,d){try{var v=JSON.parse(localStorage.getItem(k)||'null');return v==null?d:v}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){toast('บันทึกไม่ได้: '+e.message)}}
// ---------- edits store (compatible with v1 files) ----------
var store={v:1,edits:{}};
if(EDIT){var s0=lsGet(LS_KEY,null);if(s0&&s0.v===1&&s0.edits)store=s0}
function save(){lsSet(LS_KEY,store)}
function emptyBase(k){return {k:k,status:''}}
function baseOf(k){return baseByK[k]||emptyBase(k)}
function eff(base,e){var r={};for(var x in base)r[x]=base[x];if(r.serial==null)r.serial='';r.note='';
 if(e){var f=e.f||{};for(var y in f)r[y]=f[y];if(e.serial)r.serial=e.serial;r.note=e.note||'';r._del=!!e.del;r._new=!!e.isNew;r._edited=true}
 r.fy=fyOf(r.date)||((e&&e.f&&('date' in e.f))?'':(base.fy||''));r._unit=unitOf(r);r._ph=PH[r.k]&&PH[r.k].length?1:0;return r}
function allRows(){var out=BASE.map(function(b){return eff(b,EDIT?store.edits[b.k]:null)});
 if(EDIT)Object.keys(store.edits).forEach(function(k){var e=store.edits[k];if(e.isNew&&!baseByK[k])out.push(eff(emptyBase(k),e))});return out}
function rowByK(k){var b=baseByK[k],e=store.edits[k];if(!b&&!(e&&e.isNew))return null;return eff(b||emptyBase(k),e)}
function editCount(){return Object.keys(store.edits).length}
// ---------- photos (IndexedDB, same DB/format as the previous version) ----------
var MAXPH=6,PH={},PHT={},phDB=null,phBusy=0;
function idb(){return new Promise(function(res,rej){if(phDB)return res(phDB);if(!window.indexedDB)return rej(new Error('เบราว์เซอร์นี้ไม่รองรับ IndexedDB'));var q;try{q=indexedDB.open('ruAssetView.photos',1)}catch(e){return rej(e)}
 q.onupgradeneeded=function(){q.result.createObjectStore('photos',{keyPath:'k'})};q.onsuccess=function(){phDB=q.result;res(phDB)};q.onerror=function(){rej(q.error||new Error('IndexedDB'))}})}
function phPut(k){var list=PH[k]||[];return idb().then(function(db){return new Promise(function(res,rej){var tx=db.transaction('photos','readwrite');var os=tx.objectStore('photos');if(list.length)os.put({k:k,list:list,t:PHT[k]||''});else os.delete(k);tx.oncomplete=function(){res()};tx.onerror=tx.onabort=function(){rej(tx.error)}})}).catch(function(e){toast('บันทึกรูปไม่ได้: '+(e&&e.message||e))})}
function phLoad(){return idb().then(function(db){return new Promise(function(res){var q=db.transaction('photos','readonly').objectStore('photos').getAll();q.onsuccess=function(){(q.result||[]).forEach(function(o){if(o&&o.k&&o.list&&o.list.length){PH[o.k]=o.list;PHT[o.k]=o.t||''}});res()};q.onerror=function(){res()}})}).catch(function(){})}
function setPhotos(k,list){if(list&&list.length){PH[k]=list.slice(0,MAXPH);PHT[k]=new Date().toISOString()}else{delete PH[k];delete PHT[k]}return phPut(k)}
function photoKeys(){return Object.keys(PH).filter(function(k){return PH[k]&&PH[k].length})}
function clearPhotos(){PH={};PHT={};idb().then(function(db){db.transaction('photos','readwrite').objectStore('photos').clear()}).catch(function(){})}
function isImgUrl(s){return typeof s==='string'&&s.indexOf('data:image/')===0}
function loadImg(src){return new Promise(function(res,rej){var im=new Image();im.onload=function(){res(im)};im.onerror=function(){rej(new Error('เปิดไฟล์รูปไม่ได้ (JPG/PNG/WebP)'))};im.src=src})}
function draw(im,max,q){var w=im.naturalWidth||im.width,h=im.naturalHeight||im.height,s=Math.min(1,max/Math.max(w,h));var c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*s));c.height=Math.max(1,Math.round(h*s));var g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/jpeg',q)}
function makePhoto(file){var u=URL.createObjectURL(file);return loadImg(u).then(function(im){var o={d:draw(im,1280,.8),th:draw(im,360,.7)};URL.revokeObjectURL(u);return o},function(e){URL.revokeObjectURL(u);throw e})}
function photoFromUrl(d){return loadImg(d).then(function(im){return {d:d,th:draw(im,360,.7)}},function(){return {d:d,th:''}})}
// ---------- dom helpers ----------
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function btn(cls,text,fn){var b=el('button',cls,text);b.type='button';if(fn)b.onclick=fn;return b}
function link(cls,text,href){var a=el('a',cls,text);a.href=href;return a}
var CAM='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
function sitePhoto(k){var P=CFG.photos||{};var o=P[k];if(!o)return null;var S=CFG.sitePhotos||{};return {src:S.dir+'/'+o.f,th:S.thumbDir+'/'+o.f,kind:o.kind,label:(S.labels||{})[o.kind]||''}}
function photoEl(k,compact,cls){var L=PH[k];if(L&&L.length){var im=el('img','ra-photo'+(cls?' '+cls:''));im.src=L[0].th||L[0].d;im.alt='';im.loading='lazy';return im}
 var sp=sitePhoto(k);if(sp){var im2=el('img','ra-photo ra-site-photo'+(cls?' '+cls:''));im2.src=compact?sp.th:sp.src;im2.alt='';im2.loading='lazy';im2.decoding='async';im2.dataset.site=sp.kind;return im2}
 var d=el('div','ra-photo ra-photo-empty'+(compact?' compact':'')+(cls?' '+cls:''));d.setAttribute('aria-label','ไม่มีรูป');d.innerHTML=CAM+'<span>ไม่มีรูป</span>';return d}
function stTone(s){if(!s)return 'muted';if(CFG.status.good.indexOf(s)>=0)return 'good';if(CFG.status.muted.indexOf(s)>=0)return 'muted';return 'bad'}
function chip(cls,text){return el('span','ra-chip '+cls,text)}
function editBadges(r){var w=el('span','ra-badges');if(r._new)w.appendChild(chip('new','ใหม่'));else if(r._edited)w.appendChild(chip('edited','แก้แล้ว'));if(r._del)w.appendChild(chip('del','รอลบ'));return w.childNodes.length?w:null}
var tt;function toast(m){var t=$('toast');t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(function(){t.hidden=true},2600)}
function qrUrl(k){return CFG.siteUrl.replace(/#.*$/,'')+'#item='+encodeURIComponent(k)}
function qrBox(text,mm){var d=el('div','qrbox');if(mm){d.style.width=mm+'mm';d.style.height=mm+'mm'}try{var q=qrcode(0,'M');q.addData(text);q.make();d.innerHTML=q.createSvgTag({cellSize:2,margin:0,scalable:true})}catch(e){d.textContent='QR error'}return d}
function csvq(v){v=String(v==null?'':v);return /[",\r\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
function stamp(){var d=new Date(),p=function(n){return (n<10?'0':'')+n};return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes())}
function download(name,text,type){var blob=new Blob([text],{type:type});var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},500)}
function thCmp(a,b){return String(a).localeCompare(String(b),'th',{numeric:true})}
// ---------- selection ----------
var sel={};(lsGet(LS_SEL,[])||[]).forEach(function(k){sel[k]=1});
function selKeys(){return Object.keys(sel)}
function saveSel(){lsSet(LS_SEL,selKeys())}
function toggleSel(k,on){if(on==null)on=!sel[k];if(on)sel[k]=1;else delete sel[k];saveSel()}
// ---------- filters ----------
var F={q:'',status:'',type:'',fy:'',year:'',unit:'',ed:''};
var DIMS=[['status','สภาพ / สถานะ',function(r){return r.status||''}],['type','ประเภท',function(r){return r.type||''}],['fy','ปีงบประมาณ (พ.ศ.)',function(r){return r.fy||''}],['year','ปีที่ได้มา (พ.ศ.)',function(r){return yearOf(r.date)}],['unit',CFG.unit.label,function(r){return r._unit}]].concat(${UA ? 'true' : 'false'}?[['asg','ผู้รับผิดชอบ',function(r){return r.ua===1?'ยังไม่มีผู้รับผิดชอบ':(r.ua===0?'มีผู้รับผิดชอบแล้ว':'')}]]:[]);
function searchHay(r){return fieldsFor('search').map(function(f){return sv(r,f.key)}).concat([r._unit,r.fy]).join(' ').toLowerCase()}
function match(r,f,skip){for(var i=0;i<DIMS.length;i++){var d=DIMS[i];if(d[0]===skip)continue;if(f[d[0]]&&d[2](r)!==f[d[0]])return false}
 if(f.ed==='edited'&&!r._edited)return false;if(f.ed==='new'&&!r._new)return false;if(f.ed==='del'&&!r._del)return false;if(f.ed==='ph'&&!r._ph)return false;
 var q=(f.q||'').trim().toLowerCase();if(!q)return true;var h=searchHay(r);return h.replace(/\s+/g,' ').indexOf(q)>=0||h.replace(/\s+/g,'').indexOf(q.replace(/\s+/g,''))>=0}
function facet(all,f,dim){var c={};all.forEach(function(r){if(!match(r,f,dim[0]))return;var v=dim[2](r);c[v]=(c[v]||0)+1});return c}
var sortKey='_ord',sortDir=1;
var SORTS=[['_ord','ลำดับในทะเบียน'],['tag','หมายเลขครุภัณฑ์'],['name','ชื่อครุภัณฑ์'],['fy','ปีงบประมาณ'],['loc','สถานที่ตั้ง'],['date','วันที่ได้มา']];
function dkey(s){var m=/^(\d+)\/(\d+)\/(\d+)$/.exec(s||'');return m?(+m[3])*10000+(+m[2])*100+(+m[1]):-1}
function ordOf(r){var m=/^r(\d+)$/.exec(r.k);return m?+m[1]:1e9}
function cmp(a,b){if(sortKey==='_ord')return (ordOf(a)-ordOf(b))*sortDir||thCmp(a.k,b.k);var x=sv(a,sortKey),y=sv(b,sortKey);if(sortKey==='date'){x=dkey(x);y=dkey(y);if(x<0)return 1;if(y<0)return -1;return (x-y)*sortDir||thCmp(sv(a,'tag'),sv(b,'tag'))}
 if(x==='')return 1;if(y==='')return -1;return thCmp(x,y)*sortDir||thCmp(sv(a,'tag'),sv(b,'tag'))}
// ---------- edit mode ----------
var editOn=EDIT&&lsGet(LS_MODE,true)!==false;
function canEdit(){return EDIT&&editOn}
// ---------- router ----------
var view=lsGet(LS_VIEW,'grid')==='table'?'table':'grid';
function route(){var h=decodeURIComponent(location.hash||'');var m;
 if((m=/^#item=(.+)$/.exec(h))||(m=/^#\/item\/(.+)$/.exec(h)))return {p:'item',k:m[1]};
 if(h==='#/new')return {p:'form',k:null};
 if((m=/^#\/edit\/(.+)$/.exec(h)))return {p:'form',k:m[1]};
 if((m=/^#\/stickers(?:\?ids=(.*))?$/.exec(h)))return {p:'stickers',ids:m[1]?m[1].split(','):null};
 return {p:'list'}}
function navActive(p){document.querySelectorAll('.topbar nav a').forEach(function(a){a.classList.toggle('active',a.dataset.p===p)})}
function render(){var r=route();var main=$('main');main.replaceChildren();window.scrollTo(0,0);navActive(r.p==='form'&&r.k?'list':r.p);
 if(r.p==='item')renderItem(main,r.k);else if(r.p==='form')renderForm(main,r.k);else if(r.p==='stickers')renderStickers(main,r.ids);else renderList(main);
 document.body.dataset.page=r.p}
var keepScroll=false;
function rerender(){var y=window.scrollY;render();window.scrollTo(0,y)}
window.addEventListener('hashchange',render);
// ---------- LIST ----------
function renderList(main){
 var all=allRows();
 var hero=el('section','panel ra-hero');var ht=el('div','ra-hero-text');var h2=el('h2',null,CFG.appTitle+' ');h2.appendChild(el('small',null,CFG.appSubtitle));ht.appendChild(h2);
 ht.appendChild(el('p','muted','ทั้งหมด '+all.length.toLocaleString('th-TH')+' รายการ · ข้อมูล ณ '+CFG.asOf+' น. · ไม่แสดงชื่อผู้ใช้งานและข้อมูลราคา'));hero.appendChild(ht);
 var ha=el('div','ra-hero-actions');
 if(canEdit())ha.appendChild(link('ra-btn primary big','+ เพิ่มครุภัณฑ์ใหม่','#/new'));
 ha.appendChild(link('ra-btn big','🏷️ พิมพ์สติกเกอร์','#/stickers'));
 if(EDIT)ha.appendChild(btn('ra-btn big'+(editOn?' primary':''),editOn?'✎ โหมดแก้ไข: เปิด':'✎ โหมดแก้ไข: ปิด',function(){editOn=!editOn;lsSet(LS_MODE,editOn);rerender()})).id='bmode';
 hero.appendChild(ha);main.appendChild(hero);
 if(EDIT&&editOn){var ep=el('section','panel');ep.id='editpanel';var eb=el('div','ra-editbar');var n=editCount(),np=photoKeys().length;
  var cnt=el('span','ra-stat accent');cnt.appendChild(el('span','ra-stat-label','การแก้ไขในเครื่องนี้'));var cv=el('span','ra-stat-value',n+' รายการที่แก้');cv.id='ecount';cnt.appendChild(cv);eb.appendChild(cnt);
  var bj=btn('ra-btn','⬇ ส่งออกการแก้ไข (JSON)',exportEditsJson);bj.id='bexpj';bj.disabled=!(n||np);eb.appendChild(bj);
  var bc=btn('ra-btn','⬇ ส่งออกการแก้ไข (CSV)',exportEditsCsv);bc.id='bexpc';bc.disabled=!(n||np);eb.appendChild(bc);
  var bi=btn('ra-btn','⬆ นำเข้าไฟล์การแก้ไข',function(){$('fimp').value='';$('fimp').click()});bi.id='bimp';eb.appendChild(bi);
  var bx=btn('ra-btn danger','ล้างการแก้ไข',clearEdits);bx.id='bclr';bx.disabled=!(n||np);eb.appendChild(bx);
  ep.appendChild(eb);var note=el('div','ra-editnote');note.innerHTML='⚠ การแก้ไข/เพิ่ม/รูป บันทึกไว้ <b>เฉพาะในเครื่อง/เบราว์เซอร์นี้</b> ยังไม่เข้าฐานข้อมูล — กด “ส่งออกการแก้ไข” เพื่อเก็บเป็นไฟล์ แล้ว “นำเข้าไฟล์การแก้ไข” ในอีกเครื่อง (มือถือ ↔ PC) ได้';ep.appendChild(note);main.appendChild(ep)}
 // filters
 var fp=el('section','panel');var fg=el('div','ra-filters');
 var ls=el('label','ra-search');ls.appendChild(el('span',null,'ค้นหา'));var qi=el('input');qi.type='search';qi.id='q';qi.placeholder='ชื่อ / หมายเลขครุภัณฑ์ / บาร์โค้ด / สถานที่ / S/N';qi.value=F.q;qi.autocomplete='off';ls.appendChild(qi);fg.appendChild(ls);
 var selects={};
 DIMS.forEach(function(d){var lb=el('label');lb.appendChild(el('span',null,d[1]));var s=el('select');s.id='f_'+d[0];lb.appendChild(s);fg.appendChild(lb);selects[d[0]]=s;s.onchange=function(){F[d[0]]=s.value;update()}});
 if(EDIT){var le=el('label');le.appendChild(el('span',null,'การแก้ไข'));var se=el('select');se.id='f_ed';[['','ทั้งหมด'],['edited','เฉพาะที่แก้'],['new','เฉพาะที่เพิ่มใหม่'],['del','เฉพาะที่ทำเครื่องหมายลบ'],['ph','เฉพาะที่มีรูป']].forEach(function(o){var op=el('option',null,o[1]);op.value=o[0];se.appendChild(op)});se.value=F.ed;se.onchange=function(){F.ed=se.value;update()};le.appendChild(se);fg.appendChild(le)}
 var lso=el('label');lso.appendChild(el('span',null,'เรียงตาม'));var so=el('select');so.id='sortm';SORTS.forEach(function(s){[1,-1].forEach(function(dd){var o=el('option',null,s[1]+(dd>0?' ▲':' ▼'));o.value=s[0]+':'+dd;so.appendChild(o)})});so.value=sortKey+':'+sortDir;so.onchange=function(){var p=so.value.split(':');sortKey=p[0];sortDir=+p[1];update()};lso.appendChild(so);fg.appendChild(lso);
 var rb=btn('ra-btn ghost','ล้างตัวกรอง',function(){for(var k in F)F[k]='';qi.value='';if($('f_ed'))$('f_ed').value='';update()});rb.id='freset';fg.appendChild(rb);
 fp.appendChild(fg);var stats=el('div','ra-stats');stats.id='stats';fp.appendChild(stats);main.appendChild(fp);
 qi.oninput=function(){F.q=qi.value;update()};
 // listbar
 var lb2=el('section','panel ra-listbar');var vt=el('div','view-toggle');vt.setAttribute('role','group');
 var vtb=btn(view==='table'?'toggle-active':'','ตาราง',function(){view='table';lsSet(LS_VIEW,view);rerender()});vtb.id='vtable';
 var vgb=btn(view==='grid'?'toggle-active':'','กริด',function(){view='grid';lsSet(LS_VIEW,view);rerender()});vgb.id='vgrid';vt.appendChild(vtb);vt.appendChild(vgb);lb2.appendChild(vt);
 var sal=el('label','ra-check-label');var sa=el('input');sa.type='checkbox';sa.id='selall';sal.appendChild(sa);var salt=el('span');sal.appendChild(salt);lb2.appendChild(sal);
 var la=el('div','ra-listbar-actions');var sc=el('span','ra-selcount');sc.id='selcount';la.appendChild(sc);
 var bst=btn('ra-btn primary','',function(){location.hash='#/stickers?ids='+selKeys().join(',')});bst.id='bstk';la.appendChild(bst);
 var bcsv=btn('ra-btn','⬇ Export CSV ที่เลือก',exportSelectedCsv);bcsv.id='bcsv';la.appendChild(bcsv);
 var bclr=btn('ra-btn ghost','ล้างการเลือก',function(){sel={};saveSel();update()});bclr.id='bselclr';la.appendChild(bclr);lb2.appendChild(la);main.appendChild(lb2);
 var lp=el('section','panel');lp.id='listpanel';main.appendChild(lp);
 var cur=[];
 sa.onchange=function(){cur.forEach(function(r){toggleSel(r.k,sa.checked)});update()};
 function update(){
  all=allRows();
  DIMS.forEach(function(d){var s=selects[d[0]],c=facet(all,F,d),keys=Object.keys(c).filter(function(v){return v!==''}).sort(thCmp);if(d[0]==='fy'||d[0]==='year')keys.reverse();
   if(d[0]==='status')keys.sort(function(a,b){var i=STATUSES.indexOf(a),j=STATUSES.indexOf(b);return (i<0?99:i)-(j<0?99:j)||thCmp(a,b)});
   if(F[d[0]]&&keys.indexOf(F[d[0]])<0)keys.unshift(F[d[0]]);
   s.replaceChildren();var tot=0;for(var v in c)tot+=c[v];var o0=el('option',null,'ทั้งหมด ('+tot+')');o0.value='';s.appendChild(o0);
   keys.forEach(function(v){var o=el('option',null,v+' ('+(c[v]||0)+')');o.value=v;s.appendChild(o)});if(c['']){var ob=el('option',null,'(ไม่ระบุ) ('+c['']+')');ob.value='\u0000';}s.value=F[d[0]]});
  cur=all.filter(function(r){return match(r,F,null)});cur.sort(cmp);
  var active=Object.keys(F).some(function(k){return F[k]});rb.disabled=!active;
  stats.replaceChildren();var nsel=selKeys().length;
  function stat(label,val,acc,id){var s=el('div','ra-stat'+(acc?' accent':''));s.appendChild(el('span','ra-stat-label',label));var v=el('span','ra-stat-value',val);if(id)v.id=id;s.appendChild(v);stats.appendChild(s)}
  stat(active?'ตามตัวกรอง':'ทั้งหมด',cur.length.toLocaleString('th-TH')+' รายการ',false,'statcount');
  var by={};cur.forEach(function(r){by[r.status||'ไม่ระบุ']=(by[r.status||'ไม่ระบุ']||0)+1});
  STATUSES.forEach(function(s){if(by[s])stat(s,by[s].toLocaleString('th-TH')+' รายการ')});
  stat('เลือกแล้ว',nsel.toLocaleString('th-TH')+' รายการ',true,'statsel');
  var vis=cur.filter(function(r){return sel[r.k]}).length;sa.checked=cur.length>0&&vis===cur.length;sa.indeterminate=vis>0&&vis<cur.length;salt.textContent='เลือกทั้งหมดในหน้านี้ ('+cur.length+')';
  var hidden=nsel-vis;sc.replaceChildren(document.createTextNode('เลือก '),el('b',null,String(nsel)));if(hidden>0)sc.appendChild(el('span','muted',' (ซ่อนอยู่ตามตัวกรอง '+hidden+')'));
  bst.textContent='🏷️ พิมพ์สติกเกอร์ที่เลือก ('+nsel+')';bst.disabled=!nsel;bcsv.disabled=!nsel;bclr.disabled=!nsel;
  lp.replaceChildren();
  if(!cur.length){var em=el('div','ra-empty');em.appendChild(el('div','ra-empty-icon','🔍'));em.appendChild(el('div','ra-empty-title','ไม่พบรายการที่ตรงกับตัวกรอง'));lp.appendChild(em);return}
  lp.appendChild(view==='table'?tableEl(cur,update):gridEl(cur,update))}
 update()}
function rowActions(r,update,small){var w=el('div',small?'ra-card-actions':'ra-actions');
 if(canEdit())w.appendChild(link('ra-btn small primary ra-edit','✏️ แก้ไข','#/edit/'+encodeURIComponent(r.k)));
 w.appendChild(link('ra-btn small','สติกเกอร์','#/stickers?ids='+encodeURIComponent(r.k)));
 if(canEdit()){var d=btn('ra-btn small danger',r._del?'↺ ยกเลิกลบ':'🗑 ลบ',function(){markDelete(r.k);update()});d.title='ทำเครื่องหมายลบ (ยังไม่ลบจริง)';w.appendChild(d)}
 return w}
function checkbox(r,update){var c=el('input');c.type='checkbox';c.checked=!!sel[r.k];c.className='rowcheck';c.dataset.k=r.k;c.setAttribute('aria-label','เลือก '+(r.name||r.tag||''));c.onchange=function(){toggleSel(r.k,c.checked);update()};return c}
function tableEl(rows,update){var wrap=el('div','ra-table-wrap');var t=el('table','data ra-table');var th=el('thead');var hr=el('tr');
 var thc=el('th','ra-col-check');var ca=el('input');ca.type='checkbox';ca.id='selall2';var vis=rows.filter(function(r){return sel[r.k]}).length;ca.checked=rows.length>0&&vis===rows.length;ca.indeterminate=vis>0&&vis<rows.length;ca.onchange=function(){rows.forEach(function(r){toggleSel(r.k,ca.checked)});update()};thc.appendChild(ca);hr.appendChild(thc);
 hr.appendChild(el('th','ra-col-photo','รูป'));var cols=fieldsFor('table').filter(function(f){return f.type!=='image'});
 cols.forEach(function(f){hr.appendChild(el('th',f.type==='number'?'num':'',f.label))});hr.appendChild(el('th','ra-col-actions','จัดการ'));th.appendChild(hr);t.appendChild(th);
 var tb=el('tbody');rows.forEach(function(r){var tr=el('tr',(sel[r.k]?'ra-row-selected':'')+(r._del?' is-del':''));tr.dataset.k=r.k;
  var c0=el('td','ra-col-check');c0.appendChild(checkbox(r,update));tr.appendChild(c0);
  var c1=el('td','ra-col-photo');var qw=el('div','ra-qp-thumb');var tw=el('div','ra-thumb');tw.appendChild(photoEl(r.k,true));qw.appendChild(tw);if(canEdit()){var qb=el('div','ra-qp-btns');qb.appendChild(btn('ra-btn small qp',PH[r.k]&&PH[r.k].length?'🖼 เปลี่ยนรูป':'🖼 ใส่รูป',function(){quickPhoto(r.k,update)}));qw.appendChild(qb)}c1.appendChild(qw);tr.appendChild(c1);
  cols.forEach(function(f){var td=el('td',f.type==='number'?'num':(f.key==='loc'||f.key==='date'?'ra-nowrap':''));td.dataset.l=f.label;
   if(f.key==='name'){var a=link('ra-linklike','', '#item='+encodeURIComponent(r.k));var nm=el('span','ra-name',r.name||'—');a.appendChild(nm);a.appendChild(el('span','ra-sub',r.type||''));td.appendChild(a);var bd=editBadges(r);if(bd)td.appendChild(bd)}
   else if(f.key==='status')td.appendChild(chip(stTone(r.status),r.status||'ไม่ระบุ'));
   else if(f.mono){var cd=el('code','ra-code',sv(r,f.key)||'—');td.appendChild(cd)}
   else td.textContent=sv(r,f.key)||'—';tr.appendChild(td)});
  var ac=el('td','ra-col-actions');ac.appendChild(rowActions(r,update));tr.appendChild(ac);tb.appendChild(tr)});
 t.appendChild(tb);wrap.appendChild(t);return wrap}
function gridEl(rows,update){var g=el('div','ra-grid');var gf=fieldsFor('grid').filter(function(f){return ['photo','name','status'].indexOf(f.key)<0});
 rows.forEach(function(r){var a=el('article','ra-card'+(sel[r.k]?' selected':'')+(r._del?' is-del':'')+(r._edited?' is-edited':''));a.dataset.k=r.k;
  var ph=el('div','ra-card-photo');ph.appendChild(photoEl(r.k,false));var lc=el('label','ra-card-check');lc.title='เลือก';lc.appendChild(checkbox(r,update));ph.appendChild(lc);
  var cc=chip(stTone(r.status)+' ra-card-cond',r.status||'ไม่ระบุ');ph.appendChild(cc);if(canEdit()){var ov=el('div','ra-qp-overlay');ov.appendChild(btn('ra-btn small ra-qp-add qp',PH[r.k]&&PH[r.k].length?'🖼 เปลี่ยนรูป':'🖼 ใส่รูป',function(){quickPhoto(r.k,update)}));ph.appendChild(ov)}a.appendChild(ph);
  var body=el('div','ra-card-body');if(r.type)body.appendChild(el('div','ra-card-cat',r.type));
  var nm=link('ra-card-name',r.name||'—','#item='+encodeURIComponent(r.k));nm.style.color='inherit';nm.title=r.name||'';body.appendChild(nm);
  var bd=editBadges(r);if(bd){var sl=el('div','ra-card-statusline');bd.style.marginLeft='0';sl.appendChild(bd);body.appendChild(sl)}
  var dl=el('dl','ra-card-fields');gf.forEach(function(f){var d=el('div');d.appendChild(el('dt',null,f.label.replace(/\s*\(.*\)$/,'')));d.appendChild(el('dd',f.mono?'mono':'',sv(r,f.key)||'—'));dl.appendChild(d)});body.appendChild(dl);
  body.appendChild(rowActions(r,update,true));a.appendChild(body);g.appendChild(a)});return g}
function exportSelectedCsv(){var keys=selKeys();var rows=keys.map(rowByK).filter(Boolean);rows.sort(cmp);var cols=fieldsFor('csv').filter(function(f){return f.type!=='image'&&(EDIT||!f.editOnly)});
 var L=[['key'].concat(cols.map(function(f){return f.label}),[CFG.unit.label,'ลิงก์ QR (หน้า item)','สถานะการแก้ไข'])];
 rows.forEach(function(r){L.push([r.k].concat(cols.map(function(f){return sv(r,f.key)}),[r._unit,qrUrl(r.k),r._new?'เพิ่มใหม่':r._del?'ทำเครื่องหมายลบ':r._edited?'แก้แล้ว':''] ))});
 download('ru-assets-selected-'+stamp()+'.csv','\uFEFF'+L.map(function(r){return r.map(csvq).join(',')}).join('\r\n')+'\r\n','text/csv;charset=utf-8');toast('Export CSV '+rows.length+' รายการ')}
// ---------- ITEM (view-only page opened by QR) ----------
function renderItem(main,k){var r=rowByK(k);var p=el('section','panel ra-form-panel');p.id='itempage';
 var head=el('div','ra-form-head');head.appendChild(el('h2',null,'ข้อมูลครุภัณฑ์'));var hb=el('div','ra-hero-actions');hb.appendChild(link('ra-btn ghost','← รายการทั้งหมด','#/'));
 if(r&&canEdit())hb.appendChild(link('ra-btn primary','✏️ แก้ไข','#/edit/'+encodeURIComponent(k)));if(r)hb.appendChild(link('ra-btn','🏷️ สติกเกอร์','#/stickers?ids='+encodeURIComponent(k)));head.appendChild(hb);p.appendChild(head);
 if(!r){var em=el('div','ra-empty');em.appendChild(el('div','ra-empty-icon','🧭'));em.appendChild(el('div','ra-empty-title','ไม่พบรายการนี้'));em.appendChild(el('div','muted',/^n/.test(k)?'รายการที่เพิ่มใหม่จะเห็นได้เฉพาะในเครื่องที่เพิ่ม จนกว่าจะนำเข้าฐานข้อมูล':'key: '+k));p.appendChild(em);main.appendChild(p);return}
 var g=el('div','ra-item');var left=el('div');var ph=el('div','ra-item-photo');ph.appendChild(photoEl(k,false));left.appendChild(ph);var spi=sitePhoto(k);if(spi&&!(PH[k]&&PH[k].length)){var cap=el('div','ra-hint ra-photo-cap');if(spi.label)cap.appendChild(el('span',null,spi.label+' · '));var fl=el('a',null,'ดูรูปขนาดเต็ม');fl.href=spi.src;fl.target='_blank';fl.rel='noopener';cap.appendChild(fl);left.appendChild(cap)}
 var qr=el('div','ra-item-qr');qr.appendChild(qrBox(qrUrl(k)));qr.appendChild(el('div','ra-hint','QR ของหน้านี้'));left.appendChild(qr);g.appendChild(left);
 var right=el('div');right.appendChild(el('div','ra-item-tag',r.tag||'—'));right.appendChild(el('div','ra-item-name',r.name||'—'));
 var cl=el('div','ra-card-statusline');cl.appendChild(chip(stTone(r.status),r.status||'ไม่ระบุ'));var bd=editBadges(r);if(bd)cl.appendChild(bd);right.appendChild(cl);
 var dl=el('dl','ra-detail');fieldsFor('item').filter(function(f){return f.type!=='image'&&f.key!=='name'}).forEach(function(f){var v=sv(r,f.key);if(!v&&['tag2','serial','srange','specs','qty'].indexOf(f.key)>=0)return;var d=el('div');d.appendChild(el('dt',null,f.label));var dd=el('dd',f.mono?'ra-code':'',v||'—');if(f.type==='textarea')dd.style.whiteSpace='pre-wrap';d.appendChild(dd);dl.appendChild(d)});
 var du=el('div');du.appendChild(el('dt',null,CFG.unit.label));du.appendChild(el('dd','ra-code',r._unit||'—'));dl.appendChild(du);right.appendChild(dl);
 right.appendChild(el('p','ra-hint','หน้าดูอย่างเดียว · ข้อมูล ณ '+CFG.asOf+' น. · ไม่แสดงชื่อผู้ใช้งานและข้อมูลราคา'));g.appendChild(right);p.appendChild(g);main.appendChild(p);document.title=(r.tag||r.name||'ครุภัณฑ์')+' · '+CFG.appTitle}
// ---------- FORM (add / edit) ----------
var fPh=null;
function renderForm(main,k){if(!canEdit()){location.hash='#/';return}
 var isNew=!k;if(isNew)k='n'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
 var b=baseOf(k),e=store.edits[k];if(!isNew&&!baseByK[k]&&!(e&&e.isNew)){location.hash='#/';return}
 var nw=isNew||!baseByK[k];var r=eff(b,e);
 var p=el('div','panel ra-form-panel');p.id='formpage';var head=el('div','ra-form-head');head.appendChild(el('h2',null,nw?(isNew?'เพิ่มครุภัณฑ์ใหม่':'แก้ไขรายการที่เพิ่มใหม่'):'แก้ไขครุภัณฑ์ '+(b.tag||b.name||'')));head.appendChild(link('ra-btn ghost','← กลับไปรายการ','#/'));p.appendChild(head);
 if(!nw)p.appendChild(el('p','ra-hint','key: '+k+(b.b?' · B เดิม: '+b.b:'')+(b.tag?' · เลขเดิม: '+b.tag:'')));
 // photo row
 fPh=(PH[k]||[]).slice();var pr=el('div','ra-photo-row');var dz=el('div','dropzone ra-dropzone');dz.appendChild(el('p',null,'📷 ลากวาง'+labelOf('photo')+'ที่นี่ หรือเลือกไฟล์ / ถ่ายรูป'));
 var bw=el('div','ra-hero-actions');var fi=el('input');fi.type='file';fi.accept='image/*';fi.multiple=true;fi.hidden=true;fi.id='f_photo';var fc=el('input');fc.type='file';fc.accept='image/*';fc.setAttribute('capture','environment');fc.hidden=true;
 bw.appendChild(btn('ra-btn','เลือกไฟล์รูป',function(){fi.value='';fi.click()}));bw.appendChild(btn('ra-btn','📷 ถ่ายรูป',function(){fc.value='';fc.click()}));dz.appendChild(bw);dz.appendChild(fi);dz.appendChild(fc);
 dz.appendChild(el('span','ra-hint','สูงสุด '+MAXPH+' รูป · ย่อขนาดอัตโนมัติ · เก็บในเครื่องนี้'));
 dz.ondragover=function(ev){ev.preventDefault();dz.classList.add('active')};dz.ondragleave=function(){dz.classList.remove('active')};dz.ondrop=function(ev){ev.preventDefault();dz.classList.remove('active');addFiles(ev.dataTransfer.files)};
 fi.onchange=function(){addFiles(fi.files)};fc.onchange=function(){addFiles(fc.files)};
 var pv=el('div','ra-photo-preview');pr.appendChild(dz);pr.appendChild(pv);p.appendChild(pr);
 function phRender(){pv.replaceChildren();var main1=el('div','ra-photo');main1.style.position='relative';if(fPh.length){var im=el('img','ra-photo');im.src=fPh[0].th||fPh[0].d;im.alt='';pv.appendChild(im)}else{var d=el('div','ra-photo ra-photo-empty');d.innerHTML=CAM+'<span>ไม่มีรูป</span>';d.style.width='180px';d.style.height='150px';d.style.borderRadius='12px';d.style.border='1px solid var(--border)';pv.appendChild(d)}
  var l=el('div','ra-phlist');fPh.forEach(function(ph,i){var w=el('div','ra-phit');var im=el('img','ra-photo');im.src=ph.th||ph.d;w.appendChild(im);w.appendChild(btn('','✕',function(){fPh.splice(i,1);phRender()}));l.appendChild(w)});if(fPh.length)pv.appendChild(l);
  pv.appendChild(el('span','ra-hint',phBusy?'กำลังย่อรูป…':fPh.length+'/'+MAXPH+' รูป'))}
 function addFiles(fl){var files=Array.prototype.slice.call(fl||[]).filter(function(f){return !f.type||f.type.indexOf('image/')===0});var room=MAXPH-fPh.length;files=files.slice(0,room);if(!files.length)return;var list=fPh;phBusy++;phRender();
  files.reduce(function(pp,f){return pp.then(function(){return makePhoto(f).then(function(o){list.push(o)},function(er){toast(er.message)})})},Promise.resolve()).then(function(){phBusy--;if(list===fPh)phRender()})}
 phRender();
 // fields
 var form=el('form');form.autocomplete='off';var grid=el('div','grid2 ra-form-grid');
 fieldsFor('form').filter(function(f){return f.type!=='image'}).forEach(function(f){var lab=el('label',f.full?'ra-full':'');var sp=el('span',null,f.label);if(f.required){var rq=el('b','ra-req',' *');sp.appendChild(rq)}lab.appendChild(sp);
  var inp;if(f.type==='textarea'){inp=el('textarea')}else if(f.type==='select'){inp=el('select');STATUSES.forEach(function(s){var o=el('option',null,s);o.value=s;inp.appendChild(o)})}else{inp=el('input');if(f.type==='date_be')inp.inputMode='numeric'}
  inp.id='f_'+f.key;inp.name=f.key;if(f.placeholder)inp.placeholder=f.placeholder;var v=sv(r,f.key);if(f.type==='select'){if(v&&STATUSES.indexOf(v)<0){var ox=el('option',null,v);ox.value=v;inp.appendChild(ox)}inp.value=v||STATUSES[0]}else inp.value=v;
  if(f.suggest){var dl=el('datalist');dl.id='dl_'+f.key;var seen={};BASE.forEach(function(x){var s=sv(x,f.key);if(s&&!seen[s]){seen[s]=1;var o=el('option');o.value=s;dl.appendChild(o)}});inp.setAttribute('list',dl.id);lab.appendChild(dl)}
  lab.appendChild(inp);if(f.hint)lab.appendChild(el('small','ra-hint',f.hint));
  var was=el('small','ra-was');lab.appendChild(was);
  function chk(){var bv=(f.key==='note'||f.key==='serial'&&!b.serial)?'':sv(b,f.key);if(!nw&&f.key!=='note'&&inp.value.trim()!==bv){lab.classList.add('changed');was.textContent='เดิม: '+(bv||'(ว่าง)')}else{lab.classList.remove('changed');was.textContent=''}
   if(f.unique){var val=inp.value.replace(/\s+/g,'').toUpperCase();var d=val?allRows().filter(function(x){return x.k!==k&&sv(x,f.key).replace(/\s+/g,'').toUpperCase()===val}):[];if(d.length){was.textContent=(was.textContent?was.textContent+' · ':'')+'⚠ ซ้ำกับ '+d.slice(0,2).map(function(x){return (x.tag||x.k)+' '+(x.name||'').slice(0,24)}).join(', ')}}}
  inp.addEventListener('input',chk);inp.addEventListener('change',chk);chk();grid.appendChild(lab)});
 form.appendChild(grid);
 var acts=el('div','ra-form-actions');var sb=el('button','ra-btn primary big',nw&&isNew?'💾 บันทึกครุภัณฑ์':'💾 บันทึกการแก้ไข');sb.type='submit';sb.id='f_save';acts.appendChild(sb);
 acts.appendChild(btn('ra-btn big','ยกเลิก',function(){location.hash='#/'}));
 if(!isNew){var dbn=btn('ra-btn danger',(e&&e.del)?'↺ ยกเลิกเครื่องหมายลบ':'🗑 ทำเครื่องหมายลบ',function(){collect(!(e&&e.del));location.hash='#/';toast('อัปเดตเครื่องหมายลบแล้ว')});dbn.id='f_del';acts.appendChild(dbn)}
 if(e)acts.appendChild(btn('ra-btn ghost',nw?'ลบรายการใหม่นี้':'คืนค่าเดิม',function(){if(!confirm('ยกเลิกการแก้ไขของรายการนี้ทั้งหมด?'))return;if(nw)setPhotos(k,[]);delete store.edits[k];save();location.hash='#/';toast('คืนค่าเดิมแล้ว')}));
 form.appendChild(acts);form.appendChild(el('p','ra-hint','บันทึกในเครื่อง/เบราว์เซอร์นี้เท่านั้น — ส่งออกไฟล์การแก้ไขจากหน้ารายการเพื่อนำไปอัปเดตฐานข้อมูล'));
 function collect(delFlag){var old=store.edits[k];var ne={f:{},serial:'',note:'',del:old?!!old.del:false,isNew:nw,t:new Date().toISOString()};if(delFlag!=null)ne.del=delFlag;
  fieldsFor('form').forEach(function(f){if(f.type==='image')return;var inp=$('f_'+f.key);var v=inp.value;v=f.type==='textarea'?v.trim():v.replace(/\s+/g,' ').trim();if(f.mono)v=v.replace(/\s+/g,'');if(f.key==='b')v=v.toUpperCase();
   if(f.key==='note'){ne.note=v;return}if(f.key==='serial'&&!sv(b,'serial')){ne.serial=v;return}
   if(nw){if(v)ne.f[f.key]=v}else if(v!==sv(b,f.key))ne.f[f.key]=v});
  var changed=nw||Object.keys(ne.f).length||ne.serial||ne.note||ne.del;if(changed)store.edits[k]=ne;else delete store.edits[k];
  var o2=PH[k]||[];if(!(o2.length===fPh.length&&o2.every(function(x,i){return x===fPh[i]})))setPhotos(k,fPh);save()}
 form.onsubmit=function(ev){ev.preventDefault();if(phBusy){toast('กำลังย่อรูป รอสักครู่…');return}var nmv=$('f_name').value.trim();if(nw&&!nmv){toast('กรุณากรอกชื่อครุภัณฑ์');$('f_name').focus();return}collect(null);location.hash=nw?'#item='+encodeURIComponent(k):'#/';toast(nw?'เพิ่มครุภัณฑ์ในเครื่องนี้แล้ว':'บันทึกการแก้ไขในเครื่องนี้แล้ว')};
 p.appendChild(form);main.appendChild(p)}
function quickPhoto(k,update){var fi=$('qpfile');fi.value='';fi.onchange=function(){var f=fi.files&&fi.files[0];if(!f)return;toast('กำลังย่อรูป…');makePhoto(f).then(function(o){return setPhotos(k,[o].concat((PH[k]||[]).slice(1)))}).then(function(){toast('บันทึกรูปในเครื่องนี้แล้ว');update()},function(e){toast(e.message)})};fi.click()}
function markDelete(k){var e=store.edits[k];if(e){e.del=!e.del;e.t=new Date().toISOString();if(!e.del&&!Object.keys(e.f||{}).length&&!e.serial&&!e.note&&!e.isNew)delete store.edits[k]}else store.edits[k]={f:{},serial:'',note:'',del:true,isNew:false,t:new Date().toISOString()};save();toast(store.edits[k]&&store.edits[k].del?'ทำเครื่องหมายลบแล้ว (ยังไม่ลบจริง)':'ยกเลิกเครื่องหมายลบแล้ว')}
// ---------- STICKERS ----------
function renderStickers(main,ids){if(ids&&ids.length){sel={};ids.forEach(function(k){if(k)sel[k]=1});saveSel();history.replaceState(null,'','#/stickers')}
 var S=lsGet(LS_STK,null)||{};var D=CFG.sticker;['widthMm','heightMm','perPage','cols','fontPx'].forEach(function(k){if(!(S[k]>0))S[k]=D[k]});
 var p=el('div','panel no-print');var head=el('div','ra-form-head');head.appendChild(el('h2',null,'🏷️ พิมพ์สติกเกอร์ครุภัณฑ์'));var ha=el('div','ra-hero-actions');ha.appendChild(link('ra-btn ghost','← กลับไปรายการ','#/'));head.appendChild(ha);p.appendChild(head);
 var lead=el('p','muted ra-lead');lead.innerHTML='รูปครุภัณฑ์ (หรือกรอบ “ไม่มีรูป”) · QR = ลิงก์หน้าข้อมูลครุภัณฑ์ (ดูอย่างเดียว) · <b>เลขป้าย (หมายเลขครุภัณฑ์) ตัวใหญ่สุด</b> · ชื่อ · บาร์โค้ด · ปีที่ได้มา · S/N ชุด · S/N เครื่อง (ว่างไว้ให้เขียนถ้ายังไม่ทราบ) · สถานที่<br><span class="ra-hint">ลิงก์ใน QR: <code>'+CFG.siteUrl.replace(/#.*$/,'').replace(/</g,'&lt;')+'#item=r&lt;id&gt;</code></span>';p.appendChild(lead);
 var st=el('div','ra-settings');[['widthMm','ความกว้าง (mm)',20,200],['heightMm','ความสูง (mm)',15,150],['perPage','จำนวนต่อหน้า',1,60],['cols','คอลัมน์',1,6],['fontPx','ขนาดตัวอักษร (px)',7,24]].forEach(function(x){var l=el('label');l.appendChild(el('span',null,x[1]));var i=el('input');i.type='number';i.min=x[2];i.max=x[3];i.value=S[x[0]];i.id='s_'+x[0];i.oninput=function(){var v=+i.value;if(v>=x[2]&&v<=x[3]){S[x[0]]=v;lsSet(LS_STK,S);preview()}};l.appendChild(i);st.appendChild(l)});p.appendChild(st);
 var fa=el('div','ra-form-actions');var bp=btn('ra-btn primary big','',function(){window.print()});bp.id='bprint';fa.appendChild(bp);
 var sf={q:'',type:'',unit:'',status:''};
 var bsa=btn('ra-btn','',function(){pick.forEach(function(r){sel[r.k]=1});saveSel();refresh()});fa.appendChild(bsa);
 var bc=btn('ra-btn ghost','ล้างตัวเลือก',function(){sel={};saveSel();refresh()});fa.appendChild(bc);var cnt=el('span','ra-selcount');cnt.id='stkcount';fa.appendChild(cnt);p.appendChild(fa);
 var ff=el('div','ra-filters');var lq=el('label','ra-search');lq.appendChild(el('span',null,'ค้นหา'));var qi=el('input');qi.type='search';qi.id='sq';qi.placeholder='ชื่อ / หมายเลข / บาร์โค้ด / สถานที่';lq.appendChild(qi);ff.appendChild(lq);qi.oninput=function(){sf.q=qi.value;refresh()};
 var ssel={};[['status','สภาพ / สถานะ'],['type','ประเภท'],['unit',CFG.unit.label]].forEach(function(d){var l=el('label');l.appendChild(el('span',null,d[1]));var s=el('select');s.id='s_f_'+d[0];l.appendChild(s);ff.appendChild(l);ssel[d[0]]=s;s.onchange=function(){sf[d[0]]=s.value;refresh()}});p.appendChild(ff);
 var plw=el('div','ra-picklist');p.appendChild(plw);main.appendChild(p);
 var pv=el('div','panel sticker-preview-panel');pv.appendChild(el('h3','no-print','พรีวิว'));var sheets=el('div');sheets.id='sheets';pv.appendChild(sheets);main.appendChild(pv);
 var pick=[];
 function refresh(){var all=allRows();var f2={q:sf.q,status:sf.status,type:sf.type,fy:'',year:'',unit:sf.unit,ed:''};
  ['status','type','unit'].forEach(function(dk){var d=DIMS.filter(function(x){return x[0]===dk})[0];var c=facet(all,f2,d);var s=ssel[dk];s.replaceChildren();var o0=el('option',null,'ทั้งหมด');o0.value='';s.appendChild(o0);Object.keys(c).filter(Boolean).sort(thCmp).forEach(function(v){var o=el('option',null,v+' ('+c[v]+')');o.value=v;s.appendChild(o)});s.value=sf[dk]});
  pick=all.filter(function(r){return match(r,f2,null)}).sort(cmp);
  var t=el('table','data');var th=el('thead');var hr=el('tr');var hc=el('th','ra-col-check');var ca=el('input');ca.type='checkbox';ca.id='stk_selall';var vis=pick.filter(function(r){return sel[r.k]}).length;ca.checked=pick.length>0&&vis===pick.length;ca.indeterminate=vis>0&&vis<pick.length;ca.onchange=function(){pick.forEach(function(r){toggleSel(r.k,ca.checked)});refresh()};hc.appendChild(ca);hr.appendChild(hc);
  ['รูป',labelOf('name'),labelOf('tag'),labelOf('b'),labelOf('loc'),labelOf('status')].forEach(function(h){hr.appendChild(el('th',null,h))});th.appendChild(hr);t.appendChild(th);
  var tb=el('tbody');pick.forEach(function(r){var tr=el('tr',sel[r.k]?'ra-row-selected':'');tr.onclick=function(){toggleSel(r.k);refresh()};var c0=el('td','ra-col-check');c0.onclick=function(ev){ev.stopPropagation()};var cb=el('input');cb.type='checkbox';cb.className='stkcheck';cb.checked=!!sel[r.k];cb.onchange=function(){toggleSel(r.k,cb.checked);refresh()};c0.appendChild(cb);tr.appendChild(c0);
   var c1=el('td');var tw=el('div','ra-thumb small');tw.appendChild(photoEl(r.k,true));c1.appendChild(tw);tr.appendChild(c1);tr.appendChild(el('td',null,r.name||''));var c3=el('td');c3.appendChild(el('code','ra-code',r.tag||'—'));tr.appendChild(c3);var c4=el('td');c4.appendChild(el('code','ra-code',r.b||'—'));tr.appendChild(c4);tr.appendChild(el('td',null,r.loc||'—'));var c6=el('td');c6.appendChild(chip(stTone(r.status),r.status||'—'));tr.appendChild(c6);tb.appendChild(tr)});
  t.appendChild(tb);plw.replaceChildren(t);bsa.textContent='เลือกทั้งหมด'+(sf.q||sf.type||sf.unit||sf.status?'ตามตัวกรอง':'')+' ('+pick.length+')';preview()}
 function preview(){var chosen=selKeys().map(rowByK).filter(Boolean).sort(cmp);var per=Math.max(1,S.perPage);var pages=[];for(var i=0;i<chosen.length;i+=per)pages.push(chosen.slice(i,i+per));
  bp.textContent='🖨️ พิมพ์ / Save PDF ('+chosen.length+')';bp.disabled=!chosen.length;cnt.replaceChildren(document.createTextNode('เลือก '),el('b',null,String(chosen.length)),document.createTextNode(' · '+pages.length+' หน้า'));bc.disabled=!chosen.length;
  sheets.replaceChildren();if(!pages.length){var em=el('div','ra-empty no-print');em.appendChild(el('div','ra-empty-icon','🏷️'));em.appendChild(el('div','ra-empty-title','ยังไม่ได้เลือกครุภัณฑ์'));em.appendChild(el('div','ra-empty-body','ติ๊กเลือกจากรายการด้านบน หรือจากหน้า “รายการครุภัณฑ์” แล้วกด “พิมพ์สติกเกอร์ที่เลือก”'));sheets.appendChild(em);return}
  pages.forEach(function(pg){var sh=el('div','sticker-sheet');sh.style.gridTemplateColumns='repeat('+S.cols+', max-content)';sh.style.marginBottom='16px';sh.style.pageBreakAfter='always';pg.forEach(function(r){sh.appendChild(stickerEl(r,S))});sheets.appendChild(sh)})}
 refresh()}
function stickerEl(r,S){var D=CFG.sticker;var s=el('div','sticker ra-sticker');s.dataset.k=r.k;s.style.width=S.widthMm+'mm';s.style.height=S.heightMm+'mm';s.style.fontSize=S.fontPx+'px';
 var ph=el('div','ra-sticker-photo');ph.style.width=D.photoMm+'mm';ph.appendChild(photoEl(r.k,true));s.appendChild(ph);
 s.appendChild(qrBox(qrUrl(r.k),D.qrMm));
 var m=el('div','meta');var tag=(r.tag||'').trim(),name=(r.name||'').trim();
 if(tag){var te=el('div','ra-sticker-tag'+(tag.length>14?' long':''));tag.split(/(?<=[.\-\/])/).forEach(function(part,i){if(i)te.appendChild(document.createElement('wbr'));te.appendChild(document.createTextNode(part))});te.title=tag;m.appendChild(te);if(name)m.appendChild(el('div','name',name)).title=name}else m.appendChild(el('div','ra-sticker-tag ra-sticker-tag-name',name||'—'));
 var yr=yearOf(r.date);var code=[r.b||'',yr?'ปี '+yr:''].filter(Boolean).join(' · ');if(code)m.appendChild(el('div','ra-sticker-sub',code));
 var range=(r.srange||'').trim(),serial=(r.serial||'').trim(),mode=D.blankSerialLine||'batch';if(range)m.appendChild(el('div','ra-sticker-small','S/N ชุด: '+range));
 if(serial||mode==='always'||(mode==='batch'&&range)){var sl=el('div','ra-sticker-serial');sl.appendChild(document.createTextNode('S/N เครื่อง: '));if(serial)sl.appendChild(el('b',null,serial));else{var bl=el('span','ra-sticker-blank');bl.setAttribute('aria-label','เว้นว่างไว้กรอก');sl.appendChild(bl)}m.appendChild(sl)}
 var foot=[D.footerPrefix||'',r.loc||''].filter(Boolean).join(' · ');if(foot)m.appendChild(el('div','ra-sticker-foot',foot));s.appendChild(m);return s}
// ---------- edits export / import ----------
function allEditKeys(){var s={};Object.keys(store.edits).concat(photoKeys()).forEach(function(k){s[k]=1});return Object.keys(s)}
function editItems(withPh){return allEditKeys().sort().map(function(k){var e=store.edits[k]||{f:{},photoOnly:1},b=baseOf(k),nw=!!e.isNew||!baseByK[k];var ch={};
 Object.keys(e.f||{}).forEach(function(f){ch[f]={before:nw?'':sv(b,f),after:e.f[f]}});if(e.serial)ch.serial={before:nw?'':sv(b,'serial'),after:e.serial};
 return {key:k,origB:nw?'':sv(b,'b'),origTag:nw?'':sv(b,'tag'),action:nw?'add':(e.del?'delete':(e.photoOnly?'photo':'edit')),markedDelete:!!e.del,changes:ch,note:e.note||'',updatedAt:e.t||PHT[k]||'',photoCount:(PH[k]||[]).length,photos:withPh?(PH[k]||[]).map(function(p){return p.d}):undefined}})}
function exportEditsJson(){var its=editItems(true);var doc={format:'ru-asset-edits',version:1,exportedAt:new Date().toISOString(),dataAsOf:CFG.asOf,builtAt:CFG.built,count:its.length,photoItems:photoKeys().length,items:its};download('ru-asset-edits-'+stamp()+'.json',JSON.stringify(doc,null,2),'application/json');toast('ส่งออก JSON แล้ว')}
function exportEditsCsv(){var L=[['key','origB','origTag','action','field','fieldLabel','before','after','note','updatedAt','photoCount']];
 editItems(false).forEach(function(it){var fs=Object.keys(it.changes);if(!fs.length)L.push([it.key,it.origB,it.origTag,it.action,'','','','',it.note,it.updatedAt,it.photoCount]);fs.forEach(function(f){L.push([it.key,it.origB,it.origTag,it.action,f,labelOf(f),it.changes[f].before,it.changes[f].after,it.note,it.updatedAt,it.photoCount])})});
 download('ru-asset-edits-'+stamp()+'.csv','\uFEFF'+L.map(function(r){return r.map(csvq).join(',')}).join('\r\n')+'\r\n','text/csv;charset=utf-8');toast('ส่งออก CSV แล้ว')}
function clearEdits(){var n=editCount(),np=photoKeys().length;if(!n&&!np)return;if(!confirm('ล้างการแก้ไขทั้งหมด '+n+' รายการ'+(np?' และรูปของ '+np+' รายการ':'')+' ในเครื่องนี้?\nแนะนำให้ส่งออกไฟล์เก็บไว้ก่อน — ล้างแล้วกู้คืนไม่ได้'))return;store={v:1,edits:{}};save();clearPhotos();rerender();toast('ล้างการแก้ไขแล้ว')}
function importDoc(doc){if(!doc||doc.format!=='ru-asset-edits'||!Array.isArray(doc.items))throw new Error('ไม่ใช่ไฟล์การแก้ไขของหน้านี้');
 var add=0,upd=0,skip=0,unk=0,nph=0,jobs=[];var known={};FIELDS.forEach(function(f){known[f.key]=1});
 doc.items.forEach(function(it){var k=String(it.key||'');if(!k){skip++;return}var isNew=it.action==='add'||!baseByK[k];if(!baseByK[k]&&it.action!=='add'){unk++;return}
  if(Array.isArray(it.photos)){var pl=it.photos.filter(isImgUrl).slice(0,MAXPH);if(pl.length){nph++;jobs.push(Promise.all(pl.map(photoFromUrl)).then(function(L){return setPhotos(k,L)}))}}
  if(it.action==='photo')return;
  var e={f:{},serial:'',note:String(it.note||''),del:!!it.markedDelete||it.action==='delete',isNew:isNew,t:String(it.updatedAt||doc.exportedAt||'')};
  var ch=it.changes||{};Object.keys(ch).forEach(function(f){var a=ch[f]&&ch[f].after;if(a==null)return;if(f==='serial'&&!sv(baseOf(k),'serial'))e.serial=String(a);else if(known[f]&&f!=='note')e.f[f]=String(a)});
  var old=store.edits[k];if(old&&old.t&&e.t&&old.t>e.t){skip++;return}if(old)upd++;else add++;store.edits[k]=e});
 save();Promise.all(jobs).then(function(){rerender();alert('นำเข้าแล้ว: ใหม่ '+add+' · ทับของเดิม '+upd+' · ข้าม (ในเครื่องใหม่กว่า) '+skip+(unk?' · ไม่พบ key '+unk:'')+(nph?' · รูป '+nph+' รายการ':''))})}
if(EDIT){$('fimp').onchange=function(){var file=this.files&&this.files[0];if(!file)return;var rd=new FileReader();rd.onload=function(){try{importDoc(JSON.parse(String(rd.result).replace(/^\uFEFF/,'')))}catch(e){alert('อ่านไฟล์ไม่ได้: '+e.message)}};rd.readAsText(file,'utf-8')}}
render();
phLoad().then(function(){if(photoKeys().length)rerender()});
})();
`;

const nav = `<nav><a href="#/" data-p="list">รายการครุภัณฑ์</a>${READONLY ? '' : '<a href="#/new" data-p="form" id="navnew">+ เพิ่มครุภัณฑ์</a>'}<a href="#/stickers" data-p="stickers">พิมพ์สติกเกอร์</a><a href="assign.html" data-p="assign">🚪 จัดให้พนักงาน</a></nav>`;
const title = CONF.appTitle + (READONLY ? ' (อ่านอย่างเดียว)' : ' (แก้ไขได้)');
const html = `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%93%A6%3C/text%3E%3C/svg%3E">
<title>${title}</title>
<style>${stripComments(vendor('ra-base.css'))}
${stripComments(vendor('ra-assets.css'))}
${EXTRA_CSS}</style></head><body>
<div class="app-shell ra-app">
<header class="topbar no-print"><h1>📦 ${CONF.appTitle} <span class="ra-topsub">${CONF.appSubtitle}</span></h1>${nav}</header>
<main class="main" id="main"></main>
</div>
${READONLY ? '' : '<input id="fimp" type="file" accept=".json,application/json" hidden><input id="qpfile" type="file" accept="image/*" hidden>'}
<div id="toast" class="ra-toast" hidden></div>
<script id="cfg" type="application/json">${esc(JSON.stringify(cfg))}</script>
<script id="data" type="application/json">${esc(JSON.stringify(rows))}</script>
<script>${vendor('qrcode.js')}</script>
<script>${JS}</script></body></html>
`;

// ---------- privacy gate on output ----------
const dataPart = JSON.stringify(rows) + JSON.stringify(cfg);
for (const bad of ['นาย', 'นาง', 'บาท']) if (html.includes(bad)) throw new Error(`Privacy gate: found '${bad}' in output`);
for (const bad of ['user_name', 'user_note', 'unit_price', 'total_value', 'net_value', 'depreciation', 'remarks', 'extra_notes', 'image_url', '"price"']) if (dataPart.includes(bad) || html.includes(bad)) throw new Error(`Privacy gate: found '${bad}' in output`);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(`OK: ${rows.length} rows -> ${outPath} (${READONLY ? 'READ-ONLY' : 'EDITABLE'}) columns: ${cols.join(',')}`);
console.log(`ข้อมูล ณ ${asOf}`);
