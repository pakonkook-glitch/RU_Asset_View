// RU Asset DB unified backend: functions are callable only after handle_(b) validates TOKEN.
// Add routes in handle_ AFTER the existing TOKEN check:
// if (b.action === 'getAssets') return ruGetAssets_(b);
// if (b.action === 'applyAssetChanges') return ruApplyAssetChanges_(b);
// if (b.action === 'photoPut') return ruPutPhoto_(b);
// if (b.action === 'photoGet') return ruGetPhoto_(b);
// Keep existing getAll/upsertMany for legacy history, not as a source of truth.
var RU_MASTER_ID='1G8eqgP70r4gLdcDTbGa3f7uKMVV-i7VdvnFUU5gvhp4';
var RU_MASTER_FIELDS=['key','asset_name','asset_no','asset_no_alt','barcode','serial_no',
 'category','location','condition','status','acquired_date_be','fiscal_year','assignee',
 'updated_at','ru_photo_id','ru_photo_thumb','ru_photo_removed'];
function ruMaster_(){
 var sh=SpreadsheetApp.openById(RU_MASTER_ID).getSheetByName('assets');
 if(!sh)throw new Error('RU Asset DB: assets sheet missing');
 var header=sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0],h={};
 header.forEach(function(x,i){h[x]=i+1});
 if(!h.key||!h.asset_no||!h.assignee)throw new Error('RU Asset DB: missing key, asset_no or assignee');
 return {sh:sh,h:h};
}
function ruColumn_(o,k){
 if(o.h[k])return o.h[k];
 var col=o.sh.getLastColumn()+1;
 o.sh.getRange(1,col).setValue(k);o.h[k]=col;
 return col;
}
function ruIndex_(o){
 var col=o.h.key;
 var keys=o.sh.getRange(2,col,Math.max(1,o.sh.getLastRow()-1),1).getDisplayValues(),idx={};
 keys.forEach(function(r,i){if(!r[0])return;if(idx[r[0]])idx[r[0]]=-1;else idx[r[0]]=i+2});
 return idx;
}
function ruCellText_(v,max){
 var s=String(v===null||v===undefined?'':v).trim();
 if(s.length>max)throw new Error('Text too long');
 // Store as plain text, not a spreadsheet formula.
 return /^[=+\-@]/.test(s)?"'"+s:s;
}
function ruGetAssets_(){
 var o=ruMaster_(),h=o.h,values=o.sh.getDataRange().getDisplayValues(),out=[];
 for(var i=1;i<values.length;i++){
  var row=values[i];if(!row[h.key-1])continue;var obj={};
  RU_MASTER_FIELDS.forEach(function(k){obj[k]=h[k]?String(row[h[k]-1]||''):''});
  out.push(obj);
 }
 return {ok:true,assets:out,count:out.length,server_time:new Date().toISOString()};
}
function ruApplyAssetChanges_(b){
 var changes=b.changes;if(!Array.isArray(changes)||changes.length<1||changes.length>200)
  throw new Error('Invalid changes size (1..200)');
 var lock=LockService.getScriptLock();lock.waitLock(20000);
 try{
  var o=ruMaster_(),idx=ruIndex_(o),seen={},results=[],now=new Date().toISOString();
  changes.forEach(function(c){
   var k=String(c&&c.key||'').trim();
   try{
    if(!/^r\d+$/.test(k)||seen[k])throw new Error('Invalid or repeated key');
    seen[k]=true;
    var ri=idx[k];if(!ri||ri===-1)throw new Error('Asset key missing or duplicated');
    var changesMade=[];
    if(Object.prototype.hasOwnProperty.call(c,'asset_no')){
     if(!Object.prototype.hasOwnProperty.call(c,'expectedOld'))throw new Error('Missing expectedOld');
     var cell=o.sh.getRange(ri,o.h.asset_no);
     var old=String(cell.getDisplayValue()).trim();
     var next=String(c.asset_no||'').trim();
     if(!next||next.length>200)throw new Error('Invalid asset number');
     if(old!==String(c.expectedOld||'').trim()&&old!==next)throw new Error('Number conflict');
     if(old!==next){
      var vals=o.sh.getRange(2,o.h.asset_no,Math.max(1,o.sh.getLastRow()-1),1).getDisplayValues();
      for(var z=0;z<vals.length;z++){
       if(z+2!==ri&&String(vals[z][0]).trim()===next)throw new Error('Asset number already used by another key');
      }
     }
     if(old!==next){cell.setNumberFormat('@');cell.setValue(ruCellText_(next,200));changesMade.push('asset_no')}
    }
    if(Object.prototype.hasOwnProperty.call(c,'assignee')){
     var asg=String(c.assignee||'').trim();
     var ac=o.sh.getRange(ri,o.h.assignee);
     if(String(ac.getDisplayValue()).trim()!==asg){ac.setNumberFormat('@');ac.setValue(ruCellText_(asg,250));changesMade.push('assignee')}
    }
    if(changesMade.length){
     ruColumn_(o,'updated_at');
     o.sh.getRange(ri,o.h.updated_at).setValue(now);
    }
    results.push({key:k,ok:true,fields:changesMade});
   }catch(e){results.push({key:k,ok:false,error:String(e.message||e)})}
  });
  SpreadsheetApp.flush();
  results.forEach(function(r){
   if(!r.ok||!r.fields||!r.fields.length)return;
   var c=changes.filter(function(x){return String(x.key)===r.key})[0],ri=idx[r.key];
   if(r.fields.indexOf('asset_no')>=0){
    var value=String(o.sh.getRange(ri,o.h.asset_no).getDisplayValue()).trim();
    if(value!==String(c.asset_no).trim()){r.ok=false;r.error='Number readback mismatch'}
   }
   if(r.ok&&r.fields.indexOf('assignee')>=0){
    var a=String(o.sh.getRange(ri,o.h.assignee).getDisplayValue()).trim();
    if(a!==String(c.assignee||'').trim()){r.ok=false;r.error='Assignee readback mismatch'}
   }
  });
  return {ok:true,results:results,server_time:now};
 }finally{lock.releaseLock()}
}
function ruPhotoFolder_(){
 var p=PropertiesService.getScriptProperties(),id=p.getProperty('RU_PHOTO_FOLDER');
 if(id){try{return DriveApp.getFolderById(id)}catch(e){}}
 var folder=DriveApp.createFolder('RU_Asset_DB_Photos_PRIVATE');
 p.setProperty('RU_PHOTO_FOLDER',folder.getId());return folder;
}
function ruPutPhoto_(b){
 var key=String(b.key||'');
 if(!/^r\d+$/.test(key))throw new Error('Invalid key');
 var act=String(b.act||'set');
 if(act!=='set'&&act!=='del')throw new Error('Invalid photo action');
 var lock=LockService.getScriptLock();lock.waitLock(20000);
 try{
  var o=ruMaster_(),idx=ruIndex_(o),ri=idx[key];
  if(!ri||ri===-1)throw new Error('Asset key missing or duplicated');
  var idCol=ruColumn_(o,'ru_photo_id'),thCol=ruColumn_(o,'ru_photo_thumb'),rmCol=ruColumn_(o,'ru_photo_removed');
  var fid='',thumb='';
  if(act==='set'){
   if(!/^[A-Za-z0-9+/=]+$/.test(String(b.b64||''))||String(b.b64).length>2100000)
    throw new Error('Invalid photo payload');
   thumb=String(b.th||'');
   if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(thumb)||thumb.length>45000)
    throw new Error('Thumbnail missing or too large');
   var bytes=Utilities.base64Decode(String(b.b64)),blob=Utilities.newBlob(bytes,'image/jpeg',key+'-'+Date.now()+'.jpg');
   var f=ruPhotoFolder_().createFile(blob);fid=f.getId();
  }
  o.sh.getRange(ri,idCol).setValue(fid);
  o.sh.getRange(ri,thCol).setValue(thumb);
  o.sh.getRange(ri,rmCol).setValue(act==='del'?'1':'');
  if(o.h.updated_at)o.sh.getRange(ri,o.h.updated_at).setValue(new Date().toISOString());
  SpreadsheetApp.flush();
  if(String(o.sh.getRange(ri,idCol).getDisplayValue())!==fid)throw new Error('Photo id readback mismatch');
  return {ok:true,key:key,fid:fid,act:act};
 }finally{lock.releaseLock()}
}
function ruGetPhoto_(b){
 var key=String(b.key||'');if(!/^r\d+$/.test(key))throw new Error('Invalid key');
 var o=ruMaster_();if(!o.h.ru_photo_id)throw new Error('No uploaded photos');
 var ri=ruIndex_(o)[key];if(!ri||ri===-1)throw new Error('Key not found');
 var id=o.sh.getRange(ri,o.h.ru_photo_id).getDisplayValue();
 if(!id)throw new Error('No photo for key');
 var blob=DriveApp.getFileById(id).getBlob();
 return {ok:true,key:key,mime:blob.getContentType(),b64:Utilities.base64Encode(blob.getBytes())};
}
