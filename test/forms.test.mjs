import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {discoverFields,fillApplicationFields,validationErrors,fieldIdentity,verifyApplicationFields} from '../src/browser/forms.mjs';
import {modernApplication} from './fixtures/modern-application.mjs';
import {modernScreening,screeningLabels} from './fixtures/modern-screening.mjs';

async function setup(t,scenario={}){
  const dir=await mkdtemp(join(tmpdir(),'job-applier-modern-form-'));
  const resumePath=join(dir,'selected-resume.pdf');await writeFile(resumePath,'%PDF-1.4 fresh resume');
  const browser=await chromium.launch({headless:true});const page=await browser.newPage();
  page.setDefaultTimeout(1000);
  t.after(async()=>{await browser.close();await rm(dir,{recursive:true,force:true});});
  await page.setContent(modernApplication(scenario));
  const dialog=page.getByRole('dialog'),applicationState={};
  const options={profile:{},answers:{},resumePath,applicationState,uploadTimeout:700};
  return {page,dialog,options,applicationState};
}

test('modern résumé button uploads fresh bytes through a file chooser and verifies the new selected document',async t=>{
  const {page,dialog,options,applicationState}=await setup(t);
  assert.equal(await dialog.locator('input[type=file]').count(),0);
  const result=await fillApplicationFields(dialog,options);
  assert.deepEqual(result,{questions:[],errors:[]});
  assert.equal(applicationState.resumeVerified,true);
  assert.match(applicationState.resumeName,/^selected-resume-applier-[a-f0-9-]+\.pdf$/);
  assert.deepEqual(await page.evaluate(()=>window.acceptedDocument),{name:applicationState.resumeName,content:'%PDF-1.4 fresh resume'});
  assert.equal(await dialog.locator('input[value="new-document"]').isChecked(),true);
  assert.equal(await dialog.locator('input[value="old-document"]').isChecked(),false);
  await fillApplicationFields(dialog,options);
  assert.equal(await page.evaluate(()=>window.uploadClicks),1,'A confirmed upload is reused across form passes');
});

test('modern résumé upload waits until the new card is accepted, not merely present',async t=>{
  const {page,dialog,options,applicationState}=await setup(t,{delay:200});
  const result=await fillApplicationFields(dialog,options);
  assert.deepEqual(result,{questions:[],errors:[]});
  assert.equal(applicationState.resumeVerified,true);
  assert.ok(await page.evaluate(()=>window.acceptedDocument));
  assert.equal(await page.locator('#resume-region').getAttribute('aria-busy'),null);
});

test('required Resume* region uploads the résumé without creating a question or choosing a cover letter',async t=>{
  const {page,dialog,options,applicationState}=await setup(t,{requiredResume:true,coverLetter:true});
  const result=await fillApplicationFields(dialog,options);
  assert.deepEqual(result,{questions:[],errors:[]});
  assert.equal(applicationState.resumeVerified,true);
  assert.equal(await dialog.locator('input[value=new-document]').isChecked(),true);
  assert.equal(await page.evaluate(()=>window.uploadClicks),1);
  assert.equal(await page.evaluate(()=>window.coverUploadClicks),0);
});

test('zero-size résumé radios select the fresh document through its associated visible label',async t=>{
  const {page,dialog,options,applicationState}=await setup(t,{hiddenDocumentRadios:true});
  const result=await fillApplicationFields(dialog,options);
  assert.deepEqual(result,{questions:[],errors:[]});
  assert.equal(await dialog.locator('input[value=new-document]').isVisible(),false);
  assert.equal(await dialog.locator('input[value=new-document]').isChecked(),true);
  assert.equal(await dialog.locator('input[value=old-document]').isChecked(),false);
  assert.equal(applicationState.resumeVerified,true);
  assert.equal(await page.evaluate(()=>window.acceptedDocument.name),applicationState.resumeName);
});

