import {allowedBankScopes} from '../answer-bank.mjs';
import {basename,extname} from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {normalizeQuestion,resolveAnswer} from '../domain.mjs';
import {makeBlocker} from '../application-lifecycle.mjs';
import {savedAnswerKey} from '../answer-memory.mjs';

export function checkStopped(signal) {
  if (signal?.aborted) throw new Error('Stopped before submission');
}
export async function discoverFields(dialog) {
  const descriptors=await dialog.evaluate(root=>{
    const controls=Array.from(root.querySelectorAll('input,select,textarea,[role="combobox"],[role="checkbox"],[role="switch"],[role="radiogroup"],[role="radio"],[role="listbox"],[role="option"],[role="spinbutton"],[role="textbox"],[contenteditable="true"]'));
    const seen=new Set(),fields=[];
    const resumeLabel=label=>/resume|résumé|\bcv\b/i.test(label)&&! /cover\s*letter|transcript|certificate|portfolio|reference|supporting|additional|work\s*sample/i.test(label);
    const visible=el=>Boolean(el.getClientRects().length) && getComputedStyle(el).visibility!=='hidden';
    const labelText=el=>{
      const copy=el.cloneNode(true);
      copy.querySelectorAll('input,select,textarea,[aria-hidden="true"]').forEach(control=>control.remove());
      return copy.textContent.trim();
    };
    const consentContext=el=>{
      const area=el.closest('fieldset,.fb-dash-form-element');
      if(!area||area.querySelectorAll('fieldset').length)return undefined;
      const text=labelText(area);
      return /\b(?:sms|text messages?|consent)\b/i.test(text)&&text.length<=4000?text:undefined;
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
    for(const el of root.querySelectorAll('[data-applier-control],[data-applier-resume-picker]')){el.removeAttribute('data-applier-control');el.removeAttribute('data-applier-resume-picker');}
    controls.forEach((el,index)=>el.setAttribute('data-applier-control',String(index)));
    for(const el of controls){
      const upload=modernUploads.find(item=>item.button===el);
      if(upload){fields.push({label:'Resume',type:'file',required:true,value:'',options:[],id:el.getAttribute('data-applier-control'),uploadButton:true,resumeUpload:true,ambiguousUpload:upload.ambiguous});continue;}
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
        fields.push({label:question,type:'radio',consentText:consentContext(el),documentSelection:documentChooser(el),required:parent?.getAttribute('aria-required')==='true'||group.some(input=>input.required||input.getAttribute('aria-required')==='true')||/\*/.test(question),value:group.find(input=>input.checked)?.value||'',selectedLabel:group.find(input=>input.checked)?(modern?.choices.get(group.find(input=>input.checked))||labelOf(group.find(input=>input.checked))):'',scope:parent?.querySelector('legend')?.textContent||parent?.getAttribute('aria-label')||'',options:group.map(input=>({label:modern?.choices.get(input)||labelOf(input),value:input.value,id:input.getAttribute('data-applier-control')})),id:el.getAttribute('data-applier-control')});
      }else{
        let label=labelOf(el);
        if(type==='file'&&!resumeLabel(label)){
          const explicit=el.getAttribute('aria-label')||el.getAttribute('aria-labelledby')||Array.from(el.labels||[]).some(label=>labelText(label))||el.placeholder;
          const area=el.closest('fieldset,section,.jobs-document-upload');
          if(!explicit&&/^(?:unlabeled field|file|upload|attachment|document|file[-_ ](?:upload|input))$/i.test(label)&&area?.querySelectorAll('input[type=file]').length===1&&resumeLabel(area.querySelector('legend,h2,h3')?.textContent||''))label='Resume';
        }
        const resumeUpload=type==='file'&&resumeLabel(label);
        if(resumeUpload)el.setAttribute('data-applier-resume-picker','true');
        fields.push({label,...(type==='file'?{resumeUpload}:{}),consentText:consentContext(el),type:el.tagName==='SELECT'?'select':type,required:el.required||el.getAttribute('aria-required')==='true'||/\*/.test(label),value:type==='checkbox'?el.checked:type==='file'?Array.from(el.files||[]).map(file=>file.name).join(', '):typeof el.value==='string'?el.value:el.textContent||'',options:el.tagName==='SELECT'?Array.from(el.options).filter(option=>!option.disabled).map(option=>({label:option.textContent.trim(),value:option.value})):[],id:el.getAttribute('data-applier-control'),readOnly:Boolean(el.readOnly),selectedLabel:el.tagName==='SELECT'?el.selectedOptions[0]?.textContent.trim():'',...(el.min?{min:el.min}:{}),...(el.max?{max:el.max}:{}),...(el.step?{step:el.step}:{}),...(el.maxLength>=0?{maxLength:el.maxLength}:{}),...(el.pattern?{pattern:el.pattern}:{}),...(el.placeholder?{placeholder:el.placeholder}:{})});
      }
    }
    return fields;
  });
  return descriptors.map(descriptor=>{
    const {id,readOnly,uploadButton,ambiguousUpload,...field}=descriptor;
    return {field:{...field,readOnly:Boolean(readOnly),key:normalizeQuestion(field.label)},readOnly,uploadButton,ambiguousUpload,locator:dialog.locator(`[data-applier-control="${id}"]`),radios:descriptor.type==='radio'?descriptor.options.map(option=>({...option,locator:dialog.locator(`[data-applier-control="${option.id}"]`)})):null};
  });
}
function hasValue(field) {return field.type==='checkbox'?field.value===true:String(field.value||'').trim()!=='';}
async function setNativeChecked(dialog,locator,value,signal,timeout=10000){
 checkStopped(signal);if(await locator.isChecked()===value)return;
 const marker=randomUUID();const labelled=await locator.evaluate((input,marker)=>{
  const labels=Array.from(input.labels||[]).filter(label=>label.getClientRects().length&&getComputedStyle(label).visibility!=='hidden');
  if(labels.length!==1)return false;labels[0].setAttribute('data-applier-check-label',marker);return true;
 },marker);
 if(labelled)await dialog.locator(`[data-applier-check-label="${marker}"]`).click({timeout});else await locator.setChecked(value,{timeout});
 checkStopped(signal);
 // Caller verifies a freshly discovered semantic control after any native change.
}
// Receipts exist only for byte-verified uploads in this browser/authentication session.
// A document with the same original filename never creates a receipt.
const resumeReceipts=new WeakMap();
async function resumeRegistry(dialog){
  const page=dialog.page(),context=page.context();
  const cookies=await context.cookies(page.url()).catch(()=>[]);
  const auth=cookies.filter(cookie=>cookie.name==='li_at'&&cookie.value);
  if(auth.length!==1){resumeReceipts.delete(context);return null;}
  const session=createHash('sha256').update(JSON.stringify([auth[0].domain,auth[0].path,auth[0].value])).digest('hex');
  let registry=resumeReceipts.get(context);
  if(!registry||registry.session!==session){registry={session,files:new Map()};resumeReceipts.set(context,registry);}
  return registry;
}
async function selectedResume(dialog,filename,{signal,end}){
  while(Date.now()<end){
    checkStopped(signal);
    const choices=(await discoverFields(dialog)).filter(item=>item.field.documentSelection)
      .flatMap(item=>item.radios||[]).filter(option=>option.label.includes(filename));
    if(choices.length>1)throw new Error('More than one matching résumé document was found');
    if(choices.length===1){
      const choice=choices[0];
      const busy=await choice.locator.evaluate(el=>{
        const area=el.closest('[data-applier-resume-region],.jobs-document-upload,.jobs-resume-upload,section,fieldset');
        return Boolean(area?.closest('[aria-busy="true"]') || area?.querySelector('[aria-busy="true"],[role="progressbar"]'));
      });
      if(!busy){
        await setNativeChecked(dialog,choice.locator,true,signal);
        const freshChoices=(await discoverFields(dialog)).filter(item=>item.field.documentSelection).flatMap(item=>item.radios||[]).filter(option=>option.label.includes(filename));
        if(freshChoices.length===1&&await freshChoices[0].locator.isChecked()){
          return;
        }
      }
    }
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error('Résumé was not confirmed as the selected application document');
}
async function uploadResume(dialog,entry,{resumePath,signal,applicationState,uploadTimeout}) {
  if(!resumePath)throw new Error('No selected résumé');
  if(entry.ambiguousUpload)throw new Error('More than one résumé upload action was found');
  checkStopped(signal);
  const end=Date.now()+uploadTimeout;
  const extension=extname(resumePath).toLowerCase();
  let filename=`${basename(resumePath,extname(resumePath)).slice(0,140)}-applier-${randomUUID()}${extension}`;
  const mimeType={'.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}[extension];
  const buffer=await readFile(resumePath),fingerprint=createHash('sha256').update(extension).update('\0').update(buffer).digest('hex');
  const registry=await resumeRegistry(dialog),known=registry?.files.get(fingerprint);
  const confirm=async(reused)=>{
    await selectedResume(dialog,filename,{signal,end});checkStopped(signal);
    if(await resumeRegistry(dialog)!==registry)throw new Error('The signed-in session changed while selecting the résumé');
    applicationState.resumeName=filename;applicationState.resumeVerified=true;applicationState.resumeReused=reused;
    if(registry){registry.files.set(fingerprint,filename);if(registry.files.size>8)registry.files.delete(registry.files.keys().next().value);}
  };
  if(known){
    const choices=(await discoverFields(dialog)).filter(item=>item.field.documentSelection).flatMap(item=>item.radios||[]).filter(option=>option.label.includes(known));
    if(choices.length){filename=known;await confirm(true);return;}
    registry.files.delete(fingerprint);
  }
  const payload={name:filename,mimeType,buffer};
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
  await confirm(false);
}

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function fieldIdentity(field){return hash([field.label,field.type,field.scope||'',Boolean(field.required),field.pattern||'',field.placeholder||'',field.min||'',field.max||'',field.step||'',field.maxLength??null,(field.options||[]).map(option=>option.label)]);}
function questionFor(field,company,reason,blocker='operational',suggestions=[]){return {...Object.fromEntries(['readOnly','min','max','step','maxLength','consentText','jobId'].filter(k=>field[k]!==undefined).map(k=>[k,field[k]])),key:field.key,label:field.label,type:field.type,required:field.required,company,answerKey:savedAnswerKey({...field,company}),options:field.options.map(({label,value})=>({label,value})),...(field.pattern?{pattern:field.pattern}:{}),...(field.placeholder?{placeholder:field.placeholder}:{}),reason,blocker,suggestions};}
function desired(entry,options){
 const field={...entry.field,company:options.company||'',jobId:options.jobId};if(field.documentSelection||field.type==='file'||field.type==='unsupported')return null;
 const answer=resolveAnswer(field,options.profile||{},options.answers||{},{answerBank:options.answerBank});
 if(answer.kind==='fill')return answer;
 if(field.required||answer.manual)return null;
 if(field.type==='checkbox')return {kind:'fill',value:false};
 if(['radio','select'].includes(field.type)){if(field.type==='select'&&field.options.some(o=>o.value===''))return {kind:'fill',value:'',optionLabel:field.options.find(o=>o.value==='').label};return null;}
 return {kind:'fill',value:''};
}
function retained(entry,answer){
 const f=entry.field;
 if(['radio','select'].includes(f.type))return normalizeQuestion(f.selectedLabel)===normalizeQuestion(answer.optionLabel);
 if(f.type==='checkbox')return f.value===answer.value;
 if(f.type==='tel')return String(f.value).replace(/\D/g,'')===String(answer.value).replace(/\D/g,'');
 if(f.type==='number'&&String(f.value)!=='')return Number(f.value)===Number(answer.value);
 return String(f.value)===String(answer.value);
}
async function pause(ms,signal){const end=Date.now()+ms;while(Date.now()<end){checkStopped(signal);await new Promise(resolve=>setTimeout(resolve,Math.min(50,end-Date.now())));}checkStopped(signal);}
async function safeStructure(dialog,fields,applicationState){
 const details=await dialog.evaluate((root,resumeVerified)=>{
  const categories=new Set();const visible=el=>Boolean(el.getClientRects().length);
  for(const el of root.querySelectorAll('input,select,textarea'))if(!el.disabled&&el.willValidate&&(visible(el)||el.type==='radio'))for(const key of ['valueMissing','typeMismatch','patternMismatch','tooLong','tooShort','rangeUnderflow','rangeOverflow','stepMismatch','badInput','customError'])if(el.validity[key])categories.add(key);
  if(Array.from(root.querySelectorAll('[role=alert],.artdeco-inline-feedback__message,.fb-dash-form-element__error-message')).some(el=>visible(el)&&el.textContent.trim()&&!(resumeVerified&&/^r[eé]sum[eé] uploaded successfully[.!]?$/i.test(el.textContent.trim()))))categories.add('employer_feedback');
    const loading=Array.from(root.querySelectorAll('[role=progressbar]')).filter(visible).some(bar=>{
   const now=Number(bar.getAttribute('aria-valuenow'));if(!bar.hasAttribute('aria-valuenow')||bar.getAttribute('aria-valuemin')!=='0'||bar.getAttribute('aria-valuemax')!=='100'||!Number.isFinite(now)||now<0||now>100)return true;
   for(let area=bar.parentElement,depth=0;area&&area!==root&&depth<2;area=area.parentElement,depth++){
    if(area.querySelector('input,select,textarea,button,[role=button],[role=combobox]')||area.querySelectorAll('[role=progressbar]').length!==1)break;
    for(const label of area.querySelectorAll('p,span,div')){if(label.children.length||!visible(label))continue;const match=label.textContent.trim().match(/^(\d+)\s*\/\s*(\d+)\s+pages?$/i);if(match){const page=Number(match[1]),total=Number(match[2]);if(page>=1&&page<=total&&Math.abs(now-page/total*100)<=1)return false;}}
   }return true;
  });
  return {validationCategories:[...categories],busy:loading||root.matches('[aria-busy=true]')||Array.from(root.querySelectorAll('[aria-busy=true]')).some(visible)};
 },applicationState?.resumeVerified===true);
 const controlCounts={};for(const {field} of fields)controlCounts[field.type]=(controlCounts[field.type]||0)+1;
 return {...details,controlCounts,fingerprints:fields.filter(e=>!e.field.documentSelection&&e.field.type!=='file').map(e=>fieldIdentity(e.field))};
}
export async function verifyApplicationFields(dialog,options={}){
 checkStopped(options.signal);const fields=await discoverFields(dialog),questions=[],blockers=[],errors=[];
 const company=options.company||'',state=options.applicationState||{},identities=new Map();
 for(const e of fields){const id=fieldIdentity(e.field);identities.set(id,(identities.get(id)||0)+1);}
 const add=(field,reason,code,suggestions=[])=>{questions.push(questionFor({...field,jobId:options.jobId},company,reason,code==='missing_answer'?'missing_answer':'operational',suggestions));blockers.push(makeBlocker(code,{phase:'form',controlFingerprint:fieldIdentity(field)}));};
 for(const entry of fields){
  checkStopped(options.signal);const f=entry.field;
  if(f.documentSelection){const matches=entry.radios?.filter(o=>state.resumeVerified&&o.label.includes(state.resumeName))||[];if(matches.length!==1||!await matches[0].locator.evaluateAll(inputs=>inputs.length===1&&inputs[0].checked))add(f,'Could not verify the selected résumé','resume_upload');continue;}
  if(f.type==='file'){if(f.resumeUpload){const current=state.resumeVerified&&await entry.locator.evaluateAll((elements,name)=>{
      if(elements.length!==1)return false;const el=elements[0];
      const area=el.closest('[data-applier-resume-region],.jobs-document-upload,.jobs-resume-upload,section,fieldset')||el.parentElement;
      const matches=Array.from(area?.querySelectorAll('input[type=radio]')||[]).filter(radio=>[radio.getAttribute('aria-label')||'',...(radio.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||''),...Array.from(radio.labels||[]).map(label=>label.textContent)].some(label=>label.includes(name)));
      return matches.length===1&&matches[0].checked;
    },state.resumeName);if(!current)add(f,'The selected résumé has not been verified','resume_upload');}else if(f.required||hasValue(f))add(f,'This upload needs a file the app does not have','unsupported_control');continue;}
  if(identities.get(fieldIdentity(f))!==1){add(f,'More than one compatible field was found','form_changed');continue;}
  if(f.type==='unsupported'){if(f.required||hasValue(f))add(f,'This control is not supported automatically','unsupported_control');continue;}
  const answer=resolveAnswer({...f,company,jobId:options.jobId},options.profile||{},options.answers||{},{answerBank:options.answerBank}),target=desired(entry,options);
  const confirmable=answer.manual&&options.answerBank&&allowedBankScopes({...f,company,jobId:options.jobId}).length>0;
  if(answer.kind==='missing'&&f.required){add(answer.manual&&!confirmable?{...f,type:'unsupported'}:f,answer.reason,answer.manual&&!confirmable?'unsupported_control':'missing_answer',answer.suggestions);continue;}
  if(answer.manual&&(f.required||hasValue(f))){add(confirmable?f:{...f,type:'unsupported'},answer.reason,confirmable?'missing_answer':'unsupported_control',answer.suggestions);continue;}
  if(!target){if(hasValue(f))add(f,'Unknown prefilled answer cannot be cleared safely','entry_verification');continue;}
  if(!retained(entry,target))add(f,'The field did not retain the saved answer','entry_verification');
  else if(f.type==='checkbox'&&f.required&&!target.value)add(f,'The required checkbox needs an explicit yes answer','unsupported_control');
 }
 const validation=await validationErrors(dialog,state);errors.push(...validation);
 const structure=await safeStructure(dialog,fields,state);
 if(validation.length)blockers.push(makeBlocker('validation',{phase:'form'}));if(structure.busy)blockers.push(makeBlocker('form_changed',{phase:'form'}));
 return {ok:!questions.length&&!errors.length&&!structure.busy,questions,errors,blockers,signature:hash(fields.map(e=>[fieldIdentity(e.field),e.field.value,e.field.selectedLabel])),safeStructure:structure};
}
export async function fillApplicationFields(dialog,options){
 const {signal,applicationState={},resumePath,uploadTimeout=10000,actionTimeout=10000,quietMs=300,maxPasses=8,onAction}=options;options={...options,applicationState};
 const end=Date.now()+actionTimeout,failures=new Map();let uploadError=null;
 const remaining=()=>Math.max(1,end-Date.now());
 const trace=(kind,retries,start)=>{applicationState.actions ||= [];if(applicationState.actions.length<100)applicationState.actions.push({kind,retries,durationMs:Math.min(60000,Math.max(0,Date.now()-start))});};
 for(const entry of (await discoverFields(dialog)).filter(e=>e.field.type==='file'&&e.field.resumeUpload)){
  const start=Date.now(),needed=!applicationState.resumeVerified;
  try{if(needed)await uploadResume(dialog,entry,{resumePath,signal,applicationState,uploadTimeout:Math.min(uploadTimeout,remaining())});}
  catch(error){checkStopped(signal);uploadError=`Résumé: ${error.message.split('\n')[0]}`;}finally{if(needed)trace(applicationState.resumeReused?'select':'upload',0,start);}
 }
 for(let pass=0;pass<maxPasses&&Date.now()<end;pass++){
  checkStopped(signal);let acted=false;const scanned=await discoverFields(dialog);
  for(const original of scanned){
   checkStopped(signal);const fingerprint=fieldIdentity(original.field);
   if(original.field.documentSelection||['file','unsupported'].includes(original.field.type))continue;
   let fresh=(await discoverFields(dialog)).filter(e=>fieldIdentity(e.field)===fingerprint);if(fresh.length!==1)continue;
   let entry=fresh[0],answer=desired(entry,options);if(!answer||retained(entry,answer))continue;
   if(failures.has(fingerprint))continue;
   for(let retry=0;retry<2;retry++){
    checkStopped(signal);if(Date.now()>=end)break;fresh=(await discoverFields(dialog)).filter(e=>fieldIdentity(e.field)===fingerprint);if(fresh.length!==1)break;entry=fresh[0];answer=desired(entry,options);if(!answer||retained(entry,answer))break;
    await onAction?.({operation:entry.field.type,controlFingerprint:fingerprint,retry});checkStopped(signal);const actionStart=Date.now();
    try{
     if(entry.readOnly)throw new Error('Read-only value differs from your saved answer');
     if(entry.field.type==='checkbox')await setNativeChecked(dialog,entry.locator,answer.value,signal,remaining());
     else if(entry.field.type==='radio'){const choices=entry.radios.filter(o=>normalizeQuestion(o.label)===normalizeQuestion(answer.optionLabel));if(choices.length!==1)throw new Error('Could not identify exact choice');await setNativeChecked(dialog,choices[0].locator,true,signal,remaining());}
     else if(entry.field.type==='select')await entry.locator.selectOption({label:answer.optionLabel},{timeout:remaining()});
     else await entry.locator.fill(answer.value,{timeout:remaining()});
     acted=true;
    }catch(error){checkStopped(signal);if(retry===1)failures.set(fingerprint,makeBlocker(error.name==='TimeoutError'?'entry_timeout':'entry_verification',{phase:'form',controlFingerprint:fingerprint}));}finally{trace(['radio','checkbox'].includes(entry.field.type)?'check':entry.field.type==='select'?'select':'fill',retry,actionStart);}
    const after=(await discoverFields(dialog)).filter(e=>fieldIdentity(e.field)===fingerprint);
    if(after.length===1&&retained(after[0],answer)){
     failures.delete(fingerprint);
     if(answer.sourceQuestion&&answer.match!=='profile'&&answer.sourceQuestion!==entry.field.key){applicationState.answerMatches ||= [];const match={label:entry.field.label,company:options.company||'',answer:answer.answer,sourceQuestion:answer.sourceQuestion};const index=applicationState.answerMatches.findIndex(m=>m.label===match.label&&m.company===match.company);if(index<0)applicationState.answerMatches.push(match);else applicationState.answerMatches[index]=match;}
     break;
    }
    if(retry===1)failures.set(fingerprint,makeBlocker('entry_verification',{phase:'form',controlFingerprint:fingerprint}));
   }
  }
  const before=await verifyApplicationFields(dialog,options);await pause(Math.min(quietMs,remaining()),signal);const final=await verifyApplicationFields(dialog,options);
  if(!acted&&before.signature===final.signature&&!final.safeStructure.busy||before.ok&&final.ok&&before.signature===final.signature){
   if(uploadError){final.errors.unshift(uploadError);final.blockers.unshift(makeBlocker('resume_upload',{phase:'form'}));}
   for(const [fingerprint,blocker] of failures)if(final.safeStructure.fingerprints.includes(fingerprint)&&final.questions.some(q=>fieldIdentity(q)===fingerprint))final.blockers.push(blocker);
   // Missing answers are reported as questions, without duplicating native required validation.
   if(final.questions.length)final.errors=uploadError?[uploadError]:[];
   return final.questions.length||final.errors.length||final.blockers.length?{questions:final.questions,errors:final.errors,blockers:final.blockers}:{questions:[],errors:[]};
  }
 }
 const final=await verifyApplicationFields(dialog,options);return {questions:final.questions,errors:uploadError?[uploadError]:final.errors,blockers:[makeBlocker('form_changed',{phase:'form'}),...final.blockers]};
}
export async function validationErrors(dialog,{resumeVerified=false,resumeName=null}={}) {
  return dialog.evaluate((root,{resumeVerified,resumeName})=>{
    const visible=el=>Boolean(el.getClientRects().length);
    const errors=Array.from(root.querySelectorAll('[role="alert"],.artdeco-inline-feedback__message,.fb-dash-form-element__error-message')).filter(visible).map(el=>el.textContent.trim()).filter(message=>message && !(resumeVerified && /^r[eé]sum[eé] uploaded successfully[.!]?$/i.test(message.replace(/\s+/g,' '))));
    for(const el of root.querySelectorAll('input,select,textarea'))if(visible(el)&&!el.disabled&&el.willValidate&&!el.checkValidity()){
      // An upload picker adds files; an accepted selected document satisfies the résumé.
      // Keep custom processing errors and every unrelated control's native validation.
      if(el.type==='file'&&el.getAttribute('data-applier-resume-picker')==='true'&&el.validity.valueMissing&&!el.validity.customError&&resumeVerified&&resumeName){
        const area=el.closest('[data-applier-resume-region],.jobs-document-upload,.jobs-resume-upload,section,fieldset');
        const matches=Array.from(area?.querySelectorAll('input[type=radio]')||[]).filter(radio=>[radio.getAttribute('aria-label')||'',...(radio.getAttribute('aria-labelledby')||'').split(/\s+/).filter(Boolean).map(id=>document.getElementById(id)?.textContent||''),...Array.from(radio.labels||[]).map(label=>label.textContent)].some(label=>label.includes(resumeName)));
        const busy=area?.closest('[aria-busy="true"]')||area?.querySelector('[aria-busy="true"],[role="progressbar"]');
        if(matches.length===1&&matches[0].checked&&!busy)continue;
      }
      errors.push(el.validationMessage||'A required field is incomplete');
    }
    return [...new Set(errors)];
  },{resumeVerified:resumeVerified===true,resumeName});
}
