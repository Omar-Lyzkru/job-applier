// Matches the observed hydrated layout: text-labelled div, sibling chooser div,
// unnamed fieldset/radiogroup, native radios named by aria-label, and upload button.
// The upload input is created only after the button is clicked and stays detached.
export function modernApplication({delay=20,fail=false,ambiguous=false,screening=false,overlayCheckbox=false,requiredResume=false,hiddenDocumentRadios=false,coverLetter=false}={}){
  return `<!doctype html><html><body>${hiddenDocumentRadios?'<style>#resume-region input[type=radio]{width:0;height:0}</style>':''}<div role="dialog" aria-label="Apply">
  <div id="resume-region"><div>Resume${requiredResume?'*':''}<p>Select or upload a resume in DOC, DOCX, or PDF format that is less than 2MB</p></div>
    <div><fieldset role="radiogroup"><div role="button" tabindex="0"><div>PDF <span>selected-resume.pdf</span> 10/2/2026</div><div><input type="radio" id="old-document" name="radio-group-_r_d_" value="old-document" aria-label="selected-resume.pdf" checked>${hiddenDocumentRadios?'<label for="old-document">Choose selected-resume.pdf</label>':''}</div></div></fieldset>
    <div><button type="button" id="upload">Upload resume</button>${ambiguous?'<button type="button">Upload resume</button>':''}</div></div>
  </div>
  ${coverLetter?'<div><div>Cover letter<p>Be sure to include an updated cover letter</p></div><div><fieldset role="radiogroup"></fieldset><button type="button" id="cover-upload">Upload cover letter</button></div></div>':''}
  ${screening?'<fieldset><legend>Can you provide a CV?</legend><label><input type="radio" name="screening-cv" value="yes" required>Yes</label><label><input type="radio" name="screening-cv" value="no" required>No</label></fieldset>':''}
  ${overlayCheckbox?'<label><input type="checkbox" name="follow" style="pointer-events:none" checked>Follow Vilo to stay up to date with their page</label>':''}
  <button type="button">Submit application</button></div>
  <script>
  window.uploadClicks=0;window.acceptedDocument=null;window.uploadedPayload=null;
  window.coverUploadClicks=0;document.querySelector('#cover-upload')?.addEventListener('click',()=>window.coverUploadClicks++);
  const region=document.querySelector('#resume-region');
  document.querySelector('#upload').onclick=()=>{
    window.uploadClicks++;
    const input=document.createElement('input');input.type='file';input.accept='.pdf,.doc,.docx';
    input.onchange=async()=>{
      const file=input.files[0];if(!file)return;
      window.uploadedPayload={name:file.name,content:await file.text()};
      const card=document.createElement('div');card.setAttribute('role','button');
      const text=document.createElement('span');text.textContent=file.name;
      const radio=document.createElement('input');radio.type='radio';radio.id='new-document';radio.name='radio-group-_r_d_';radio.value='new-document';radio.setAttribute('aria-label',file.name);
      card.append(text,radio);
      if(${JSON.stringify(hiddenDocumentRadios)}){const label=document.createElement('label');label.htmlFor=radio.id;label.textContent='Choose '+file.name;card.append(label);}
      region.querySelector('fieldset').append(card);
      region.setAttribute('aria-busy','true');
      setTimeout(()=>{
        if(${JSON.stringify(fail)})return;
        region.removeAttribute('aria-busy');window.acceptedDocument=window.uploadedPayload;
      },${JSON.stringify(delay)});
    };
    input.click();
  };
  </script></body></html>`;
}
