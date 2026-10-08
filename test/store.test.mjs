import test from 'node:test';
import fsp from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile, rename, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {blocksRetry} from '../src/domain.mjs';
import {spawn} from 'node:child_process';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(),'job-applier-store-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  return dir;
}

test('intelligent matching facts survive resume updates and store reopen without becoming screening answers',async t=>{
  const dir=await temporary(t),store=await createStore(dir);
  await store.saveConfig({intelligence:{enabled:true,candidate:{skills:[],student:false,professionalYears:0,clearances:[]},roleFamilies:['swe']}});
  await store.saveResume({path:'/tmp/synthetic.pdf',filename:'synthetic.pdf',size:10});
  await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());
  const config=await reopened.getConfig();
  assert.equal(config.intelligence.enabled,true);assert.deepEqual(config.intelligence.candidate.skills,[]);
  assert.equal(config.intelligence.candidate.student,false);assert.equal(config.intelligence.candidate.professionalYears,0);
  assert.deepEqual(await reopened.getAnswers(),{});
});

test('settings and answers survive a restart without shared mutable references', async t => {
  const dir = await temporary(t);
  const store = await createStore(dir);
  await store.saveConfig({profile:{email:'me@example.com'},search:{titles:['Engineer']}});
  await store.saveAnswers({'Years of Java experience?':0,'Relocate?':false});
  const config = await store.getConfig();
  config.profile.email = 'changed@example.com';
  await store.close();
  const reopened = await createStore(dir);
  t.after(()=>reopened.close());
  assert.equal((await reopened.getConfig()).profile.email,'me@example.com');
  assert.deepEqual(await reopened.getAnswers(),{'years of java experience':0,relocate:false});
});

test('concurrent history writes retain every durable record', async t => {
  const dir = await temporary(t);
  const store = await createStore(dir);
  await Promise.all(Array.from({length:20},(_,i)=>store.createRecord({id:String(i),url:`https://www.linkedin.com/jobs/view/${i}/`,title:'Engineer',company:'Example'},'skipped')));
  await store.close();
  const reopened=await createStore(dir);t.after(()=>reopened.close());
  const history = await reopened.getHistory();
  assert.equal(history.length,20);
  assert.equal(new Set(history.map(record=>record.id)).size,20);
  assert.equal(JSON.parse(await readFile(join(dir,'history.json'),'utf8')).length,20);
});

test('pending submission is recovered as uncertain and cannot be retried', async t => {
  const dir = await temporary(t);
  const store = await createStore(dir);
  const record = await store.createRecord({id:'123',url:'https://www.linkedin.com/jobs/view/123/',title:'Engineer',company:'Example'},'submission_pending');
  await store.updateRecord(record.id,{attemptedAt:'2026-10-01T15:00:00Z'});
  await store.close();
  const recovered = await createStore(dir);
  t.after(()=>recovered.close());
  await recovered.recoverPending();
  const [result] = await recovered.getHistory();
  assert.equal(result.status,'unconfirmed');
  assert.equal(result.attemptedAt,'2026-10-01T15:00:00Z');
  assert.equal(blocksRetry(result),true);
});

test('corrupt persisted data produces a clear error rather than an empty history', async t => {
  const dir = await temporary(t);
  await writeFile(join(dir,'history.json'),'{bad');
  await assert.rejects(createStore(dir),/history.json.*corrupt/i);
});