test('résumé success alert is accepted only after the fresh document is verified',async t=>{
  const {page,dialog,options,applicationState}=await setup(t);
  assert.deepEqual(await fillApplicationFields(dialog,options),{questions:[],errors:[]});
  await page.evaluate(()=>document.querySelector('[role=dialog]').insertAdjacentHTML('beforeend','<p role="alert">Resume uploaded successfully</p>'));
  assert.deepEqual(await validationErrors(dialog),['Resume uploaded successfully']);
  assert.deepEqual(await validationErrors(dialog,applicationState),[]);
});

test('verified résumé success never hides other alerts or invalid native fields',async t=>{
  const {page,dialog,options,applicationState}=await setup(t);
  await fillApplicationFields(dialog,options);
  await page.evaluate(()=>document.querySelector('[role=dialog]').insertAdjacentHTML('beforeend','<p role="alert">Resume uploaded successfully</p><p role="alert">Please enter a valid phone number</p><p role="alert">Resume uploaded successfully, but processing failed</p><label>Email<input type="email" required value="invalid"></label>'));
  const errors=await validationErrors(dialog,applicationState);
  assert.equal(errors.includes('Resume uploaded successfully'),false);
  assert.ok(errors.includes('Please enter a valid phone number'));
  assert.ok(errors.includes('Resume uploaded successfully, but processing failed'));
  assert.ok(errors.some(error=>error.includes('@')),'Native email validation was lost');
});

test('failed modern upload never accepts the old same-named résumé or a pending new card',async t=>{
  const {page,dialog,options,applicationState}=await setup(t,{fail:true});
  const result=await fillApplicationFields(dialog,{...options,uploadTimeout:150});
  assert.ok(result.errors.some(error=>/not confirmed/i.test(error)));
  assert.notEqual(applicationState.resumeVerified,true);
  assert.equal(await page.evaluate(()=>window.acceptedDocument),null);
  assert.equal(await dialog.locator('input[value="old-document"]').isChecked(),true);
});

test('ambiguous résumé upload actions block without opening a file chooser',async t=>{
  const {page,dialog,options}=await setup(t,{ambiguous:true});
  const result=await fillApplicationFields(dialog,options);
  assert.ok(result.questions.length+result.errors.length>0);
  assert.equal(await page.evaluate(()=>window.uploadClicks),0);
});

test('Stop during modern upload confirmation never marks the pending document as verified',async t=>{
  const {page,dialog,options,applicationState}=await setup(t,{delay:500});
  const controller=new AbortController();
  const filling=fillApplicationFields(dialog,{...options,signal:controller.signal});
  try{
    await page.waitForFunction(()=>window.uploadedPayload!==null);
    controller.abort();
    await assert.rejects(filling,/Stopped/);
    assert.notEqual(applicationState.resumeVerified,true);
  }finally{controller.abort();await filling.catch(()=>{});}
});

test('modern résumé recognition preserves explicit CV screening answers and unrelated unsupported groups',async t=>{
  const {page,dialog,options}=await setup(t,{screening:true,requiredResume:true});
  const result=await fillApplicationFields(dialog,{...options,answers:{'can you provide a cv':true}});
  assert.deepEqual(result,{questions:[],errors:[]});
  assert.equal(await dialog.locator('input[name="screening-cv"][value="yes"]').isChecked(),true);
  await page.evaluate(()=>{
    const group=document.createElement('div');group.setAttribute('role','radiogroup');group.setAttribute('aria-label','Relocation availability');group.setAttribute('aria-required','true');
    group.innerHTML='<div role="radio" aria-checked="true">Yes</div>';document.querySelector('[role=dialog]').append(group);
  });
  const blocked=await fillApplicationFields(dialog,options);
  assert.ok(blocked.questions.some(question=>question.type==='unsupported'&&question.label==='Relocation availability'));
});

