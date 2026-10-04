import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
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
