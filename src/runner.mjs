import {stat} from 'node:fs/promises';
import {readiness,matchesJob,dayKey,countsTowardCap,blocksRetry,MAX_RESUME_BYTES} from './domain.mjs';

function stopped(signal){if(signal.aborted)throw new Error('Stopped before submission');}
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
export function createRunner({store,adapter,clock=realClock}) {
  let active=null,starting=false,controller=null;
  const status={state:'idle',currentJob:null,message:'Complete your setup, then open LinkedIn to sign in.',startedAt:null,finishedAt:null,todayCount:0};
  const recount=(history,config)=>{
    status.todayCount=history.filter(record=>countsTowardCap(record,dayKey(clock.now(),config.timezone),config.timezone)).length;
    return status.todayCount;
  };
  async function recordOutcome(job,result,pending){
    let state=result.status;
    if(state==='paused')state=pending?(result.evidence?'submitted':'unconfirmed'):(result.pendingQuestions?.length?'needs_answer':'failed');
    if(pending && !['submitted','unconfirmed'].includes(state))state='unconfirmed';
    if(!['skipped','needs_answer','ready','submitted','unconfirmed','failed'].includes(state))state=pending?'unconfirmed':'failed';
    const record=pending||await store.createRecord(job,state);
    await store.updateRecord(record.id,{status:state,reason:result.reason||state,evidence:result.evidence||null,finishedAt:clock.now().toISOString()});
    if(result.pendingQuestions?.length){
      const existing=await store.getQuestions();
      const merged=new Map(existing.map(question=>[`${question.jobId}:${question.key}`,question]));
      for(const question of result.pendingQuestions)merged.set(`${job.id}:${question.key}`,{...question,jobId:job.id});
      await store.saveQuestions([...merged.values()]);
    }else if(['submitted','ready'].includes(state)){
      await store.saveQuestions((await store.getQuestions()).filter(question=>question.jobId!==job.id));
    }
  }
  async function run(config,answers,signal){
    let scanned=0;
    try{
      stopped(signal);
      if(!await adapter.isSignedIn()){
        status.state='paused';status.message='Open LinkedIn and sign in, then start again.';return;
      }
      for await(const job of adapter.findJobs(config.search,{scanLimit:config.scanLimit,signal})){
        if(signal.aborted)break;
        if(scanned>=config.scanLimit)break;
        const history=await store.getHistory();
        if(!config.dryRun && recount(history,config)>=config.dailyCap){status.state='paused';status.message='Daily application cap reached.';break;}
        scanned++;status.currentJob=structuredClone(job);status.message=`Checking ${job.title} at ${job.company}`;
        if(history.some(record=>record.job.id===job.id && blocksRetry(record))){
          await recordOutcome(job,{status:'skipped',reason:'Already submitted or uncertain in local history'},null);continue;
        }
        const details=await adapter.inspect(job);
        if(signal.aborted)break;
        status.currentJob=structuredClone(job);
        if(details.alreadyApplied||!details.easyApply||!matchesJob(details.description,config.search)){
          const reason=details.alreadyApplied?'LinkedIn shows this job as already applied':!details.easyApply?'No LinkedIn Easy Apply':'Description does not match your keyword filters';
          await recordOutcome(job,{status:'skipped',reason},null);continue;
        }
        let pending=null,result;
        const beforeSubmit=async()=>{
          stopped(signal);
          if(pending)throw new Error('Submission was already reserved');
          let current=await store.getHistory();
          if(recount(current,config)>=config.dailyCap)throw new Error('Daily application cap reached');
          const times=current.map(record=>Date.parse(record.attemptedAt)).filter(Number.isFinite);
          if(times.length){
            const wait=Math.max(...times)+config.intervalSeconds*1000-clock.now().getTime();
            if(wait>0){status.message=`Waiting ${Math.ceil(wait/1000)} seconds before submission`;await clock.sleep(wait,signal);}
          }
          stopped(signal);
          current=await store.getHistory();
          if(recount(current,config)>=config.dailyCap)throw new Error('Daily application cap reached');
          pending=await store.createRecord(job,'submission_pending');
          pending=await store.updateRecord(pending.id,{attemptedAt:clock.now().toISOString(),reason:'Waiting for LinkedIn submission confirmation'});
          recount(await store.getHistory(),config);
          status.message=`Submitting ${job.title} at ${job.company}`;
        };
        try{
          result=await adapter.apply(job,{profile:config.profile,answers,resumePath:config.resume.path,dryRun:config.dryRun,signal,beforeSubmit});
        }catch(error){result={status:pending?'unconfirmed':'failed',reason:error.message.split('\n')[0]};}
        await recordOutcome(job,result,pending);
        recount(await store.getHistory(),config);
        if(result.status==='paused'){status.state='paused';status.message=result.reason;break;}
        if(signal.aborted)break;
      }
      if(status.state==='running'){status.state='idle';status.message=`Run finished. ${scanned} jobs inspected.`;}
    }catch(error){
      if(!signal.aborted){
        status.state=/sign in|verification|application.*limit|speed.*limit/i.test(error.message)?'paused':'failed';
        status.message=error.message.split('\n')[0];
      }
    }finally{
      try{await adapter.close();}catch(error){status.message+=` Browser close error: ${error.message.split('\n')[0]}`;}
      if(signal.aborted){status.state='idle';status.message='Stopped. Any submission already in flight was recorded.';}
      status.currentJob=null;status.finishedAt=clock.now().toISOString();
    }
  }
  return {
    getStatus:()=>structuredClone(status),
    async start({dryRun}={}){
      if(active||starting)throw new Error('The app is already running');
      starting=true;controller=new AbortController();
      try{
        await store.recoverPending();
        const config=await store.getConfig(),answers=await store.getAnswers();
        if(dryRun!==undefined){if(typeof dryRun!=='boolean')throw new Error('Dry run must be true or false');config.dryRun=dryRun;}
        const missing=readiness(config);
        if(missing.length)throw new Error(`Complete setup: ${missing.join('; ')}`);
        const resume=await stat(config.resume.path).catch(()=>null);
        if(!resume?.isFile() || resume.size===0 || resume.size>MAX_RESUME_BYTES)throw new Error('The selected résumé is missing, empty, or over 2 MB. Upload it again.');
        stopped(controller.signal);
        recount(await store.getHistory(),config);
        status.state='running';status.currentJob=null;status.startedAt=clock.now().toISOString();status.finishedAt=null;status.message=config.dryRun?'Starting dry run':'Starting automatic applications';
        const signal=controller.signal;
        active=run(config,answers,signal).finally(()=>{active=null;});
        return structuredClone(status);
      }finally{starting=false;}
    },
    async stop(){
      if(controller)controller.abort();
      if(active){status.state='stopping';status.message='Stopping. Waiting for any submission already in flight.';await active;}
      await adapter.close();status.state='idle';status.currentJob=null;
      if(!status.message.startsWith('Stopped.'))status.message='Stopped.';
      return structuredClone(status);
    },
    async openBrowser(){
      if(active||starting)throw new Error('Stop the active run before opening a sign-in browser');
      await adapter.openBrowser();status.message='LinkedIn browser opened. Sign in there, then start applying.';
      return structuredClone(status);
    },
    async waitForIdle(){if(active)await active;}
  };
}
