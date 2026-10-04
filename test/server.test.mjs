import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {createStore} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';

async function setup(t){
  const dir=await mkdtemp(join(tmpdir(),'job-applier-api-'));const store=await createStore(dir);
  let state='idle';const commands=[];
  const runner={getStatus:()=>({state,message:'Ready',todayCount:0,currentJob:null}),start:async options=>{state='running';commands.push(['start',options]);},stop:async()=>{state='idle';commands.push(['stop']);},openBrowser:async()=>commands.push(['browser'])};
  const app=await createApp({dataDir:dir,store,runner,port:0});await app.listen();
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const bootstrap=await (await fetch(app.url+'/api/bootstrap')).json();
  const send=(path,body={},headers={})=>fetch(app.url+path,{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':bootstrap.token,...headers},body:JSON.stringify(body)});
  const upload=(filename,body)=>fetch(app.url+'/api/resume',{method:'POST',headers:{'X-App-Token':bootstrap.token,'X-Filename':encodeURIComponent(filename),'Content-Type':'application/octet-stream'},body});
  return {dir,store,app,bootstrap,send,upload,commands};
}

test('current-student common question stays blank until an explicit answer is saved',async t=>{
  const {app,send}=await setup(t);
  const read=async()=>await (await fetch(app.url+'/api/bootstrap')).json();
  let student=(await read()).answerMemory.commonQuestions.find(q=>q.key==='are you currently a student');
  assert.equal(student.status,'unanswered');assert.equal(student.answer,undefined);
  await send('/api/config',{intelligence:{candidate:{student:true}}});
  assert.equal((await read()).answerMemory.commonQuestions.find(q=>q.key==='are you currently a student').status,'unanswered');
  await send('/api/answers',{'are you currently a student':false});student=(await read()).answerMemory.commonQuestions.find(q=>q.key==='are you currently a student');assert.equal(student.answer,false);
});

test('bootstrap groups operational repeats and preserves raw questions after one answer save',async t=>{
  const {store,app,send}=await setup(t),read=async()=>await (await fetch(app.url+'/api/bootstrap')).json();
  const base={key:'evening work',label:'Evening work?',type:'radio',required:true,options:[{label:'Yes',value:'y'},{label:'No',value:'n'}],blocker:'operational',reason:'Could not select answer'};
  const questions=[{...base,jobId:'1001'},{...base,jobId:'1002',reason:'Answer entry timed out'},{...base,jobId:'1001'},{...base,jobId:''}];
  await store.saveQuestions(questions);
  let data=await read();assert.equal(data.questionGroups?.length,1);assert.deepEqual(data.questionCounts,{distinctQuestions:1,affectedApplications:2,occurrences:4});
  const draftId=data.questionGroups[0].draftId;
  assert.equal((await send('/api/answers',{'evening work':false})).status,200);
  data=await read();assert.equal(data.questions.length,4);assert.equal(data.questionGroups[0].savedAnswer.answer,false);assert.equal(data.questionGroups[0].draftId,draftId);
  assert.deepEqual(await store.getQuestions(),questions);assert.deepEqual(data.answers,{'evening work':false});
});

test('grouped old questions keep full-history job context beyond the latest 200 records',async t=>{
  const {store,app}=await setup(t);
  await store.createRecord({id:'1001',title:'Old role',company:'Old employer',url:'https://www.linkedin.com/jobs/view/1001/'},'needs_answer');
  for(let i=0;i<201;i++)await store.createRecord({id:String(2000+i),title:'Newer role',company:'Other'},'skipped');
  await store.saveQuestions([{key:'why us',label:'Why us?',type:'text',jobId:'1001',blocker:'operational',reason:'Entry failed'}]);
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(data.history.length,200);assert.equal(data.history.some(r=>r.job.id==='1001'),false);
  assert.equal(data.questionGroups?.[0]?.occurrences[0].jobTitle,'Old role');
  assert.equal(data.questionGroups[0].occurrences[0].jobUrl,'https://www.linkedin.com/jobs/view/1001/');
});

test('API retains matching settings on save and rejects oversized expanded queries',async t=>{
  const {app,send}=await setup(t);
  assert.equal((await send('/api/config',{intelligence:{enabled:true,minimumFitScore:60,candidate:{student:false,professionalYears:0,skills:['JS']},roleFamilies:['web'],regions:[{name:'United States',priority:8,workplace:'remote'}]}})).status,200);
  const bootstrap=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(bootstrap.config.intelligence.minimumFitScore,60);
  assert.deepEqual(bootstrap.config.intelligence.candidate.skills,['javascript']);
  assert.equal(bootstrap.config.intelligence.candidate.student,false);
  assert.deepEqual(bootstrap.answers,{});
  const response=await send('/api/config',{search:{titles:Array.from({length:26},(_,i)=>`Role ${i}`)},intelligence:{enabled:true,regions:[{name:'United States',priority:10,workplace:'remote'},{name:'Canada',priority:5,workplace:'remote'}]}});
  assert.equal(response.status,400);assert.match((await response.json()).error,/50/);
});
test('API persists settings and normalized answers and dispatches controls',async t=>{
  const {app,send,commands}=await setup(t);
  assert.equal((await send('/api/config',{profile:{email:'me@example.com'},search:{titles:['Engineer'],location:'Chicago'}})).status,200);
  assert.equal((await send('/api/answers',{'Years of experience?':0})).status,200);
  assert.equal((await send('/api/browser')).status,200);
  assert.equal((await send('/api/run',{dryRun:true})).status,200);
  assert.equal((await (await fetch(app.url+'/api/status')).json()).state,'running');
  assert.equal((await send('/api/stop')).status,200);
  const current=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(current.config.profile.email,'me@example.com');
  assert.equal(current.answers['years of experience'],0);
  assert.deepEqual(commands.slice(0,3),[['browser'],['start',{dryRun:true}],['stop']]);
});
test('API rejects cross-origin and tokenless writes and invalid Host',async t=>{
  const {app,send}=await setup(t);
  assert.equal((await send('/api/run',{}, {Origin:'https://evil.example'})).status,403);
  assert.equal((await send('/api/run',{}, {'X-App-Token':''})).status,403);
  const hostStatus=await new Promise((resolve,reject)=>{
    const req=request(app.url+'/api/bootstrap',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('error',reject);req.end();
  });
  assert.equal(hostStatus,403);
});
test('API stores new resumes at immutable paths without accepting a client path override',async t=>{
  const {upload,send,store}=await setup(t);
  const first=await (await upload('my resume.pdf','%PDF-first')).json();
  const second=await (await upload('my resume.pdf','%PDF-second')).json();
  assert.notEqual(first.resume.path,second.resume.path);
  assert.equal(await readFile(first.resume.path,'utf8'),'%PDF-first');
  assert.equal(await readFile(second.resume.path,'utf8'),'%PDF-second');
  assert.ok(first.resume.path.endsWith('my resume.pdf'));
  await send('/api/config',{profile:{email:'me@example.com'},resume:{path:'/etc/passwd',filename:'bad.pdf',size:4}});
  assert.equal((await store.getConfig()).resume.path,second.resume.path);
});
test('API rejects overlarge and unsupported uploads and malformed JSON',async t=>{
  const {app,bootstrap,upload}=await setup(t);
  assert.equal((await upload('resume.pdf',Buffer.alloc(2_000_001))).status,413);
  assert.equal((await upload('resume.sh','hello')).status,400);
  const malformed=await fetch(app.url+'/api/config',{method:'POST',headers:{'X-App-Token':bootstrap.token,'Content-Type':'application/json'},body:'{bad'});
  assert.equal(malformed.status,400);
  assert.equal((await fetch(app.url+'/package.json')).status,404);
  assert.equal((await fetch(app.url+'/api/unknown')).status,404);
});
test('history CSV quotes cells and neutralizes spreadsheet formulas',async t=>{
  const {store,app}=await setup(t);
  const record=await store.createRecord({id:'1001',url:'https://www.linkedin.com/jobs/view/1001/',title:'Engineer, Senior',company:'=1+1'},'submitted');
  await store.updateRecord(record.id,{reason:'Confirmed "sent"',attemptedAt:'2026-10-01T15:00:00Z'});
  const csv=await (await fetch(app.url+'/api/history.csv')).text();
  assert.ok(csv.includes('"Engineer, Senior"'));
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"Confirmed ""sent"""'));
});

test('pending operational blockers remain visible after their answer is saved',async t=>{
  const {store,app}=await setup(t);
  const blockers=[
    {key:'current city',label:'Current city',type:'unsupported',reason:'This control is not supported automatically'},
    {key:'agree',label:'Agree',type:'checkbox',reason:'The required checkbox needs an explicit yes answer'},
    {key:'email',label:'Email',type:'email',reason:'Could not enter the saved answer: Read-only value differs from your saved answer'},
    {key:'years',label:'Years',type:'number',reason:'No explicit saved answer',blocker:'missing_answer'}
  ].map(question=>({...question,jobId:'1001',options:[]}));
  await store.saveQuestions(blockers);
  await store.saveAnswers({'Current city':'Chicago',Agree:false,Email:'test@example.com',Years:0});
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.deepEqual(data.questions.map(question=>question.key),['current city','agree','email']);
  await store.saveQuestions([]);
  assert.equal((await (await fetch(app.url+'/api/bootstrap')).json()).questions.length,0);
});

test('saving an answer exposes its raw value for a retained radio blocker across restarts',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'job-applier-saved-blocker-'));
  const store=await createStore(dir);
  const runner={getStatus:()=>({state:'idle',message:'Ready',todayCount:0}),stop:async()=>{}};
  let app=await createApp({dataDir:dir,store,runner,port:0});await app.listen();
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const question={key:'evening work',label:'Are you available for evening work?',type:'radio',required:true,
    options:[{label:'Yes',value:'1'},{label:'No',value:'0'}],jobId:'3001',blocker:'operational',reason:'Could not select the saved option'};
  await store.saveQuestions([question]);
  const initial=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(Object.hasOwn(initial.questions[0],'savedAnswer'),false);
  const response=await fetch(app.url+'/api/answers',{method:'POST',headers:{'Content-Type':'application/json','X-App-Token':initial.token},
    body:JSON.stringify({'Are you available for evening work?':'No'})});
  assert.equal(response.status,200);
  const saved=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(saved.questions.length,1);
  assert.deepEqual(saved.questions[0].savedAnswer,{answer:'No',displayAnswer:'No',sourceQuestion:'are you available for evening work',match:'exact',source:'saved answer'});
  assert.equal(saved.questions[0].blocker,'operational');
  assert.equal(saved.questions[0].reason,'Could not select the saved option');
  assert.deepEqual(await store.getQuestions(),[question],'Display metadata does not modify the stored question');
  await app.close();
  app=await createApp({dataDir:dir,runner,port:0});await app.listen();
  const reloaded=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.deepEqual(reloaded.questions[0].savedAnswer,{answer:'No',displayAnswer:'No',sourceQuestion:'are you available for evening work',match:'exact',source:'saved answer'});
  assert.equal(reloaded.questions[0].reason,'Could not select the saved option');
  assert.deepEqual(reloaded.answers,{'are you available for evening work':'No'});
});

