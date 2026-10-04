// Sanitized structure from BGE's hydrated form: the group has no legend or name,
// both native radios have the question as aria-label, and empty associated labels
// draw the circles. The visible choice is a sibling paragraph in each radio row.
export const screeningLabels=[
  'Are you authorized to work legally in the US?',
  'Will you now or anytime after graduation require sponsorship for a work visa (like an H1b) to work legally in the US?',
  'If you provided a phone number, do you consent to receiving follow-up communication via text message (or SMS message) regarding your application status?'
];
export function modernScreening(){
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
    </div>`).join('')}</div>`;
}
