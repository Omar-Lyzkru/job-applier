import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalSkill,extractSkills,skillLabel} from '../src/skills.mjs';
import {normalizeJob} from '../src/job-parser.mjs';
import {defaultIntelligenceConfig,validateIntelligence} from '../src/intelligence-config.mjs';
import {buildSearchQueries} from '../src/search-profiles.mjs';
import {evaluateJob} from '../src/job-intelligence.mjs';
import {jobFingerprint,blockingDuplicate,compareCandidates} from '../src/job-duplicates.mjs';
import {validateConfig,readiness} from '../src/domain.mjs';

const now=new Date('2026-10-04T12:00:00Z');
const source={id:'1001',title:'Software Engineer Intern',company:'Example Labs',url:'https://www.linkedin.com/jobs/view/1001/'};
const parse=(description,details={})=>normalizeJob(source,{description,easyApply:true,...details},{now});

test('skill aliases preserve language boundaries and reject domains and ambiguous prose',()=>{
  assert.equal(canonicalSkill('CPP'),'c++');
  assert.equal(canonicalSkill('C#'),'c#');
  assert.equal(canonicalSkill('JS'),'javascript');
  assert.notEqual(canonicalSkill('Java'),canonicalSkill('JavaScript'));
  assert.notEqual(canonicalSkill('C'),canonicalSkill('C++'));
  assert.equal(skillLabel('postgresql'),'PostgreSQL');
  assert.deepEqual(extractSkills('Required: JS, Postgres and CPP',{context:'qualification'}),['javascript','postgresql','c++']);
  assert.deepEqual(extractSkills('https://example.com/Python Reactively remove rust; JavaScriptish',{context:'qualification'}),[]);
  assert.deepEqual(extractSkills('Required: JavaScript, C++, C#, C programming, GitHub',{context:'qualification'}),['javascript','c++','c#','c']);
});

const matching=(patch={})=>validateConfig({search:{titles:['Software Engineer'],location:'Houston, TX, USA',experienceLevels:['INTERNSHIP']},intelligence:{enabled:true,candidate:{skills:['Python','Git','AWS'],professionalYears:0,student:true,currentEducation:{degree:'bachelor',major:'Computer Science'}},roleFamilies:['swe'],regions:[{name:'Houston, TX, USA',priority:10,workplace:'any'}],...patch}});
const factor=(assessment,key)=>assessment.factors.find(f=>f.key===key);

test('matching config preserves reviewed empty, zero, false and unknown facts and rejects invalid input',()=>{
  assert.equal(defaultIntelligenceConfig().enabled,false);
  const config=validateIntelligence({candidate:{skills:[],professionalYears:0,student:false,clearances:null}});
  assert.deepEqual(config.candidate.skills,[]);assert.equal(config.candidate.professionalYears,0);assert.equal(config.candidate.student,false);assert.equal(config.candidate.clearances,null);
  assert.equal(validateIntelligence({candidate:{skills:null}}).candidate.skills,null);
  for(const minimumFitScore of [54,101,70.5])assert.throws(()=>validateIntelligence({minimumFitScore}),/55|100|integer/);
  assert.throws(()=>validateIntelligence({candidate:{professionalYears:-1}}),/years/i);
  assert.throws(()=>validateIntelligence({roleFamilies:['not-a-family']}),/famil/i);
  assert.throws(()=>validateIntelligence({regions:[{name:'Remote',priority:10,workplace:'remote'}]}),/geographic/i);
});

test('expanded queries combine only selected families and regions under the validated global query bound',()=>{
  const config=matching({roleFamilies:['backend'],familyTitles:{backend:['Backend Intern','API Intern']},regions:[{name:'Houston, TX, USA',priority:10,workplace:'onsite'},{name:'United States',priority:6,workplace:'remote'}]});
  const queries=buildSearchQueries(config.search,config.intelligence);
  assert.equal(queries.length,6);
  assert.deepEqual(queries.filter(q=>q.workplace==='remote').map(q=>q.location),['United States','United States','United States']);
  assert.equal(queries.some(q=>q.title==='Data Analyst Intern'),false);
  assert.throws(()=>validateConfig({search:{titles:Array.from({length:26},(_,i)=>`Role ${i}`)},intelligence:{enabled:true,regions:[{name:'United States',priority:10,workplace:'remote'},{name:'Canada',priority:5,workplace:'remote'}]}}),/50/);
  assert.deepEqual(buildSearchQueries({titles:[],location:''},validateIntelligence({enabled:true})),[]);
});

