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
async function setup(t,scenario='success',timeouts={}) {
  const fixture=await startFixture(scenario);
  const dir=await mkdtemp(join(tmpdir(),'job-applier-browser-'));
  const resumePath=join(dir,'selected-resume.pdf');await writeFile(resumePath,'%PDF-1.4\nfixture');
  const adapter=createLinkedInAdapter({dataDir:dir,headless:true,fixtureBaseUrl:fixture.url,timeouts:{action:2000,confirmation:500,cleanup:500,...timeouts}});
  t.after(async()=>{await adapter.close();await fixture.close();await rm(dir,{recursive:true,force:true});});
  return {adapter,fixture,resumePath,options:{profile,answers,resumePath,dryRun:false,beforeSubmit:async()=>fixture.state.events.push('guard')}};
}

test('browser: description reads modern About the job section without a title heading',async t=>{
  const {adapter,fixture}=await setup(t,'description-modern',{action:600});
  const candidate={...job,title:'Card internship title',company:'Card company'};
  const result=await adapter.inspect(candidate);
  assert.equal(result.description,'Build Python software for our internship team.');
  assert.equal(candidate.title,'Card internship title');
  assert.equal(candidate.company,'Card company');
  assert.equal(result.easyApply,true);
  assert.deepEqual(fixture.state.events,[]);
});
test('browser: description waits for delayed legacy and modern hydration',async t=>{
  for(const [scenario,expected] of [['description-delayed','Hydrated Python software description.'],['description-modern-delayed','Hydrated Python internship description.']]){
    const {adapter}=await setup(t,scenario,{action:1000});
    assert.equal((await adapter.inspect({...job})).description,expected);
  }
});
test('browser: nested controls and hidden text cannot replace the modern description',async t=>{
  const {adapter}=await setup(t,'description-wrapped-controls',{action:600});
  assert.equal((await adapter.inspect({...job})).description,'Build Ruby systems for our team.');
});
test('browser: description ignores empty and hidden legacy candidates',async t=>{
  const {adapter}=await setup(t,'description-empty-first',{action:600});
  assert.equal((await adapter.inspect({...job})).description,'Visible Python engineering description.');
});
test('browser: description never includes related-job keywords outside its section',async t=>{
  const {adapter}=await setup(t,'description-related',{action:600});
  const result=await adapter.inspect({...job});
  assert.equal(result.description,'Build Ruby systems for our team.');
  assert.doesNotMatch(result.description,/Python|Related jobs/);
});
test('browser: missing description throws an extraction error instead of matching related jobs',async t=>{
  const {adapter,fixture}=await setup(t,'description-missing',{action:600});
  await assert.rejects(adapter.inspect({...job}),/description.*(?:read|layout|extract)|(?:read|extract).*description/i);
  assert.deepEqual(fixture.state.events,[]);
});
test('browser: optional title and company metadata do not delay description inspection',async t=>{
  const {adapter}=await setup(t,'description-no-metadata');
  await adapter.openBrowser();
  const candidate={...job,title:'Card title',company:'Card company'};
  const started=performance.now();
  const result=await adapter.inspect(candidate);
  assert.ok(performance.now()-started<1500,'Optional metadata waited for the action timeout');
  assert.equal(result.description,'Remote Python software role.');
  assert.equal(candidate.title,'Card title');
  assert.equal(candidate.company,'Card company');
});
test('browser: stopping while description hydrates interrupts inspection',async t=>{
  const {adapter,fixture}=await setup(t,'description-stopped',{action:1000});
  await adapter.openBrowser();
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),250);t.after(()=>clearTimeout(timer));
  await assert.rejects(adapter.inspect({...job},{signal:controller.signal}),/Stopped/);
  assert.deepEqual(fixture.state.events,[]);
});
test('browser: verification appearing while description hydrates interrupts inspection',async t=>{
  const {adapter,fixture}=await setup(t,'description-verification',{action:1000});
  await assert.rejects(adapter.inspect({...job}),/verification/i);
  assert.deepEqual(fixture.state.events,[]);
});

