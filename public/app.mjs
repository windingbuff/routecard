const state={boot:null,key:'',projects:[],project:null,draft:null,draftName:'',draftDescription:'',run:null,tab:'inputs',filter:'active',search:'',dirty:false,errors:new Map(),quote:null,comparison:null};
const $=selector=>document.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=value=>structuredClone(value),short=id=>String(id||'').slice(0,8),when=value=>new Date(value).toLocaleString();
const get=(object,path)=>path.split('.').reduce((v,key)=>v?.[key],object);
function set(object,path,value){const parts=path.split('.');if(parts.some(p=>['__proto__','constructor','prototype'].includes(p)))throw Error('Invalid field path');let target=object;for(const p of parts.slice(0,-1)){if(!target[p])target[p]={};target=target[p];}target[parts.at(-1)]=value;}
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.className=error?'error':'';el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,error?10000:4000);}
async function request(path,method='GET',body,headers={}){
  const response=await fetch(path,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(path.startsWith('/api/projects')?{'x-workspace-key':state.key}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw Error(data.error || `Request failed (${response.status})`);return data;
}
function changed(){state.dirty=true;const label=$('#save-state');if(label)label.textContent='Unsaved input changes';}
function checkDraft(){if(state.errors.size)throw Error([...state.errors.values()][0]);}
async function refreshList(){state.projects=(await request('/api/projects')).projects;}
async function openProject(id,force=false){
  if(!force && state.dirty && !confirm('Discard unsaved input changes?'))return;
  state.project=await request(`/api/projects/${id}`);state.draft=clone(state.project.data);state.draftName=state.project.name;state.draftDescription=state.project.description;state.dirty=false;state.errors.clear();state.quote=null;state.comparison=null;
  const latest=state.project.runs.at(-1);state.run=latest?await request(`/api/projects/${id}/runs/${latest.id}`):null;
  state.tab='inputs';location.hash=`project=${encodeURIComponent(id)}`;render();
}
async function updateProject(body){state.project=await request(`/api/projects/${state.project.id}`,'PATCH',{revision:state.project.revision,...body});await refreshList();}
async function saveDraft(){
  checkDraft();if(!state.project)return;
  const name=state.draftName,description=state.draftDescription;
  await updateProject({name,description,data:state.draft});state.dirty=false;state.draft=clone(state.project.data);toast('Project saved');
}
async function loadSelectedRun(id){state.run=await request(`/api/projects/${state.project.id}/runs/${id}`);state.comparison=null;}
function badge(value){return `<span class="badge ${esc(value)}">${esc(value)}</span>`;}
function button(action,label,options=''){return `<button type="button" data-action="${esc(action)}" ${options}>${esc(label)}</button>`;}
function emptyPanel(title,message){return `<section class="panel empty"><h2>${esc(title)}</h2><p>${esc(message)}</p></section>`;}
function sidebarItems(){
  const projects=state.projects.filter(p=>(state.filter==='archived'?p.stage==='archived':p.stage!=='archived') && `${p.name} ${p.description}`.toLowerCase().includes(state.search.toLowerCase()));
  return projects.length?projects.map(p=>`<li><button data-action="open-project" data-id="${p.id}" class="${state.project?.id===p.id?'selected':''}"><strong>${esc(p.name)}</strong><small>${esc(p.stage)} · ${p.runs} run${p.runs===1?'':'s'}</small></button></li>`).join(''):'<li class="muted">No matching projects.</li>';
}
function render(){
  const boot=state.boot;if(!boot)return;
  $('#app').innerHTML=`<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${esc(boot.title[0])}</span><div>${esc(boot.title)}<small>${esc(boot.product.category)}</small></div></div>
    ${button('new-project',`+ New ${boot.product.projectNoun.toLowerCase()}`,'class="primary"')}
    <label class="search"><span class="eyebrow">Find a project</span><input id="project-search" type="search" value="${esc(state.search)}" placeholder="Search name or brief"></label>
    <div class="filter-row">${button('active-filter','Active',`class="${state.filter==='active'?'selected':''}"`)}${button('archived-filter','Archived',`class="${state.filter==='archived'?'selected':''}"`)}</div>
    <ul class="project-list" id="project-list">${sidebarItems()}</ul><footer class="sidebar-footer"><div class="actions">${button('import-project','Import inputs')}${button('unlock','Access token')}</div><p>Projects are saved on this server. Keep its private data directory to preserve your work.</p><span>v${esc(boot.version)} · AI-assisted evaluation project</span></footer></aside>
    <div class="content"><header class="topbar"><div class="network"><span class="dot"></span><strong>${esc(boot.product.category)}</strong><span class="badge">${boot.mode==='local'?'Free local mode':'Payment required'}</span></div><span class="muted">Kite agent integration available · ${esc(boot.network)}</span></header><main id="main">${state.project?projectContent():welcome()}</main></div></div>`;
  $('#project-search').oninput=event=>{state.search=event.target.value;$('#project-list').innerHTML=sidebarItems();};
  if(state.project && state.tab==='inputs')bindFields();
  if(state.project && state.tab==='results')bindResultControls();
  const select=$('#run-select');if(select)select.onchange=async()=>{try{await loadSelectedRun(select.value);render();}catch(e){toast(e.message,true);}};
}
function welcome(){return `<section class="empty"><p class="eyebrow">${esc(state.boot.product.projectNoun)}</p><h1>A workspace for the whole job.</h1><p>${esc(state.boot.product.outcome)}</p><div class="actions">${button('new-project','Create your first project','class="primary"')}${button('import-project','Import saved inputs')}</div><div class="steps"><div class="step"><span>01 · PREPARE</span>Keep the brief, inputs and constraints together.</div><div class="step"><span>02 · ITERATE</span>Run a revision, inspect the output and compare alternatives.</div><div class="step"><span>03 · DELIVER</span>Resolve blockers, record a review and export the result.</div></div></section>${integrationPanel()}`;}
function projectContent(){
  const p=state.project;
  return `<div class="project-header"><div><p class="eyebrow">${esc(state.boot.product.projectNoun)} / ${short(p.id)}</p><h1>${esc(p.name)}</h1><p>${esc(p.description || state.boot.product.outcome)}</p></div><div class="actions">${badge(p.stage)}${button('clone','Duplicate scenario')}${button(p.stage==='archived'?'restore-project':'archive',p.stage==='archived'?'Restore':'Archive')}</div></div>
    <nav class="tabs" aria-label="Project workflow">${[['inputs','01 Inputs'],['results','02 Results'],['review','03 Review & release'],['history','History']].map(([key,label])=>`<button type="button" data-action="tab" data-tab="${key}" class="${state.tab===key?'active':''}">${label}</button>`).join('')}</nav>
    ${p.stage==='archived'?'<div class="notice">This project is archived. Restore it before changing inputs or reviews.</div>':''}
    ${state.tab==='inputs'?inputContent():state.tab==='results'?resultsContent():state.tab==='review'?reviewContent():historyContent()}`;
}
function inputContent(){
  const p=state.project,fields=state.boot.product.fields;
  return `<section class="panel"><div class="panel-heading"><div><h2>Project brief</h2><p>Inputs remain editable. Each analysis records an immutable snapshot.</p></div><span class="badge">Revision ${p.inputRevision}</span></div><div class="field-grid"><label>Project name<input id="project-name" maxlength="120" value="${esc(state.draftName)}"></label><label>Brief<textarea id="project-description" maxlength="4000">${esc(state.draftDescription)}</textarea></label></div></section>
    ${fields.map((field,index)=>`<section class="panel field-section" data-field="${index}"><div class="panel-heading"><div><h3>${esc(field.label)}</h3>${field.help?`<p>${esc(field.help)}</p>`:''}</div></div>${fieldMarkup(field,index)}<div id="field-error-${index}" class="field-error" role="alert"></div></section>`).join('')}
    <details class="panel"><summary>Advanced: inspect or replace the input document</summary><textarea id="advanced-input" class="code" aria-label="Input document">${esc(JSON.stringify(state.draft,null,2))}</textarea>${button('apply-json','Apply input document')}</details>
    <div class="form-footer"><span class="save-state" id="save-state">${state.dirty?'Unsaved input changes':`Saved · revision ${p.revision} · ${when(p.updatedAt)}`}</span><div class="actions">${button('backup','Export inputs')}${button('save','Save project',p.stage==='archived'?'disabled':'')}${button('run',state.boot.product.runLabel,`class="primary" ${p.stage==='archived'?'disabled':''}`)}</div></div>${integrationPanel()}`;
}
function inputControl(value,type,options={},attributes=''){
  if(type==='boolean')return `<input type="checkbox" ${value?'checked':''} ${attributes}>`;
  if(type==='choice')return `<select ${attributes}>${(options.choices || []).map(choice=>`<option ${choice===value?'selected':''}>${esc(choice)}</option>`).join('')}</select>`;
  if(['intervals','zones'].includes(type)){
    const encoded=(value||[]).map(v=>type==='intervals'?`${v.start} | ${v.end}`:`${v.start}, ${v.end}`).join('\n');
    return `<textarea ${attributes} placeholder="${type==='intervals'?'ISO start | ISO end, one interval per line':'start, end, one damaged zone per line'}">${esc(encoded)}</textarea>`;
  }
  if(type==='range')return `<input ${attributes} value="${esc((value || []).join(', '))}" placeholder="start, end">`;
  return `<input type="${type==='number'?'number':'text'}" ${type==='number'?'step="1"':''} ${attributes} value="${esc(value??'')}">`;
}
function fieldMarkup(field,index){
  const value=get(state.draft,field.path);
  if(field.type==='table')return tableEditor(field,value || [],index);
  if(field.type==='dictionary' || field.type==='conversions')return dictionaryEditor(field,value || {},index);
  if(field.type==='matrix')return matrixEditor(value || {},index);
  if(field.type==='photos')return photoEditor(value || [],index);
  if(field.type==='filetext')return `<div class="actions"><label class="muted">Import ${field.accept?.includes('.srt')?'SRT':'CSV'} file <input data-upload="${index}" type="file" accept="${esc(field.accept)}"></label></div><textarea class="code" data-simple="${index}" aria-label="${esc(field.label)}">${esc(value)}</textarea>`;
  if(field.type==='boolean')return `<label class="check">${inputControl(value,'boolean',{},`data-simple="${index}"`)}Enabled</label>`;
  const formatted=['list','numberlist'].includes(field.type)?(value||[]).join(', '):value;
  return inputControl(formatted,field.type,field,`data-simple="${index}" aria-label="${esc(field.label)}"`);
}
function tableEditor(field,rows,index){
  return `<div class="table-scroll"><table><thead><tr>${field.columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}<th>Remove</th></tr></thead><tbody>${rows.map((row,r)=>`<tr>${field.columns.map((c,k)=>`<td>${inputControl(row[c.key],c.type,c,`data-cell="${index}" data-row="${r}" data-column="${k}" aria-label="${esc(c.label)} row ${r+1}"`)}</td>`).join('')}<td><button class="quiet remove" type="button" data-action="remove-row" data-field="${index}" data-row="${r}" aria-label="Remove row ${r+1}">×</button></td></tr>`).join('')}</tbody></table></div>${rows.length?'':'<p class="muted">No rows yet.</p>'}${button('add-row','+ Add row',`data-field="${index}"`)}`;
}
function dictionaryRows(field,value){
  if(field.type==='conversions')return Object.entries(value).flatMap(([item,units])=>Object.entries(units).map(([unit,factor])=>({item,unit,factor})));
  return Object.entries(value).map(([key,value])=>({key,value}));
}
function dictionaryEditor(field,value,index){
  const rows=dictionaryRows(field,value),conversion=field.type==='conversions';
  const columns=conversion?['Item','Receipt unit','Base units per receipt unit']:[field.keyLabel||'Key',field.valueLabel||'Value'];
  return `<div class="table-scroll"><table data-dictionary="${index}"><thead><tr>${columns.map(c=>`<th>${esc(c)}</th>`).join('')}<th>Remove</th></tr></thead><tbody>${rows.map((row,r)=>dictionaryRowMarkup(field,row,index,r)).join('')}</tbody></table></div>${button('add-dictionary','+ Add entry',`data-field="${index}"`)}`;
}
function dictionaryRowMarkup(field,row,index,r){
  const props=field.type==='conversions'?['item','unit','factor']:['key','value'];
  return `<tr>${props.map(prop=>`<td>${field.choices && prop==='value'?`<select data-dict-prop="${prop}" aria-label="${esc(field.label)} ${prop} ${r+1}">${field.choices.map(c=>`<option ${row[prop]===c?'selected':''}>${esc(c)}</option>`).join('')}</select>`:`<input data-dict-prop="${prop}" type="${prop==='factor'||(prop==='value'&&field.valueType==='number')?'number':'text'}" value="${esc(row[prop]??'')}" aria-label="${esc(field.label)} ${prop} ${r+1}">`}</td>`).join('')}<td><button class="quiet remove" type="button" data-action="remove-dictionary" data-field="${index}" data-row="${r}" aria-label="Remove entry ${r+1}">×</button></td></tr>`;
}
function matrixEditor(matrix,index){
  const ids=['depot',...(state.draft.stops || []).map(s=>s.id).filter(Boolean)];
  return `<div class="table-scroll"><table><thead><tr><th>From / to</th>${ids.map(id=>`<th>${esc(id)}</th>`).join('')}</tr></thead><tbody>${ids.map(from=>`<tr><th>${esc(from)}</th>${ids.map(to=>`<td>${from===to?'—':`<input type="number" min="0" step="1" data-matrix="${index}" data-key="${esc(`${from}>${to}`)}" value="${esc(matrix[`${from}>${to}`]??'')}" aria-label="Travel minutes ${esc(from)} to ${esc(to)}">`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${button('refresh-matrix','Refresh after changing stops')}`;
}
function photoEditor(photos,index){
  return `<label>Upload source images<input data-photos="${index}" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><div class="photo-grid">${photos.map((p,r)=>`<div class="photo-card">${safeImage(p)}<strong>${esc(p.name)}</strong><small>${esc(p.id)}</small>${button('remove-photo','Remove',`data-field="${index}" data-row="${r}"`)}</div>`).join('')}</div>`;
}
function safeImage(photo){
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(photo.base64 || ''))return '<span class="muted">No preview</span>';
  const mime=photo.base64.startsWith('/9j/')?'image/jpeg':photo.base64.startsWith('UklGR')?'image/webp':'image/png';
  return `<img src="data:${mime};base64,${photo.base64}" alt="${esc(photo.name)}" loading="eager" decoding="async">`;
}
function parseControl(control,type){
  if(type==='boolean')return control.checked;
  if(type==='number')return control.value===''?'':Number(control.value);
  if(type==='range'){const parts=control.value.split(',').map(v=>Number(v.trim()));if(parts.length!==2||parts.some(v=>!Number.isSafeInteger(v)))throw Error('Enter two integer bounds separated by a comma.');return parts;}
  if(['intervals','zones'].includes(type))return control.value.trim()?control.value.trim().split('\n').map(line=>{const parts=line.split(type==='intervals'?'|':',').map(s=>s.trim());if(parts.length!==2)throw Error(type==='intervals'?'Use start | end on each line.':'Use start, end on each line.');return {start:type==='zones'?Number(parts[0]):parts[0],end:type==='zones'?Number(parts[1]):parts[1]};}):[];
  if(type==='list' || type==='numberlist')return control.value.split(',').map(v=>v.trim()).filter(Boolean).map(v=>type==='numberlist'?Number(v):v);
  return control.value;
}
function fieldChange(index,fn){
  try{fn();state.errors.delete(index);const el=$(`#field-error-${index}`);if(el)el.textContent='';changed();}
  catch(e){state.errors.set(index,e.message);const el=$(`#field-error-${index}`);if(el)el.textContent=e.message;}
}
function bindFields(){
  $('#project-name').oninput=event=>{state.draftName=event.target.value;changed();};$('#project-description').oninput=event=>{state.draftDescription=event.target.value;changed();};
  for(const control of document.querySelectorAll('[data-simple]'))control.oninput=()=>{const index=Number(control.dataset.simple),f=state.boot.product.fields[index];fieldChange(index,()=>set(state.draft,f.path,parseControl(control,f.type)));};
  for(const control of document.querySelectorAll('[data-cell]'))control.oninput=()=>{const index=Number(control.dataset.cell),f=state.boot.product.fields[index],c=f.columns[Number(control.dataset.column)];fieldChange(index,()=>{get(state.draft,f.path)[Number(control.dataset.row)][c.key]=parseControl(control,c.type);});};
  for(const control of document.querySelectorAll('[data-matrix]'))control.oninput=()=>{const index=Number(control.dataset.matrix);fieldChange(index,()=>{state.draft.matrix={...state.draft.matrix,[control.dataset.key]:parseControl(control,'number')};});};
  for(const control of document.querySelectorAll('[data-upload]'))control.onchange=async()=>{
    try{const file=control.files[0];if(!file)return;if(file.size>1000000)throw Error('Text source file must be under 1 MB.');const i=Number(control.dataset.upload),field=state.boot.product.fields[i];set(state.draft,field.path,await file.text());changed();render();}catch(e){toast(e.message,true);}
  };
  for(const input of document.querySelectorAll('[data-photos]'))input.onchange=async()=>{
    try{const files=[...input.files],photos=state.draft.photos || [];if(files.length+photos.length>40 || files.reduce((n,f)=>n+f.size,0)+photos.reduce((n,p)=>n+p.base64.length*.75,0)>6000000)throw Error('Choose at most 40 images and 6 MB total source data.');
      const added=await Promise.all(files.map(async file=>({id:`photo-${crypto.randomUUID().slice(0,8)}`,name:file.name,base64:await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Unable to read image'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);})})));
      state.draft.photos=[...photos,...added];changed();render();
    }catch(e){toast(e.message,true);}
  };
  bindDictionaryInputs();
}
function bindDictionaryInputs(){for(const table of document.querySelectorAll('[data-dictionary]'))for(const control of table.querySelectorAll('input,select'))control.oninput=()=>readDictionary(Number(table.dataset.dictionary));}
function readDictionary(index){
  const field=state.boot.product.fields[index],table=$(`[data-dictionary="${index}"]`);
  fieldChange(index,()=>{
    const rows=[...table.querySelectorAll('tbody tr')].map(tr=>Object.fromEntries([...tr.querySelectorAll('[data-dict-prop]')].map(c=>[c.dataset.dictProp,c.type==='number'?Number(c.value):c.value]))),seen=new Set();
    if(field.type==='conversions'){
      const result={};for(const r of rows){if(!r.item && !r.unit)continue;if(!r.item || !r.unit)throw Error('Both item and receipt unit are required.');const key=`${r.item}\0${r.unit}`;if(seen.has(key))throw Error('Duplicate item / unit conversion.');seen.add(key);const current=Object.hasOwn(result,r.item)?result[r.item]:{};Object.defineProperty(result,r.item,{value:{...current,[r.unit]:r.factor},enumerable:true,writable:true,configurable:true});}set(state.draft,field.path,result);
    }else{const entries=[];for(const r of rows){if(!r.key)continue;if(seen.has(r.key))throw Error('Dictionary keys must be unique.');seen.add(r.key);entries.push([r.key,r.value]);}set(state.draft,field.path,Object.fromEntries(entries));}
  });
}
function runSelector(){return state.project.runs.length?`<select id="run-select" class="run-selector" aria-label="Analysis revision">${[...state.project.runs].reverse().map(r=>`<option value="${r.id}" ${r.id===state.run?.id?'selected':''}>${short(r.id)} · ${esc(r.state)} · ${esc(when(r.createdAt))}</option>`).join('')}</select>`:'';}
function resultsContent(){
  const run=state.run;if(!run)return emptyPanel('No analysis yet','Prepare the inputs and run a revision. Your results will stay with this project.');
  const head=`<div class="panel-heading"><div><h2>Analysis results</h2><p>Run ${short(run.id)} · ${esc(when(run.createdAt))} · rules ${esc(run.ruleVersion)}</p></div>${runSelector()}</div>`;
  if(run.state==='awaiting-payment')return `<section class="panel">${head}<div class="notice">This immutable task requires payment before analysis. Review the quote in the integration panel. No wallet action happens automatically.</div>${paymentPanel()}</section>`;
  if(run.state!=='complete')return `<section class="panel">${head}<div class="notice error">${esc(run.error || run.state)}</div></section>`;
  const view=run.view;
  return `${head}${!run.current||state.dirty?'<div class="notice">This result belongs to a saved input revision. Run the current inputs before releasing it.</div>':''}
    <div class="metrics">${view.metrics.map(m=>`<div class="metric"><strong>${esc(m.value)}</strong><span>${esc(m.label)}</span></div>`).join('')}</div>
    ${graphicContent(view.graphic)}${view.tables.map(table=>`<section class="panel"><h3>${esc(table.title)}</h3>${resultTable(table)}</section>`).join('')}
    <section class="panel"><h3>Deliverables</h3><p class="muted">${run.approvedAt?'This run has a review record. The filename indicates whether it is currently released.':'Draft downloads are available for inspection. Release requires review.'}</p>${downloadList(run)}</section>
    <details class="panel"><summary>Inspect the complete result</summary><pre>${esc(JSON.stringify(run.result,null,2))}</pre></details>`;
}
function resultTable(table){return table.rows.length?`<div class="table-scroll"><table><thead><tr>${table.columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${table.rows.map(row=>`<tr>${table.columns.map(c=>`<td>${typeof row[c.key]==='object'?`<pre>${esc(JSON.stringify(row[c.key],null,2))}</pre>`:esc(typeof row[c.key]==='number'&&!Number.isInteger(row[c.key])?Number(row[c.key].toFixed(3)):row[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<p class="muted">No rows.</p>';}
function graphicContent(graphic){
  if(!graphic)return '';
  let content='',title='';
  if(graphic.type==='stock'){title='Stock layout';content=`<div class="stock-layout">${graphic.bars.map(bar=>`<div><div class="stock-label"><strong>${esc(bar.id)}</strong> · ${bar.length} mm · ${esc(bar.section)}</div><div class="bar-track">${(bar.damaged||[]).map(z=>`<div class="damage" style="left:${100*z.start/bar.length}%;width:${100*(z.end-z.start)/bar.length}%" title="Damaged ${z.start}–${z.end} mm"></div>`).join('')}${bar.cuts.map(c=>`<div class="cut" style="left:${100*c.start/bar.length}%;width:${100*(c.end-c.start+c.kerf)/bar.length}%" title="${esc(c.id)}: ${c.start}–${c.end} mm">${esc(c.id)}</div>`).join('')}</div></div>`).join('')}</div>`;}
  if(graphic.type==='route'){title='Dispatch sequence';content=`<div class="route-flow">${graphic.stops.map((s,i)=>`<div class="route-stop"><p class="eyebrow">Stop ${i+1}</p><strong>${esc(s.id)}</strong><small>Arrive ${minute(s.arrival)}<br>Service ${minute(s.start)}–${minute(s.finish)}</small></div>`).join('')}<div class="route-stop"><p class="eyebrow">Return</p><strong>Depot</strong><small>${minute(graphic.returnTime)}</small></div></div>`;}
  if(graphic.type==='seating'){title='Table layout';content=`<div class="seating">${graphic.tables.map(t=>`<div class="seat-table"><h3>Table ${t.id}</h3>${t.people.map(p=>`<div class="seat-person"><span>${esc(p.id)}</span>${p.mentor?'<span class="badge">Mentor</span>':''}</div>`).join('')}</div>`).join('')}</div>`;}
  if(graphic.type==='palette'){title='Revised token palette';content=`<div class="palette">${Object.entries(graphic.tokens).map(([key,color])=>`<div class="swatch"><div class="swatch-color" style="background:${/^#[a-f0-9]{6}$/i.test(color)?color:'#eeeeee'}"></div><div class="swatch-label"><strong>${esc(key)}</strong>${esc(color)}</div></div>`).join('')}</div>`;}
  if(graphic.type==='subtitles'){title='Subtitle timeline';content=graphic.cues.map(c=>`<div class="cue-row ${graphic.issues.some(i=>i.cue===c.number)?'problem':''}"><strong>${c.number}</strong><span>${(c.start/1000).toFixed(3)}–${(c.end/1000).toFixed(3)} s</span><span>${esc(c.text)}</span></div>`).join('');}
  if(graphic.type==='schedule'){title='Choose a meeting option';content=graphic.candidates.map(c=>`<div class="option"><div><strong>${esc(new Date(c.start).toLocaleString())}</strong><p>${esc(c.local.map(p=>`${p.id}: ${p.start}`).join(' · '))}</p><small>Worst loss ${c.worstLoss} · total loss ${c.totalLoss}</small></div>${button('select-time',c.start===graphic.selected?'Selected':'Use this time',`data-start="${esc(c.start)}"`)}</div>`).join('') || '<p class="muted">No feasible meeting time. Adjust availability or horizon.</p>';}
  if(graphic.type==='photos'){title='Contact sheet & selections';content='<div class="photo-groups">'+graphic.groups.map(group=>`<section class="photo-group"><h3>Group ${group.id}</h3><div class="photo-grid">${group.images.map(image=>{const source=state.run.input.photos.find(p=>p.id===image.id);return `<div class="photo-card">${source?safeImage(source):''}<strong>${esc(image.name)}</strong><small>${esc(image.id)}</small><select data-image-decision="${esc(image.id)}" aria-label="Selection for ${esc(image.name)}"><option value="undecided" ${image.decision==='undecided'?'selected':''}>Choose selection</option>${['keep','omit-from-manifest','cover'].map(d=>`<option ${d===image.decision?'selected':''}>${d}</option>`).join('')}</select></div>`;}).join('')}</div></section>`).join('')+'</div><p class="field-help">Selection changes update the draft. Save and rerun to record them in an immutable result.</p>';}
  return `<section class="panel"><h3>${esc(title)}</h3>${content}</section>`;
}
function minute(value){return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;}
function downloadList(run){return run.downloads.map(a=>`<div class="download"><span>${esc(a.name)}<small>.${esc(a.extension)}</small></span>${button('download','Download',`data-format="${esc(a.id)}"`)}</div>`).join('');}
function reviewContent(){
  const run=state.run;if(!run || run.state!=='complete')return emptyPanel('A completed run is needed','Run an analysis and inspect its results before starting review.');
  const items=run.view.review,accepted=items.filter(i=>run.reviews[i.key]?.decision==='accept').length,blocking=items.filter(i=>i.blocking).length;
  return `<div class="panel-heading"><div><h2>Review & release</h2><p>Decisions belong to this run and input snapshot.</p></div>${runSelector()}</div>
    ${!run.current||state.dirty?'<div class="notice error">This result does not match the current inputs. Run the updated project before review or release.</div>':''}
    <div class="metrics"><div class="metric"><strong>${accepted} / ${items.length}</strong><span>Accepted review items</span></div><div class="metric"><strong>${blocking}</strong><span>Blocking input issues</span></div></div>
    ${items.map((i,index)=>{const decision=run.reviews[i.key];return `<article class="review-card ${i.blocking?'blocking':''} ${decision?.decision==='accept'?'accepted':''}"><div><h3>${esc(i.label)}</h3><p>${esc(i.detail)}</p>${i.blocking?'<p><strong>Fix this issue in the inputs and run a new revision.</strong></p>':''}<textarea data-review-note="${index}" aria-label="Review note for ${esc(i.label)}" placeholder="Review note (required when flagging)">${esc(decision?.note||'')}</textarea>${decision?`<small>${esc(decision.decision)} · ${esc(when(decision.at))}</small>`:''}</div><div class="review-actions">${button('review-item','Accept',`data-index="${index}" data-decision="accept" ${i.blocking||!run.current||state.dirty||state.project.stage==='archived'?'disabled':''}`)}${button('review-item','Flag',`data-index="${index}" data-decision="flag" ${!run.current||state.dirty||state.project.stage==='archived'?'disabled':''}`)}</div></article>`;}).join('')}
    <section class="panel"><h3>Release this revision</h3><p class="muted">Release is an operator review record. It does not certify official ecosystem acceptance.</p>${button('approve',run.approvedAt?'Record release again':'Release reviewed revision',`class="primary" ${blocking || accepted!==items.length || !run.current || state.dirty || state.project.stage==='archived'?'disabled':''}`)}${downloadList(run)}</section>`;
}
function historyContent(){
  const runs=state.project.runs;
  return `<section class="panel"><h2>Analysis history</h2><p class="muted">Up to 10 retained runs per project. Export a run before removing it. Restoring inputs starts a new draft.</p><div class="history-list">${[...runs].reverse().map(r=>`<div class="history-row"><div><strong>${short(r.id)} · ${esc(r.state)} ${r.approvedAt?'· reviewed release':''}</strong><small>${esc(when(r.createdAt))} · input ${short(r.inputHash)} · rules ${esc(r.ruleVersion)}</small></div><div class="actions">${button('view-run','View',`data-id="${r.id}"`)}${button('restore-run','Restore inputs',`data-id="${r.id}"`)}${button('remove-run','Remove',`class="danger" data-id="${r.id}"`)}</div></div>`).join('') || '<p>No analysis runs yet.</p>'}</div></section>
    ${runs.filter(r=>r.state==='complete').length>=2?`<section class="panel"><h3>Compare results</h3><div class="actions"><label>Earlier run<select id="compare-from">${runs.filter(r=>r.state==='complete').map(r=>`<option value="${r.id}">${short(r.id)} · ${esc(when(r.createdAt))}</option>`).join('')}</select></label><label>Later run<select id="compare-to">${[...runs].filter(r=>r.state==='complete').reverse().map(r=>`<option value="${r.id}">${short(r.id)} · ${esc(when(r.createdAt))}</option>`).join('')}</select></label>${button('compare','Compare')}</div>${state.comparison?resultTable({columns:[{key:'path',label:'Changed result field'},{key:'before',label:'Before'},{key:'after',label:'After'}],rows:state.comparison.changes}):''}</section>`:''}
    <section class="panel"><h3>Project activity</h3><ul class="event-list">${[...state.project.events].reverse().map(e=>`<li><time>${esc(when(e.at))}</time><strong>${esc(e.type)}</strong><span>${esc(e.detail)}</span></li>`).join('')}</ul></section>
    <section class="panel"><h3>Remove project data</h3><p class="muted">Exports are your responsibility. Removing a project deletes its saved inputs, runs and reviews from this workspace.</p>${button('delete-project','Delete this project','class="danger"')}</section>`;
}
function integrationPanel(){return `<details class="panel"><summary>Kite agent integration & operator settings</summary><p>${esc(state.boot.workflow)}</p><p>Mode: <strong>${esc(state.boot.mode)}</strong> · Network: ${esc(state.boot.network)}. Free local runs have no payment receipt.</p><div class="actions">${button('network','Check Kite network')}<a href="/kite-service.json" target="_blank" rel="noopener">Service descriptor</a>${button('unlock','Workspace access token')}</div><pre id="network-output"></pre><p class="field-help">Payment setup and unverified client compatibility are documented in the repository. Never enter a private key into this app.</p></details>`;}
function paymentPanel(){return `<pre class="code-block">${esc(state.quote?JSON.stringify(state.quote,null,2):'The quote access token was only returned to the caller that created it. Recover it from that client; it is not stored in project history.')}</pre><label>Task access token<input id="task-token" type="password" autocomplete="off" value="${esc(state.quote?.accessToken||'')}"></label><label>Signed PAYMENT-SIGNATURE (base64)<textarea id="payment-signature" autocomplete="off" placeholder="Use your compatible wallet client to sign. Never paste a private key."></textarea></label><div class="actions">${button('execute-paid','Execute authorized task','class="primary"')}${button('collect-paid','Collect already-delivered result')}</div>`;}
function bindResultControls(){for(const select of document.querySelectorAll('[data-image-decision]'))select.onchange=()=>{
  if(!state.run.current){toast('Restore this run before changing its selections.',true);return;}
  if(select.value==='undecided'){delete state.draft.decisions?.[select.dataset.imageDecision];}else{state.draft.decisions={...(state.draft.decisions||{}),[select.dataset.imageDecision]:select.value};}changed();toast('Selection saved to draft. Run again to record it.');
};}
async function download(path,filename){const response=await fetch(path,{headers:{'x-workspace-key':state.key}});if(!response.ok){const error=await response.json();throw Error(error.error);}const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}

const actions={
  'new-project':()=>{$('#new-heading').textContent=`New ${state.boot.product.projectNoun.toLowerCase()}`;$('#new-form').reset();$('#new-project').showModal();$('#new-name').focus();},
  'open-project':button=>openProject(button.dataset.id),
  'active-filter':()=>{state.filter='active';render();},'archived-filter':()=>{state.filter='archived';render();},
  'unlock':()=>$('#unlock-dialog').showModal(),
  'tab':async button=>{if(state.tab==='inputs'&&state.dirty){await saveDraft();}state.tab=button.dataset.tab;render();},
  'save':async()=>{await saveDraft();render();},
  'run':async()=>{await saveDraft();const output=await request(`/api/projects/${state.project.id}/runs`,'POST',{revision:state.project.revision});state.project=output.project;state.run=output.run;state.quote=output.quote||null;state.tab='results';await refreshList();render();toast(output.run.state==='complete'?'Analysis saved':output.run.state==='awaiting-payment'?'Payment quote prepared':'Analysis failed; inspect the saved error',output.run.state==='failed');},
  'clone':async()=>{if(state.dirty)await saveDraft();const copy=await request(`/api/projects/${state.project.id}/clone`,'POST',{revision:state.project.revision});await refreshList();await openProject(copy.id,true);toast('Scenario created with independent inputs and history');},
  'archive':async()=>{if(state.dirty)await saveDraft();await updateProject({stage:'archived'});state.dirty=false;render();},
  'restore-project':async()=>{await updateProject({stage:'draft'});render();},
  'backup':()=>download(`/api/projects/${state.project.id}/backup`,'project-inputs.json'),
  'import-project':()=>$('#import-file').click(),
  'apply-json':()=>{const data=JSON.parse($('#advanced-input').value);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('An object input document is required');state.draft=data;state.errors.clear();changed();render();},
  'add-row':button=>{const f=state.boot.product.fields[Number(button.dataset.field)],rows=get(state.draft,f.path)||[],row=f.tuples?[]:{};for(const c of f.columns)row[c.key]=c.type==='number'?0:c.type==='boolean'?false:['intervals','zones','range'].includes(c.type)?[]:c.type==='choice'?c.choices[0]:'';set(state.draft,f.path,[...rows,row]);changed();render();},
  'remove-row':button=>{const f=state.boot.product.fields[Number(button.dataset.field)];get(state.draft,f.path).splice(Number(button.dataset.row),1);changed();render();},
  'add-dictionary':button=>{const i=Number(button.dataset.field),f=state.boot.product.fields[i],table=$(`[data-dictionary="${i}"] tbody`);table.insertAdjacentHTML('beforeend',dictionaryRowMarkup(f,{},i,table.children.length));bindDictionaryInputs();},
  'remove-dictionary':button=>{const i=Number(button.dataset.field);button.closest('tr').remove();readDictionary(i);},
  'refresh-matrix':()=>render(),
  'remove-photo':button=>{const photos=state.draft.photos,photo=photos.splice(Number(button.dataset.row),1)[0];delete state.draft.decisions?.[photo.id];state.draft.splitPairs=(state.draft.splitPairs||[]).filter(pair=>!pair.includes(photo.id));changed();render();},
  'select-time':button=>{if(!state.run.current)throw Error('Restore this run before selecting a time.');state.draft.selectedStart=button.dataset.start;changed();state.tab='inputs';render();toast('Meeting selected. Save and run again to enable the calendar export.');},
  'view-run':async button=>{await loadSelectedRun(button.dataset.id);state.tab='results';render();},
  'restore-run':async button=>{if(state.dirty && !confirm('Replace unsaved draft inputs with this run?'))return;state.project=await request(`/api/projects/${state.project.id}/runs/${button.dataset.id}/restore`,'POST',{revision:state.project.revision});state.draft=clone(state.project.data);state.dirty=false;state.errors.clear();state.tab='inputs';await refreshList();render();},
  'remove-run':async button=>{if(!confirm('Remove this run and its reviews? Export it first if needed.'))return;state.project=await request(`/api/projects/${state.project.id}/runs/${button.dataset.id}`,'DELETE',{revision:state.project.revision});if(state.run?.id===button.dataset.id)state.run=null;await refreshList();render();},
  'compare':async()=>{state.comparison=await request(`/api/projects/${state.project.id}/compare?from=${encodeURIComponent($('#compare-from').value)}&to=${encodeURIComponent($('#compare-to').value)}`);render();},
  'review-item':async button=>{const i=Number(button.dataset.index),item=state.run.view.review[i],note=$(`[data-review-note="${i}"]`).value;state.project=await request(`/api/projects/${state.project.id}/runs/${state.run.id}/review`,'POST',{revision:state.project.revision,key:item.key,decision:button.dataset.decision,note});await loadSelectedRun(state.run.id);render();},
  'approve':async()=>{state.project=await request(`/api/projects/${state.project.id}/runs/${state.run.id}/approve`,'POST',{revision:state.project.revision});await loadSelectedRun(state.run.id);await refreshList();render();toast('Reviewed revision released');},
  'download':button=>download(`/api/projects/${state.project.id}/runs/${state.run.id}/export?format=${encodeURIComponent(button.dataset.format)}`,'deliverable'),
  'delete-project':async()=>{if(!confirm('Delete this project, including all saved inputs, runs and reviews?'))return;await request(`/api/projects/${state.project.id}`,'DELETE',{revision:state.project.revision});state.project=null;state.run=null;state.draft=null;state.dirty=false;location.hash='';await refreshList();render();},
  'network':async()=>{const data=await request('/api/kite/network');$('#network-output').textContent=JSON.stringify(data,null,2);},
  'execute-paid':async()=>{const accessToken=$('#task-token').value,signature=$('#payment-signature').value;if(!signature)throw Error('Provide an explicit signed authorization. No signature is generated here.');await request(`/v1/jobs/${state.run.jobId}/execute`,'POST',{}, {authorization:`Bearer ${accessToken}`,'payment-signature':signature});await actions['collect-paid']();},
  'collect-paid':async()=>{const accessToken=$('#task-token').value,output=await request(`/api/projects/${state.project.id}/runs/${state.run.id}/collect`,'POST',{revision:state.project.revision,accessToken});state.project=output.project;state.run=output.run;state.quote=null;render();},
};
$('#app').addEventListener('click',async event=>{const control=event.target.closest('[data-action]');if(!control || control.disabled)return;const action=actions[control.dataset.action];if(!action)return;control.disabled=true;try{await action(control);}catch(e){toast(e.message,true);}finally{if(control.isConnected)control.disabled=false;}});
for(const control of document.querySelectorAll('[data-close-dialog]'))control.onclick=()=>control.closest('dialog').close();
$('#new-form').onsubmit=async event=>{event.preventDefault();try{if(state.dirty && !confirm('Discard unsaved input changes?'))return;const project=await request('/api/projects','POST',{name:$('#new-name').value,description:$('#new-description').value,data:clone(state.boot.sample)});$('#new-project').close();await refreshList();await openProject(project.id,true);}catch(e){toast(e.message,true);}};
$('#unlock-form').onsubmit=async event=>{event.preventDefault();state.key=$('#unlock-key').value;$('#unlock-key').value='';try{await refreshList();$('#unlock-dialog').close();render();}catch(e){state.key='';toast(e.message,true);}};
$('#import-file').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>8600000)throw Error('Input archive is too large.');const saved=JSON.parse(await file.text());if(saved.service!==state.boot.slug || saved.schemaVersion!==1)throw Error('This input archive belongs to another product or format.');if(state.dirty && !confirm('Discard unsaved inputs and open the imported project?'))return;const project=await request('/api/projects','POST',{name:`${saved.name} (import)`.slice(0,120),description:saved.description || '',data:saved.data});await refreshList();await openProject(project.id,true);toast('Inputs imported. Reviews and payment records are not imported.');}catch(e){toast(e.message,true);}finally{event.target.value='';}};
window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
try {
  state.boot=await request('/api/workspace/bootstrap');state.key=state.boot.localKey || '';
  if(/^#[\da-f]{6}$/i.test(state.boot.colors[2]))document.documentElement.style.setProperty('--accent',state.boot.colors[2]);
  try{await refreshList();const id=new URLSearchParams(location.hash.slice(1)).get('project');if(id && state.projects.some(p=>p.id===id))await openProject(id,true);else render();}
  catch(error){render();$('#main').innerHTML=`<section class="panel locked"><h1>Unlock your project workspace</h1><p>${esc(error.message)}</p>${button('unlock','Enter workspace access token','class="primary"')}</section>`;}
} catch(error){$('#app').innerHTML=`<main class="loading"><h1>Workspace unavailable</h1><p>${esc(error.message)}</p></main>`;}
