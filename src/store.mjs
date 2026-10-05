import {mkdir,readFile,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultConfig,validateConfig,validateAnswers,statuses,countsTowardCap,dayKey,blocksRetry} from './domain.mjs';
import {canTransition,workPhases,makeBlocker} from './application-lifecycle.mjs';
import {projectQuestions,projectAttention} from './attention-queue.mjs';
import {blockingDuplicate} from './job-duplicates.mjs';
import {acquireDataOwnership} from './data-ownership.mjs';

const clone = value => structuredClone(value);
const inflight=new Set(['queued','inspecting','filling']);
const finished=new Set(['submitted','unconfirmed','skipped','needs_answer','needs_attention','failed','ready','interrupted']);
function validateWork(record){
 if(record.lifecycleVersion!==1)return;
 if(!record.lineageId||!Number.isInteger(record.revision)||record.revision<0||!workPhases.has(record.phase)||!Array.isArray(record.pendingQuestions)||!Array.isArray(record.blockers)||!record.retryCounters||!Number.isFinite(Date.parse(record.updatedAt)))throw new Error('Invalid lifecycle record');
 if(record.attemptedAt&&!Number.isFinite(Date.parse(record.attemptedAt)))throw new Error('Invalid attempted time');
 if(['submission_pending','submitted','unconfirmed'].includes(record.status)&&!record.attemptedAt)throw new Error('Missing attempted time');
}
const revision=(record,expected)=>{if(!Number.isInteger(expected)||expected!==(record.revision||0))throw new Error('Stale application revision');};
const initialCounters=()=>({inspectionNavigation:0,applicationNavigation:0,fields:{},pages:{}});
export async function createStore(dataDir) {
  await mkdir(dataDir,{recursive:true,mode:0o700});
  const ownership=await acquireDataOwnership(dataDir);
  async function load(name,fallback,validate) {
    try { return validate(JSON.parse(await readFile(join(dataDir,`${name}.json`),'utf8'))); }
    catch (error) {
      if (error.code==='ENOENT') return clone(fallback);
      throw new Error(`${name}.json is corrupt or invalid: ${error.message}`);
    }
  }
  const array = value => { if (!Array.isArray(value)) throw new Error('Expected a list'); return value; };
  let state;
  try { state = {
    // Older builds accepted arbitrary profile links. Keep them editable on load;
    // every settings save uses the current URL validation and normalization.
    config:await load('config',defaultConfig(),value=>validateConfig(value,{profileLinks:false})),
    answers:await load('answers',{},validateAnswers),
    questions:await load('questions',[],array),
    history:await load('history',[],value=> {
      array(value);
      if (value.some(record=>!record.id || !record.job?.id || !statuses.has(record.status))) throw new Error('Invalid application record');
      value.forEach(validateWork);
      return value;
    })
  }; } catch(error) {await ownership.close();throw error;}
  let queue = Promise.resolve();
  let closing=null;
  const ensureOpen=()=>{if(closing)throw new Error('The data store is closed');};
  async function persist(name,value) {
    const path = join(dataDir,`${name}.json`), temp=`${path}.${randomUUID()}.tmp`;
    let file;
    try {
      file=await open(temp,'wx',0o600);
      await file.writeFile(JSON.stringify(value,null,2)+'\n');
      await file.sync(); await file.close(); file=null;
      await rename(temp,path);
      const directory=await open(dataDir,'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (file) await file.close();
      await unlink(temp).catch(()=>{});
    }
  }
  function mutate(name,update) {
    ensureOpen();
    const action=queue.then(async()=> {
      const next=update(clone(state[name]));
      await persist(name,next);
      state[name]=next;
      return clone(next);
    });
    queue=action.catch(()=>{});
    return action;
  }
  const store = {
    getConfig:async()=>{ensureOpen();return clone(state.config);},
    saveConfig:async input=>mutate('config',()=>validateConfig(input)),
    saveResume:async resume=>mutate('config',config=>validateConfig({...config,resume},{profileLinks:false})),
    getAnswers:async()=>{ensureOpen();return clone(state.answers);},
    saveAnswers:async input=>mutate('answers',()=>validateAnswers(input)),
    getQuestions:async()=>{ensureOpen();return clone(state.questions);},
    saveQuestions:async input=>mutate('questions',()=>array(clone(input))),
    getHistory:async()=>{ensureOpen();return clone(state.history);},
    close(){closing ||= queue.then(()=>ownership.close());return closing;},
    async createRecord(job,status) {
      if (!job?.id || !statuses.has(status)) throw new Error('Invalid job or status');
      const record={id:randomUUID(),job:clone(job),status,reason:'',startedAt:new Date().toISOString(),attemptedAt:null,finishedAt:null};
      if (status==='submission_pending') record.attemptedAt=record.startedAt;
      await mutate('history',history=>[...history,record]);
      return clone(record);
    },
    async updateRecord(id,patch) {
      if (patch.status && !statuses.has(patch.status)) throw new Error('Invalid status');
      let record;
      await mutate('history',history=> {
        const index=history.findIndex(item=>item.id===id);
        if (index<0) throw new Error('Application record not found');
        if(history[index].lifecycleVersion===1)throw new Error('Use lifecycle transition for this record');
        if(history[index].attemptedAt&&Object.hasOwn(patch,'attemptedAt')&&!patch.attemptedAt)throw new Error('Attempted time is immutable');
        if(blocksRetry(history[index])&&patch.status&&!canTransition(history[index],patch.status))throw new Error('Invalid protected transition');
        record={...history[index],...clone(patch),id,job:history[index].job};
        history[index]=record;
        return history;
      });
      return clone(record);
    },
    async createWork(job,{parentId=null,expectedParentRevision=null,now=new Date()}={}){
      if(!job?.id)throw new Error('Invalid job identity');let record;
      await mutate('history',history=>{
        let parent=null;
        if(parentId){
          parent=history.find(r=>r.id===parentId);if(!parent)throw new Error('Retry parent not found');revision(parent,expectedParentRevision);
          if(String(parent.job.id)!==String(job.id))throw new Error('Retry job identity changed');
          if(history.filter(r=>String(r.job.id)===String(job.id)).at(-1)?.id!==parentId||history.some(r=>r.retryOf===parentId&&inflight.has(r.status)))throw new Error('Retry is no longer latest or already active');
          const attention=projectAttention(history,state.questions,{profile:state.config.profile,answers:state.answers}).find(item=>item.recordId===parentId);
          if(!attention?.singleRetry)throw new Error('Retry is not eligible');
        }
        const id=randomUUID(),at=now.toISOString();
        record={id,job:clone(job),lifecycleVersion:1,lineageId:parent?.lineageId||parent?.id||id,retryOf:parentId,revision:0,status:'queued',phase:'discovery',reason:'',startedAt:at,updatedAt:at,attemptedAt:null,finishedAt:null,pendingQuestions:[],blockers:[],retryCounters:initialCounters()};
        if(parent){parent.retryId=id;parent.revision=(parent.revision||0)+1;parent.updatedAt=at;}
        history.push(record);return history;
      });return clone(record);
    },
    async transitionWork(id,patch){
      const allowed=new Set(['expectedRevision','status','phase','job','pendingQuestions','blockers','retryCounters','diagnostic','evidence','answerMatches','now','reason']);
      if(Object.keys(patch).some(key=>!allowed.has(key)))throw new Error('Immutable or unknown transition field');let record;
      await mutate('history',history=>{
        const index=history.findIndex(r=>r.id===id);if(index<0)throw new Error('Application record not found');const old=history[index];
        if(old.lifecycleVersion!==1)throw new Error('Lifecycle record required');revision(old,patch.expectedRevision);
        const status=patch.status||old.status;if(!statuses.has(status)||!canTransition(old,status))throw new Error('Invalid lifecycle transition');
        // Submission can only enter the protected state through atomic reservation.
        if(status==='submission_pending'&&old.status!=='submission_pending')throw new Error('Submission requires reservation');
        if(patch.job&&String(patch.job.id)!==String(old.job.id))throw new Error('Job identity is immutable');
        const at=(patch.now||new Date()).toISOString();const {expectedRevision,now,...fields}=clone(patch);
        record={...old,...fields,status,revision:old.revision+1,updatedAt:at,finishedAt:finished.has(status)?at:null};
        if(patch.blockers)record.blockers=patch.blockers.map(b=>makeBlocker(b.code,b));validateWork(record);history[index]=record;return history;
      });return clone(record);
    },
    async reserveSubmission(id,{expectedRevision,now=new Date(),timezone,dailyCap}){
      let record;
      await mutate('history',history=>{
        const index=history.findIndex(r=>r.id===id);if(index<0)throw new Error('Application record not found');const old=history[index];revision(old,expectedRevision);
        if(old.lifecycleVersion!==1||old.status!=='filling'||old.attemptedAt)throw new Error('Submission cannot be reserved in this state');
        if(blockingDuplicate(old.job,history.filter(r=>r.id!==id)))throw new Error('A protected attempt already exists');
        if(!Number.isInteger(dailyCap)||dailyCap<1||history.filter(r=>countsTowardCap(r,dayKey(now,timezone),timezone)).length>=dailyCap)throw new Error('Daily application cap reached');
        const at=now.toISOString();record={...old,status:'submission_pending',phase:'submission',revision:old.revision+1,attemptedAt:at,updatedAt:at,finishedAt:null};
        history[index]=record;return history;
      });return clone(record);
    },
    async reconcileQuestions(){
      // Queue the comparison with prior writes, but avoid touching a no-change file.
      ensureOpen();let result;
      const action=queue.then(async()=>{result=projectQuestions(state.history,state.questions);if(JSON.stringify(result)!==JSON.stringify(state.questions)){await persist('questions',result);state.questions=result;}return clone(result);});
      queue=action.catch(()=>{});return action;
    },
    async recoverWork(){
      ensureOpen();const action=queue.then(async()=>{
        if(!state.history.some(r=>r.status==='submission_pending'||r.lifecycleVersion===1&&inflight.has(r.status)))return;
        const at=new Date().toISOString(),next=state.history.map(record=>{
          const pending=record.status==='submission_pending',active=record.lifecycleVersion===1&&inflight.has(record.status);if(!pending&&!active)return clone(record);
          return {...record,status:pending?'unconfirmed':'interrupted',...(pending?{attemptedAt:record.attemptedAt||record.startedAt}:{}),finishedAt:at,reason:pending?'The app restarted before submission confirmation. Check this job in LinkedIn; it will not be retried automatically.':'The app restarted before submission. Retry explicitly to continue.',...(record.lifecycleVersion===1?{revision:record.revision+1,updatedAt:at,blockers:pending?[makeBlocker('submission_uncertain',{phase:record.phase})]:record.blockers}: {})};
        });await persist('history',next);state.history=next;
      });queue=action.catch(()=>{});await action;await store.reconcileQuestions();
    },
    async recoverPending(){return store.recoverWork();}
  };
  return store;
}