test('retained radio blockers display the resolved option label while preserving the raw saved answer',async t=>{
  const {store,app,send}=await setup(t);
  await store.saveQuestions([{key:'evening work',label:'Are you available for evening work?',type:'radio',required:true,
    options:[{label:'Yes',value:'on'},{label:'No',value:'off'}],blocker:'operational',reason:'Could not select the saved option'}]);
  assert.equal((await send('/api/answers',{'Are you available for evening work?':'Yes!'})).status,200);
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.deepEqual(data.questions[0].savedAnswer,{answer:'Yes!',displayAnswer:'Yes',sourceQuestion:'are you available for evening work',match:'exact',source:'saved answer'});
  assert.equal(data.answers['are you available for evening work'],'Yes!');
});

test('retained checkbox blockers display false for a saved zero string',async t=>{
  const {store,app,send}=await setup(t);
  await store.saveQuestions([{key:'agree',label:'Agree',type:'checkbox',required:true,options:[],
    blocker:'operational',reason:'The required checkbox needs an explicit yes answer'}]);
  assert.equal((await send('/api/answers',{Agree:'0'})).status,200);
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.deepEqual(data.questions[0].savedAnswer,{answer:'0',displayAnswer:false,sourceQuestion:'agree',match:'exact',source:'saved answer'});
  assert.equal(data.questions[0].reason,'The required checkbox needs an explicit yes answer');
  assert.equal(data.answers.agree,'0');
});

