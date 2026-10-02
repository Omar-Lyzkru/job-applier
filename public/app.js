import {countries} from './locations.js';

const byId=id=>document.getElementById(id);
const profileKeys=['firstName','lastName','email','phone','city','state','postalCode','country','linkedinUrl','website'];
const resultNames={submitted:'Submitted',unconfirmed:'Unconfirmed',submission_pending:'Submission pending',needs_answer:'Needs answer',ready:'Ready — dry run',skipped:'Skipped',failed:'Failed'};
const pageCopy={dashboard:['Your application workspace','Find matching jobs and apply using your saved profile.'],settings:['Set up your next search','Your profile, résumé, and preferences for the next run.'],answers:['Saved answers','Your answers to the questions employers ask.'],history:['Application history','A record of what was submitted, skipped, or needs attention.']};
let state=null,ready=false,busy=false,view='dashboard',toastTimer,questionSignature='',answerSignature='',controlId=0;
const create=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;};
function setView(next){
  view=next;
  for(const name of Object.keys(pageCopy))byId(`${name}-view`).hidden=name!==view;
  document.querySelectorAll('.nav-item').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  byId('page-title').textContent=pageCopy[view][0];byId('page-subtitle').textContent=pageCopy[view][1];document.title=`Job Applier · ${view[0].toUpperCase()+view.slice(1)}`;
}
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
function toast(message,error=false){
  clearTimeout(toastTimer);const box=byId('toast');box.textContent=message;box.classList.toggle('error',error);box.hidden=false;toastTimer=setTimeout(()=>{box.hidden=true;},5000);
}
async function api(path,body){
  const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':state.token},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'The request failed');return data;
}
async function perform(task,message){
  if(busy)return;busy=true;syncControls();
  try{await task();await refresh();if(message)toast(message);}catch(error){toast(error.message,true);}finally{busy=false;syncControls();}
}
function syncControls(){
  const active=state&&['running','stopping'].includes(state.status.state),dryRun=byId('dry-run').checked;
  const capReached=state&&state.status.todayCount>=state.config.dailyCap;
  byId('start-button').disabled=!ready||busy||active||state.readiness.length>0||(!dryRun&&capReached);
  byId('start-label').textContent=dryRun?'Start dry run':'Start applying';
  byId('stop-button').disabled=!ready||busy||!active;
  byId('browser-button').disabled=!ready||busy||active;
  byId('save-settings').disabled=!ready||busy;byId('save-answer').disabled=!ready||busy;byId('resume-upload').disabled=!ready||busy;
  document.querySelectorAll('.answer-action').forEach(button=>{button.disabled=!ready||busy;});
  document.querySelectorAll('#settings-form input:not([type=file]),#settings-form textarea,#settings-form select,#new-question,#new-answer').forEach(input=>{input.disabled=!ready;});
  byId('dry-run').disabled=!ready||busy||active;
}
function fillSettings(){
  const form=byId('settings-form'),config=state.config;
  for(const key of profileKeys.filter(key=>!['country','state'].includes(key)))form.elements.namedItem(`profile.${key}`).value=config.profile[key]||'';
  fillLocations(config.profile.country,config.profile.state);
  for(const key of ['titles','includeKeywords','excludeKeywords'])form.elements.namedItem(`search.${key}`).value=config.search[key].join('\n');
  for(const key of ['location','workplace'])form.elements.namedItem(`search.${key}`).value=config.search[key];
  for(const key of ['dailyCap','scanLimit','intervalSeconds','timezone'])form.elements.namedItem(key).value=config[key];
  byId('dry-run').checked=config.dryRun;
}
const locationKey=value=>String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function findCountry(value){
  const key=locationKey(value),aliases={usa:'US',unitedstatesofamerica:'US',uk:'GB',greatbritain:'GB'};
  return countries.find(country=>country.code===aliases[key] || locationKey(country.code)===key || locationKey(country.name)===key);
}
function locationOptions(select,entries,selected,placeholder){
  const prompt=create('option',null,placeholder);prompt.value='';
  const match=entries.find(entry=>locationKey(entry.name)===locationKey(selected) || locationKey(entry.code)===locationKey(selected));
  const options=entries.map(entry=>{const option=create('option',null,entry.name);option.value=entry.name;return option;});
  if(selected&&!match){const current=create('option',null,`${selected} (saved)`);current.value=selected;options.unshift(current);}
  select.replaceChildren(prompt,...options);select.value=match?.name||selected||'';
}
function fillRegions(countryValue,selected=''){
  const country=findCountry(countryValue);
  locationOptions(byId('settings-form').elements.namedItem('profile.state'),country?.regions||[],selected,!country?'Choose a country first':country.regions.length?'Choose a state / region':'No state / region needed');
}
function fillLocations(countryValue,regionValue){
  const country=findCountry(countryValue);
  // Recognize saved abbreviations while keeping unknown saved values available.
  const entries=countries.map(entry=>entry===country?{...entry,code:countryValue}:entry);
  locationOptions(byId('settings-form').elements.namedItem('profile.country'),entries,countryValue,'Choose a country');
  fillRegions(countryValue,regionValue);
}
byId('settings-form').elements.namedItem('profile.country').addEventListener('change',event=>fillRegions(event.target.value));
function jobAnchor(job,className='job-title'){
  const valid=/^\d+$/.test(String(job.id)),element=create(valid?'a':'span',className,job.title||'LinkedIn job');
  if(valid){element.href=`https://www.linkedin.com/jobs/view/${job.id}/`;element.target='_blank';element.rel='noopener noreferrer';}
  return element;
}
function renderRows(body,records){
  const fragment=document.createDocumentFragment();
  for(const record of records){
    const row=create('tr'),title=create('td'),company=create('td',null,record.job.company),result=create('td'),when=create('td');
    title.append(jobAnchor(record.job));
    const known=Object.hasOwn(resultNames,record.status)?record.status:'failed';
    result.append(create('span',`result-badge ${known}`,resultNames[known]));
    if(record.reason)result.append(create('small','result-reason',record.reason));
    const date=new Date(record.finishedAt||record.attemptedAt||record.startedAt);
    when.textContent=Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:state.config.timezone}).format(date);
    row.append(title,company,result,when);fragment.append(row);
  }
  body.replaceChildren(fragment);
}
function renderHistory(){
  const recent=state.history.slice(0,5);renderRows(byId('recent-body'),recent);byId('recent-empty').hidden=recent.length>0;byId('recent-table-wrap').hidden=!recent.length;
  const query=byId('history-search').value.toLowerCase(),filter=byId('history-filter').value;
  const history=state.history.filter(record=>(filter==='all'||record.status===filter)&&`${record.job.title} ${record.job.company}`.toLowerCase().includes(query));
  renderRows(byId('history-body'),history);byId('history-empty').hidden=history.length>0;
}
function inputLabel(text,input){
  const wrapper=create('div','field answer-field'),label=create('label',null,text);
  input.id=`answer-control-${++controlId}`;label.htmlFor=input.id;wrapper.append(label,input);return wrapper;
}
function renderQuestions(){
  const signature=JSON.stringify(state.questions);if(signature===questionSignature)return;questionSignature=signature;
  const fragment=document.createDocumentFragment();
  for(const question of state.questions){
    const card=create('article','pending-question');card.append(create('h3',null,question.label));
    const job=state.history.find(record=>record.job.id===question.jobId)?.job;
    const context=create('p');if(job){context.append(jobAnchor(job,'question-job'));context.append(document.createTextNode(` · ${job.company}`));}else context.textContent='Question from a LinkedIn application';card.append(context);
    if(question.reason)card.append(create('p',null,question.reason));
    if(question.type==='unsupported'){card.append(create('p',null,'Complete this control directly in LinkedIn. The app cannot enter it automatically.'));fragment.append(card);continue;}
    const input=create(question.options?.length||question.type==='checkbox'?'select':'input');
    if(input.tagName==='SELECT'){
      const placeholder=create('option',null,'Choose an answer');placeholder.value='';input.append(placeholder);
      const options=question.type==='checkbox'?[{label:'Yes',value:'yes'},{label:'No',value:'no'}]:question.options;
      for(const option of options){if(option.value==='')continue;const choice=create('option',null,option.label);choice.value=option.label;input.append(choice);}
    }
    const row=create('div','answer-row'),button=create('button','button primary answer-action','Save this answer');button.type='button';
    button.addEventListener('click',()=>{const value=input.value.trim();if(!value){toast('Enter an answer first',true);return;}perform(()=>api('/api/answers',{...state.answers,[question.key]:value}),'Answer saved');});
    row.append(inputLabel(`Answer for ${question.label}`,input),button);card.append(row);fragment.append(card);
  }
  byId('pending-questions').replaceChildren(fragment);byId('questions-empty').hidden=state.questions.length>0;
}
function renderLibrary(){
  const signature=JSON.stringify(state.answers);if(signature===answerSignature)return;answerSignature=signature;
  const entries=Object.entries(state.answers).sort(([a],[b])=>a.localeCompare(b)),fragment=document.createDocumentFragment();
  for(const [key,value] of entries){
    const card=create('article','library-answer'),input=create('input');input.value=String(value);
    const row=create('div','answer-row'),save=create('button','button answer-action','Update answer');save.type='button';
    save.addEventListener('click',()=>{if(!input.value.trim()){toast('Enter an answer first',true);return;}perform(()=>api('/api/answers',{...state.answers,[key]:input.value.trim()}),'Answer saved');});
    row.append(inputLabel(`Answer for ${key}`,input),save);card.append(row);
    const remove=create('button','text-button delete-answer answer-action','Delete answer');remove.type='button';remove.setAttribute('aria-label',`Delete answer for ${key}`);
    remove.addEventListener('click',()=>perform(()=>{const next={...state.answers};delete next[key];return api('/api/answers',next);},'Answer deleted'));
    card.append(remove);fragment.append(card);
  }
  byId('answer-library').replaceChildren(fragment);byId('library-empty').hidden=entries.length>0;
}
function render(){
  const config=state.config,status=state.status,active=['running','stopping'].includes(status.state);
  byId('today-count').textContent=status.todayCount;byId('daily-cap').textContent=`/ ${config.dailyCap}`;byId('daily-progress').max=config.dailyCap;byId('daily-progress').value=status.todayCount;
  byId('confirmed-count').textContent=status.confirmedToday||0;byId('pending-count').textContent=state.questions.length;byId('question-count').textContent=state.questions.length;byId('question-count').hidden=state.questions.length===0;
  byId('state-badge').className=`state-badge ${status.state}`;
  const names={idle:state.readiness.length?'Setup needed':'Ready',running:'Applying',stopping:'Stopping',paused:'Paused',failed:'Needs attention'};
  byId('state-label').textContent=names[status.state]||'Ready';
  byId('activity-title').textContent=({idle:'Ready when you are',running:'Working through your search',stopping:'Stopping the run',paused:'Run paused',failed:'This run needs attention'})[status.state]||'Application runner';
  if(byId('activity-message').textContent!==status.message)byId('activity-message').textContent=status.message;
  byId('current-job').hidden=!status.currentJob;if(status.currentJob)byId('current-job').textContent=`${status.currentJob.title} · ${status.currentJob.company}`;
  byId('setup-card').hidden=state.readiness.length===0;
  byId('readiness-list').replaceChildren(...state.readiness.map(message=>create('li',null,message)));
  byId('profile-step').classList.toggle('complete',state.readiness.every(message=>message==='Upload a résumé'));
  byId('resume-step').classList.toggle('complete',Boolean(config.resume));
  byId('resume-name').textContent=config.resume?.filename||'No résumé uploaded';byId('resume-detail').textContent=config.resume?`${Math.ceil(config.resume.size/1000)} KB · ready to use`:'PDF, DOC, or DOCX · up to 2 MB';
  renderHistory();renderQuestions();renderLibrary();syncControls();
}
async function refresh(){
  state=await api('/api/bootstrap');const first=!ready;ready=true;if(first)fillSettings();render();
}
byId('dry-run').addEventListener('change',syncControls);
byId('start-button').addEventListener('click',()=>perform(()=>api('/api/run',{dryRun:byId('dry-run').checked}),'Run started'));
byId('stop-button').addEventListener('click',()=>perform(()=>api('/api/stop',{}),'Run stopped'));
byId('browser-button').addEventListener('click',()=>perform(()=>api('/api/browser',{}),'LinkedIn browser opened'));
byId('history-search').addEventListener('input',()=>{if(state)renderHistory();});byId('history-filter').addEventListener('change',()=>{if(state)renderHistory();});
byId('settings-form').addEventListener('submit',event=>{
  event.preventDefault();const values=new FormData(event.currentTarget),profile={},search={};
  for(const key of profileKeys)profile[key]=String(values.get(`profile.${key}`)||'').trim();
  for(const key of ['titles','includeKeywords','excludeKeywords'])search[key]=String(values.get(`search.${key}`)||'').split('\n').map(item=>item.trim()).filter(Boolean);
  for(const key of ['location','workplace'])search[key]=String(values.get(`search.${key}`)||'').trim();
  const config={...state.config,profile,search,dryRun:byId('dry-run').checked};
  for(const key of ['dailyCap','scanLimit','intervalSeconds'])config[key]=Number(values.get(key));config.timezone=String(values.get('timezone')||'').trim();
  perform(async()=>{
    const result=await api('/api/config',config);
    for(const key of ['linkedinUrl','website']){
      const input=byId('settings-form').elements.namedItem(`profile.${key}`);
      if(input.value.trim()===profile[key])input.value=result.config.profile[key];
    }
  },'Settings saved');
});
byId('resume-upload').addEventListener('change',event=>{
  const file=event.target.files[0];if(!file)return;
  if(file.size>2_000_000||!file.size){toast('Choose a nonempty résumé up to 2 MB',true);event.target.value='';return;}
  perform(async()=>{
    const response=await fetch('/api/resume',{method:'POST',headers:{'X-App-Token':state.token,'X-Filename':encodeURIComponent(file.name),'Content-Type':'application/octet-stream'},body:await file.arrayBuffer()});
    const result=await response.json();if(!response.ok)throw new Error(result.error);event.target.value='';
  },'Résumé saved');
});
byId('answer-form').addEventListener('submit',event=>{
  event.preventDefault();const question=byId('new-question').value.trim(),answer=byId('new-answer').value.trim();
  if(!question||!answer){toast('Enter both the question and answer',true);return;}
  perform(async()=>{await api('/api/answers',{...state.answers,[question]:answer});byId('new-question').value='';byId('new-answer').value='';},'Answer saved');
});
syncControls();refresh().catch(error=>{byId('activity-message').textContent='Cannot reach the local app. Keep its terminal running, then refresh this page.';toast(error.message,true);});
setInterval(()=>{if(!busy)refresh().catch(()=>{byId('state-label').textContent='Offline';});},2500);