test('a CV screening question with an upload-named button is not a résumé document selector',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent('<div role="dialog"><div><div>Can you provide a CV?</div><div><fieldset role="radiogroup" aria-label="Can you provide a CV?"><label><input type="radio" name="cv" value="yes" required>Yes</label><label><input type="radio" name="cv" value="no" required>No</label></fieldset><button type="button">Upload resume</button></div></div></div>');
  const fields=await discoverFields(dialog);
  assert.equal(fields.some(entry=>entry.field.type==='radio'&&entry.field.documentSelection),false);
  const result=await fillApplicationFields(dialog,options);
  assert.ok(result.questions.length+result.errors.length>0);
});
test('native checkbox overlays use their associated label and verify the explicit or cleared value',async t=>{
  for(const answers of [{},{'follow vilo to stay up to date with their page':false}]){
    const {dialog,options}=await setup(t,{overlayCheckbox:true});
    const result=await fillApplicationFields(dialog,{...options,answers});
    assert.deepEqual(result,{questions:[],errors:[]});
    assert.equal(await dialog.locator('input[name=follow]').isChecked(),false);
  }
});

test('similar saved answers fill covered BGE screening radios and retain their source',async t=>{
  const {page,dialog,options,applicationState}=await setup(t);
  await page.setContent(`<style>input[type=radio]{position:absolute;width:0;height:0;margin:0}</style><div role="dialog">
    <fieldset><legend>Are you authorized to work legally in the US?*</legend><label><input name="work" type="radio" value="work-yes" required>Yes</label><label><input name="work" type="radio" value="work-no" required>No</label></fieldset>
    <fieldset><legend>Will you now or anytime after graduation require sponsorship for a work visa (like an H1b) to work legally in the US?*</legend><label><input name="visa" type="radio" value="visa-yes" required>Yes</label><label><input name="visa" type="radio" value="visa-no" required>No</label></fieldset>
    <fieldset><legend>If you provided a phone number, do you consent to receiving follow-up communication via text message (or SMS message) regarding your application status?*</legend><label><input name="sms" type="radio" value="sms-yes" required>Yes</label><label><input name="sms" type="radio" value="sms-no" required>No</label></fieldset>
  </div>`);
  const result=await fillApplicationFields(dialog,{...options,company:'BGE, Inc.',answers:{
    'are you legally authorized to work in the united states':'Yes',
    'will you now or in the future require sponsorship to work in the united states':'No',
    'sms consent for bge inc':'No'
  }});
  assert.deepEqual(result,{questions:[],errors:[]});
  assert.equal(await dialog.locator('input[value=work-yes]').isChecked(),true);
  assert.equal(await dialog.locator('input[value=visa-no]').isChecked(),true);
  assert.equal(await dialog.locator('input[value=sms-no]').isChecked(),true);
  assert.ok(applicationState.answerMatches.some(match=>match.sourceQuestion==='are you legally authorized to work in the united states'&&match.answer==='Yes'));
  assert.ok(applicationState.answerMatches.some(match=>match.sourceQuestion==='sms consent for bge inc'&&match.company==='BGE, Inc.'));
});

test('an unknown employer never inherits SMS consent saved for BGE',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent('<div role="dialog"><fieldset><legend>Do you consent to text message updates about your application?*</legend><label><input name="sms" type="radio" value="1" required>Yes</label><label><input name="sms" type="radio" value="0" required>No</label></fieldset></div>');
  const result=await fillApplicationFields(dialog,{...options,company:'Another Company',answers:{'sms consent for bge inc':'Yes'}});
  assert.equal(result.questions.length,1);
  assert.equal(result.questions[0].answerKey,'sms consent for another company');
  assert.equal(result.questions[0].company,'Another Company');
  assert.equal(await dialog.locator('input:checked').count(),0);
});

test('a required date with different formatting returns the prior answer as a review suggestion',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent('<div role="dialog"><label>Expected graduation date (MM/YYYY)*<input name="graduation" required></label></div>');
  const result=await fillApplicationFields(dialog,{...options,answers:{'expected graduation':'Spring 2028'}});
  assert.equal(result.questions.length,1);
  assert.ok(result.questions[0].suggestions?.some(suggestion=>suggestion.question==='expected graduation'&&suggestion.answer==='Spring 2028'));
  assert.equal(await dialog.locator('input[name=graduation]').inputValue(),'');
});