test('an incompatible saved radio answer remains a suggestion for an operational blocker',async t=>{
  const {store,app,send}=await setup(t);
  await store.saveQuestions([{key:'shift preference',label:'Shift preference',type:'radio',required:true,
    options:[{label:'Morning',value:'am'},{label:'Evening',value:'pm'}],blocker:'operational',reason:'Could not select the saved option'}]);
  assert.equal((await send('/api/answers',{'Shift preference':'Flexible'})).status,200);
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(data.questions.length,1);
  assert.equal(Object.hasOwn(data.questions[0],'savedAnswer'),false);
  assert.equal(data.questions[0].blocker,'operational');
  assert.equal(data.questions[0].reason,'Could not select the saved option');
  assert.ok(data.questions[0].suggestions.some(suggestion=>suggestion.question==='shift preference'&&suggestion.answer==='Flexible'));
});

test('answer memory prepares common questions from saved answers without inventing authorization or sponsorship',async t=>{
  const {store,app}=await setup(t);
  await store.saveAnswers({School:'University of Houston','Degree Type':"Bachelor's Degree",Major:'Computer Science/IT'});
  const before=await store.getAnswers();
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.ok(data.answerMemory,'Common questions are available before a job asks them');
  const questions=data.answerMemory.commonQuestions;
  assert.equal(questions.find(question=>question.key==='school').answer,'University of Houston');
  assert.equal(questions.find(question=>question.key==='degree type').answer,"Bachelor's Degree");
  for(const key of ['are you legally authorized to work in the united states','will you now or in the future require sponsorship to work in the united states']){
    const question=questions.find(question=>question.key===key);
    assert.equal(question.status,'unanswered');
    assert.equal(question.answer,undefined);
  }
  assert.deepEqual(await store.getAnswers(),before,'Viewing predictions never saves or fabricates answers');
});

