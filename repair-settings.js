const repairSettingsMeta='repair-monitor-device-meta-v1';
let deletionBackup='';
let deletionVerified=false;
let deletionInProgress=false;

function deviceMeta(){
  try{return JSON.parse(localStorage.getItem(repairSettingsMeta)||'{}')||{};}
  catch{return {};}
}
function updateDeviceMeta(patch){
  try{localStorage.setItem(repairSettingsMeta,JSON.stringify({...deviceMeta(),...patch}));}
  catch{}
}
function formatDeviceTime(value){
  return value?new Date(value).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'}):'Belum tercatat';
}
function renderDeviceStatus(){
  const meta=deviceMeta(), deviceOnline=navigator.onLine;
  const badge=document.getElementById('headerSync');
  if(!badge)return;
  const pending=!!meta.pending;
  const offline=document.getElementById('offlineWorkspaceState');
  offline.hidden=deviceOnline;
  offline.textContent=db.projects.length?
    'Mode offline · menampilkan data terakhir yang tersimpan di perangkat ini.':
    'Belum ada data proyek di perangkat ini. Sambungkan internet dan sinkronkan untuk mengisi salinan offline.';
  const connection=!deviceOnline?'Offline':cloudReady?'Online · Cloud terhubung':'Online · Cloud belum terhubung';
  document.getElementById('headerSyncConnection').textContent=connection;
  document.getElementById('headerSyncTime').textContent='Sinkron terakhir: '+formatDeviceTime(meta.syncAt);
  document.getElementById('headerPending').hidden=!pending&&!cloudConflict;
  document.getElementById('headerPending').textContent=cloudConflict?'Konflik sinkronisasi · perubahan lokal tertahan':'Ada perubahan lokal belum terkirim';
  badge.dataset.status=pending||cloudConflict?'pending':'ready';
  document.getElementById('cloudAccountHelp').hidden=!cloudReady||!cloudSession;
  document.getElementById('cloudRetryButton').hidden=!cloudReady||!deviceOnline||!pending||cloudConflict;
  document.getElementById('backupLastMade').textContent='Backup terakhir di perangkat ini: '+formatDeviceTime(meta.backupAt);
  document.getElementById('backupReminder').hidden=!(db.projects.length||db.tasks.length||db.subs.length)||
    (!!meta.backupAt&&Date.now()-meta.backupAt<=7*86400000);
  document.getElementById('backupReminderText').textContent=meta.backupAt?
    'Backup terakhir dibuat lebih dari 7 hari lalu.':'Belum ada backup JSON yang tercatat di perangkat ini.';
}
function markDeviceSynced(snapshot){
  updateDeviceMeta({syncAt:Date.now(),pending:snapshot!==undefined&&localStorage.getItem(KEY)!==snapshot});
  renderDeviceStatus();
}
function retryCloudSync(){
  if(cloudSaveTimer){clearTimeout(cloudSaveTimer);cloudSaveTimer=null;}
  if(cloudReady&&!cloudConflict&&navigator.onLine&&deviceMeta().pending)enqueueWorkCloudSave(localStorage.getItem(KEY)||JSON.stringify(db));
}