test('data-directory ownership rejects another process and survives abrupt owner death without losing history',async t=>{
  const dir=await temporary(t);
  const source=`import {createStore} from ${JSON.stringify(new URL('../src/store.mjs',import.meta.url).href)};
    const store=await createStore(process.env.APPLIER_TEST_DATA);
    await store.createRecord({id:'123',title:'Engineer',company:'Example'},'submission_pending');
    process.send({ready:true});setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{env:{...process.env,APPLIER_TEST_DATA:dir},stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stderr.on('data',chunk=>{output+=chunk;});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Owner did not start: '+output)),3000);
    child.once('message',()=>{clearTimeout(timer);resolve();});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error('Owner exited: '+output));});
  });
  let contender;
  try{
    await assert.rejects(async()=>{contender=await createStore(dir);},/already.*(?:open|running|use)|owned/i);
  }finally{await contender?.close?.();}
  child.kill('SIGKILL');await exited;
  const recovered=await createStore(dir);t.after(()=>recovered.close?.());
  await recovered.recoverPending();
  assert.equal((await recovered.getHistory()).length,1);
  assert.equal((await recovered.getHistory())[0].status,'unconfirmed');
});

test('legacy profile links remain editable instead of preventing app startup',async t=>{
  const dir=await temporary(t);
  await writeFile(join(dir,'config.json'),JSON.stringify({profile:{firstName:'Test',linkedinUrl:'old incomplete link',website:'ftp://files.example/work'}}));
  const store=await createStore(dir);t.after(()=>store.close());
  const previous=await store.getConfig();
  assert.equal(previous.profile.firstName,'Test');
  assert.equal(previous.profile.linkedinUrl,'old incomplete link');
  await assert.rejects(store.saveConfig(previous),/LinkedIn profile URL/);
  await store.saveConfig({...previous,profile:{...previous.profile,linkedinUrl:'linkedin.com/in/test-applicant',website:''}});
  assert.equal((await store.getConfig()).profile.linkedinUrl,'https://linkedin.com/in/test-applicant');
});

const clock=new Date('2026-10-04T15:00:00Z');
const workJob=(id='100',fingerprint)=>({id,url:`https://www.linkedin.com/jobs/view/${id}/`,title:'Engineer',company:'Example',...(fingerprint?{fingerprint}:{})});
async function workStore(t){const dir=await temporary(t),store=await createStore(dir);t.after(()=>store.close());return {dir,store};}
async function filling(store,job=workJob()){
 let r=await store.createWork(job,{now:clock});
 r=await store.transitionWork(r.id,{expectedRevision:r.revision,status:'inspecting',phase:'inspection',now:clock});
 return store.transitionWork(r.id,{expectedRevision:r.revision,status:'filling',phase:'form',now:clock});
}
const reserve=(store,r,cap=10)=>store.reserveSubmission(r.id,{expectedRevision:r.revision,now:clock,timezone:'America/Chicago',dailyCap:cap});

test('durable lifecycle enforces revision, identities and legal transitions',async t=>{
 const {store}=await workStore(t),r=await store.createWork(workJob(),{now:clock});
 assert.equal(r.lifecycleVersion,1);assert.equal(r.lineageId,r.id);assert.equal(r.status,'queued');assert.equal(r.attemptedAt,null);
 const next=await store.transitionWork(r.id,{expectedRevision:0,status:'inspecting',phase:'inspection',job:{...r.job,description:'fresh'},now:clock});
 assert.equal(next.revision,1);assert.equal(next.job.description,'fresh');
 await assert.rejects(store.transitionWork(r.id,{expectedRevision:0,status:'filling'}),/revision|stale/i);
 await assert.rejects(store.transitionWork(r.id,{expectedRevision:1,status:'submitted'}),/transition/i);
 await assert.rejects(store.transitionWork(r.id,{expectedRevision:1,job:workJob('999')}),/identity/i);
 await assert.rejects(store.transitionWork(r.id,{expectedRevision:1,attemptedAt:clock.toISOString()}),/field|immutable/i);
 await assert.rejects(store.updateRecord(r.id,{status:'submitted'}),/transition|lifecycle/i);
});
test('a retry links to its parent atomically and conflicting or stale claims fail',async t=>{
 const {store}=await workStore(t);let parent=await filling(store);
 parent=await store.transitionWork(parent.id,{expectedRevision:parent.revision,status:'failed',phase:'form',blockers:[{code:'validation'}]});
 const results=await Promise.allSettled([1,2].map(()=>store.createWork(parent.job,{parentId:parent.id,expectedParentRevision:parent.revision,now:clock})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const child=results.find(r=>r.status==='fulfilled').value;
 assert.equal(child.retryOf,parent.id);assert.equal(child.lineageId,parent.lineageId);
 const saved=(await store.getHistory()).find(r=>r.id===parent.id);assert.equal(saved.retryId,child.id);assert.equal(saved.revision,parent.revision+1);
 await assert.rejects(store.createWork(parent.job,{parentId:parent.id,expectedParentRevision:parent.revision}),/revision|stale|active|latest/i);
});
test('legacy states load without rewriting and unattempted legacy failure can be claimed',async t=>{
 const dir=await temporary(t),states=['submitted','submission_pending','unconfirmed','skipped','needs_answer','failed','ready'];
 const records=states.map((status,i)=>({id:`legacy-${i}`,job:workJob(String(i+1)),status,startedAt:clock.toISOString(),attemptedAt:null}));
 await writeFile(join(dir,'history.json'),JSON.stringify(records));const bytes=await readFile(join(dir,'history.json'),'utf8');
 const store=await createStore(dir);t.after(()=>store.close());assert.deepEqual(await store.getHistory(),records);
 assert.equal(await readFile(join(dir,'history.json'),'utf8'),bytes);
 const child=await store.createWork(records[5].job,{parentId:records[5].id,expectedParentRevision:0});assert.equal(child.retryOf,records[5].id);
});
test('reserved submission is immutable and cannot return to unattempted work',async t=>{
 const {store}=await workStore(t),r=await reserve(store,await filling(store));
 assert.equal(r.status,'submission_pending');assert.equal(r.attemptedAt,clock.toISOString());assert.equal(r.phase,'submission');
 await assert.rejects(reserve(store,r),/attempt|reserve|state/i);
 await assert.rejects(store.transitionWork(r.id,{expectedRevision:r.revision,status:'queued'}),/transition/i);
 await assert.rejects(store.transitionWork(r.id,{expectedRevision:r.revision,attemptedAt:null}),/immutable|field/i);
 const done=await store.transitionWork(r.id,{expectedRevision:r.revision,status:'submitted',phase:'confirmation'});
 assert.equal(done.attemptedAt,r.attemptedAt);assert.ok(done.finishedAt);
});
for(const equivalent of [false,true])test(`concurrent reservations protect ${equivalent?'strong equivalent':'same ID'} jobs`,async t=>{
 const {store}=await workStore(t),a=await filling(store,workJob('100','f'.repeat(64))),b=await filling(store,workJob(equivalent?'101':'100','f'.repeat(64)));
 const results=await Promise.allSettled([reserve(store,a),reserve(store,b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await store.getHistory()).filter(r=>r.attemptedAt).length,1);
});
test('daily cap is checked in the atomic reservation under concurrency',async t=>{
 const {store}=await workStore(t),a=await filling(store,workJob('100')),b=await filling(store,workJob('101'));
 const results=await Promise.allSettled([reserve(store,a,1),reserve(store,b,1)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/cap/i);
});
for(const phase of ['queued','inspecting','filling','submission_pending'])test(`recovery preserves ${phase} work with correct submission protection`,async t=>{
 const {dir,store}=await workStore(t);let r=await store.createWork(workJob(),{now:clock});
 if(phase!=='queued')r=await store.transitionWork(r.id,{expectedRevision:r.revision,status:'inspecting',phase:'inspection'});
 if(['filling','submission_pending'].includes(phase))r=await store.transitionWork(r.id,{expectedRevision:r.revision,status:'filling',phase:'form',pendingQuestions:[{key:'relocate',label:'Relocate?',type:'radio',options:[{label:'Yes',value:'yes'},{label:'No',value:'no'}],required:true,blocker:'missing_answer'}]});
 if(phase==='submission_pending')r=await reserve(store,r);
 await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());await reopened.recoverWork();
 const [saved]=await reopened.getHistory();assert.equal(saved.status,phase==='submission_pending'?'unconfirmed':'interrupted');assert.equal(Boolean(saved.attemptedAt),phase==='submission_pending');assert.equal(saved.phase,r.phase);
 if(['filling','submission_pending'].includes(phase))assert.equal((await reopened.getQuestions())[0].label,'Relocate?');
 const bytes=await readFile(join(dir,'history.json'),'utf8');await reopened.recoverWork();assert.equal(await readFile(join(dir,'history.json'),'utf8'),bytes);
});
test('canonical questions recover after a crash without changing settings or answers',async t=>{
 const {dir,store}=await workStore(t);await store.saveConfig({profile:{email:'synthetic@example.com'}});await store.saveAnswers({Relocate:false});
 const config=await readFile(join(dir,'config.json'),'utf8'),answers=await readFile(join(dir,'answers.json'),'utf8');
 await store.saveQuestions([{jobId:'999',label:'Orphan?',key:'orphan',type:'text'},{jobId:'100',label:'Entry issue',key:'entry',type:'text',reason:'Entry failed'}]);
 let r=await filling(store);r=await store.transitionWork(r.id,{expectedRevision:r.revision,status:'needs_answer',phase:'form',pendingQuestions:[{key:'relocate',label:'Relocate?',type:'radio',options:[{label:'Yes',value:'yes'},{label:'No',value:'no'}],blocker:'missing_answer',required:true}]});
 await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());await reopened.recoverWork();
 assert.equal((await reopened.getQuestions()).length,3);assert.ok((await reopened.getQuestions()).some(q=>q.recordId===r.id));
 assert.equal(await readFile(join(dir,'config.json'),'utf8'),config);assert.equal(await readFile(join(dir,'answers.json'),'utf8'),answers);
 const child=await reopened.createWork(r.job,{parentId:r.id,expectedParentRevision:r.revision});
 let current=await reopened.transitionWork(child.id,{expectedRevision:0,status:'inspecting',phase:'inspection'});
 current=await reopened.transitionWork(child.id,{expectedRevision:current.revision,status:'filling',phase:'form'});
 await reopened.transitionWork(child.id,{expectedRevision:current.revision,status:'ready',phase:'review'});await reopened.reconcileQuestions();
 assert.deepEqual((await reopened.getQuestions()).map(q=>q.jobId),['999']);
});
for(const after of [false,true])test(`failed write ${after?'after':'before'} reservation preserves durable truth`,async t=>{
 const {dir,store}=await workStore(t);let r=await filling(store);if(after)r=await reserve(store,r);
 const path=join(dir,'history.json');await rename(path,path+'.saved');await mkdir(path);
 try{await assert.rejects(after?store.transitionWork(r.id,{expectedRevision:r.revision,status:'submitted'}):reserve(store,r));assert.equal((await store.getHistory())[0].status,r.status);}
 finally{await rm(path,{recursive:true});await rename(path+'.saved',path);}
 await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());await reopened.recoverWork();
 assert.equal((await reopened.getHistory())[0].status,after?'unconfirmed':'interrupted');assert.equal(Boolean((await reopened.getHistory())[0].attemptedAt),after);
});
test('legacy update cannot erase an attempted timestamp',async t=>{
 const {store}=await workStore(t),r=await store.createRecord(workJob(),'submission_pending');await assert.rejects(store.updateRecord(r.id,{attemptedAt:null}),/attempt|immutable/i);
});


test('post-rename directory sync failure cannot erase a reserved attempt during recovery',async t=>{
 const {dir,store}=await workStore(t),r=await filling(store),originalOpen=fsp.open;let failSync=true;
 fsp.open=async(...args)=>{const handle=await originalOpen(...args);if(args[0]===dir){const sync=handle.sync.bind(handle);handle.sync=async()=>{if(failSync){failSync=false;throw Object.assign(new Error('Synthetic directory fsync EIO'),{code:'EIO'});}return sync();};}return handle;};syncBuiltinESMExports();
 try{
  await assert.rejects(reserve(store,r),/directory fsync EIO/);
  const disk=JSON.parse(await readFile(join(dir,'history.json'),'utf8'))[0];assert.equal(disk.status,'submission_pending');assert.ok(disk.attemptedAt);
  const memory=(await store.getHistory())[0];assert.equal(memory.status,'submission_pending');assert.equal(memory.attemptedAt,disk.attemptedAt);
  await store.recoverWork();const recovered=(await store.getHistory())[0];assert.equal(recovered.status,'unconfirmed');assert.equal(recovered.attemptedAt,disk.attemptedAt);
  assert.equal(JSON.parse(await readFile(join(dir,'history.json'),'utf8'))[0].attemptedAt,disk.attemptedAt);await assert.rejects(reserve(store,recovered),/attempt|reserve|state/i);
 }finally{fsp.open=originalOpen;syncBuiltinESMExports();}
 await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());await reopened.recoverWork();assert.equal((await reopened.getHistory())[0].status,'unconfirmed');
});

import {describeBankQuestion,bankCandidates,bankDigest} from '../src/answer-bank.mjs';
const bankField={label:'Years of professional Python experience',type:'number',jobId:'123',company:'Example',min:'0',step:'1'};
const bankCommand=(value=0,extra={})=>({expectedBankRevision:0,question:describeBankQuestion(bankField),sourceQuestion:bankField.label,scope:{kind:'job',jobId:'123'},value,confirmed:true,provenance:{jobId:'123',recordId:'observed'},...extra});
test('scoped bank absent reads and coherent snapshots preserve private legacy bytes',async t=>{
 const dir=await temporary(t),store=await createStore(dir);t.after(()=>store.close());await store.saveAnswers({'School':'UH'});
 const before=await readFile(join(dir,'answers.json'));assert.deepEqual(await store.getAnswerBank(),{version:1,revision:0,entries:[]});
 await assert.rejects(readFile(join(dir,'answer-bank.json')),/ENOENT/);const snapshot=await store.getRunInputs();snapshot.answers.school='Other';snapshot.answerBank.revision=20;
 assert.equal((await store.getRunInputs()).answers.school,'UH');assert.equal((await store.getAnswerBank()).revision,0);assert.deepEqual(await readFile(join(dir,'answers.json')),before);
});
test('scoped bank corruption rejects startup',async t=>{const dir=await temporary(t);await writeFile(join(dir,'answer-bank.json'),'{"version":99}');await assert.rejects(createStore(dir),/answer-bank.json.*corrupt/);});
test('scoped bank concurrent saves stale edits and retirement retain typed durable ownership',async t=>{
 const dir=await temporary(t),store=await createStore(dir);
 const results=await Promise.allSettled([store.saveBankEntry(bankCommand()),store.saveBankEntry(bankCommand(2))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/stale/i);
 let b=await store.getAnswerBank();assert.equal(b.entries[0].value,0);const id=b.entries[0].id;
 await assert.rejects(store.saveBankEntry(bankCommand(1,{entryId:id,expectedEntryRevision:1})),/stale/i);
 await assert.rejects(store.saveBankEntry(bankCommand(1,{expectedBankRevision:1,entryId:id,expectedEntryRevision:1,confirmed:false})),/confirm/i);
 await assert.rejects(store.saveBankEntry(bankCommand(1,{expectedBankRevision:1,entryId:id,expectedEntryRevision:1,sourceQuestion:'Other'})),/source/i);
 b=await store.retireBankEntry({entryId:id,expectedBankRevision:1,expectedEntryRevision:1});assert.equal(b.entries[0].state,'retired');assert.equal(bankCandidates(bankField,b).owned.length,1);assert.equal(bankCandidates(bankField,b).exact.length,0);
 await assert.rejects(store.retireBankEntry({entryId:id,expectedBankRevision:2,expectedEntryRevision:2}),/retired/i);
 await assert.rejects(store.saveBankEntry(bankCommand(3,{expectedBankRevision:2,entryId:id,expectedEntryRevision:2})),/retired/i);
 await store.saveBankEntry(bankCommand(false,{expectedBankRevision:2,question:describeBankQuestion({...bankField,label:'Would you relocate?',type:'checkbox'}),sourceQuestion:'Would you relocate?'}));
 await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());const values=(await reopened.getAnswerBank()).entries.map(e=>e.value);assert.deepEqual(values,[0,false]);
});
test('scoped bank replacement digest is checked inside serialized commit against current legacy truth',async t=>{
 const dir=await temporary(t),store=await createStore(dir);t.after(()=>store.close());await store.saveAnswers({[bankField.label]:4});
 const command=bankCommand(0,{legacyKey:'years of professional python experience',provenance:{jobId:'123',recordId:'observed',replacementDigest:bankDigest(4)},replacementConfirmed:true});
 const changed=store.saveAnswers({[bankField.label]:5});await assert.rejects(store.saveBankEntry(command),/replacement.*changed/i);await changed;
 assert.equal((await store.getAnswerBank()).revision,0);await store.saveBankEntry({...command,provenance:{...command.provenance,replacementDigest:bankDigest(5)}});assert.equal((await store.getAnswers())['years of professional python experience'],5);
});
test('scoped bank pre and post rename failures recover committed truth without changing legacy files',async t=>{
 const dir=await temporary(t),store=await createStore(dir);await store.saveAnswers({School:'UH'});await store.saveConfig({});await store.saveQuestions([]);await store.createRecord({id:'123'},'skipped');
 const files=['answers','config','questions','history'],before=await Promise.all(files.map(n=>readFile(join(dir,n+'.json'))));
 const originalRename=fsp.rename,originalOpen=fsp.open;
 try{
  fsp.rename=async(...args)=>{if(args[1]===join(dir,'answer-bank.json'))throw new Error('Synthetic bank rename EIO');return originalRename(...args);};syncBuiltinESMExports();
  await assert.rejects(store.saveBankEntry(bankCommand()),/bank rename EIO/);assert.equal((await store.getAnswerBank()).revision,0);
  fsp.rename=originalRename;let once=true;fsp.open=async(...args)=>{const handle=await originalOpen(...args);if(args[0]===dir&&once){handle.sync=async()=>{once=false;throw new Error('Synthetic bank directory EIO');};}return handle;};syncBuiltinESMExports();
  await assert.rejects(store.saveBankEntry(bankCommand()),/bank directory EIO/);assert.equal((await store.getAnswerBank()).revision,1);
 }finally{fsp.rename=originalRename;fsp.open=originalOpen;syncBuiltinESMExports();}
 await store.close();const reopened=await createStore(dir);t.after(()=>reopened.close());assert.equal((await reopened.getAnswerBank()).entries[0].value,0);
 for(let i=0;i<files.length;i++)assert.deepEqual(await readFile(join(dir,files[i]+'.json')),before[i]);assert.equal((await fsp.stat(join(dir,'answer-bank.json'))).mode&0o777,0o600);
});
