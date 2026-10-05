import {stat} from 'node:fs/promises';
import {readiness,matchesJob,dayKey,countsTowardCap,MAX_RESUME_BYTES} from './domain.mjs';
import {normalizeJob} from './job-parser.mjs';
import {evaluateJob} from './job-intelligence.mjs';
import {jobFingerprint,blockingDuplicate,compareCandidates} from './job-duplicates.mjs';
import {ApplicationFailure,makeBlocker,blockerPolicy} from './application-lifecycle.mjs';
import {projectAttention} from './attention-queue.mjs';
import {saveFailureSnapshot} from './failure-snapshots.mjs';

function stopped(signal){if(signal.aborted)throw new Error('Stopped before submission');}
const emptyRunStats=()=>({checked:0,attempted:0,submitted:0,unconfirmed:0,needsAnswers:0,ready:0,skipped:0,keywordSkipped:0,failed:0});
function finishMessage(stats){
  const parts=[`${stats.checked} checked`,`${stats.attempted} attempted`,`${stats.submitted} submitted`,`${stats.needsAnswers} need answers`,`${stats.skipped} skipped`];
  if(stats.ready)parts.push(`${stats.ready} ready — dry run`);
  if(stats.unconfirmed)parts.push(`${stats.unconfirmed} unconfirmed`);
  if(stats.failed)parts.push(`${stats.failed} failed`);
  let message=`Run finished. ${parts.join('; ')}.`;
  if(stats.checked>0 && stats.attempted===0 && stats.skipped===stats.checked && stats.keywordSkipped>0){
    message+=` No applications were attempted. ${stats.keywordSkipped} ${stats.keywordSkipped===1?'job was':'jobs were'} rejected by keyword filters. Review your keyword filters.`;
  }
  if(stats.unconfirmed)message+=' Check unconfirmed applications in LinkedIn before trying them again.';
  return message;
}
const realClock={
  now:()=>new Date(),
  sleep(ms,signal){
    return new Promise((resolve,reject)=>{
      if(signal.aborted){reject(new Error('Stopped'));return;}
      const abort=()=>{clearTimeout(timer);reject(new Error('Stopped'));};
      const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
      signal.addEventListener('abort',abort,{once:true});
    });
  }
};

