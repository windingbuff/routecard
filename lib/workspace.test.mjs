import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync,readFileSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Workspace,compareRuns} from './workspace.mjs';
import {Service,buildServer} from './server.mjs';
import {csvArtifact} from './product-kit.mjs';

function fixture(t,overrides={}) {
  const dir=mkdtempSync(join(tmpdir(),'project-flow-'));
  const spec={slug:'fixture',title:'Workspace fixture',version:'0.3.0',purpose:'Test a real state transition',colors:['#fff','#172b41','#2456c5'],sample:{value:2},inputSchema:{},
    validate:x=>{if(typeof x.value!=='number')throw Error('Numeric value required');},run:async x=>({value:x.value*2}),
    product:{category:'Tests',fields:[],describe:r=>({metrics:[{label:'Answer',value:r.value}],tables:[],review:[{key:'answer',label:'Review answer',detail:String(r.value),blocking:r.value<0}]}),
      artifacts:r=>[csvArtifact('answer','Answer',[{key:'value',label:'Value'}],[r])]},...overrides};
  const config={mode:'local',network:'kite-testnet',origin:'http://127.0.0.1:3000',dataDir:join(dir,'billing'),workspaceDir:dir};
  const workspace=new Workspace(spec,config,null);
  t.after(()=>{workspace.close();rmSync(dir,{recursive:true,force:true});});
  return {workspace,spec,config,dir};
}
function create(workspace,value=2) {return workspace.create({name:'Workshop batch',description:'Source-sensitive project brief',data:{value}});}
async function completed(workspace,value=2) {const p=create(workspace,value);return workspace.run(p.id,{revision:p.revision});}

