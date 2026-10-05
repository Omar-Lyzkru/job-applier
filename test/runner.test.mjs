import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,rename,mkdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {defaultConfig} from '../src/domain.mjs';
import {ApplicationFailure,makeBlocker} from '../src/application-lifecycle.mjs';
import {projectAttention} from '../src/attention-queue.mjs';
import {createRunner} from '../src/runner.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function setup(t,{count=3,outcome='submitted',outcomes={},config={},beforeGuard,afterGuard,throwAfterGuard=false,descriptions={},details={},validateReady=async()=>{}}={}){
  const dir=await mkdtemp(join(tmpdir(),'job-applier-runner-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const resumePath=join(dir,'resume.pdf');await writeFile(resumePath,'%PDF-1.4');
  const store=await createStore(dir);
  await store.saveConfig({...defaultConfig(),profile:{firstName:'Test',lastName:'Applicant',email:'test@example.com',phone:'555'},search:{titles:['Engineer'],location:'Chicago',workplace:'any',includeKeywords:[],excludeKeywords:[]},resume:{path:resumePath,filename:'resume.pdf',size:8},...config});
  await store.saveAnswers({'years of experience':0});
  let time=Date.parse('2026-10-01T15:00:00Z');
  const waits=[];const clock={now:()=>new Date(time),sleep:async(ms,signal)=>{waits.push(ms);if(signal?.aborted)throw new Error('Stopped');time+=ms;}};
  const jobs=Array.from({length:count},(_,i)=>({id:String(1001+i),url:`https://www.linkedin.com/jobs/view/${1001+i}/`,title:'Engineer',company:'Example'}));
  const observed={applications:[],opens:0,events:[],discoveryCalls:0,validations:0};
  const adapter={
    openBrowser:async()=>{observed.opens++;},isSignedIn:async()=>true,close:async()=>{},
    async *findJobs(_search,options){observed.discoveryCalls++;observed.discoveryOptions=options;for(const job of jobs){observed.events.push(`discover:${job.id}`);yield job;}},
    inspect:async job=>{observed.events.push(`inspect:${job.id}`);return {description:Object.hasOwn(descriptions,job.id)?descriptions[job.id]:'Remote Python engineer',easyApply:true,alreadyApplied:false,...details[job.id]};},
    async apply(job,options){
      observed.events.push(`apply:${job.id}`);
      observed.applications.push({job:structuredClone(job),profile:structuredClone(options.profile),answers:structuredClone(options.answers),resumePath:options.resumePath});
      const result=outcomes[job.id]||outcome;
      if(result==='paused')return {status:'paused',reason:'LinkedIn daily application limit',blockers:[makeBlocker('platform_limit')],cleanup:{confirmed:true}};
      if(['needs_answer','failed','skipped'].includes(result))return {status:result,reason:'Blocked before submission',blockers:[makeBlocker(result==='needs_answer'?'missing_answer':result==='skipped'?'job_expired':'validation')],cleanup:{confirmed:true}};
      if(beforeGuard)await beforeGuard(job,options,store);
      if(options.dryRun)return {status:'ready',reason:'Dry run',cleanup:{confirmed:true}};
      await options.beforeSubmit({validateReady:async()=>{observed.validations++;await validateReady(job,options);}});
      if(afterGuard)await afterGuard(job,options,store);
      if(throwAfterGuard)throw new Error('Browser disconnected after submit');
      return {status:result,reason:result==='submitted'?'Application confirmed':'No confirmation',cleanup:{confirmed:true}};
    }
  };
  const runner=createRunner({store,adapter,clock,dataDir:dir});
  t.after(async()=>{await runner.stop();await store.close();});
  return {dir,store,runner,observed,jobs,adapter,clock,waits};
}

const matchingConfig={intelligence:{enabled:true,minimumFitScore:70,candidate:{skills:['Python']},roleFamilies:['swe']}};
test('ranked runner never attempts an unsectioned legal restriction or applicant experience conflict',async t=>{
  const {runner,observed,jobs,store}=await setup(t,{count:2,config:{...matchingConfig,intelligence:{...matchingConfig.intelligence,candidate:{skills:['Python'],professionalYears:0}}},descriptions:{1001:'We cannot provide visa sponsorship.\nRequired: Python',1002:'You must have 3 years of professional experience to join our team.\nRequired: Python'},details:{1001:{location:'Houston, TX, USA',postedAge:'1 hour ago'},1002:{location:'Houston, TX, USA',postedAge:'1 hour ago'}}});
  jobs.forEach(job=>job.title='Software Engineer Intern');await runner.start();await runner.waitForIdle();
  assert.equal(observed.applications.length,0);const history=await store.getHistory();assert.equal(history.some(record=>record.attemptedAt),false);assert.equal(history[0].job.assessment.decision,'review');assert.equal(history[1].job.assessment.score,null);
});
test('runner collects the bounded scan before inspection and applies the highest fit first',async t=>{
  const {runner,observed,jobs,store}=await setup(t,{count:2,config:matchingConfig,descriptions:{1001:'Required: Python and Git',1002:'Required: Python'}});
  jobs.forEach(j=>j.title='Software Engineer Intern');await runner.start();await runner.waitForIdle();
  assert.deepEqual(observed.events,['discover:1001','discover:1002','inspect:1001','inspect:1002','apply:1002','apply:1001']);
  assert.equal(observed.discoveryOptions.intelligence.enabled,true);
  const history=await store.getHistory();assert.equal(history.find(r=>r.job.id==='1002').job.assessment.score,83);assert.equal(history.find(r=>r.job.id==='1001').job.assessment.score,70);
  assert.equal(runner.getStatus().runStats.checked,2);
});
test('runner retains legacy streaming order when intelligent matching is disabled',async t=>{
  const {runner,observed}=await setup(t,{count:2});await runner.start();await runner.waitForIdle();
  assert.deepEqual(observed.events,['discover:1001','inspect:1001','apply:1001','discover:1002','inspect:1002','apply:1002']);
});
test('runner isolates an unreadable intelligent inspection and applies other eligible jobs',async t=>{
  const {runner,observed,jobs,store}=await setup(t,{count:2,config:matchingConfig,descriptions:{1001:'Required: Python',1002:''}});
  jobs.forEach(j=>j.title='Software Engineer Intern');await runner.start();await runner.waitForIdle();
  assert.equal(observed.applications.length,1);assert.equal(runner.getStatus().state,'idle');
  assert.equal((await store.getHistory()).filter(r=>r.attemptedAt).length,1);
});
test('runner suppresses strong reposts but allows unattempted failed histories to retry',async t=>{
  const {runner,observed,jobs,store}=await setup(t,{count:2,config:matchingConfig,descriptions:{1001:'Required: Python',1002:'Required: Python'},details:{1001:{location:'Houston, TX, USA'},1002:{location:'Houston, TX, USA'}}});
  jobs.forEach(j=>j.title='Software Engineer Intern');await store.createRecord(jobs[0],'failed');
  await runner.start();await runner.waitForIdle();assert.equal(observed.applications.length,1);
  assert.equal((await store.getHistory()).filter(r=>r.status==='skipped').length,1);
});
test('runner records fit review without attempting unresolved eligibility or a senior role',async t=>{
  const {runner,observed,jobs,store}=await setup(t,{count:2,config:matchingConfig,descriptions:{1001:'Required: Python\nMust possess active Secret clearance',1002:'Required: Python'}});
  jobs[0].title='Software Engineer Intern';jobs[1].title='Senior Software Engineer';await runner.start();await runner.waitForIdle();
  assert.equal(observed.applications.length,0);const history=await store.getHistory();
  assert.deepEqual(history.map(r=>r.status),['skipped','skipped']);assert.equal(history[0].job.assessment.decision,'review');assert.equal(history[1].job.assessment.score,null);
});
test('runner rechecks a same-ID attempt inserted during pacing before making a second reservation',async t=>{
  const {runner,store,clock}=await setup(t,{count:1});
  const old=await store.createRecord({id:'9999',title:'Another job',company:'Example'},'submission_pending');await store.updateRecord(old.id,{status:'submitted',attemptedAt:'2026-10-01T15:00:00Z'});
  const originalSleep=clock.sleep;clock.sleep=async(ms,signal)=>{const record=await store.createRecord({id:'1001',title:'Engineer',company:'Example'},'submission_pending');await store.updateRecord(record.id,{status:'submitted',attemptedAt:'2026-10-01T15:00:01Z'});await originalSleep(ms,signal);};
  await runner.start();await runner.waitForIdle();
  assert.equal((await store.getHistory()).filter(r=>r.job.id==='1001'&&r.attemptedAt).length,1);
  assert.equal(runner.getStatus().runStats.attempted,0);
});
test('runner Stop during intelligent collection or inspection produces no application attempt',async t=>{
  for(const stage of ['collection','inspection']){
    const {runner,adapter,observed,jobs,store}=await setup(t,{count:2,config:matchingConfig});jobs.forEach(j=>j.title='Software Engineer Intern');
    const entered=deferred();
    const wait=signal=>new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
    if(stage==='collection')adapter.findJobs=async function*(_search,{signal}){yield jobs[0];entered.resolve();await wait(signal);throw new Error('Stopped');};
    else adapter.inspect=async(_job,{signal})=>{entered.resolve();await wait(signal);throw new Error('Stopped');};
    await runner.start();await entered.promise;await runner.stop();
    assert.equal(observed.applications.length,0);assert.equal((await store.getHistory()).filter(r=>r.attemptedAt).length,0);assert.equal(runner.getStatus().state,'idle');
  }
});
test('runner blocks a cross-ID fingerprint attempt inserted during intelligent pacing',async t=>{
  const {runner,store,clock,jobs}=await setup(t,{count:1,config:matchingConfig,descriptions:{1001:'Required: Python'},details:{1001:{location:'Houston, TX, USA'}}});jobs[0].title='Software Engineer Intern';
  const previous=await store.createRecord({id:'9999',title:'Another job',company:'Example'},'submission_pending');await store.updateRecord(previous.id,{status:'submitted',attemptedAt:'2026-10-01T15:00:00Z'});
  let selected;const originalSleep=clock.sleep;
  // Same-job metadata is supplied by the real ranked runner before apply.
  const originalCreate=store.createRecord; // retain all real store side effects
  const originalGet=store.getHistory;
  clock.sleep=async(ms,signal)=>{
    const {normalizeJob}=await import('../src/job-parser.mjs');const {jobFingerprint}=await import('../src/job-duplicates.mjs');
    selected=normalizeJob({...jobs[0],id:'1009'},{description:'Required: Python',easyApply:true,location:'Houston, TX, USA'},{now:clock.now()});selected.fingerprint=jobFingerprint(selected);
    const record=await originalCreate(selected,'submission_pending');await store.updateRecord(record.id,{status:'submitted'});await originalSleep(ms,signal);
  };
  await runner.start();await runner.waitForIdle();assert.equal(runner.getStatus().runStats.attempted,0);
  assert.equal((await originalGet()).filter(r=>r.job.id==='1001'&&r.attemptedAt).length,0);
});

test('runner enforces scan bounds and description filters even on an unbounded adapter',async t=>{
  const {runner,store}=await setup(t,{config:{scanLimit:2,search:{titles:['Engineer'],location:'Chicago',workplace:'any',includeKeywords:['Python'],excludeKeywords:[]}},descriptions:{1001:'Rust engineer'}});
  await runner.start();await runner.waitForIdle();
  const history=await store.getHistory();
  assert.deepEqual(history.map(r=>[r.job.id,r.status]),[['1001','skipped'],['1002','submitted']]);
});
test('runner isolates unreadable descriptions before filtering and continues safe jobs',async t=>{
  for(const description of ['', ' \n\t ', undefined, null]){
    for(const filters of [{includeKeywords:['Python'],excludeKeywords:[]},{includeKeywords:[],excludeKeywords:['Unpaid']}]){
      const {runner,store,observed}=await setup(t,{descriptions:{1001:description},config:{search:{titles:['Engineer'],location:'Chicago',keywordMatch:'any',...filters}}});
      await runner.start();await runner.waitForIdle();
      assert.equal(observed.applications.length,2);
      assert.equal(runner.getStatus().state,'idle');
      assert.match((await store.getHistory())[0].reason,/could not read.*job description/i);
      const history=await store.getHistory();
      assert.deepEqual(history.map(record=>record.status),['failed','submitted','submitted']);
      assert.equal(history[0].attemptedAt,null);
      assert.equal(runner.getStatus().runStats.checked,3);
      assert.equal(runner.getStatus().runStats.keywordSkipped,0);
    }
  }
});
test('runner does not require a description for a search with no keyword filters',async t=>{
  const {runner,store}=await setup(t,{count:1,descriptions:{1001:''}});
  await runner.start();await runner.waitForIdle();
  assert.equal((await store.getHistory())[0].status,'submitted');
});

test('runner retains actual answer-reuse provenance after successful application questions are cleared',async t=>{
  const {runner,store,adapter}=await setup(t,{count:1,config:{dryRun:true}});
  await store.saveQuestions([{jobId:'1001',key:'university name',label:'University name',type:'text'}]);
  adapter.apply=async()=>({status:'ready',reason:'Review reached',answerMatches:[{label:'University name',company:'Example',answer:'Example University',sourceQuestion:'school'}]});
  await runner.start();await runner.waitForIdle();
  assert.equal((await store.getQuestions()).length,0);
  assert.deepEqual((await store.getHistory())[0].answerMatches,[{label:'University name',company:'Example',answer:'Example University',sourceQuestion:'school'}]);
});
test('runner records an inspection error once and halts with no submission attempt',async t=>{
  const {runner,store,adapter,observed}=await setup(t);
  adapter.inspect=async()=>{throw new Error('Could not read the job description. Open LinkedIn to check this job.');};
  await runner.start();await runner.waitForIdle();
  assert.equal(runner.getStatus().state,'failed');
  assert.match(runner.getStatus().message,/could not read.*job description/i);
  assert.equal(observed.applications.length,0);
  const history=await store.getHistory();
  assert.deepEqual(history.map(record=>record.status),['failed']);
  assert.equal(history[0].attemptedAt,null);
  assert.match(history[0].reason,/could not read.*job description/i);
  assert.equal(runner.getStatus().runStats.checked,1);
  assert.equal(runner.getStatus().runStats.failed,1);
  assert.equal(runner.getStatus().runStats.attempted,0);
});
test('runner passes cancellation into inspection and Stop does not record an inspection failure',async t=>{
  const {runner,store,adapter,observed}=await setup(t);
  const entered=deferred(),release=deferred();let inspectionSignal;
  adapter.inspect=async(_job,{signal}={})=>{
    inspectionSignal=signal;entered.resolve();
    await Promise.race([release.promise,new Promise(resolve=>signal?.addEventListener('abort',resolve,{once:true}))]);
    if(signal?.aborted)throw new Error('Stopped while reading the job description');
    return {description:'Python role',easyApply:true,alreadyApplied:false};
  };
  await runner.start();await entered.promise;
  const stopping=runner.stop();release.resolve();await stopping;
  assert.equal(inspectionSignal?.aborted,true);
  assert.equal(runner.getStatus().state,'idle');
  assert.equal(runner.getStatus().runStats.failed,0);
  assert.equal(runner.getStatus().runStats.attempted,0);
  assert.equal(observed.applications.length,0);
  assert.equal((await store.getHistory())[0].status,'interrupted');assert.equal((await store.getHistory())[0].attemptedAt,null);
});
test('runner summarizes outcomes separately from durable submission attempts',async t=>{
  const {runner}=await setup(t,{count:5,descriptions:{1001:'Rust role'},outcomes:{1003:'needs_answer',1004:'unconfirmed',1005:'failed'},config:{search:{titles:['Engineer'],location:'Chicago',includeKeywords:['Python'],excludeKeywords:[]}}});
  await runner.start();await runner.waitForIdle();
  assert.deepEqual(runner.getStatus().runStats,{checked:5,attempted:2,submitted:1,unconfirmed:1,needsAnswers:1,ready:0,skipped:1,keywordSkipped:1,failed:1});
  assert.match(runner.getStatus().message,/5 checked.*1 submitted.*1 need answers.*1 skipped/i);
  assert.match(runner.getStatus().message,/1 unconfirmed/);
});
test('runner explains an all-skipped run and resets its summary on the next run',async t=>{
  const {runner,store}=await setup(t,{count:2,config:{search:{titles:['Engineer'],location:'Chicago',includeKeywords:['COBOL'],excludeKeywords:[]}}});
  await runner.start();await runner.waitForIdle();
  assert.equal(runner.getStatus().runStats.checked,2);
  assert.equal(runner.getStatus().runStats.keywordSkipped,2);
  assert.equal(runner.getStatus().runStats.attempted,0);
  assert.match(runner.getStatus().message,/review.*keyword filters/i);
  const config=await store.getConfig();config.search.includeKeywords=[];await store.saveConfig(config);
  await runner.start({dryRun:true});await runner.waitForIdle();
  assert.equal(runner.getStatus().runStats.checked,2);
  assert.equal(runner.getStatus().runStats.skipped,0);
  assert.equal(runner.getStatus().runStats.keywordSkipped,0);
  assert.equal(runner.getStatus().runStats.ready,2);
  assert.equal(runner.getStatus().runStats.attempted,0);
  assert.match(runner.getStatus().message,/2 ready.*dry run/i);
});
test('mixed skip summaries distinguish keyword rejection from jobs skipped after matching',async t=>{
  const {runner}=await setup(t,{count:2,descriptions:{1001:'Rust role'},outcomes:{1002:'skipped'},config:{search:{titles:['Engineer'],location:'Chicago',includeKeywords:['Python'],excludeKeywords:[]}}});
  await runner.start();await runner.waitForIdle();
  assert.equal(runner.getStatus().runStats.skipped,2);
  assert.equal(runner.getStatus().runStats.keywordSkipped,1);
  assert.match(runner.getStatus().message,/No applications were attempted/);
  assert.match(runner.getStatus().message,/1 job was rejected by keyword filters/);
  assert.doesNotMatch(runner.getStatus().message,/No jobs passed/);
});
test('runner counts an uncertain submission toward the cap and prevents retries',async t=>{
  const {runner,store}=await setup(t,{outcome:'unconfirmed',config:{dailyCap:1}});
  await runner.start();await runner.waitForIdle();
  assert.deepEqual((await store.getHistory()).filter(r=>r.attemptedAt).map(r=>r.status),['unconfirmed']);
  await runner.start();await runner.waitForIdle();
  assert.equal((await store.getHistory()).filter(r=>r.attemptedAt).length,1);
  assert.equal(runner.getStatus().todayCount,1);
});
test('runner excludes dry runs from cap accounting',async t=>{
  const {runner,store}=await setup(t,{config:{dailyCap:1}});
  await runner.start({dryRun:true});await runner.waitForIdle();
  assert.deepEqual((await store.getHistory()).map(r=>r.status),['ready','ready','ready']);
  assert.equal(runner.getStatus().todayCount,0);
});
test('runner skips a previously submitted job and recovers pending history',async t=>{
  const {runner,store,jobs}=await setup(t,{count:2});
  const old=await store.createRecord(jobs[0],'submission_pending');
  await store.updateRecord(old.id,{attemptedAt:'2026-10-01T14:00:00Z'});
  await runner.start();await runner.waitForIdle();
  const history=await store.getHistory();
  assert.equal(history[0].status,'unconfirmed');
  assert.equal(history.filter(r=>r.job.id==='1001' && r.status==='submitted').length,0);
  assert.equal(history.find(r=>r.job.id==='1002').status,'submitted');
});
test('runner refuses incomplete setup before opening the browser',async t=>{
  const {runner,store,observed}=await setup(t);
  await store.saveConfig({});
  await assert.rejects(runner.start(),/complete setup/i);
  assert.equal(observed.opens,0);
  assert.equal((await store.getHistory()).length,0);
});
test('runner rejects another active start and preserves stop during submission',async t=>{
  const reached=deferred(),release=deferred();
  const {runner,store}=await setup(t,{outcome:'unconfirmed',afterGuard:async()=>{reached.resolve();await release.promise;}});
  await runner.start();await reached.promise;
  const pendingStats=runner.getStatus().runStats;
  await assert.rejects(runner.start(),/already running/i);
  const stopping=runner.stop();release.resolve();await stopping;
  const history=await store.getHistory();
  assert.equal(history.length,1);
  assert.equal(history[0].status,'unconfirmed');
  assert.ok(history[0].attemptedAt);
  assert.equal(runner.getStatus().state,'idle');
  assert.equal(pendingStats.attempted,1);
  assert.equal(pendingStats.submitted,0);
  assert.equal(runner.getStatus().runStats.unconfirmed,1);
});
test('runner stop before submission creates no durable attempt',async t=>{
  const reached=deferred(),release=deferred();
  const {runner,store}=await setup(t,{beforeGuard:async()=>{reached.resolve();await release.promise;}});
  await runner.start();await reached.promise;
  const stopping=runner.stop();release.resolve();await stopping;
  assert.equal((await store.getHistory()).filter(r=>r.attemptedAt).length,0);
  assert.equal((await store.getHistory()).length,1);
  assert.equal(runner.getStatus().runStats.attempted,0);
});
test('runner preserves uncertainty when the adapter throws after the guard',async t=>{
  const {runner,store}=await setup(t,{throwAfterGuard:true,config:{dailyCap:1}});
  await runner.start();await runner.waitForIdle();
  const history=await store.getHistory();
  assert.equal(history.length,1);
  assert.equal(history[0].status,'unconfirmed');
  assert.ok(history[0].attemptedAt);
});
test('runner snapshots configuration, answers and resume for the entire run',async t=>{
  const {runner,observed}=await setup(t,{count:2,beforeGuard:async(job,options,store)=>{
    if(job.id==='1001'){
      const next=await store.getConfig();next.profile.email='next@example.com';next.resume={...next.resume,path:'/different.pdf'};
      await store.saveConfig(next);await store.saveAnswers({'years of experience':99});
    }
  }});
  await runner.start();await runner.waitForIdle();
  assert.equal(observed.applications.length,2);
  assert.equal(observed.applications[1].profile.email,'test@example.com');
  assert.equal(observed.applications[1].answers['years of experience'],0);
  assert.equal(observed.applications[1].resumePath,observed.applications[0].resumePath);
});
test('runner paces attempts against durable history across starts',async t=>{
  const {runner,store,jobs}=await setup(t,{count:2});
  const old=await store.createRecord({...jobs[0],id:'999'},'submitted');
  await store.updateRecord(old.id,{attemptedAt:'2026-10-01T14:59:30Z'});
  await runner.start();await runner.waitForIdle();
  const history=await store.getHistory();
  assert.equal(history[1].attemptedAt,'2026-10-01T15:00:15.000Z');
  assert.equal(history[2].attemptedAt,'2026-10-01T15:01:00.000Z');
});
test('runner pauses immediately on a LinkedIn application limit',async t=>{
  const {runner,store}=await setup(t,{outcome:'paused'});
  await runner.start();await runner.waitForIdle();
  assert.equal(runner.getStatus().state,'paused');
  assert.equal((await store.getHistory()).length,1);
  assert.equal((await store.getHistory())[0].attemptedAt,null);
});

const pendingQuestion={jobId:'1001',key:'relocate',label:'Relocate?',type:'radio',required:true,options:[{label:'Yes',value:'yes'},{label:'No',value:'no'}],blocker:'missing_answer'};
async function retryParent(store,job,status='failed',question=null){const r=await store.createRecord(job,status);if(question)await store.saveQuestions([...(await store.getQuestions()),{...question,jobId:job.id}]);return r;}
test('durable ranked discovery survives Stop and recovery without starting applications',async t=>{
 const {runner,store,adapter,jobs,observed}=await setup(t,{count:2,config:matchingConfig});const gate=deferred();adapter.findJobs=async function*(_,{signal}){yield jobs[0];gate.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));};
 await runner.start();await gate.promise;const queued=await store.getHistory();assert.equal(queued[0].status,'queued');assert.equal(queued[0].lifecycleVersion,1);await runner.stop();assert.equal((await store.getHistory())[0].status,'interrupted');assert.equal(observed.applications.length,0);await store.saveAnswers({Relocate:false});await store.recoverWork();assert.equal(observed.applications.length,0);
});
test('typed local inspection failure continues, global failure retains ranked work',async t=>{
 for(const code of ['navigation','verification_challenge']){
  const {runner,store,adapter,jobs,observed}=await setup(t,{count:2,config:matchingConfig,descriptions:{1002:'Required: Python'}});jobs.forEach(j=>j.title='Software Engineer Intern');const original=adapter.inspect;adapter.inspect=async j=>{if(j.id==='1001')throw new ApplicationFailure(code);return original(j);};await runner.start();await runner.waitForIdle();
  assert.equal(observed.applications.length,code==='navigation'?1:0);const history=await store.getHistory();assert.equal(history.length,2);assert.equal(history[0].blockers[0].code,code);if(code!=='navigation'){assert.equal(runner.getStatus().state,'paused');assert.equal(history[1].status,'interrupted');}
 }
});
test('local entry failure continues only after confirmed cleanup and preserves both blockers',async t=>{
 for(const safe of [true,false]){const {runner,store,adapter,observed}=await setup(t,{count:2});const original=adapter.apply;adapter.apply=async(j,o)=>j.id==='1001'?{status:safe?'failed':'paused',reason:'Entry verification failed',blockers:[makeBlocker('entry_verification'),...(!safe?[makeBlocker('cleanup_failed')]:[])],cleanup:{confirmed:safe}}:original(j,o);await runner.start();await runner.waitForIdle();assert.equal(observed.applications.length,safe?1:0);assert.equal((await store.getHistory())[0].blockers[0].code,'entry_verification');assert.equal(runner.getStatus().state,safe?'idle':'paused');if(!safe)assert.match(runner.getStatus().message,/close/i);}
});
test('targeted retry uses current answers, original job and linked history without searching',async t=>{
 const {runner,store,jobs,observed}=await setup(t,{count:1});const parent=await retryParent(store,jobs[0],'needs_answer',pendingQuestion);await store.saveAnswers({Relocate:false});await runner.retry({recordIds:[parent.id],dryRun:true});await runner.waitForIdle();assert.equal(observed.discoveryCalls,0);assert.equal(observed.applications[0].answers.relocate,false);assert.equal(observed.applications[0].job.id,parent.job.id);const child=(await store.getHistory()).find(r=>r.retryOf===parent.id);assert.equal(child.lineageId,parent.id);assert.equal(child.status,'ready');assert.deepEqual(await store.getQuestions(),[]);
});
test('targeted retry reinspects current filtering and a batch retains one answer snapshot',async t=>{
 const {runner,store,jobs,observed}=await setup(t,{count:2,beforeGuard:async(j,_o,s)=>{if(j.id==='1001')await s.saveAnswers({Relocate:true});}});await store.saveAnswers({Relocate:false});const parents=[];for(const j of jobs)parents.push(await retryParent(store,j,'needs_answer',pendingQuestion));await runner.retry({recordIds:parents.map(r=>r.id)});await runner.waitForIdle();assert.equal(observed.discoveryCalls,0);assert.equal(observed.applications[1].answers.relocate,false);
 const other=await retryParent(store,{...jobs[0],id:'9999'},'needs_answer',{...pendingQuestion,jobId:'9999'});const config=await store.getConfig();config.search.includeKeywords=['COBOL'];await store.saveConfig(config);await runner.retry({recordIds:[other.id],dryRun:true});await runner.waitForIdle();assert.equal((await store.getHistory()).at(-1).status,'skipped');assert.ok((await store.getQuestions()).some(q=>q.jobId==='9999'));
});
test('retry rejects missing/manual/attempted and unsafe batch work before creating children',async t=>{
 for(const type of ['unresolved','manual','attempted','batch']){const {runner,store,jobs}=await setup(t,{count:2});const status=type==='attempted'?'submission_pending':'needs_answer';const parent=await retryParent(store,jobs[0],status,type==='batch'?null:{...pendingQuestion,...(type==='manual'?{type:'unsupported',blocker:'operational'}:{})});if(type!=='unresolved')await store.saveAnswers({Relocate:false});const ids=[parent.id];if(type==='batch'){const second=await retryParent(store,jobs[1],'failed');ids.push(second.id);}await assert.rejects(runner.retry({recordIds:ids}),/eligible|ready|attempt|answer|retry/i);assert.equal((await store.getHistory()).some(r=>r.retryOf),false);}
});
test('retry command validation and concurrent launch never create two children',async t=>{
 const {runner,store,jobs}=await setup(t,{count:1});const parent=await retryParent(store,jobs[0]);for(const recordIds of [[],[parent.id,parent.id],Array(101).fill(parent.id),['unknown']])await assert.rejects(runner.retry({recordIds}));await assert.rejects(runner.retry({recordIds:[parent.id],dryRun:'yes'}));const results=await Promise.allSettled([runner.retry({recordIds:[parent.id],dryRun:true}),runner.start({dryRun:true})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);await runner.waitForIdle();assert.equal((await store.getHistory()).filter(r=>r.retryOf===parent.id).length,1);
});
for(const stage of ['inspection','application'])test(`bounded transient ${stage} retries persist counters before each retry`,async t=>{
 const {runner,store,adapter,waits}=await setup(t,{count:1});let calls=0;const original=stage==='inspection'?adapter.inspect:adapter.apply;const counters=[];
 if(stage==='inspection')adapter.inspect=async(...args)=>{counters.push((await store.getHistory())[0].retryCounters.inspectionNavigation);if(++calls<3)throw new ApplicationFailure('network');return original(...args);};
 else adapter.apply=async(...args)=>{counters.push((await store.getHistory())[0].retryCounters.applicationNavigation);if(++calls<3)return {status:'failed',blockers:[makeBlocker('network')],cleanup:{confirmed:true}};return original(...args);};
 await runner.start();await runner.waitForIdle();assert.deepEqual(waits,[1000,3000]);assert.deepEqual(counters,[0,1,2]);assert.equal((await store.getHistory())[0].status,'submitted');
});
test('Stop during network retry wait prevents the next call and preserves work',async t=>{
 const {runner,store,adapter,clock}=await setup(t,{count:1});let calls=0;const gate=deferred();adapter.inspect=async()=>{calls++;throw new ApplicationFailure('network');};clock.sleep=async(_ms,signal)=>{gate.resolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));throw new Error('Stopped');};await runner.start();await Promise.race([gate.promise,runner.waitForIdle().then(()=>{throw new Error('Run ended before retry wait');})]);await runner.stop();assert.equal(calls,1);assert.equal((await store.getHistory())[0].status,'interrupted');assert.equal((await store.getHistory())[0].attemptedAt,null);
});
test('fresh final validator runs after pacing and before an atomic reservation',async t=>{
 const {runner,store,clock,observed}=await setup(t,{count:1,validateReady:async()=>{throw new ApplicationFailure('form_changed');}});const old=await store.createRecord({id:'9999',title:'Other',company:'Example'},'submitted');await store.updateRecord(old.id,{attemptedAt:'2026-10-01T14:59:59Z'});await runner.start();await runner.waitForIdle();assert.equal(observed.validations,1);assert.equal((await store.getHistory()).filter(r=>r.job.id==='1001'&&r.attemptedAt).length,0);assert.equal((await store.getHistory()).find(r=>r.job.id==='1001').blockers[0].code,'form_changed');assert.ok(clock.now().getTime()>Date.parse('2026-10-01T15:00:00Z'));
});
test('a transient-looking outcome after reservation is uncertain and never retried',async t=>{
 const {runner,store,adapter,waits}=await setup(t,{count:1});let calls=0;adapter.apply=async(_j,o)=>{calls++;await o.beforeSubmit({validateReady:async()=>{}});return {status:'failed',blockers:[makeBlocker('network')],cleanup:{confirmed:true}};};await runner.start();await runner.waitForIdle();assert.equal(calls,1);assert.deepEqual(waits,[]);assert.equal((await store.getHistory())[0].status,'unconfirmed');await assert.rejects(runner.retry({recordIds:[(await store.getHistory())[0].id]}));
});
test('a real canonical write failure after reservation preserves uncertainty on restart',async t=>{
 const {runner,store,dir,observed,jobs}=await setup(t,{count:2,config:matchingConfig,afterGuard:async()=>{await rename(join(dir,'history.json'),join(dir,'history.saved'));await mkdir(join(dir,'history.json'));}});jobs.forEach(j=>j.title='Software Engineer Intern');await runner.start();await runner.waitForIdle();assert.equal(observed.applications.length,1);assert.equal(runner.getStatus().state,'paused');await rm(join(dir,'history.json'),{recursive:true});await rename(join(dir,'history.saved'),join(dir,'history.json'));await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());await reopened.recoverWork();assert.equal((await reopened.getHistory()).filter(r=>r.attemptedAt).length,1);assert.equal((await reopened.getHistory()).find(r=>r.attemptedAt).status,'unconfirmed');
});
test('projection failure preserves canonical questions for startup repair',async t=>{
 const {runner,store,adapter,dir}=await setup(t,{count:1});await mkdir(join(dir,'questions.json'));adapter.apply=async()=>({status:'needs_answer',blockers:[makeBlocker('missing_answer')],pendingQuestions:[pendingQuestion],cleanup:{confirmed:true}});await runner.start();await runner.waitForIdle();assert.equal(runner.getStatus().state,'paused');assert.equal((await store.getHistory())[0].pendingQuestions.length,1);await rm(join(dir,'questions.json'),{recursive:true});await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());await reopened.recoverWork();assert.equal((await reopened.getQuestions())[0].label,'Relocate?');
});
test('optional diagnostic failure does not replace a local blocker or stop safe work',async t=>{
 const {runner,store,adapter,dir,observed}=await setup(t,{count:2});await writeFile(join(dir,'failures'),'blocked');const original=adapter.apply;adapter.apply=async(j,o)=>j.id==='1001'?{status:'failed',reason:'Local error',blockers:[makeBlocker('validation')],diagnostic:{phase:'form',code:'validation'},cleanup:{confirmed:true}}:original(j,o);await runner.start();await runner.waitForIdle();assert.equal(observed.applications.length,1);const r=(await store.getHistory())[0];assert.equal(r.blockers[0].code,'validation');assert.equal(r.diagnostic.available,false);
});