export function createRunner({store,adapter,clock=realClock,dataDir=null}){
 let active=null,starting=false,controller=null;
 const status={state:'idle',currentJob:null,message:'Complete your setup, then open LinkedIn to sign in.',startedAt:null,finishedAt:null,todayCount:0,attentionCount:0,interruptedCount:0,runStats:emptyRunStats()};
 const durable=async operation=>{try{return await operation();}catch(error){if(error.blocker)throw error;throw new ApplicationFailure('storage',null);}};
 const transition=async (task,patch)=>{task.record=await durable(()=>store.transitionWork(task.record.id,{expectedRevision:task.record.revision,now:clock.now(),...patch}));return task.record;};
 const recount=(history,config)=>{status.todayCount=history.filter(r=>countsTowardCap(r,dayKey(clock.now(),config.timezone),config.timezone)).length;status.interruptedCount=history.filter(r=>r.status==='interrupted').length;status.attentionCount=projectAttention(history,[],{}).length;return status.todayCount;};
 const globalBlocker=result=>(result.blockers||[]).find(b=>blockerPolicy(b.code).scope==='global')||(!result.cleanup?.confirmed&&!result.safeInspection?makeBlocker('cleanup_failed',{phase:'cleanup'}):null);
 function pauseFor(blocker,reason){status.state=blocker.code==='unknown'?'failed':'paused';status.message=blocker.code==='cleanup_failed'&&reason&&reason!==blocker.summary?`${blocker.summary} ${reason}`:reason||blocker.summary;}
 async function outcome(task,result){
  let state=result.status;let blockers=(result.blockers||[]).map(b=>makeBlocker(b.code,b));
  if(task.record.attemptedAt){state=result.status==='submitted'||result.evidence&&result.status==='paused'?'submitted':'unconfirmed';if(state==='unconfirmed'&&!blockers.some(b=>b.code==='submission_uncertain'))blockers.unshift(makeBlocker('submission_uncertain',{phase:task.record.phase}));}
  else if(['submitted','unconfirmed'].includes(state)){state='failed';blockers=[makeBlocker('unknown',{phase:task.record.phase})];}
  else if(state==='paused')state=result.pendingQuestions?.length?'needs_answer':'failed';
  if(!['submitted','unconfirmed','skipped','needs_answer','needs_attention','failed','ready'].includes(state))state='failed';
  const patch={status:state,phase:task.record.phase,job:task.job,reason:result.reason||blockers[0]?.summary||state,pendingQuestions:result.pendingQuestions||[],blockers,evidence:result.evidence||null,answerMatches:result.answerMatches||[]};
  if(result.diagnostic&&dataDir)patch.diagnostic=await saveFailureSnapshot(dataDir,task.record.id,result.diagnostic);
  await transition(task,patch);await durable(()=>store.reconcileQuestions());
  const key=state==='needs_answer'||state==='needs_attention'?'needsAnswers':state;status.runStats[key]++;
  if(state==='skipped'&&result.skipKind==='keyword')status.runStats.keywordSkipped++;
  if(task.record.retryOf&&state==='ready')status.message='Application checked with current answers. Dry run did not submit.';
 }
 async function retryWait(task,key,signal){
  const count=task.record.retryCounters[key]||0;if(count>=2)return false;
  await transition(task,{retryCounters:{...task.record.retryCounters,[key]:count+1}});stopped(signal);await clock.sleep([1000,3000][count],signal);stopped(signal);return true;
 }
 async function inspectTask(task,config,signal){
  stopped(signal);status.runStats.checked++;status.currentJob=structuredClone(task.job);status.message=`Checking ${task.job.title} at ${task.job.company}`;
  await transition(task,{status:'inspecting',phase:'inspection'});
  if(blockingDuplicate(task.job,await store.getHistory())){await outcome(task,{status:'skipped',reason:'Already submitted or uncertain in local history'});return false;}
  let details;
  while(true){
   try{details=await adapter.inspect(task.job,{signal});stopped(signal);break;}
   catch(error){stopped(signal);const blocker=error.blocker||makeBlocker('unknown',{phase:'inspection'});if(blocker.code==='network'&&await retryWait(task,'inspectionNavigation',signal))continue;
    const terminal=blockerPolicy(blocker.code).scope==='terminal';await outcome(task,{status:terminal?'skipped':'failed',reason:error.message.split('\n')[0],blockers:[blocker],safeInspection:true});if(blockerPolicy(blocker.code).scope==='global')throw error.blocker?error:new ApplicationFailure('unknown',error.message);return false;
   }
  }
  const needDescription=config.intelligence?.enabled||config.search.includeKeywords.length||config.search.excludeKeywords.length;
  if(!details.alreadyApplied&&details.easyApply&&needDescription&&(typeof details.description!=='string'||!details.description.trim())){
   await outcome(task,{status:'failed',reason:'Could not read this job description, so eligibility and keyword filters could not be checked. Open the job in LinkedIn and try again.',blockers:[makeBlocker('navigation',{phase:'inspection'})],safeInspection:true});return false;
  }
  if(details.alreadyApplied||!details.easyApply){await outcome(task,{status:'skipped',reason:details.alreadyApplied?'LinkedIn shows this job as already applied':'No LinkedIn Easy Apply',blockers:[makeBlocker(details.alreadyApplied?'already_applied':'external_redirect',{phase:'inspection'})]});return false;}
  if(config.intelligence?.enabled){task.job=normalizeJob(task.job,details,{now:clock.now()});task.job.assessment=evaluateJob(task.job,config,{now:clock.now()});task.job.fingerprint=jobFingerprint(task.job);}
  else task.job={...task.job,description:details.description};
  await transition(task,{job:task.job});
  const duplicate=blockingDuplicate(task.job,await store.getHistory());
  if(duplicate){task.job.duplicateEvidence={jobId:duplicate.job.id,fingerprint:task.job.fingerprint};await outcome(task,{status:'skipped',reason:'Equivalent job already submitted or uncertain in local history'});return false;}
  if(config.intelligence?.enabled&&task.job.assessment.decision!=='apply'){await outcome(task,{status:'skipped',reason:task.job.assessment.reasons.map(r=>r.message+(r.evidence&&typeof r.evidence==='string'?`: ${r.evidence}`:'')).join('; ')});return false;}
  if(!config.intelligence?.enabled&&!matchesJob(details.description,config.search)){await outcome(task,{status:'skipped',reason:'Description does not match your keyword filters',skipKind:'keyword'});return false;}
  return true;
 }
 async function applyTask(task,config,answers,signal){
  await transition(task,{status:'filling',phase:'form'});status.currentJob=structuredClone(task.job);status.message=`Applying to ${task.job.title} at ${task.job.company}`;
  const beforeSubmit=async({validateReady}={})=>{
   stopped(signal);if(config.dryRun||task.record.attemptedAt)throw new ApplicationFailure('storage','Submission cannot be reserved twice or in a dry run');
   const check=async()=>{const current=await store.getHistory();if(blockingDuplicate(task.job,current))throw new ApplicationFailure('unknown','This job or an equivalent posting already has a submitted or uncertain attempt');if(recount(current,config)>=config.dailyCap)throw new ApplicationFailure('unknown','Daily application cap reached');return current;};
   const current=await check(),times=current.map(r=>Date.parse(r.attemptedAt)).filter(Number.isFinite);
   if(times.length){const wait=Math.max(...times)+config.intervalSeconds*1000-clock.now().getTime();if(wait>0){status.message=`Waiting ${Math.ceil(wait/1000)} seconds before submission`;await clock.sleep(wait,signal);}}
   stopped(signal);await check();if(typeof validateReady!=='function')throw new ApplicationFailure('storage','Fresh submission validation is missing');await validateReady();stopped(signal);
   task.record=await durable(()=>store.reserveSubmission(task.record.id,{expectedRevision:task.record.revision,now:clock.now(),timezone:config.timezone,dailyCap:config.dailyCap}));status.runStats.attempted++;recount(await store.getHistory(),config);
  };
  const onProgress=async({phase,retryCounters})=>{
   stopped(signal);const merged={...task.record.retryCounters,...retryCounters,inspectionNavigation:task.record.retryCounters.inspectionNavigation,applicationNavigation:task.record.retryCounters.applicationNavigation};
   await transition(task,{phase,retryCounters:merged});
  };
  let result;
  while(true){
   try{result=await adapter.apply(task.job,{profile:structuredClone(config.profile),answers:structuredClone(answers),resumePath:config.resume.path,dryRun:config.dryRun,signal,beforeSubmit,onProgress,retryCounters:structuredClone(task.record.retryCounters)});}
   catch(error){if(signal.aborted&&!task.record.attemptedAt)throw error;result={status:task.record.attemptedAt?'unconfirmed':'failed',reason:error.message.split('\n')[0],blockers:[error.blocker||makeBlocker('unknown',{phase:task.record.phase})],cleanup:{confirmed:false}};}
   if(signal.aborted&&!task.record.attemptedAt)throw new Error('Stopped before submission');
   const blocked=globalBlocker(result);if(!task.record.attemptedAt&&!blocked&&result.blockers?.some(b=>b.code==='network')&&await retryWait(task,'applicationNavigation',signal))continue;break;
  }
  // Persist cleanup evidence as an additional blocker without discarding the original.
  const blocked=globalBlocker(result);if(blocked&&!(result.blockers||[]).some(b=>b.code===blocked.code))result={...result,blockers:[...(result.blockers||[]),blocked]};
  await outcome(task,result);recount(await store.getHistory(),config);if(blocked)pauseFor(blocked,result.reason);return !blocked;
 }
 async function* discovered(config,signal){
  const ids=new Set();for await(const job of adapter.findJobs(config.search,{scanLimit:config.scanLimit,signal,intelligence:config.intelligence})){stopped(signal);if(ids.has(String(job.id)))continue;if(ids.size>=config.scanLimit)break;ids.add(String(job.id));const record=await durable(()=>store.createWork(job,{now:clock.now()}));yield {job:structuredClone(job),record};}
 }
 async function run(config,answers,signal,selected=null){
  try{
   stopped(signal);if(!await adapter.isSignedIn())throw new ApplicationFailure('login_required','Open LinkedIn and sign in, then start again.');
   if(!config.dryRun&&recount(await store.getHistory(),config)>=config.dailyCap){status.state='paused';status.message='Daily application cap reached.';return;}
   const source=selected||discovered(config,signal),ranked=Boolean(config.intelligence?.enabled),eligible=[];
   const atCap=()=>!config.dryRun&&status.todayCount>=config.dailyCap;
   if(ranked){
    const tasks=[];for await(const task of source){stopped(signal);tasks.push(task);status.message=`Collecting jobs for ranking: ${tasks.length}`;}
    for(let i=0;i<tasks.length;i++){stopped(signal);const task=tasks[i];task.job.discoveryIndex=i;if(atCap()){status.state='paused';status.message='Daily application cap reached.';break;}if(await inspectTask(task,config,signal))eligible.push(task);}
    const representatives=new Map();for(const task of eligible.sort((a,b)=>compareCandidates(a.job,b.job))){if(task.job.fingerprint&&representatives.has(task.job.fingerprint)){task.job.duplicateEvidence={jobId:representatives.get(task.job.fingerprint).job.id,fingerprint:task.job.fingerprint};await outcome(task,{status:'skipped',reason:'Equivalent posting already selected in this run'});}else{if(task.job.fingerprint)representatives.set(task.job.fingerprint,task);task.eligible=true;}}
    if(status.state==='running')for(const task of eligible.filter(t=>t.eligible)){stopped(signal);if(atCap()){status.state='paused';status.message='Daily application cap reached.';break;}if(!await applyTask(task,config,answers,signal))break;}
   }else for await(const task of source){stopped(signal);if(atCap()){status.state='paused';status.message='Daily application cap reached.';break;}if(await inspectTask(task,config,signal)&&!await applyTask(task,config,answers,signal))break;}
   if(status.state==='running'){status.state='idle';status.message=finishMessage(status.runStats);}
  }catch(error){if(!signal.aborted)pauseFor(error.blocker||makeBlocker('unknown'),error.message.split('\n')[0]);}
  finally{
   try{await durable(()=>store.recoverWork());recount(await store.getHistory(),config);}catch(error){if(!signal.aborted)pauseFor(makeBlocker('storage'),error.message);}
   try{await adapter.close();}catch{if(!signal.aborted)pauseFor(makeBlocker('browser_unavailable'));}
   if(signal.aborted){status.state='idle';status.message='Stopped. Any submission already in flight was recorded.';}
   status.currentJob=null;status.finishedAt=clock.now().toISOString();
  }
 }
 async function launch({dryRun,recordIds}={}){
  if(active||starting)throw new Error('The app is already running');starting=true;controller=new AbortController();
  try{
   if(dryRun!==undefined&&typeof dryRun!=='boolean')throw new Error('Dry run must be true or false');
   if(recordIds!==undefined&&(!Array.isArray(recordIds)||recordIds.length<1||recordIds.length>100||recordIds.some(id=>typeof id!=='string'||!id)||new Set(recordIds).size!==recordIds.length))throw new Error('Retry needs 1–100 unique record IDs');
   await durable(()=>store.recoverWork());const config=await store.getConfig(),answers=await store.getAnswers();if(dryRun!==undefined)config.dryRun=dryRun;
   const missing=readiness(config);if(missing.length)throw new Error(`Complete setup: ${missing.join('; ')}`);const resume=await stat(config.resume.path).catch(()=>null);if(!resume?.isFile()||!resume.size||resume.size>MAX_RESUME_BYTES)throw new Error('The selected résumé is missing, empty, or over 2 MB. Upload it again.');stopped(controller.signal);
   let selected=null;
   if(recordIds){const history=await store.getHistory(),attention=projectAttention(history,await store.getQuestions(),{profile:config.profile,answers});const parents=recordIds.map(id=>{const item=attention.find(a=>a.recordId===id);if(!item?.singleRetry||recordIds.length>1&&!item.readyForBatch)throw new Error('Selected application is not eligible or ready for retry');return history.find(r=>r.id===id);});selected=[];for(const parent of parents){const record=await durable(()=>store.createWork(parent.job,{parentId:parent.id,expectedParentRevision:parent.revision||0,now:clock.now()}));selected.push({job:structuredClone(parent.job),record});}}
   recount(await store.getHistory(),config);status.runStats=emptyRunStats();status.state='running';status.currentJob=null;status.startedAt=clock.now().toISOString();status.finishedAt=null;status.message=config.dryRun?'Starting dry run':recordIds?'Retrying selected applications':'Starting automatic applications';const signal=controller.signal;active=run(config,answers,signal,selected).finally(()=>{active=null;});return structuredClone(status);
  }catch(error){await store.recoverWork().catch(()=>{});throw error;}finally{starting=false;}
 }
 return {getStatus:()=>structuredClone(status),start:options=>launch(options),retry(options={}){if(!Object.hasOwn(options,'recordIds'))return Promise.reject(new Error('Retry needs record IDs'));return launch(options);},
  async stop(){controller?.abort();if(active){status.state='stopping';status.message='Stopping. Waiting for any submission already in flight.';await active;}await adapter.close();status.state='idle';status.currentJob=null;if(!status.message.startsWith('Stopped.'))status.message='Stopped.';return structuredClone(status);},
  async openBrowser(){if(active||starting)throw new Error('Stop the active run before opening a sign-in browser');await adapter.openBrowser();status.message='LinkedIn browser opened. Sign in there, then start applying.';return structuredClone(status);},async waitForIdle(){if(active)await active;}
 };
}
