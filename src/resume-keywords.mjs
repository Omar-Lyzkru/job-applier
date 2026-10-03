// These are search suggestions, never inferred qualifications or screening answers.
// Entries contain a canonical keyword followed by explicitly equivalent spellings.
const vocabulary=[
  ['.NET','dotnet'],['ASP.NET'],['C++','CPP'],['C#','C sharp'],
  ['C programming','C language'],['R programming','R language'],
  ['Golang','Go programming','Go language'],['Java'],['JavaScript','JS','ECMAScript'],
  ['TypeScript'],['Python'],['Ruby','Ruby programming'],['Rust','Rust programming'],
  ['Swift','Swift programming'],['Kotlin'],['Scala'],['PHP'],['Objective-C'],
  ['SQL'],['NoSQL'],['HTML','HTML5'],['CSS','CSS3'],['SCSS'],['Bash'],['PowerShell'],
  ['React','React.js','ReactJS'],['Angular','AngularJS'],['Vue.js','VueJS'],
  ['Node.js','nodejs','node js'],['Next.js','NextJS'],['Express.js','ExpressJS'],
  ['Django'],['Flask'],['FastAPI'],['Spring Boot'],['Ruby on Rails'],
  ['PostgreSQL','Postgres'],['MySQL'],['SQL Server','Microsoft SQL Server'],
  ['SQLite'],['MongoDB'],['Redis'],['Oracle Database'],['Snowflake'],['BigQuery'],
  ['AWS','Amazon Web Services'],['Azure','Microsoft Azure'],['Google Cloud','GCP','Google Cloud Platform'],
  ['Docker'],['Kubernetes','K8s'],['Terraform'],['Ansible'],['Linux'],['Unix'],
  ['Git'],['GitHub Actions'],['GitLab CI'],['Jenkins'],['CI/CD','continuous integration and continuous delivery','continuous integration and continuous deployment'],
  ['REST API','REST APIs','RESTful API','RESTful APIs'],['GraphQL'],
  ['Kafka','Apache Kafka'],['RabbitMQ'],['Elasticsearch'],['Nginx'],
  ['JUnit'],['Jest'],['Pytest'],['Selenium'],['Playwright'],['Cypress'],
  ['Unit testing'],['Integration testing'],['Test automation'],
  ['Machine learning'],['Deep learning'],['Natural language processing','NLP'],
  ['Computer vision'],['TensorFlow'],['PyTorch'],['scikit-learn','sklearn'],
  ['pandas'],['NumPy'],['Apache Spark','PySpark'],['Airflow','Apache Airflow'],
  ['Data analysis','Data analytics'],['Data visualization'],['ETL'],['Data modeling','Data modelling'],
  ['Excel','Microsoft Excel','MS Excel'],['Power BI','PowerBI'],['Tableau'],['Looker'],
  ['MATLAB'],['Figma'],['Adobe Photoshop','Photoshop'],
  ['Adobe Illustrator','Illustrator'],['Adobe InDesign','InDesign'],['AutoCAD'],['SolidWorks'],
  ['Revit'],['Salesforce'],['HubSpot'],['SAP'],['QuickBooks'],['Workday'],['ServiceNow'],
  ['Jira'],['Confluence'],['Microsoft Project','MS Project'],['SharePoint'],
  ['Accounting'],['Bookkeeping'],['Accounts payable'],['Accounts receivable'],
  ['Financial analysis'],['Financial modeling','Financial modelling'],['Payroll'],
  ['Budgeting'],['Project management'],['Business analysis'],['Scrum'],['Kanban'],
  ['Six Sigma'],['Supply chain','Supply-chain'],['Inventory management'],['Procurement'],
  ['SEO','Search engine optimization','Search engine optimisation'],['Google Analytics','GA4'],
  ['Google Ads'],['Email marketing'],['Copywriting'],['Market research'],
  ['Medical coding'],['Medical billing'],['Patient care'],['Phlebotomy'],
  ['Electronic health records','EHR'],['CPR','Cardiopulmonary resuscitation'],
  ['BLS','Basic life support'],['Medication administration'],['Infection control'],
  ['HVAC'],['Welding'],['CNC machining'],['PLC programming'],['Electrical troubleshooting'],
  ['Blueprint reading'],['Preventive maintenance'],['Forklift operation']
];

// Ordinary prose such as “excel at teamwork” or “remove rust” is not a skill.
const caseSensitiveNames=new Set(['Excel','React','Ruby','Rust','Swift','SAP']);
const escape=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function phrasePattern(phrase,caseSensitive=false){
  const body=phrase.split(/\s+/).map(escape).join('\\s+');
  // Preserve punctuation in language/tool names; exclude substrings and domains.
  return new RegExp(`(?<![\\p{L}\\p{N}_-])${body}(?![\\p{L}\\p{N}_+#]|\\.[\\p{L}\\p{N}])`,caseSensitive?'u':'iu');
}
const matchers=vocabulary.map(([keyword,...aliases])=>({
  keyword,
  patterns:[phrasePattern(keyword,caseSensitiveNames.has(keyword)),...aliases.map(alias=>phrasePattern(alias))],
  skillPattern:caseSensitiveNames.has(keyword)?phrasePattern(keyword):null
}));

function resumeBody(text){
  const normalized=text.normalize('NFKC').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\u00ad/g,'');
  const lines=normalized.split(/\r?\n/);
  // A name directly above contact details is not evidence of a namesake language.
  const first=lines.findIndex(line=>line.trim());
  if(first>=0 && /^[\p{L}'-]+(?:\s+[\p{L}'-]+){1,3}$/u.test(lines[first].trim()) &&
    lines.slice(first+1,first+3).some(line=>/@|https?:\/\/|www\./i.test(line)))lines[first]='';
  return lines.filter(line=>!/^\s*(?:employer|company|name|full name)\s*:/i.test(line)).join('\n')
    .replace(/\b[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/gi,' ')
    .replace(/\b(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S+/gi,' ')
    .replace(/\b(?:[a-z\d-]+\.)+[a-z]{2,}\/\S*/gi,' ');
}

export function recommendKeywords(text) {
  if(typeof text!=='string' || !text.trim())return [];
  const body=resumeBody(text);
  const skillLines=body.split(/\n/).filter(line=>/^\s*(?:(?:technical|core|professional)\s+)?(?:skills|tools|technologies|programming languages)\s*:/i.test(line)).join('\n');
  return matchers.filter(({patterns,skillPattern})=>patterns.some(pattern=>pattern.test(body)) || skillPattern?.test(skillLines))
    .map(({keyword})=>keyword).sort((a,b)=>a.localeCompare(b,'en'));
}