test('radio choices with identical internal values select the displayed No answer',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent('<div role="dialog"><fieldset><legend>Are you legally authorized to work in the United States?*</legend><label><input name="work" type="radio" required>Yes</label><label><input name="work" type="radio" required>No</label></fieldset></div>');
  const result=await fillApplicationFields(dialog,{...options,answers:{'are you legally authorized to work in the united states':'No'}});
  assert.deepEqual(result,{questions:[],errors:[]});
  assert.equal(await dialog.locator('label').filter({hasText:'No'}).locator('input').isChecked(),true);
  assert.equal(await dialog.locator('label').filter({hasText:'Yes'}).locator('input').isChecked(),false);
});

test('select choices with identical internal values select the displayed No answer',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent('<div role="dialog"><label>Are you legally authorized to work in the United States?*<select name="work" required><option value="">Choose</option><option value="on">Yes</option><option value="on">No</option></select></label></div>');
  const result=await fillApplicationFields(dialog,{...options,answers:{'are you legally authorized to work in the united states':'No'}});
  assert.deepEqual(result,{questions:[],errors:[]});
  assert.equal(await dialog.locator('select option:checked').textContent(),'No');
});

test('the native graduation input format is preserved for review even when its label has no format',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent('<div role="dialog"><label>Expected graduation*<input name="graduation" required pattern="[0-9]{2}/[0-9]{4}" placeholder="MM/YYYY"></label></div>');
  const fields=await discoverFields(dialog);
  assert.equal(fields[0].field.pattern,'[0-9]{2}/[0-9]{4}');
  assert.equal(fields[0].field.placeholder,'MM/YYYY');
  const result=await fillApplicationFields(dialog,{...options,answers:{'expected graduation':'Spring 2028'}});
  assert.equal(result.questions.length,1);
  assert.equal(result.questions[0].pattern,'[0-9]{2}/[0-9]{4}');
  assert.ok(result.questions[0].suggestions.some(suggestion=>suggestion.answer==='Spring 2028'));
  assert.equal(await dialog.locator('input').inputValue(),'');
});

test('hydrated screening groups discover the real required questions and sibling Yes/No choices',async t=>{
  const {page,dialog}=await setup(t);
  await page.setContent(modernScreening());
  const fields=await discoverFields(dialog);
  assert.equal(fields.length,3);
  assert.deepEqual(fields.map(entry=>[entry.field.label,entry.field.type,entry.field.required]),screeningLabels.map(label=>[`${label}*`,'radio',true]));
  for(const entry of fields)assert.deepEqual(entry.field.options.map(({label,value})=>({label,value})),[{label:'Yes',value:'on'},{label:'No',value:'on'}]);
  assert.equal(await dialog.locator('input').first().isVisible(),false);
});

test('unanswered hydrated screening returns three real questions instead of generated or unnamed fields',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent(modernScreening());
  const result=await fillApplicationFields(dialog,{...options,company:'BGE, Inc.'});
  assert.deepEqual(result.errors,[]);
  assert.equal(result.questions.length,3);
  assert.deepEqual(result.questions.map(question=>[question.label,question.type,question.blocker]),screeningLabels.map(label=>[`${label}*`,'radio','missing_answer']));
  assert.equal(result.questions[2].answerKey,'sms consent for bge inc');
  assert.equal(await dialog.locator('input:checked').count(),0);
});

test('hydrated screening fills explicit saved legal and employer consent answers through the exact empty label',async t=>{
  const {page,dialog,options,applicationState}=await setup(t);
  await page.setContent(modernScreening());
  const result=await fillApplicationFields(dialog,{...options,company:'BGE, Inc.',answers:{
    'are you legally authorized to work in the united states':'Yes',
    'will you now or in the future require sponsorship to work in the united states':'No',
    'sms consent for bge inc':'No'
  }});
  assert.deepEqual(result,{questions:[],errors:[]});
  assert.deepEqual(await dialog.locator('input:checked').evaluateAll(inputs=>inputs.map(input=>input.id)),['choice-0-0','choice-1-1','choice-2-1']);
  assert.deepEqual(applicationState.answerMatches.map(match=>match.sourceQuestion),[
    'are you legally authorized to work in the united states',
    'will you now or in the future require sponsorship to work in the united states',
    'sms consent for bge inc'
  ]);
});

