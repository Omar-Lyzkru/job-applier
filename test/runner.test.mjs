import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {defaultConfig} from '../src/domain.mjs';
import {createRunner} from '../src/runner.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
async function setup(t,{count=3,outcome='submitted',config={},beforeGuard,afterGuard,throwAfterGuard=false,descriptions={}}={}){
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
    inspect:async job=>({description:descriptions[job.id]||'Remote Python engineer',easyApply:true,alreadyApplied:false}),
    async apply(job,options){
      observed.applications.push({job:structuredClone(job),profile:structuredClone(options.profile),answers:structuredClone(options.answers),resumePath:options.resumePath});
      if(outcome==='paused')return {status:'paused',reason:'LinkedIn daily application limit'};
      if(beforeGuard)await beforeGuard(job,options,store);
      if(options.dryRun)return {status:'ready',reason:'Dry run'};
      await options.beforeSubmit();
      if(afterGuard)await afterGuard(job,options,store);
      if(throwAfterGuard)throw new Error('Browser disconnected after submit');
      return {status:outcome,reason:outcome==='submitted'?'Application confirmed':'No confirmation'};
    }
  };
  const runner=createRunner({store,adapter,clock});
  t.after(()=>runner.stop());
  return {dir,store,runner,observed,jobs,adapter};
}

test('runner enforces scan bounds and description filters even on an unbounded adapter',async t=>{
  const {runner,store}=await setup(t,{config:{scanLimit:2,search:{titles:['Engineer'],location:'Chicago',workplace:'any',includeKeywords:['Python'],excludeKeywords:[]}},descriptions:{1001:'Rust engineer'}});
  await runner.start();await runner.waitForIdle();
  const history=await store.getHistory();
  assert.deepEqual(history.map(r=>[r.job.id,r.status]),[['1001','skipped'],['1002','submitted']]);
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
  await assert.rejects(runner.start(),/already running/i);
  const stopping=runner.stop();release.resolve();await stopping;
  const history=await store.getHistory();
  assert.equal(history.length,1);
  assert.equal(history[0].status,'unconfirmed');
  assert.ok(history[0].attemptedAt);
  assert.equal(runner.getStatus().state,'idle');
});
test('runner stop before submission creates no durable attempt',async t=>{
  const reached=deferred(),release=deferred();
  const {runner,store}=await setup(t,{beforeGuard:async()=>{reached.resolve();await release.promise;}});
  await runner.start();await reached.promise;
  const stopping=runner.stop();release.resolve();await stopping;
  assert.equal((await store.getHistory()).filter(r=>r.attemptedAt).length,0);
  assert.equal((await store.getHistory()).length,1);
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
