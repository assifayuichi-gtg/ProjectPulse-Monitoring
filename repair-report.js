const evidenceBucket='repair-wbs-evidence';
const evidenceLimit=5*1024*1024;
const reportLibraries=new Map();
const evidencePreviews=new Set();

function reportDateRange(){
  const day=reportDate.value||today(), date=new Date(day+'T00:00:00Z');
  const iso=value=>value.toISOString().slice(0,10);
  if(reportType.value==='monthly'){
    return [day.slice(0,7)+'-01',iso(new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)))];
  }
  if(reportType.value==='weekly'){
    date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
    const start=iso(date);
    date.setUTCDate(date.getUTCDate()+6);
    return [start,iso(date)];
  }
  return [day,day];
}

function buildRepairReport(){
  const [start,end]=reportDateRange();
  const mode=document.getElementById('reportAudience').value;
  const customer=mode==='customer', picMode=reportType.value==='pic';
  const projectId=reportProject.value;
  const title=({daily:'Laporan Harian',weekly:'Laporan Mingguan',monthly:'Laporan Bulanan',pic:'Tindak Lanjut PIC'})[reportType.value];
  const unit=document.getElementById('reportUnit').value.trim()||'Repair Engineering';
  const author=document.getElementById('reportAuthor').value.trim();
  const m=computeMetrics(projectId,{includeDemo:false});
  const projects=new Map(m.projects.map(p=>[p.id,p]));
  const report={title,unit,author,customer,picMode,period:fmt(start)+(start===end?'':' – '+fmt(end)),sections:[],evidence:[]};
  if(customer&&(picMode||!projectId||projects.size!==1)){
    report.message='Pilih satu proyek dan jenis laporan harian, mingguan, atau bulanan untuk versi customer.';
    return report;
  }
  const text=value=>String(value??'').replace(/\|/g,' · ');
  const updateDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta'});
  const dateTime=stamp=>stamp.length>10?new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(stamp)):fmt(stamp);
  const projectTitle=task=>metricWorkTitle(projects.get(task.projectId));
  const section=(name,headers,rows,statusColumn)=>report.sections.push({name,headers,rows,statusColumn});
  const records=woFollowupRecords(db).filter(record=>projects.has(record.project.id));
  if(picMode){
    const pic=reportPic.value;
    if(!pic){report.message='Pilih PIC untuk membuat draf tindak lanjut.';return report;}
    const allowed=new Set(getWorkFollowup(pic).map(record=>record.item));
    section('Pekerjaan terbuka · '+text(pic),['Pekerjaan','Proyek','Target','Status','Progres'],records.filter(record=>allowed.has(record.item)).map(record=>[
      text(record.item.name),text(metricWorkTitle(record.project)),fmt(record.item.due),woDisplayStatus(record.item),(record.type==='sub'?subProgress(record.item):woRaw(record.item))+'%'
    ]),3);
    return report;
  }
  const summaries=woSummaries(db);
  const stateCounts=[
    ['Total proyek',m.projects.length],['Total subtugas',m.subs.length],['Selesai',m.done.length],
    ['Sedang dikerjakan',m.active.length],['Belum dikerjakan',m.pending.length],['Terlambat',m.overdue.length],
    ['Target dalam 7 hari',m.near.length],['Progres subtugas',m.subProgressIndex+'%'],['Progres rata-rata proyek',m.projectAverage+'%']
  ];
  report.metrics=stateCounts;
  const projectRows=m.projects.map(p=>[
    text(metricWorkTitle(p)),...(customer?[]:[text(p.pic||'—')]),fmt(p.promisedReturn||p.end),
    woAverage((summaries.get(p.id)||[]).map(row=>row.progress))+'%',projectStatus(p)
  ]);
  section('Ringkasan per proyek',['Proyek',...(customer?[]:['PIC']),'Target','Progres','Status'],projectRows,customer?3:4);

  const activities=[];
  for(const record of records){
    const {item,task,type}=record;
    const stamps=new Map();
    for(const event of item.history||[]){
      const stamp=String(event.updatedAt||event.date||'');
      if(event.source!=='import'&&Number.isFinite(Date.parse(stamp)))stamps.set(stamp,event);
    }
    const updated=String(item.lastUpdatedAt||'');
    if(['admin','pic'].includes(item.source)&&Number.isFinite(Date.parse(updated))){
      const latest=stamps.get(updated);
      stamps.set(updated,{progress:item.progress,status:item.status,...latest,note:latest?.note??item.note});
    }
    for(const [date,status] of [[item.actualStart,'Mulai aktual'],[item.actualEnd,'Selesai aktual']]){
      if(date&&Number.isFinite(Date.parse(date))&&![...stamps.keys()].some(stamp=>stamp.slice(0,10)===date))stamps.set(date,{status});
    }
    for(const [stamp,event] of stamps){
      const day=stamp.length>10?updateDay.format(new Date(stamp)):stamp;
      if(day<start||day>end)continue;
      const owner=woAssigned(item,type,task)||item.pic||'—';
      const status=Number(event.progress)>=100?'Selesai':event.status||'Diperbarui';
      const progress=event.progress!=null?' · '+Number(event.progress)+'%':'';
      activities.push({stamp,cells:[text(item.name),text(projectTitle(task)),...(customer?[]:[text(owner)]),
        text(status+progress),...(customer?[]:[text(event.note||'—')]),dateTime(stamp)]});
    }
  }
  activities.sort((a,b)=>b.stamp.localeCompare(a.stamp));
  section('Aktivitas pada periode',['Pekerjaan','Proyek',...(customer?[]:['PIC']),'Status',...(customer?[]:['Catatan']),'Waktu'],activities.map(activity=>activity.cells),customer?2:3);
  if(!customer){
    const groups=new Map();
    for(const sub of [...m.overdue].sort((a,b)=>a.due.localeCompare(b.due))){
      const task=m.taskMap.get(sub.taskId);
      const name=picRoute(dashboardOwner(sub,task)).person||'Belum ditetapkan';
      if(!groups.has(name))groups.set(name,{name,items:[],recommendation:''});
      const group=groups.get(name);
      group.items.push(text(sub.name)+' · '+text(projectTitle(task))+' · '+dd(sub.due,today())+' hari');
      if(!group.recommendation&&sub.recoveryPlan)group.recommendation=text(sub.recoveryPlan);
    }
    report.groups=[...groups.values()].map(group=>({...group,recommendation:group.recommendation||'Konfirmasi kendala, tindakan pemulihan, dan estimasi selesai dengan PIC.'}));
  }
  if(document.getElementById('reportEvidence').checked){
    report.evidence=records.filter(record=>record.type!=='sub').flatMap(record=>
      (record.item.attachments||[]).filter(file=>!customer||file.customer===true).map(file=>({
        ...file,project:text(metricWorkTitle(record.project)),process:text(record.item.name)
      })));
    section('Lampiran WBS',['Proyek','Proses','Lampiran'],report.evidence.map(file=>[file.project,file.process,text(file.name)]));
  }
  return report;
}

