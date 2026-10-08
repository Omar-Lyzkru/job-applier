import {bankCandidates,describeBankQuestion} from './answer-bank.mjs';
export function normalizeQuestion(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

const yesNo=[{label:'Yes',value:'Yes'},{label:'No',value:'No'}];
export const commonQuestions=[
  {key:'are you currently a student',label:'Are you currently a student?',type:'radio',options:yesNo},
  {key:'school',label:'School',type:'text'},
  {key:'degree type',label:'Degree type',type:'text',help:'The degree for your current studies; this is separate from your highest completed degree.'},
  {key:'major',label:'Major',type:'text'},
  {key:'expected graduation',label:'Expected graduation',type:'text',help:'Use the term and year you expect to graduate. A request for a numeric date will need your review.'},
  {key:'desired position type',label:'Desired position type',type:'text'},
  {key:'location preference',label:'Location preference',type:'text'},
  {key:'department preference',label:'Department preference',type:'text'},
  {key:'street address',label:'Street address',type:'text'},
  {key:'are you legally authorized to work in the united states',label:'Are you legally authorized to work in the United States?',type:'radio',options:yesNo},
  {key:'will you now or in the future require sponsorship to work in the united states',label:'Will you now or in the future require sponsorship to work in the United States?',type:'radio',options:yesNo,
    help:'This asks about both now and the future, including after graduation. It is separate from work authorization.'}
];

const sensitiveTerms=/\b(?:authorized|authorization|sponsor\w*|citizen\w*|visa|legally|legal|consent|sms|salary|pay|compensation|certif\w*|clearance|identity)\b/;

export function describeQuestion(field){
  const screening=describeScreening(field),intent=screening.intent;
  const company=knownCompany(field.company),sms=intent==='sms';
  const scope=sms?(company?{kind:'company',company}:{kind:'job',jobId:String(field.jobId||'unknown')}):{kind:'global'};
  if(screening.qualifiers.skill)Object.assign(scope,{skill:screening.qualifiers.skill,experience:screening.qualifiers.experienceKind});
  return {intent,answerKey:savedAnswerKey(field),scope,controlType:field.type||'text',
    reviewPolicy:screening.matchPolicy==='manual_only'?'manual':intent?'known':'review',
    risk:screening.reasonCode==='ambiguous_legacy_identity'?'ambiguous_identity':sms||sensitiveTerms.test(normalizeQuestion(field.label))?'sensitive':'ordinary',screening};
}

function isSmsQuestion(key) {
  return /^sms consent for .+/.test(key) || /\b(?:text messages?|sms messages?|sms)\b/.test(key);
}
function knownCompany(company) {
  const key=normalizeQuestion(company||'');
  return key&&!['company on linkedin','unknown','unknown company','company','not available','n a'].includes(key)?key:'';
}
function positiveApplicationSms(key,company) {
  if(company&&key===`sms consent for ${company}`)return true;
  return /^(?:if you provided a phone number )?do you consent to receiving follow up communication via text message or sms message regarding your application status$/.test(key) ||
    /^(?:do you (?:consent|agree) to|may we) (?:receive|receiving|send you) (?:text|sms) messages? (?:about|regarding) your application(?: status)?$/.test(key) ||
    /^do you consent to (?:receive |receiving )?text message updates about your application(?: status)?$/.test(key);
}
export function savedAnswerKey(field) {
  const key=normalizeQuestion(field.label);
  const company=knownCompany(field.company);
  if(!company||!isSmsQuestion(key))return key;
  return `sms consent for ${company}${positiveApplicationSms(key,company)?'':` question ${key}`}`;
}

const classify=label=>describeScreening({label}).intent;

function nonempty(value) {
  return value!==undefined&&value!==null&&String(value).trim()!=='';
}
function suggestion(question,answer,reason) {return {question,answer,reason};}
function answerMeaning(value,intent) {
  const key=normalizeQuestion(value);
  if(['us-authorization','us-sponsorship-now-future','us-sponsorship-now','us-sponsorship-future','current-student'].includes(intent)){
    if(value===true||['yes','true','1','agree','i agree'].includes(key))return 'yes';
    if(value===false||['no','false','0','disagree'].includes(key))return 'no';
  }
  if(isYearsIntent(intent)&&scalarYears(value))return String(Number(value));
  return String(value).normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
}
function graduationFormatCompatible(field,value) {
  const answer=String(value).trim(),hint=`${field.label} ${field.placeholder||''}`;
  if(field.pattern){
    try{if(!new RegExp(`^(?:${field.pattern})$`,'v').test(answer))return false;}catch{return false;}
  }
  if(field.type==='date'){
    const parsed=/^(\d{4})-(\d{2})-(\d{2})$/.exec(answer);
    if(!parsed)return false;
    const date=new Date(`${answer}T00:00:00Z`);
    return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===answer;
  }
  const format=hint.match(/\b(yyyy|year|mm|month|dd|day)(\s*[/.-]\s*|\s+)(yyyy|year|mm|month|dd|day)(?:\2(yyyy|year|mm|month|dd|day))?\b/i);
  if(format){
    const units=[format[1],format[3],format[4]].filter(Boolean).map(unit=>unit.toLowerCase());
    const separator=format[2].trim(),parts=separator?answer.split(separator):answer.split(/\s+/);
    if(parts.length!==units.length)return false;
    const values={};
    for(let i=0;i<units.length;i++){
      const unit=units[i],part=parts[i].trim(),kind=/^(?:yyyy|year)$/.test(unit)?'year':/^(?:mm|month)$/.test(unit)?'month':'day';
      if(values[kind]!==undefined)return false;
      if(unit==='month'){
        const names=['january','february','march','april','may','june','july','august','september','october','november','december'];
        values.month=names.findIndex(name=>[name,name.slice(0,3)].includes(part.toLowerCase()))+1;
      }else{
        if(!(kind==='year'?/^\d{4}$/:/^\d{2}$/).test(part))return false;
        values[kind]=Number(part);
      }
    }
    if(values.year===undefined||values.month===undefined||values.month<1||values.month>12)return false;
    if(values.day!==undefined){
      if(values.day<1||values.day>31)return false;
      const iso=`${String(values.year).padStart(4,'0')}-${String(values.month).padStart(2,'0')}-${String(values.day).padStart(2,'0')}`;
      const date=new Date(`${iso}T00:00:00Z`);
      return Number.isFinite(date.valueOf())&&date.toISOString().slice(0,10)===iso;
    }
  }
  return true;
}
const ignoredWords=new Set(['a','an','the','to','of','in','on','for','and','or','do','does','you','your','we','us','our','are','is','have','has','what','which','how','tell','describe','about','please']);
function tokens(key) {return new Set(key.split(' ').filter(word=>word.length>1&&!ignoredWords.has(word)));}
function genericSuggestions(key,entries) {
  const excluded=question=>sensitiveTerms.test(question)||/\b(?:years?|experience|degree|graduat\w*|location|address|school|university|major|student)\b/.test(question);
  if(excluded(key))return [];
  const wanted=tokens(key);
  return entries.filter(([question])=>!classify(question)&&!excluded(question))
    .map(([question,answer])=>{
      const available=tokens(question),shared=[...wanted].filter(word=>available.has(word)).length;
      return {question,answer,shared,score:2*shared/(wanted.size+available.size)};
    }).filter(item=>item.shared>=2&&item.score>=0.6)
    .sort((a,b)=>b.score-a.score||a.question.localeCompare(b.question)).slice(0,3)
    .map(item=>suggestion(item.question,item.answer,'Similar wording; confirm that the meaning is the same'));
}

function scalarYears(value){
  return (typeof value==='number'||typeof value==='string'&&/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))&&Number.isFinite(Number(value))&&Number(value)>=0;
}
const isYearsIntent=intent=>intent?.startsWith('skill-years:')||intent?.startsWith('experience-years:');
function validYearsAnswer(field,intent,value){return !isYearsIntent(intent)||['select','radio'].includes(field.type)||scalarYears(value);}

