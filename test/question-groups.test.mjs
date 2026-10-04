import test from 'node:test';
import assert from 'node:assert/strict';
import * as grouping from '../src/question-groups.mjs';
import {describeQuestion} from '../src/answer-memory.mjs';

const question=(extra={})=>({key:'evening work',label:'Evening work?',answerKey:'evening work',type:'radio',required:true,options:[{label:'Yes',value:'1'},{label:'No',value:'0'}],jobId:'1001',company:'Example',blocker:'operational',reason:'Could not select answer',...extra});
const groups=questions=>grouping.groupPendingQuestions(questions.map(q=>({...q,description:describeQuestion(q)})));

test('compatible questions share an editor without losing original failures or mutating inputs',()=>{
  const input=[question(),question({jobId:'1002',company:'Other',reason:'Read-only value differs',options:[{label:'No',value:'n'},{label:'Yes',value:'y'}]})],before=structuredClone(input),result=groups(input);
  assert.equal(result.length,1);assert.equal(result[0].occurrences.length,2);
  assert.deepEqual(result[0].occurrences.map(q=>q.reason),['Could not select answer','Read-only value differs']);
  assert.deepEqual(input,before);
});
test('control, meaning, format and supplied constraints are compatibility boundaries',()=>{
  for(const extra of [{type:'select'},{required:false},{readOnly:true},{pattern:'[0-9]+'},{placeholder:'MM/YYYY'},{min:0},{max:10},{step:0.5},{options:[{label:'Yes',value:'1'},{label:'Maybe',value:'2'}]},{options:[{label:'C++',value:'1'},{label:'C#',value:'2'}]}])assert.equal(groups([question(),question(extra)]).length,2,JSON.stringify(extra));
  assert.equal(groups([question({options:[{label:'C++',value:'1'}]}),question({options:[{label:'C#',value:'1'}]})]).length,2);
  assert.equal(groups([question({label:'Expected graduation (MM/YYYY)',answerKey:'expected graduation mm yyyy',type:'text'}),question({label:'Expected graduation (MM-YYYY)',answerKey:'expected graduation mm yyyy',type:'text'})]).length,2);
});
test('SMS employer scopes and ambiguous language identities cannot share an editor',()=>{
  const sms={label:'Do you consent to receive text message updates about your application?',answerKey:undefined};
  assert.equal(groups([question({...sms,company:'Example'}),question({...sms,company:'Other'})]).length,2);
  assert.equal(groups([question({...sms,company:'Unknown',jobId:'1001'}),question({...sms,company:'Unknown',jobId:'1002'})]).length,2);
  assert.equal(groups(['C','C++','C#'].map(skill=>question({label:`Years of ${skill} experience`,answerKey:'years of c experience',type:'unsupported'}))).length,3);
});
test('draft identity ignores mutable saved state, provenance, failures, membership and order',()=>{
  const initial=groups([question(),question({jobId:'1002'})])[0];
  for(const changed of [question({savedAnswer:{answer:false,displayAnswer:'No',sourceQuestion:'evening work',match:'exact'}}),question({savedAnswer:{answer:0,displayAnswer:'0',sourceQuestion:'other',match:'equivalent'},reason:'Changed',blocker:'missing_answer'}),question({jobId:'1003',company:'New'})])assert.equal(groups([changed])[0].draftId,initial.draftId);
  assert.equal(groups([question({jobId:'1002'}),question()])[0].draftId,initial.draftId);
  const split=groups([question({savedAnswer:{answer:'Yes',sourceQuestion:'one'}}),question({savedAnswer:{answer:'No',sourceQuestion:'two'}})]);
  assert.equal(split.length,2);assert.equal(split[0].draftId,split[1].draftId);assert.notEqual(split[0].id,split[1].id);
});
test('saved false and zero remain explicit and duplicate suggestions coalesce by provenance',()=>{
  const savedAnswer={answer:false,displayAnswer:'No',sourceQuestion:'evening work'},suggestion={question:'old question',answer:0,reason:'Review'};
  const result=groups([question({savedAnswer,suggestions:[suggestion]}),question({jobId:'1002',savedAnswer,suggestions:[suggestion,{...suggestion,reason:'Different review'}]})]);
  assert.equal(result[0].savedAnswer.answer,false);assert.equal(result[0].suggestions.length,2);assert.equal(result[0].suggestions[0].answer,0);
});