test('ambiguous hydrated choices remain a named required blocker without selecting a radio',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent(modernScreening());
  await dialog.locator('fieldset').first().locator('p').nth(1).evaluate(el=>{el.textContent='Yes';});
  const result=await fillApplicationFields(dialog,{...options,company:'BGE, Inc.',answers:{
    'are you legally authorized to work in the united states':'Yes',
    'will you now or in the future require sponsorship to work in the united states':'No',
    'sms consent for bge inc':'No'
  }});
  assert.equal(result.questions.length,1);
  assert.equal(result.questions[0].label,`${screeningLabels[0]}*`);
  assert.equal(result.questions[0].type,'unsupported');
  assert.equal(result.questions[0].required,true);
  assert.equal(await dialog.locator('fieldset').first().locator('input:checked').count(),0);
});

test('mixed custom and native hydrated groups remain unsupported with their required question',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent(modernScreening());
  await dialog.locator('fieldset').first().evaluate(group=>group.insertAdjacentHTML('beforeend','<div role="radio" aria-checked="false">Other</div>'));
  const result=await fillApplicationFields(dialog,{...options,company:'BGE, Inc.',answers:{
    'are you legally authorized to work in the united states':'Yes',
    'will you now or in the future require sponsorship to work in the united states':'No',
    'sms consent for bge inc':'No'
  }});
  assert.equal(result.questions.length,1);
  assert.equal(result.questions[0].label,`${screeningLabels[0]}*`);
  assert.equal(result.questions[0].type,'unsupported');
  assert.equal(await dialog.locator('fieldset').first().locator('input:checked').count(),0);
});

test('hydrated fallback does not override a conflicting explicit group question',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent(modernScreening());
  await dialog.locator('fieldset').first().evaluate(group=>group.setAttribute('aria-label','Are you legally authorized to work in Canada?*'));
  const result=await fillApplicationFields(dialog,{...options,company:'BGE, Inc.',answers:{
    'are you legally authorized to work in the united states':'Yes',
    'will you now or in the future require sponsorship to work in the united states':'No',
    'sms consent for bge inc':'No'
  }});
  assert.equal(await dialog.locator('fieldset').first().locator('input:checked').count(),0);
  assert.ok(result.questions.some(question=>question.label==='Are you legally authorized to work in Canada?*'));
});

test('hydrated native radios retain the group aria-required flag without a visible star',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent(modernScreening());
  await dialog.locator('fieldset').first().evaluate(group=>{
    group.setAttribute('aria-required','true');
    group.previousElementSibling.textContent=group.previousElementSibling.textContent.replace(/\*$/,'');
  });
  const result=await fillApplicationFields(dialog,{...options,company:'BGE, Inc.',answers:{
    'will you now or in the future require sponsorship to work in the united states':'No',
    'sms consent for bge inc':'No'
  }});
  assert.equal(result.questions.length,1);
  assert.equal(result.questions[0].label,screeningLabels[0]);
  assert.equal(result.questions[0].required,true);
});

test('conflicting linked choice labels keep the hydrated group unsupported',async t=>{
  const {page,dialog}=await setup(t);
  await page.setContent(modernScreening());
  await dialog.evaluate(root=>root.insertAdjacentHTML('beforeend','<label for="choice-0-0">Yes</label><label for="choice-0-0">No</label>'));
  const fields=await discoverFields(dialog);
  assert.equal(fields[0].field.type,'unsupported');
  assert.equal(fields[0].field.label,`${screeningLabels[0]}*`);
});

test('two hydrated questions cannot share one native radio name and hide a required field',async t=>{
  const {page,dialog}=await setup(t);
  await page.setContent(modernScreening());
  await dialog.locator('fieldset').nth(1).locator('input').evaluateAll(inputs=>inputs.forEach(input=>{input.name='radio-group-_r_0_';}));
  const fields=await discoverFields(dialog);
  assert.ok(fields.some(entry=>entry.field.type==='unsupported'&&entry.field.label===`${screeningLabels[0]}*`));
  assert.ok(fields.some(entry=>entry.field.type==='unsupported'&&entry.field.label===`${screeningLabels[1]}*`));
});