function reportPlain(report){
  const blocks=['Repair Monitor · '+report.title,report.unit+(report.author?' · '+report.author:''),report.period,report.customer?'Versi customer':'Versi internal'];
  if(report.message)return [...blocks,'',report.message].join('\n');
  for(const [label,value] of report.metrics||[])blocks.push(label+': '+value);
  for(const {name,headers,rows} of report.sections){
    blocks.push('',name);
    if(!rows.length)blocks.push('Tidak ada data.');
    for(const row of rows)blocks.push('',...row.map((cell,index)=>headers[index]+': '+cell));
  }
  if(report.groups?.length){
    blocks.push('','Prioritas tindak lanjut');
    for(const group of report.groups)blocks.push('',group.name,group.recommendation,...group.items.map(item=>'• '+item));
  }
  return blocks.join('\n').replace(/\|/g,' · ');
}

function generateReport(){
  const root=document.getElementById('reportVisual');
  reportPic.style.display=reportType.value==='pic'?'':'none';
  const report=buildRepairReport();
  reportPreview.textContent=reportPlain(report);
  const summary=document.getElementById('periodSummary');
  if(summary)summary.innerHTML=(report.metrics||[]).map(([key,value])=>'<div class="row-top"><span>'+esc(key)+'</span><b>'+esc(value)+'</b></div>').join('');
  const header='<div class="report-hero"><div><span class="report-eyebrow">REPAIR MONITOR</span><h2>'+esc(report.title)+'</h2><p>'+esc(report.unit)+(report.author?' · '+esc(report.author):'')+' · '+esc(report.period)+'</p></div><span class="report-pill">'+(report.customer?'Versi customer':'Versi internal')+'</span></div>';
  if(report.message){root.innerHTML=header+'<p class="report-empty">'+esc(report.message)+'</p>';return;}
  const kpis=(report.metrics||[]).map(([label,value])=>'<article class="report-kpi"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></article>').join('');
  const statusBadge=cell=>'<span class="pill '+(cell.includes('Terlambat')?'s-terlambat':cell.startsWith('Selesai')?'s-selesai':'s-proses')+'">'+esc(cell)+'</span>';
  const sections=report.sections.map(({name,headers,rows,statusColumn})=>{
    const contents=name==='Aktivitas pada periode'?
      '<div class="repair-activity-list">'+rows.map(row=>'<article class="project-row"><div class="row-top"><strong>'+esc(row[0])+'</strong>'+statusBadge(row[statusColumn])+'</div>'+
        '<div class="muted">'+esc(row[1])+(report.customer?'':' · PIC '+esc(row[2]))+' · '+esc(row.at(-1))+'</div>'+
        (report.customer||row[4]==='—'?'':'<div class="repair-note">'+esc(row[4])+'</div>')+'</article>').join('')+'</div>':
      '<div class="report-table-wrap" tabindex="0" role="region" aria-label="'+esc(name)+'"><table class="report-table"><thead><tr>'+headers.map(head=>'<th scope="col">'+esc(head)+'</th>').join('')+'</tr></thead><tbody>'+
        rows.map(row=>'<tr>'+row.map((cell,index)=>'<td>'+(index===statusColumn?statusBadge(cell):esc(cell))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
    return '<section class="report-section"><div class="report-section-head"><h3>'+esc(name)+'</h3><span class="report-pill">'+rows.length+'</span></div>'+(rows.length?contents:'<p class="report-empty">Tidak ada data pada pilihan ini.</p>')+'</section>';
  });
  const groups=report.groups?'<section class="report-section"><h3>Prioritas tindak lanjut</h3>'+
    (report.groups.map(group=>'<details class="report-details"><summary>'+esc(group.name)+' · '+group.items.length+' terlambat</summary><p>'+esc(group.recommendation)+'</p><ul>'+
      group.items.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>'+(group.name==='Belum ditetapkan'?'':'<button type="button" class="btn-soft" data-report-pic="'+esc(group.name)+'" onclick="openReportFollowup(this.dataset.reportPic)">Tindak Lanjut Massal PIC</button>')+'</details>').join('')||'<p class="report-empty">Tidak ada subtugas terlambat.</p>')+'</section>':'';
  root.innerHTML=header+'<div class="report-kpis">'+kpis+'</div>'+sections[0]+groups+sections.slice(1).join('');
}

function openReportFollowup(person){
  massPicName.value=person;
  massPicName.dataset.reportRecipient=person;
  document.getElementById('massPicStatus').textContent='Siapkan tautan untuk pekerjaan terbuka milik '+person+', termasuk peran yang dipetakan kepadanya.';
  massPicName.focus();
  document.getElementById('massPicCard').scrollIntoView({block:'start'});
}

function createReportMassPicLink(button){
  const person=massPicName.dataset.reportRecipient;
  if(person&&massPicName.value.trim()===person)return followUpDashboard(person,button);
  return createMassPicLink();
}

function saveRepairFile(blob,name){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

function loadReportLibrary(url,globalName){
  if(window[globalName])return Promise.resolve(window[globalName]);
  if(!reportLibraries.has(url)){
    const request=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=url;
      script.onload=()=>window[globalName]?resolve(window[globalName]):reject(Error('Komponen ekspor tidak tersedia.'));
      script.onerror=()=>{script.remove();reject(Error('Komponen ekspor gagal dimuat.'));};
      document.head.append(script);
    }).catch(error=>{reportLibraries.delete(url);throw error;});
    reportLibraries.set(url,request);
  }
  return reportLibraries.get(url);
}

function reportFilename(report,ext){
  return 'Repair-Monitor-'+(report.customer?'Customer':'Internal')+'-'+(reportDate.value||today())+'.'+ext;
}

function downloadReport(){
  const report=buildRepairReport();
  if(report.message){toast(report.message);return;}
  saveRepairFile(new Blob([reportPlain(report)],{type:'text/plain;charset=utf-8'}),reportFilename(report,'txt'));
}

async function exportRepairReport(format,button){
  const report=buildRepairReport();
  if(report.message){toast(report.message);return;}
  const label=button.textContent;
  button.disabled=true;
  button.textContent='Menyiapkan…';
  try{
    const blob=await (format==='pdf'?repairReportPdf(report):repairReportExcel(report));
    saveRepairFile(blob,reportFilename(report,format));
    toast('Laporan '+format.toUpperCase()+' siap diunduh.');
  }catch(error){
    toast('Ekspor gagal: '+error.message);
  }finally{
    button.disabled=false;
    button.textContent=label;
  }
}

async function evidenceBlob(file){
  const {data,error}=await cloudClient.storage.from(evidenceBucket).download(file.path);
  if(error)throw Error('Lampiran '+file.name+' tidak dapat diakses. Periksa sesi admin.');
  return data;
}

async function repairReportPdf(report){
  const {jsPDF}=await loadReportLibrary('https://cdn.jsdelivr.net/npm/jspdf@4.1.0/dist/jspdf.umd.min.js','jspdf');
  const pdf=new jsPDF({compress:true});
  let y=17;
  function startPage(){
    pdf.setFillColor('#710912');pdf.rect(0,0,210,5,'F');
    pdf.setFont('helvetica','bold');pdf.setFontSize(15);pdf.setTextColor('#710912');
    pdf.text('Repair Monitor',14,14);
    y=23;
  }
  function write(value,{bold=false,size=10}={}){
    const text=String(value).replace(/[≤↗•]/g,char=>({'≤':'<=','↗':'','•':'-'}[char]));
    pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor('#362822');
    for(const line of pdf.splitTextToSize(text,182)){
      if(y>280){pdf.addPage();startPage();pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor('#362822');}
      if(line)pdf.text(line,14,y);
      y+=size*.49;
    }
  }
  startPage();
  const lines=reportPlain(report).split('\n');
  lines.shift();
  write(report.title,{bold:true,size:14});
  for(const line of lines)write(line,{bold:report.sections.some(section=>section.name===line)||line==='Prioritas tindak lanjut'});
  const documents=[];
  for(const file of report.evidence){
    const bytes=new Uint8Array(await (await evidenceBlob(file)).arrayBuffer());
    if(file.type==='application/pdf'){documents.push({file,bytes});continue;}
    pdf.addPage();startPage();
    write(file.project,{bold:true});write(file.process+' · '+file.name);
    const info=pdf.getImageProperties(bytes), scale=Math.min(182/info.width,230/info.height);
    pdf.addImage(bytes,'JPEG',14,y+3,info.width*scale,info.height*scale);
  }
  if(!documents.length)return pdf.output('blob');
  const {PDFDocument}=await loadReportLibrary('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js','PDFLib');
  const document=await PDFDocument.load(pdf.output('arraybuffer'));
  for(const {file,bytes} of documents){
    let attachment;
    try{attachment=await PDFDocument.load(bytes);}catch{throw Error('PDF '+file.name+' terkunci atau rusak.');}
    for(const page of await document.copyPages(attachment,attachment.getPageIndices()))document.addPage(page);
  }
  return new Blob([await document.save()],{type:'application/pdf'});
}

async function repairReportExcel(report){
  const Excel=await loadReportLibrary('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js','ExcelJS');
  const workbook=new Excel.Workbook();
  const worksheets=[{name:'Ringkasan',headers:['Indikator','Nilai'],rows:report.metrics||[]},...report.sections];
  if(report.groups?.length)worksheets.push({name:'Prioritas',headers:['PIC','Pekerjaan terlambat','Rekomendasi'],rows:report.groups.map(group=>[group.name,group.items.join('\n'),group.recommendation])});
  for(const {name,headers,rows} of worksheets){
    const sheet=workbook.addWorksheet(name.slice(0,31),{views:[{state:'frozen',ySplit:5}]});
    sheet.addRows([['Repair Monitor · '+report.title],[report.unit,report.author],[report.period,report.customer?'Versi customer':'Versi internal'],[],headers,...rows]);
    sheet.getRow(1).font={bold:true,size:15,color:{argb:'FF710912'}};
    sheet.getRow(5).eachCell(cell=>{
      cell.font={bold:true,color:{argb:'FFFFFFFF'}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF710912'}};
    });
    for(let index=1;index<=headers.length;index++){
      const column=sheet.getColumn(index);
      column.width=32;
      column.alignment={vertical:'top',wrapText:true};
    }
    sheet.autoFilter={from:{row:5,column:1},to:{row:5,column:headers.length}};
    for(let row=6;row<=sheet.rowCount;row++){
      const lines=Math.max(...sheet.getRow(row).values.slice(1).map(value=>String(value??'').split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/30)),0)));
      sheet.getRow(row).height=Math.min(380,Math.max(17,lines*15));
    }
    if(name==='Lampiran WBS'){
      sheet.getCell('D5').value='Pratinjau foto';
      sheet.getCell('D5').style=sheet.getCell('C5').style;
      sheet.getColumn(4).width=28;
      for(const [index,file] of report.evidence.entries()){
        if(file.type!=='image/jpeg')continue;
        const bytes=await (await evidenceBlob(file)).arrayBuffer();
        const image=workbook.addImage({buffer:new Uint8Array(bytes),extension:'jpeg'});
        const row=index+6;
        const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
        const scale=Math.min(170/bitmap.width,95/bitmap.height);
        sheet.getRow(row).height=76;
        sheet.addImage(image,{tl:{col:3,row:row-1},ext:{width:bitmap.width*scale,height:bitmap.height*scale}});
        bitmap.close();
      }
    }
  }
  return new Blob([await workbook.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

function findWbsEvidenceTarget(taskId,subId,processId){
  const task=taskOf(taskId);
  const parent=subId?db.subs.find(sub=>sub.id===subId&&sub.taskId===taskId):task;
  return (parent?.wbs||[]).find(process=>process.id===processId);
}

async function compressEvidence(file){
  if(file.type==='application/pdf'){
    if(file.size>evidenceLimit||!(await file.slice(0,5).text()).startsWith('%PDF-'))throw Error('Gunakan PDF yang valid, maksimum 5 MB.');
    return file;
  }
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw Error('Pilih JPEG, PNG, WebP (maks. 20 MB sebelum kompresi) atau PDF (maks. 5 MB).');
  const image=await createImageBitmap(file);
  try{
    const scale=Math.min(1,1600/Math.max(image.width,image.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const compressed=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));
    if(!compressed||compressed.size>evidenceLimit)throw Error('Foto masih melebihi batas 5 MB.');
    return compressed;
  }finally{image.close();}
}

function closeWbsEvidence(){
  closeModal('wbsEvidenceModal');
  for(const url of evidencePreviews)URL.revokeObjectURL(url);
  evidencePreviews.clear();
  document.getElementById('wbsEvidenceFiles').replaceChildren();
}

function showWbsEvidence(button){
  const {evidenceTask:task,evidenceSub:sub,evidenceProcess:process}=button.dataset;
  const item=findWbsEvidenceTarget(task,sub,process);
  if(!item)return;
  const form=document.getElementById('wbsEvidenceForm');
  form.reset();
  Object.assign(form.dataset,{task,sub,process});
  document.getElementById('wbsEvidenceHeading').textContent='Lampiran · '+item.name;
  document.getElementById('wbsEvidenceStatus').textContent=cloudReady?'':'Masuk sebagai admin dan sinkronkan cloud untuk mengakses lampiran.';
  form.querySelector('fieldset').disabled=!cloudReady;
  openModal('wbsEvidenceModal');
  renderWbsEvidence(item);
}

function renderWbsEvidence(item){
  const host=document.getElementById('wbsEvidenceFiles');
  for(const url of evidencePreviews)URL.revokeObjectURL(url);
  evidencePreviews.clear();
  host.innerHTML=(item.attachments||[]).map((file,i)=>'<article class="project-row"><strong>'+esc(file.name)+'</strong><small class="muted"> · '+(file.customer?'Boleh masuk laporan customer':'Internal')+'</small>'+
    '<div class="actions">'+(file.type==='image/jpeg'?'<button type="button" class="btn-plain" data-index="'+i+'" onclick="previewWbsEvidence(this)">Lihat foto</button>':'')+
    '<button type="button" class="btn-soft" data-index="'+i+'" onclick="downloadWbsEvidence(this)">Unduh</button>'+
    (cloudReady?'<button type="button" class="btn-plain" data-index="'+i+'" onclick="toggleCustomerEvidence(this)">'+(file.customer?'Jadikan internal':'Izinkan untuk customer')+'</button>':'')+'</div></article>').join('')||'<p class="muted">Belum ada lampiran.</p>';
  for(const button of host.querySelectorAll('[onclick="previewWbsEvidence(this)"]'))if(cloudReady)previewWbsEvidence(button);
}

function evidenceFromButton(button){
  const {task,sub,process}=document.getElementById('wbsEvidenceForm').dataset;
  return findWbsEvidenceTarget(task,sub,process)?.attachments?.[Number(button.dataset.index)];
}

async function previewWbsEvidence(button){
  const file=evidenceFromButton(button);
  if(!file)return;
  button.disabled=true;
  try{
    const blob=await evidenceBlob(file);
    if(!button.isConnected)return;
    const img=document.createElement('img'),url=URL.createObjectURL(blob);
    evidencePreviews.add(url);
    img.src=url;img.alt=file.name;img.className='wbs-evidence-thumb';
    button.replaceWith(img);
  }catch{button.disabled=false;}
}

async function downloadWbsEvidence(button){
  const file=evidenceFromButton(button);
  if(!file)return;
  try{saveRepairFile(await evidenceBlob(file),file.name);}
  catch(error){toast(error.message);}
}

async function toggleCustomerEvidence(button){
  const form=document.getElementById('wbsEvidenceForm');
  const {task,sub,process}=form.dataset;
  const item=findWbsEvidenceTarget(task,sub,process),file=evidenceFromButton(button);
  if(!file||!cloudReady||cloudConflict)return;
  if(!file.customer&&!confirm('Izinkan lampiran ini masuk ke PDF atau Excel customer saat opsi lampiran dipilih?'))return;
  button.disabled=true;
  file.customer=!file.customer;
  try{
    save();
    await flushWorkCloud();
    toast('Izin lampiran tersimpan.');
  }catch(error){toast(error.message);}
  finally{if(form.dataset.process===process&&document.getElementById('wbsEvidenceModal').classList.contains('show'))renderWbsEvidence(item);}
}

async function uploadWbsEvidence(event){
  event.preventDefault();
  const form=event.currentTarget,{task,sub,process}=form.dataset;
  const selected=form.elements.file.files[0], allowCustomer=form.elements.customer.checked;
  const box=document.getElementById('wbsEvidenceStatus'), fieldset=form.querySelector('fieldset');
  if(!selected||!cloudReady||cloudConflict)return toast('Hubungkan dan sinkronkan cloud sebelum mengunggah.');
  fieldset.disabled=true;box.textContent='Memproses lampiran…';
  try{
    await flushWorkCloud();
    if(cloudConflict||!cloudReady||!findWbsEvidenceTarget(task,sub,process))throw Error('Sinkronkan data dan buka kembali proses WBS.');
    const data=await compressEvidence(selected);
    const path=crypto.randomUUID()+(data.type==='image/jpeg'?'.jpg':'.pdf');
    const {error}=await cloudClient.storage.from(evidenceBucket).upload(path,data,{contentType:data.type,upsert:false});
    if(error)throw error;
    const item=findWbsEvidenceTarget(task,sub,process);
    if(!item){
      await cloudClient.storage.from(evidenceBucket).remove([path]);
      throw Error('Proses WBS tidak lagi tersedia.');
    }
    const name=data.type==='image/jpeg'?selected.name.replace(/\.[^.]+$/,'')+'.jpg':selected.name;
    item.attachments=[...(item.attachments||[]),{name,path,type:data.type,customer:allowCustomer}];
    save();
    await flushWorkCloud();
    if(cloudConflict)throw Error('Lampiran menunggu sinkronisasi karena ada perubahan bersamaan.');
    form.reset();
    box.textContent='Lampiran tersimpan.';
    if(form.dataset.process===process&&document.getElementById('wbsEvidenceModal').classList.contains('show'))renderWbsEvidence(item);
  }catch(error){box.textContent='Unggah: '+error.message;}
  finally{fieldset.disabled=!cloudReady;}
}