function selectSettingsTab(name,focus=false){
  for(const tab of document.querySelectorAll('#settingsTabs [role=tab]')){
    const selected=tab.dataset.settingsTab===name;
    tab.setAttribute('aria-selected',String(selected));
    tab.tabIndex=selected?0:-1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden=!selected;
    if(selected&&focus)tab.focus();
  }
}
function openSettingsTab(name){
  go('settings');
  selectSettingsTab(name,true);
}
function initializeRepairSettings(){
  const tabs=document.getElementById('settingsTabs');
  tabs.addEventListener('keydown',event=>{
    const buttons=[...tabs.querySelectorAll('[role=tab]')];
    const index=buttons.indexOf(event.target);
    if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:
      (index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length;
    selectSettingsTab(buttons[next].dataset.settingsTab,true);
  });
  window.addEventListener('offline',renderDeviceStatus);
  window.addEventListener('online',()=>{renderDeviceStatus();retryCloudSync();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderDeviceStatus();});
  setInterval(renderDeviceStatus,60000);
  renderDeviceStatus();
}

function showFormError(input,message){
  alert(message);
  if(input?.disabled)input.form?.querySelector('input:not([type=hidden]):not(:disabled)')?.focus();
  else input?.focus();
  return false;
}
function validateRepairDates(form){
  const bad=[...form.querySelectorAll('input[type=date]')].find(input=>input.validity.badInput||(input.value&&!metricDate(input.value)));
  if(bad){
    const yr=Number(today().slice(0,4)),label=bad.closest('.field')?.querySelector('label')?.textContent||'Tanggal';
    return showFormError(bad,label+' harus valid dengan tahun '+(yr-2)+'–'+(yr+2)+'.');
  }
  const pairs={
    projectForm:[['pStart','pEnd','Target selesai internal','tanggal mulai rencana'],['pStart','pPromisedReturn','Target kembali ke customer','tanggal mulai rencana'],['pReceivedDate','pReturnedDate','Tanggal kembali aktual','tanggal pompa diterima']],
    taskForm:[['tStart','tEnd','Target selesai tugas','tanggal mulai rencana']],
    subForm:[['sPlanStart','sDue','Target selesai subtugas','tanggal mulai rencana'],['sActualStart','sActualEnd','Tanggal selesai aktual','tanggal mulai aktual']],
    wbsForm:[['wbsStart','wbsDue','Target selesai proses WBS','tanggal mulai rencana']]
  };
  for(const [startId,endId,label,startLabel] of pairs[form.id]||[]){
    const start=form.querySelector('#'+startId),end=form.querySelector('#'+endId);
    if(start?.value&&end?.value&&end.value<start.value)return showFormError(end,label+' tidak boleh sebelum '+startLabel+'.');
  }
  return true;
}
function normalizedJobNumber(value){
  return String(value||'').normalize('NFKC').replace(/\s+/g,'').toUpperCase();
}
function validateProjectJobNumber(input,id,projects){
  const code=normalizedJobNumber(input.value);
  const original=projects.find(p=>p.id===id);
  // Existing duplicate identifiers remain editable until their number is changed.
  if(!code||(original&&normalizedJobNumber(original.code)===code))return true;
  const duplicate=projects.find(p=>p.id!==id&&normalizedJobNumber(p.code)===code);
  return !duplicate||showFormError(input,'Nomor SO / Job No. sudah dipakai oleh proyek “'+duplicate.name+'”. Gunakan nomor yang berbeda.');
}
function dependencyPath(id,predecessors,subs){
  if(!id)return [];
  const byId=new Map(subs.map(sub=>[sub.id,sub]));
  const stack=predecessors.map(dep=>({dep,path:[dep]}));
  const visited=new Set();
  while(stack.length){
    const {dep,path}=stack.pop();
    if(dep===id)return [id,...path];
    if(visited.has(dep))continue;
    visited.add(dep);
    for(const next of byId.get(dep)?.dependsOn||[])stack.push({dep:next,path:[...path,next]});
  }
  return [];
}
function validateSubDependencies(id,predecessors,selection){
  const cycle=dependencyPath(id,predecessors,db.subs);
  if(!cycle.length)return true;
  const names=cycle.map(key=>key===id?sName.value:db.subs.find(sub=>sub.id===key)?.name||key);
  return showFormError(selection.querySelector('input:checked'),'Dependensi melingkar: '+names.join(' → ')+'. Lepaskan salah satu dependensi.');
}

function exportData(snapshot=JSON.stringify(db,null,2)){
  const time=new Date();
  const name='Repair-Monitor-Backup-'+time.toISOString().slice(0,19).replace(/:/g,'-')+'.json';
  saveRepairFile(new Blob([snapshot],{type:'application/json;charset=utf-8'}),name);
  updateDeviceMeta({backupAt:time.getTime()});
  renderDeviceStatus();
  toast('Unduhan backup JSON dimulai.');
}

function resetDataDeletion(){
  deletionBackup='';
  deletionVerified=false;
  document.getElementById('deleteDataForm').reset();
  document.getElementById('deleteBackupFile').disabled=true;
  document.getElementById('deleteFinalButton').disabled=true;
  document.getElementById('deleteDataStatus').textContent='';
}
function clearAll(){
  if(deletionInProgress)return;
  resetDataDeletion();
  document.getElementById('deleteDataScope').textContent=cloudReady?
    'Data proyek, tugas, subtugas, dan riwayat akan dihapus dari browser dan disinkronkan ke cloud.':
    'Data proyek, tugas, subtugas, dan riwayat akan dihapus dari browser ini.';
  openModal('deleteDataModal');
  document.getElementById('deleteDataWord').focus();
}
function downloadDeletionBackup(){
  if(deletionInProgress)return;
  if(document.getElementById('deleteDataWord').value!=='HAPUS'){
    showFormError(document.getElementById('deleteDataWord'),'Ketik HAPUS dengan huruf besar untuk memulai.');
    return;
  }
  deletionBackup=JSON.stringify(db,null,2);
  deletionVerified=false;
  const input=document.getElementById('deleteBackupFile');
  input.value='';
  document.getElementById('deleteFinalButton').disabled=true;
  exportData(deletionBackup);
  input.disabled=false;
  document.getElementById('deleteDataStatus').textContent='Pilih file backup JSON yang baru diunduh untuk memverifikasi salinan.';
}
async function verifyDeletionBackup(input){
  const snapshot=deletionBackup;
  deletionVerified=false;
  document.getElementById('deleteFinalButton').disabled=true;
  const file=input.files[0];
  if(!file||!snapshot)return;
  let matches=false;
  try{matches=await file.text()===snapshot;}catch{}
  if(snapshot!==deletionBackup||file!==input.files[0])return;
  deletionVerified=matches;
  document.getElementById('deleteFinalButton').disabled=!matches;
  document.getElementById('deleteDataStatus').textContent=matches?
    'Backup cocok. Hapus data jika sudah yakin.':'File tidak cocok dengan backup terbaru. Pilih file yang baru diunduh.';
}
async function confirmDataDeletion(event){
  event.preventDefault();
  if(deletionInProgress||!deletionVerified||document.getElementById('deleteDataWord').value!=='HAPUS')return;
  const status=document.getElementById('deleteDataStatus');
  if(cloudReady&&(!navigator.onLine||cloudConflict)){
    status.textContent='Hubungkan cloud dan selesaikan konflik sinkronisasi sebelum menghapus.';
    return;
  }
  if(deletionBackup!==JSON.stringify(db,null,2)){
    deletionVerified=false;
    document.getElementById('deleteFinalButton').disabled=true;
    status.textContent='Data berubah sejak backup dibuat. Unduh dan pilih backup terbaru.';
    return;
  }
  deletionInProgress=true;
  const button=document.getElementById('deleteFinalButton');
  button.disabled=true;
  const connected=cloudReady;
  try{
    if(connected)await flushWorkCloud();
    if(deletionBackup!==JSON.stringify(db,null,2)||connected!==cloudReady)throw Error('Data atau koneksi berubah. Ulangi langkah backup.');
    const cleared={projects:[],tasks:[],subs:[],activity:[]};
    if(connected){
      const result=await cloudApi('put_state',{payload:cleared,expectedRevision:cloudRevision});
      cloudRevision=result.revision;
    }
    db=cleared;
    localStorage.setItem(KEY,JSON.stringify(db));
    if(connected)markDeviceSynced();
    else updateDeviceMeta({pending:false});
    renderAll();
    renderDeviceStatus();
    closeModal('deleteDataModal');
    resetDataDeletion();
    toast('Data dihapus. Backup JSON telah diverifikasi.');
  }catch(error){
    status.textContent='Penghapusan gagal: '+error.message;
    button.disabled=false;
  }finally{deletionInProgress=false;}
}
