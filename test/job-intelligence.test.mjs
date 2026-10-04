import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalSkill,extractSkills,skillLabel} from '../src/skills.mjs';
import {normalizeJob} from '../src/job-parser.mjs';

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
