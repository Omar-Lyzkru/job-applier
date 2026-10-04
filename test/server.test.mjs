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