// Equivalence is deliberately limited to known wording. Token similarity can only suggest.
function findLegacySavedAnswer(field,answers) {
  const description=describeQuestion(field),key=normalizeQuestion(field.label),intent=description.intent;
  if(description.risk==='ambiguous_identity')return {kind:'missing',manual:true,reason:'C, C++ and C# saved keys may overlap. Confirm this experience directly in LinkedIn.'};
  const entries=Object.entries(answers).filter(([,value])=>nonempty(value));
  if(intent==='sms'){
    if(!knownCompany(field.company))return {kind:'missing',manual:true,reason:'The employer could not be identified. Complete SMS consent directly in LinkedIn.'};
    const scoped=savedAnswerKey(field);
    if(Object.hasOwn(answers,scoped))return {answer:answers[scoped],sourceQuestion:scoped,match:'exact'};
    const suggestions=entries.filter(([question])=>classify(question)==='sms'&&!question.startsWith('sms consent for '))
      .slice(0,3).map(([question,answer])=>suggestion(question,answer,'Consent must be confirmed for this employer'));
    return {kind:'missing',reason:'Confirm SMS consent for this employer',...(suggestions.length?{suggestions}:{})};
  }
  if(Object.hasOwn(answers,key)){
    if(!validYearsAnswer(field,intent,answers[key]))return {kind:'missing',reason:'Enter a nonnegative number of years for this skill'};
    if(intent==='graduation'&&!graduationFormatCompatible(field,answers[key]))return {kind:'missing',reason:'Confirm the requested graduation date format',suggestions:[suggestion(key,answers[key],'Saved graduation answer uses a different date format')]};
    return {answer:answers[key],sourceQuestion:key,match:'exact'};
  }
  const candidates=intent?entries.filter(([question])=>classify(question)===intent):[];
  if(candidates.length){
    const suggestions=candidates.slice(0,3).map(([question,answer])=>suggestion(question,answer,'Same known question meaning'));
    if(new Set(candidates.map(([,answer])=>answerMeaning(answer,intent))).size!==1)return {kind:'missing',reason:'Conflicting saved answers need review',suggestions};
    if(!validYearsAnswer(field,intent,candidates[0][1]))return {kind:'missing',reason:'Enter a nonnegative number of years for this skill',suggestions};
    if(intent==='graduation'&&!graduationFormatCompatible(field,candidates[0][1]))
      return {kind:'missing',reason:'Confirm the requested graduation date format',suggestions};
    return {answer:candidates[0][1],sourceQuestion:candidates[0][0],match:'equivalent',suggestions};
  }
  if(['previous-school','graduated-school'].includes(intent)){
    const suggestions=entries.filter(([question])=>classify(question)==='school').slice(0,3)
      .map(([question,answer])=>suggestion(question,answer,'Current school may differ from a previous or completed university'));
    return {kind:'missing',reason:'Confirm the previous or completed university',...(suggestions.length?{suggestions}:{})};
  }
  const suggestions=genericSuggestions(key,entries);
  return {kind:'missing',reason:suggestions.length?'Similar saved answers need review':'No explicit saved answer',...(suggestions.length?{suggestions}:{})};
}
import {describeScreening} from './screening-intelligence.mjs';

