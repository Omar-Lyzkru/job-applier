import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {defaultConfig} from '../src/domain.mjs';
import {createRunner} from '../src/runner.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function setup(t,{count=3,outcome='submitted',outcomes={},config={},beforeGuard,afterGuard,throwAfterGuard=false,descriptions={}}={}){
  const dir=await mkdtemp(join(tmpdir(),'job-applier-runner-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const resumePath=join(dir,'resume.pdf');await writeFile(resumePath,'%PDF-1.4');
  const store=await createStore(dir);
  await store.saveConfig({...defaultConfig(),profile:{firstName:'Test',lastName:'Applicant',email:'test@example.com',phone:'555'},search:{titles:['Engineer'],location:'Chicago',workplace:'any',includeKeywords:[],excludeKeywords:[]},resume:{path:resumePath,filename:'resume.pdf',size:8},...config});
  await store.saveAnswers({'years of experience':0});
  let time=Date.parse('2026-10-01T15:00:00Z');
  const clock={now:()=>new Date(time),sleep:async(ms,signal)=>{if(signal?.aborted)throw new Error('Stopped');time+=ms;}};
  const jobs=Array.from({length:count},(_,i)=>({id:String(1001+i),url:`https://www.linkedin.com/jobs/view/${1001+i}/`,title:'Engineer',company:'Example'}));
  const observed={applications:[],opens:0};
  const adapter={
    openBrowser:async()=>{observed.opens++;},isSignedIn:async()=>true,close:async()=>{},
    async *findJobs(){yield*jobs;},
    inspect:async job=>({description:Object.hasOwn(descriptions,job.id)?descriptions[job.id]:'Remote Python engineer',easyApply:true,alreadyApplied:false}),
    async apply(job,options){
      observed.applications.push({job:structuredClone(job),profile:structuredClone(options.profile),answers:structuredClone(options.answers),resumePath:options.resumePath});
      const result=outcomes[job.id]||outcome;
      if(result==='paused')return {status:'paused',reason:'LinkedIn daily application limit'};
      if(['needs_answer','failed','skipped'].includes(result))return {status:result,reason:'Blocked before submission'};
      if(beforeGuard)await beforeGuard(job,options,store);
      if(options.dryRun)return {status:'ready',reason:'Dry run'};
      await options.beforeSubmit();
      if(afterGuard)await afterGuard(job,options,store);
      if(throwAfterGuard)throw new Error('Browser disconnected after submit');
      return {status:result,reason:result==='submitted'?'Application confirmed':'No confirmation'};
    }
  };
  const runner=createRunner({store,adapter,clock});
  t.after(async()=>{await runner.stop();await store.close();});
  return {dir,store,runner,observed,jobs,adapter};
}

test('runner enforces scan bounds and description filters even on an unbounded adapter',async t=>{
  const {runner,store}=await setup(t,{config:{scanLimit:2,search:{titles:['Engineer'],location:'Chicago',workplace:'any',includeKeywords:['Python'],excludeKeywords:[]}},descriptions:{1001:'Rust engineer'}});
  await runner.start();await runner.waitForIdle();
  const history=await store.getHistory();
  assert.deepEqual(history.map(r=>[r.job.id,r.status]),[['1001','skipped'],['1002','submitted']]);
});
test('runner stops unreadable descriptions before include or exclude filtering can skip or apply',async t=>{
  for(const description of ['', ' \n\t ', undefined, null]){
    for(const filters of [{includeKeywords:['Python'],excludeKeywords:[]},{includeKeywords:[],excludeKeywords:['Unpaid']}]){
      const {runner,store,observed}=await setup(t,{descriptions:{1001:description},config:{search:{titles:['Engineer'],location:'Chicago',keywordMatch:'any',...filters}}});
      await runner.start();await runner.waitForIdle();
      assert.equal(observed.applications.length,0);
      assert.equal(runner.getStatus().state,'failed');
      assert.match(runner.getStatus().message,/could not read.*job description/i);
      const history=await store.getHistory();
      assert.deepEqual(history.map(record=>record.status),['failed']);
      assert.equal(history[0].attemptedAt,null);
      assert.equal(runner.getStatus().runStats.checked,1);
      assert.equal(runner.getStatus().runStats.keywordSkipped,0);
    }
  }
});
test('runner does not require a description for a search with no keyword filters',async t=>{
  const {runner,store}=await setup(t,{count:1,descriptions:{1001:''}});
  await runner.start();await runner.waitForIdle();
  assert.equal((await store.getHistory())[0].status,'submitted');
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
  assert.deepEqual(await store.getHistory(),[]);
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
  assert.deepEqual((await store.getHistory()).map(r=>r.status),['unconfirmed']);
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