test('projects persist across restart and source text is encrypted on disk',async t=>{
  const x=fixture(t),output=await completed(x.workspace),filename=readdirSync(join(x.dir,'fixture')).find(n=>n.endsWith('.enc'));
  const bytes=readFileSync(join(x.dir,'fixture',filename));assert.ok(!bytes.includes(Buffer.from('Source-sensitive project brief')));
  x.workspace.close();const reopened=new Workspace(x.spec,x.config,null);t.after(()=>reopened.close());
  assert.equal(reopened.get(output.project.id).runs[0].result.value,4);assert.equal(reopened.get(output.project.id).description,'Source-sensitive project brief');
});
test('stale edits fail without losing the saved project',t=>{
  const {workspace}=fixture(t),p=create(workspace),updated=workspace.update(p.id,{revision:p.revision,data:{value:3}});
  assert.throws(()=>workspace.update(p.id,{revision:p.revision,data:{value:9}}),/changed/);assert.equal(workspace.get(p.id).data.value,3);assert.equal(updated.inputRevision,2);
});
test('drafts may be incomplete but invalid analysis does not create a fabricated run',async t=>{
  const {workspace}=fixture(t),p=workspace.create({name:'Incomplete draft',data:{value:''}});
  await assert.rejects(workspace.run(p.id,{revision:p.revision}),/Numeric/);assert.equal(workspace.get(p.id).runs.length,0);
});
test('completed run is immutable when the project input changes',async t=>{
  const {workspace}=fixture(t),output=await completed(workspace);workspace.update(output.project.id,{revision:output.project.revision,data:{value:7}});
  const run=workspace.runDetail(output.project.id,output.run.id);assert.equal(run.input.value,2);assert.equal(run.result.value,4);assert.equal(run.current,false);
});
test('release requires current input, every acceptance and no blockers',async t=>{
  const {workspace}=fixture(t),output=await completed(workspace,-1),id=output.project.id,runId=output.run.id;
  assert.throws(()=>workspace.review(id,runId,{revision:output.project.revision,key:'answer',decision:'accept'}),/blocking/);
  assert.throws(()=>workspace.approve(id,runId,{revision:output.project.revision}),/Resolve blockers/);
  const flagged=workspace.review(id,runId,{revision:output.project.revision,key:'answer',decision:'flag',note:'Correct the negative source value'});assert.equal(flagged.stage,'review');
});
test('released artifact becomes a draft after an input change; stale review is rejected',async t=>{
  const {workspace}=fixture(t),output=await completed(workspace),id=output.project.id,runId=output.run.id;
  let p=workspace.review(id,runId,{revision:output.project.revision,key:'answer',decision:'accept'});p=workspace.approve(id,runId,{revision:p.revision});
  assert.equal(p.stage,'approved');assert.match(workspace.export(id,runId,'answer').filename,/-released-/);
  p=workspace.update(id,{revision:p.revision,data:{value:8}});assert.match(workspace.export(id,runId,'answer').filename,/-draft-/);
  assert.throws(()=>workspace.review(id,runId,{revision:p.revision,key:'answer',decision:'accept'}),/stale/);
});
test('duplicate scenario has its own identity and no copied runs or approval',async t=>{
  const {workspace}=fixture(t),output=await completed(workspace),p=workspace.clone(output.project.id,{revision:output.project.revision});
  assert.notEqual(p.id,output.project.id);assert.equal(p.runs.length,0);assert.equal(p.stage,'draft');assert.deepEqual(p.data,{value:2});
});
test('restoring history starts a new draft without altering the old result',async t=>{
  const {workspace}=fixture(t),output=await completed(workspace),id=output.project.id;
  let p=workspace.update(id,{revision:output.project.revision,data:{value:9}});p=workspace.restore(id,output.run.id,{revision:p.revision});assert.equal(p.data.value,2);assert.equal(p.stage,'draft');assert.equal(workspace.runDetail(id,output.run.id).result.value,4);
});
test('run retention refuses excess history and a removed run frees a slot',async t=>{
  const {workspace}=fixture(t);let p=create(workspace);for(let i=0;i<10;i++)p=(await workspace.run(p.id,{revision:p.revision})).project;
  await assert.rejects(workspace.run(p.id,{revision:p.revision}),/10 runs/);p=workspace.removeRun(p.id,p.runs[0].id,{revision:p.revision});assert.equal((await workspace.run(p.id,{revision:p.revision})).project.runs.length,10);
});
test('business errors are recorded as failed analyses with no receipt',async t=>{
  const {workspace}=fixture(t,{run:async()=>{throw Error('Unable to prepare source');}}),output=await completed(workspace);
  assert.equal(output.run.state,'failed');assert.equal(output.run.receipt,null);assert.equal(output.run.result,null);assert.match(output.run.error,/source/);
});
test('an active async analysis prevents edits and duplicate execution',async t=>{
  let release;const {workspace}=fixture(t,{run:()=>new Promise(resolve=>release=()=>resolve({value:4}))}),p=create(workspace),pending=workspace.run(p.id,{revision:p.revision});
  const current=workspace.get(p.id);assert.throws(()=>workspace.update(p.id,{revision:current.revision,data:{value:3}}),/running/);
  await assert.rejects(workspace.run(p.id,{revision:current.revision}),/running/);release();assert.equal((await pending).run.state,'complete');
});
test('paid workspace prepares a quote without computing and cannot collect unpaid results',async t=>{
  const x=fixture(t);x.workspace.close();const config={...x.config,mode:'paid',storageKey:'a'.repeat(64),payTo:'0x'+'2'.repeat(40),asset:'0x'+'3'.repeat(40),amount:'10',tokenName:'Test Asset',tokenVersion:'1',origin:'https://example.test'};
  let calls=0;const spec={...x.spec,run:async()=>{calls++;return {value:4};}},service=new Service(spec,config,{verify:async()=>({isValid:false})}),workspace=new Workspace(spec,config,service);t.after(()=>workspace.close());
  const output=await completed(workspace);assert.equal(calls,0);assert.equal(output.run.state,'awaiting-payment');assert.ok(output.quote.accessToken);
  assert.throws(()=>workspace.collect(output.project.id,output.run.id,{revision:output.project.revision,accessToken:output.quote.accessToken}),/not produced/);
  assert.equal(JSON.stringify(workspace.get(output.project.id)).includes(output.quote.accessToken),false);
});
test('workspace key loss and a second process fail closed',t=>{
  const x=fixture(t);create(x.workspace);assert.throws(()=>new Workspace(x.spec,x.config,null),/already open/);
  x.workspace.close();unlinkSync(join(x.dir,'fixture','storage.key'));assert.throws(()=>new Workspace(x.spec,x.config,null),/key is missing/);
});
test('CSV exports neutralize spreadsheet formulas and quote commas and line breaks',()=>{
  const artifact=csvArtifact('cells','Cells',[{key:'a',label:'Value'}],[{a:'=HYPERLINK("x")'},{a:'hello,\nworld'}]);assert.match(artifact.content,/'=HYPERLINK/);assert.match(artifact.content,/"hello,\nworld"/);
});
test('removing a project deletes its persisted inputs and history',t=>{
  const {workspace,dir}=fixture(t),p=create(workspace);workspace.remove(p.id,{revision:p.revision});assert.throws(()=>workspace.get(p.id),/not found/);assert.equal(readdirSync(join(dir,'fixture')).filter(n=>n.endsWith('.enc')).length,0);
});
test('result comparison reports a changed value and whether the input matches',()=>{
  const compared=compareRuns({id:'a',inputHash:'a',result:{value:2}},{id:'b',inputHash:'b',result:{value:4}});assert.equal(compared.sameInput,false);assert.deepEqual(compared.changes,[{path:'result.value',before:2,after:4}]);
});
test('archived projects cannot silently become editable through review',async t=>{
  const {workspace}=fixture(t),output=await completed(workspace),p=workspace.update(output.project.id,{revision:output.project.revision,stage:'archived'});
  assert.throws(()=>workspace.review(p.id,output.run.id,{revision:p.revision,key:'answer',decision:'accept'}),/archived/);
  assert.equal(workspace.get(p.id).stage,'archived');
});
test('paid project can collect only its verified and delivered immutable task result',async t=>{
  const x=fixture(t);x.workspace.close();const config={...x.config,mode:'paid',storageKey:'b'.repeat(64),payTo:'0x'+'2'.repeat(40),asset:'0x'+'3'.repeat(40),amount:'10',tokenName:'Test Asset',tokenVersion:'1',origin:'https://example.test'};
  const transaction='0x'+'4'.repeat(64),events=[];
  const spec={...x.spec,run:async input=>{events.push('compute');return {value:input.value*2};}};
  const service=new Service(spec,config,{verify:async()=>{events.push('verify');return {isValid:true};},settle:async()=>{events.push('settle');return {success:true,network:'eip155:2368',transaction};}});
  const workspace=new Workspace(spec,config,service);t.after(()=>workspace.close());const output=await completed(workspace),quote=output.quote,job=service.get(quote.id,quote.accessToken);
  const authorization={from:'0x'+'1'.repeat(40),to:config.payTo,value:config.amount,nonce:job.nonce,validAfter:'0',validBefore:String(Math.floor(Date.parse(quote.expiresAt)/1000))};
  const payload={x402Version:2,resource:job.resource,accepted:job.terms,payload:{signature:'0x'+'1'.repeat(130),authorization}};
  await service.execute(job.id,quote.accessToken,Buffer.from(JSON.stringify(payload)).toString('base64'));
  assert.throws(()=>workspace.collect(output.project.id,output.run.id,{revision:output.project.revision,accessToken:'wrong'}),/not found/);
  const collected=workspace.collect(output.project.id,output.run.id,{revision:output.project.revision,accessToken:quote.accessToken});
  assert.deepEqual(events,['verify','compute','settle']);assert.equal(collected.run.result.value,4);assert.equal(collected.run.receipt.transaction,transaction);
});
test('HTTP management requires its key, rejects cross-origin writes, and supports saved workflow',async t=>{
  const x=fixture(t);x.workspace.close();const server=buildServer(x.spec,x.config);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const origin=`http://127.0.0.1:${server.address().port}`,boot=await (await fetch(origin+'/api/workspace/bootstrap')).json();assert.ok(boot.localKey);
    assert.equal((await fetch(origin+'/api/projects')).status,401);
    const headers={'x-workspace-key':boot.localKey,'content-type':'application/json'};
    assert.equal((await fetch(origin+'/api/projects',{method:'POST',headers:{...headers,origin:'https://other.test'},body:JSON.stringify({name:'Bad',data:{value:2}})})).status,403);
    const response=await fetch(origin+'/api/projects',{method:'POST',headers,body:JSON.stringify({name:'HTTP project',data:{value:4}})});assert.equal(response.status,201);const p=await response.json();
    const run=await (await fetch(`${origin}/api/projects/${p.id}/runs`,{method:'POST',headers,body:JSON.stringify({revision:p.revision})})).json();assert.equal(run.run.result.value,8);
    const backup=await (await fetch(`${origin}/api/projects/${p.id}/backup`,{headers})).json();assert.deepEqual(backup.data,{value:4});
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
