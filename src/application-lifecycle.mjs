const summaries={
  missing_answer:'An explicit answer is needed.',unsupported_control:'Complete this control in LinkedIn.',
  entry_timeout:'Answer entry timed out.',entry_verification:'The saved answer was not retained.',
  validation:'The form still has validation errors.',resume_upload:'The selected résumé could not be verified.',
  form_changed:'The application form changed or did not stabilize.',navigation:'The job or application page could not be read.',
  network:'A temporary connection error interrupted this job.',job_expired:'The job is no longer available.',
  already_applied:'LinkedIn shows this job as already applied.',external_redirect:'This application requires another website.',
  login_required:'Sign in to LinkedIn before retrying.',verification_challenge:'Complete LinkedIn verification before retrying.',
  platform_limit:'LinkedIn reported an application or speed limit.',cleanup_failed:'The previous application could not be closed safely.',
  browser_unavailable:'The application browser is unavailable.',storage:'Application progress could not be saved.',
  submission_uncertain:'Submission is uncertain. Check this job in LinkedIn.',unknown:'Earlier blocker details are unknown; retry to inspect.'
};
const globals=new Set(['login_required','verification_challenge','platform_limit','cleanup_failed','browser_unavailable','storage','unknown']);
const terminal=new Set(['job_expired','already_applied']);
export const workPhases=new Set(['discovery','inspection','form','review','submission','confirmation','cleanup','unknown']);
export function makeBlocker(code,{phase='unknown',controlFingerprint=null}={}){
  if(!Object.hasOwn(summaries,code))code='unknown';
  return {code,phase:workPhases.has(phase)?phase:'unknown',summary:summaries[code],...(/^[a-f0-9]{64}$/.test(controlFingerprint||'')?{controlFingerprint}:{})};
}
export function blockerPolicy(code){
  if(!Object.hasOwn(summaries,code))code='unknown';
  return {scope:globals.has(code)?'global':terminal.has(code)?'terminal':code==='submission_uncertain'?'uncertain':'local',manual:code==='unsupported_control'||code==='external_redirect',automaticRetry:code==='network'?'navigation':'none'};
}
export class ApplicationFailure extends Error{
  constructor(code,message,details={}){super(message||makeBlocker(code).summary);this.name='ApplicationFailure';this.blocker=makeBlocker(code,details);}
}
const transitions={queued:['inspecting','interrupted','skipped','failed','needs_attention'],inspecting:['filling','interrupted','skipped','failed','needs_attention'],filling:['ready','submission_pending','needs_answer','needs_attention','failed','skipped','interrupted'],submission_pending:['submitted','unconfirmed']};
export function canTransition(record,nextStatus){
  if(['submission_pending','submitted','unconfirmed'].includes(record.status)||record.attemptedAt){
    if(nextStatus===record.status)return true;
    return record.status==='submission_pending'&&['submitted','unconfirmed'].includes(nextStatus);
  }
  return nextStatus===record.status || Boolean(transitions[record.status]?.includes(nextStatus));
}
