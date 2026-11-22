import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://assifayuichi-gtg.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});
const hashToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
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
    const bearer = req.headers.get("Authorization") || "";
    const accessToken = bearer.replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Silakan login" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authClient = createClient(url, anonKey);
    const { data: { user }, error: authError } = await authClient.auth.getUser(accessToken);

    if (authError || !user || user.app_metadata?.projectpulse_role !== "admin") return json({ error: "Akun ini belum memiliki akses admin ProjectPulse" },403);
    const { action,payload,pic,items,expiresDays,contact,expectedRevision,linkId,linkMode } = await req.json();
    if (action === "v2_role") return json({role:"admin"});
    if (action === "get_state") {
      const { data, error } = await service.from("projectpulse_state").select("payload,updated_at,revision").eq("singleton", true).maybeSingle();
      if (error) throw error;
      return json({ payload: data?.payload ?? null, updated_at: data?.updated_at ?? null, revision: data?.revision ?? null });
    }
    if (action === "put_state") {
      if (!payload || !Array.isArray(payload.projects) || !Array.isArray(payload.tasks) || !Array.isArray(payload.subs)) return json({ error: "Format data ProjectPulse tidak sesuai" }, 400);
      if (expectedRevision !== null && expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) return json({ error: "Versi cloud tidak valid" }, 400);
      const {data: current,error: readError}=await service.from("projectpulse_state").select("payload,revision").eq("singleton",true).maybeSingle();
      if(readError)throw readError;
      if(current && expectedRevision!==current.revision)return json({error:"Data cloud berubah. Muat cloud terbaru sebelum menyimpan.",code:"REVISION_CONFLICT"},409);
      if(current?.payload){
        const previousRecords=new Map(woFollowupRecords(current.payload).map(record=>[woRecordId(record),record]));
        woApplyStages(payload,woCloudDay());
        for(const task of payload.tasks){
          const previous=current.payload.tasks?.find(item=>item.id===task.id);
          if(woAllowed(task,"task")&&task.pic&&!woAssigned(task,"task")&&task.pic!==previous?.pic)return json({error:"PIC inspeksi tidak valid."},400);
        }
        for(const record of woFollowupRecords(payload)){
          const {item,type,task}=record,previous=previousRecords.get(woRecordId(record));
          if(woAllowed(item,type,task)&&item.pic&&!woAssigned(item,type,task)&&item.pic!==previous?.item.pic){
            return json({error:"PIC tidak memenuhi aturan penugasan untuk "+item.name},400);
          }
        }
        const archives=new Map((current.payload.projects||[]).filter(project=>project.v2Workflow).map(project=>[project.id,project.v2Workflow]));
        const previousProjects=new Map((current.payload.projects||[]).map(project=>[project.id,project]));
        for(const project of payload.projects){
          if(archives.has(project.id))project.v2Workflow=archives.get(project.id);
          const previous=previousProjects.get(project.id);
          const locked=previous?.baselineVersions;
          const incoming=project.baselineVersions;
          if(Array.isArray(locked)&&locked.length){
            const proposed=Array.isArray(incoming)&&incoming.length===locked.length+1?incoming.at(-1):null;
            if(Array.isArray(incoming)&&incoming.length>locked.length+1)return json({error:"Tambahkan satu revisi baseline pada satu waktu."},400);
            if(proposed&&(proposed.version!=="BL"+(locked.length+1)||typeof proposed.reason!=="string"||!proposed.reason.trim()))return json({error:"Nomor dan alasan revisi baseline wajib diisi."},400);
            project.baselineVersions=proposed?[...locked,proposed]:locked;
          }
          if(previous?.baselineEnd){
            project.baselineEnd=previous.baselineEnd;
            project.baselineStart=previous.baselineStart;
          }
        }
      }
      woApplyStages(payload,woCloudDay());
      const { data, error } = await service.rpc("projectpulse_put_state_audited", { p_payload: payload, p_expected_revision: expectedRevision ?? null, p_actor: user.email || user.id });
      if (error) throw error;
      if (!Array.isArray(data) || !data.length) return json({ error: "Data cloud berubah sejak terakhir dimuat. Muat cloud terbaru sebelum menyimpan lagi.", code: "REVISION_CONFLICT" }, 409);
      return json({ ok: true, revision: data[0].revision, updated_at: data[0].updated_at });
    }
    if (action === "create_pic_link") {
      if (typeof pic !== "string" || !pic.trim() || !Array.isArray(items) || !items.length || items.length > 100) return json({ error: "Nama PIC dan daftar pekerjaan wajib diisi" }, 400);
      const {data:current,error:readError}=await service.from("projectpulse_state").select("payload").eq("singleton",true).maybeSingle();
      if(readError)throw readError;
      if(!current?.payload)return json({error:"Data proyek belum tersinkron ke cloud."},409);
      woApplyStages(current.payload,woCloudDay());
      const records=new Map(woFollowupRecords(current.payload).map(record=>[woRecordId(record),record]));
      const approved=[];
      for(const incoming of items){
        const record=records.get(incoming?.id);
        if(!record||!woRecordCan(record,pic))return json({error:"Ada pekerjaan di luar penugasan "+pic+". Muat data cloud terbaru."},403);
        if(record.type==="sub"&&record.item.wbs?.length&&!woAllowed(record.item,"sub"))continue;
        if(woReportProgress(record)<100)approved.push(woLinkItem(record,current.payload,incoming.noteTemplates));
      }
      if(!approved.length)return json({error:"Pekerjaan sudah selesai atau perlu dikirim melalui tautan proses WBS."},409);
      const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
      const token = [...tokenBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      const days = Math.max(1, Math.min(30, Number(expiresDays) || 14));
      const expires = new Date(Date.now() + days * 86400000).toISOString();
      const reusable = linkMode === "repeat";
      if (reusable) {
        const key = pic.trim().replace(/[\\%_]/g, (char: string) => "\\" + char);
        const { error: expiredError } = await service.from("projectpulse_pic_links")
          .update({ revoked_at: new Date().toISOString() }).ilike("pic_name", key)
          .gt("max_submissions", 1).is("revoked_at", null).lte("expires_at", new Date().toISOString());
        if (expiredError) throw expiredError;
      }
      const linkPayload = { project: String(payload?.project || ""), task: String(payload?.task || ""), items: approved };
      const { data: created, error } = await service.from("projectpulse_pic_links").insert({ token_hash: await hashToken(token), pic_name: pic.trim(), payload: linkPayload, expires_at: expires, max_submissions: reusable ? 14 : 1 }).select("id").single();
      if (error?.code === "23505" && reusable) return json({ error: "PIC ini sudah memiliki tautan berulang. Cabut tautan lama sebelum membuat pengganti." },409);
      if (error) throw error;
      return json({ ok: true, max_submissions: reusable ? 14 : 1, link_id: created.id, token, expires_at: expires, link: `https://assifayuichi-gtg.github.io/ProjectPulse-Monitoring/#piccloud=${token}` });
    }
    if (action === "list_audit") {
      const { data, error } = await service.from("projectpulse_audit")
        .select("recorded_at,actor,actor_kind,entity,entity_id,label,operation,changes")
        .order("id", { ascending: false }).limit(100);
      if (error) throw error;
      return json({ entries: data || [] });
    }
    if (action === "list_pic_links") {
      const { data, error } = await service.from("projectpulse_pic_links")
        .select("id,pic_name,payload,created_at,expires_at,submitted_at,revoked_at,max_submissions,submission_count")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return json({ links: data || [] });
    }
    if (action === "revoke_pic_link") {
      if (typeof linkId !== "string" || !/^[0-9a-f-]{36}$/i.test(linkId)) return json({ error: "ID tautan tidak valid" }, 400);
      const { data, error } = await service.from("projectpulse_pic_links")
        .update({ revoked_at: new Date().toISOString() }).eq("id", linkId).is("revoked_at", null)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "Tautan tidak ditemukan atau sudah dibatalkan" }, 404);
      return json({ ok: true });
    }
    if (action === "save_contact") {
      if (!contact?.pic_name || !/^\+[1-9][0-9]{7,14}$/.test(contact.phone_e164 || "")) return json({ error: "Gunakan nomor WhatsApp format internasional, misalnya +6281234567890" }, 400);
      const { error } = await service.from("projectpulse_pic_contacts").upsert({ pic_name: contact.pic_name.trim(), phone_e164: contact.phone_e164, opted_in: !!contact.opted_in, enabled: contact.enabled !== false, updated_at: new Date().toISOString() }, { onConflict: "pic_name" });
      if (error) throw error;
      return json({ ok: true });
    }
    return json({ error: "Action tidak dikenal" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "Terjadi kesalahan saat memproses API" }, 500);
  }
});