test('an unrecognized résumé chooser cannot become an ordinary saved-answer screening question',async t=>{
  const {page,dialog}=await setup(t);
  await page.setContent(modernScreening());
  await dialog.locator('fieldset').first().evaluate(group=>{
    group.previousElementSibling.textContent='Resume*';
    group.querySelectorAll('input').forEach(input=>input.setAttribute('aria-label','Resume'));
    group.querySelectorAll('p').forEach((text,index)=>{text.textContent=index?'other-resume.pdf':'old-resume.pdf';});
    group.insertAdjacentHTML('afterend','<button type="button">Upload resume</button>');
  });
  const fields=await discoverFields(dialog);
  assert.equal(fields[0].field.type,'unsupported');
  assert.equal(fields[0].field.label,'Resume*');
});

test('unsupported hydrated choices retain native required flags even without a heading star',async t=>{
  const {page,dialog,options}=await setup(t);
  await page.setContent(modernScreening());
  await dialog.locator('fieldset').first().evaluate(group=>{
    group.previousElementSibling.textContent=group.previousElementSibling.textContent.replace(/\*$/,'');
    group.querySelectorAll('input').forEach(input=>{input.required=true;});
    group.querySelectorAll('p').forEach(text=>{text.textContent='Yes';});
  });
  const result=await fillApplicationFields(dialog,{...options,company:'BGE, Inc.',answers:{
    'are you legally authorized to work in the united states':'Yes',
    'will you now or in the future require sponsorship to work in the united states':'No',
    'sms consent for bge inc':'No'
  }});
  assert.equal(result.questions.length,1);
  assert.equal(result.questions[0].type,'unsupported');
  assert.equal(result.questions[0].label,screeningLabels[0]);
  assert.equal(result.questions[0].required,true);
});

test('other mandatory custom widgets make the hydrated native group unsupported without losing required flags',async t=>{
  const {page,dialog,options}=await setup(t);
  for(const attributes of ['role="checkbox"','role="combobox"','role="textbox"','contenteditable="true"']){
    await page.setContent(modernScreening());
    await dialog.locator('fieldset').first().evaluate((group,attributes)=>{
      group.previousElementSibling.textContent=group.previousElementSibling.textContent.replace(/\*$/,'');
      group.insertAdjacentHTML('beforeend',`<div ${attributes} aria-required="true" aria-label="Additional required control"></div>`);
    },attributes);
    const result=await fillApplicationFields(dialog,{...options,company:'BGE, Inc.',answers:{
      'are you legally authorized to work in the united states':'Yes',
      'will you now or in the future require sponsorship to work in the united states':'No',
      'sms consent for bge inc':'No'
    }});
    assert.equal(result.questions.length,1,attributes);
    assert.equal(result.questions[0].type,'unsupported',attributes);
    assert.equal(result.questions[0].label,screeningLabels[0],attributes);
    assert.equal(result.questions[0].required,true,attributes);
    assert.equal(await dialog.locator('fieldset').first().locator('input:checked').count(),0,attributes);
  }
});