test('bootstrap explains automatically reused answers and preserves operational blockers',async t=>{
  const {store,app}=await setup(t);
  await store.createRecord({id:'2001',title:'Intern',company:'Example Company'},'needs_answer');
  await store.saveAnswers({School:'University of Houston'});
  await store.saveQuestions([
    {key:'university name',label:'University name*',type:'text',required:true,options:[],jobId:'2001',blocker:'missing_answer'},
    {key:'school',label:'School',type:'unsupported',options:[],jobId:'2001',blocker:'operational',reason:'Unsupported control'}
  ]);
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.deepEqual(data.questions.map(question=>question.label),['School']);
  assert.deepEqual(data.answerMemory.reusedAnswers,[{label:'University name*',company:'Example Company',answer:'University of Houston',sourceQuestion:'school'}]);
  assert.equal(data.questions[0].company,'Example Company');
});

test('ambiguous graduation formats retain a reviewable prior answer',async t=>{
  const {store,app}=await setup(t);
  await store.saveAnswers({'Expected graduation':'Spring 2028'});
  await store.saveQuestions([{key:'expected graduation date mm yyyy',label:'Expected graduation date (MM/YYYY)*',type:'text',required:true,options:[],blocker:'missing_answer'}]);
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(data.questions.length,1);
  assert.equal(data.questions[0].answerKey,'expected graduation date mm yyyy');
  assert.ok(data.questions[0].suggestions?.some(suggestion=>suggestion.question==='expected graduation'&&suggestion.answer==='Spring 2028'));
});

test('answer memory retains recent successful reuse provenance after pending questions are cleared',async t=>{
  const {store,app}=await setup(t);
  await store.saveAnswers({school:'Example University'});
  const record=await store.createRecord({id:'2002',title:'Intern',company:'Example Company'},'ready');
  await store.updateRecord(record.id,{answerMatches:[{label:'University name',company:'Example Company',answer:'Example University',sourceQuestion:'school'}]});
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(data.questions.length,0);
  assert.deepEqual(data.answerMemory.reusedAnswers,[{label:'University name',company:'Example Company',answer:'Example University',sourceQuestion:'school'}]);
});

