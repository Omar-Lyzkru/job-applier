import {createHash} from 'node:crypto';
import {extractSkills} from './skills.mjs';
import {countries} from '../public/locations.js';
import {classifyRoleFamily} from './search-profiles.mjs';

export const normalizeText=value=>String(value??'').normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\s+/g,' ').trim().toLowerCase();
const normalizedCountry=value=>/^(us|usa|u\.s\.?|united states(?: of america)?)$/.test(value)?'united states':/^(uk|u\.k\.?|united kingdom)$/.test(value)?'united kingdom':value;
export function normalizeLocation(raw,workplace=null){
  const original=typeof raw==='string'?raw.trim():'';
  const text=normalizeText(original).replace(/\s*\((remote|hybrid|on-site|onsite)\)\s*$/,'');
  const parts=text.split(',').map(p=>p.trim()).filter(Boolean);
  let country=countries.find(c=>normalizeText(c.name)===normalizedCountry(parts.at(-1))||normalizeText(c.code)===parts.at(-1));
  let region=null,city=null,complete=false;
  if(country){
    parts.pop();region=country.regions.find(r=>[normalizeText(r.name),normalizeText(r.code)].includes(parts.at(-1)));
    if(region)parts.pop();
    if(parts.length===1&&/^[\p{L} .'-]+$/u.test(parts[0]))city=parts[0];
    complete=parts.length===0||parts.length===1&&city!==null;
  }else if(parts.length===2){
    country=countries.find(c=>c.code==='US');region=country.regions.find(r=>[normalizeText(r.name),normalizeText(r.code)].includes(parts[1]));
    if(region){city=parts[0];complete=/^[\p{L} .'-]+$/u.test(city);}else country=null;
  }
  const observed=normalizeText(workplace||original.match(/\((remote|hybrid|on-site|onsite)\)/i)?.[1]);
  const mode={remote:'remote',hybrid:'hybrid',onsite:'onsite','on-site':'onsite'}[observed]||null;
  const countryName=country?normalizeText(country.name):null,state=region?normalizeText(region.name):null;
  return {raw:original,key:countryName&&complete?[city,state,countryName].filter(Boolean).join(', '):null,city,state,country:countryName,workplace:mode,remote:mode===null?null:mode==='remote',evidence:original||null};
}
function unpaidRole(description,title){
  return [title,...description.split(/\n|(?<=[.;])\s+(?=[A-Z])/)].some(raw=>{
    const line=normalizeText(raw);
    if(/\b(?:not|no|never)\s+(?:an?\s+)?(?:unpaid|uncompensated)\b/.test(line))return false;
    return /\b(?:unpaid|uncompensated)\s+(?:(?:software|engineering|summer|part-time|full-time)\s+){0,3}(?:internship|intern|role|position|job|opportunity|employment|work)\b/.test(line)||
      /\b(?:internship|intern|role|position|job|opportunity|employment|work)\s*(?:(?:is|will be)\s+)?[(:-]?\s*(?:an?\s+)?(?:unpaid|uncompensated)\b/.test(line)||
      /^(?:(?:pay|salary|compensation)\s*:\s*)?(?:unpaid|uncompensated)[.!]?$/.test(line);
  });
}
const degreePatterns=[['doctorate',/\b(?:ph\.?d\.?|doctorate|doctoral)\b/i],['master',/\bmaster(?:['’]s)?\b/i],['bachelor',/\bbachelor(?:['’]s)?\b/i],['associate',/\bassociate(?:['’]s)?\b/i],['high_school',/\bhigh school\b/i]];
function postingTime(details,now){
  if(details.postedAt){const value=new Date(details.postedAt);return Number.isFinite(value.getTime())&&value<=now?value.toISOString():null;}
  const age=String(details.postedAge||'').trim().match(/^(?:reposted\s+)?(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/i);
  if(!age)return null;
  // Months have variable length: keep those ages unknown rather than invent a date.
  const unit={minute:60000,hour:3600000,day:86400000,week:604800000}[age[2].toLowerCase()];
  return unit?new Date(now.getTime()-Number(age[1])*unit).toISOString():null;
}
export function normalizeJob(candidate,details,{now=new Date()}={}){
  const description=typeof details.description==='string'?details.description:'';
  const skills={required:[],preferred:[],optional:[],unclassified:[]},requirements=[],evidence=[];
  let section='unclassified';
  const requirement=(kind,value,scope,required,text)=>requirements.push({kind,value,scope,required,evidence:text});
  for(const raw of description.split(/\n|(?<=[.;])\s+(?=[A-Z])/)){
    const line=raw.trim();if(!line)continue;
    const text=normalizeText(line);
    const heading=text.match(/^(required(?: qualifications| skills)?|requirements|minimum qualifications|qualifications|preferred(?: qualifications| skills)?|nice to have|optional|about us|benefits|responsibilities)\s*(?::|$)/);
    if(heading)section=/preferred|nice to have/.test(heading[1])?'preferred':heading[1]==='optional'?'optional':/required|requirements|minimum/.test(heading[1])?'required':'unclassified';
    const negated=/\b(?:no|not|without|don't|do not)\b.*\b(?:required|necessary|need|experience|degree|clearance)\b/.test(text);
    const explicitApplicant=/\b(?:you|applicants?|candidates?)\s+(?:(?:must|need to|should|will need to)\s+(?:have|possess)|(?:are|is)\s+required to (?:have|possess))\b/.test(text);
    const colleague=!explicitApplicant&&/\b(?:our (?:company|team) (?:has|have|offers?|brings?)|colleagues with|mentored|mentorship|engineers with|team has|company has)\b/.test(text);
    const preferred=section==='preferred'||section==='optional'||/\b(?:preferred|desirable|nice to have|a plus)\b/.test(text);
    const required=!negated&&!colleague&&!preferred&&(section==='required'||/\b(?:must|required|at least|minimum|currently pursuing|currently enrolled)\b/.test(text));
    const bucket=negated||colleague?'unclassified':preferred?(section==='optional'?'optional':'preferred'):required?'required':section;
    for(const id of extractSkills(line,{context:'qualification'})){if(!skills[bucket].includes(id))skills[bucket].push(id);evidence.push({kind:'skill',id,bucket,text:line});}
    if(/\b(?:authorized to work|work authorization|citizenship|citizens?|sponsorship|work visa|legally eligible)\b/.test(text)){
      const restrictive=/\b(?:cannot|can't|unable|not|no|without|only|must|required|need)\b/.test(text);
      const waived=/\b(?:not|no)\b.{0,40}\b(?:required|necessary|needed)\b|\b(?:do not|does not|don't)\s+require\b/.test(text);
      requirement('eligibility',null,'legal',!waived&&(required||restrictive),line);
    }
    if(negated||colleague)continue;
    const years=text.match(/\b(?:at least |minimum (?:of )?)?(\d+)(?:\s*\+)?\s+years?\s+(?:of )?(professional |commercial |paid )?(?:[a-z+#.]+ )?experience\b/);
    if(years&&(required||preferred))requirement('years',Number(years[1]),years[2]?'professional':'total',required,line);
    const degrees=degreePatterns.filter(([,pattern])=>pattern.test(line));
    if(degrees.length){
      const scope=/\b(?:pursuing|enrolled|working toward|working towards|student)\b/.test(text)?'pursuing':'completed';
      const major=text.match(/\bin (computer science(?:\/it)?|information technology|software engineering|engineering|information systems|data science)\b/)?.[1]?.replace('/it','')||null;
      if(degrees.length>1||/\bor equivalent|\bor related|\band\/or\b/.test(text))requirement('ambiguous_eligibility',null,scope,required,line);
      else requirement('education',{degree:degrees[0][0],major},scope,required,line);
    }else if(/\b(?:enrolled|current(?:ly)?(?: a)? student|must be a student)\b/.test(text))requirement('student',true,'current',required,line);
    if(/\bclearance\b/.test(text)){
      const value=text.match(/\b(top secret|secret|confidential)\b/)?.[1]||null;
      requirement(value?'clearance':'ambiguous_eligibility',value,/\b(?:obtain|eligible for)\b/.test(text)?'obtainable':'existing',required,line);
    }
  }
  for(const bucket of ['preferred','optional','unclassified'])skills[bucket]=skills[bucket].filter(id=>!skills.required.includes(id));
  for(const bucket of ['optional','unclassified'])skills[bucket]=skills[bucket].filter(id=>!skills.preferred.includes(id));
  const text=normalizeText(description),pay=description.match(/\$(\d[\d,]*(?:\.\d+)?)\s*[-–—]\s*\$?(\d[\d,]*(?:\.\d+)?)\s*(?:per |\/|an? )?(hour|year|annum|hr)\b/i);
  const range=pay?{min:Number(pay[1].replaceAll(',','')),max:Number(pay[2].replaceAll(',','')),unit:/hour|hr/i.test(pay[3])?'hour':'year',currency:'USD'}:null;
  const title=normalizeText(candidate.title),senior=/\b(?:senior|sr\.?|staff|principal|director|executive|chief)\b/.test(title);
  return {...candidate,description,normalizedTitle:title,normalizedCompany:normalizeText(candidate.company),descriptionHash:description.trim()?createHash('sha256').update(normalizeText(description)).digest('hex'):null,
    familyId:classifyRoleFamily(candidate.title),experienceLevel:senior?'senior':/\b(?:intern|internship)\b/.test(title)?'internship':/\b(?:junior|jr|entry.level|graduate)\b/.test(title)?'entry':null,
    employmentType:/\binternship\b/.test(text+' '+title)?'internship':/\bpart-time\b/.test(text)?'part_time':/\bfull-time\b/.test(text)?'full_time':/\bcontract(?:or)?\b/.test(text)?'contract':null,
    location:normalizeLocation(details.location,details.workplace),skills,requirements,
    compensation:{unpaid:unpaidRole(description,candidate.title),commissionOnly:/\bcommission(?:-| )only\b|\b100% commission\b/.test(text)&&!/\b(?:base (?:pay|salary)|plus commission|not commission-only)\b/.test(text),range:range&&range.max>=range.min?range:null},
    application:details.easyApply===true?'easy_apply':details.easyApply===false?'external':null,alreadyApplied:!!details.alreadyApplied,postedAt:postingTime(details,now),evidence:[...evidence,...requirements.map(r=>({kind:r.kind,text:r.evidence})),...(details.evidence||[])]};
}
