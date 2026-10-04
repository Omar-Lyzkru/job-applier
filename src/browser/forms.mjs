import {basename,extname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {normalizeQuestion,resolveAnswer} from '../domain.mjs';
import {savedAnswerKey} from '../answer-memory.mjs';

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
    const uploadName=el=>/^upload\s+(?:resume|résumé|cv)$/i.test((el.getAttribute('aria-label')||el.innerText||'').trim());
    const modernAreas=new Set();
    for(const button of root.querySelectorAll('button,[role="button"]')){
      if(!visible(button)||!uploadName(button))continue;
      for(let area=button.parentElement,depth=0;area&&area!==root&&depth<8;area=area.parentElement,depth++){
        // A document region has its own short label and no contact/screening fields.
        if(area.querySelector('select,textarea,input:not([type="radio"]):not([type="file"]):not([type="hidden"]),[role="combobox"],[role="textbox"]'))break;
        const labelled=Array.from(area.querySelectorAll('div,p,span,label,legend,h2,h3,h4')).some(el=>{
          const direct=Array.from(el.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join(' ').trim();
          return visible(el)&&/^(?:resume|résumé|cv)\s*\*?$/i.test(el.getAttribute('aria-label')||direct);
        });
        const radios=Array.from(area.querySelectorAll('input[type="radio"]'));
        if(labelled&&radios.every(radio=>/\.(?:pdf|docx?)$/i.test(labelOf(radio)))){modernAreas.add(area);break;}
      }
    }
    const modernUploads=[];
    for(const [index,area] of Array.from(modernAreas).entries()){
      area.setAttribute('data-applier-resume-region',String(index));
      if(area.querySelector('input[type="file"]'))continue;
      const buttons=Array.from(area.querySelectorAll('button,[role="button"]')).filter(el=>visible(el)&&uploadName(el));
      if(buttons.length){controls.push(buttons[0]);modernUploads.push({button:buttons[0],ambiguous:buttons.length!==1});}
    }
    const documentChooser=el=>{
      if(el.closest('.jobs-document-upload,.jobs-resume-upload'))return true;
      if(Array.from(modernAreas).some(area=>area.contains(el)))return true;
      const group=el.closest('fieldset,section');
      return Boolean(group?.querySelector('input[type="file"]') && /resume|résumé|\bcv\b/i.test(group.querySelector('legend,h2,h3')?.textContent||''));
    };
    const modernRadioGroups=new Map(),modernRadioQuestions=new Map();
    const questionKey=text=>String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    for(const group of root.querySelectorAll('fieldset[role="radiogroup"]')){
      if(documentChooser(group)||group.hasAttribute('aria-label')||group.hasAttribute('aria-labelledby')||group.querySelector('legend'))continue;
      const radios=Array.from(group.querySelectorAll('input[type="radio"]'));
      if(radios.length<2||!radios[0].name||radios.some(input=>input.name!==radios[0].name||input.disabled||!visible(input)))continue;
      const shared=radios[0].getAttribute('aria-label')||'';
      if(!questionKey(shared)||radios.some(input=>questionKey(input.getAttribute('aria-label')||'')!==questionKey(shared)))continue;
      // Hydrated groups repeat the question on every input. Its exact nearby
      // heading supplies the required marker; an unrelated heading cannot.
      const headings=Array.from(group.parentElement?.children||[]).filter(el=>el!==group&&visible(el)&&!el.querySelector('input,select,textarea')&&questionKey(labelText(el))===questionKey(shared));
      if(headings.length!==1)continue;
      const question=labelText(headings[0]);
      modernRadioQuestions.set(group,question);
      const extraControl=controls.some(control=>control!==group&&group.contains(control)&&!radios.includes(control)&&!control.matches('input[type="hidden"]:not([role]):not([contenteditable="true"])'));
      if(/^(?:resume|résumé|cv)\s*\*?$/i.test(question)||extraControl||controls.some(input=>input.type==='radio'&&input.name===radios[0].name&&!group.contains(input)))continue;
      const choices=new Map();
      for(const radio of radios){
        const labels=Array.from(radio.labels||[]).filter(visible).map(labelText).filter(Boolean);
        if(labels.length>1){choices.clear();break;}
        let choice=labels.length===1?labels[0]:'';
        // Some linked labels draw only the empty circle. The first local row
        // with one radio contains its visible sibling text, such as Yes or No.
        if(!choice)for(let row=radio.parentElement,depth=0;row&&row!==group&&depth<4;row=row.parentElement,depth++){
          if(row.querySelectorAll('input[type="radio"]').length!==1||row.querySelector('select,textarea,input:not([type="radio"]):not([type="hidden"]),[role="radio"]'))break;
          const text=labelText(row);
          if(text){choice=text;break;}
        }
        if(!choice||questionKey(choice)===questionKey(shared)){choices.clear();break;}
        choices.set(radio,choice);
      }
      if(choices.size!==radios.length||new Set(Array.from(choices.values()).map(questionKey)).size!==radios.length)continue;
      modernRadioGroups.set(group,{question,radios,choices});
    }
    controls.forEach((el,index)=>el.setAttribute('data-applier-control',String(index)));
    for(const el of controls){
      const upload=modernUploads.find(item=>item.button===el);
      if(upload){fields.push({label:'Resume',type:'file',required:true,value:'',options:[],id:el.getAttribute('data-applier-control'),uploadButton:true,ambiguousUpload:upload.ambiguous});continue;}
      const native=el.matches('input,select,textarea');
      const type=native && !(el.getAttribute('role')==='combobox' && el.tagName!=='SELECT')?(el.type|| (el.tagName==='TEXTAREA'?'textarea':'unsupported')):'unsupported';
      if (el.disabled || ['hidden','submit','button','reset'].includes(type) || (!visible(el) && type!=='file'))continue;
      if(!native){
        if(el.matches('[role="radiogroup"]')&&documentChooser(el)&&el.querySelector('input[type="radio"]')&&!el.querySelector('[role="radio"]'))continue;
        if(modernRadioGroups.has(el))continue;
        // Discover the visible widget even when its native backing input is hidden.
        // Custom controls are blockers until their semantics can be supported.
        if(el.parentElement.closest('[role="radiogroup"],[role="listbox"]'))continue;
        const selected=el.getAttribute('aria-checked')==='true'||el.getAttribute('aria-selected')==='true'||Boolean(el.querySelector('[aria-checked="true"],[aria-selected="true"]'))||Boolean(modernRadioQuestions.has(el)&&el.querySelector('input[type="radio"]:checked'));
        const value=selected?'Selected':el.getAttribute('aria-valuenow')||el.getAttribute('aria-valuetext')||el.value|| (el.matches('[contenteditable="true"],[role="textbox"],[role="combobox"]')?el.textContent:'');
        const label=modernRadioQuestions.get(el)||labelOf(el);
        const requiredChild=modernRadioQuestions.has(el)&&controls.some(control=>control!==el&&el.contains(control)&&(control.required||control.getAttribute('aria-required')==='true'));
        fields.push({label,type:'unsupported',required:el.getAttribute('aria-required')==='true'||requiredChild||/\*/.test(label),value,options:[],id:el.getAttribute('data-applier-control')});
        continue;
      }
      if(type==='radio'){
        const parent=el.closest('fieldset,[role="group"],.fb-dash-form-element');
        if(modernRadioQuestions.has(parent)&&!modernRadioGroups.has(parent))continue;
        const name=el.name||el.id;
        if(seen.has(name))continue;seen.add(name);
        const modern=modernRadioGroups.get(parent);
        const group=modern?.radios||controls.filter(input=>input.type==='radio' && (input.name||input.id)===name);
        const question=modern?.question||parent?.querySelector('legend,[id$="label"],.fb-dash-form-element__label')?.textContent.trim() || parent?.getAttribute('aria-label') || name;
        fields.push({label:question,type:'radio',documentSelection:documentChooser(el),required:parent?.getAttribute('aria-required')==='true'||group.some(input=>input.required||input.getAttribute('aria-required')==='true')||/\*/.test(question),value:group.find(input=>input.checked)?.value||'',options:group.map(input=>({label:modern?.choices.get(input)||labelOf(input),value:input.value,id:input.getAttribute('data-applier-control')})),id:el.getAttribute('data-applier-control')});
      }else{
        let label=labelOf(el);
        if(type==='file' && !/resume|résumé|\bcv\b/i.test(label)){
          const nearby=el.closest('fieldset,section,.jobs-document-upload')?.textContent||'';
          if(/resume|résumé|\bcv\b/i.test(nearby))label='Resume';
        }
        fields.push({label,type:el.tagName==='SELECT'?'select':type,required:el.required||el.getAttribute('aria-required')==='true'||/\*/.test(label),value:type==='checkbox'?el.checked:type==='file'?Array.from(el.files||[]).map(file=>file.name).join(', '):el.value||el.textContent||'',options:el.tagName==='SELECT'?Array.from(el.options).filter(option=>!option.disabled).map(option=>({label:option.textContent.trim(),value:option.value})):[],id:el.getAttribute('data-applier-control'),readOnly:Boolean(el.readOnly),...(el.pattern?{pattern:el.pattern}:{}),...(el.placeholder?{placeholder:el.placeholder}:{})});
      }
    }
    return fields;
  });
  return descriptors.map(descriptor=>{
    const {id,readOnly,uploadButton,ambiguousUpload,...field}=descriptor;
    return {field:{...field,key:normalizeQuestion(field.label)},readOnly,uploadButton,ambiguousUpload,locator:dialog.locator(`[data-applier-control="${id}"]`),radios:descriptor.type==='radio'?descriptor.options.map(option=>({...option,locator:dialog.locator(`[data-applier-control="${option.id}"]`)})):null};
  });
}
function hasValue(field) {return field.type==='checkbox'?field.value===true:String(field.value||'').trim()!=='';}
async function setNativeChecked(dialog,locator,value,signal){
  checkStopped(signal);if(await locator.isChecked()===value)return;
  const marker=randomUUID();
  const labelled=await locator.evaluate((input,marker)=>{
    const labels=Array.from(input.labels||[]).filter(label=>label.getClientRects().length&&getComputedStyle(label).visibility!=='hidden');
    if(labels.length!==1)return false;
    labels[0].setAttribute('data-applier-check-label',marker);return true;
  },marker);
  // LinkedIn draws some choice controls above a covered or zero-size input.
  // Its associated HTML label toggles that exact input; verify the result below.
  if(labelled)await dialog.locator(`[data-applier-check-label="${marker}"]`).click();
  else await locator.setChecked(value);
  checkStopped(signal);
  if(await locator.isChecked()!==value)throw new Error('The control did not retain the saved choice');
}
async function uploadResume(dialog,entry,{resumePath,signal,applicationState,uploadTimeout}) {
  if(!resumePath)throw new Error('No selected résumé');
  if(entry.ambiguousUpload)throw new Error('More than one résumé upload action was found');
  checkStopped(signal);
  const end=Date.now()+uploadTimeout;
  // A fresh unique filename identifies this exact upload. Reusing an employer's
  // old same-named document can never satisfy the acceptance check below.
  const extension=extname(resumePath).toLowerCase();
  const filename=`${basename(resumePath,extname(resumePath)).slice(0,140)}-applier-${randomUUID()}${extension}`;
  const mimeType={'.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[extension];
  const payload={name:filename,mimeType,buffer:await readFile(resumePath)};
  checkStopped(signal);
  if(entry.uploadButton){
    const page=dialog.page();
    const chooser=await new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);page.off('filechooser',opened);signal?.removeEventListener('abort',aborted);};
      const failed=error=>{cleanup();reject(error);};
      const opened=event=>{cleanup();resolve(event);};
      const aborted=()=>failed(new Error('Stopped before submission'));
      page.on('filechooser',opened);signal?.addEventListener('abort',aborted,{once:true});
      timer=setTimeout(()=>failed(new Error('The résumé file chooser did not open')),Math.max(1,end-Date.now()));
      entry.locator.click({timeout:Math.max(1,end-Date.now())}).catch(failed);
    });
    checkStopped(signal);await chooser.setFiles(payload,{timeout:Math.max(1,end-Date.now())});
  }else await entry.locator.setInputFiles(payload,{timeout:Math.max(1,end-Date.now())});
  while(Date.now()<end){
    checkStopped(signal);
    const choices=(await discoverFields(dialog)).filter(item=>item.field.documentSelection)
      .flatMap(item=>item.radios||[]).filter(option=>option.label.includes(filename));
    if(choices.length===1){
      const choice=choices[0];
      const busy=await choice.locator.evaluate(el=>{
        const area=el.closest('[data-applier-resume-region],.jobs-document-upload,.jobs-resume-upload,section,fieldset');
        return Boolean(area?.closest('[aria-busy="true"]') || area?.querySelector('[aria-busy="true"],[role="progressbar"]'));
      });
      if(!busy){
        await setNativeChecked(dialog,choice.locator,true,signal);
        if(await choice.locator.isChecked()){
          applicationState.resumeName=filename;applicationState.resumeVerified=true;return;
        }
      }
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Upload was not confirmed as the selected application document');
}
export async function fillApplicationFields(dialog,{profile,answers,resumePath,signal,company='',applicationState={},uploadTimeout=10000}) {
  const questions=[],errors=[];
  let fields=await discoverFields(dialog);
  const question=(field,reason,blocker='operational',suggestions=[])=>questions.push({key:field.key,label:field.label,type:field.type,required:field.required,company,answerKey:savedAnswerKey({...field,company}),options:field.options.map(({label,value})=>({label,value})),...(field.pattern?{pattern:field.pattern}:{}),...(field.placeholder?{placeholder:field.placeholder}:{}),reason,blocker,suggestions});
  for(const entry of fields.filter(entry=>entry.field.type==='file')){
    checkStopped(signal);
    if(!/resume|résumé|\bcv\b/i.test(entry.field.label)){
      if(entry.field.required||hasValue(entry.field))question(entry.field,'This upload needs a file the app does not have');
      continue;
    }
    try{
      if(!applicationState.resumeVerified)await uploadResume(dialog,entry,{resumePath,signal,applicationState,uploadTimeout});
    }catch(error){checkStopped(signal);errors.push(`Résumé: ${error.message.split('\n')[0]}`);}
  }
  // Uploading adds controls asynchronously; rebuild locators after acceptance.
  fields=await discoverFields(dialog);
  for(const entry of fields){
    checkStopped(signal);
    const {field:discovered,locator,radios,readOnly}=entry;
    const field={...discovered,company};
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
      if(answer.manual){
        if(field.required||hasValue(field))question({...field,type:'unsupported'},answer.reason,'operational',answer.suggestions);
        continue;
      }
      if(field.required){question(field,answer.reason,'missing_answer',answer.suggestions);continue;}
      if(!hasValue(field))continue;
      try{
        if(readOnly)throw new Error('The prefilled value cannot be cleared');
        if(field.type==='checkbox')await setNativeChecked(dialog,locator,false,signal);
        else if(field.type==='select' && field.options.some(option=>option.value===''))await locator.selectOption('');
        else if(field.type==='radio'||field.type==='select')throw new Error('The prefilled choice cannot be cleared safely');
        else await locator.fill('');
      }catch{question(field,'Unknown prefilled answer cannot be cleared safely');}
      continue;
    }
    try{
      if(field.type==='checkbox'){
        await setNativeChecked(dialog,locator,answer.value,signal);
        if(field.required && !answer.value){question(field,'The required checkbox needs an explicit yes answer');continue;}
      }else if(field.type==='select'){
        await locator.selectOption({label:answer.optionLabel});
        const selected=await locator.locator('option:checked').textContent();
        if(normalizeQuestion(selected)!==normalizeQuestion(answer.optionLabel))throw new Error('The field did not retain the saved choice');
      }
      else if(field.type==='radio'){
        const choices=radios.filter(option=>normalizeQuestion(option.label)===normalizeQuestion(answer.optionLabel));
        if(choices.length!==1)throw new Error('Could not identify the exact saved choice');
        await setNativeChecked(dialog,choices[0].locator,true,signal);
      }
      else if(readOnly){if(String(field.value)!==answer.value)throw new Error('Read-only value differs from your saved answer');}
      else await locator.fill(answer.value);
      if(field.type!=='radio' && field.type!=='checkbox'){
        const actual=await locator.inputValue();
        const equal=field.type==='tel'?actual.replace(/\D/g,'')===answer.value.replace(/\D/g,''):field.type==='number'?Number(actual)===Number(answer.value):actual===answer.value;
        if(!equal)throw new Error('The field did not retain your saved answer');
      }
      if(answer.match!=='profile'&&answer.sourceQuestion!==field.key){
        applicationState.answerMatches ||= [];
        const match={label:field.label,company,answer:answer.answer,sourceQuestion:answer.sourceQuestion};
        const index=applicationState.answerMatches.findIndex(previous=>previous.label===field.label&&previous.company===company);
        if(index<0)applicationState.answerMatches.push(match);else applicationState.answerMatches[index]=match;
      }
    }catch(error){question(field,`Could not enter the saved answer: ${error.message.split('\n')[0]}`);}
  }
  return {questions,errors};
}
export async function validationErrors(dialog,{resumeVerified=false}={}) {
  return dialog.evaluate((root,resumeVerified)=>{
    const visible=el=>Boolean(el.getClientRects().length);
    const errors=Array.from(root.querySelectorAll('[role="alert"],.artdeco-inline-feedback__message,.fb-dash-form-element__error-message')).filter(visible).map(el=>el.textContent.trim()).filter(message=>message && !(resumeVerified && /^r[eé]sum[eé] uploaded successfully[.!]?$/i.test(message.replace(/\s+/g,' '))));
    for(const el of root.querySelectorAll('input,select,textarea'))if(visible(el)&&!el.disabled&&el.willValidate&&!el.checkValidity())errors.push(el.validationMessage||'A required field is incomplete');
    return [...new Set(errors)];
  },resumeVerified===true);
}