test('browser: safety reminder follows Continue applying text instead of Review job post',async t=>{
  for(const dryRun of [true,false]){
    const {adapter,fixture,options}=await setup(t,'safety-reminder');
    const result=await adapter.apply({...job},{...options,dryRun});
    assert.equal(result.status,dryRun?'ready':'submitted',JSON.stringify(result));
    assert.deepEqual(fixture.state.events,dryRun?['reminder-continue']:['reminder-continue','guard','submit']);
    const page=await adapter.openBrowser();
    assert.equal(await page.getByRole('dialog').count(),0,'Native application dialog remained open after completion');
  }
});
test('browser: Easy Apply shown before its click handler retries opening once without submitting',async t=>{
  const {adapter,fixture,options}=await setup(t,'opener-delayed');
  const result=await adapter.apply({...job},{...options,dryRun:true});
  assert.equal(result.status,'ready',JSON.stringify(result));
  assert.deepEqual(fixture.state.events,[]);
});
test('browser: unrelated chat dialogs do not prevent application draft cleanup',async t=>{
  const {adapter,fixture,options}=await setup(t,'unrelated-dialog');
  const result=await adapter.apply({...job},{...options,dryRun:true});
  assert.equal(result.status,'ready',JSON.stringify(result));
  assert.deepEqual(fixture.state.events,[]);
  const page=await adapter.openBrowser();
  assert.equal(await page.getByRole('dialog').count(),1);
  assert.equal(await page.getByRole('heading',{name:'MS in Applied Analytics',exact:true}).isVisible(),true);
});
test('browser: modern save prompt discards through its exact text and retries an unhandled dismissal once',async t=>{
  for(const scenario of ['modern-discard','dismiss-delayed']){
    const {adapter,fixture,options}=await setup(t,scenario,{cleanup:1000});
    const result=await adapter.apply({...job},{...options,dryRun:true});
    assert.equal(result.status,'ready',scenario+': '+JSON.stringify(result));
    assert.deepEqual(fixture.state.events,[]);
    const page=await adapter.openBrowser();assert.equal(await page.getByRole('dialog').count(),0);
  }
});
test('browser: safety reminder waits for hydrated application fields before reaching review',async t=>{
  const {adapter,fixture,options}=await setup(t,'safety-hydrating');
  const result=await adapter.apply({...job},{...options,dryRun:true,answers:{}});
  assert.equal(result.status,'needs_answer',JSON.stringify(result));
  assert.ok(result.pendingQuestions.some(question=>question.label==='Years of Java experience'));
  assert.deepEqual(fixture.state.events,['reminder-continue']);
  const page=await adapter.openBrowser();
  assert.equal(await page.getByRole('dialog').count(),0,'Native application draft was not discarded');
});
test('browser: unfamiliar safety warning pauses without choosing or dismissing it',async t=>{
  const {adapter,fixture,options}=await setup(t,'safety-unknown');
  const result=await adapter.apply({...job},{...options,dryRun:true});
  assert.equal(result.status,'paused',JSON.stringify(result));
  assert.match(result.reason,/safety|warning/i);
  assert.deepEqual(fixture.state.events,[]);
  const page=await adapter.openBrowser();
  assert.equal(await page.getByRole('heading',{name:'Job post safety warning',exact:true}).isVisible(),true);
});
test('browser: Stop interrupts safety reminder readiness without applying',async t=>{
  const {adapter,fixture,options}=await setup(t,'safety-stop');
  const page=await adapter.openBrowser();
  const controller=new AbortController();
  const pending=adapter.apply({...job},{...options,dryRun:true,signal:controller.signal});
  await page.getByRole('heading',{name:'Job search safety reminder',exact:true}).waitFor();
  controller.abort();
  const result=await pending;
  assert.match(result.reason,/Stopped/);
  assert.deepEqual(fixture.state.events,[]);
});

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
  assert.equal(fixture.state.searches[0].f_E,undefined);
});

test('browser: selected experience levels reach every LinkedIn search',async t=>{
  const {adapter,fixture}=await setup(t);
  for(const [levels,expected] of [
    [['INTERNSHIP'],'1'],[['ENTRY_LEVEL'],'2'],[['ASSOCIATE'],'3'],
    [['MID_SENIOR_LEVEL'],'4'],[['DIRECTOR'],'5'],[['EXECUTIVE'],'6'],
    [['INTERNSHIP','ENTRY_LEVEL'],'1,2']
  ]){
    const jobs=[];
    for await(const candidate of adapter.findJobs({titles:['Software Engineer'],location:'Chicago',workplace:'any',experienceLevels:levels},{scanLimit:1}))jobs.push(candidate);
    assert.equal(jobs.length,1);
    assert.equal(fixture.state.searches.at(-1).f_E,expected);
  }
});