test('recognized future answers omit historical values whose saved source was deleted or changed',async t=>{
  const {store,app}=await setup(t);
  const record=await store.createRecord({id:'2003',title:'Intern',company:'Example'},'ready');
  await store.updateRecord(record.id,{answerMatches:[{label:'University name',company:'Example',answer:'University of Houston',sourceQuestion:'school'}]});
  await store.saveAnswers({school:'University of Houston'});
  assert.equal((await (await fetch(app.url+'/api/bootstrap')).json()).answerMemory.reusedAnswers.length,1);
  for(const answers of [{},{school:'Another University'}]){
    await store.saveAnswers(answers);
    const data=await (await fetch(app.url+'/api/bootstrap')).json();
    assert.deepEqual(data.answerMemory.reusedAnswers,[]);
    assert.equal((await store.getHistory())[0].answerMatches[0].answer,'University of Houston','History retains what was actually entered');
  }
});

test('SMS consent is reused only for the employer explicitly selected by the user',async t=>{
  const {store,app,send}=await setup(t);
  const label='If you provided a phone number, do you consent to receiving follow-up communication via text message (or SMS message) regarding your application status?';
  const key='if you provided a phone number do you consent to receiving follow up communication via text message or sms message regarding your application status';
  const options=[{label:'Yes',value:'1'},{label:'No',value:'0'}];
  for(const [id,company] of [['bge','BGE, Inc.'],['vilo','Vilo']])await store.createRecord({id,title:'Intern',company},'needs_answer');
  await store.saveQuestions(['bge','vilo'].map(jobId=>({key,label,type:'radio',required:true,options,jobId,blocker:'missing_answer'})));
  await store.saveAnswers({[label]:'Yes'});
  const initial=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(initial.questions.length,2,'Old unscoped consent requires review');
  assert.equal(initial.questions.find(question=>question.jobId==='bge').answerKey,'sms consent for bge inc');
  assert.ok(initial.questions.every(question=>question.suggestions.some(suggestion=>suggestion.answer==='Yes')));
  assert.equal((await send('/api/answers',{...initial.answers,'sms consent for bge inc':'No'})).status,200);
  const saved=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.deepEqual(saved.questions.map(question=>question.jobId),['vilo']);
  assert.equal(saved.answerMemory.smsAnswers['BGE, Inc.'],'No');
  assert.equal(saved.answerMemory.smsAnswers.Vilo,undefined);
  assert.deepEqual(new Set(saved.answerMemory.employers),new Set(['BGE, Inc.','Vilo']));
});

test('SMS consent with an unidentified employer directs the user to LinkedIn rather than a futile Save control',async t=>{
  const {store,app}=await setup(t);
  const label='Do you consent to text message updates about your application?';
  await store.saveQuestions([{label,key:'do you consent to text message updates about your application',type:'radio',required:true,company:'Company on LinkedIn',options:[{label:'Yes',value:'1'},{label:'No',value:'0'}],blocker:'missing_answer'}]);
  await store.saveAnswers({[label]:'Yes'});
  const data=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(data.questions.length,1);
  assert.equal(data.questions[0].type,'unsupported');
  assert.equal(data.questions[0].blocker,'operational');
  assert.equal(data.answerMemory.employers.includes('Company on LinkedIn'),false);
});

test('API normalizes bare profile URLs and invalid links leave saved settings intact',async t=>{
  const {app,send}=await setup(t);
  const response=await send('/api/config',{profile:{firstName:'Test',linkedinUrl:'www.linkedin.com/in/test-applicant',website:'portfolio.example/work'}});
  assert.equal(response.status,200);
  const previous=(await response.json()).config;
  assert.equal(previous.profile.linkedinUrl,'https://www.linkedin.com/in/test-applicant');
  assert.equal(previous.profile.website,'https://portfolio.example/work');
  const rejected=await send('/api/config',{...previous,profile:{...previous.profile,firstName:'Changed',website:'not a link'}});
  assert.equal(rejected.status,400);
  assert.match((await rejected.json()).error,/Website \/ portfolio/);
  const current=(await (await fetch(app.url+'/api/bootstrap')).json()).config;
  assert.deepEqual(current,previous);
});

