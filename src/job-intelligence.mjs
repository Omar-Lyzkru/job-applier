import {normalizeText,normalizeLocation} from './job-parser.mjs';
import {classifyRoleFamily,roleFamilyPresets} from './search-profiles.mjs';
import {defaultIntelligenceConfig} from './intelligence-config.mjs';
const levels={internship:'INTERNSHIP',entry:'ENTRY_LEVEL',senior:'MID_SENIOR_LEVEL'};
const degreeOrder=['none','high_school','associate','bachelor','master','doctorate'];
function qualification(requirement,candidate){
  if(requirement.kind==='years')return requirement.scope!=='professional'||candidate.professionalYears===null?null:candidate.professionalYears>=requirement.value;
  if(requirement.kind==='student')return candidate.student;
  if(requirement.kind==='education'){
    const education=candidate[requirement.scope==='pursuing'?'currentEducation':'completedEducation'];
    if(!education)return null;
    if(requirement.scope==='pursuing'&&candidate.student!==true)return candidate.student===false?false:null;
    if(education.degree!==requirement.value.degree)return degreeOrder.indexOf(education.degree)>degreeOrder.indexOf(requirement.value.degree)?null:false;
    if(requirement.value.major&&!education.major)return null;
    return !requirement.value.major||normalizeText(education.major)===normalizeText(requirement.value.major);
  }
  if(requirement.kind==='clearance')return requirement.scope==='obtainable'||candidate.clearances===null?null:candidate.clearances.includes(requirement.value);
  return null;
}
export function evaluateJob(job,config,{now=new Date()}={}){
  const i=config.intelligence||defaultIntelligenceConfig(),c=i.candidate,search=config.search||{},reasons=[],uncertainties=[];
  const reason=(code,message,evidence)=>reasons.push({code,message,evidence:evidence||null});
  const text=normalizeText(`${job.title}\n${job.description}`),company=normalizeText(job.company);
  const reject=(code,message,evidence)=>{reason(code,message,evidence);return {decision:'skip',score:null,band:null,factors:[],reasons,matchedSkills:[],missingSkills:[],uncertainties};};
  if(!job.description?.trim())return reject('unreadable','Job description could not be checked');
  const excluded=(search.excludeKeywords||[]).find(term=>text.includes(normalizeText(term)));
  if(excluded)return reject('excluded_keyword',`Excluded keyword: ${excluded}`,excluded);
  if(i.excludedCompanies.some(value=>normalizeText(value)===company))return reject('excluded_company','Company is excluded',job.company);
  if(job.alreadyApplied)return reject('already_applied','LinkedIn shows an existing application');
  if(job.application==='external')return reject('external_application','No LinkedIn Easy Apply');
  if(i.excludeUnpaid&&job.compensation.unpaid)return reject('unpaid','Posting describes an unpaid role');
  if(i.excludeCommissionOnly&&job.compensation.commissionOnly)return reject('commission_only','Posting describes commission-only compensation');
  const selected=search.experienceLevels||[],targetTitles=[...(search.titles||[]),...i.roleFamilies.flatMap(id=>i.familyTitles[id]||roleFamilyPresets[id].titles)],entryTarget=selected.some(level=>['INTERNSHIP','ENTRY_LEVEL'].includes(level))||targetTitles.some(title=>/\b(?:intern|internship|junior|entry.level)\b/i.test(title));
  if(i.rejectSeniorForEntry&&entryTarget&&job.experienceLevel==='senior')return reject('seniority','Senior role conflicts with an internship or entry-level search',job.title);
  const requirements=job.requirements.map(r=>({...r,satisfied:qualification(r,c)}));
  for(const r of requirements.filter(r=>r.required)){
    if(r.satisfied===false)return reject(r.kind==='years'?'experience_conflict':`${r.kind}_conflict`,'A required qualification conflicts with your confirmed matching facts',r.evidence);
    if(r.satisfied===null){uncertainties.push(r.evidence);reason('eligibility_review','Review an unresolved required qualification',r.evidence);}
  }
  const factors=[];
  const add=(key,max,earned,unknown=false,evidence=null)=>factors.push({key,max,earned:Math.max(0,Math.min(max,earned)),unknown,evidence});
  const family=job.familyId||classifyRoleFamily(job.title),custom=(search.titles||[]).some(title=>normalizeText(title)===job.normalizedTitle);
  add('title',20,custom||family&&i.roleFamilies.includes(family)?20:family&&i.roleFamilies.some(id=>roleFamilyPresets[id]?.related.includes(family))?10:family?0:10,!family&&!custom,job.title);
  const required=[...new Set(job.skills.required)],preferred=[...new Set(job.skills.preferred)].filter(id=>!required.includes(id));
  const weighted=[...required.map(id=>({id,weight:3})),...preferred.map(id=>({id,weight:1}))];
  const matchedSkills=weighted.filter(({id})=>c.skills?.includes(id)).map(v=>v.id),missingSkills=c.skills===null?[]:weighted.filter(({id})=>!c.skills.includes(id)).map(v=>v.id);
  const skillUnknown=c.skills===null||weighted.length===0;
  add('skills',25,skillUnknown?12.5:25*weighted.filter(({id})=>matchedSkills.includes(id)).reduce((n,v)=>n+v.weight,0)/weighted.reduce((n,v)=>n+v.weight,0),skillUnknown,job.evidence.filter(e=>e.kind==='skill'));
  const years=requirements.filter(r=>r.kind==='years'),experienceUnknown=!job.experienceLevel||years.some(r=>r.satisfied===null);
  const compatible=selected.length?selected.includes(levels[job.experienceLevel]):entryTarget?['internship','entry'].includes(job.experienceLevel):null;
  add('experience',15,experienceUnknown||compatible===null?7.5:compatible&&years.every(r=>r.satisfied!==false)?15:0,experienceUnknown||compatible===null,years.map(r=>r.evidence));
  const education=requirements.filter(r=>['student','education'].includes(r.kind)),educationUnknown=!education.length||education.some(r=>r.satisfied===null);
  add('education',10,educationUnknown?5:education.every(r=>r.satisfied)?10:0,educationUnknown,education.map(r=>r.evidence));
  const regions=i.regions.length?i.regions:search.location?[{name:search.location,priority:10,workplace:search.workplace||'any'}]:[];
  const matches=regions.filter(region=>{
    const target=normalizeLocation(region.name);
    if(!target.key||!job.location.key)return false;
    if(region.workplace!=='any'&&job.location.workplace!==region.workplace)return false;
    return ['country','state','city'].every(key=>!target[key]||target[key]===job.location[key]);
  });
  add('location',10,job.location.key?matches.length?Math.max(...matches.map(r=>r.priority)):0:5,!job.location.key,job.location.raw);
  const timestamp=Date.parse(job.postedAt),age=Math.floor((now.getTime()-timestamp)/86400000),ageKnown=Number.isFinite(timestamp)&&age>=0;
  add('recency',10,!ageKnown?5:age===0?10:age<=3?9:age<=7?7:age<=14?4:age<=30?2:1,!ageKnown,job.postedAt);
  add('ease',5,job.application==='easy_apply'?5:job.application==='external'?0:2.5,job.application===null,job.application);
  const preferredCompany=i.preferredCompanies.some(value=>normalizeText(value)===company),preferredFamily=i.preferredFamilies.includes(family),include=search.includeKeywords||[];
  const preferences=i.preferredCompanies.length||i.preferredFamilies.length||include.length;
  const interest=Math.max(preferredCompany||preferredFamily?5:!preferences||!company?2.5:0,include.length?5*include.filter(term=>text.includes(normalizeText(term))).length/include.length:0);
  add('interest',5,interest,!preferences||!company,preferredCompany?job.company:preferredFamily?family:include);
  for(const f of factors.filter(f=>f.unknown))uncertainties.push(`${f.key} is unknown`);
  const score=Math.max(0,Math.min(100,Math.round(factors.reduce((sum,f)=>sum+f.earned,0)))),band=score>=85?'Excellent':score>=70?'Good':score>=55?'Borderline':'Low';
  const decision=score<55?'skip':requirements.some(r=>r.required&&r.satisfied===null)||score<i.minimumFitScore?'review':'apply';
  reason(decision==='apply'?'fit_pass':decision==='review'?'fit_review':'fit_low',decision==='apply'?`Fit ${score}/100 meets your minimum`:decision==='review'?`Fit ${score}/100 needs review`:`Fit ${score}/100 is below the supported minimum`);
  return {decision,score,band,factors,reasons,matchedSkills,missingSkills,uncertainties};
}
