import {resolveAnswer,blocksRetry} from './domain.mjs';
import {blockingDuplicate} from './job-duplicates.mjs';
import {makeBlocker,blockerPolicy} from './application-lifecycle.mjs';
const idOf=record=>String(record.job?.id??'');
const active=new Set(['queued','inspecting','filling']);
const attentionStates=new Set(['needs_answer','needs_attention','interrupted','failed','unconfirmed','submission_pending']);
const verified=record=>['ready','submitted'].includes(record?.status);
export const isMissingQuestion=q=>q.blocker==='missing_answer'||(!q.blocker&&(!q.reason||/^(No explicit saved answer|Saved answer is empty|Saved answer does not match|Checkbox needs|A numeric answer)/.test(q.reason)));
function latestJobs(history){return new Map(history.filter(r=>r.job?.id!=null).map(r=>[idOf(r),r]));}
const questionIdentity=q=>JSON.stringify([String(q.jobId??''),q.key,q.label,q.type,q.options||[],q.pattern||'',q.placeholder||'']);
export function projectQuestions(history,rawQuestions){
  const latest=latestJobs(history),known=new Set(history.filter(r=>r.lifecycleVersion===1).map(r=>r.id));
  const lineages=new Map();
  for(const record of history){
    if(record.lifecycleVersion!==1)continue;
    if(record.pendingQuestions?.length||verified(record))lineages.set(record.lineageId||record.id,record);
  }
  let result=rawQuestions.filter(q=>!known.has(q.recordId)&&!verified(latest.get(String(q.jobId??'')))).map(q=>structuredClone(q));
  for(const record of lineages.values()){
    if(verified(record)||verified(latest.get(idOf(record))))continue;
    for(const source of record.pendingQuestions||[]){
      const question={...structuredClone(source),jobId:idOf(record),recordId:record.id,lineageId:record.lineageId||record.id};
      const identity=questionIdentity(question);
      result=result.filter(old=>questionIdentity(old)!==identity);
      result.push(question);
    }
  }
  return result;
}
export function projectAttention(history,rawQuestions,{profile={},answers={}}={}){
  const questions=projectQuestions(history,rawQuestions),latest=latestJobs(history),groups=new Map();
  for(const q of questions){const id=String(q.jobId??'');const list=groups.get(id)||[];list.push(q);groups.set(id,list);}
  const uncertainRecords=new Map();
  for(const record of history){
    if(['submission_pending','unconfirmed'].includes(record.status))uncertainRecords.set(idOf(record),record);
    else if(record.status==='submitted')uncertainRecords.delete(idOf(record));
  }
  const ids=new Set([...latest.keys(),...groups.keys()]),items=[];
  for(const id of ids){
    const record=uncertainRecords.get(id)||latest.get(id),pending=groups.get(id)||[];
    if(!pending.length&&!attentionStates.has(record?.status))continue;
    if(verified(record))continue;
    const job=record?.job||{id,title:'Job details unavailable',company:''};
    const duplicate=record&&blockingDuplicate(job,history);
    const processing=history.some(r=>idOf(r)===id&&r.lifecycleVersion===1&&active.has(r.status));
    const resolutions=pending.map(q=>resolveAnswer({...q,company:q.company||job.company||''},profile,answers));
    const manual=pending.some((q,i)=>q.type==='unsupported'||resolutions[i].manual||(q.type==='checkbox'&&q.required&&resolutions[i].kind==='fill'&&resolutions[i].value===false));
    const missing=pending.some((q,i)=>isMissingQuestion(q)&&resolutions[i].kind!=='fill');
    const operational=pending.some(q=>!isMissingQuestion(q));
    let blockers=record?.blockers?.length?record.blockers.map(b=>makeBlocker(b.code,b)):[];
    if(!blockers.length)blockers=[makeBlocker(pending.length?(manual?'unsupported_control':operational?'entry_verification':'missing_answer'):record?.status==='interrupted'?'navigation':'unknown',{phase:record?.phase})];
    const uncertain=Boolean(record&&blocksRetry(record))||Boolean(duplicate);
    if(uncertain)blockers=[makeBlocker('submission_uncertain',{phase:record?.phase}),...blockers.filter(b=>b.code!=='submission_uncertain')];
    const unsafe=manual||blockers.some(b=>blockerPolicy(b.code).manual);
    const singleRetry=Boolean(record&&/^\d+$/.test(id)&&!uncertain&&!processing&&!unsafe&&!missing);
    const readyForBatch=singleRetry&&!operational&&(pending.length>0?blockers.every(b=>b.code==='missing_answer'):record.status==='interrupted'&&blockers.every(b=>b.code==='navigation'));
    const retryReason=uncertain?'A submitted or uncertain attempt exists. Check LinkedIn.':processing?'This application is already queued or being processed.':unsafe?'Complete this control directly in LinkedIn.':missing?'Save the missing required answers first.':!record?'Job details are unavailable; targeted retry is not possible.':!pending.length&&record.status!=='interrupted'?'Earlier blocker details are unknown; retry to inspect.':readyForBatch?'Ready for an explicit retry.':'Retry this application to check its form again.';
    items.push({recordId:record?.id||null,revision:record?.revision||0,job:structuredClone(job),phase:record?.phase||'unknown',status:record?.status||'needs_attention',blockers,questions:pending,answerProgress:{answered:resolutions.filter(r=>r.kind==='fill').length,unanswered:resolutions.filter(r=>r.kind!=='fill').length,manual:unsafe},singleRetry,readyForBatch,retryReason,updatedAt:record?.updatedAt||record?.finishedAt||record?.startedAt||null});
  }
  return items;
}
