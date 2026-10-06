import {canonicalSkill} from './skills.mjs';

// Meaning normalization is private: saved keys retain their existing normalizer.
const normalizeMeaning=text=>String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const isSmsQuestion=key=>/^sms consent for .+/.test(key)||/\b(?:text messages?|sms messages?|sms)\b/.test(key);
const groups=[
  ['school',['school','school name','university','university name','college or university','college university','name of your university','name of your current university','what is your university name','which university are you currently attending']],
  ['previous-school',['university previously attended','previous university','which university did you previously attend']],
  ['graduated-school',['which university did you graduate from','university you graduated from','school you graduated from']],
  ['degree',['degree','degree type','current degree','current degree type','what degree are you pursuing','which degree are you currently pursuing','what degree are you currently studying for']],
  ['completed-degree',['highest completed degree','highest degree earned','highest degree completed','highest educational qualification completed','what is the highest degree you have completed','what is your highest completed degree']],
  ['major',['major','field of study','current field of study','academic major','your major','what is your major','what is your major or field of study']],
  ['current-student',['are you currently a student','are you a current student','are you presently a student','are you currently enrolled as a student','are you presently enrolled as a student']],
  ['graduation',['expected graduation','expected graduation date','anticipated graduation','anticipated graduation date','when do you expect to graduate','what is your expected graduation date']],
  ['position',['desired position type','type of position desired','preferred position type']],
  ['location',['location preference','preferred job location','preferred work location']],
  ['department',['department preference','preferred department']],
  ['address',['street address','address','address line 1']]
];
groups.push(['experience-years:total',['total years of experience','how many total years of experience do you have']],['experience-years:professional',['years of professional experience','how many years of professional experience do you have']]);
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
function classify(label) {
  const years=skillYears(label);
  if(years&&!years.ambiguous)return `skill-years:${years.experience}:${years.skill}`;
  const key=normalizeMeaning(label);
  if(isSmsQuestion(key))return 'sms';
  if(knownIntents.has(key))return knownIntents.get(key);
  const withoutFormat=key.replace(/ (?:mm yyyy|month year|yyyy mm|yyyy mm dd|dd mm yyyy|mm dd yyyy|dd month yyyy)$/,'');
  if(knownIntents.get(withoutFormat)==='graduation')return 'graduation';
  const country=key.replace(/\b(?:the )?(?:u s|us|usa|united states(?: of america)?)$/,'united states');
  if(/^(?:are you (?:currently )?(?:legally authorized to work|authorized to work legally|authorized to work)|do you have (?:legal )?authorization to work) in united states$/.test(country))return 'us-authorization';
  const sponsorship=normalizeMeaning(String(label).replace(/\(\s*(?:like|such as|e\.?g\.?)\s+(?:an?\s+)?h[ -]?1b\s*\)/ig,''))
    .replace(/\b(?:the )?(?:u s|us|usa|united states(?: of america)?)$/,'united states');
  if(/^(?:will|do) you (?:now|currently) or (?:at any time )?(?:in the future|anytime (?:in the future|after graduation)) (?:require|need) (?:visa )?sponsorship(?: for (?:a )?(?:work|employment) visa)? (?:to work(?: legally)?|for employment) in united states$/.test(sponsorship))return 'us-sponsorship-now-future';
  const us=key.replace(/\b(?:the )?(?:u s|us|usa|united states(?: of america)?)(?= in the future$|$)/,'united states');
  if(['do you currently require sponsorship to work in united states','do you currently need visa sponsorship for employment in united states'].includes(us))return 'us-sponsorship-now';
  if(['will you require sponsorship to work in united states in the future','will you need visa sponsorship for employment in united states in the future'].includes(us))return 'us-sponsorship-future';
  return null;
}


