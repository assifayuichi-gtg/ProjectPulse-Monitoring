let auditEntries=[];
const agentScoreReasons=[
  '0 · Pekerjaan pendahulu belum selesai',
  '1 · Target sudah terlewati',
  '2 · Pekerjaan berada di jalur kritis',
  '3 · Progres belum diperbarui',
  '4 · Target dalam 7 hari',
  '5 · PIC belum ditetapkan'
];

function picReminderText(links=[]){
  return ['Halo, mohon perbarui progres pekerjaan di Repair Monitor. Terima kasih.',...links].join('\n\n');
}

async function createManagedPicLink(event){
  event.preventDefault();
  const form=event.currentTarget;
  const pic=form.elements.pic.value.trim();
  const mode=form.elements.mode.value;
  const status=document.getElementById('managedLinkStatus');
  const output=document.getElementById('managedLinkUrl');
  output.value='';output.hidden=true;
  if(!cloudReady){status.textContent='Login sebagai admin dan sinkronkan cloud terlebih dahulu.';return;}
  const items=getMassPicItems(pic).filter(item=>item.pic&&woSamePic(item.pic,pic));
  if(!items.length||items.length>100){
    status.textContent=items.length?'Cakupan melebihi 100 pekerjaan. Gunakan tautan per tugas untuk membaginya.':'PIC ini belum memiliki pekerjaan terbuka yang ditugaskan langsung.';
    return;
  }
  const button=form.querySelector('button');
  button.disabled=true;
  status.textContent='Membuat tautan…';
  try{
    const response=await cloudApi('create_pic_link',{pic,linkMode:mode,items,payload:{project:'Pekerjaan yang ditugaskan',task:'Pembaruan PIC'},expiresDays:14});
    output.value=response.link;
    output.hidden=false;
    output.focus();output.select();
    status.textContent='Salin tautan ini untuk PIC yang dituju. Kuota '+response.max_submissions+' pengiriman; berlaku 14 hari.';
    await loadPicLinks();
  }catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
}

function agentActionVersion(signal){
  return [signal.progress,signal.score,subLastUpdate(signal.s)||''].join(':');
}
function agentSignalVisible(signal,now=Date.now()){
  const action=(db.agentActions||[]).find(item=>item.id===signal.s.id);
  return !action||action.until<=now||action.version!==agentActionVersion(signal);
}
function setAgentAction(id,action){
  const signal=collectAgentSignals().find(item=>item.s.id===id);
  if(!signal)return;
  const previous=(db.agentActions||[]).filter(item=>item.id!==id&&item.until>Date.now());
  db.agentActions=[...previous,{id,action,until:Date.now()+86400000,version:agentActionVersion(signal)}];
  save();
  toast(action==='snooze'?'Tindak lanjut ditunda 24 jam.':'Ditandai sudah ditindaklanjuti selama 24 jam.');
}
function restoreAgentAction(id){
  db.agentActions=(db.agentActions||[]).filter(item=>item.id!==id);
  save();
}
function renderAgentActionHistory(all){
  const panel=document.getElementById('agentActionHistory');
  const deferred=all.filter(signal=>!agentSignalVisible(signal));
  const rows=deferred.map(signal=>{
    const record=(db.agentActions||[]).find(item=>item.id===signal.s.id);
    return '<div class="project-row"><strong>'+esc(signal.s.name)+'</strong><p class="muted">'+esc(record.action==='snooze'?'Ditunda':'Sudah ditindaklanjuti')+
      ' · sampai '+esc(new Date(record.until).toLocaleString('id-ID'))+'</p><button class="btn-plain mini" data-id="'+esc(signal.s.id)+'" onclick="restoreAgentAction(this.dataset.id)">Tampilkan kembali</button></div>';
  }).join('');
  panel.innerHTML='<summary>Ditunda atau ditindaklanjuti ('+deferred.length+')</summary>'+(rows||'<p class="muted">Belum ada tindak lanjut yang ditandai.</p>');
}
function recordAgentWhatsApp(){
  const select=document.getElementById('agentPicSelect');
  const pic=select.value;
  if(!pic)return toast('Pilih PIC terlebih dahulu.');
  if(!confirm('Catat bahwa pesan WhatsApp sudah Anda kirim kepada '+pic+'?'))return;
  db.whatsAppLog=[{pic,date:new Date().toISOString(),by:activityActor('admin')},...(db.whatsAppLog||[])].slice(0,300);
  save();
  toast('Pengiriman dicatat.');
}
function renderAgentWhatsAppLog(){
  const pic=document.getElementById('agentPicSelect').value;
  const log=document.getElementById('agentWhatsAppHistory');
  const entries=(db.whatsAppLog||[]).filter(entry=>!pic||woSamePic(entry.pic,pic));
  log.innerHTML='<summary>Riwayat WhatsApp'+(pic?' · '+esc(pic):'')+' ('+entries.length+')</summary>'+
    (entries.map(entry=>'<div class="project-row"><strong>'+esc(entry.pic)+'</strong><small class="muted"> · '+esc(new Date(entry.date).toLocaleString('id-ID'))+' · Dicatat oleh '+esc(entry.by)+'</small></div>').join('')||
     '<p class="muted">Belum ada pengiriman yang dikonfirmasi.</p>');
}

function auditContext(entry){
  const change=(key)=>entry.changes?.[key]?.after??entry.changes?.[key]?.before;
  const sub=entry.entity==='subs'&&db.subs.find(item=>item.id===entry.entity_id);
  const task=entry.entity==='tasks'?taskOf(entry.entity_id):taskOf(sub?.taskId||change('taskId'));
  const projectId=entry.entity==='projects'?entry.entity_id:task?.projectId||change('projectId')||'';
  const project=db.projects.find(p=>p.id===projectId);
  const pics=[sub?.pic,task?.pic,project?.pic,entry.changes?.pic?.before,entry.changes?.pic?.after,
    entry.actor_kind==='pic'?entry.actor:null,entry.entity==='picDirectory'?entry.label:null].filter(Boolean);
  return {projectId,project:project?.name||'',pics};
}
function filteredProjectAudit(){
  const project=document.getElementById('auditFilterProject').value;
  const pic=document.getElementById('auditFilterPic').value.trim();
  const from=document.getElementById('auditFilterFrom').value;
  const to=document.getElementById('auditFilterTo').value;
  const formatter=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta'});
  if(from&&to&&from>to)return [];
  return auditEntries.filter(entry=>{
    const context=auditContext(entry), day=formatter.format(new Date(entry.recorded_at));
    return (!project||context.projectId===project)&&(!pic||context.pics.some(name=>woSamePic(name,pic)))&&(!from||day>=from)&&(!to||day<=to);
  });
}
function exportProjectAudit(){
  if(!cloudReady)return toast('Login sebagai admin untuk mengekspor riwayat.');
  const rows=filteredProjectAudit();
  if(!rows.length)return toast('Tidak ada riwayat sesuai filter.');
  saveRepairFile(new Blob([JSON.stringify(rows.map(entry=>({...entry,...auditContext(entry)})),null,2)],{type:'application/json'}),'Repair-Monitor-Riwayat-'+today()+'.json');
}
