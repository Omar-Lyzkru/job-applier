import {basename,extname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {normalizeQuestion,resolveAnswer} from '../domain.mjs';

export function checkStopped(signal) {
  if (signal?.aborted) throw new Error('Stopped before submission');
}
export async function discoverFields(dialog) {
  const descriptors=await dialog.evaluate(root=>{
    const controls=Array.from(root.querySelectorAll('input,select,textarea,[role="combobox"],[role="checkbox"],[role="switch"],[role="radiogroup"],[role="radio"],[role="listbox"],[role="option"],[role="spinbutton"],[role="textbox"],[contenteditable="true"]'));
    const seen=new Set(),fields=[];
    const visible=el=>Boolean(el.getClientRects().length) && getComputedStyle(el).visibility!=='hidden';
    const labelText=el=>{
      const copy=el.cloneNode(true);
      copy.querySelectorAll('input,select,textarea,[aria-hidden="true"]').forEach(control=>control.remove());
      return copy.textContent.trim();
    };
    const labelOf=el=>{
      const ids=(el.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean);
      const aria=ids.map(id=>{const label=document.getElementById(id);return label?labelText(label):'';}).join(' ').trim();
      const labels=Array.from(el.labels||[]).map(labelText).join(' ');
      return aria||el.getAttribute('aria-label')||labels||el.placeholder||el.name||'Unlabeled field';
    };
    const documentChooser=el=>{
      if(el.closest('.jobs-document-upload,.jobs-resume-upload'))return true;
      const group=el.closest('fieldset,section');
      return Boolean(group?.querySelector('input[type="file"]') && /resume|résumé|\bcv\b/i.test(group.querySelector('legend,h2,h3')?.textContent||''));
    };
    controls.forEach((el,index)=>el.setAttribute('data-applier-control',String(index)));
    for(const el of controls){
      const native=el.matches('input,select,textarea');
      const type=native && !(el.getAttribute('role')==='combobox' && el.tagName!=='SELECT')?(el.type|| (el.tagName==='TEXTAREA'?'textarea':'unsupported')):'unsupported';
      if (el.disabled || ['hidden','submit','button','reset'].includes(type) || (!visible(el) && type!=='file'))continue;
      if(!native){
        // Discover the visible widget even when its native backing input is hidden.
        // Custom controls are blockers until their semantics can be supported.
        if(el.parentElement.closest('[role="radiogroup"],[role="listbox"]'))continue;
        const selected=el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-selected')==='true'||Boolean(el.querySelector('[aria-checked="true"],[aria-selected="true"]'));
        const value=selected?'Selected':el.getAttribute('aria-valuenow')||el.getAttribute('aria-valuetext')||el.value|| (el.matches('[contenteditable="true"],[role="textbox"],[role="combobox"]')?el.textContent:'');
        const label=labelOf(el);
        fields.push({label,type:'unsupported',required:el.getAttribute('aria-required')==='true'||/\*/.test(label),value,options:[],id:el.getAttribute('data-applier-control')});
        continue;
      }
      if(type==='radio'){
        const name=el.name||el.id;
        if(seen.has(name))continue;seen.add(name);
        const group=controls.filter(input=>input.type==='radio' && (input.name||input.id)===name);
        const parent=el.closest('fieldset,[role="group"],.fb-dash-form-element');
        const question=parent?.querySelector('legend,[id$="label"],.fb-dash-form-element__label')?.textContent.trim() || parent?.getAttribute('aria-label') || name;
        fields.push({label:question,type:'radio',documentSelection:documentChooser(el),required:group.some(input=>input.required||input.getAttribute('aria-required')==='true')||/\*/.test(question),value:group.find(input=>input.checked)?.value||'',options:group.map(input=>({label:labelOf(input),value:input.value,id:input.getAttribute('data-applier-control')})),id:el.getAttribute('data-applier-control')});
      }else{
        let label=labelOf(el);
        if(type==='file' && !/resume|résumé|\bcv\b/i.test(label)){
          const nearby=el.closest('fieldset,section,.jobs-document-upload')?.textContent||'';
          if(/resume|résumé|\bcv\b/i.test(nearby))label='Resume';
        }
        fields.push({label,type:el.tagName==='SELECT'?'select':type,required:el.required||el.getAttribute('aria-required')==='true'||/\*/.test(label),value:type==='checkbox'?el.checked:type==='file'?Array.from(el.files||[]).map(file=>file.name).join(', '):el.value||el.textContent||'',options:el.tagName==='SELECT'?Array.from(el.options).filter(option=>!option.disabled).map(option=>({label:option.textContent.trim(),value:option.value})):[],id:el.getAttribute('data-applier-control'),readOnly:Boolean(el.readOnly)});
      }
    }
    return fields;
  });
  return descriptors.map(descriptor=>{
    const {id,readOnly,...field}=descriptor;
    return {field:{...field,key:normalizeQuestion(field.label)},readOnly,locator:dialog.locator(`[data-applier-control="${id}"]`),radios:descriptor.type==='radio'?descriptor.options.map(option=>({...option,locator:dialog.locator(`[data-applier-control="${option.id}"]`)})):null};
  });
}
function hasValue(field) {return field.type==='checkbox'?field.value===true:String(field.value||'').trim()!=='';}
async function uploadResume(dialog,entry,{resumePath,signal,applicationState,uploadTimeout}) {
  if(!resumePath)throw new Error('No selected résumé');
  // A fresh unique filename identifies this exact upload. Reusing an employer's
  // old same-named document can never satisfy the acceptance check below.
  const extension=extname(resumePath).toLowerCase();
  const filename=`${basename(resumePath,extname(resumePath)).slice(0,140)}-applier-${randomUUID()}${extension}`;
  const mimeType={'.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[extension];
  await entry.locator.setInputFiles({name:filename,mimeType,buffer:await readFile(resumePath)});
  const end=Date.now()+uploadTimeout;
  while(Date.now()<end){
    checkStopped(signal);
    const choices=(await discoverFields(dialog)).filter(item=>item.field.documentSelection)
      .flatMap(item=>item.radios||[]).filter(option=>option.label.includes(filename));
    if(choices.length===1){
      const choice=choices[0];
      const busy=await choice.locator.evaluate(el=>{
        const area=el.closest('.jobs-document-upload,.jobs-resume-upload,section,fieldset');
        return Boolean(area?.closest('[aria-busy="true"]') || area?.querySelector('[aria-busy="true"],[role="progressbar"]'));
      });
      if(!busy){
        await choice.locator.check();
        if(await choice.locator.isChecked()){
          applicationState.resumeName=filename;applicationState.resumeVerified=true;return;
        }
      }
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Upload was not confirmed as the selected application document');
}
export async function fillApplicationFields(dialog,{profile,answers,resumePath,signal,applicationState={},uploadTimeout=10000}) {
  const questions=[],errors=[];
  let fields=await discoverFields(dialog);
  const question=(field,reason,blocker='operational')=>questions.push({key:field.key,label:field.label,type:field.type,options:field.options.map(({label,value})=>({label,value})),reason,blocker});
  for(const entry of fields.filter(entry=>entry.field.type==='file')){
    checkStopped(signal);
    if(!/resume|résumé|\bcv\b/i.test(entry.field.label)){
      if(entry.field.required||hasValue(entry.field))question(entry.field,'This upload needs a file the app does not have');
      continue;
    }
    try{
      if(!applicationState.resumeVerified)await uploadResume(dialog,entry,{resumePath,signal,applicationState,uploadTimeout});
    }catch(error){errors.push(`Résumé: ${error.message.split('\n')[0]}`);}
  }
  // Uploading adds controls asynchronously; rebuild locators after acceptance.
  fields=await discoverFields(dialog);
  for(const entry of fields){
    checkStopped(signal);
    const {field,locator,radios,readOnly}=entry;
    if(field.type==='file')continue;
    // Only structural document components are résumé selectors. Ordinary CV
    // screening questions continue through the exact saved-answer resolver.
    if(field.documentSelection){
      const matches=radios?.filter(option=>applicationState.resumeVerified && option.label.includes(applicationState.resumeName))||[];
      if(matches.length!==1 || !await matches[0].locator.isChecked())question(field,'Could not verify the selected résumé');
      continue;
    }
    if(field.type==='unsupported'){
      if(field.required||hasValue(field))question(field,'This control is not supported automatically');
      continue;
    }
    const answer=resolveAnswer(field,profile,answers);
    if(answer.kind==='missing'){
      if(field.required){question(field,answer.reason,'missing_answer');continue;}
      if(!hasValue(field))continue;
      try{
        if(readOnly)throw new Error('The prefilled value cannot be cleared');
        if(field.type==='checkbox')await locator.uncheck();
        else if(field.type==='select' && field.options.some(option=>option.value===''))await locator.selectOption('');
        else if(field.type==='radio'||field.type==='select')throw new Error('The prefilled choice cannot be cleared safely');
        else await locator.fill('');
      }catch{question(field,'Unknown prefilled answer cannot be cleared safely');}
      continue;
    }
    try{
      if(field.type==='checkbox'){
        await locator.setChecked(answer.value);
        if(field.required && !answer.value){question(field,'The required checkbox needs an explicit yes answer');continue;}
      }else if(field.type==='select')await locator.selectOption(answer.value);
      else if(field.type==='radio')await radios.find(option=>option.value===answer.value).locator.check();
      else if(readOnly){if(String(field.value)!==answer.value)throw new Error('Read-only value differs from your saved answer');}
      else await locator.fill(answer.value);
      if(field.type!=='radio' && field.type!=='checkbox'){
        const actual=await locator.inputValue();
        const equal=field.type==='tel'?actual.replace(/\D/g,'')===answer.value.replace(/\D/g,''):field.type==='number'?Number(actual)===Number(answer.value):actual===answer.value;
        if(!equal)throw new Error('The field did not retain your saved answer');
      }
    }catch(error){question(field,`Could not enter the saved answer: ${error.message.split('\n')[0]}`);}
  }
  return {questions,errors};
}
export async function validationErrors(dialog) {
  return dialog.evaluate(root=>{
    const visible=el=>Boolean(el.getClientRects().length);
    const errors=Array.from(root.querySelectorAll('[role="alert"],.artdeco-inline-feedback__message,.fb-dash-form-element__error-message')).filter(visible).map(el=>el.textContent.trim()).filter(Boolean);
    for(const el of root.querySelectorAll('input,select,textarea'))if(visible(el)&&!el.disabled&&el.willValidate&&!el.checkValidity())errors.push(el.validationMessage||'A required field is incomplete');
    return [...new Set(errors)];
  });
}
