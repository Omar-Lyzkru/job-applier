import {canonicalSkill} from './skills.mjs';
import {roleFamilyPresets} from './search-profiles.mjs';
const object=(value,name)=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`${name} must be an object`);return value;};
const text=(value,name,max=200)=>{if(typeof value!=='string'||value.length>max)throw new Error(`${name} must be text under ${max} characters`);return value.trim();};
const list=(value,name)=>{if(!Array.isArray(value)||value.length>100)throw new Error(`${name} must have at most 100 entries`);return [...new Set(value.map(v=>text(v,name)).filter(Boolean))];};
const families=(value,name)=>{const result=list(value,name);if(result.some(id=>!Object.hasOwn(roleFamilyPresets,id)))throw new Error(`Choose known role families for ${name}`);return result;};
export function defaultIntelligenceConfig(){return {enabled:false,minimumFitScore:70,candidate:{skills:null,professionalYears:null,student:null,currentEducation:null,completedEducation:null,clearances:null},roleFamilies:[],familyTitles:{},regions:[],preferredCompanies:[],excludedCompanies:[],preferredFamilies:[],excludeUnpaid:true,excludeCommissionOnly:true,rejectSeniorForEntry:true};}
export function validateIntelligence(input={}){
  object(input,'Intelligent matching');const result=defaultIntelligenceConfig();
  for(const key of ['enabled','excludeUnpaid','excludeCommissionOnly','rejectSeniorForEntry'])if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw new Error(`${key} must be true or false`);result[key]=input[key];}
  if(input.minimumFitScore!==undefined){if(!Number.isInteger(input.minimumFitScore)||input.minimumFitScore<55||input.minimumFitScore>100)throw new Error('Minimum fit score must be an integer from 55 to 100');result.minimumFitScore=input.minimumFitScore;}
  for(const key of ['roleFamilies','preferredFamilies'])if(input[key]!==undefined)result[key]=families(input[key],key);
  for(const key of ['preferredCompanies','excludedCompanies'])if(input[key]!==undefined)result[key]=list(input[key],key);
  if(input.familyTitles!==undefined){object(input.familyTitles,'Family titles');for(const [id,titles] of Object.entries(input.familyTitles)){families([id],'Family titles');result.familyTitles[id]=list(titles,'Family titles');}}
  if(input.regions!==undefined){
    if(!Array.isArray(input.regions)||input.regions.length>10)throw new Error('Choose at most 10 search regions');
    result.regions=input.regions.map(region=>{
      object(region,'Region');const name=text(region.name,'Region',1000);
      if(!name||/^remote$/i.test(name))throw new Error('Enter an actual geographic search region; choose Remote as workplace');
      if(!Number.isInteger(region.priority)||region.priority<0||region.priority>10)throw new Error('Region priority must be an integer from 0 to 10');
      if(!['any','remote','hybrid','onsite'].includes(region.workplace))throw new Error('Choose a valid region workplace');
      return {name,priority:region.priority,workplace:region.workplace};
    });
  }
  if(input.candidate!==undefined){
    const c=object(input.candidate,'Matching facts');
    for(const key of ['skills','clearances'])if(c[key]!==undefined){
      result.candidate[key]=c[key]===null?null:list(c[key],key).map(value=>key==='skills'?canonicalSkill(value):value.toLowerCase());
      if(result.candidate[key]?.includes(null))throw new Error('Choose recognized skill names, such as Python, JavaScript or C++');
      if(result.candidate[key])result.candidate[key]=[...new Set(result.candidate[key])];
    }
    if(c.professionalYears!==undefined){if(c.professionalYears!==null&&(!Number.isFinite(c.professionalYears)||c.professionalYears<0||c.professionalYears>80))throw new Error('Professional years must be a number from 0 to 80 or unknown');result.candidate.professionalYears=c.professionalYears;}
    if(c.student!==undefined){if(c.student!==null&&typeof c.student!=='boolean')throw new Error('Student status must be Yes, No or unknown');result.candidate.student=c.student;}
    for(const key of ['currentEducation','completedEducation'])if(c[key]!==undefined){
      if(c[key]===null){result.candidate[key]=null;continue;}
      const e=object(c[key],key);if(!['none','high_school','associate','bachelor','master','doctorate'].includes(e.degree))throw new Error('Choose a valid education degree');
      result.candidate[key]={degree:e.degree,major:e.major==null?null:text(e.major,'Major').toLowerCase()};
    }
  }
  return result;
}