const summaries={
 school:'School for your current studies.', 'previous-school':'School previously attended.', 'graduated-school':'School you graduated from.',
 degree:'Degree you are currently pursuing.', 'completed-degree':'Highest degree already completed.', major:'Current field of study.',
 'current-student':'Whether you are currently a student.', graduation:'Expected graduation, using the requested date format.',
 position:'Preferred position type.', location:'Preferred work location; this is not work eligibility.', department:'Preferred department.',address:'Your explicit street address.',
 'us-authorization':'Legal authorization to work in the United States; separate from citizenship and sponsorship.',
 'us-sponsorship-now':'Sponsorship needed now in the United States; separate from future sponsorship.',
 'us-sponsorship-future':'Sponsorship needed in the future in the United States; separate from current sponsorship.',
 'us-sponsorship-now-future':'Sponsorship needed now or in the future in the United States; separate from either period alone.',
 sms:'Text-message consent for this employer and this question purpose.'
};
const sensitive=/\b(?:authorized|authorization|sponsor\w*|citizen\w*|visa|legally|legal|consent|sms|salary|pay|compensation|certif\w*|clearance|identity)\b/;
export function describeScreening(field){
 const years=skillYears(field.label),intent=years?.ambiguous?null:classify(field.label),key=normalizeMeaning(field.label);
 const qualifiers={};
 if(years)Object.assign(qualifiers,{experienceKind:years.experience,skill:years.skill});
 if(intent?.startsWith('experience-years:'))qualifiers.experienceKind=intent.split(':')[1];
 if(['degree','current-student','school','major'].includes(intent))qualifiers.educationStatus='current';
 if(['completed-degree','graduated-school'].includes(intent))qualifiers.educationStatus='completed';
 if(intent==='previous-school')qualifiers.educationStatus='previous';
 if(intent==='graduation')qualifiers.timeScope='expected';
 if(intent?.startsWith('us-'))qualifiers.jurisdiction='US';
 if(intent?.startsWith('us-sponsorship-'))qualifiers.timeScope=intent.slice('us-sponsorship-'.length);
 if(intent==='sms')qualifiers.purpose='application_sms_question';
 const company=normalizeMeaning(field.company||''),employerUnknown=intent==='sms'&&(!company||['company on linkedin','unknown','unknown company','company','not available','n a'].includes(company));
 const matchPolicy=years?.ambiguous||employerUnknown?'manual_only':intent?'known':'exact_only';
 const impact=!intent||sensitive.test(key)?'high':/years|degree|student|graduation|major/.test(intent)?'medium':'low';
 let summary=summaries[intent];
 if(years||intent?.startsWith('experience-years:'))summary=`${qualifiers.experienceKind==='professional'?'Professional':'Total'} years of ${years?`${years.skill} `:''}experience. Other experience scopes are separate.`;
 if(years?.ambiguous)summary='C, C++ and C# have separate meanings, but old saved keys may overlap. Confirm directly in LinkedIn.';
 if(!summary)summary=/\b(?:salary|pay|compensation)\b/.test(key)?'Salary needs explicit currency, pay period and amount or range confirmation.':/\bconsent\b/.test(key)?'Confirm the employer, purpose and terms of this consent question.':/\b(?:relocat\w*|located|location)\b/.test(key)?'Willingness, current location and eligibility are separate facts. Confirm this exact question.':'This wording has no reviewed equivalent. Use an explicit answer to this exact question.';
 return {version:1,intent,concept:intent?.startsWith('skill-years:')||intent?.startsWith('experience-years:')?'experience':intent,qualifiers,matchPolicy,impact,reasonCode:years?.ambiguous?'ambiguous_legacy_identity':employerUnknown?'employer_unknown':intent?'known_meaning':'unrecognized_meaning',summary};
}

// Descriptive only: the domain resolver and browser verifier retain authority.
export function explainScreeningResolution(field,resolution){
 const d=describeScreening(field),sourceQuestion=resolution.sourceQuestion??null;
 let decision='confirmation_required',reasonCode='explicit_answer_needed',summary='Save an explicit answer to this question before retrying.';
 if(d.matchPolicy==='manual_only'||field.type==='unsupported'||resolution.manual||(field.type==='checkbox'&&field.required&&resolution.kind==='fill'&&resolution.value===false)){
  decision='manual_only';reasonCode=d.reasonCode==='ambiguous_legacy_identity'||d.reasonCode==='employer_unknown'?d.reasonCode:'unsupported_control';
  summary=reasonCode==='ambiguous_legacy_identity'?'Old C-family answer keys can overlap. Confirm this experience directly in LinkedIn.':reasonCode==='employer_unknown'?'The employer is unknown. Complete this consent question directly in LinkedIn.':'Complete this control directly in LinkedIn; a saved answer does not make automatic entry safe.';
 }else if(resolution.kind==='fill'){
  decision='compatible';reasonCode=resolution.match==='profile'?'profile_contact':resolution.match==='equivalent'?'saved_equivalent':'saved_exact';
  summary=reasonCode==='profile_contact'?'Your explicit contact profile supplies this answer.':reasonCode==='saved_equivalent'?'An explicit saved answer matches this reviewed meaning.':'An explicit answer is saved for this exact question.';
 }else if(resolution.suggestions?.length){reasonCode='saved_answer_needs_review';summary='Review the previous answer and this question’s wording, choices and format before saving.';}
 return {version:1,impact:d.impact,decision,reasonCode,summary,qualifierSummary:d.summary,sourceQuestion};
}
