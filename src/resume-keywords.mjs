// Search recommendations remain explicit vocabulary matches, never inferred answers.
import {extractSkills,skillLabel} from './skills.mjs';
export function recommendKeywords(text){return extractSkills(text,{context:'resume'}).map(skillLabel);}
