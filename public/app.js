import {countries} from './locations.js';

const byId=id=>document.getElementById(id);
const profileKeys=['firstName','lastName','email','phone','city','state','postalCode','country','linkedinUrl','website'];
const resultNames={submitted:'Submitted',unconfirmed:'Unconfirmed',submission_pending:'Submission pending',needs_answer:'Needs answer',ready:'Ready — dry run',skipped:'Skipped',failed:'Failed',queued:'Queued',inspecting:'Inspecting',filling:'Filling',needs_attention:'Needs attention',interrupted:'Interrupted'};
const pageCopy={dashboard:['Your application workspace','Find matching jobs and apply using your saved profile.'],settings:['Set up your next search','Your profile, résumé, and preferences for the next run.'],answers:['Saved answers','Your answers to the questions employers ask.'],history:['Application history','A record of what was submitted, skipped, or needs attention.']};
let state=null,ready=false,busy=false,view='dashboard',toastTimer,questionSignature='',answerSignature='',controlId=0,committedCountry='';
let commonSignature='',recognizedSignature='',smsEmployersSignature='',attentionSignature='';
const answerDrafts=new Map();
const pendingDrafts=new Map();
let pendingGroupCounts=new Map();
let recommendationResume=null,recommendationLoading=false,recommendationRequest=0;
const create=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=String(text);return element;};
function setView(next){
  view=next;
  for(const name of Object.keys(pageCopy))byId(`${name}-view`).hidden=name!==view;
  document.querySelectorAll('.nav-item').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  byId('page-title').textContent=pageCopy[view][0];byId('page-subtitle').textContent=pageCopy[view][1];document.title=`Job Applier · ${view[0].toUpperCase()+view.slice(1)}`;
}
const themeToggle=byId('theme-toggle');
function syncThemeToggle(){const dark=document.documentElement.dataset.theme==='dark';themeToggle.textContent=dark?'Light mode':'Dark mode';themeToggle.setAttribute('aria-label',dark?'Light mode':'Dark mode');}
syncThemeToggle();
themeToggle.addEventListener('click',()=>{window.jobApplierTheme.toggle();syncThemeToggle();});

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
  document.querySelectorAll('.retry-action').forEach(button=>{button.disabled=!ready||busy||active||state.readiness.length>0||(!dryRun&&capReached)||button.dataset.eligible==='false';});
  byId('stop-button').disabled=!ready||busy||!active;
  byId('browser-button').disabled=!ready||busy||active;
  byId('save-settings').disabled=!ready||busy;byId('save-answer').disabled=!ready||busy;byId('resume-upload').disabled=!ready||busy;
  document.querySelectorAll('.answer-action').forEach(button=>{button.disabled=!ready||busy;});
  document.querySelectorAll('#settings-form input:not([type=file]),#settings-form textarea,#settings-form select,#new-question,#new-answer').forEach(input=>{input.disabled=!ready;});
  const read=byId('read-resume-keywords');
  read.disabled=!ready||busy||recommendationLoading||!state?.config.resume;
  read.textContent=recommendationLoading?'Reading résumé…':'Read résumé';read.classList.toggle('is-loading',recommendationLoading);read.setAttribute('aria-busy',String(recommendationLoading));
  byId('add-resume-keywords').disabled=!ready||busy||recommendationLoading||!byId('recommended-skills').querySelector('input:checked');
  if(byId('add-confirmed-skills'))byId('add-confirmed-skills').disabled=byId('add-resume-keywords').disabled;
  byId('recommended-skills').querySelectorAll('input').forEach(input=>{input.disabled=!ready||busy||recommendationLoading;});
  byId('dry-run').disabled=!ready||busy||active;
}
function fillSettings(){
  const form=byId('settings-form'),config=state.config;
  for(const key of profileKeys.filter(key=>!['country','state'].includes(key)))form.elements.namedItem(`profile.${key}`).value=config.profile[key]||'';
  fillLocations(config.profile.country,config.profile.state);
  for(const key of ['titles','includeKeywords','excludeKeywords'])form.elements.namedItem(`search.${key}`).value=config.search[key].join('\n');
  for(const key of ['location','workplace'])form.elements.namedItem(`search.${key}`).value=config.search[key];
  for(const input of form.querySelectorAll('[name="search.experienceLevels"]'))input.checked=(config.search.experienceLevels||[]).includes(input.value);
  form.elements.namedItem('search.keywordMatch').value=config.search.keywordMatch||'all';
  updateKeywordHelp();
  for(const key of ['dailyCap','scanLimit','intervalSeconds','timezone'])form.elements.namedItem(key).value=config[key];
  byId('dry-run').checked=config.dryRun;
  fillMatching();
}
const skillName=id=>state.intelligenceOptions?.skills.find(skill=>skill.id===id)?.label||id;
function matchingInput(container,label,name,value,type='text'){
  const input=create(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;input.value=value??'';container.append(inputLabel(label,input));return input;
}
function matchingChoice(container,label,name,value,choices){
  const input=create('select');input.name=name;
  for(const [key,text] of choices){const option=create('option',null,text);option.value=key;input.append(option);}
  input.value=String(value??'');container.append(inputLabel(label,input));return input;
}
function matchingCheck(container,label,name,checked){
  const input=create('input');input.type='checkbox';input.name=name;input.checked=!!checked;const wrapper=inputLabel(label,input);wrapper.classList.add('check-row');container.append(wrapper);return input;
}
function addSearchRegion(region={}){
  const list=byId('matching-regions');if(list.children.length>=10){toast('Choose at most 10 search regions',true);return;}
  const number=++controlId,row=create('div','matching-region');row.dataset.region='true';
  const name=matchingInput(row,`Search region ${list.children.length+1}`,'',region.name||'');name.dataset.regionField='name';name.setAttribute('list','matching-location-options');
  const priority=matchingInput(row,`Priority for region ${list.children.length+1}`,'',region.priority??10,'number');priority.min='0';priority.max='10';priority.step='1';priority.dataset.regionField='priority';
  const workplace=matchingChoice(row,`Workplace for region ${list.children.length+1}`,'',region.workplace||'any',[['any','Any workplace'],['remote','Remote'],['hybrid','Hybrid'],['onsite','On site']]);workplace.dataset.regionField='workplace';
  const remove=create('button','button','Remove region');remove.type='button';remove.setAttribute('aria-label',`Remove search region ${list.children.length+1}`);remove.addEventListener('click',()=>row.remove());row.append(remove);list.append(row);syncControls();
}
function fillMatching(){
  const i=state.config.intelligence,root=byId('matching-settings');root.replaceChildren();
  matchingCheck(root,'Enable intelligent matching','intelligence.enabled',i.enabled);
  root.append(create('p','answer-memory-help','When enabled, Include keywords become interests. Confirmed skills determine technical fit; exclusions still apply. Matching facts never fill application questions.'));
  const grid=create('div','matching-grid'),score=matchingInput(grid,'Minimum fit score','intelligence.minimumFitScore',i.minimumFitScore,'number');score.min='55';score.max='100';score.step='1';
  const scoreHelp=create('p','answer-memory-help');const update=()=>{scoreHelp.textContent=Number(score.value)<70?'Borderline jobs can apply at this minimum. Required eligibility still needs to be resolved.':'Jobs below this minimum need review or are skipped. Required eligibility still needs to be resolved.';};score.addEventListener('input',update);update();grid.append(scoreHelp);root.append(grid);
  const facts=create('section','matching-section');facts.append(create('h3',null,'Your confirmed matching facts'));
  const factGrid=create('div','matching-grid'),skills=matchingInput(factGrid,'Confirmed skills','intelligence.skills',(i.candidate.skills||[]).map(skillName).join('\n'),'textarea');
  const reviewed=matchingCheck(factGrid,'I have reviewed my skills','intelligence.skillsReviewed',i.candidate.skills!==null);skills.addEventListener('input',()=>{if(skills.value.trim())reviewed.checked=true;});
  factGrid.append(create('p','answer-memory-help','One recognized skill per line. Leaving skills unreviewed means unknown; a reviewed empty list means none.'));
  const years=matchingInput(factGrid,'Professional experience in years','intelligence.professionalYears',i.candidate.professionalYears,'number');years.min='0';years.max='80';years.step='any';
  matchingChoice(factGrid,'Currently a student','intelligence.student',i.candidate.student,[['','Unknown'],['true','Yes'],['false','No']]);
  const degrees=[['','Unknown'],['none','None'],['high_school','High school'],['associate',"Associate's degree"],['bachelor',"Bachelor's degree"],['master',"Master's degree"],['doctorate','Doctorate']];
  for(const [key,label] of [['currentEducation','Current'],['completedEducation','Completed']]){
    matchingChoice(factGrid,`${label} degree`,`intelligence.${key}.degree`,i.candidate[key]?.degree,degrees);matchingInput(factGrid,`${label} major`,`intelligence.${key}.major`,i.candidate[key]?.major||'');
  }
  const clearances=matchingInput(factGrid,'Existing clearances','intelligence.clearances',(i.candidate.clearances||[]).join('\n'),'textarea'),clearanceReviewed=matchingCheck(factGrid,'I have reviewed my clearances','intelligence.clearancesReviewed',i.candidate.clearances!==null);clearances.addEventListener('input',()=>{if(clearances.value.trim())clearanceReviewed.checked=true;});
  facts.append(factGrid);root.append(facts);
  const families=create('section','matching-section');families.append(create('h3',null,'Choose role families'),create('p','answer-memory-help','Choose only the families you want. Edit their titles or keep custom Job titles above.'));
  const familyGrid=create('div','matching-grid');
  for(const [id,preset] of Object.entries(state.intelligenceOptions.families)){
    const card=create('div','matching-family');card.dataset.family=id;
    const check=matchingCheck(card,preset.label,'intelligence.roleFamilies',i.roleFamilies.includes(id));check.value=id;
    const titles=matchingInput(card,`Titles for ${preset.label}`,`intelligence.familyTitles.${id}`,(i.familyTitles[id]||preset.titles).join('\n'),'textarea'),preferred=matchingCheck(card,`Prefer ${preset.label}`,'intelligence.preferredFamilies',i.preferredFamilies.includes(id));preferred.value=id;
    const visible=()=>{titles.parentElement.hidden=!check.checked;preferred.parentElement.hidden=!check.checked;};check.addEventListener('change',visible);visible();familyGrid.append(card);
  }
  families.append(familyGrid);root.append(families);
  const regions=create('section','matching-section');regions.append(create('h3',null,'Search regions'),create('p','answer-memory-help','Priorities run from 0 to 10. Use an actual country or city for remote searches. With no regions here, Search location above is used. The scan limit bounds coverage; up to 50 title/region queries are supported.'));
  const list=create('div');list.id='matching-regions';regions.append(list);root.append(regions);
  const locations=create('datalist');locations.id='matching-location-options';for(const country of countries){const option=create('option');option.value=country.name;locations.append(option);}regions.append(locations);
  for(const region of i.regions)addSearchRegion(region);
  const add=create('button','button','Add search region');add.type='button';add.addEventListener('click',()=>addSearchRegion());regions.append(add);
  const preferences=create('div','matching-grid');matchingInput(preferences,'Preferred companies','intelligence.preferredCompanies',i.preferredCompanies.join('\n'),'textarea');matchingInput(preferences,'Excluded companies','intelligence.excludedCompanies',i.excludedCompanies.join('\n'),'textarea');
  matchingCheck(preferences,'Exclude unpaid roles','intelligence.excludeUnpaid',i.excludeUnpaid);matchingCheck(preferences,'Exclude commission-only roles','intelligence.excludeCommissionOnly',i.excludeCommissionOnly);matchingCheck(preferences,'Exclude senior roles for an entry-level search','intelligence.rejectSeniorForEntry',i.rejectSeniorForEntry);root.append(preferences);
  if(!byId('add-confirmed-skills')){
    const button=create('button','button','Add selected skills');button.type='button';button.id='add-confirmed-skills';button.disabled=true;byId('add-resume-keywords').after(button);
    button.addEventListener('click',()=>{
      const selected=Array.from(byId('recommended-skills').querySelectorAll('input:checked'),input=>input.value);if(!selected.length||busy||recommendationLoading)return;
      const form=byId('settings-form'),field=form.elements.namedItem('intelligence.skills'),seen=new Set();field.value=[...field.value.split('\n'),...selected].map(v=>v.trim()).filter(v=>v&&!seen.has(v.toLowerCase())&&seen.add(v.toLowerCase())).join('\n');form.elements.namedItem('intelligence.skillsReviewed').checked=true;toast('Selected skills added. Save settings to confirm them.');
    });
  }
}
function matchingSettings(values){
  const lines=name=>String(values.get(name)||'').split('\n').map(value=>value.trim()).filter(Boolean),education=key=>{
    const degree=String(values.get(`intelligence.${key}.degree`)||''),major=String(values.get(`intelligence.${key}.major`)||'').trim();
    if(!degree&&major)throw new Error(`Choose a ${key==='currentEducation'?'current':'completed'} degree to save its major`);return degree?{degree,major:major||null}:null;
  };
  const years=String(values.get('intelligence.professionalYears')||'').trim(),student=String(values.get('intelligence.student')||'');
  return {enabled:values.has('intelligence.enabled'),minimumFitScore:Number(values.get('intelligence.minimumFitScore')),candidate:{skills:values.has('intelligence.skillsReviewed')?lines('intelligence.skills'):null,clearances:values.has('intelligence.clearancesReviewed')?lines('intelligence.clearances'):null,professionalYears:years===''?null:Number(years),student:student===''?null:student==='true',currentEducation:education('currentEducation'),completedEducation:education('completedEducation')},
    roleFamilies:values.getAll('intelligence.roleFamilies'),familyTitles:Object.fromEntries(Object.keys(state.intelligenceOptions.families).map(id=>[id,lines(`intelligence.familyTitles.${id}`)])),regions:Array.from(byId('matching-regions').children,row=>({name:row.querySelector('[data-region-field=name]').value.trim(),priority:Number(row.querySelector('[data-region-field=priority]').value),workplace:row.querySelector('[data-region-field=workplace]').value})),preferredCompanies:lines('intelligence.preferredCompanies'),excludedCompanies:lines('intelligence.excludedCompanies'),preferredFamilies:values.getAll('intelligence.preferredFamilies'),excludeUnpaid:values.has('intelligence.excludeUnpaid'),excludeCommissionOnly:values.has('intelligence.excludeCommissionOnly'),rejectSeniorForEntry:values.has('intelligence.rejectSeniorForEntry')};
}
function updateKeywordHelp(){
  byId('include-help').textContent=byId('keyword-match').value==='any'?'Any can match · one per line':'All must match · one per line';
}
byId('keyword-match').addEventListener('change',updateKeywordHelp);
function recommendationMessage(message,error=false){
  const status=byId('recommendation-status');status.textContent=message;status.classList.toggle('error',error);
}
function clearRecommendations(resume){
  recommendationRequest++;recommendationResume=resume?.path||'';recommendationLoading=false;
  byId('recommended-skills').replaceChildren();
  recommendationMessage(resume?'Read your saved résumé to find suggested skills.':'Upload a résumé to get keyword recommendations.');
}
async function readResumeKeywords(){
  const resume=state?.config.resume;if(!resume||recommendationLoading)return;
  const request=++recommendationRequest;recommendationResume=resume.path;recommendationLoading=true;
  byId('recommended-skills').replaceChildren();recommendationMessage('Reading your saved résumé…');syncControls();
  try{
    const result=await api('/api/resume/keywords',{});
    if(request!==recommendationRequest||state.config.resume?.path!==resume.path)return;
    if(result.resume?.path!==resume.path)throw new Error('The saved résumé changed. Read it again for current recommendations.');
    const keywords=Array.isArray(result.keywords)?result.keywords.filter(value=>typeof value==='string'&&value.trim()):[];
    const fragment=document.createDocumentFragment();
    for(const keyword of keywords){
      const label=create('label'),input=create('input');input.type='checkbox';input.value=keyword;
      input.addEventListener('change',syncControls);label.append(input,document.createTextNode(keyword));fragment.append(label);
    }
    byId('recommended-skills').replaceChildren(fragment);
    recommendationMessage(keywords.length?'Select skills to add to Include keywords.':'No recognizable skills found. Enter your own keywords or try another résumé.');
  }catch(error){
    if(request===recommendationRequest)recommendationMessage(`${error.message} You can still edit Include keywords yourself.`,true);
  }finally{
    if(request===recommendationRequest){recommendationLoading=false;syncControls();}
  }
}
byId('read-resume-keywords').addEventListener('click',readResumeKeywords);
byId('add-resume-keywords').addEventListener('click',()=>{
  const selected=Array.from(byId('recommended-skills').querySelectorAll('input:checked'),input=>input.value);
  if(!selected.length||busy||recommendationLoading)return;
  const input=byId('include-keywords'),keywords=[],seen=new Set();
  for(const value of [...input.value.split('\n'),...selected]){
    const keyword=value.trim(),key=keyword.toLowerCase();if(!keyword||seen.has(key))continue;
    seen.add(key);keywords.push(keyword);
  }
  input.value=keywords.join('\n');byId('keyword-match').value='any';updateKeywordHelp();
  toast('Keywords added. Save settings to apply them.');
});
const locationKey=value=>String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function findCountry(value){
  const key=locationKey(value),aliases={usa:'US',unitedstatesofamerica:'US',uk:'GB',greatbritain:'GB'};
  return countries.find(country=>country.code===aliases[key] || locationKey(country.code)===key || locationKey(country.name)===key);
}
function locationOptions(input,entries,selected){
  const options=entries.map(entry=>{const option=create('option');option.value=entry.name;return option;});
  byId(input.getAttribute('list')).replaceChildren(...options);
  if(selected!==undefined){
    const match=selected&&entries.find(entry=>locationKey(entry.name)===locationKey(selected) || locationKey(entry.code)===locationKey(selected));
    input.value=match?.name||selected||'';
  }
}
function fillRegions(countryValue,selected){
  const country=findCountry(countryValue);
  locationOptions(byId('settings-form').elements.namedItem('profile.state'),country?.regions||[],selected);
}
function fillLocations(countryValue,regionValue){
  const country=findCountry(countryValue);
  locationOptions(byId('settings-form').elements.namedItem('profile.country'),countries,country?.name||countryValue);
  fillRegions(countryValue,regionValue);
  committedCountry=country?.code||locationKey(countryValue);
}
function commitCountry(){
  const form=byId('settings-form'),input=form.elements.namedItem('profile.country'),region=form.elements.namedItem('profile.state');
  const country=findCountry(input.value),key=country?.code||locationKey(input.value);
  input.value=country?.name||input.value.trim();
  fillRegions(input.value,key===committedCountry?region.value.trim():'');
  committedCountry=key;
}
byId('settings-form').elements.namedItem('profile.country').addEventListener('input',event=>fillRegions(event.target.value));
byId('settings-form').elements.namedItem('profile.country').addEventListener('change',commitCountry);
byId('settings-form').elements.namedItem('profile.state').addEventListener('change',event=>fillRegions(byId('settings-form').elements.namedItem('profile.country').value,event.target.value.trim()));
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
    if(record.job.assessment){
      const assessment=record.job.assessment;
      if(assessment.score!==null){result.append(create('p','fit-score',`Fit: ${assessment.score}/100`),create('span','fit-band',assessment.band));}
      const details=create('details','fit-details');details.append(create('summary',null,'Why this fit'));
      const factorNames={title:'Role match',skills:'Technical skills',experience:'Experience',education:'Education and student status',location:'Location',recency:'Posting age',ease:'Easy Apply',interest:'Your interests'};
      for(const factor of assessment.factors||[]){
        details.append(create('p',null,`${factorNames[factor.key]||factor.key}: ${factor.earned}/${factor.max}${factor.unknown?' · unknown':''}`));
        const evidence=(Array.isArray(factor.evidence)?factor.evidence:[factor.evidence]).map(value=>typeof value==='string'?value:value?.text).filter(Boolean);
        for(const text of new Set(evidence))details.append(create('small','fit-evidence',text));
      }
      for(const [key,label] of [['matchedSkills','Matched skills'],['missingSkills','Missing skills']])if(assessment[key]?.length)details.append(create('p',null,`${label}: ${assessment[key].map(skillName).join(', ')}`));
      for(const uncertainty of assessment.uncertainties||[])details.append(create('p',null,uncertainty));
      for(const reason of assessment.reasons||[])details.append(create('p',null,reason.message));result.append(details);
    }
    const date=new Date(record.updatedAt||record.finishedAt||record.attemptedAt||record.startedAt);
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

function retryApplications(recordIds){
  perform(()=>api('/api/retry',{recordIds,dryRun:byId('dry-run').checked}),'Selected applications queued');
}
function renderAttention(){
  const items=state.attention||[],counts=state.attentionCounts||{total:items.length,ready:0,manual:0,interrupted:0,unconfirmed:0};
  byId('attention-summary').textContent=`${counts.total} applications · ${counts.ready} ready to resume · ${counts.manual} need manual completion · ${counts.interrupted} interrupted · ${counts.unconfirmed} uncertain`;
  const selected=items.filter(item=>item.readyForBatch&&item.recordId).slice(0,100).map(item=>item.recordId);
  byId('resume-ready-button').dataset.eligible=String(selected.length>0);
  byId('resume-ready-button').title=selected.length?`Resume ${selected.length} ready applications using the dry run choice above`:'Save missing answers before resuming';
  byId('attention-empty').hidden=items.length>0;
  const signature=JSON.stringify(items);if(signature===attentionSignature)return;attentionSignature=signature;
  const fragment=document.createDocumentFragment();
  for(const item of items){
    const card=create('article','attention-item');if(item.recordId)card.dataset.recordId=item.recordId;
    const heading=create('h3'),url=item.job.url||(/^\d+$/.test(String(item.job.id))?`https://www.linkedin.com/jobs/view/${item.job.id}/`:null);
    let validUrl=false;try{const parsed=new URL(url);validUrl=parsed.protocol==='https:'&&(parsed.hostname==='linkedin.com'||parsed.hostname.endsWith('.linkedin.com'));}catch{}
    const title=create(validUrl?'a':'span',null,item.job.title||'Job details unavailable');
    if(validUrl){title.href=url;title.target='_blank';title.rel='noopener noreferrer';}heading.append(title);card.append(heading);
    const progress=item.answerProgress;
    const currentLabel=progress?.manual?'Manual completion needed':progress?.answered>0&&progress.unanswered===0?'Answer saved — retry needed':resultNames[item.status]||'Needs attention';
    card.append(create('p','attention-context',`${item.job.company||'Employer unavailable'} · ${currentLabel} · ${String(item.phase||'unknown').replaceAll('_',' ')}`));
    const updated=new Date(item.updatedAt),timestamp=create('time','attention-updated');
    if(item.updatedAt&&!Number.isNaN(updated.getTime())){timestamp.dateTime=updated.toISOString();timestamp.textContent=`Updated ${new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:state.config.timezone}).format(updated)}`;}else timestamp.textContent='Update time unavailable';
    card.append(timestamp);
    for(const blocker of item.blockers||[])card.append(create('p','attention-blocker',blocker.code==='missing_answer'&&progress?.unanswered===0?'Previous missing answers are saved. Retry to check the live form.':blocker.summary));
    card.append(create('p','attention-reason',item.retryReason));
    const actions=create('div','attention-actions');
    if(item.questions?.length){
      const questions=create('button','text-button',`View questions (${item.questions.length})`);questions.type='button';questions.addEventListener('click',()=>{setView('answers');byId('pending-questions').scrollIntoView({block:'start'});});actions.append(questions);
    }
    if(item.singleRetry&&item.recordId){const retry=create('button','button retry-action','Retry application');retry.type='button';retry.addEventListener('click',()=>retryApplications([item.recordId]));actions.append(retry);}
    if(item.recordId){
      const button=create('button','text-button','View diagnostics'),output=create('pre','attention-diagnostic');button.type='button';output.hidden=true;output.setAttribute('role','status');
      button.addEventListener('click',async()=>{
        button.disabled=true;output.hidden=false;output.textContent='Loading diagnostics…';
        try{const response=await fetch(`/api/diagnostic/${encodeURIComponent(item.recordId)}`,{headers:{'X-App-Token':state.token}}),data=await response.json();if(!response.ok)throw new Error(data.error||'Diagnostic snapshot unavailable.');output.textContent=JSON.stringify(data.diagnostic,null,2);}catch(error){output.textContent=error.message;}finally{button.disabled=false;}
      });actions.append(button);card.append(actions,output);
    }else card.append(actions);
    fragment.append(card);
  }
  byId('attention-list').replaceChildren(fragment);
}
function inputLabel(text,input){
  const wrapper=create('div','field answer-field'),label=create('label',null,text);
  input.id=`answer-control-${++controlId}`;label.htmlFor=input.id;wrapper.append(label,input);return wrapper;
}
function searchableAnswer(text,options){
  const input=create('input'),field=inputLabel(text,input),group=create('div','answer-choice'),list=create('div','answer-choice-list'),toggle=create('button','answer-choice-toggle','▾');
  const labels=[...new Set(options.filter(option=>option.value!=='').map(option=>option.label))];
  input.type='text';input.autocomplete='off';input.placeholder='Type or choose an answer';
  input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
  list.id=`${input.id}-choices`;list.setAttribute('role','listbox');list.setAttribute('aria-label',text);list.hidden=true;
  input.setAttribute('aria-controls',list.id);toggle.type='button';toggle.setAttribute('aria-label',`Show choices for ${text.replace(/^Answer for /,'')}`);
  field.append(group);group.append(input,toggle,list);
  let matches=labels,active=-1;
  const close=()=>{list.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');active=-1;};
  const choose=label=>{input.value=label;input.dispatchEvent(new Event('change',{bubbles:true}));input.focus();close();};
  const show=()=>{
    const query=input.value.trim().toLocaleLowerCase();matches=labels.filter(label=>label.toLocaleLowerCase().includes(query));active=-1;
    input.removeAttribute('aria-activedescendant');list.replaceChildren();
    for(const [index,label] of matches.entries()){
      const option=create('button','answer-choice-option',label);option.type='button';option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.id=`${list.id}-${index}`;
      option.addEventListener('click',()=>choose(label));list.append(option);
    }
    if(!matches.length)list.append(create('p','answer-choice-empty','No matching choices'));
    list.hidden=false;input.setAttribute('aria-expanded','true');
  };
  input.addEventListener('focus',show);input.addEventListener('input',show);
  toggle.addEventListener('click',()=>{const opening=list.hidden;input.focus();if(opening)show();else close();});
  input.addEventListener('keydown',event=>{
    if(event.key==='Tab'){close();return;}
    if(event.key==='Escape'){event.preventDefault();close();return;}
    if(event.key==='Enter'&&!list.hidden&&active>=0){event.preventDefault();choose(matches[active]);return;}
    if(!['ArrowDown','ArrowUp'].includes(event.key))return;
    event.preventDefault();if(list.hidden)show();if(!matches.length)return;
    active=event.key==='ArrowDown'?(active+1)%matches.length:active<0?matches.length-1:(active-1+matches.length)%matches.length;
    const choices=Array.from(list.children);choices.forEach((option,index)=>option.setAttribute('aria-selected',String(index===active)));
    input.setAttribute('aria-activedescendant',choices[active].id);choices[active].scrollIntoView({block:'nearest'});
  });
  return {input,field,choice:()=>labels.find(label=>label.toLocaleLowerCase()===input.value.trim().toLocaleLowerCase())};
}
const answerText=value=>typeof value==='boolean'?(value?'Yes':'No'):String(value??'');
function matchChoice(options,value){
  const text=answerText(value).trim().toLocaleLowerCase(),available=options.filter(option=>option.value!=='');
  const labels=available.filter(option=>option.label.toLocaleLowerCase()===text);return labels.length===1?labels[0].label:undefined;
}
function answerEditor(question,draftKey,savedValue='',draftAdapter){
  const drafts=draftAdapter||{get:()=>answerDrafts.get(draftKey),set:value=>answerDrafts.set(draftKey,value),clear:()=>answerDrafts.delete(draftKey)};
  const options=question.type==='checkbox'?[{label:'Yes',value:'yes'},{label:'No',value:'no'}]:question.options;
  const searchable=question.type==='select'&&options?.length?searchableAnswer(`Answer for ${question.label}`,options):null;
  const input=searchable?.input||create(options?.length?'select':'input');
  if(input.tagName==='SELECT'){
    const placeholder=create('option',null,'Choose an answer');placeholder.value='';input.append(placeholder);
    for(const option of options){if(option.value==='')continue;const choice=create('option',null,option.label);choice.value=option.label;input.append(choice);}
  }
  const draft=drafts.get(),initial=draft!==undefined?draft:options?.length?(matchChoice(options,savedValue)||''):answerText(savedValue);
  input.value=initial;input.addEventListener('input',()=>drafts.set(input.value));input.addEventListener('change',()=>drafts.set(input.value));
  const row=create('div',searchable?'answer-row searchable-row':'answer-row'),button=create('button','button primary answer-action','Save this answer');button.type='button';
  button.addEventListener('click',()=>{
    const value=options?.length?matchChoice(options,input.value):input.value.trim();
    if(!value){toast(searchable?'Choose an answer from the list':'Enter an answer first',true);return;}
    const beforeSave=input.value;
    perform(async()=>{await api('/api/answers',{...state.answers,[question.answerKey||question.key]:value});drafts.clear(beforeSave);},'Answer saved');
  });
  row.append(searchable?.field||inputLabel(`Answer for ${question.label}`,input),button);
  return {row,input,set(value){
    const text=options?.length?matchChoice(options,value):answerText(value);
    if(text===undefined){toast('That answer is not one of the current choices',true);return;}
    input.value=text;drafts.set(text);input.focus();
  }};
}
function appendSuggestions(card,suggestions,editor){
  if(!suggestions?.length)return;
  const group=create('div','answer-suggestions');group.append(create('p','answer-memory-help','Previous answers to review. Confirm that the meaning is the same before saving.'));
  for(const suggestion of suggestions){
    const item=create('div','answer-suggestion');item.append(create('b',null,suggestion.question),create('p','suggestion-answer',answerText(suggestion.answer)));
    if(suggestion.reason)item.append(create('p',null,suggestion.reason));
    const use=create('button','button answer-action','Use this answer');use.type='button';use.addEventListener('click',()=>editor.set(suggestion.answer));item.append(use);group.append(item);
  }
  card.append(group);
}
function pendingDraft(group){
  const drafts=pendingDrafts.get(group.draftId)||[];
  if(pendingGroupCounts.get(group.draftId)===1&&drafts.length===1)return drafts[0];
  return drafts.find(draft=>draft.targetGroupId===group.id);
}
function pendingDraftAdapter(group){
  return {
    get:()=>pendingDraft(group)?.value,
    set(value){
      let draft=pendingDraft(group);
      if(!draft){draft={draftId:group.draftId,label:group.question.label,value,targetGroupId:group.id};const drafts=pendingDrafts.get(group.draftId)||[];drafts.push(draft);pendingDrafts.set(group.draftId,drafts);}
      draft.value=value;
    },
    clear(beforeSave){
      const draft=pendingDraft(group);
      if(draft&&draft.value===beforeSave){const remaining=pendingDrafts.get(group.draftId).filter(entry=>entry!==draft);if(remaining.length)pendingDrafts.set(group.draftId,remaining);else pendingDrafts.delete(group.draftId);}
      questionSignature='';
    }
  };
}
function renderRetainedDrafts(groups){
  const fragment=document.createDocumentFragment();
  for(const drafts of pendingDrafts.values())for(const draft of drafts){
    if(groups.some(group=>group.question.type!=='unsupported'&&pendingDraft(group)===draft))continue;
    const card=create('article','retained-question-draft');card.append(create('h3',null,draft.label),create('p','retained-value',draft.value),create('p',null,'Your unsaved edit is retained. Review the question before using it.'));
    for(const group of groups.filter(group=>group.draftId===draft.draftId&&group.question.type!=='unsupported')){
      const use=create('button','button answer-action',`Use for this question · ${group.question.company||group.question.label}`);use.type='button';
      use.addEventListener('click',()=>{for(const other of drafts)if(other.targetGroupId===group.id)delete other.targetGroupId;draft.targetGroupId=group.id;questionSignature='';renderQuestions();syncControls();});card.append(use);
    }
    fragment.append(card);
  }
  const container=byId('retained-question-drafts');container.replaceChildren(fragment);container.hidden=container.childNodes.length===0;
}
function appendScreeningExplanation(card,question){
  const explanation=question.screeningExplanation;if(!explanation)return;
  card.append(create('p','screening-meaning',explanation.qualifierSummary),create('p','screening-resolution',explanation.summary));
  const details=create('details','screening-details');details.append(create('summary',null,'Why this answer'));
  if(explanation.sourceQuestion)details.append(create('p',null,`Saved from: ${explanation.sourceQuestion}`));
  if(question.resolutionReason)details.append(create('p',null,question.resolutionReason));
  if(question.reason&&question.reason!==question.resolutionReason)details.append(create('p',null,`Entry issue: ${question.reason}`));
  if(explanation.impact==='high')details.append(create('p',null,'Review the exact wording carefully. No answer is inferred.'));
  card.append(details);
}

function renderQuestions(){
  const groups=state.questionGroups||[],signature=JSON.stringify(groups);if(signature===questionSignature)return;questionSignature=signature;
  const counts=new Map();for(const group of groups)counts.set(group.draftId,(counts.get(group.draftId)||0)+1);
  for(const [draftId,count] of counts)if(count>1&&(pendingGroupCounts.get(draftId)||0)<=1)for(const draft of pendingDrafts.get(draftId)||[])delete draft.targetGroupId;
  pendingGroupCounts=counts;
  const fragment=document.createDocumentFragment(),sections=new Map();
  for(const [kind,title] of [['needs_answer','Needs an answer'],['saved_retry','Answer saved — retry needed'],['manual','Manual completion needed']]){const section=create('section','answer-status-section');section.append(create('h2',null,title));sections.set(kind,section);}
  for(const group of groups){
    const question=group.question;
    const card=create('article','pending-question');card.append(create('h3',null,question.label));
    appendScreeningExplanation(card,question);
    card.append(create('p','question-occurrence-count',`${group.occurrences.length} ${group.occurrences.length===1?'occurrence':'occurrences'}`));
    const saved=group.savedAnswer,savedValue=saved?(saved.displayAnswer??saved.answer):'';
    if(saved){
      const source=saved.source==='profile'?'Profile answer':'Saved answer';
      const next=question.type==='unsupported'?'':' LinkedIn entry still needs a retry.';
      card.append(create('p','answer-provenance',`${source}: ${answerText(savedValue)}.${next}`));
    }
    if(question.type==='unsupported')card.append(create('p',null,'Complete this control directly in LinkedIn. The app cannot enter it automatically.'));
    else{const editor=answerEditor(question,group.draftId,savedValue,pendingDraftAdapter(group));appendSuggestions(card,group.suggestions,editor);card.append(editor.row);}
    const details=create('details','affected-applications');details.append(create('summary',null,'Affected applications'));
    for(const occurrence of group.occurrences){
      const item=create('div','question-occurrence');item.append(jobAnchor({id:occurrence.jobId,title:occurrence.jobTitle||'LinkedIn job'},'question-job'),create('p',null,occurrence.company||'Employer unavailable'),create('p','original-question',occurrence.label));
      if(occurrence.reason)item.append(create('p',null,occurrence.reason));
      if(occurrence.blocker)item.append(create('p','question-blocker',occurrence.blocker==='missing_answer'?'Waiting for your answer':'LinkedIn entry needs attention'));
      details.append(item);
    }
    card.append(details);sections.get(question.answerStatus||'needs_answer').append(card);
  }
  for(const section of sections.values())if(section.querySelector('.pending-question'))fragment.append(section);
  byId('pending-questions').replaceChildren(fragment);byId('questions-empty').hidden=groups.length>0;renderRetainedDrafts(groups);
}
function renderCommonQuestions(){
  const questions=state.answerMemory?.commonQuestions||[],signature=JSON.stringify(questions);if(signature===commonSignature)return;commonSignature=signature;
  const fragment=document.createDocumentFragment();
  for(const question of questions){
    const card=create('article','common-question'),heading=create('h3',null,question.label);card.append(heading);
    if(question.help)card.append(create('p','answer-memory-help',question.help));
    appendScreeningExplanation(card,question);
    if(question.status==='saved'){
      const source=create('p','answer-provenance','Saved from: ');source.append(create('span',null,question.sourceQuestion||question.label));card.append(source);
    }else card.append(create('p','answer-memory-help',question.status==='review'?'Review previous answers before choosing.':'No answer saved. Choose your own answer.'));
    const editor=answerEditor(question,`common:${question.key}`,question.status==='saved'?question.answer:'');appendSuggestions(card,question.suggestions,editor);card.append(editor.row);fragment.append(card);
  }
  byId('common-questions').replaceChildren(fragment);byId('common-questions-empty').hidden=questions.length>0;
}
function smsAnswerKey(company){return `sms consent for ${company.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()}`;}
function updateSmsChoice(){
  const company=byId('sms-employer').value,key=company?`sms:${smsAnswerKey(company)}`:'',saved=state?.answerMemory?.smsAnswers?.[company];
  byId('sms-consent').value=company?(answerDrafts.has(key)?answerDrafts.get(key):matchChoice([{label:'Yes',value:'yes'},{label:'No',value:'no'}],saved)||''):'';
  byId('sms-status').textContent=!company?'Select an employer to review or save your choice.':saved!==undefined?`Saved for ${company}: ${answerText(saved)}`:`No text message consent saved for ${company}.`;
}
function renderSmsConsent(){
  const employers=state.answerMemory?.employers||[],signature=JSON.stringify(employers);
  if(signature!==smsEmployersSignature){
    smsEmployersSignature=signature;const select=byId('sms-employer'),selected=select.value,placeholder=create('option',null,'Choose an employer');placeholder.value='';
    select.replaceChildren(placeholder,...employers.map(company=>{const option=create('option',null,company);option.value=company;return option;}));select.value=employers.includes(selected)?selected:'';
  }
  updateSmsChoice();
}
function renderRecognizedAnswers(){
  const answers=state.answerMemory?.reusedAnswers||[],signature=JSON.stringify(answers);if(signature===recognizedSignature)return;recognizedSignature=signature;
  const fragment=document.createDocumentFragment();
  for(const answer of answers){
    const card=create('article','recognized-answer');card.append(create('h3',null,answer.label));if(answer.company)card.append(create('p','answer-memory-help',answer.company));
    card.append(create('p','recognized-value',answerText(answer.answer)));const source=create('p','answer-provenance','Saved from: ');source.append(create('span',null,answer.sourceQuestion));card.append(source);fragment.append(card);
  }
  byId('recognized-answers').replaceChildren(fragment);byId('recognized-empty').hidden=answers.length>0;
}
function renderLibrary(){
  const signature=JSON.stringify(state.answers);if(signature===answerSignature)return;answerSignature=signature;
  const entries=Object.entries(state.answers).sort(([a],[b])=>a.localeCompare(b)),fragment=document.createDocumentFragment();
  for(const [key,value] of entries){
    const card=create('article','library-answer'),input=create('input'),draftKey=`library:${key}`;input.value=answerDrafts.has(draftKey)?answerDrafts.get(draftKey):String(value);input.addEventListener('input',()=>answerDrafts.set(draftKey,input.value));
    const row=create('div','answer-row'),save=create('button','button answer-action','Update answer');save.type='button';
    save.addEventListener('click',()=>{if(!input.value.trim()){toast('Enter an answer first',true);return;}perform(async()=>{await api('/api/answers',{...state.answers,[key]:input.value.trim()});answerDrafts.delete(draftKey);},'Answer saved');});
    row.append(inputLabel(`Answer for ${key}`,input),save);card.append(row);
    const remove=create('button','text-button delete-answer answer-action','Delete answer');remove.type='button';remove.setAttribute('aria-label',`Delete answer for ${key}`);
    remove.addEventListener('click',()=>perform(async()=>{const next={...state.answers};delete next[key];await api('/api/answers',next);answerDrafts.delete(draftKey);},'Answer deleted'));
    card.append(remove);fragment.append(card);
  }
  byId('answer-library').replaceChildren(fragment);byId('library-empty').hidden=entries.length>0;
}
function render(){
  const config=state.config,status=state.status,active=['running','stopping'].includes(status.state);
  byId('today-count').textContent=status.todayCount;byId('daily-cap').textContent=`/ ${config.dailyCap}`;byId('daily-progress').max=config.dailyCap;byId('daily-progress').value=status.todayCount;
  const counts=state.questionCounts||{distinctQuestions:state.questions.length,affectedApplications:0};
  const progress=state.answerStatusCounts||{needsAnswer:counts.distinctQuestions,savedRetry:0,manual:0};
  byId('confirmed-count').textContent=status.confirmedToday||0;byId('pending-count').textContent=progress.needsAnswer;byId('question-count').textContent=progress.needsAnswer;byId('question-count').hidden=progress.needsAnswer===0;
  byId('question-summary').textContent=`${progress.needsAnswer} need an answer · ${progress.savedRetry} saved, retry needed · ${progress.manual} need manual completion · across ${counts.affectedApplications} ${counts.affectedApplications===1?'application':'applications'}`;
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
  if((config.resume?.path||'')!==recommendationResume)clearRecommendations(config.resume);
  renderHistory();renderAttention();renderQuestions();renderCommonQuestions();renderSmsConsent();renderRecognizedAnswers();renderLibrary();syncControls();
}
async function refresh(){
  state=await api('/api/bootstrap');const first=!ready;ready=true;if(first)fillSettings();render();
}
byId('dry-run').addEventListener('change',syncControls);
byId('resume-ready-button').addEventListener('click',()=>retryApplications((state.attention||[]).filter(item=>item.readyForBatch&&item.recordId).slice(0,100).map(item=>item.recordId)));
document.querySelectorAll('[data-attention-link]').forEach(button=>button.addEventListener('click',()=>{setView('dashboard');byId('attention-panel').scrollIntoView({block:'start'});}));
byId('start-button').addEventListener('click',()=>perform(()=>api('/api/run',{dryRun:byId('dry-run').checked}),'Run started'));
byId('stop-button').addEventListener('click',()=>perform(()=>api('/api/stop',{}),'Run stopped'));
byId('browser-button').addEventListener('click',()=>perform(()=>api('/api/browser',{}),'LinkedIn browser opened'));
byId('history-search').addEventListener('input',()=>{if(state)renderHistory();});byId('history-filter').addEventListener('change',()=>{if(state)renderHistory();});
byId('settings-form').addEventListener('submit',event=>{
  event.preventDefault();commitCountry();const values=new FormData(event.currentTarget),profile={},search={};
  for(const key of profileKeys)profile[key]=String(values.get(`profile.${key}`)||'').trim();
  for(const key of ['titles','includeKeywords','excludeKeywords'])search[key]=String(values.get(`search.${key}`)||'').split('\n').map(item=>item.trim()).filter(Boolean);
  for(const key of ['location','workplace'])search[key]=String(values.get(`search.${key}`)||'').trim();
  search.experienceLevels=values.getAll('search.experienceLevels');
  search.keywordMatch=String(values.get('search.keywordMatch')||'all');
  const config={...state.config,profile,search,dryRun:byId('dry-run').checked};
  try{config.intelligence=matchingSettings(values);}catch(error){toast(error.message,true);return;}
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
    state.config.resume=result.resume;clearRecommendations(result.resume);void readResumeKeywords();
  },'Résumé saved');
});
byId('answer-form').addEventListener('submit',event=>{
  event.preventDefault();const question=byId('new-question').value.trim(),answer=byId('new-answer').value.trim();
  if(!question||!answer){toast('Enter both the question and answer',true);return;}
  perform(async()=>{await api('/api/answers',{...state.answers,[question]:answer});byId('new-question').value='';byId('new-answer').value='';},'Answer saved');
});
byId('sms-employer').addEventListener('change',updateSmsChoice);
byId('sms-consent').addEventListener('change',()=>{const company=byId('sms-employer').value;if(company)answerDrafts.set(`sms:${smsAnswerKey(company)}`,byId('sms-consent').value);});
byId('save-sms-consent').addEventListener('click',()=>{
  const company=byId('sms-employer').value,value=byId('sms-consent').value;
  if(!company){toast('Choose an employer first',true);return;}if(!value){toast('Choose your text message consent first',true);return;}
  perform(async()=>{await api('/api/answers',{...state.answers,[smsAnswerKey(company)]:value});answerDrafts.delete(`sms:${smsAnswerKey(company)}`);},`Text message consent saved for ${company}`);
});
syncControls();refresh().catch(error=>{byId('activity-message').textContent='Cannot reach the local app. Keep its terminal running, then refresh this page.';toast(error.message,true);});
setInterval(()=>{if(!busy)refresh().catch(()=>{byId('state-label').textContent='Offline';});},2500);
