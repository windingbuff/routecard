import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { jsonArtifact } from './product-kit.mjs';

const digest = value => createHash('sha256').update(stable(value)).digest('hex');
const copy = value => structuredClone(value);
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;
function stable(value) {
  if(Array.isArray(value))return `[${value.map(stable).join(',')}]`;
  if(value && typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function fail(message,status=400) {const error=Error(message);error.status=status;throw error;}
const ensure = (ok,message,status) => {if(!ok)fail(message,status);};
function text(value,label,max=120) {ensure(typeof value==='string' && value.trim() && value.length<=max,`${label} must contain 1–${max} characters`);return value.trim();}
function same(a,b) {return timingSafeEqual(createHash('sha256').update(String(a)).digest(),createHash('sha256').update(String(b)).digest());}
function atomic(path,bytes) {
  const tmp=`${path}.${randomBytes(6).toString('hex')}.tmp`,fd=openSync(tmp,'wx',0o600);
  try {writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(tmp,path);
}
export function compareRuns(a,b) {
  const changed=[];
  function walk(left,right,path,depth=0) {
    if(changed.length>=200 || stable(left)===stable(right))return;
    if(depth<5 && left && right && !Array.isArray(left) && !Array.isArray(right) && typeof left==='object' && typeof right==='object') {
      for(const key of new Set([...Object.keys(left),...Object.keys(right)]))walk(left[key],right[key],path?`${path}.${key}`:key,depth+1);
    } else changed.push({path,before:compact(left),after:compact(right)});
  }
  walk(a.result,b.result,'result');
  return {from:a.id,to:b.id,sameInput:a.inputHash===b.inputHash,changes:changed,truncated:changed.length>=200};
}
function compact(value) {const encoded=JSON.stringify(value);return encoded?.length>800 ? encoded.slice(0,800)+'…' : value ?? null;}

export class Workspace {
  constructor(spec,config,service) {
    this.spec=spec;this.config=config;this.service=service;this.projects=new Map();this.active=new Set();this.sessionKey=config.workspaceToken || randomBytes(32).toString('hex');
    this.dir=join(resolve(config.workspaceDir || '.workspace-data'),spec.slug);
    mkdirSync(this.dir,{recursive:true,mode:0o700});
    this.lockPath=join(this.dir,'owner.lock');this.lockId=randomBytes(16).toString('hex');
    try {const old=JSON.parse(readFileSync(this.lockPath,'utf8'));let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
      ensure(!alive,'Workspace is already open in another process',503);unlinkSync(this.lockPath);
    }catch(e){if(e.code!=='ENOENT')throw e;}
    const fd=openSync(this.lockPath,'wx',0o600);writeFileSync(fd,JSON.stringify({pid:process.pid,id:this.lockId}));closeSync(fd);
    try {
      const keyPath=join(this.dir,'storage.key');
      try {this.key=readFileSync(keyPath);ensure(this.key.length===32,'Invalid workspace encryption key',503);}
      catch(e){if(e.code!=='ENOENT')throw e;ensure(!readdirSync(this.dir).some(n=>n.endsWith('.enc')),'Workspace encryption key is missing; restore it before opening saved projects',503);this.key=randomBytes(32);atomic(keyPath,this.key);}
      let total=0;
      for(const name of readdirSync(this.dir).filter(n=>/^project-[\da-f-]+\.enc$/.test(n))) {
        const path=join(this.dir,name),size=statSync(path).size;total+=size;ensure(size<=64000000 && total<=256000000,'Workspace storage budget exceeded',503);
        const bytes=readFileSync(path),cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));
        const project=JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());
        ensure(project.service===spec.slug && project.schemaVersion===1 && uuid.test(project.id),'Invalid workspace file',503);
        for(const run of project.runs)if(run.state==='running'){run.state='interrupted';run.error='Process stopped during analysis. Run again; no payment is retried.';}
        this.projects.set(project.id,project);
      }
      ensure(this.projects.size<=50,'Workspace has too many projects',503);
    } catch(e){this.close();throw e;}
  }
  close() {try{const lock=JSON.parse(readFileSync(this.lockPath,'utf8'));if(lock.id===this.lockId)unlinkSync(this.lockPath);}catch(e){if(e.code!=='ENOENT')throw e;}}
  localRequest(req) {
    const address=req.socket.remoteAddress;
    let host;try{host=new URL(`http://${req.headers.host}`).hostname;}catch{return false;}
    return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address) && ['localhost','127.0.0.1','[::1]'].includes(host);
  }
  authorize(req) {
    if(!this.config.workspaceToken)ensure(this.config.mode==='local' && this.localRequest(req),'Configure WORKSPACE_ACCESS_TOKEN for remote management',403);
    const token=req.headers['x-workspace-key'];ensure(typeof token==='string' && same(token,this.sessionKey),'Unlock the workspace with its access token',401);
    if(req.headers.origin)ensure(req.headers.origin===`http://${req.headers.host}` || req.headers.origin===`https://${req.headers.host}`,'Cross-origin workspace request rejected',403);
  }
  bootstrap(req) {
    const {slug,title,purpose,workflow,colors,version,sample,product}=this.spec;
    return {slug,title,purpose,workflow,colors,version,sample,product:{...product,describe:undefined,artifacts:undefined},mode:this.config.mode,network:this.config.network,
      localKey:!this.config.workspaceToken && this.config.mode==='local' && this.localRequest(req) ? this.sessionKey : null};
  }
  get(id) {ensure(uuid.test(id || '') && this.projects.has(id),'Project not found',404);return this.projects.get(id);}
  checked(id,revision) {const p=this.get(id);ensure(Number.isSafeInteger(revision) && revision===p.revision,'Project changed. Reload before saving.',409);ensure(!this.active.has(id),'Analysis is running; wait before changing this project.',409);return p;}
  commit(project) {
    const encoded=Buffer.from(JSON.stringify(project));ensure(encoded.length<=64000000,'Project exceeds the 64 MB retention budget. Export and remove older runs.',413);
    const total=[...this.projects.values()].filter(p=>p.id!==project.id).reduce((n,p)=>n+Buffer.byteLength(JSON.stringify(p)),encoded.length);
    ensure(total<=256000000,'Workspace exceeds the 256 MB retention budget.',413);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv),encrypted=Buffer.concat([cipher.update(encoded),cipher.final()]);
    atomic(join(this.dir,`project-${project.id}.enc`),Buffer.concat([iv,cipher.getAuthTag(),encrypted]));
    this.projects.set(project.id,copy(project));return this.detail(project);
  }
  event(project,type,detail) {project.events.push({at:new Date().toISOString(),type,detail});project.events=project.events.slice(-200);project.updatedAt=new Date().toISOString();project.revision++;}
  list() {return [...this.projects.values()].map(p=>({id:p.id,name:p.name,description:p.description,stage:p.stage,revision:p.revision,updatedAt:p.updatedAt,runs:p.runs.length})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  detail(project) {
    return {...copy(project),runs:project.runs.map(r=>({id:r.id,state:r.state,createdAt:r.createdAt,inputHash:r.inputHash,ruleVersion:r.ruleVersion,error:r.error,reviewed:Object.keys(r.reviews).length,receipt:r.receipt,approvedAt:r.approvedAt}))};
  }
  create({name,description='',data}) {
    ensure(this.projects.size<50,'At most 50 projects; export or delete an old project first.',409);
    ensure(data && typeof data==='object' && !Array.isArray(data),'Project input must be an object');
    ensure(typeof description==='string' && description.length<=4000,'Description is too long');
    const now=new Date().toISOString();return this.commit({schemaVersion:1,service:this.spec.slug,id:randomUUID(),name:text(name,'Project name'),description,data:copy(data),dataHash:digest(data),revision:1,inputRevision:1,stage:'draft',createdAt:now,updatedAt:now,runs:[],events:[{at:now,type:'created',detail:'Project created'}]});
  }
  update(id,{revision,name,description,data,stage}) {
    const project=copy(this.checked(id,revision));ensure(stage===undefined || ['draft','archived'].includes(stage),'Use review approval to release a project');
    if(project.stage==='archived')ensure(stage==='draft','Restore an archived project before editing',409);
    if(name!==undefined)project.name=text(name,'Project name');
    if(description!==undefined){ensure(typeof description==='string' && description.length<=4000,'Description is too long');project.description=description;}
    if(data!==undefined){ensure(data && typeof data==='object' && !Array.isArray(data),'Project input must be an object');const hash=digest(data);if(hash!==project.dataHash){project.data=copy(data);project.dataHash=hash;project.inputRevision++;project.stage='draft';}}
    if(stage)project.stage=stage;
    this.event(project,'saved',`Saved input revision ${project.inputRevision}${stage?`; ${stage}`:''}`);return this.commit(project);
  }
  clone(id,{revision,name}) {const p=this.checked(id,revision);return this.create({name:name || `${p.name} — scenario`,description:p.description,data:p.data});}
  runRecord(id,runId) {const p=this.get(id),run=p.runs.find(r=>r.id===runId);ensure(run,'Run not found',404);return {project:p,run};}
  runDetail(id,runId) {
    const {project,run}=this.runRecord(id,runId);
    return {...copy(run),current:run.inputHash===project.dataHash,view:run.state==='complete'?this.describe(run):null,downloads:run.state==='complete'?this.artifacts(project,run).map(({id,name,extension})=>({id,name,extension})):[]};
  }
  describe(run) {
    const view=this.spec.product.describe(run.result,run.input);
    if(!view.review.length)view.review.push({key:'overall',label:'Review the complete result',detail:'Confirm the result is suitable for this project.',blocking:false});
    ensure(new Set(view.review.map(i=>i.key)).size===view.review.length,'Duplicate review item key',500);return view;
  }
  async run(id,{revision}) {
    const project=copy(this.checked(id,revision));ensure(project.stage!=='archived','Restore the project before running',409);
    ensure(project.runs.length<10,'At most 10 runs per project. Export and remove older runs first.',409);
    ensure(Buffer.byteLength(JSON.stringify(project.data))<=(this.spec.maxBytes || 512000),'Input exceeds this service limit',413);
    this.spec.validate(project.data);
    const run={id:randomUUID(),createdAt:new Date().toISOString(),input:copy(project.data),inputHash:project.dataHash,ruleVersion:this.spec.version,state:this.config.mode==='paid'?'awaiting-payment':'running',reviews:{},result:null,receipt:null};
    let quote;
    if(this.config.mode==='paid'){quote=this.service.create(run.input);run.jobId=quote.id;}
    project.runs.push(run);project.stage='review';this.event(project,'run-started',run.id);this.commit(project);
    if(quote)return {project:this.detail(project),run:this.runDetail(id,run.id),quote};
    this.active.add(id);
    try {run.result=await this.spec.run(copy(run.input));run.state='complete';this.describe(run);}
    catch(e){run.state='failed';run.result=null;run.error=e.message;}
    finally{this.active.delete(id);}
    this.event(project,'run-finished',`${run.id}: ${run.state}`);this.commit(project);
    return {project:this.detail(project),run:this.runDetail(id,run.id)};
  }
  collect(id,runId,{revision,accessToken}) {
    const project=copy(this.checked(id,revision)),run=project.runs.find(r=>r.id===runId);ensure(run?.jobId,'No paid task attached',404);
    const job=this.service.get(run.jobId,accessToken);ensure(job.inputHash===run.inputHash,'Task input does not match the saved run',409);
    ensure(job.state==='delivered','Payment has not produced a delivered result. Do not pay again.',409);
    run.result=copy(job.result);run.receipt=copy(job.receipt);run.state='complete';this.describe(run);this.event(project,'paid-result-collected',run.id);this.commit(project);
    return {project:this.detail(project),run:this.runDetail(id,runId)};
  }
  review(id,runId,{revision,key,decision,note=''}) {
    const project=copy(this.checked(id,revision)),run=project.runs.find(r=>r.id===runId);ensure(run?.state==='complete','Only completed results can be reviewed',409);
    ensure(project.stage!=='archived','Restore the archived project before review',409);
    ensure(run.inputHash===project.dataHash,'This run is stale. Run the current input before review.',409);
    const target=this.describe(run).review.find(i=>i.key===key);ensure(target,'Unknown review item');
    ensure(['accept','flag'].includes(decision),'Review decision must be accept or flag');ensure(!target.blocking || decision==='flag','Fix blocking items in a new input revision; they cannot be waived',409);
    ensure(typeof note==='string' && note.length<=2000 && (decision!=='flag' || note.trim()),'Flagged items require a note (up to 2000 characters)');
    run.reviews[key]={decision,note,at:new Date().toISOString()};delete run.approvedAt;project.stage='review';this.event(project,'reviewed',`${runId}: ${key} → ${decision}`);return this.commit(project);
  }
  approve(id,runId,{revision}) {
    const project=copy(this.checked(id,revision)),run=project.runs.find(r=>r.id===runId);ensure(run?.state==='complete','Only completed runs can be released',409);
    ensure(project.stage!=='archived' && run.inputHash===project.dataHash,'Run is archived or stale',409);
    const items=this.describe(run).review;ensure(items.every(i=>!i.blocking && run.reviews[i.key]?.decision==='accept'),'Resolve blockers and accept every review item before release',409);
    run.approvedAt=new Date().toISOString();project.stage='approved';project.approvedRunId=run.id;this.event(project,'released',run.id);return this.commit(project);
  }
  restore(id,runId,{revision}) {const {run}=this.runRecord(id,runId);return this.update(id,{revision,data:run.input,stage:'draft'});}
  removeRun(id,runId,{revision}) {
    const p=copy(this.checked(id,revision));ensure(p.runs.some(r=>r.id===runId),'Run not found',404);ensure(!(p.stage==='approved' && p.approvedRunId===runId),'Keep the released run; edit the input before removing it',409);
    p.runs=p.runs.filter(r=>r.id!==runId);this.event(p,'run-removed',runId);return this.commit(p);
  }
  remove(id,{revision}) {this.checked(id,revision);unlinkSync(join(this.dir,`project-${id}.enc`));this.projects.delete(id);return {deleted:true,id};}
  artifacts(project,run) {
    const context={runId:run.id,createdAt:run.createdAt};
    const artifacts=this.spec.product.artifacts(run.result,run.input,context);
    artifacts.push(jsonArtifact('audit','Run audit bundle',{schemaVersion:1,service:this.spec.slug,projectId:project.id,runId:run.id,inputHash:run.inputHash,ruleVersion:run.ruleVersion,createdAt:run.createdAt,
      release:run.approvedAt?{approvedAt:run.approvedAt,currentlyReleased:project.stage==='approved' && project.approvedRunId===run.id && project.dataHash===run.inputHash}:null,reviews:run.reviews,receipt:run.receipt,result:run.result}));
    return artifacts;
  }
  export(id,runId,format) {
    const {project,run}=this.runRecord(id,runId);ensure(run.state==='complete','Only completed runs can be exported',409);
    const artifact=this.artifacts(project,run).find(a=>a.id===format);ensure(artifact,'Export format not found',404);
    const released=project.stage==='approved' && project.approvedRunId===run.id && run.inputHash===project.dataHash;
    return {...artifact,filename:`${this.spec.slug}-${run.id.slice(0,8)}-${released?'released':'draft'}-${artifact.id}.${artifact.extension}`};
  }
}
