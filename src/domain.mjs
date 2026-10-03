const profileKeys = ['firstName','lastName','email','phone','city','state','postalCode','country','linkedinUrl','website'];
const aliases = {
  'first name':'firstName', 'last name':'lastName', 'email':'email', 'email address':'email',
  'e mail':'email', 'e mail address':'email', 'phone':'phone', 'phone number':'phone',
  'mobile phone number':'phone', 'mobile number':'phone', 'city':'city', 'state':'state',
  'zip code':'postalCode', 'postal code':'postalCode', 'country':'country',
  'linkedin profile':'linkedinUrl', 'linkedin profile url':'linkedinUrl',
  'website':'website', 'portfolio':'website', 'personal website':'website'
};
export const statuses = new Set(['skipped','needs_answer','ready','submission_pending','submitted','unconfirmed','failed']);
export const MAX_RESUME_BYTES = 2_000_000;
const experienceLevelCodes=new Set(['INTERNSHIP','ENTRY_LEVEL','ASSOCIATE','MID_SENIOR_LEVEL','DIRECTOR','EXECUTIVE']);

export function defaultConfig() {
  return {
    profile:Object.fromEntries(profileKeys.map(key=>[key,''])),
    search:{titles:[],location:'',workplace:'any',experienceLevels:[],includeKeywords:[],excludeKeywords:[],keywordMatch:'all'},
    dailyCap:10, scanLimit:100, intervalSeconds:45, timezone:'America/Chicago', resume:null, dryRun:false
  };
}
function object(value,name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}
function string(value,name,max=1000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text under ${max} characters`);
  return value.trim();
}
function list(value,name) {
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${name} must be a list of at most 100 entries`);
  return [...new Set(value.map(item=>string(item,name,200)).filter(Boolean))];
}
function integer(value,name,min,max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}
function profileUrl(value,label) {
  if (!value) return '';
  try {
    if (/[\s\\]/.test(value)) throw new Error();
    const hasScheme=/^https?:\/\//i.test(value);
    const hasPort=/^[^/:]+\.\w+:\d+(?:[/?#]|$)/.test(value);
    if (!hasScheme && /^[a-z][a-z\d+.-]*:/i.test(value) && !hasPort) throw new Error();
    const url=new URL(hasScheme?value:value.startsWith('//')?`https:${value}`:`https://${value}`);
    const labels=url.hostname.replace(/\.$/,'').split('.');
    const validHost=url.hostname.startsWith('[') || ((labels.length>1 || url.hostname==='localhost') && labels.every(part=>/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(part)));
    if (!['https:','http:'].includes(url.protocol) || !validHost || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new Error(`${label} must be a valid web address, such as ${label==='LinkedIn profile URL'?'linkedin.com/in/your-name':'example.com'}`);
  }
}
export function validateConfig(input,{profileLinks=true}={}) {
  object(input,'Settings');
  const config = defaultConfig();
  if (input.profile !== undefined) {
    object(input.profile,'Profile');
    for (const key of profileKeys) if (input.profile[key] !== undefined) config.profile[key] = string(input.profile[key],key);
  }
  if (profileLinks) {
    config.profile.linkedinUrl=profileUrl(config.profile.linkedinUrl,'LinkedIn profile URL');
    config.profile.website=profileUrl(config.profile.website,'Website / portfolio');
  }
  if (input.search !== undefined) {
    object(input.search,'Search');
    for (const key of ['titles','includeKeywords','excludeKeywords']) if (input.search[key] !== undefined) config.search[key] = list(input.search[key],key);
    if(input.search.experienceLevels!==undefined){
      const levels=list(input.search.experienceLevels,'Experience levels');
      if(levels.some(level=>!experienceLevelCodes.has(level)))throw new Error('Choose valid LinkedIn experience levels');
      config.search.experienceLevels=levels;
    }
    if(input.search.keywordMatch!==undefined){
      if(!['all','any'].includes(input.search.keywordMatch))throw new Error('Keyword matching must be all or any');
      config.search.keywordMatch=input.search.keywordMatch;
    }
    if (input.search.location !== undefined) config.search.location = string(input.search.location,'Location');
    if (input.search.workplace !== undefined) {
      if (!['any','remote','hybrid','onsite'].includes(input.search.workplace)) throw new Error('Invalid workplace preference');
      config.search.workplace = input.search.workplace;
    }
  }
  if (input.dailyCap !== undefined) config.dailyCap = integer(input.dailyCap,'Daily cap',1,1000);
  if (input.scanLimit !== undefined) config.scanLimit = integer(input.scanLimit,'Scan limit',1,1000);
  if (input.intervalSeconds !== undefined) config.intervalSeconds = integer(input.intervalSeconds,'Application interval',1,3600);
  if (input.timezone !== undefined) {
    config.timezone = string(input.timezone,'Timezone',100);
    try { new Intl.DateTimeFormat('en-US',{timeZone:config.timezone}); } catch { throw new Error('Invalid timezone'); }
  }
  if (input.dryRun !== undefined) {
    if (typeof input.dryRun !== 'boolean') throw new Error('Dry run must be true or false');
    config.dryRun = input.dryRun;
  }
  if (input.resume != null) {
    const resume = object(input.resume,'Résumé');
    const filename = string(resume.filename,'Résumé filename',250);
    if (!/\.(pdf|doc|docx)$/i.test(filename)) throw new Error('Résumé must be PDF, DOC, or DOCX');
    config.resume = {path:string(resume.path,'Résumé path',4000),filename,size:integer(resume.size,'Résumé size',1,MAX_RESUME_BYTES)};
    if (!config.resume.path) throw new Error('Missing résumé path');
  }
  return config;
}
export function readiness(config) {
  const missing = [];
  if (!config.profile.firstName || !config.profile.lastName) missing.push('Enter your first and last name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.profile.email)) missing.push('Enter a valid email');
  if (!config.profile.phone) missing.push('Enter your phone number');
  if (!config.search.titles.length) missing.push('Add at least one job title');
  if (!config.search.location) missing.push('Enter a search location');
  if (!config.resume) missing.push('Upload a résumé');
  return missing;
}
export function normalizeQuestion(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function validateAnswers(input) {
  object(input,'Answers');
  if (Object.keys(input).length > 2000) throw new Error('Too many saved answers');
  const entries = [];
  for (const [label,value] of Object.entries(input)) {
    const key = normalizeQuestion(string(label,'Question',2000));
    if (!key) continue;
    if (!['string','number','boolean'].includes(typeof value) || (typeof value==='number' && !Number.isFinite(value))) throw new Error('Answers must be text, numbers, or true/false');
    if (typeof value==='string' && value.length > 10000) throw new Error('Answer is too long');
    entries.push([key, typeof value==='string' ? value.trim() : value]);
  }
  return Object.fromEntries(entries);
}
const yes = new Set(['yes','true','1','agree','i agree']);
const no = new Set(['no','false','0','disagree']);
export function resolveAnswer(field,profile,answers) {
  const key = normalizeQuestion(field.label);
  let value, source;
  if (Object.hasOwn(answers,key)) { value=answers[key]; source='saved answer'; }
  else if (aliases[key] && profile[aliases[key]]) { value=profile[aliases[key]]; source='profile'; }
  else if (key==='full name' && profile.firstName && profile.lastName) { value=`${profile.firstName} ${profile.lastName}`; source='profile'; }
  else return {kind:'missing',reason:'No explicit saved answer'};
  if (value===undefined || value===null || String(value).trim()==='') return {kind:'missing',reason:'Saved answer is empty'};
  if (field.type==='checkbox') {
    const normalized=normalizeQuestion(value);
    if (typeof value==='boolean') return {kind:'fill',value,source};
    if (yes.has(normalized)) return {kind:'fill',value:true,source};
    if (no.has(normalized)) return {kind:'fill',value:false,source};
    return {kind:'missing',reason:'Checkbox needs an explicit yes/no answer'};
  }
  if (['select','radio'].includes(field.type)) {
    const desired = typeof value==='boolean' ? (value?'yes':'no') : normalizeQuestion(value);
    const match=(field.options||[]).filter(option=> normalizeQuestion(option.label)===desired);
    if (match.length!==1 || match[0].value==='') return {kind:'missing',reason:'Saved answer does not match an available choice'};
    return {kind:'fill',value:match[0].value,source};
  }
  if (field.type==='number' && !Number.isFinite(Number(value))) return {kind:'missing',reason:'A numeric answer is required'};
  return {kind:'fill',value:String(value),source};
}
export function matchesJob(description,search) {
  const text = String(description).toLowerCase();
  const includes=search.includeKeywords,match=term=>text.includes(term.toLowerCase());
  const included=!includes.length || (search.keywordMatch==='any'?includes.some(match):includes.every(match));
  return included && !search.excludeKeywords.some(match);
}
export function dayKey(date,timezone) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date));
  const values = Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function countsTowardCap(record,day,timezone) {
  return Boolean(record.attemptedAt) && dayKey(record.attemptedAt,timezone)===day;
}
export function blocksRetry(record) {
  return ['submission_pending','submitted','unconfirmed'].includes(record.status) || Boolean(record.attemptedAt);
}
