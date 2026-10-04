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

const groups=[
  ['school',['school','school name','university','university name','college or university','college university','name of your university','name of your current university','what is your university name','which university are you currently attending']],
  ['previous-school',['university previously attended','previous university','which university did you previously attend']],
  ['graduated-school',['which university did you graduate from','university you graduated from','school you graduated from']],
  ['degree',['degree','degree type','current degree','current degree type','what degree are you pursuing']],
  ['completed-degree',['highest completed degree','highest degree earned','highest degree completed','highest educational qualification completed']],
  ['major',['major','field of study','current field of study','academic major','your major','what is your major','what is your major or field of study']],
  ['current-student',['are you currently a student','are you a current student','are you presently a student']],
  ['graduation',['expected graduation','expected graduation date','anticipated graduation','anticipated graduation date','when do you expect to graduate','what is your expected graduation date']],
  ['position',['desired position type','type of position desired','preferred position type']],
  ['location',['location preference','preferred job location','preferred work location']],
  ['department',['department preference','preferred department']],
  ['address',['street address','address','address line 1']]
];
const knownIntents=new Map(groups.flatMap(([intent,labels])=>labels.map(label=>[label,intent])));
const yearSkills=new Set(['java','javascript','typescript','python','rust','react','node.js','sql','postgresql','git']);
function skillYears(label){
  let text=String(label).normalize('NFKC').toLowerCase().replace(/[\u200b-\u200d\ufeff]/g,'').trim().replace(/[?*.!\s]+$/g,'').replace(/\s+/g,' ');
  const professional=/^(?:years of|how many years of) professional /.test(text);
  if(professional)text=text.replace(/^(years of|how many years of) professional /,'$1 ');
  const total=/^(?:total )?years of (.+?) experience$/.exec(text)||/^(?:total )?years of experience with (.+)$/.exec(text);
  const question=/^how many years of (.+?) experience do you have$/.exec(text)||/^how many years of experience do you have (?:with|in) (.+)$/.exec(text);
  let name=(total||question)?.[1];
  if(!name)return null;
  const skill=canonicalSkill(name==='react js'?'React.js':name);
  if(['c','c++','c#'].includes(skill))return {skill,experience:professional?'professional':'total',ambiguous:true};
  return yearSkills.has(skill)?{skill,experience:professional?'professional':'total'}:null;
}
const sensitiveTerms=/\b(?:authorized|authorization|sponsor\w*|citizen\w*|visa|legally|legal|consent|sms|salary|pay|compensation|certif\w*|clearance|identity)\b/;

export function describeQuestion(field){
  const years=skillYears(field.label),intent=years?.ambiguous?null:classify(field.label);
  const company=knownCompany(field.company),sms=intent==='sms';
  const scope=sms?(company?{kind:'company',company}:{kind:'job',jobId:String(field.jobId||'unknown')}):{kind:'global'};
  if(years)Object.assign(scope,{skill:years.skill,experience:years.experience});
  return {intent,answerKey:savedAnswerKey(field),scope,controlType:field.type||'text',
    reviewPolicy:years?.ambiguous||sms&&!company?'manual':intent?'known':'review',
    risk:years?.ambiguous?'ambiguous_identity':sms||sensitiveTerms.test(normalizeQuestion(field.label))?'sensitive':'ordinary'};
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

function classify(label) {
  const years=skillYears(label);
  if(years&&!years.ambiguous)return `skill-years:${years.experience}:${years.skill}`;
  const key=normalizeQuestion(label);
  if(isSmsQuestion(key))return 'sms';
  if(knownIntents.has(key))return knownIntents.get(key);
  const withoutFormat=key.replace(/ (?:mm yyyy|month year|yyyy mm|yyyy mm dd|dd mm yyyy|mm dd yyyy|dd month yyyy)$/,'');
  if(knownIntents.get(withoutFormat)==='graduation')return 'graduation';
  const country=key.replace(/\b(?:the )?(?:u s|us|usa|united states(?: of america)?)$/,'united states');
  if(/^(?:are you (?:currently )?(?:legally authorized to work|authorized to work legally|authorized to work)|do you have (?:legal )?authorization to work) in united states$/.test(country))return 'us-authorization';
  const sponsorship=normalizeQuestion(String(label).replace(/\(\s*(?:like|such as|e\.?g\.?)\s+(?:an?\s+)?h[ -]?1b\s*\)/ig,''))
    .replace(/\b(?:the )?(?:u s|us|usa|united states(?: of america)?)$/,'united states');
  if(/^(?:will|do) you (?:now|currently) or (?:at any time )?(?:in the future|anytime (?:in the future|after graduation)) (?:require|need) (?:visa )?sponsorship(?: for (?:a )?(?:work|employment) visa)? (?:to work(?: legally)?|for employment) in united states$/.test(sponsorship))return 'us-sponsorship-now-future';
  return null;
}

function nonempty(value) {
  return value!==undefined&&value!==null&&String(value).trim()!=='';
}
function suggestion(question,answer,reason) {return {question,answer,reason};}
function answerMeaning(value,intent) {
  const key=normalizeQuestion(value);
  if(['us-authorization','us-sponsorship-now-future','current-student'].includes(intent)){
    if(value===true||['yes','true','1','agree','i agree'].includes(key))return 'yes';
    if(value===false||['no','false','0','disagree'].includes(key))return 'no';
  }
  if(intent?.startsWith('skill-years:')&&scalarYears(value))return String(Number(value));
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
function validYearsAnswer(field,intent,value){return !intent?.startsWith('skill-years:')||['select','radio'].includes(field.type)||scalarYears(value);}

// Equivalence is deliberately limited to known wording. Token similarity can only suggest.
export function findSavedAnswer(field,answers) {
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
import {canonicalSkill} from './skills.mjs';