test('browser: experience filter values come from LinkedIn controls rather than assumed numbers',async t=>{
  const {adapter,fixture}=await setup(t,'experience-values');
  const jobs=[];
  for await(const job of adapter.findJobs({titles:['Software Engineer'],location:'Chicago',workplace:'any',experienceLevels:['INTERNSHIP','ENTRY_LEVEL']},{scanLimit:1}))jobs.push(job);
  assert.equal(jobs.length,1);
  assert.equal(fixture.state.searches[0].f_E,undefined);
  assert.equal(fixture.state.searches.at(-1).f_E,'11,22');
});

test('browser: LinkedIn visible and accessibility filter labels allow automatic experience selection',async t=>{
  const {adapter,fixture}=await setup(t,'experience-linkedin-labels');
  const jobs=[];
  for await(const job of adapter.findJobs({titles:['Software Engineer'],location:'Chicago',workplace:'any',experienceLevels:['INTERNSHIP','ENTRY_LEVEL']},{scanLimit:3}))jobs.push(job);
  assert.deepEqual(jobs.map(job=>job.id),['1001','1002','1003']);
  assert.equal(fixture.state.searches.slice(1).every(search=>search.f_E==='1,2'),true);
});

test('browser: missing experience filter controls block discovery instead of ignoring a selected level',async t=>{
  const {adapter,fixture}=await setup(t,'experience-unavailable');
  await assert.rejects(async()=>{
    for await(const job of adapter.findJobs({titles:['Software Engineer'],location:'Chicago',workplace:'any',experienceLevels:['INTERNSHIP']},{scanLimit:1}))assert.fail('Must not yield unfiltered jobs');
  },/LinkedIn.*experience.*filter/i);
  assert.equal(fixture.state.searches.length,1);
});

test('browser: experience popup loading and result counts preserve selected levels across pagination',async t=>{
  const {adapter,fixture}=await setup(t,'experience-popup');
  const jobs=[];
  for await(const job of adapter.findJobs({titles:['Software Engineer'],location:'Chicago',workplace:'any',experienceLevels:['INTERNSHIP','ENTRY_LEVEL']},{scanLimit:3}))jobs.push(job);
  assert.equal(jobs.length,3);
  assert.equal(fixture.state.searches[0].f_E,undefined);
  assert.equal(fixture.state.searches.length,3);
  assert.equal(fixture.state.searches.slice(1).every(search=>search.f_E==='1,2'),true);
  assert.equal(fixture.state.searches.at(-1).start,'25');
});

test('browser: delayed experience controls load before discovery continues',async t=>{
  const {adapter,fixture}=await setup(t,'experience-delayed');
  const jobs=[];
  for await(const job of adapter.findJobs({titles:['Software Engineer'],location:'Chicago',workplace:'any',experienceLevels:['INTERNSHIP']},{scanLimit:1}))jobs.push(job);
  assert.equal(jobs.length,1);
  assert.equal(fixture.state.searches.at(-1).f_E,'1');
});

test('browser: ignored experience selections yield no jobs for application',async t=>{
  for(const scenario of ['experience-ignored','experience-widened']){
    const {adapter}=await setup(t,scenario);
    await assert.rejects(async()=>{
      for await(const job of adapter.findJobs({titles:['Software Engineer'],location:'Chicago',workplace:'any',experienceLevels:['INTERNSHIP']},{scanLimit:1}))assert.fail('Must not yield jobs when LinkedIn ignores or widens the selected level');
    },/LinkedIn.*confirm.*experience/i);
  }
});