test('a daily cap filled during pacing prevents reservation and validation',async t=>{
 const {runner,store,clock,observed}=await setup(t,{count:1,config:{dailyCap:2}});const old=await store.createRecord({id:'9999',title:'Other',company:'Example'},'submitted');await store.updateRecord(old.id,{attemptedAt:'2026-10-01T15:00:00Z'});const original=clock.sleep;clock.sleep=async(ms,signal)=>{const inserted=await store.createRecord({id:'8888',title:'Other',company:'Example'},'submission_pending');await store.updateRecord(inserted.id,{attemptedAt:'2026-10-01T15:00:01Z'});await original(ms,signal);};await runner.start();await runner.waitForIdle();assert.equal((await store.getHistory()).filter(r=>r.job.id==='1001'&&r.attemptedAt).length,0);assert.equal(observed.validations,0);assert.equal(runner.getStatus().state,'failed');
});
test('a real write failure before filling prevents browser entry and preserves interrupted work',async t=>{
 const {runner,store,adapter,dir,observed}=await setup(t,{count:1});const original=adapter.inspect;adapter.inspect=async(...args)=>{const details=await original(...args);await rename(join(dir,'history.json'),join(dir,'history.saved'));await mkdir(join(dir,'history.json'));return details;};await runner.start();await runner.waitForIdle();assert.equal(observed.applications.length,0);assert.equal(runner.getStatus().state,'paused');await rm(join(dir,'history.json'),{recursive:true});await rename(join(dir,'history.saved'),join(dir,'history.json'));await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());await reopened.recoverWork();assert.equal((await reopened.getHistory())[0].status,'interrupted');assert.equal((await reopened.getHistory())[0].attemptedAt,null);
});
