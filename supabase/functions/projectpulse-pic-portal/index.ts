import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const hashToken = async (token: string) => {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};


const woInspectionPics=['Bima','Ifah','Huda','Dimas','Robbi'];
const woDrawingPics=woInspectionPics;
const woBomPics=[...woInspectionPics,'Maytasya'];
const woJsePics=['Irfan','Maytasya'];
function woTitle(value,uppercase=false){
  const name=String(value||'').trim();
  if(uppercase)return name.toLocaleUpperCase('id');
  return name.toLocaleLowerCase('id').replace(/(^|[^\p{L}\p{N}])\p{L}/gu,part=>part.toLocaleUpperCase('id'));
}
const woDocumentPics=['Maytasya','Wisnu B.','Aulia'];
function woKey(value){
  return String(value||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function woSamePic(a,b){
  const name=value=>woKey(value).replace(/\s/g,'').replace(/^robby$/,'robbi');
  return !!name(a)&&name(a)===name(b);
}
function woDoc(value){
  const name=woKey(value);
  if(/^packing list (pengambilan|pickup)\b/.test(name))return 'pickup';
  if(/^packing list (pengiriman|delivery)\b/.test(name))return 'packing';
  if(/^incoming (?:report|inspecti(?:on|o|n)(?: report)?)$/.test(name))return 'incoming';
  if(/^final (?:report|inspecti(?:on|o|n)(?: report)?)$/.test(name))return 'final';
  if(/^jse\b|^pembuatan jse\b/.test(name))return 'jse';
  return '';
}
function woDrawing(value){return /^(drawing|bom release|release bom)$/.test(woKey(value));}
function woAllowed(item,type,task){
  if(type==='task')return woTaskKind(item.name)==='inspection'?woInspectionPics:null;
  if(type!=='sub'){
    if(woKey(item.name)==='drawing')return woDrawingPics;
    return woDrawing(item.name)?woBomPics:['PC'];
  }
  if(woTaskKind(task?.name)==='inspection')return woInspectionPics;
  const doc=woDoc(item.name);
  if(doc==='jse')return woJsePics;
  if(doc)return woDocumentPics;
  return null;
}
function woAssigned(item,type,task){
  const options=woAllowed(item,type,task);
  if(options?.length===1)return options[0];
  return options?options.find(name=>woSamePic(name,item.pic))||'':String(item.pic||'').trim();
}
function woCanUpdate(item,type,pic,task){
  const options=woAllowed(item,type,task),assigned=woAssigned(item,type,task);
  return !options||options.some(name=>woSamePic(name,pic))&&(!assigned||woSamePic(assigned,pic));
}
function woInheritMain(item,type,task,project){
  const kind=woTaskKind((task||item).name);
  if(type==='task'&&kind==='repair')return String(project?.pic||'').trim();
  const inherits=type==='task'&&kind==='inspection'
    ||type==='sub'&&kind==='inspection'
    ||(type==='wbsSub'||type==='wbsTask')&&kind==='repair'&&woKey(item.name)==='drawing';
  return inherits?woInspectionPics.find(name=>woSamePic(name,project?.pic))||'':'';
}
function woRaw(item){
  if(item?.status==='Selesai')return 100;
  const value=item?.progress;
  if(value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value)))return Math.max(0,Math.min(100,Number(value)));
  return item?.status==='Selesai'?100:item?.status==='Sedang dikerjakan'?50:0;
}
function woAverage(values){
  if(!values.length)return 0;
  return values.every(value=>value>=100)?100:Math.min(99,Math.round(values.reduce((a,b)=>a+b,0)/values.length));
}
function woSubProgress(sub){
  return sub.wbs?.length&&!woAllowed(sub,'sub')?woAverage(sub.wbs.map(woRaw)):woRaw(sub);
}
function woTaskProgress(task,subs){
  const values=[...(task.wbs||[]).map(woRaw),...subs.map(woSubProgress)];
  return values.length?woAverage(values):woRaw(task);
}
function woTaskKind(value){
  const n=woKey(value);
  if(/dismantl|disman(t)?el|cleaning/.test(n))return 'receiving';
  if(/^(?:inspeksi|inspection)(?: awal)?$/.test(n)||/^inspeksi awal\b/.test(n))return 'inspection';
  if(/persetujuan customer|approval customer|customer approval|persetujuan pelanggan/.test(n))return 'approval';
  if(/\bpr\b|ketersediaan (?:material|mateiral)|request pembelian material/.test(n))return 'material';
  if(/\b(?:fabrication|fabrikasi|repair)\b.*\bdrawing\b|\bdrawing\b.*\b(?:fabrication|fabrikasi|repair)\b/.test(n))return 'repair';
  if(/\b(?:assembly|assembling|assy|perakitan)\b/.test(n))return 'assembly';
  if(/\b(?:test|testing|pengujian|hydrotest)\b/.test(n))return 'testing';
  if(!/packing list|ready to dispatch/.test(n)&&/^(pengiriman|dispatch|delivery|dikirim|kembali ke (?:customer|pelanggan))\b/.test(n))return 'shipping';
  return '';
}
function woSummaries(state){
  const byTask=new Map();
  for(const sub of state.subs||[]){
    if(!byTask.has(sub.taskId))byTask.set(sub.taskId,[]);
    byTask.get(sub.taskId).push(sub);
  }
  const byProject=new Map();
  for(const task of state.tasks||[]){
    if(!byProject.has(task.projectId))byProject.set(task.projectId,[]);
    const subs=byTask.get(task.id)||[];
    byProject.get(task.projectId).push({task,subs,kind:woTaskKind(task.name),progress:woTaskProgress(task,subs)});
  }
  return byProject;
}
function woStage(project,rows){
  if(!rows.length)return '';
  const pick=kind=>rows.filter(row=>row.kind===kind).map(row=>row.progress);
  const doc=kind=>rows.flatMap(row=>row.subs.filter(sub=>woDoc(sub.name)===kind).map(woSubProgress));
  const done=values=>values.length>0&&values.every(value=>value>=100);
  const open=values=>values.some(value=>value<100);
  const pickup=doc('pickup'),receiving=pick('receiving'),inspection=pick('inspection'),approval=pick('approval');
  const material=pick('material'),repair=pick('repair'),assembly=pick('assembly'),tests=pick('testing'),packing=doc('packing'),shipping=pick('shipping');
  if(![pickup,receiving,inspection,approval,material,repair,assembly,tests,packing,shipping].some(group=>group.length))return '';
  if(rows.every(row=>row.progress>=100)&&(project.returnedDate||done(shipping)))return 'Dikirim / kembali ke customer';
  if(open(pickup)||open(receiving))return 'Penerimaan / intake';
  if(open(inspection))return 'Inspeksi awal / as-found';
  if(open(approval))return 'Menunggu persetujuan customer';
  if(open(material))return 'Menunggu material / PO';
  if(open(repair))return 'Repair / machining';
  if(!done(assembly)&&assembly.length)return 'Assembly';
  if(done(assembly)){
    if(open(tests))return 'Testing & QC';
    if(done(packing))return 'Ready to dispatch';
    return tests.length?'Testing & QC':'Assembly';
  }
  if(done(repair))return 'Assembly';
  if(done(inspection)&&!done(approval)&&!done(material))return 'Menunggu persetujuan customer';
  if(material.length||repair.length)return 'Repair / machining';
  return 'Penerimaan / intake';
}
function woApplyStages(state,day){
  const projects=new Map((state.projects||[]).map(project=>[project.id,project]));
  const tasks=new Map((state.tasks||[]).map(task=>[task.id,task]));
  for(const project of projects.values())project.name=woTitle(project.name,true);
  function normalize(item,type,task,project){
    item.name=woTitle(item.name,type==='task');
    const inherited=woInheritMain(item,type,task,project);
    if(inherited)item.pic=inherited;
    else if(woAllowed(item,type,task)?.length===1)item.pic=woAssigned(item,type,task);
  }
  for(const task of tasks.values()){
    const project=projects.get(task.projectId);
    normalize(task,'task',task,project);
    for(const process of task.wbs||[])normalize(process,'wbsTask',task,project);
  }
  for(const sub of state.subs||[]){
    const task=tasks.get(sub.taskId),project=projects.get(task?.projectId);
    normalize(sub,'sub',task,project);
    for(const process of sub.wbs||[])normalize(process,'wbsSub',task,project);
  }
  const groups=woSummaries(state);
  for(const project of state.projects||[]){
    const stage=woStage(project,groups.get(project.id)||[]);
    if(stage&&project.stage!==stage){project.stage=stage;project.stageUpdatedAt=day;}
  }
}
function woProjectKpis(rows){
  const groups={admin:[],engineering:[],workshop:[]};
  const addWbs=items=>{
    for(const item of items||[])groups[woDrawing(item.name)?'engineering':'workshop'].push(woRaw(item));
  };
  for(const {task,subs,kind,progress} of rows){
    if(['material','inspection'].includes(kind)){groups.engineering.push(progress);continue;}
    const taskDoc=woDoc(task.name);
    if(taskDoc){groups.admin.push(progress);continue;}
    addWbs(task.wbs);
    for(const sub of subs){
      if(woDoc(sub.name)){groups.admin.push(woSubProgress(sub));continue;}
      addWbs(sub.wbs);
      if(sub.wbs?.length)continue;
      if(woDrawing(sub.name))groups.engineering.push(woRaw(sub));
      else if(['receiving','repair','assembly','testing'].includes(kind))groups.workshop.push(woRaw(sub));
    }
    if(!subs.length&&!task.wbs?.length){
      if(woDrawing(task.name))groups.engineering.push(progress);
      else if(['receiving','repair','assembly','testing'].includes(kind))groups.workshop.push(progress);
    }
  }
  return Object.fromEntries(Object.entries(groups).map(([key,values])=>[key,{progress:woAverage(values),total:values.length,done:values.filter(value=>value>=100).length}]));
}
function woFollowupRecords(state){
  const result=[];
  for(const [projectId,rows] of woSummaries(state)){
    const project=(state.projects||[]).find(p=>p.id===projectId);
    if(!project)continue;
    for(const {task,subs} of rows){
      for(const w of task.wbs||[])result.push({project,task,item:w,type:'wbsTask'});
      for(const sub of subs){
        result.push({project,task,sub,item:sub,type:'sub'});
        for(const w of sub.wbs||[])result.push({project,task,sub,item:w,type:'wbsSub'});
      }
    }
  }
  return result;
}
function woCloudDay(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta'}).format(new Date());}

function woRecordId(record){
  return record.type==='sub'?record.item.id:[record.type,record.task.id,record.sub?.id||'',record.item.id].join(':');
}
function woRecordCan(record,pic){
  const {item,type,task}=record;
  if(!woCanUpdate(item,type,pic,task))return false;
  if(woAllowed(item,type,task))return true;
  const assigned=woAssigned(item,type,task)||task.pic;
  return !assigned||woSamePic(assigned,pic);
}
function woReportProgress(record){
  return record.type==='sub'?woSubProgress(record.item):woRaw(record.item);
}
function woLinkItem(record,state,templates){
  const {item,task,sub,project,type}=record;
  const progress=woReportProgress(record);
  const status=progress>=100?'Selesai':progress>0?'Sedang dikerjakan':'Belum dikerjakan';
  const dependsOn=type==='sub'?(item.dependsOn||[]).map(id=>{
    const dependency=(state.subs||[]).find(row=>row.id===id);
    return {id,name:dependency?.name||'',progress:dependency?woSubProgress(dependency):0};
  }):[];
  return {id:woRecordId(record),name:[project.name,task.name,sub?.name,type!=='sub'?item.name:''].filter(Boolean).join(' / '),
    pic:woAssigned(item,type,task)||(!woAllowed(item,type,task)?task.pic:'')||'',project:project.name,task:task.name,itemType:type,status,progress,due:item.due||'',note:item.note||'',noteTemplates:templates,dependsOn};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { action, token, updates } = await req.json();
    if (typeof token !== "string" || token.length < 32 || token.length > 256) return json({ error: "Tautan tidak valid" }, 400);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const tokenHash = await hashToken(token);
    const { data: link, error } = await supabase.from("projectpulse_pic_links")
      .select("id,pic_name,payload,expires_at,submitted_at,revoked_at,max_submissions,submission_count")
      .eq("token_hash", tokenHash).maybeSingle();
    if (error) throw error;
    if (!link || new Date(link.expires_at).getTime() < Date.now()) return json({ error: "Tautan tidak ditemukan atau sudah kedaluwarsa" }, 404);
    if (link.revoked_at) return json({ error: "Tautan ini sudah dibatalkan coordinator. Minta tautan pengganti." }, 410);
    if(action!=="open"&&(action!=="submit"||!Array.isArray(updates)||updates.length<1||updates.length>100))return json({error:"Permintaan tidak valid"},400);
    const reusable=link.max_submissions>1;
    const remaining=link.max_submissions-link.submission_count;
    if(remaining<=0)return action==="open"?json({pic:link.pic_name,items:[],submitted:true,reusable,remaining}):json({error:"Kuota pembaruan tautan ini habis."},409);
    if(action==="submit"&&reusable&&link.submitted_at&&Date.now()-Date.parse(link.submitted_at)<60000)
      return json({error:"Tunggu 60 detik sejak pembaruan terakhir sebelum mengirim lagi."},429);
    const {data:current,error:readError}=await supabase.from("projectpulse_state").select("payload,revision").eq("singleton",true).maybeSingle();
    if(readError)throw readError;
    if(!current?.payload)return json({error:"Data proyek belum tersedia."},409);
    const state=current.payload;
    woApplyStages(state,woCloudDay());
    const records=new Map(woFollowupRecords(state).map(record=>[woRecordId(record),record]));
    const allowed=new Map();
    const refreshed=[];
    for(const entry of link.payload.items||[]){
      const record=records.get(entry.id);
      if(!record||!woRecordCan(record,link.pic_name)||record.type==="sub"&&record.item.wbs?.length&&!woAllowed(record.item,"sub"))continue;
      allowed.set(entry.id,record);
      const item=woLinkItem(record,state,entry.noteTemplates);
      if(item.progress<100)refreshed.push(item);
    }
    if(action==="open")return json({pic:link.pic_name,...link.payload,items:refreshed,submitted:false,reusable,remaining,expires_at:link.expires_at});
    const proposed=new Map();
    for(const update of updates){
      const record=allowed.get(update?.id);
      if(!record||proposed.has(update.id))return json({error:"Pekerjaan tidak ditemukan atau penugasan sudah berubah. Minta tautan baru."},409);
      if(!Number.isFinite(update.progress)||update.progress<0||update.progress>100||typeof update.note!=="string")return json({error:"Progres atau catatan tidak valid."},400);
      if(woReportProgress(record)>=100)return json({error:"Pekerjaan sudah selesai. Muat ulang tautan."},409);
      if(update.expectedProgress!==undefined&&(update.expectedProgress!==woReportProgress(record)||(update.expectedNote||"")!==(record.item.note||"")))return json({error:"Progres berubah sejak formulir dibuka. Muat ulang tautan sebelum mengirim."},409);
      proposed.set(update.id,{record,progress:Math.round(update.progress),note:update.note.slice(0,2000)});
    }
    const candidates=new Map();
    for(const {record,progress} of proposed.values())candidates.set(record.item,progress);
    const pendingSubProgress=sub=>sub.wbs?.length&&!woAllowed(sub,"sub")
      ?woAverage(sub.wbs.map(step=>candidates.get(step)??woRaw(step)))
      :candidates.get(sub)??woRaw(sub);
    const subs=new Map((state.subs||[]).map(sub=>[sub.id,sub]));
    for(const {record,progress} of proposed.values()){
      const {item,sub,type}=record;
      if(progress<=woReportProgress(record))continue;
      const dependencies=(type==="sub"?item:sub)?.dependsOn||[];
      const blocked=dependencies.some(id=>!subs.has(id)||pendingSubProgress(subs.get(id))<100);
      if(blocked)return json({error:"Pekerjaan pendahulu untuk "+item.name+" belum selesai."},409);
    }
    const day=woCloudDay(),stamp=new Date().toISOString();
    let count=0;
    const targets=[];
    for(const {record,progress,note} of proposed.values()){
      const {item}=record;
      const before=woRaw(item);
      if(progress===before&&note===(item.note||""))continue;
      const options=woAllowed(item,record.type,record.task);
      if(options&&!woAssigned(item,record.type,record.task))item.pic=options.find(name=>woSamePic(name,link.pic_name))||item.pic;
      const status=progress>=100?"Selesai":progress>0?"Sedang dikerjakan":"Belum dikerjakan";
      Object.assign(item,{progress,status,note,source:'pic',lastUpdatedAt:day,actualStart:item.actualStart||(progress>0?day:""),actualEnd:progress>=100?(item.actualEnd||day):""});
      if(progress!==before)item.lastProgressAt=day;
      item.history=[...(item.history||[]),{progress,status,date:day,updatedAt:day,source:'pic'}];
      targets.push(record.type==='sub'?{kind:'sub',id:item.id}:{kind:'wbs',id:item.id,taskId:record.task.id,subId:record.sub?.id});
      count++;
    }
    if(!count)return json({error:"Belum ada perubahan untuk dikirim."},400);
    state.activity=[{id:crypto.randomUUID(),msg:"Update PIC diterima: "+count+" item · "+link.pic_name,date:stamp,source:'pic',actor:link.pic_name,target:targets[0],targets},...(state.activity||[])].slice(0,30);
    woApplyStages(state,day);
    const {data:saved,error:saveError}=await supabase.rpc("projectpulse_commit_pic_workflow",{p_hash:tokenHash,p_payload:state,p_expected_revision:current.revision});
    if(saveError)throw saveError;
    if(saved?.unavailable)return json({error:"Tautan dibatalkan atau sudah kedaluwarsa."},410);
    if(saved?.submitted)return json({error:"Kuota pembaruan tautan ini habis."},409);
    if(saved?.cooldown)return json({error:"Tunggu 60 detik sejak pembaruan terakhir sebelum mengirim lagi."},429);
    if(saved?.conflict)return json({error:"Data berubah selama penyimpanan. Muat ulang tautan dan kirim kembali."},409);
    return json({ok:true,result:{applied:count,remaining:saved.remaining,reusable}});
  } catch (error) {
    console.error(error);
    return json({ error: "Tidak dapat memproses pembaruan PIC" }, 500);
  }
});
