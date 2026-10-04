import {createServer} from 'node:http';
import {mkdir,readFile,open} from 'node:fs/promises';
import {resolve,dirname,basename,extname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {createStore} from './store.mjs';
import {createRunner} from './runner.mjs';
import {createLinkedInAdapter} from './browser/linkedin.mjs';
import {MAX_RESUME_BYTES,readiness,dayKey,countsTowardCap,resolveAnswer} from './domain.mjs';
import {commonQuestions,savedAnswerKey,normalizeQuestion} from './answer-memory.mjs';
import {analyzeResume} from './resume-analysis.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function failure(message,status=400){return Object.assign(new Error(message),{status});}
function readBody(req,limit){
  return new Promise((resolveBody,reject)=>{
    const length=Number(req.headers['content-length']);
    if(Number.isFinite(length)&&length>limit){req.resume();reject(failure('Upload or request is too large',413));return;}
    let size=0,failed=false;const chunks=[];
    req.on('data',chunk=>{size+=chunk.length;if(size>limit){if(!failed){failed=true;chunks.length=0;reject(failure('Upload or request is too large',413));}}else if(!failed)chunks.push(chunk);});
    req.on('end',()=>{if(!failed)resolveBody(Buffer.concat(chunks));});
    req.on('error',reject);req.on('aborted',()=>reject(failure('Request interrupted')));
  });
}
async function readJson(req){
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw failure('Use application/json',415);
  const body=await readBody(req,1_000_000);
  try{return body.length?JSON.parse(body.toString('utf8')):{};}catch{throw failure('Invalid JSON request');}
}
function csvCell(value){
  let text=String(value??'');
  if(/^\s*[=+\-@]/.test(text)||/^[\t\r]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export async function createApp({dataDir=resolve(root,'data'),store,runner,port=3210}={}){
  store ||= await createStore(dataDir);
  try{await store.recoverPending();}catch(error){await store.close();throw error;}
  runner ||= createRunner({store,adapter:createLinkedInAdapter({dataDir})});
  const token=randomBytes(32).toString('hex');let actualPort=port,recommendations=null;
  async function status(){
    const config=await store.getConfig(),history=await store.getHistory();
    const today=history.filter(record=>countsTowardCap(record,dayKey(new Date(),config.timezone),config.timezone));
    return {...runner.getStatus(),todayCount:today.length,confirmedToday:today.filter(record=>record.status==='submitted').length};
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; connect-src 'self'");
    const send=(body,code=200)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
    try{
      const allowed=new Set([`127.0.0.1:${actualPort}`,`localhost:${actualPort}`]);
      if(!allowed.has(req.headers.host))throw failure('Only local app requests are allowed',403);
      if(req.headers.origin && ![`http://127.0.0.1:${actualPort}`,`http://localhost:${actualPort}`].includes(req.headers.origin))throw failure('Cross-origin requests are not allowed',403);
      if(req.method!=='GET'){
        const supplied=Buffer.from(String(req.headers['x-app-token']||'')),expected=Buffer.from(token);
        if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))throw failure('Invalid app command token. Refresh the dashboard.',403);
      }
      const path=new URL(req.url,`http://127.0.0.1:${actualPort}`).pathname;
      if(req.method==='GET' && path==='/api/bootstrap'){
        const config=await store.getConfig(),answers=await store.getAnswers(),history=await store.getHistory();
        const pending=await store.getQuestions(),questions=[],reusedAnswers=history.slice(-30).flatMap(record=>Array.isArray(record.answerMatches)?record.answerMatches:[])
          .filter(match=>Object.hasOwn(answers,match.sourceQuestion)&&Object.is(answers[match.sourceQuestion],match.answer));
        const jobs=new Map(history.map(record=>[record.job.id,record.job]));
        for(const original of pending){
          const question={...original,company:original.company||jobs.get(original.jobId)?.company||''};
          question.answerKey=savedAnswerKey(question);
          const resolution=resolveAnswer(question,config.profile,answers);
          question.suggestions=resolution.suggestions||[];
          if(resolution.kind==='fill')question.savedAnswer={answer:resolution.answer,displayAnswer:resolution.optionLabel??resolution.value,sourceQuestion:resolution.sourceQuestion,match:resolution.match,source:resolution.source};
          if(resolution.manual){question.type='unsupported';question.blocker='operational';question.reason=resolution.reason;}
          // Saving an answer only resolves missing information. Entry/verification
          // failures remain pending until a later successful application clears them.
          const missing=question.blocker==='missing_answer' || (!question.blocker && (!question.reason || /^(No explicit saved answer|Saved answer is empty|Saved answer does not match|Checkbox needs|A numeric answer)/.test(question.reason)));
          if(!missing||resolution.kind==='missing'){
            if(missing)question.reason=resolution.reason;
            questions.push(question);
          }else if(resolution.match!=='profile'&&resolution.sourceQuestion!==normalizeQuestion(question.label)){
            reusedAnswers.push({label:question.label,company:question.company,answer:resolution.answer,sourceQuestion:resolution.sourceQuestion});
          }
        }
        const employers=[...new Set([...history.slice().reverse().map(record=>record.job.company),...pending.map(question=>question.company)].filter(company=>typeof company==='string'&&company.trim()&&company!=='Company on LinkedIn'))];
        const smsAnswers=Object.fromEntries(employers.flatMap(company=>{
          const key=`sms consent for ${normalizeQuestion(company)}`;
          return Object.hasOwn(answers,key)?[[company,answers[key]]]:[];
        }));
        const prepared=commonQuestions.map(question=>{
          const resolution=resolveAnswer(question,config.profile,answers);
          return {...question,status:resolution.kind==='fill'?'saved':resolution.suggestions?.length?'review':'unanswered',
            ...(resolution.kind==='fill'?{answer:resolution.answer,sourceQuestion:resolution.sourceQuestion}:{}),suggestions:resolution.suggestions||[]};
        });
        const uniqueReuse=new Map(reusedAnswers.map(match=>[`${match.company}:${match.label}`,match]));
        const answerMemory={commonQuestions:prepared,employers,smsAnswers,reusedAnswers:[...uniqueReuse.values()].slice(-40)};
        send({config,answers,questions,answerMemory,history:history.slice(-200).reverse(),status:await status(),readiness:readiness(config),token});return;
      }
      if(req.method==='GET' && path==='/api/status'){send(await status());return;}
      if(req.method==='GET' && path==='/api/history.csv'){
        const rows=[['Company','Job title','LinkedIn URL','Status','Attempted at','Finished at','Reason']];
        for(const record of await store.getHistory())rows.push([record.job.company,record.job.title,record.job.url,record.status,record.attemptedAt,record.finishedAt,record.reason]);
        res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="applications.csv"'});
        res.end('\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'));return;
      }
      if(req.method==='POST' && path==='/api/resume'){
        let name;try{name=decodeURIComponent(req.headers['x-filename']||'');}catch{throw failure('Invalid résumé filename');}
        name=basename(name).replace(/[^\p{L}\p{N} ._-]/gu,'_').slice(0,200);
        if(!/\.(pdf|doc|docx)$/i.test(name))throw failure('Résumé must be PDF, DOC, or DOCX');
        const body=await readBody(req,MAX_RESUME_BYTES);if(!body.length)throw failure('Résumé is empty');
        const directory=join(dataDir,'resumes',randomUUID());await mkdir(directory,{recursive:true,mode:0o700});
        const path=join(directory,name),file=await open(path,'wx',0o600);
        try{await file.writeFile(body);await file.sync();}finally{await file.close();}
        const resume={path,filename:name,size:body.length};
        await store.saveResume(resume);send({resume});return;
      }
      if(req.method==='POST' && path==='/api/resume/keywords'){
        await readJson(req);
        const {resume}=await store.getConfig();
        if(!resume)throw failure('Upload a résumé first to get recommended keywords.');
        if(recommendations?.path!==resume.path){
          if(recommendations?.pending)throw failure('The previous résumé is still being read. Try again in a few seconds.',429);
          const current={path:resume.path,pending:true};recommendations=current;
          current.promise=analyzeResume(resume).then(keywords=>({resume,keywords})).finally(()=>{current.pending=false;});
          current.promise.catch(()=>{if(recommendations===current)recommendations=null;});
        }
        send(await recommendations.promise);return;
      }
      if(req.method==='POST' && path==='/api/config'){
        const input=await readJson(req);if(!input||typeof input!=='object'||Array.isArray(input))throw failure('Settings must be an object');
        const previous=await store.getConfig();send({config:await store.saveConfig({...input,resume:previous.resume})});return;
      }
      if(req.method==='POST' && path==='/api/answers'){send({answers:await store.saveAnswers(await readJson(req))});return;}
      if(req.method==='POST' && path==='/api/run'){await runner.start(await readJson(req));send(await status());return;}
      if(req.method==='POST' && path==='/api/stop'){await readJson(req);await runner.stop();send(await status());return;}
      if(req.method==='POST' && path==='/api/browser'){await readJson(req);await runner.openBrowser();send(await status());return;}
      const staticFiles={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/locations.js':'locations.js','/styles.css':'styles.css'};
      if(req.method==='GET' && Object.hasOwn(staticFiles,path)){
        const file=join(root,'public',staticFiles[path]);
        const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
        res.writeHead(200,{'Content-Type':`${types[extname(file)]}; charset=utf-8`});res.end(await readFile(file));return;
      }
      throw failure('Not found',404);
    }catch(error){if(!res.headersSent)send({error:error.message},error.status||400);else res.end();}
  });
  server.requestTimeout=20000;
  return {
    get url(){return `http://127.0.0.1:${actualPort}`;},
    listen(){return new Promise((resolveListen,reject)=>{
      const fail=error=>{server.off('listening',ready);store.close().then(()=>reject(error),reject);};
      const ready=()=>{server.off('error',fail);actualPort=server.address().port;resolveListen();};
      server.once('error',fail);server.once('listening',ready);server.listen(port,'127.0.0.1');
    });},
    async close(){
      const closing=server.listening?new Promise(resolveClose=>server.close(resolveClose)):Promise.resolve();
      try{await runner.stop();await closing;}finally{await store.close();}
    }
  };
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const app=await createApp({dataDir:process.env.JOB_APPLIER_DATA_DIR||resolve(root,'data'),port:Number(process.env.JOB_APPLIER_PORT||3210)});
    await app.listen();console.log(`Job Applier is running at ${app.url}`);
    console.log('Open the dashboard to upload your résumé, set job filters, and sign in to LinkedIn.');
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
  }catch(error){console.error(`Job Applier could not start: ${error.message}`);process.exitCode=1;}
}