test('browser: experience filtering is confirmed again before accepting a later results page',async t=>{
  const {adapter}=await setup(t,'experience-ignored-later');
  const jobs=[];
  await assert.rejects(async()=>{
    for await(const job of adapter.findJobs({titles:['Software Engineer'],location:'Chicago',workplace:'any',experienceLevels:['INTERNSHIP']},{scanLimit:3}))jobs.push(job);
  },/LinkedIn.*confirm.*experience/i);
  assert.deepEqual(jobs.map(job=>job.id),['1001','1002']);
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

test('browser: closing the tracked tab reopens a page in the same browser session',async t=>{
  const {adapter,fixture}=await setup(t);
  const first=await adapter.openBrowser(),context=first.context();
  const other=await context.newPage();
  await other.goto(fixture.url+'/login');
  await context.addCookies([{name:'fixture_session',value:'keep-me',url:fixture.url}]);
  await first.close();
  let reopened;
  try {
    const pages=await Promise.all([adapter.openBrowser(),adapter.openBrowser(),adapter.openBrowser()]);
    reopened=pages[0];
    assert.equal(pages.every(candidate=>candidate===reopened),true);
    assert.equal(reopened.context()===context,true,'Reopening must reuse the context that already owns the profile');
    assert.equal(reopened===other,false);
    assert.equal(reopened.isClosed(),false);
    assert.equal(other.isClosed(),false);
    assert.equal(other.url(),fixture.url+'/login');
    assert.equal(new URL(reopened.url()).pathname,'/feed/');
    assert.equal((await context.cookies(fixture.url)).find(cookie=>cookie.name==='fixture_session').value,'keep-me');
  } finally {
    if(reopened && reopened.context()!==context)await reopened.context().close();
    await context.close();
  }
});

test('browser: overlapping closes finish before reopening and retain the saved session',async t=>{
  const {adapter,fixture}=await setup(t);
  const first=await adapter.openBrowser(),context=first.context();
  await context.addCookies([{name:'fixture_session',value:'keep-me',url:fixture.url,expires:Math.floor(Date.now()/1000)+3600}]);
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();
  const closeContext=context.close.bind(context);
  context.close=async()=>{entered.resolve();await gate.promise;await closeContext();};
  let closing,reopening,reopened;
  try {
    closing=adapter.close();
    await entered.promise;
    let secondCloseFinished=false;
    const secondClose=adapter.close().then(()=>{secondCloseFinished=true;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(secondCloseFinished,false,'Every close must wait for the owned browser to finish closing');
    reopening=adapter.openBrowser();
    gate.resolve();
    reopened=await reopening;
    await Promise.all([closing,secondClose]);
    assert.equal(reopened.context()===context,false);
    assert.equal(reopened.isClosed(),false);
    assert.equal((await reopened.context().cookies(fixture.url)).find(cookie=>cookie.name==='fixture_session')?.value,'keep-me');
    assert.equal((await adapter.openBrowser())===reopened,true);
    await reopened.context().close();
    reopened=await adapter.openBrowser();
    assert.equal(reopened.isClosed(),false);
    assert.equal(new URL(reopened.url()).pathname,'/feed/');
  } finally {
    gate.resolve();
    if(closing)await closing;
    if(reopening)await reopening.catch(()=>{});
    await adapter.close();
  }
});

test('browser: concurrent opens await the initial feed navigation',async t=>{
  const {adapter,fixture}=await setup(t);
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();
  fixture.state.beforeFeed=async()=>{entered.resolve();await gate.promise;};
  let first,second;
  try {
    first=adapter.openBrowser();
    await entered.promise;
    let secondFinished=false;
    second=adapter.openBrowser().then(page=>{secondFinished=true;return page;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(secondFinished,false,'Open must not return a page whose initial navigation is still pending');
    gate.resolve();
    const pages=await Promise.all([first,second]);
    assert.equal(pages[0]===pages[1],true);
    assert.equal(new URL(pages[0].url()).pathname,'/feed/');
  } finally {
    gate.resolve();
    await Promise.allSettled([first,second].filter(Boolean));
  }
});

test('browser: failed feed navigation is retried by the next open',async t=>{
  const {adapter,fixture}=await setup(t);
  fixture.state.beforeFeed=(_request,response)=>response.destroy();
  await assert.rejects(adapter.openBrowser(),/net::ERR_EMPTY_RESPONSE/);
  fixture.state.beforeFeed=null;
  const page=await adapter.openBrowser();
  assert.equal(new URL(page.url()).pathname,'/feed/');
  assert.equal(await page.getByRole('heading',{name:'Feed'}).isVisible(),true);
});