const savedScreening={'are you legally authorized to work in the united states':'Yes','will you now or in the future require sponsorship to work in the united states':'No','sms consent for bge inc':'No'};
async function dynamic(t,scenario={}){const ctx=await setup(t);await ctx.page.setContent(modernScreening(scenario));ctx.options={...ctx.options,company:'BGE, Inc.',answers:savedScreening,actionTimeout:1500};return ctx;}
test('semantic identity preserves punctuation, ignores marker/value and distinguishes constraints',()=>{
 const field={label:'School?*',type:'text',required:true,options:[]};assert.equal(fieldIdentity(field),fieldIdentity({...field,value:'private',id:'changed'}));assert.notEqual(fieldIdentity(field),fieldIdentity({...field,label:'School!*'}));assert.notEqual(fieldIdentity(field),fieldIdentity({...field,pattern:'[A-Z]+'}));
});
for(const option of ['replaceOnChoiceChange','replaceNextGroupOnChoiceChange'])test(`dynamic form ${option} reacquires without toggling the saved choice twice`,async t=>{
 const {page,dialog,options}=await dynamic(t,{[option]:true});assert.deepEqual(await fillApplicationFields(dialog,options),{questions:[],errors:[]});
 assert.equal(await dialog.locator('input:checked').count(),3);assert.equal(await page.evaluate(()=>window.fixtureState.labelClicks),3);assert.equal(await page.evaluate(()=>window.fixtureState.groupReplacements),1);assert.equal((await verifyApplicationFields(dialog,options)).ok,true);
});
for(const hasAnswer of [false,true])test(`delayed conditional school ${hasAnswer?'fills the saved answer':'becomes a visible missing question'}`,async t=>{
 const {dialog,options}=await dynamic(t,{delayedConditional:true});const result=await fillApplicationFields(dialog,{...options,answers:{...options.answers,...(hasAnswer?{'university name':'Synthetic University'}:{})}});
 assert.equal(result.questions.some(q=>q.label==='University name*'),!hasAnswer);if(hasAnswer)assert.equal(await dialog.locator('[name=school]').inputValue(),'Synthetic University');
});
test('delayed custom required control is blocked and diagnostic structure never includes answers',async t=>{
 const {dialog,options}=await dynamic(t,{delayedConditional:true,customConditional:true});const result=await fillApplicationFields(dialog,options);assert.ok(result.questions.some(q=>q.type==='unsupported'));
 const verified=await verifyApplicationFields(dialog,options);assert.equal(verified.ok,false);assert.ok(verified.blockers.some(b=>b.code==='unsupported_control'));assert.equal(JSON.stringify(verified.safeStructure).includes('BGE'),false);
});
test('removed conditional questions do not survive a controlling answer',async t=>{
 const {dialog,options}=await dynamic(t,{removeConditionalOnChoiceChange:true});const result=await fillApplicationFields(dialog,options);assert.deepEqual(result,{questions:[],errors:[]});
});
test('a reset earlier answer is revisited after the quiet interval',async t=>{
 const {page,dialog,options}=await dynamic(t,{resetEarlierOnChoiceChange:true});const result=await fillApplicationFields(dialog,options);assert.deepEqual(result,{questions:[],errors:[]});assert.equal(await dialog.locator('input:checked').count(),3);assert.equal(await page.evaluate(()=>window.fixtureState.labelClicks),4);
});
test('continually resetting answers stop within the pass/deadline bound',async t=>{
 const {dialog,options}=await dynamic(t,{continualReset:true});const start=Date.now();const result=await fillApplicationFields(dialog,{...options,maxPasses:3,actionTimeout:900});assert.ok(result.blockers.some(b=>b.code==='form_changed'||b.code==='entry_verification'));assert.ok(Date.now()-start<2500);
});
test('ambiguous identities block without entering either control',async t=>{
 const {dialog,options}=await dynamic(t,{ambiguous:true});const result=await fillApplicationFields(dialog,{...options,answers:{...options.answers,ambiguous:'secret'}});assert.ok(result.blockers.some(b=>b.code==='form_changed'));assert.deepEqual(await dialog.locator('input:not([type=radio])').evaluateAll(inputs=>inputs.map(i=>i.value)),['','']);
});
test('Stop interrupts the bounded quiet/reacquisition wait',async t=>{
 const {dialog,options}=await dynamic(t);const controller=new AbortController();const promise=fillApplicationFields(dialog,{...options,signal:controller.signal,quietMs:1000});await dialog.locator('fieldset').last().locator('input').last().waitFor({state:'attached'});controller.abort();await assert.rejects(promise,/Stopped/);
});
test('read-only final verification detects a new required field and a changed selected resume',async t=>{
 const {page,dialog,options}=await setup(t);await fillApplicationFields(dialog,options);await dialog.locator('#old-document').check();assert.equal((await verifyApplicationFields(dialog,options)).ok,false);
 await page.evaluate(()=>document.querySelector('[role=dialog]').insertAdjacentHTML('beforeend','<label>New required*<input required></label>'));const verify=await verifyApplicationFields(dialog,options);assert.ok(verify.questions.some(q=>q.label==='New required*'));assert.equal(await dialog.locator('input:not([type=radio])').inputValue(),'');
});
