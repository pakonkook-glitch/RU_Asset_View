// Deterministic MOCK network + minimal DOM. No live credentials or services.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('asset-hub.js','utf8');
function setup({publicPage=false,loggedIn=true,fetcher}={}){
  const nodes=new Map(),requests=[],applied=[];
  function element(){return {style:{},dataset:{},append(){},prepend(){},insertAdjacentElement(){},querySelector(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id)}}}
  const stored=new Map();
  if(loggedIn)stored.set('ru_supabase_session_cmmcyyonkpihqlfhtnzw',JSON.stringify({access_token:'MOCK',refresh_token:'MOCK_REFRESH',expires_at:9999999999,user:{id:'MOCK_USER'}}));
  const window={location:{pathname:publicPage?'/index.html':'/edit.html'},addEventListener(){},localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},RUAssetPage:{apply:rows=>applied.push(rows)}};
  const context=vm.createContext({window,document:{createElement:element,querySelector:()=>null,body:element()},URL,Date,Uint8Array,crypto:webcrypto,atob,Blob,console,setTimeout(){},confirm:()=>true,fetch:async(url,options)=>{requests.push({url,options});return fetcher(url,options)}});
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.testHub={sessionWithExpiry,invalidateSession,saveSession,ASSET_COLUMNS,signPrivatePhotos};})();'),context);
  return {hub:window.RUAssetHub,internals:window.testHub,requests,applied,nodes};
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','content-range':`0-0/${Array.isArray(data)?data.length:1}`}});
function row(h){return Object.assign(Object.fromEntries(Array.from(h.internals.ASSET_COLUMNS,k=>[k,''])),{key:'r1',revision:1,deleted_at:null})}
test('MOCK: public always uses anonymous approved columns even with admin session; 341 rows',async()=>{
  const h=setup({publicPage:true,fetcher:()=>json(Array.from({length:341},(_,i)=>({key:'r'+(i+1)})))});
  assert.equal((await h.hub.call({action:'getAssets'})).assets.length,341);
  const req=h.requests[0];assert.equal(req.options.headers.Authorization,undefined);assert.equal(req.options.cache,'no-store');
  const select=new URL(req.url).searchParams.get('select');assert(!select.includes('*'));assert(!select.includes('assignee'));assert(!select.includes('ru_photo_id'));
  await assert.rejects(h.hub.call({action:'createAsset',fields:{asset_name:'x'}}));assert.equal(h.requests.length,1);
});
test('MOCK: unauthenticated private reads and writes make no network requests',async()=>{
  const h=setup({loggedIn:false,fetcher:()=>{throw Error('unexpected network')}});
  await assert.rejects(h.hub.call({action:'getAssets'}));await assert.rejects(h.hub.call({action:'updateAsset',key:'r1',changes:{status:'ok'}}));assert.equal(h.requests.length,0);
});
test('MOCK: update fields requires PATCH and matching GET revision',async()=>{
  let db;const h=setup({fetcher:(url,o)=>{if(o.method==='PATCH')db={...db,...JSON.parse(o.body),revision:2};return json([db])}});db=row(h);
  const result=await h.hub.call({action:'updateAsset',key:'r1',changes:{asset_no:'N1',assignee:'MOCK STAFF',status:'ok'},expectedRevision:1});
  assert.equal(result.asset.asset_no,'N1');assert.deepEqual(h.requests.map(x=>x.options.method),['GET','PATCH','GET']);
});
for(const failure of ['mismatch','denied','zero rows','GET fails'])test('MOCK: no success on '+failure,async()=>{
  let db,written=false;const h=setup({fetcher:(url,o)=>{if(o.method==='PATCH'){written=true;if(failure==='denied')return json({message:'denied'},403);if(failure==='zero rows')return json([]);return json([{...db,status:'ok',revision:2}])}if(written&&failure==='GET fails')throw Error('offline');return json([db])}});db=row(h);
  await assert.rejects(h.hub.call({action:'updateAsset',key:'r1',changes:{status:'ok'},expectedRevision:1}));
});
test('MOCK: create and soft delete each have authoritative GET',async()=>{
  let db;const h=setup({fetcher:(url,o)=>{if(o.method==='POST'){db={...row(h),...JSON.parse(o.body)};return json([db])}if(o.method==='PATCH')db={...db,...JSON.parse(o.body),revision:db.revision+1};return json(db?[db]:[])}});
  const created=await h.hub.call({action:'createAsset',fields:{asset_name:'MOCK ASSET'}});assert.equal(created.asset.key,'r1');
  const deleted=await h.hub.call({action:'softDelete',key:'r1',expectedRevision:1});assert(deleted.asset.deleted_at);assert.equal(h.requests.at(-1).options.method,'GET');
});
test('MOCK: refresh expiry is recomputed and private refresh works',async()=>{
  let db;const h=setup({fetcher:(url)=>url.includes('/auth/')?json({access_token:'NEW_MOCK',refresh_token:'NEXT_MOCK',expires_in:3600,user:{id:'MOCK_USER'}}):json([db])});db=row(h);
  h.internals.saveSession({access_token:'OLD_MOCK',refresh_token:'MOCK_REFRESH',expires_at:1,user:{id:'MOCK_USER'}});
  assert.equal(await h.hub.refresh(),true);assert.equal(h.requests.filter(r=>r.url.includes('/auth/')).length,1);
  assert(h.internals.sessionWithExpiry({expires_in:3600},{expires_at:1}).expires_at>Date.now()/1000);
});
test('MOCK: logout while read is pending cannot repopulate private page',async()=>{
  let release;const h=setup({fetcher:()=>new Promise(r=>{release=r})});const reading=h.hub.refresh();
  while(!release)await Promise.resolve();h.internals.invalidateSession();release(json([row(h)]));assert.equal(await reading,false);assert.equal(h.applied.at(-1).length,0);
});
test('MOCK: JPEG upload checks stored bytes then metadata GET; removal preserves storage',async()=>{
  const bytes=Uint8Array.from([255,216,1,2,3,4,5,6,7,8,255,217]);let db;
  const h=setup({fetcher:(url,o)=>{if(url.includes('/storage/'))return o.method==='POST'?json({Key:'mock'}):new Response(bytes,{headers:{'content-type':'image/jpeg'}});if(o.method==='PATCH')db={...db,...JSON.parse(o.body),revision:db.revision+1};return json([db])}});db=row(h);
  const result=await h.hub.call({action:'photoPut',key:'r1',act:'set',b64:Buffer.from(bytes).toString('base64'),th:'MOCK_THUMB'});assert.equal(result.status,'success');assert.match(db.ru_photo_id,/^r1\//);
  await h.hub.call({action:'photoPut',key:'r1',act:'del'});assert.equal(db.ru_photo_removed,'1');assert(!h.requests.some(r=>r.options.method==='DELETE'));
});
test('all inline page scripts parse; assign has no automatic photo writes',()=>{
  for(const file of ['index.html','edit.html','assign.html']){
    const html=fs.readFileSync(file,'utf8');for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/src=|application\/json/i.test(m[1]))continue;new vm.Script(m[2],{filename:file})}
  }
  const assign=fs.readFileSync('assign.html','utf8');assert(!/setTimeout\(photoSync/.test(assign));assert(!/if\(k==='r108'\)/.test(assign));
});
