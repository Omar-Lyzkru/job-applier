import test from 'node:test';
import assert from 'node:assert/strict';
import {describeScreening} from '../src/screening-intelligence.mjs';

const cases=[
 ['School','school'],['Previous university','previous-school'],['School you graduated from','graduated-school'],
 ['Current degree','degree'],['What degree are you currently studying for?','degree'],['Which degree are you currently pursuing?','degree'],
 ['Highest degree earned','completed-degree'],['What is the highest degree you have completed?','completed-degree'],['What is your highest completed degree?','completed-degree'],
 ['Major','major'],['Are you currently a student?','current-student'],['Are you presently enrolled as a student?','current-student'],['Are you currently enrolled as a student?','current-student'],
 ['Expected graduation MM/YYYY','graduation'],['Desired position type','position'],['Preferred work location','location'],['Preferred department','department'],['Address line 1','address'],
 ['Total years of experience','experience-years:total'],['How many total years of experience do you have?','experience-years:total'],
 ['Years of professional experience','experience-years:professional'],['How many years of professional experience do you have?','experience-years:professional'],
 ['Years of Python experience','skill-years:total:python'],['How many years of professional experience do you have with JS?','skill-years:professional:javascript'],
 ['Are you authorized to work legally in the US?','us-authorization'],
 ['Will you now or anytime after graduation require sponsorship for a work visa (like an H1b) to work legally in the US?','us-sponsorship-now-future'],
 ['Do you currently require sponsorship to work in the United States?','us-sponsorship-now'],['Do you currently need visa sponsorship for employment in the United States?','us-sponsorship-now'],
 ['Will you require sponsorship to work in the United States in the future?','us-sponsorship-future'],['Will you need visa sponsorship for employment in the United States in the future?','us-sponsorship-future'],
 ['Do you consent to receive text message updates about your application?','sms']
];
test('screening descriptor recognizes reviewed complete meanings and preserves qualifiers',()=>{
 for(const [label,intent] of cases){const d=describeScreening({label,company:'Example'});assert.equal(d.intent,intent,label);assert.equal(d.matchPolicy,'known',label);}
 assert.deepEqual(describeScreening({label:'Years of professional Python experience'}).qualifiers,{experienceKind:'professional',skill:'python'});
 assert.equal(describeScreening({label:'Will you require sponsorship to work in the US in the future?'}).qualifiers.timeScope,'future');
 assert.equal(describeScreening({label:'  TOTAL YEARS OF EXPERIENCE*  '}).intent,'experience-years:total');
});
test('screening descriptor never broadens qualified, compound, negated or foreign questions',()=>{
 for(const label of ['Years of experience','Years of paid Python experience','Years of recent Python experience','Years of full-time Python experience','Years of production Python experience','Years of Python and Java experience','Are you not currently a student?','Are you a full-time student?','Will you be a student next year?','Have you graduated?','Are you a citizen of the United States?','Are you legally authorized to work in Canada?','Do you currently require sponsorship to work in Canada?','If hired, do you currently require sponsorship to work in the United States?']){
  const d=describeScreening({label});assert.equal(d.intent,null,label);assert.equal(d.matchPolicy,'exact_only',label);
 }
});
test('screening descriptor retains punctuation identities without reading collapsed legacy values',()=>{
 for(const [label,skill] of [['Years of C experience','c'],['Years of C++ experience','c++'],['Years of C# experience','c#']]){
  const d=describeScreening({label});assert.equal(d.qualifiers.skill,skill);assert.equal(d.intent,null);assert.equal(d.matchPolicy,'manual_only');assert.equal(d.impact,'high');
 }
});
test('screening descriptor explains sensitive and contextual unknowns without automatic equivalence',()=>{
 for(const label of ['Expected salary in USD per year','Consent to a background check','Are you willing to relocate to Houston?','Are you located in Houston?','Do you meet this unusual employer requirement?']){
  const d=describeScreening({label});assert.equal(d.intent,null);assert.equal(d.matchPolicy,'exact_only');assert.ok(d.summary.length>0);
 }
 for(const [label,intent] of cases.filter(([,intent])=>intent.startsWith('us-'))){assert.equal(describeScreening({label}).impact,'high',label);}
 assert.equal(describeScreening({label:'Current degree'}).impact,'medium');
 assert.equal(describeScreening({label:'School'}).impact,'low');
});
