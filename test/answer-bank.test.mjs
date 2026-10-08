import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyAnswerBank,validateAnswerBank,exactQuestionIdentity,describeBankQuestion,bankCandidates,allowedBankScopes} from '../src/answer-bank.mjs';
export const instant='2026-10-07T12:00:00.000Z';
export function entry(field,value,scope={kind:'job',jobId:String(field.jobId)},extra={}){return {id:randomUUID(),revision:1,state:'active',value,sourceQuestion:field.label,question:describeBankQuestion(field),scope,confirmedAt:instant,updatedAt:instant,expiresAt:null,provenance:{jobId:String(field.jobId),recordId:'observation'},...extra};}
const bank=(...entries)=>({version:1,revision:1,entries});
const f={label:'School*',type:'text',jobId:'123',company:'A&B, Inc.'};
test('bank identities preserve punctuation and qualifiers',()=>{
 assert.equal(exactQuestionIdentity({label:'  SCHOOL  * '}),'school');
 assert.notEqual(exactQuestionIdentity({label:'Years of C++ experience*'}),exactQuestionIdentity({label:'Years of C# experience*'}));
 const c=describeBankQuestion({...f,label:'Years of professional C++ experience'});
 assert.equal(c.descriptor.qualifiers.skill,'c++');assert.equal(c.descriptor.qualifiers.experienceKind,'professional');
 assert.notEqual(c.descriptor.intent,describeBankQuestion({...f,label:'Years of C++ experience'}).descriptor.intent);
});
test('bank candidates require explicit scope and compatible controls',()=>{
 const b=bank(entry(f,'UH'));
 assert.equal(bankCandidates(f,b,{now:instant}).exact.length,1);
 for(const changed of [{jobId:'456'},{label:'University name'},{type:'number'},{maxLength:2},{readOnly:true},{type:'unsupported'}])assert.equal(bankCandidates({...f,...changed},b,{now:instant}).exact.length,0);
 const employer=entry(f,'UH',{kind:'employer',employerIdentity:'a&b, inc.'});
 assert.equal(bankCandidates({...f,jobId:'456'},bank(employer),{now:instant}).exact.length,1);
 assert.equal(bankCandidates({...f,company:'A B Inc'},bank(employer),{now:instant}).exact.length,0);
 const choices={...f,label:'Degree type',type:'select',options:[{label:'Bachelor',value:'x'}]};
 assert.equal(bankCandidates({...choices,options:[{label:'Bachelor',value:'different'}]},bank(entry(choices,'Bachelor')),{now:instant}).exact.length,1);
 assert.equal(bankCandidates({...choices,options:[{label:'Master',value:'x'}]},bank(entry(choices,'Bachelor')),{now:instant}).exact.length,0);
});
test('retired owners remain visible without supplying values',()=>{
 for(const extra of [{state:'retired'},{expiresAt:'2026-10-06T12:00:00.000Z'}]){
  const candidates=bankCandidates(f,bank(entry(f,'UH',undefined,extra)),{now:instant});
  assert.equal(candidates.exact.length,0);assert.equal(candidates.owned.length,1);
 }
 const changed=bankCandidates({...f,pattern:'[A-Z]+'},bank(entry(f,'UH')),{now:instant});assert.equal(changed.owned.length,1);assert.equal(changed.exact.length,0);
});
test('overlapping scope conflicts are not ranked by recency',()=>{
 const a=entry(f,'UH'),b=entry(f,'Other',{kind:'employer',employerIdentity:'a&b, inc.'},{updatedAt:'2026-10-07T13:00:00.000Z'});
 assert.deepEqual(new Set(bankCandidates(f,bank(a,b),{now:instant}).exact.map(e=>e.value)),new Set(['UH','Other']));
});
test('bank schema preserves false and zero and rejects malformed private state',()=>{
 assert.deepEqual(emptyAnswerBank(),{version:1,revision:0,entries:[]});
 for(const value of [false,0])assert.equal(validateAnswerBank(bank(entry(f,value))).entries[0].value,value);
 const valid=bank(entry(f,'UH'));
 for(const bad of [{...valid,version:2},{...valid,unknown:true},{...valid,revision:-1},{...valid,entries:[valid.entries[0],valid.entries[0]]}])assert.throws(()=>validateAnswerBank(bad));
 for(const patch of [{value:Infinity},{value:{}},{value:'x'.repeat(10001)},{id:'bad'},{sourceQuestion:'x'.repeat(2001)},{scope:{kind:'global'}},{scope:{kind:'employer',employerIdentity:'unknown'}},{question:{...valid.entries[0].question,extra:1}}])assert.throws(()=>validateAnswerBank(bank({...valid.entries[0],...patch})));
 assert.throws(()=>validateAnswerBank({...valid,entries:Array.from({length:2001},()=>entry(f,'x'))}));
});
test('bank equivalents separate legal periods countries skill scopes and compounds',()=>{
 const fixtures=[['Years of professional Python experience','Years of Python experience'],['Years of C++ experience','Years of C# experience'],['Years of C++ experience','Years of C experience'],['Total years of experience','Years of professional experience'],['Do you currently require sponsorship to work in US?','Will you require sponsorship to work in US in the future?'],['Are you authorized to work in US?','Are you authorized to work in Canada?'],['Years of Python experience','Years of Python and Java experience']];
 for(const [from,to] of fixtures){const source={...f,label:from,type:'number'},q=describeBankQuestion(source);const scope={kind:'concept',intent:q.descriptor.intent,qualifiers:q.descriptor.qualifiers};assert.equal(bankCandidates({...source,label:to},bank(entry(source,0,scope)),{now:instant}).equivalent.length,0);}
 const source={...f,label:'School'},q=describeBankQuestion(source);
 assert.equal(bankCandidates({...source,label:'University name',jobId:'456'},bank(entry(source,'UH',{kind:'concept',intent:q.descriptor.intent,qualifiers:q.descriptor.qualifiers})),{now:instant}).equivalent.length,1);
});
test('bank unknown wording never gains equivalence or unproven sensitive context',()=>{
 for(const label of ['Desired salary','Do you consent to SMS updates about your application?','Consent to background checks']){
  const field={...f,label,type:'text'};assert.equal(bankCandidates(field,bank(entry(field,'Yes')),{now:instant}).exact.length,0);
 }
 const field={...f,label:'Tell us your preferred editor'};
 assert.equal(allowedBankScopes(field).length,1);
 assert.equal(bankCandidates({...field,label:'Your preferred editor'},bank(entry(field,'Vim')),{now:instant}).equivalent.length,0);
 const date={...f,label:'Expected graduation',pattern:'[0-9]{4}-[0-9]{2}'};
 assert.equal(bankCandidates({...date,pattern:'[0-9]{2}/[0-9]{4}'},bank(entry(date,'2028-05')),{now:instant}).exact.length,0);
 const sms={...f,label:'Do you consent to receiving text message updates about your application?',type:'radio',options:[{label:'Yes',value:'a'},{label:'No',value:'a'}],consentText:'Application SMS. Terms v1; reply STOP.'};
 assert.equal(bankCandidates(sms,bank(entry(sms,false,{kind:'employer',employerIdentity:'a&b, inc.'})),{now:instant}).exact.length,1);
 assert.equal(bankCandidates({...sms,consentText:'Marketing SMS. Terms v2'},bank(entry(sms,false)),{now:instant}).exact.length,0);
 assert.equal(allowedBankScopes({...sms,company:'Unknown'}).length,0);
 assert.equal(allowedBankScopes(sms).some(s=>s.kind==='concept'),false);
});
test('bank schema validates observed consent descriptors without inventing an employer',()=>{
 const sms={...f,label:'Do you consent to receiving text message updates about your application?',type:'checkbox',consentText:'Application updates. Terms v1.'};
 assert.equal(validateAnswerBank(bank(entry(sms,false))).entries.length,1);
});
