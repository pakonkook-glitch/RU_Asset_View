const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root='C:/Users/MyCom/RU_Asset_View/';
async function testFront(){
 const store=new Map([['ru_sync_cfg_v1',JSON.stringify({api:'https://example.invalid/exec',token:'local-test-only'})]]);
 const anchor={parentNode:{insertBefore(){}}},buttonList=[];
 const doc={querySelector(){return anchor},createElement(t){let x={style:{},append(){},setAttribute(){},parentNode:{}};if(t==='button')buttonList.push(x);return x},body:{prepend(){}}};
 let applied=0,updated=0;
 const w={RUAssetPage:{apply(a){applied=a.length}},addEventListener(){},dispatchEvent(){updated++}};
 const ctx={document:doc,window:w,localStorage:{getItem(k){return store.get(k)||null},setItem(k,v){store.set(k,v)}},AbortController,Event:class{constructor(t){this.type=t}},setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>({ok:true,assets:Array.from({length:120},(_,i)=>({key:'r'+(i+1),asset_no:'X'+i}))})}),Date,Set,JSON,Error};
 vm.runInNewContext(fs.readFileSync(root+'asset-hub.js','utf8'),ctx);
 await buttonList[0].onclick();
 assert.equal(applied,120);assert.equal(updated,1);assert.equal(JSON.parse(store.get('ru_asset_master_cache_v1')).assets.length,120);
}
function testBackend(){
 const v=[['key','asset_no','assignee','updated_at'],['r1','100','Old',''],['r2','200','','']];
 const sh={getLastColumn(){return v[0].length},getLastRow(){return v.length},getDataRange(){return {getDisplayValues:()=>v.map(r=>r.slice())}},getRange(row,col,nrow=1,ncol=1){return {getDisplayValues(){return v.slice(row-1,row-1+nrow).map(r=>r.slice(col-1,col-1+ncol))},getDisplayValue(){return v[row-1][col-1]},setNumberFormat(){return this},setValue(value){v[row-1][col-1]=value;return this}}}};
 const ctx={SpreadsheetApp:{openById:()=>({getSheetByName:()=>sh}),flush(){}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},DriveApp:{},PropertiesService:{},Utilities:{},Date,JSON,String,Object,Array,Error};
 vm.runInNewContext(fs.readFileSync(root+'scripts/ru-asset-hub-addon.gs','utf8'),ctx);
 const before=ctx.ruGetAssets_();assert.equal(before.count,2);assert.equal(before.assets[0].asset_no,'100');
 const result=ctx.ruApplyAssetChanges_({changes:[{key:'r1',asset_no:'101',expectedOld:'100',assignee:'New'},{key:'r2',asset_no:'201',expectedOld:'WRONG'}]});
 assert.equal(result.results[0].ok,true);assert.equal(result.results[1].ok,false);assert.equal(v[1][1],'101');assert.equal(v[1][2],'New');assert.equal(v[2][1],'200');
 const duplicate=ctx.ruApplyAssetChanges_({changes:[{key:'r1',asset_no:'200',expectedOld:'101'}]});
 assert.equal(duplicate.results[0].ok,false);
 assert.match(duplicate.results[0].error,/already used/);
 assert.equal(v[1][1],'101');
 const rerun=ctx.ruApplyAssetChanges_({changes:[{key:'r1',asset_no:'101',expectedOld:'100'}]});
 assert.equal(rerun.results[0].ok,true);
 assert.equal(v[1][1],'101');
}
Promise.resolve().then(testFront).then(testBackend).then(()=>console.log('PASS: hub fetch/cache + master read/write/conflict')).catch(e=>{console.error(e);process.exitCode=1});
