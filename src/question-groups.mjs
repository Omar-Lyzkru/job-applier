import {createHash} from 'node:crypto';
import {describeQuestion} from './answer-memory.mjs';

const text=value=>String(value??'').normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' ');
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
  return value??null;
}
const signature=value=>JSON.stringify(stable(value));
const hash=value=>createHash('sha256').update(signature(value)).digest('hex').slice(0,24);
function compatibility(question){
  const description=question.description||describeQuestion(question);
  const formatHints=String(question.label).match(/\b(?:mm|month|yyyy|year|dd|day)(?:\s*[/.-]\s*|\s+)(?:mm|month|yyyy|year|dd|day)(?:(?:\s*[/.-]\s*|\s+)(?:mm|month|yyyy|year|dd|day))?\b/gi)||[];
  return {bankTarget:question.bankQuestion?.targetId??null,answerKey:question.answerKey||description.answerKey,type:question.type||'text',required:Boolean(question.required),readOnly:Boolean(question.readOnly),
    choices:(question.options||[]).map(option=>text(option.label)).sort(),scope:description.scope,
    pattern:question.pattern??null,placeholder:text(question.placeholder),formatHints:formatHints.map(text),
    min:question.min??null,max:question.max??null,step:question.step??null,maxLength:question.maxLength??null,consentText:question.consentText??null};
}

// Display groups may split on saved provenance. Draft identity only describes
// the question/control meaning and therefore survives membership or value edits.
export function groupPendingQuestions(questions){
  const grouped=new Map();
  for(const original of questions){
    const question=structuredClone(original),draftId=`draft-${hash(compatibility(question))}`;
    const id=`group-${hash({draftId,savedAnswer:question.savedAnswer??null})}`;
    let group=grouped.get(id);
    if(!group){group={id,draftId,question,occurrences:[],savedAnswer:question.savedAnswer??null,suggestions:[]};grouped.set(id,group);}
    group.occurrences.push(question);
    for(const suggestion of question.suggestions||[])if(!group.suggestions.some(existing=>signature(existing)===signature(suggestion)))group.suggestions.push(suggestion);
  }
  return [...grouped.values()];
}
