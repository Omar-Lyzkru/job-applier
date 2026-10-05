import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,stat,mkdir,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {buildDiagnostic,saveFailureSnapshot,readFailureSnapshot} from '../src/failure-snapshots.mjs';
const id=randomUUID(),at='2026-10-04T15:00:00Z';
const valid=()=>({recordId:id,phase:'form',pageIndex:2,timestamp:at,code:'entry_timeout',controlCounts:{text:2,radio:1},fingerprints:['a'.repeat(64)],validationCategories:['valueMissing'],busy:true,transition:'unchanged',actions:[{kind:'fill',durationMs:300,retries:1}],cleanup:'closed'});
async function temporary(t){const dir=await mkdtemp(join(tmpdir(),'applier-snapshots-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('diagnostics allow only structural categories and never private strings',()=>{
 const secret='private-test-secret';const input={...valid(),value:secret,label:secret,password:secret,cookies:secret,html:secret,resume:secret,error:secret,answers:{x:secret},controlCounts:{text:2,[secret]:3},fingerprints:[secret,'a'.repeat(64)],validationCategories:[secret,'valueMissing'],actions:[{kind:secret,durationMs:1,label:secret}],cleanup:secret,transition:secret};
 const safe=buildDiagnostic(input);assert.equal(JSON.stringify(safe).includes(secret),false);assert.equal(safe.controlCounts.text,2);assert.deepEqual(safe.fingerprints,['a'.repeat(64)]);assert.deepEqual(safe.validationCategories,['valueMissing']);
 const malformed=buildDiagnostic({recordId:'../answers',phase:secret,pageIndex:NaN,timestamp:secret,code:secret,controlCounts:{text:-1},actions:[{kind:'fill',durationMs:Infinity,retries:-3}]});
 assert.equal(malformed.recordId,null);assert.equal(malformed.phase,'unknown');assert.equal(malformed.code,'unknown');assert.equal(malformed.pageIndex,null);assert.equal(malformed.timestamp,null);
});
test('snapshot round trips privately and rejects arbitrary paths',async t=>{
 const dir=await temporary(t),result=await saveFailureSnapshot(dir,id,valid());assert.deepEqual(result,{available:true,reference:{recordId:id}});
 const read=await readFailureSnapshot(dir,id);assert.equal(read.recordId,id);assert.equal(read.phase,'form');
 for(const path of [join(dir,'failures'),join(dir,'failures',id)])assert.equal((await stat(path)).mode&0o777,0o700);
 assert.equal((await stat(join(dir,'failures',id,'snapshot.json'))).mode&0o777,0o600);
 for(const bad of ['../answers','/tmp/file','x']){assert.equal((await saveFailureSnapshot(dir,bad,valid())).available,false);assert.equal(await readFailureSnapshot(dir,bad),null);}
});
test('missing, corrupt, oversized and unwritable snapshots are unavailable',async t=>{
 const dir=await temporary(t);assert.equal(await readFailureSnapshot(dir,id),null);
 assert.equal((await saveFailureSnapshot(dir,id,{...valid(),fingerprints:Array(1500).fill('a'.repeat(64))})).available,false);
 await saveFailureSnapshot(dir,id,valid());const file=join(dir,'failures',id,'snapshot.json');await writeFile(file,'{broken');assert.equal(await readFailureSnapshot(dir,id),null);
 await writeFile(file,' '.repeat(65537));assert.equal(await readFailureSnapshot(dir,id),null);await rm(file);await mkdir(file);
 assert.equal((await saveFailureSnapshot(dir,id,valid())).available,false);assert.deepEqual(await readdir(join(dir,'failures',id)),['snapshot.json']);
});
test('retention keeps 100 snapshots and leaves independent private data unchanged',async t=>{
 const dir=await temporary(t);await writeFile(join(dir,'history.json'),'history');await writeFile(join(dir,'answers.json'),'answers');
 const ids=Array.from({length:101},()=>randomUUID());const results=await Promise.all(ids.map(recordId=>saveFailureSnapshot(dir,recordId,valid())));assert.ok(results.every(r=>r.available));
 assert.equal((await readdir(join(dir,'failures'))).length,100);assert.equal(await readFile(join(dir,'history.json'),'utf8'),'history');assert.equal(await readFile(join(dir,'answers.json'),'utf8'),'answers');
});
for(const target of ['root','directory','file'])test(`snapshot ${target} symlinks are never followed`,async t=>{
 const dir=await temporary(t),outside=await temporary(t);await writeFile(join(outside,'sentinel'),'keep');
 if(target==='root')await symlink(outside,join(dir,'failures'));
 else{await mkdir(join(dir,'failures'));if(target==='directory')await symlink(outside,join(dir,'failures',id));else{await mkdir(join(dir,'failures',id));await writeFile(join(outside,'snapshot.json'),'keep');await symlink(join(outside,'snapshot.json'),join(dir,'failures',id,'snapshot.json'));}}
 assert.equal((await saveFailureSnapshot(dir,id,valid())).available,false);assert.equal(await readFailureSnapshot(dir,id),null);assert.equal(await readFile(join(outside,'sentinel'),'utf8'),'keep');
 if(target==='file')assert.equal(await readFile(join(outside,'snapshot.json'),'utf8'),'keep');
});
test('pruning preserves symlinks and directories containing foreign files',async t=>{
 const dir=await temporary(t),outside=await temporary(t);await mkdir(join(dir,'failures'));const link=randomUUID();await symlink(outside,join(dir,'failures',link));
 const foreign=randomUUID();await saveFailureSnapshot(dir,foreign,valid());await writeFile(join(dir,'failures',foreign,'foreign'),'keep');
 for(let i=0;i<101;i++)await saveFailureSnapshot(dir,randomUUID(),valid());
 assert.equal((await stat(join(dir,'failures',link))).isDirectory(),true);assert.equal(await readFile(join(dir,'failures',foreign,'foreign'),'utf8'),'keep');
});