test('enabled readiness uses family titles and regions while legacy readiness retains its own inputs',()=>{
  const base={profile:{firstName:'Test',lastName:'Applicant',email:'test@example.com',phone:'5551234567'},resume:{path:'/tmp/synthetic.pdf',filename:'synthetic.pdf',size:10}};
  assert.deepEqual(readiness(validateConfig({...base,intelligence:{enabled:true,roleFamilies:['swe'],regions:[{name:'United States',priority:10,workplace:'remote'}]}})),[]);
  assert.ok(readiness(validateConfig(base)).includes('Add at least one job title'));
  assert.ok(readiness(validateConfig({...base,intelligence:{enabled:true}})).some(reason=>/search|query|region|title/i.test(reason)));
});

test('technical factor uses three-to-one required weights without inferring skills from keywords',()=>{
  const job=parse('Required: Python and Git\nPreferred: AWS and SQL');
  assert.equal(factor(evaluateJob(job,matching(),{now}),'skills').earned,21.875);
  assert.equal(factor(evaluateJob(job,matching({candidate:{skills:[]}}),{now}),'skills').earned,0);
  const unknown=evaluateJob(job,matching({candidate:{skills:null}}),{now});
  assert.equal(factor(unknown,'skills').earned,12.5);assert.equal(factor(unknown,'skills').unknown,true);
  const noSkills=evaluateJob(parse('Responsibilities: Help the team'),matching(),{now});
  assert.equal(factor(noSkills,'skills').earned,12.5);
  assert.equal(factor(noSkills,'skills').unknown,true);
  assert.deepEqual(evaluateJob(job,{...matching({candidate:{skills:null}}),search:{...matching().search,includeKeywords:['Python']}},{now}).matchedSkills,[]);
});

test('recency bands use the injected clock and unknown invalid or future dates get the midpoint',()=>{
  for(const [age,want] of [[0,10],[1,9],[3,9],[4,7],[7,7],[8,4],[14,4],[15,2],[30,2],[31,1]]){
    const job=parse('Required: Python',{postedAt:new Date(now-age*86400000).toISOString()});
    assert.equal(factor(evaluateJob(job,matching(),{now}),'recency').earned,want);
  }
  assert.equal(factor(evaluateJob(parse('Python',{postedAt:'invalid'}),matching(),{now}),'recency').earned,5);
});

test('threshold decisions use rounded scores and unknown eligibility overrides a passing score',()=>{
  const job=normalizeJob({...source,title:'Software Engineer'},{description:'Required: Python and Git',easyApply:true,postedAge:'5 days ago'},{now});
  const config=matching({candidate:{skills:['Python']}});
  assert.equal(evaluateJob(job,config,{now}).score,65);
  assert.equal(evaluateJob(job,config,{now}).band,'Borderline');
  assert.equal(evaluateJob(job,config,{now}).decision,'review');
  assert.equal(evaluateJob(job,matching({minimumFitScore:60,candidate:{skills:['Python']}}),{now}).decision,'apply');
  const unresolved=parse('Required: Python\nMust be currently enrolled as a student');
  assert.equal(evaluateJob(unresolved,matching({minimumFitScore:55,candidate:{skills:['Python'],student:null}}),{now}).decision,'review');
});

test('hard rules reject explicit conflicts, preserve preferred gaps and review unknown required facts',()=>{
  const years=parse('Required: At least 2 years of professional experience required');
  assert.equal(evaluateJob(years,matching(),{now}).decision,'skip');
  assert.equal(evaluateJob(years,matching(),{now}).score,null);
  assert.equal(evaluateJob(years,matching({candidate:{professionalYears:null}}),{now}).decision,'review');
  assert.equal(evaluateJob(years,matching({candidate:{professionalYears:3}}),{now}).reasons.some(r=>r.code==='experience_conflict'),false);
  assert.equal(evaluateJob(parse("Requirements: Master's degree required"),matching(),{now}).decision,'review');
  assert.equal(evaluateJob(parse("Requirements: Master's degree required"),matching({candidate:{completedEducation:{degree:'bachelor',major:'Computer Science'}}}),{now}).decision,'skip');
  assert.notEqual(evaluateJob(parse("Master's preferred"),matching(),{now}).score,null);
  assert.equal(evaluateJob(parse('Must possess active Secret clearance'),matching({candidate:{clearances:[]}}),{now}).decision,'skip');
  assert.equal(evaluateJob(parse('Must be authorized to work in the US'),matching(),{now}).decision,'review');
});