export function findSavedAnswer(field,answers,{answerBank,now}={}){
 if(!answerBank)return findLegacySavedAnswer(field,answers);
 if(field.type==='unsupported'||field.readOnly)return {kind:'missing',manual:true,reason:'Complete this unsupported or read-only control directly in LinkedIn.'};
 const candidates=bankCandidates(field,answerBank,{now}),intent=describeBankQuestion(field).descriptor.intent;
 const choose=(entries,legacy)=>{
  const values=entries.map(e=>e.value);if(legacy?.answer!==undefined)values.push(legacy.answer);
  if(new Set(values.map(v=>answerMeaning(v,intent))).size!==1)return {kind:'missing',manual:true,reason:'Conflicting scoped answers need review'};
  const e=entries[0];return {answer:e.value,sourceQuestion:e.sourceQuestion,match:candidates.exact.includes(e)?'exact':'equivalent',entryId:e.id,entryRevision:e.revision,bankRevision:answerBank.revision,answerScope:structuredClone(e.scope)};
 };
 if(candidates.exact.length)return choose(candidates.exact);
 const blockedExact=candidates.owned.some(e=>e.question.exactIdentity===describeBankQuestion(field).exactIdentity);
 if(blockedExact)return {kind:'missing',manual:true,reason:'This scoped answer was retired, expired or its control/context changed. Confirm it again.'};
 const legacy=findLegacySavedAnswer(field,answers);
 if(legacy.match==='exact')return legacy;
 if(candidates.equivalent.length){
  if(legacy.suggestions?.length&&legacy.reason==='Conflicting saved answers need review')return {kind:'missing',manual:true,reason:legacy.reason,suggestions:legacy.suggestions};
  return choose(candidates.equivalent,legacy.match==='equivalent'?legacy:null);
 }
 if(candidates.owned.length)return {kind:'missing',manual:true,reason:'This scoped meaning needs fresh confirmation; previous answers will not be restored automatically.'};
 return legacy;
}
