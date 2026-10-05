import test from 'node:test';
import assert from 'node:assert/strict';
import {makeBlocker,blockerPolicy,canTransition,ApplicationFailure} from '../src/application-lifecycle.mjs';
import {projectAttention,projectQuestions} from '../src/attention-queue.mjs';
import {statuses} from '../src/domain.mjs';
const job=(id='1001',patch={})=>({id,title:'Intern',company:'Example',url:'https://www.linkedin.com/jobs/view/'+id+'/',...patch});
const record=(id,status='needs_answer',patch={})=>({id,job:job(),status,attemptedAt:null,startedAt:'2026-10-04T12:00:00Z',...patch});
const question=(patch={})=>({jobId:'1001',key:'relocate',label:'Relocate?',type:'radio',required:true,options:[{label:'Yes',value:'on'},{label:'No',value:'on'}],blocker:'missing_answer',reason:'No explicit saved answer',...patch});

test('work can advance through inspection and filling but terminal work needs a new retry record',()=>{
  assert.equal(statuses.has('queued'),true);
  assert.equal(canTransition(record('a','queued'),'inspecting'),true);
  assert.equal(canTransition(record('a','inspecting'),'filling'),true);
  assert.equal(canTransition(record('a','filling'),'submission_pending'),true);
  for(const status of ['needs_answer','needs_attention','interrupted','ready','failed','skipped'])assert.equal(canTransition(record('a',status),'filling'),false);
  for(const status of ['submission_pending','submitted','unconfirmed']){
    assert.equal(canTransition(record('a',status,{attemptedAt:'2026-10-04T12:00:01Z'}),'queued'),false);
    assert.equal(canTransition(record('a',status,{attemptedAt:'2026-10-04T12:00:01Z'}),'failed'),false);
  }
  assert.equal(canTransition(record('a','submission_pending',{attemptedAt:'2026-10-04T12:00:01Z'}),'unconfirmed'),true);
});

test('blocker decisions distinguish scoped continuation, manual controls and reservation uncertainty',()=>{
  for(const code of ['missing_answer','entry_timeout','entry_verification','validation','resume_upload','form_changed','navigation','external_redirect'])assert.equal(blockerPolicy(code).scope,'local');
  for(const code of ['login_required','verification_challenge','platform_limit','cleanup_failed','browser_unavailable','storage','unknown'])assert.equal(blockerPolicy(code).scope,'global');
  for(const code of ['job_expired','already_applied'])assert.equal(blockerPolicy(code).scope,'terminal');
  assert.equal(blockerPolicy('unsupported_control').manual,true);
  assert.equal(blockerPolicy('missing_answer').manual,false);
  assert.equal(blockerPolicy('network').automaticRetry,'navigation');
  assert.equal(blockerPolicy('submission_uncertain').scope,'uncertain');
  assert.equal(blockerPolicy('anything unrecognized').automaticRetry,'none');
  const error=new ApplicationFailure('entry_timeout','Could not enter answer',{phase:'form',controlFingerprint:'a'.repeat(64)});
  assert.equal(error.blocker.code,'entry_timeout');
  assert.equal(error.blocker.phase,'form');
  assert.equal(makeBlocker('invalid').code,'unknown');
});

test('one compatible explicit No or zero makes missing-information work ready without starting it',()=>{
  for(const [q,answers] of [[question(),{relocate:false}],[question({key:'years',label:'Years?',type:'number',options:[]}),{years:0}]]){
    const items=projectAttention([record('a')],[q],{answers});
    assert.equal(items.length,1);assert.equal(items[0].singleRetry,true);assert.equal(items[0].readyForBatch,true);
    assert.equal(items[0].recordId,'a');
  }
  assert.equal(projectAttention([record('a')],[question()],{})[0].singleRetry,false);
});

test('operational and unknown legacy reasons are not erased by saving a matching answer',()=>{
  for(const q of [question({blocker:'operational',reason:'Could not enter saved answer'}),question({blocker:undefined,reason:'Unexpected employer problem'})]){
    const items=projectAttention([record('a')],[q],{answers:{relocate:false}});
    assert.equal(items[0].readyForBatch,false);assert.equal(items[0].singleRetry,true);
    assert.equal(projectQuestions([record('a')],[q]).length,1);
  }
  const manual=question({type:'unsupported',blocker:'operational'});
  assert.equal(projectAttention([record('a')],[manual],{})[0].singleRetry,false);
  const refused=question({type:'checkbox',options:[],blocker:'operational',reason:'The required checkbox needs an explicit yes answer'});
  assert.equal(projectAttention([record('a')],[refused],{answers:{relocate:false}})[0].readyForBatch,false);
});

