// Sanitized structure from BGE's hydrated form: the group has no legend or name,
// both native radios have the question as aria-label, and empty associated labels
// draw the circles. The visible choice is a sibling paragraph in each radio row.
export const screeningLabels=[
  'Are you authorized to work legally in the US?',
  'Will you now or anytime after graduation require sponsorship for a work visa (like an H1b) to work legally in the US?',
  'If you provided a phone number, do you consent to receiving follow-up communication via text message (or SMS message) regarding your application status?'
];
export function modernScreening(options={}){
  return `<!doctype html><style>
    input[type=radio]{position:absolute;width:0;height:0;margin:0}
    label{display:inline-block;width:22px;height:22px;border:1px solid #888;cursor:pointer}
    .choice{display:flex;align-items:center;gap:8px}
  </style><div role="dialog">${screeningLabels.map((question,index)=>`
    <div><p>${question}*</p>${index===2?'<p>If yes, you can always opt-out by replying STOP. Terms of Use | Privacy Policy (ADD LINKS)</p>':''}
      <fieldset role="radiogroup" aria-describedby="error-message-${index}"><div>
        ${['Yes','No'].map((choice,option)=>`<div><div class="choice"><div>
          <input id="choice-${index}-${option}" type="radio" name="radio-group-_r_${index}_" aria-label="${question}" tabindex="0">
          <label for="choice-${index}-${option}"></label>
        </div><div><p>${choice}</p></div></div></div>`).join('')}
      </div></fieldset>
    </div>`).join('')}</div><script>
 const options=${JSON.stringify(options)};window.fixtureState={labelClicks:0,groupReplacements:0,changes:0};
 const root=document.querySelector('[role=dialog]');let changed=false;
 root.addEventListener('click',event=>{if(event.target.matches('label'))window.fixtureState.labelClicks++;});
 function replace(group){const fresh=group.cloneNode(true);fresh.querySelectorAll('[data-applier-control]').forEach(el=>el.removeAttribute('data-applier-control'));fresh.querySelectorAll('input').forEach((input,index)=>{const old=input.id;input.id='fresh-'+old;fresh.querySelector('label[for="'+old+'"]').htmlFor=input.id;});group.replaceWith(fresh);window.fixtureState.groupReplacements++;}
 root.addEventListener('change',event=>{
  window.fixtureState.changes++;const group=event.target.closest('fieldset');if(!group)return;
  if(options.continualReset)event.target.checked=false;
  if(changed)return;changed=true;
  if(options.replaceOnChoiceChange)replace(group);
  if(options.replaceNextGroupOnChoiceChange)replace(root.querySelectorAll('fieldset')[1]);
  if(options.delayedConditional)setTimeout(()=>{root.insertAdjacentHTML('beforeend',options.customConditional?'<div role="checkbox" aria-required="true" aria-label="Custom consent*"></div>':'<div id="conditional"><label>University name*<input name="school" required></label></div>');},150);
  if(options.removeConditionalOnChoiceChange)document.querySelector('#conditional')?.remove();
  if(options.resetEarlierOnChoiceChange)setTimeout(()=>{event.target.checked=false;},150);
 });
 if(options.removeConditionalOnChoiceChange)root.insertAdjacentHTML('afterbegin','<div id="conditional"><label>University name*<input name="school" required></label></div>');
 if(options.ambiguous)root.insertAdjacentHTML('beforeend','<label>Ambiguous*<input required></label><label>Ambiguous*<input required></label>');
 </script>`;
}
