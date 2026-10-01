import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../src/store.mjs';
import {blocksRetry} from '../src/domain.mjs';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(),'job-applier-store-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  return dir;
}

test('settings and answers survive a restart without shared mutable references', async t => {
  const dir = await temporary(t);
  const store = await createStore(dir);
  await store.saveConfig({profile:{email:'me@example.com'},search:{titles:['Engineer']}});
  await store.saveAnswers({'Years of Java experience?':0,'Relocate?':false});
  const config = await store.getConfig();
  config.profile.email = 'changed@example.com';
  const reopened = await createStore(dir);
  assert.equal((await reopened.getConfig()).profile.email,'me@example.com');
  assert.deepEqual(await reopened.getAnswers(),{'years of java experience':0,relocate:false});
});

test('concurrent history writes retain every durable record', async t => {
  const dir = await temporary(t);
  const store = await createStore(dir);
  await Promise.all(Array.from({length:20},(_,i)=>store.createRecord({id:String(i),url:`https://www.linkedin.com/jobs/view/${i}/`,title:'Engineer',company:'Example'},'skipped')));
  const history = await (await createStore(dir)).getHistory();
  assert.equal(history.length,20);
  assert.equal(new Set(history.map(record=>record.id)).size,20);
  assert.equal(JSON.parse(await readFile(join(dir,'history.json'),'utf8')).length,20);
});

test('pending submission is recovered as uncertain and cannot be retried', async t => {
  const dir = await temporary(t);
  const store = await createStore(dir);
  const record = await store.createRecord({id:'123',url:'https://www.linkedin.com/jobs/view/123/',title:'Engineer',company:'Example'},'submission_pending');
  await store.updateRecord(record.id,{attemptedAt:'2026-10-01T15:00:00Z'});
  const recovered = await createStore(dir);
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