test('senior exclusions, unpaid exclusions and company exclusions cannot be overridden by score',()=>{
  const senior=normalizeJob({...source,title:'Senior Software Engineer Intern'},{description:'Required: Python and Git',easyApply:true},{now});
  assert.equal(evaluateJob(senior,matching(),{now}).score,null);
  assert.equal(evaluateJob(parse('Unpaid internship'),matching(),{now}).decision,'skip');
  assert.equal(evaluateJob(parse('Commission-only role'),matching(),{now}).decision,'skip');
  assert.equal(evaluateJob(parse('Paid internship with base salary plus commission'),matching(),{now}).reasons.some(r=>r.code==='commission_only'),false);
  assert.equal(evaluateJob(parse('Required: Python'),matching({excludedCompanies:['Example Labs']}),{now}).decision,'skip');
  assert.equal(evaluateJob(parse(''),matching(),{now}).decision,'skip');
});

test('all eight fit factors have an evidenced bounded breakdown with a hand-derived maximum',()=>{
  const job=parse("Requirements:\nPython and Git\nCurrently pursuing a bachelor's degree in Computer Science",{location:'Houston, Texas, United States',postedAge:'1 hour ago'});
  const assessment=evaluateJob(job,matching({preferredCompanies:['Example Labs']}),{now});
  assert.equal(assessment.score,100);assert.equal(assessment.band,'Excellent');assert.equal(assessment.decision,'apply');
  assert.deepEqual(assessment.factors.map(f=>f.max),[20,25,15,10,10,10,5,5]);
  assert.equal(assessment.factors.every(f=>f.earned<=f.max&&f.earned>=0),true);
});

test('editable senior family titles do not silently turn an explicit senior search into an internship search',()=>{
  const senior=normalizeJob({...source,title:'Senior Backend Engineer'},{description:'Required: Python',easyApply:true},{now});
  const config=validateConfig({search:{titles:[],experienceLevels:['MID_SENIOR_LEVEL']},intelligence:{enabled:true,roleFamilies:['backend'],familyTitles:{backend:['Senior Backend Engineer']},regions:[{name:'United States',priority:10,workplace:'remote'}]}});
  assert.equal(evaluateJob(senior,config,{now}).reasons.some(r=>r.code==='seniority'),false);
});

test('a negative sponsorship condition still requires eligibility review',()=>{
  const job=parse('Requirements:\nWe do not provide visa sponsorship');
  assert.equal(evaluateJob(job,matching(),{now}).reasons.some(r=>r.code==='eligibility_review'),true);
});

test('strong repost fingerprints require equivalent titles, known company/location and identical descriptions',()=>{
  const original=parse('Required: Python',{location:'Houston, TX, USA'}),repost={...original,id:'1002'};
  assert.equal(jobFingerprint(original),jobFingerprint(repost));
  for(const changed of [{...repost,location:parse('Required: Python',{location:'Dallas, TX, USA'}).location},{...repost,descriptionHash:parse('Required: Git').descriptionHash},{...repost,title:'Senior Software Engineer'},{...repost,company:'Company on LinkedIn'},{...repost,location:parse('Required: Python').location}])assert.notEqual(jobFingerprint(changed),jobFingerprint(original));
  assert.equal(jobFingerprint({...original,title:'Back End Developer Intern'}),jobFingerprint({...original,title:'Backend Developer Intern'}));
  const history=[{job:original,status:'failed',attemptedAt:'2026-10-04T12:00:00Z'}];
  assert.equal(blockingDuplicate(repost,history),history[0]);
  assert.equal(blockingDuplicate(repost,[{...history[0],attemptedAt:null}]),null);
  assert.equal(blockingDuplicate(repost,[{job:original,status:'needs_answer',attemptedAt:null}]),null);
});
test('candidate ties prefer known freshness then stable discovery order without fabricating unknown dates',()=>{
  const candidates=[{id:'a',assessment:{score:85},postedAt:null,discoveryIndex:0},{id:'b',assessment:{score:70},postedAt:'2026-10-04',discoveryIndex:1},{id:'c',assessment:{score:85},postedAt:'2026-10-03',discoveryIndex:2},{id:'d',assessment:{score:85},postedAt:'2026-10-03',discoveryIndex:3}];
  assert.deepEqual(candidates.sort(compareCandidates).map(j=>j.id),['c','d','a','b']);
});

