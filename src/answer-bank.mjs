import {createHash} from 'node:crypto';
import {describeScreening} from './screening-intelligence.mjs';

const normalize=value=>String(value??'').normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
export function exactQuestionIdentity(field){return normalize(field.label).replace(/\s*\*+\s*$/,'').trim();}
export function employerIdentity(company){const identity=normalize(company);return identity&&!['unknown','unknown company','company','company on linkedin','not available','n/a','n a'].includes(identity)?identity:null;}
export const bankDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const emptyAnswerBank=()=>({version:1,revision:0,entries:[]});
const supported=new Set(['text','textarea','email','tel','url','number','date','select','radio','checkbox']);
const constraintsKeys=['type','required','readOnly','choices','pattern','format','min','max','step','maxLength'];
const contextKeys=['jurisdiction','timeScope','skill','experienceKind','purpose','consentIdentity','salaryUnits'];
export function describeBankQuestion(field){
 const descriptor=describeScreening(field);
 if(descriptor.reasonCode==='ambiguous_legacy_identity')Object.assign(descriptor,{intent:`skill-years:${descriptor.qualifiers.experienceKind}:${descriptor.qualifiers.skill}`,concept:'experience',matchPolicy:'known',reasonCode:'confirmed_bank_identity'});
 const constraints={type:field.type||'text',required:Boolean(field.required),readOnly:Boolean(field.readOnly),choices:['select','radio'].includes(field.type)?(field.options||[]).map(o=>normalize(o.label)).sort():[],pattern:field.pattern||null,format:normalize(`${field.placeholder||''} ${field.label||''}`).match(/\b(?:yyyy|year|mm|month|dd|day)(?:\s*[/.-]\s*|\s+)(?:yyyy|year|mm|month|dd|day)(?:(?:\s*[/.-]\s*|\s+)(?:yyyy|year|mm|month|dd|day))?\b/)?.[0]||null};
 for(const name of ['min','max','step','maxLength'])constraints[name]=field[name]===undefined||field[name]===null||field[name]===''?null:String(field[name]);
 const context=Object.fromEntries(contextKeys.map(k=>[k,descriptor.qualifiers[k]??null]));
 if(descriptor.intent==='sms'||/\bconsent\b/i.test(field.label))context.consentIdentity=field.consentText?bankDigest(normalize(field.consentText)):null;
 const units=normalize(field.label).match(/\b(usd|eur|gbp|cad)\b.*\b(hourly|annual|monthly|per hour|per year|per month)\b/);
 context.salaryUnits=units?`${units[1]}:${units[2]}`:null;
 return {version:1,exactIdentity:exactQuestionIdentity(field),descriptor,constraints,context};
}
function reviewedApplicationSms(identity){
 const key=identity.replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 return /^(?:if you provided a phone number )?do you consent to receiving follow up communication via text message or sms message regarding your application status$/.test(key)||/^(?:do you (?:consent|agree) to|may we) (?:receive|receiving|send you) (?:text|sms) messages? (?:about|regarding) your application(?: status)?$/.test(key)||/^do you consent to (?:receive |receiving )?text message updates about your application(?: status)?$/.test(key);
}
function hasContext(question){
 const d=question.descriptor;
 if(d.intent==='sms'||/\bconsent\b/.test(question.exactIdentity))return d.intent==='sms'&&Boolean(question.context.consentIdentity)&&reviewedApplicationSms(question.exactIdentity);
 if(/\b(?:salary|compensation|pay)\b/.test(question.exactIdentity))return Boolean(question.context.salaryUnits);
 return true;
}
export function allowedBankScopes(field){
 const q=describeBankQuestion(field),company=employerIdentity(field.company),scopes=[];
 if(!supported.has(q.constraints.type)||q.constraints.readOnly||!hasContext(q)||q.descriptor.intent==='sms'&&!company)return scopes;
 if(/^\d+$/.test(String(field.jobId||'')))scopes.push({kind:'job',jobId:String(field.jobId)});
 if(q.descriptor.intent&&q.descriptor.matchPolicy==='known'){
  if(company)scopes.push({kind:'employer',employerIdentity:company});
  if(q.descriptor.intent!=='sms')scopes.push({kind:'concept',intent:q.descriptor.intent,qualifiers:structuredClone(q.descriptor.qualifiers)});
 }
 return scopes;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function scopeApplies(scope,field,q){
 if(scope.kind==='job')return /^\d+$/.test(String(field.jobId||''))&&scope.jobId===String(field.jobId);
 if(scope.kind==='employer')return Boolean(employerIdentity(field.company))&&scope.employerIdentity===employerIdentity(field.company);
 return q.descriptor.matchPolicy==='known'&&scope.intent===q.descriptor.intent&&same(scope.qualifiers,q.descriptor.qualifiers);
}
export function bankValueCompatible(question,value){
 if(!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&(!value.trim()||value.length>10000))return false;
 const c=question.constraints;
 if(!supported.has(c.type)||c.readOnly||!hasContext(question))return false;
 if(['radio','select'].includes(c.type)){const meaning=typeof value==='boolean'?(value?'yes':'no'):normalize(value);return c.choices.filter(x=>x===meaning).length===1;}
 if(c.type==='checkbox'&&typeof value!=='boolean')return false;
 if(c.type==='number'){
  if(typeof value==='boolean'||!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(String(value).trim()))return false;
  const number=Number(value);if(!Number.isFinite(number))return false;
  if(c.min!==null&&number<Number(c.min)||c.max!==null&&number>Number(c.max))return false;
  const step=c.step===null?1:c.step==='any'?null:Number(c.step),base=c.min===null?0:Number(c.min);
  if(step!==null&&(!(step>0)||Math.abs((number-base)/step-Math.round((number-base)/step))>1e-8))return false;
 }
 if(question.descriptor.concept==='experience'&&!['radio','select'].includes(c.type)&&(typeof value==='boolean'||!Number.isFinite(Number(value))||Number(value)<0))return false;
 if(c.maxLength!==null&&String(value).length>Number(c.maxLength))return false;
 if(c.pattern){try{if(!new RegExp(`^(?:${c.pattern})$`,'v').test(String(value)))return false;}catch{return false;}}
 if(c.type==='date'){const v=String(value);if(!calendarDate(v)||c.min!==null&&v<c.min||c.max!==null&&v>c.max)return false;const step=c.step==='any'?null:Number(c.step??1),days=(Date.parse(v)-Date.parse(c.min||'1970-01-01'))/86400000;if(step!==null&&Math.abs(days/step-Math.round(days/step))>1e-8)return false;}
 if(c.format){
  // Format identity is checked between observations; numeric date hints also constrain the value.
  const units=c.format.match(/yyyy|year|mm|month|dd|day/g),sep=c.format.match(/[/.\-]/)?.[0];
  const parts=sep?String(value).split(sep):String(value).trim().split(/\s+/);
  if(parts.length!==units.length)return false;
  for(let i=0;i<units.length;i++){const u=units[i],p=parts[i];if(/yyyy|year/.test(u)?!/^\d{4}$/.test(p):u==='month'?!/^[a-z]+$/i.test(p):!/^\d{2}$/.test(p))return false;}
 }
 return true;
}
export function bankCandidates(field,bank,{now=new Date()}={}){
 const q=describeBankQuestion(field),result={exact:[],equivalent:[],owned:[]};
 for(const e of bank?.entries||[]){
  if(!scopeApplies(e.scope,field,q))continue;
  const exact=e.question.exactIdentity===q.exactIdentity;
  const equivalent=q.descriptor.matchPolicy==='known'&&q.descriptor.intent===e.question.descriptor.intent&&same(q.descriptor.qualifiers,e.question.descriptor.qualifiers);
  if(exact||equivalent)result.owned.push(e);
  if(e.state!=='active'||e.expiresAt&&new Date(e.expiresAt)<=new Date(now)||!same(e.question.constraints,q.constraints)||!same(e.question.context,q.context)||!bankValueCompatible(q,e.value))continue;
  if(!allowedBankScopes(field).some(s=>same(s,e.scope)))continue;
  if(exact)result.exact.push(e);else if(equivalent)result.equivalent.push(e);
 }
 for(const list of Object.values(result))list.sort((a,b)=>a.id.localeCompare(b.id));
 return result;
}
function object(value,keys,name){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new Error(`Invalid ${name}`);}
function text(value,max,name){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`Invalid ${name}`);}
function revision(value,name,min=0){if(!Number.isSafeInteger(value)||value<min)throw new Error(`Invalid ${name}`);}
function calendarDate(value){const parsed=new Date(`${value}T00:00:00Z`);return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;}
function date(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
export function validateAnswerBank(input){
 object(input,['version','revision','entries'],'answer bank');if(input.version!==1)throw new Error('Unsupported answer bank version');revision(input.revision,'bank revision');
 if(!Array.isArray(input.entries)||input.entries.length>2000)throw new Error('Too many bank entries');
 const ids=new Set();
 for(const e of input.entries){
  object(e,['id','revision','state','value','sourceQuestion','question','scope','confirmedAt','updatedAt','expiresAt','provenance'],'bank entry');
  if(typeof e.id!=='string'||!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(e.id)||ids.has(e.id))throw new Error('Invalid or duplicate bank ID');ids.add(e.id);
  revision(e.revision,'entry revision',1);if(!['active','retired'].includes(e.state))throw new Error('Invalid bank state');
  if(!['string','number','boolean'].includes(typeof e.value)||typeof e.value==='number'&&!Number.isFinite(e.value)||typeof e.value==='string'&&e.value.length>10000)throw new Error('Invalid bank value');
  text(e.sourceQuestion,2000,'source question');
  const q=e.question;object(q,['version','exactIdentity','descriptor','constraints','context'],'bank question');if(q.version!==1||q.exactIdentity!==exactQuestionIdentity({label:e.sourceQuestion}))throw new Error('Invalid exact identity');
  object(q.descriptor,['version','intent','concept','qualifiers','matchPolicy','impact','reasonCode','summary'],'descriptor');
  if(!same(q.descriptor,describeBankQuestion({label:e.sourceQuestion,company:'Observed employer'}).descriptor))throw new Error('Inconsistent bank descriptor');
  object(q.constraints,constraintsKeys,'constraints');object(q.context,contextKeys,'context');
  if(typeof q.constraints.type!=='string'||typeof q.constraints.required!=='boolean'||typeof q.constraints.readOnly!=='boolean'||!Array.isArray(q.constraints.choices)||q.constraints.choices.length>200||q.constraints.choices.some(v=>typeof v!=='string'||v.length>2000))throw new Error('Invalid bank controls');
  for(const k of constraintsKeys.filter(k=>!['type','required','readOnly','choices'].includes(k)))if(q.constraints[k]!==null&&(typeof q.constraints[k]!=='string'||q.constraints[k].length>2000))throw new Error('Invalid bank constraint');
  for(const k of ['min','max'])if(q.constraints[k]!==null&&(q.constraints.type==='date'?!calendarDate(q.constraints[k]):!Number.isFinite(Number(q.constraints[k]))))throw new Error('Invalid numeric control bound');
  if(q.constraints.step!==null&&q.constraints.step!=='any'&&(!(Number(q.constraints.step)>0)||!Number.isFinite(Number(q.constraints.step))))throw new Error('Invalid numeric step');
  if(q.constraints.maxLength!==null&&(!Number.isSafeInteger(Number(q.constraints.maxLength))||Number(q.constraints.maxLength)<0))throw new Error('Invalid maximum length');
  for(const k of contextKeys)if(q.context[k]!==null&&(typeof q.context[k]!=='string'||q.context[k].length>2000))throw new Error('Invalid bank context');
  for(const k of ['jurisdiction','timeScope','skill','experienceKind','purpose'])if(q.context[k]!== (q.descriptor.qualifiers[k]??null))throw new Error('Inconsistent bank context');
  if(!date(e.confirmedAt)||!date(e.updatedAt)||e.updatedAt<e.confirmedAt||e.expiresAt!==null&&!date(e.expiresAt))throw new Error('Invalid bank timestamp');
  if(e.scope?.kind==='job'){object(e.scope,['kind','jobId'],'job scope');if(!/^\d+$/.test(e.scope.jobId))throw new Error('Invalid job scope');}
  else if(e.scope?.kind==='employer'){object(e.scope,['kind','employerIdentity'],'employer scope');if(!employerIdentity(e.scope.employerIdentity)||e.scope.employerIdentity!==employerIdentity(e.scope.employerIdentity)||!q.descriptor.intent)throw new Error('Invalid employer scope');}
  else if(e.scope?.kind==='concept'){object(e.scope,['kind','intent','qualifiers'],'concept scope');if(!q.descriptor.intent||q.descriptor.intent==='sms'||e.scope.intent!==q.descriptor.intent||!same(e.scope.qualifiers,q.descriptor.qualifiers))throw new Error('Invalid concept scope');}
  else throw new Error('Invalid bank scope');
  const p=e.provenance;if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['jobId','recordId','company','replacementDigest'].includes(k))||!/^\d+$/.test(p.jobId)||typeof p.recordId!=='string'||!p.recordId||p.recordId.length>200)throw new Error('Invalid bank provenance');
  if(e.scope.kind==='job'&&e.scope.jobId!==p.jobId)throw new Error('Inconsistent observed job ownership');
  if(e.scope.kind==='employer'&&(!p.company||e.scope.employerIdentity!==employerIdentity(p.company)))throw new Error('Inconsistent observed employer ownership');
  if(p.company!==undefined&&(typeof p.company!=='string'||p.company.length>2000))throw new Error('Invalid observed employer');
  if(p.replacementDigest!==undefined&&!/^[a-f\d]{64}$/.test(p.replacementDigest))throw new Error('Invalid replacement digest');
 }
 if(input.entries.length&&input.revision===0)throw new Error('Inconsistent bank revision');
 return structuredClone(input);
}
