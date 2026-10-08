import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startFixture} from './fixtures/linkedin.mjs';
import {createLinkedInAdapter} from '../src/browser/linkedin.mjs';
import {validateIntelligence} from '../src/intelligence-config.mjs';

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

const fairSearch={titles:['A','B','C'],location:'Houston, TX, USA',workplace:'any',experienceLevels:[]};
const intelligent=validateIntelligence({enabled:true});
test('browser: enabled discovery shares a small scan fairly between queries without opening jobs',async t=>{
  const {adapter,fixture}=await setup(t);
  fixture.state.searchPageFor=params=>params.start==='0'?Array.from({length:6},(_,i)=>({id:String(1000+'ABC'.indexOf(params.keywords)*100+i),title:params.keywords,company:'Example'})):[];
  const jobs=[];for await(const found of adapter.findJobs(fairSearch,{scanLimit:5,intelligence:intelligent}))jobs.push(found);
  assert.deepEqual(jobs.map(j=>j.title),['A','A','B','B','C']);
  assert.equal(jobs.length,5);assert.equal(new Set(jobs.map(j=>j.id)).size,5);
  assert.deepEqual(fixture.state.searches.map(q=>[q.keywords,q.start]),[['A','0'],['B','0'],['C','0']]);
  assert.equal(fixture.state.searches.every(q=>q.f_AL==='true'),true);assert.deepEqual(fixture.state.views,[]);
});
test('browser: enabled discovery consumes buffered cards before advancing a query page',async t=>{
  const {adapter,fixture}=await setup(t);
  fixture.state.searchPageFor=params=>{
    const index='ABC'.indexOf(params.keywords),page=Number(params.start);
    if(page>25)return [];
    const count=params.keywords==='A'&&page===0?6:1;
    return Array.from({length:count},(_,i)=>({id:String(1000+index*100+page+i),title:params.keywords,company:'Example'}));
  };
  const jobs=[];for await(const found of adapter.findJobs(fairSearch,{scanLimit:10,intelligence:intelligent}))jobs.push(found);
  assert.deepEqual(jobs.map(j=>j.title),['A','A','A','A','B','C','A','A','B','C']);
  assert.deepEqual(fixture.state.searches.map(q=>[q.keywords,q.start]),[['A','0'],['B','0'],['C','0'],['B','25'],['C','25']]);
});
test('browser: query duplicates and slugged IDs consume one global slot with bounded cancellation',async t=>{
  const {adapter,fixture}=await setup(t);
  fixture.state.searchPageFor=params=>params.start==='0'?[{id:'1001',slug:'intern-1001',title:'Shared',company:'Example'},{id:params.keywords==='B'?'1002':'1001',title:'Second',company:'Example'}]:[];
  const jobs=[];for await(const found of adapter.findJobs(fairSearch,{scanLimit:2,intelligence:intelligent}))jobs.push(found);
  assert.deepEqual(jobs.map(j=>j.id),['1001','1002']);
  const controller=new AbortController();controller.abort();
  const before=fixture.state.searches.length;
  await assert.rejects(async()=>{for await(const ignored of adapter.findJobs(fairSearch,{signal:controller.signal,intelligence:intelligent})){}},/Stopped/);
  assert.equal(fixture.state.searches.length,before);
});
test('browser: optional posting facts come only from visible primary header evidence',async t=>{
  const {adapter,fixture}=await setup(t);
  fixture.state.postingFor=()=>({header:'<span data-job-location>Houston, Texas, United States</span><span data-job-workplace>Hybrid</span><time datetime="2026-10-02T12:00:00Z">2 days ago</time><span data-job-location hidden>London, UK</span>',related:'<aside><span data-job-location>Dallas, TX, USA</span><time datetime="2026-10-04">Today</time></aside>'});
  const result=await adapter.inspect({...job});
  assert.equal(result.location,'Houston, Texas, United States');assert.equal(result.workplace,'hybrid');assert.equal(result.postedAt,'2026-10-02T12:00:00Z');
  assert.doesNotMatch(JSON.stringify(result.evidence),/Dallas|London/);
});
test('browser: missing primary posting metadata remains unknown without waiting for an action timeout',async t=>{
  const {adapter,fixture}=await setup(t,'success',{action:1800});
  fixture.state.postingFor=()=>({related:'<aside><span data-job-location>Dallas, TX, USA</span><time datetime="2026-10-04">Today</time></aside>'});
  await adapter.openBrowser();const start=performance.now();const result=await adapter.inspect({...job});
  assert.equal(result.location,null);assert.equal(result.postedAt,null);assert.equal(result.workplace,null);
  assert.ok(performance.now()-start<1000);
});
test('browser: intelligent discovery preserves selected region workplace and confirmed experience filters',async t=>{
  const {adapter,fixture}=await setup(t);
  const config=validateIntelligence({enabled:true,regions:[{name:'United States',priority:7,workplace:'remote'}]});
  const found=[];for await(const candidate of adapter.findJobs({...fairSearch,experienceLevels:['INTERNSHIP']},{scanLimit:1,intelligence:config}))found.push(candidate);
  assert.equal(found.length,1);
  const last=fixture.state.searches.at(-1);assert.equal(last.location,'United States');assert.equal(last.f_WT,'2');assert.equal(last.f_E,'1');assert.equal(last.f_AL,'true');
  assert.equal(new Set(fixture.state.searches.map(q=>q.keywords)).size,1);
});
test('browser: Stop during an intelligent search navigation yields no later queries or applications',async t=>{
  const {adapter,fixture}=await setup(t),entered=Promise.withResolvers(),gate=Promise.withResolvers(),controller=new AbortController();
  fixture.state.beforeSearch=async()=>{entered.resolve();await gate.promise;};
  const result=(async()=>{const found=[];for await(const candidate of adapter.findJobs(fairSearch,{scanLimit:10,signal:controller.signal,intelligence:intelligent}))found.push(candidate);return found;})();
  const rejected=assert.rejects(result,/Stopped/);
  try{await entered.promise;controller.abort();gate.resolve();await rejected;assert.equal(fixture.state.searches.length,1);assert.deepEqual(fixture.state.views,[]);assert.deepEqual(fixture.state.events,[]);}finally{gate.resolve();await result.catch(()=>{});}
});

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
test('browser: loaded application page progress permits review and one guarded submission',async t=>{
  for(const dryRun of [true,false]){
    const {adapter,fixture,options}=await setup(t,'page-progress',{action:700});
    const result=await adapter.apply({...job},{...options,dryRun});
    assert.equal(result.status,dryRun?'ready':'submitted',JSON.stringify(result));
    assert.deepEqual(fixture.state.events,dryRun?[]:['guard','submit']);
  }
});
test('browser: page counters do not hide busy forms or upload/loading progress',async t=>{
  for(const scenario of ['page-progress-busy','upload-progress','indeterminate-progress','unrelated-page-counter']){
    const {adapter,fixture,options}=await setup(t,scenario,{action:700});
    const result=await adapter.apply({...job},options);
    assert.equal(result.status,'failed',scenario+': '+JSON.stringify(result));
    assert.match(result.reason,/form.*loading/);
    assert.deepEqual(fixture.state.events,[]);
    assert.equal(result.blockers[0].code,'form_changed');assert.equal(result.cleanup.confirmed,true);
    assert.deepEqual(fixture.state.entries,[],'A loading form was filled');
  }
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

test('browser: answer memory carries employer context through a dry run and records actual reused answers',async t=>{
  const saved={school:'University of Houston','are you legally authorized to work in the united states':'Yes','will you now or in the future require sponsorship to work in the united states':'No','sms consent for bge inc':'No'};
  for(const company of ['BGE, Inc.','Another Company']){
    const {adapter,fixture,options}=await setup(t,'answer-memory');
    const result=await adapter.apply({...job,company},{...options,answers:saved,dryRun:true});
    assert.equal(result.status,company==='BGE, Inc.'?'ready':'needs_answer',JSON.stringify(result));
    assert.equal(fixture.state.submissions.length,0);
    assert.deepEqual(fixture.state.events,[],'Dry-run memory never invokes the submission guard');
    assert.ok(result.answerMatches.some(match=>match.sourceQuestion==='school'&&match.company===company&&match.answer==='University of Houston'));
    if(company==='BGE, Inc.'){
      assert.equal(fixture.state.fields.authorized,'1');
      assert.equal(fixture.state.fields.sponsorship,'0');
      assert.equal(fixture.state.fields.sms,'0');
      assert.ok(result.answerMatches.some(match=>match.sourceQuestion==='sms consent for bge inc'));
    }else{
      assert.equal(result.pendingQuestions.length,1);
      assert.equal(result.pendingQuestions[0].answerKey,'sms consent for another company');
    }
  }
});

test('browser: delayed same-filename upload waits for acceptance and selects the new document',async t=>{
  const {adapter,fixture,options}=await setup(t,'delayed-upload');
  const result=await adapter.apply(job,options);
  assert.equal(result.status,'submitted',JSON.stringify(result));
  assert.equal(fixture.state.fields.resumeContent,'%PDF-1.4\nfixture');
  assert.equal(fixture.state.fields.documentId,'new-upload');
});
test('browser: verified résumé success alert permits review and one guarded submission',async t=>{
  for(const dryRun of [true,false]){
    const {adapter,fixture,options}=await setup(t,'resume-success-alert');
    const result=await adapter.apply({...job},{...options,dryRun});
    assert.equal(result.status,dryRun?'ready':'submitted',JSON.stringify(result));
    assert.deepEqual(fixture.state.events,dryRun?[]:['guard','submit']);
    if(!dryRun)assert.equal(fixture.state.fields.documentId,'new-upload');
  }
});
test('browser: genuine validation alert still blocks after a verified résumé upload',async t=>{
  const {adapter,fixture,options}=await setup(t,'resume-error-alert');
  const result=await adapter.apply({...job},options);
  assert.equal(result.status,'failed',JSON.stringify(result));
  assert.match(result.reason,/Document processing failed/);
  assert.deepEqual(fixture.state.events,[]);
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

for(const scenario of ['identical-text-next','ignored-next-once'])test(`browser: reliable ${scenario} advances and submits once`,async t=>{
 const {adapter,fixture,options}=await setup(t,scenario,{action:1000});const progress=[];const result=await adapter.apply(job,{...options,onProgress:async p=>progress.push(structuredClone(p))});assert.equal(result.status,'submitted',JSON.stringify(result));assert.deepEqual(fixture.state.events,['guard','submit']);
 if(scenario==='identical-text-next')assert.deepEqual(fixture.state.advances.map(a=>a.step),[1,2,3]);else{assert.equal(fixture.state.advances.filter(a=>a.step===2).length,2);assert.ok(progress.some(p=>Object.values(p.retryCounters.pages).some(n=>n===1)));}
});
test('browser: an ignored Next has one safe retry and then a scoped failure',async t=>{
 const {adapter,fixture,options}=await setup(t,'ignored-next-always',{action:700});const result=await adapter.apply(job,options);assert.equal(fixture.state.advances.filter(a=>a.step===2).length,2);assert.equal(result.blockers[0].code,'form_changed');assert.equal(result.cleanup.confirmed,true);assert.equal(fixture.state.submissions.length,0);
});
test('browser: validation is not progress and its echo never enters diagnostics',async t=>{
 const {adapter,fixture,options}=await setup(t,'next-validation',{action:700});const result=await adapter.apply(job,options);assert.equal(result.blockers[0].code,'validation');assert.equal(fixture.state.advances.filter(a=>a.step===2).length,1);assert.equal(fixture.state.submissions.length,0);assert.equal(JSON.stringify(result.diagnostic).includes('private-test-secret'),false);
});
test('browser: Stop during unchanged busy transition does not click Next again',async t=>{
 const {adapter,fixture,options}=await setup(t,'next-busy',{action:1600});const controller=new AbortController(),gate=Promise.withResolvers();fixture.state.beforeAdvance=async event=>{if(event.step===2)gate.resolve();};const run=adapter.apply(job,{...options,signal:controller.signal});await Promise.race([gate.promise,run.then(result=>{throw new Error('Application finished before busy step: '+JSON.stringify(result));})]);controller.abort();const result=await run;assert.equal(fixture.state.advances.filter(a=>a.step===2).length,1);assert.equal(fixture.state.submissions.length,0);assert.match(result.reason,/Stopped/);
});
for(const scenario of ['field','resume'])test(`browser: ${scenario} change during guard prevents the final click`,async t=>{
 const {adapter,fixture,options}=await setup(t);const result=await adapter.apply(job,{...options,beforeSubmit:async context=>{
  const page=await adapter.openBrowser();await page.evaluate(scenario=>{const root=document.querySelector('[role=dialog]');root.insertAdjacentHTML('beforeend',scenario==='field'?'<label>New required*<input required></label>':'<section class="jobs-document-upload"><fieldset><legend>Resume</legend><label><input type="radio" name="changed-document" checked>old-resume.pdf</label></fieldset></section>');},scenario);await context?.validateReady?.();
 }});assert.equal(fixture.state.submissions.length,0);assert.ok(result.blockers.some(b=>b.code===(scenario==='field'?'missing_answer':'resume_upload')));
});
test('browser: cleanup failure retains the original missing questions and adds its own blocker',async t=>{
 const {adapter,fixture,options}=await setup(t,'stuck-cleanup');const result=await adapter.apply(job,{...options,answers:{}});assert.ok(result.pendingQuestions.length);assert.ok(result.blockers.some(b=>b.code==='missing_answer'));assert.equal(result.cleanup.confirmed,false);assert.equal(result.cleanup.blocker.code,'cleanup_failed');assert.equal(fixture.state.submissions.length,0);
});
test('browser: failed progress persistence prohibits entry or submission',async t=>{
 const {adapter,fixture,options}=await setup(t);const result=await adapter.apply(job,{...options,onProgress:async()=>{throw new Error('private-test-secret');}});assert.equal(result.blockers[0].code,'storage');assert.equal(fixture.state.advances.length,0);assert.equal(fixture.state.submissions.length,0);assert.equal(JSON.stringify(result.diagnostic).includes('private-test-secret'),false);
});
test('browser: inspection login interruption carries a typed global blocker',async t=>{
 const {adapter}=await setup(t,'signed-out');await assert.rejects(adapter.inspect({...job}),error=>error.blocker?.code==='login_required');
});

test('browser: missing explicit answers do not become duplicate native-validation blockers',async t=>{const {adapter,options}=await setup(t);const result=await adapter.apply(job,{...options,answers:{}});assert.equal(result.status,'needs_answer');assert.ok(result.pendingQuestions.length);assert.ok(result.blockers.every(b=>b.code==='missing_answer'));});

test('browser: failure diagnostics include measured actions without field labels or values',async t=>{const {adapter,options}=await setup(t,'next-validation',{action:700});const result=await adapter.apply(job,options);assert.ok(result.diagnostic.actions.length>0);assert.ok(result.diagnostic.actions.some(a=>a.kind==='fill'));assert.ok(result.diagnostic.actions.every(a=>Number.isInteger(a.durationMs)&&a.durationMs>=0&&a.durationMs<=60000));assert.doesNotMatch(JSON.stringify(result.diagnostic.actions),/test@example|Test|Applicant|private-test-secret|Resume|first name/i);});


test('browser: an exposed resume region without current choices during pacing prevents reservation and Submit',async t=>{
 const {adapter,fixture,options}=await setup(t);let reserved=false;
 const result=await adapter.apply(job,{...options,beforeSubmit:async({validateReady})=>{const page=await adapter.openBrowser();await page.evaluate(()=>document.querySelector('[role=dialog]').insertAdjacentHTML('beforeend','<section class="jobs-document-upload"><h3>Resume</h3><button>Upload resume</button></section>'));await validateReady();reserved=true;}});
 assert.equal(reserved,false);assert.equal(fixture.state.submissions.length,0);assert.ok(result.blockers.some(b=>b.code==='resume_upload'),JSON.stringify(result));
});

test('browser: a validated page counter advances reused controls and refills their reset values',async t=>{
 const {adapter,fixture,options}=await setup(t,'reused-page-progress',{action:1000});const result=await adapter.apply(job,options);assert.equal(result.status,'submitted',JSON.stringify(result));assert.deepEqual(fixture.state.advances.map(event=>event.step),[1,2]);assert.equal(fixture.state.submissions.length,1);assert.equal(fixture.state.submissions[0].first,'Test');assert.deepEqual(fixture.state.events,['guard','submit']);
});

test('browser: separate jobs reuse the same accepted saved resume without another upload',async t=>{
 const {adapter,fixture,options}=await setup(t,'resume-reuse');const page=await adapter.openBrowser();await page.context().addCookies([{name:'li_at',value:'synthetic-account-a',url:fixture.url}]);
 for(const id of ['1001','1002']){const result=await adapter.apply({...job,id},{...options,dryRun:true});assert.equal(result.status,'ready',JSON.stringify(result));}
 assert.equal(fixture.state.uploads.length,1);assert.equal(fixture.state.reviews.length,2);assert.equal(fixture.state.reviews[1].resume,fixture.state.reviews[0].resume);assert.equal(fixture.state.reviews[1].resumeContent,'%PDF-1.4\nfixture');assert.deepEqual(fixture.state.submissions,[]);
});
test('browser: a changed saved resume replaces bytes once and later jobs reuse that version',async t=>{
 const {adapter,fixture,options,resumePath}=await setup(t,'resume-reuse');const page=await adapter.openBrowser();await page.context().addCookies([{name:'li_at',value:'synthetic-account-a',url:fixture.url}]);
 assert.equal((await adapter.apply(job,{...options,dryRun:true})).status,'ready');await writeFile(resumePath,'%PDF-1.4 changed saved version');
 for(const id of ['1002','1003']){const result=await adapter.apply({...job,id},{...options,dryRun:true});assert.equal(result.status,'ready',JSON.stringify(result));}
 assert.equal(fixture.state.uploads.length,2);assert.equal(fixture.state.reviews[1].resumeContent,'%PDF-1.4 changed saved version');assert.equal(fixture.state.reviews[2].resume,fixture.state.reviews[1].resume);assert.notEqual(fixture.state.reviews[0].resume,fixture.state.reviews[1].resume);
});