test('posting skill buckets retain evidence and required skills win over preferred duplicates',()=>{
  const job=parse('Required: Python and Git\nPreferred: Python, AWS and SQL\nOptional: Docker\nAbout us: Java');
  assert.deepEqual(job.skills.required,['python','git']);
  assert.deepEqual(job.skills.preferred,['aws','sql']);
  assert.deepEqual(job.skills.optional,['docker']);
  assert.deepEqual(job.skills.unclassified,['java']);
  assert.match(JSON.stringify(job.evidence),/Required: Python and Git/);
});

test('negated requirements and experienced colleagues do not create applicant years',()=>{
  for(const description of ['No professional experience required','Mentored by engineers with 8 years of experience','Our company has 20 years of experience']){
    assert.equal(parse(description).requirements.some(r=>r.kind==='years'),false);
  }
  const required=parse('Requirements:\nAt least 2 years of professional experience required.');
  assert.equal(required.requirements.find(r=>r.kind==='years').value,2);
  assert.equal(required.requirements.find(r=>r.kind==='years').scope,'professional');
  assert.equal(required.requirements.find(r=>r.kind==='years').required,true);
});

test('current and completed education plus preferred qualifications stay separate',()=>{
  const job=parse("Requirements:\nCurrently pursuing a bachelor's degree in Computer Science\nMaster's preferred");
  const degrees=job.requirements.filter(r=>r.kind==='education');
  assert.deepEqual(degrees.map(r=>[r.value.degree,r.scope,r.required]),[['bachelor','pursuing',true],['master','completed',false]]);
  assert.equal(degrees[0].value.major,'computer science');
  assert.equal(parse('Must possess an active Secret clearance').requirements.find(r=>r.kind==='clearance')?.scope,'existing');
  assert.equal(parse('Ability to obtain a Secret clearance required').requirements.find(r=>r.kind==='clearance')?.scope,'obtainable');
  assert.equal(parse('Must be authorized to work in the US').requirements.find(r=>r.kind==='eligibility')?.required,true);
});

test('compensation only normalizes explicit ranges and rejects commission-only confusion',()=>{
  assert.equal(parse('Paid internship with base salary plus commission').compensation.commissionOnly,false);
  assert.equal(parse('Commission-only role').compensation.commissionOnly,true);
  assert.equal(parse('Unpaid internship').compensation.unpaid,true);
  assert.deepEqual(parse('Pay: $25–$30 per hour').compensation.range,{min:25,max:30,unit:'hour',currency:'USD'});
  assert.deepEqual(parse('Salary: $60,000–$75,000 per year').compensation.range,{min:60000,max:75000,unit:'year',currency:'USD'});
  assert.equal(parse('Competitive salary').compensation.range,null);
  assert.equal(parse('Full-time paid internship').employmentType,'internship');
});

test('posting hashes normalize typography and missing metadata remains unknown',()=>{
  assert.equal(parse('Required: Python  and\nGit').descriptionHash,parse('Required: Python and Git').descriptionHash);
  assert.equal(parse('Python').location.key,null);
  assert.equal(parse('Python',{location:'Somewhere wonderful'}).location.key,null);
  assert.equal(parse('Python',{postedAt:'2026-10-05'}).postedAt,null);
  assert.equal(parse('Python',{postedAt:'not a date'}).postedAt,null);
  assert.equal(parse('Python',{postedAge:'3 days ago'}).postedAt,'2026-10-01T12:00:00.000Z');
  const located=parse('Python',{location:'Houston, TX, United States',workplace:'hybrid'});
  assert.equal(located.location.city,'houston');
  assert.equal(located.location.state,'texas');
  assert.equal(located.location.country,'united states');
  assert.equal(located.location.workplace,'hybrid');
});
