import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startFixture} from './fixtures/linkedin.mjs';
import {createLinkedInAdapter} from '../src/browser/linkedin.mjs';

const job={id:'1001',url:'https://www.linkedin.com/jobs/view/1001/',title:'Software Engineer',company:'Example'};
const profile={firstName:'Test',lastName:'Applicant',email:'test@example.com',phone:'5551234567'};
const answers={'years of java experience':0,'are you authorized to work in this country':true,'are you willing to relocate':false,'i agree to share this information':true};
async function setup(t,scenario='success') {
  const fixture=await startFixture(scenario);
  const dir=await mkdtemp(join(tmpdir(),'job-applier-browser-'));
  const resumePath=join(dir,'selected-resume.pdf');await writeFile(resumePath,'%PDF-1.4\nfixture');
  const adapter=createLinkedInAdapter({dataDir:dir,headless:true,fixtureBaseUrl:fixture.url,timeouts:{action:2000,confirmation:500,cleanup:500}});
  t.after(async()=>{await adapter.close();await fixture.close();await rm(dir,{recursive:true,force:true});});
  return {adapter,fixture,resumePath,options:{profile,answers,resumePath,dryRun:false,beforeSubmit:async()=>fixture.state.events.push('guard')}};
}

test('browser: multistep explicit answers and selected resume precede one confirmed submission',async t=>{
  const {adapter,fixture,options}=await setup(t);
  const result=await adapter.apply(job,options);
  assert.equal(result.status,'submitted',JSON.stringify(result));
  assert.deepEqual(fixture.state.events,['guard','submit']);
  assert.equal(fixture.state.submissions.length,1);
  assert.equal(fixture.state.fields.email,'test@example.com');
  assert.equal(fixture.state.fields.years,'0');
  assert.equal(fixture.state.fields.relocate,'no');
  assert.equal(fixture.state.fields.authorized,'1');
  assert.equal(fixture.state.fields.consent,true);
  assert.equal(fixture.state.fields.follow,false);
  assert.equal(fixture.state.fields.previous,'');
  assert.match(fixture.state.fields.resume,/^selected-resume-applier-[a-f0-9-]+\.pdf$/);
  assert.equal(fixture.state.fields.resumeContent,'%PDF-1.4\nfixture');
});

test('browser: delayed same-filename upload waits for acceptance and selects the new document',async t=>{
  const {adapter,fixture,options}=await setup(t,'delayed-upload');
  const result=await adapter.apply(job,options);
  assert.equal(result.status,'submitted',JSON.stringify(result));
  assert.equal(fixture.state.fields.resumeContent,'%PDF-1.4\nfixture');
  assert.equal(fixture.state.fields.documentId,'new-upload');
});
test('browser: upload that never becomes an accepted selected document blocks submission',async t=>{
  const {adapter,fixture,options}=await setup(t,'upload-failure');
  const result=await adapter.apply(job,options);
  assert.notEqual(result.status,'submitted');
  assert.equal(fixture.state.events.length,0);
});
test('browser: custom required or selected answer widgets with hidden backing inputs block submission',async t=>{
  for(const scenario of ['custom-checkbox','custom-radio','custom-listbox','custom-combobox']){
    const {adapter,fixture,options}=await setup(t,scenario);
    const result=await adapter.apply(job,options);
    assert.equal(result.status,'needs_answer',scenario+': '+JSON.stringify(result));
    assert.ok(result.pendingQuestions.some(question=>question.type==='unsupported'));
    assert.equal(fixture.state.events.length,0);
  }
});
test('browser: CV screening radio question uses its explicit saved answer',async t=>{
  const {adapter,fixture,options}=await setup(t,'cv-question');
  const result=await adapter.apply(job,{...options,answers:{...answers,'can you provide a cv':true}});
  assert.equal(result.status,'submitted',JSON.stringify(result));
  assert.equal(fixture.state.fields.cv,'yes');
});
test('browser: missing required answers block even when other fields were filled',async t=>{
  const {adapter,fixture,options}=await setup(t);
  const result=await adapter.apply(job,{...options,answers:{}});
  assert.equal(result.status,'needs_answer');
  assert.ok(result.pendingQuestions.some(q=>q.label==='Years of Java experience'));
  assert.equal(fixture.state.submissions.length,0);
});
test('browser: dry run reaches review without calling the submission guard',async t=>{
  const {adapter,fixture,options}=await setup(t);
  assert.equal((await adapter.apply(job,{...options,dryRun:true})).status,'ready');
  assert.deepEqual(fixture.state.events,[]);
});
test('browser: rejected submission guard prevents the final click',async t=>{
  const {adapter,fixture,options}=await setup(t);
  await adapter.apply(job,{...options,beforeSubmit:async()=>{throw new Error('Stopped');}});
  assert.equal(fixture.state.submissions.length,0);
});
test('browser: confirmation timeout stays uncertain without another click',async t=>{
  const {adapter,fixture,options}=await setup(t,'timeout');
  assert.equal((await adapter.apply(job,options)).status,'unconfirmed');
  assert.equal(fixture.state.submissions.length,1);
});
test('browser: failed draft cleanup pauses further applications',async t=>{
  const {adapter,fixture,options}=await setup(t,'stuck-cleanup');
  assert.equal((await adapter.apply(job,{...options,answers:{}})).status,'paused');
  assert.equal(fixture.state.submissions.length,0);
});
test('browser: platform application limit pauses without submission',async t=>{
  const {adapter,fixture,options}=await setup(t,'limit');
  assert.equal((await adapter.apply(job,options)).status,'paused');
  assert.equal(fixture.state.submissions.length,0);
});
test('browser: external Apply and already-applied jobs are skipped',async t=>{
  for(const scenario of ['external','already-applied']){
    const {adapter,fixture,options}=await setup(t,scenario);
    assert.equal((await adapter.apply(job,options)).status,'skipped');
    assert.equal(fixture.state.submissions.length,0);
    await adapter.close();
  }
});
test('browser: search pagination preserves canonical IDs and filters within scan bound',async t=>{
  const {adapter,fixture}=await setup(t);
  const jobs=[];
  for await(const candidate of adapter.findJobs({titles:['Software Engineer'],location:'Chicago',workplace:'remote'},{scanLimit:3}))jobs.push(candidate);
  assert.deepEqual(jobs.map(j=>j.id),['1001','1002','1003']);
  assert.equal(jobs[0].url,'https://www.linkedin.com/jobs/view/1001/');
  assert.equal(fixture.state.searches[0].location,'Chicago');
  assert.equal(fixture.state.searches[0].f_WT,'2');
  assert.equal(fixture.state.searches[0].f_AL,'true');
});
test('browser: sign-in state is detected and browser ownership is reused',async t=>{
  const {adapter}=await setup(t);
  const first=await adapter.openBrowser();
  const second=await adapter.openBrowser();
  assert.equal(first,second);
  assert.equal(await adapter.isSignedIn(),true);
  const signedOut=await setup(t,'signed-out');
  await signedOut.adapter.openBrowser();
  assert.equal(await signedOut.adapter.isSignedIn(),false);
});
