// export-pages.mjs — สร้างหน้าเว็บอ่านอย่างเดียว (GitHub Pages) จากฐานข้อมูลครุภัณฑ์
// ใช้:  node --no-warnings scripts\export-pages.mjs [--db <path>] [--out <path>]
// ค่าเริ่มต้น: --db  <project>\server\data\finance_assets.db
//              --out <project>\pages-export\index.html
// เปิดฐานข้อมูลแบบ readOnly เท่านั้น — ไม่แก้ไขข้อมูลใด ๆ
// ความเป็นส่วนตัว: ดึงเฉพาะคอลัมน์ใน ALLOWED_COLUMNS (ไม่มีชื่อบุคคล / ราคา / ค่าเสื่อม / หมายเหตุ / รูป / metadata การนำเข้า)
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

// Whitelist: only these columns are ever read from the DB.
const ALLOWED_COLUMNS = ['asset_no', 'asset_no_alt', 'barcode', 'asset_name', 'category',
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

const html = `<!doctype html>
<html lang="th"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>ทะเบียนครุภัณฑ์ (อ่านอย่างเดียว)</title>
<style>
:root{--bg:#0b1220;--panel:#111a2b;--panel2:#1e2a3c;--line:#2a3a52;--text:#e2e8f0;--muted:#94a3b8;--teal:#2dd4bf;--ok:#34d399;--bad:#f87171;--warn:#fbbf24}
*{box-sizing:border-box}html,body{margin:0;overflow-x:hidden;background:var(--bg);color:var(--text);font-family:"Sarabun","Noto Sans Thai","Leelawadee UI",Tahoma,system-ui,sans-serif;font-size:15px}
header{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,#0b1220 85%,rgba(11,18,32,.9));border-bottom:1px solid var(--line);padding:12px 16px}
h1{margin:0;font-size:1.25rem;color:var(--teal)}.sub{color:var(--muted);font-size:.85rem;margin-top:2px}
.bar{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
input,select{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit}
input:focus,select:focus{outline:2px solid var(--teal);border-color:transparent}
#q{flex:1 1 260px;min-width:0}select{flex:0 1 auto}
.stats{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.chip{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:.8rem;color:var(--muted)}.chip b{color:var(--text)}
main{padding:12px 16px 40px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{background:var(--panel2);color:var(--muted);font-weight:600;font-size:.82rem;cursor:pointer;user-select:none;white-space:nowrap;position:sticky;top:0}
th:hover{color:var(--teal)}th.asc::after{content:" ▲";color:var(--teal)}th.desc::after{content:" ▼";color:var(--teal)}
tr:hover td{background:#16233a}
.tag{font-family:ui-monospace,Consolas,monospace;font-weight:700;color:var(--teal);font-size:1rem;white-space:nowrap}
.tag2{display:block;color:var(--muted);font-size:.75rem;font-weight:400}
.mono{font-family:ui-monospace,Consolas,monospace;white-space:nowrap}.muted{color:var(--muted)}
.st{display:inline-block;border-radius:999px;padding:2px 9px;font-size:.78rem;white-space:nowrap;border:1px solid}
.st.ok{color:var(--ok);border-color:#065f46;background:#052e2b}.st.bad{color:var(--bad);border-color:#7f1d1d;background:#2a1215}.st.ret{color:var(--warn);border-color:#b45309;background:#2a1e0b}
.empty{padding:30px;text-align:center;color:var(--muted)}
footer{color:var(--muted);font-size:.78rem;padding:0 16px 24px}
#sortm{display:none}
@media (max-width:760px){
 thead{display:none}table,tbody,tr,td{display:block;width:100%}table{border:0;background:none}
 tr{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-bottom:10px;padding:8px 10px}
 td{border:0;padding:3px 0;display:flex;gap:10px}td::before{content:attr(data-l);color:var(--muted);font-size:.78rem;min-width:92px;flex:0 0 92px}
 td.c-tag{font-size:1.1rem}td.c-tag::before{content:none}
 #sortm{display:block}
 header{position:static}#q{flex:1 1 100%}.bar select{flex:1 1 45%;min-width:0}
 td>*{min-width:0}td{overflow-wrap:anywhere}
}
</style></head><body>
<header>
 <h1>ทะเบียนครุภัณฑ์ — มุมมองอ่านอย่างเดียว</h1>
 <div class="sub">ข้อมูล ณ ${asOf} น. · ไม่แสดงชื่อผู้ใช้งานและข้อมูลราคา</div>
 <div class="bar">
  <input id="q" type="search" placeholder="ค้นหา เลขครุภัณฑ์ / เลข B / ชื่อ / ห้อง…" autocomplete="off">
  <select id="fs"><option value="">ทุกสถานะ</option></select>
  <select id="ft"><option value="">ทุกประเภท</option></select>
  <select id="fy"><option value="">ทุกปีงบประมาณ</option></select>
  <select id="sortm"><option value="">เรียงตาม…</option></select>
 </div>
 <div class="stats" id="stats"></div>
</header>
<main><table><thead><tr id="hr"></tr></thead><tbody id="tb"></tbody></table><div id="empty" class="empty" hidden>ไม่พบรายการ</div></main>
<footer>ปีงบประมาณคำนวณจากวันที่ได้มา (ต.ค.–ก.ย.) · หน้านี้เป็นสำเนาแบบคงที่ ไม่เชื่อมต่อฐานข้อมูล</footer>
<script id="data" type="application/json">${json}</script>
<script>
(function(){
var D=JSON.parse(document.getElementById('data').textContent);
var COLS=[['tag','เลขครุภัณฑ์'],['b','เลข B'],['name','รายการ'],['type','ประเภท'],['date','วันที่ได้มา'],['fy','ปีงบ'],['qty','จำนวน'],['loc','ห้อง/สถานที่'],['status','สถานะ']];
var $=function(id){return document.getElementById(id)};
var sortKey='tag',sortDir=1;
function uniq(k){var s={};D.forEach(function(r){if(r[k]!==''&&r[k]!=null)s[r[k]]=1});return Object.keys(s).sort(function(a,b){return a.localeCompare(b,'th',{numeric:true})})}
function fill(sel,vals){vals.forEach(function(v){var o=document.createElement('option');o.value=o.textContent=v;sel.appendChild(o)})}
fill($('fs'),uniq('status'));fill($('ft'),uniq('type'));fill($('fy'),uniq('fy').reverse());
COLS.forEach(function(c){var th=document.createElement('th');th.textContent=c[1];th.dataset.k=c[0];th.onclick=function(){setSort(c[0])};$('hr').appendChild(th);
 [1,-1].forEach(function(d){var o=document.createElement('option');o.value=c[0]+':'+d;o.textContent=c[1]+(d>0?' ▲':' ▼');$('sortm').appendChild(o)})});
function setSort(k,d){if(d){sortDir=d}else{sortDir=(sortKey===k)?-sortDir:1}sortKey=k;render()}
$('sortm').onchange=function(){if(this.value){var p=this.value.split(':');setSort(p[0],+p[1])}};
function dkey(s){var m=/^(\\d+)\\/(\\d+)\\/(\\d+)$/.exec(s||'');return m?(+m[3])*10000+(+m[2])*100+(+m[1]):-1}
function cmp(a,b){var x=a[sortKey],y=b[sortKey];
 if(sortKey==='date'){x=dkey(x);y=dkey(y)}
 if(x===''||x==null)return 1;if(y===''||y==null)return -1;
 if(typeof x==='number'&&typeof y==='number')return (x-y)*sortDir;
 return String(x).localeCompare(String(y),'th',{numeric:true})*sortDir}
function td(tr,label,cls,text){var c=document.createElement('td');c.dataset.l=label;if(cls)c.className=cls;if(text!=null)c.textContent=text;tr.appendChild(c);return c}
function render(){
 var q=$('q').value.trim().toLowerCase(),fs=$('fs').value,ft=$('ft').value,fy=$('fy').value;
 var rows=D.filter(function(r){
  if(fs&&r.status!==fs)return false;if(ft&&r.type!==ft)return false;if(fy&&r.fy!==fy)return false;
  if(!q)return true;return [r.tag,r.tag2,r.b,r.name,r.loc,r.type].join(' ').toLowerCase().replace(/\\s+/g,' ').indexOf(q)>=0||[r.tag,r.tag2,r.b,r.loc].join(' ').toLowerCase().replace(/\\s+/g,'').indexOf(q.replace(/\\s+/g,''))>=0});
 rows.sort(cmp);
 document.querySelectorAll('th').forEach(function(th){th.className=th.dataset.k===sortKey?(sortDir>0?'asc':'desc'):''});
 var tb=$('tb'),f=document.createDocumentFragment();
 rows.forEach(function(r){var tr=document.createElement('tr');
  var c=td(tr,'เลขครุภัณฑ์','c-tag');var s=document.createElement('span');s.className='tag';s.textContent=r.tag||'—';c.appendChild(s);
  if(r.tag2){var s2=document.createElement('span');s2.className='tag2';s2.textContent='เลขอื่น: '+r.tag2;s.appendChild(s2)}
  td(tr,'เลข B','mono'+(r.b?'':' muted'),r.b||'—');
  td(tr,'รายการ','',r.name);td(tr,'ประเภท','muted',r.type);
  td(tr,'วันที่ได้มา','mono',r.date||'—');td(tr,'ปีงบ','mono',r.fy||'—');td(tr,'จำนวน','mono',r.qty===''?'—':r.qty);
  td(tr,'ห้อง/สถานที่','mono',r.loc||'—');
  var sc=td(tr,'สถานะ');var b=document.createElement('span');b.className='st '+(r.retired?'ret':r.status==='ใช้งานได้'?'ok':'bad');b.textContent=r.status;sc.appendChild(b);
  f.appendChild(tr)});
 tb.replaceChildren(f);$('empty').hidden=rows.length>0;
 var cnt=function(st){return rows.filter(function(r){return r.status===st}).length};
 $('stats').innerHTML='';[['แสดง',rows.length+' / '+D.length],['ใช้งานได้',cnt('ใช้งานได้')],['ชำรุด',cnt('ชำรุด')],['จำหน่ายแล้ว',cnt('จำหน่ายแล้ว')]].forEach(function(x){var e=document.createElement('span');e.className='chip';e.textContent=x[0]+' ';var bb=document.createElement('b');bb.textContent=x[1];e.appendChild(bb);$('stats').appendChild(e)})}
['q','fs','ft','fy'].forEach(function(id){$(id).addEventListener('input',render)});
render();
})();
</script></body></html>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');
console.log(`OK: ${rows.length} rows -> ${outPath}`);
console.log(`ข้อมูล ณ ${asOf}`);
