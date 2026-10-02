import {mkdir,readFile,open,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {defaultConfig,validateConfig,validateAnswers,statuses} from './domain.mjs';
import {acquireDataOwnership} from './data-ownership.mjs';

const clone = value => structuredClone(value);
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
        record={...history[index],...clone(patch),id,job:history[index].job};
        history[index]=record;
        return history;
      });
      return clone(record);
    },
    async recoverPending() {
      if (!state.history.some(item=>item.status==='submission_pending')) return;
      await mutate('history',history=>history.map(record=>record.status==='submission_pending'? {
        ...record,status:'unconfirmed',attemptedAt:record.attemptedAt||record.startedAt,
        finishedAt:new Date().toISOString(),reason:'The app restarted before submission confirmation. Check this job in LinkedIn; it will not be retried automatically.'
      }:record));
    }
  };
  return store;
}
