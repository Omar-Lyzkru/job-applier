// Matches the observed hydrated layout: text-labelled div, sibling chooser div,
// unnamed fieldset/radiogroup, native radios named by aria-label, and upload button.
// The upload input is created only after the button is clicked and stays detached.
export function modernApplication({delay=20,fail=false,ambiguous=false,screening=false,overlayCheckbox=false}={}){
  return `<!doctype html><html><body><div role="dialog" aria-label="Apply">
  <div id="resume-region"><div>Resume<p>Select or upload a resume in DOC, DOCX, or PDF format that is less than 2MB</p></div>
    <div><fieldset role="radiogroup"><div role="button" tabindex="0"><div>PDF <span>selected-resume.pdf</span> 10/2/2026</div><div><input type="radio" name="radio-group-_r_d_" value="old-document" aria-label="selected-resume.pdf" checked></div></div></fieldset>
    <div><button type="button" id="upload">Upload resume</button>${ambiguous?'<button type="button">Upload resume</button>':''}</div></div>
  </div>
  ${screening?'<fieldset><legend>Can you provide a CV?</legend><label><input type="radio" name="screening-cv" value="yes" required>Yes</label><label><input type="radio" name="screening-cv" value="no" required>No</label></fieldset>':''}
  ${overlayCheckbox?'<label><input type="checkbox" name="follow" style="pointer-events:none" checked>Follow Vilo to stay up to date with their page</label>':''}
  <button type="button">Submit application</button></div>
  <script>
  window.uploadClicks=0;window.acceptedDocument=null;window.uploadedPayload=null;
  const region=document.querySelector('#resume-region');
  document.querySelector('#upload').onclick=()=>{
    window.uploadClicks++;
    const input=document.createElement('input');input.type='file';input.accept='.pdf,.doc,.docx';
    input.onchange=async()=>{
      const file=input.files[0];if(!file)return;
      window.uploadedPayload={name:file.name,content:await file.text()};
      const card=document.createElement('div');card.setAttribute('role','button');
      const text=document.createElement('span');text.textContent=file.name;
      const radio=document.createElement('input');radio.type='radio';radio.name='radio-group-_r_d_';radio.value='new-document';radio.setAttribute('aria-label',file.name);
      card.append(text,radio);region.querySelector('fieldset').append(card);
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