test('resume uploads preserve legacy profile links without requiring a settings edit',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'job-applier-legacy-resume-'));
  await writeFile(join(dir,'config.json'),JSON.stringify({profile:{firstName:'Test',website:'old incomplete link'}}));
  const app=await createApp({dataDir:dir,runner:{getStatus:()=>({state:'idle',message:'Ready',todayCount:0}),stop:async()=>{}},port:0});
  await app.listen();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const previous=await (await fetch(app.url+'/api/bootstrap')).json();
  const response=await fetch(app.url+'/api/resume',{method:'POST',headers:{'X-App-Token':previous.token,'X-Filename':'fixture.pdf','Content-Type':'application/octet-stream'},body:'%PDF-fixture'});
  assert.equal(response.status,200);
  const current=await (await fetch(app.url+'/api/bootstrap')).json();
  assert.equal(current.config.profile.website,'old incomplete link');
  assert.equal(current.config.profile.firstName,'Test');
  assert.equal(current.config.resume.filename,'fixture.pdf');
});

test('résumé keyword recommendations read uploaded PDF and Word files without changing saved filters',async t=>{
  const {upload,send,store}=await setup(t);
  await send('/api/config',{profile:{firstName:'Unchanged'},search:{titles:['Intern'],includeKeywords:['manual keyword'],excludeKeywords:['Unpaid'],keywordMatch:'all'}});
  for(const filename of ['skills.pdf','skills.docx','skills.doc']){
    const bytes=await readFile(new URL(`./fixtures/resumes/${filename}`,import.meta.url));
    const uploaded=await (await upload(filename,bytes)).json();
    const previous=await store.getConfig();
    const response=await send('/api/resume/keywords',{path:'/etc/passwd'});
    assert.equal(response.status,200);
    const result=await response.json();
    assert.equal(result.resume.path,uploaded.resume.path);
    assert.equal(result.resume.filename,filename);
    assert.deepEqual(result.keywords,['C++','Excel','JavaScript','Node.js','Project management','Python','SQL']);
    assert.equal(Object.hasOwn(result,'text'),false);
    assert.deepEqual(await store.getConfig(),previous);
  }
});

test('résumé analysis explains missing, unreadable, and text-free documents without removing the upload',async t=>{
  const {upload,send,store}=await setup(t);
  const absent=await send('/api/resume/keywords');
  assert.equal(absent.status,400);
  assert.match((await absent.json()).error,/upload.*résumé/i);
  for(const filename of ['bad.pdf','bad.docx','bad.doc']){
    await upload(filename,'not-a-real-document');
    const invalid=await send('/api/resume/keywords');
    assert.equal(invalid.status,400);
    assert.match((await invalid.json()).error,/read|PDF|document/i);
    assert.equal((await store.getConfig()).resume.filename,filename);
  }
  await upload('blank.pdf',await readFile(new URL('./fixtures/resumes/blank.pdf',import.meta.url)));
  const blank=await send('/api/resume/keywords');
  assert.equal(blank.status,400);
  assert.match((await blank.json()).error,/selectable text|scanned|readable text/i);
  assert.equal((await store.getConfig()).resume.filename,'blank.pdf');
});

test('résumé keyword analysis requires the local app token and rejects cross-origin requests',async t=>{
  const {send}=await setup(t);
  assert.equal((await send('/api/resume/keywords',{}, {'X-App-Token':''})).status,403);
  assert.equal((await send('/api/resume/keywords',{}, {Origin:'https://evil.example'})).status,403);
});

test('résumé analysis rejects a small compressed Word file that expands beyond its reading limit',async t=>{
  const {upload,send,store}=await setup(t);
  const uploaded=await upload('expanded.docx',await readFile(new URL('./fixtures/resumes/expanded.docx',import.meta.url)));
  assert.equal(uploaded.status,200);
  const response=await send('/api/resume/keywords');
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/large file|simpler/i);
  assert.equal((await store.getConfig()).resume.filename,'expanded.docx');
});

test('résumé analysis rejects DOCX content renamed to legacy DOC before parsing and retains the upload',async t=>{
  const {upload,send,store}=await setup(t);
  const bytes=await readFile(new URL('./fixtures/resumes/expanded.docx',import.meta.url));
  const uploaded=await upload('expanded.doc',bytes);
  assert.equal(uploaded.status,200);
  const saved=(await uploaded.json()).resume;
  const response=await send('/api/resume/keywords');
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/DOC format|legacy Word/i);
  assert.deepEqual((await store.getConfig()).resume,saved);
  assert.deepEqual(await readFile(saved.path),bytes);
});
