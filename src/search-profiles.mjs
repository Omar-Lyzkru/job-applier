const norm=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
export const roleFamilyPresets={
  swe:{label:'Software engineering',titles:['Software Engineer Intern','Software Engineering Internship'],related:['development','backend','web'],aliases:['software engineer','software engineering']},
  development:{label:'Software development',titles:['Software Developer Intern','Application Developer Intern'],related:['swe','backend','web'],aliases:['software developer','application developer','software development']},
  web:{label:'Web development',titles:['Web Developer Intern','Frontend Developer Intern'],related:['swe','development','backend'],aliases:['web developer','frontend','front end','full stack']},
  backend:{label:'Backend development',titles:['Backend Developer Intern','Backend Engineer Intern'],related:['swe','development'],aliases:['backend','back end','api developer']},
  data:{label:'Data and analytics',titles:['Data Analyst Intern','Data Science Intern'],related:['research'],aliases:['data analyst','data science','data scientist','data engineer','analytics']},
  it:{label:'IT development',titles:['IT Intern','Information Technology Intern'],related:['development'],aliases:['it intern','information technology','it development']},
  research:{label:'Undergraduate research',titles:['Undergraduate Research Assistant','Research Intern'],related:['data','student'],aliases:['undergraduate research','research assistant','research intern']},
  student:{label:'Student development',titles:['Student Developer','Student Technology Intern'],related:['development','research','it'],aliases:['student developer','student technology']}
};
export function classifyRoleFamily(title){
  const text=norm(title);
  return ['backend','web','data','it','research','student','swe','development'].find(id=>roleFamilyPresets[id].aliases.some(alias=>text.includes(alias)))||null;
}
export function buildSearchQueries(search={},intelligence={}){
  const titles=[...(search.titles||[]).map(title=>({title,familyId:classifyRoleFamily(title)})),...(intelligence.roleFamilies||[]).flatMap(id=>(intelligence.familyTitles?.[id]||roleFamilyPresets[id]?.titles||[]).map(title=>({title,familyId:id})))];
  const regions=intelligence.regions?.length?intelligence.regions:search.location?[{name:search.location,priority:10,workplace:search.workplace||'any'}]:[];
  const seen=new Set(),queries=[];
  for(const {title,familyId} of titles)for(const region of regions){
    if(!title?.trim()||!region.name?.trim())continue;
    const id=JSON.stringify([norm(title),norm(region.name),region.workplace||'any']);if(seen.has(id))continue;seen.add(id);
    queries.push({id,title,location:region.name,workplace:region.workplace||'any',priority:region.priority??10,familyId});
  }
  if(queries.length>50)throw new Error('Intelligent search expands to more than 50 queries. Reduce titles or regions.');
  return queries;
}