test('legacy missing details and orphan questions remain visible rather than assumed resolved',()=>{
  assert.equal(projectAttention([record('a')],[],{})[0].readyForBatch,false);
  assert.match(projectAttention([record('a')],[],{})[0].retryReason,/details|unknown|inspect/i);
  const orphan=question({jobId:'',label:'Unknown job question'});
  assert.equal(projectQuestions([], [orphan]).length,1);
  const item=projectAttention([], [orphan],{})[0];assert.equal(item.recordId,null);assert.equal(item.singleRetry,false);
});

test('only later verified exact-job outcomes retire prior questions; array order resolves same-time records',()=>{
  const q=question(),old=record('a'),ready=record('b','ready'),failed=record('c','failed');
  assert.deepEqual(projectQuestions([old,ready],[q]),[]);
  assert.deepEqual(projectAttention([old,ready],[q],{}),[]);
  assert.equal(projectQuestions([ready,failed],[q]).length,1);
  assert.equal(projectAttention([ready,failed],[q],{}).length,1);
  for(const status of ['skipped','failed','unconfirmed'])assert.equal(projectQuestions([old,record('b',status)],[q]).length,1);
  const other=record('b','submitted',{job:job('1002',{fingerprint:'shared'})});
  assert.equal(projectQuestions([old,other],[q]).length,1);
});

test('canonical pending questions survive a lost projection write and keep their source record',()=>{
  const canonical=record('a','needs_answer',{lifecycleVersion:1,lineageId:'a',revision:3,phase:'form',pendingQuestions:[question()],blockers:[makeBlocker('missing_answer',{phase:'form'})]});
  const result=projectQuestions([canonical],[]);
  assert.equal(result.length,1);assert.equal(result[0].label,'Relocate?');assert.equal(result[0].recordId,'a');assert.equal(result[0].lineageId,'a');
  assert.equal(projectAttention([canonical],[],{answers:{relocate:false}})[0].readyForBatch,true);
  assert.equal(projectQuestions([canonical,record('b','submitted',{lifecycleVersion:1,lineageId:'a',pendingQuestions:[],attemptedAt:'2026-10-04T12:01:00Z'})],result).length,0);
});

test('a current linked blocker replaces canonical questions while unrelated raw provenance is preserved',()=>{
  const old=record('a','needs_answer',{lifecycleVersion:1,lineageId:'a',pendingQuestions:[question()]});
  const next=record('b','needs_answer',{lifecycleVersion:1,lineageId:'a',retryOf:'a',pendingQuestions:[question({key:'school',label:'School?',type:'text',options:[]})]});
  const unrelated=question({jobId:'1002'});
  const projected=projectQuestions([old,next],[{...question(),recordId:'a',lineageId:'a'},unrelated,unrelated]);
  assert.equal(projected.filter(q=>q.jobId==='1001').length,1);
  assert.equal(projected.find(q=>q.jobId==='1001').label,'School?');
  assert.equal(projected.filter(q=>q.jobId==='1002').length,2);
});

test('attempted same-ID and strong-equivalent history override all retry actions without erasing questions',()=>{
  for(const attempted of [record('b','failed',{attemptedAt:'2026-10-04T12:01:00Z'}),record('b','submitted',{job:job('1002',{fingerprint:'shared'}),attemptedAt:'2026-10-04T12:01:00Z'})]){
    const old=record('a','needs_answer',{job:job('1001',{fingerprint:'shared'})});
    const items=projectAttention([old,attempted],[question()],{answers:{relocate:false}});
    assert.ok(items.length);assert.equal(items.every(item=>!item.singleRetry&&!item.readyForBatch),true);
  }
});

test('attention uses full history and active children prevent a second claim',()=>{
  const history=[record('a'),...Array.from({length:201},(_,i)=>record('x'+i,'skipped',{job:job(String(2000+i))}))];
  assert.equal(projectAttention(history,[question()],{answers:{relocate:false}})[0].recordId,'a');
  const active=record('b','filling',{lifecycleVersion:1,lineageId:'a',retryOf:'a',revision:1});
  const item=projectAttention([record('a'),active],[question()],{answers:{relocate:false}})[0];
  assert.equal(item.singleRetry,false);assert.equal(item.readyForBatch,false);
});
