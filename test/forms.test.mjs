import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {discoverFields,fillApplicationFields,validationErrors} from '../src/browser/forms.mjs';
import {modernApplication} from './fixtures/modern-application.mjs';

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
