import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultConfig, validateConfig, readiness, normalizeQuestion, resolveAnswer, matchesJob, dayKey, countsTowardCap, blocksRetry} from '../src/domain.mjs';
import * as answerMemory from '../src/answer-memory.mjs';
const describeQuestion=field=>answerMemory.describeQuestion(field);

test('finite skill-year templates reuse explicit same-skill values with preserved source and scope',()=>{
  const total=['Years of Python experience','Years of experience with Python','How many years of Python experience do you have?','How many years of experience do you have with Python?','How many years of experience do you have in Python?','Total years of Python experience','Total years of experience with Python'];
  for(const label of total){const result=resolveAnswer({label,type:'number'},{},{'years of python experience':0});assert.equal(result.kind,'fill',label);assert.equal(result.value,'0');assert.equal(result.sourceQuestion,'years of python experience');}
  const professional=['Years of professional Python experience','Years of professional experience with Python','How many years of professional Python experience do you have?','How many years of professional experience do you have with Python?','How many years of professional experience do you have in Python?'];
  for(const label of professional){assert.equal(resolveAnswer({label,type:'text'},{},{'years of professional python experience':1.5}).value,'1.5',label);assert.equal(resolveAnswer({label,type:'text'},{},{'years of python experience':2}).kind,'missing');}
  for(const [skill,source] of [['JS','JavaScript'],['ECMAScript','JavaScript'],['React.js','React'],['ReactJS','React.js'],['nodejs','Node.js'],['Postgres','PostgreSQL'],['Rust programming','Rust'],['Java','Java'],['TypeScript','TypeScript'],['SQL','SQL'],['Git','Git']]){
    const result=resolveAnswer({label:`How many years of experience do you have with ${skill}?`,type:'number'},{},{[normalizeQuestion(`Years of ${source} experience`)]:2});assert.equal(result.value,'2',skill);
  }
  assert.equal(describeQuestion({label:'Years of professional Python experience',type:'number'}).intent,'skill-years:professional:python');
});

test('recognized years require scalar nonnegative numbers and preserve exact choice meanings',()=>{
  for(const answer of [false,true,'No experience','two',-1,Infinity])assert.equal(resolveAnswer({label:'Years of Python experience',type:'text'},{},{'years of python experience':answer}).kind,'missing');
  const select={label:'Years of Python experience',type:'select',options:[{label:'0–1 years',value:'a'},{label:'2–3 years',value:'b'}]};
  assert.equal(resolveAnswer(select,{},{'years of experience with python':'2–3 years'}).value,'b');
  assert.equal(resolveAnswer({...select,type:'number',options:[]},{},{'years of experience with python':'2–3 years'}).kind,'missing');
  assert.equal(resolveAnswer({label:'Years of Python experience',type:'number'},{},{'years of python experience':0,'years of experience with python':3}).value,'0');
  assert.equal(resolveAnswer({label:'How many years of Python experience do you have?',type:'number'},{},{'years of python experience':0,'years of experience with python':3}).kind,'missing');
});

test('skill qualifiers, separate languages and ambiguous C-family keys never borrow another answer',()=>{
  for(const label of ['Years of professional JavaScript experience','Years of Java experience','Years of paid Python experience','Years of recent Python experience','Years of Python and JavaScript experience','Years of continuous Python experience','Years of full-time Python experience','Years of production Python experience','Years of commercial Python experience'])assert.equal(resolveAnswer({label,type:'number'},{},{'years of python experience':2}).kind,'missing',label);
  for(const label of ['Years of C experience','Years of C++ experience','Years of C# experience']){
    const field={label,type:'number'},result=resolveAnswer(field,{},{'years of c experience':2});assert.equal(result.kind,'missing',label);assert.equal(result.manual,true);assert.equal(describeQuestion(field).reviewPolicy,'manual');
  }
  assert.notDeepEqual(describeQuestion({label:'Years of C++ experience',type:'number'}).scope,describeQuestion({label:'Years of C# experience',type:'number'}).scope);
});

test('current-student aliases preserve explicit false and exclude narrower or negated eligibility',()=>{
  const field={label:'Are you presently a student?',type:'radio',options:[{label:'Yes',value:'on'},{label:'No',value:'on'}]};
  assert.equal(resolveAnswer(field,{student:true},{}).kind,'missing');
  assert.equal(resolveAnswer(field,{},{'are you currently a student':false,'are you a current student':'No'}).optionLabel,'No');
  for(const label of ['Are you a full-time student?','Are you not currently a student?','Are you an undergraduate student?','Are you a college student?','Will you be a student next year?'])assert.equal(resolveAnswer({...field,label},{},{'are you currently a student':true}).kind,'missing',label);
  for(const [label,key,value] of [['Name of your current university','school','Example University'],['Current degree','degree type',"Bachelor's Degree"],['Current field of study','major','Computer Science']])assert.equal(resolveAnswer({label,type:'text'},{},{[key]:value}).value,value);
});

test('sensitive saved questions cannot appear as generic suggestions in either direction',()=>{
  for(const sensitive of ['salary','pay','certification','clearance','legally','visa','citizenship','consent','sms','identity']){
    const result=resolveAnswer({label:'Describe your preferred schedule',type:'text'},{},{[`describe your preferred schedule ${sensitive}`]:'Sensitive answer'});
    assert.equal(result.suggestions?.length||0,0,sensitive);
    assert.equal(resolveAnswer({label:`Describe your preferred schedule ${sensitive}`,type:'text'},{},{'describe your preferred schedule':'Ordinary answer'}).suggestions?.length||0,0,sensitive);
  }
});

test('incomplete setup can be saved but cannot run', () => {
  const config = validateConfig({});
  assert.equal(config.dailyCap, 10);
  assert.equal(config.scanLimit, 100);
  assert.equal(config.intervalSeconds, 45);
  assert.ok(readiness(config).includes('Upload a résumé'));
  assert.throws(() => validateConfig({dailyCap: 0}), /daily cap/i);
  assert.throws(() => validateConfig({timezone:'Mars/Olympus'}), /timezone/i);
});

test('contact aliases do not accidentally answer screening questions', () => {
  const profile = {email:'me@example.com',phone:'5551234567'};
  assert.equal(resolveAnswer({label:'Email address',type:'email'}, profile, {}).value, 'me@example.com');
  assert.equal(resolveAnswer({label:'Have you provided phone support?',type:'text'}, profile, {}).kind, 'missing');
  assert.equal(resolveAnswer({label:'Years of Java experience',type:'number'}, profile, {}).kind, 'missing');
});

test('saved answers preserve zero and false and match exact choices', () => {
  const answers = {'years of java experience':0,'are you willing to relocate':false};
  assert.equal(resolveAnswer({label:'Years of Java experience *',type:'number'}, {}, answers).value, '0');
  const field = {label:'Are you willing to relocate?',type:'select',options:[{label:'Yes',value:'1'},{label:'No',value:'0'}]};
  assert.equal(resolveAnswer(field, {}, answers).value, '0');
  assert.equal(resolveAnswer({...field,options:[{label:'Maybe',value:'m'}]}, {}, answers).kind, 'missing');
  assert.equal(resolveAnswer({label:'Agree to policy',type:'checkbox'}, {}, {'agree to policy':false}).value, false);
  assert.equal(normalizeQuestion('  E-mail address * '), 'e mail address');
});

test('all include keywords and no excluded keyword are required', () => {
  const search = {includeKeywords:['Python','Remote'],excludeKeywords:['unpaid']};
  assert.equal(matchesJob('REMOTE role using python',search), true);
  assert.equal(matchesJob('Python role',search), false);
  assert.equal(matchesJob('Remote Python internship, unpaid',search), false);
});

test('choice answers match displayed meanings rather than opaque internal values',()=>{
  for(const type of ['select','radio']){
    const field={label:'Years of experience',type,options:[{label:'No experience',value:'1'},{label:'1',value:'9'}]};
    assert.equal(resolveAnswer(field,{}, {'years of experience':1}).value,'9');
    assert.equal(resolveAnswer({...field,options:field.options.slice(0,1)}, {}, {'years of experience':1}).kind,'missing');
    assert.equal(resolveAnswer(field,{}, {'years of experience':'No experience'}).value,'1');
  }
});

test('uncertain attempts consume the local-day cap and block retries', () => {
  const date = new Date('2026-10-02T02:00:00Z');
  assert.equal(dayKey(date,'America/Chicago'),'2026-10-01');
  const record = {status:'unconfirmed',attemptedAt:'2026-10-02T01:00:00Z'};
  assert.equal(countsTowardCap(record,'2026-10-01','America/Chicago'),true);
  assert.equal(countsTowardCap(record,'2026-10-02','America/Chicago'),false);
  assert.equal(blocksRetry(record),true);
  assert.equal(blocksRetry({status:'needs_answer'}),false);
  assert.equal(countsTowardCap({status:'ready'},'2026-10-01','America/Chicago'),false);
});

test('profile links without a scheme are saved as HTTPS URLs',()=>{
  const config=validateConfig({profile:{linkedinUrl:' www.linkedin.com/in/test-applicant ',website:'portfolio.example/projects?view=work#about'}});
  assert.equal(config.profile.linkedinUrl,'https://www.linkedin.com/in/test-applicant');
  assert.equal(config.profile.website,'https://portfolio.example/projects?view=work#about');
  assert.equal(validateConfig({profile:{website:'http://portfolio.example/work'}}).profile.website,'http://portfolio.example/work');
  assert.equal(validateConfig({profile:{website:'PORTFOLIO.example:8443/work?tab=projects#top'}}).profile.website,'https://portfolio.example:8443/work?tab=projects#top');
  assert.equal(validateConfig({profile:{linkedinUrl:'',website:''}}).profile.website,'');
});

test('profile links reject malformed URLs and non-web protocols with the field name',()=>{
  for(const value of ['not a link','javascript:alert(1)','ftp://files.example/resume','mailto:test@example.com','https://','https://example..com','https://example.com/a b','https://user:password@example.com']){
    assert.throws(()=>validateConfig({profile:{linkedinUrl:value}}),/LinkedIn profile URL/);
    assert.throws(()=>validateConfig({profile:{website:value}}),/Website \/ portfolio/);
  }
});

test('experience-level selections and keyword mode validate while old settings keep their behavior',()=>{
  const levels=['INTERNSHIP','ENTRY_LEVEL','ASSOCIATE','MID_SENIOR_LEVEL','DIRECTOR','EXECUTIVE'];
  const config=validateConfig({search:{experienceLevels:[...levels,'INTERNSHIP'],keywordMatch:'any'}});
  assert.deepEqual(config.search.experienceLevels,levels);
  assert.equal(config.search.keywordMatch,'any');
  const legacy=validateConfig({search:{includeKeywords:['Python','C++']}});
  assert.deepEqual(legacy.search.experienceLevels,[]);
  assert.equal(legacy.search.keywordMatch,'all');
  for(const experienceLevels of ['INTERNSHIP',['JUNIOR'],['1']])assert.throws(()=>validateConfig({search:{experienceLevels}}),/experience/i);
  assert.throws(()=>validateConfig({search:{keywordMatch:'guess'}}),/keyword/i);
});

test('any-keyword matching accepts an alternative skill and still applies exclusions',()=>{
  const search={includeKeywords:['C++','Python','software'],excludeKeywords:['unpaid'],keywordMatch:'any'};
  assert.equal(matchesJob('Python developer internship',search),true);
  assert.equal(matchesJob('Python developer internship',{...search,keywordMatch:'all'}),false);
  assert.equal(matchesJob('Python developer internship, unpaid',search),false);
  assert.equal(matchesJob('Marketing internship',search),false);
  assert.equal(matchesJob('Marketing internship',{...search,includeKeywords:[]}),true);
});

const yesNo=[{label:'Yes',value:'yes-option'},{label:'No',value:'no-option'}];

test('filled answers explain the exact saved question or profile source',()=>{
  const exact=resolveAnswer({label:'Years of Java experience *',type:'number'}, {}, {'years of java experience':0});
  assert.equal(exact.answer,0);
  assert.equal(exact.sourceQuestion,'years of java experience');
  assert.equal(exact.match,'exact');
  const profile=resolveAnswer({label:'Email address',type:'email'},{email:'me@example.com'},{});
  assert.equal(profile.answer,'me@example.com');
  assert.equal(profile.sourceQuestion,'email address');
  assert.equal(profile.match,'profile');
});

test('known education aliases reuse previous answers with the source question',()=>{
  const cases=[
    ['University name','school','University of Houston'],
    ['Field of study','major','Computer Science/IT'],
    ['Degree','degree type',"Bachelor's Degree"],
    ['Expected graduation date','expected graduation','Spring 2028'],
    ['Type of position desired','desired position type','Internship'],
    ['Preferred department','department preference','IT'],
    ['Preferred job location','location preference','Houston, TX'],
    ['Street address','address','123 Example Street']
  ];
  for(const [label,question,answer] of cases){
    const result=resolveAnswer({label,type:'text'}, {}, {[question]:answer});
    assert.equal(result.kind,'fill',label);
    assert.equal(result.value,answer,label);
    assert.equal(result.answer,answer,label);
    assert.equal(result.sourceQuestion,question,label);
    assert.equal(result.match,'equivalent',label);
  }
});

test('clear education question wording reuses current studies while past universities need review',()=>{
  const answers={school:'University of Houston',major:'Computer Science/IT','expected graduation':'Spring 2028'};
  for(const [label,value] of [['Which university are you currently attending?','University of Houston'],
    ['What is your major or field of study?','Computer Science/IT'],['What is your expected graduation date?','Spring 2028']]){
    assert.equal(resolveAnswer({label,type:'text'}, {}, answers).value,value,label);
  }
  for(const label of ['University previously attended','Which university did you graduate from?']){
    const result=resolveAnswer({label,type:'text'}, {}, answers);
    assert.equal(result.kind,'missing',label);
    assert.equal(result.suggestions?.[0].question,'school',label);
    assert.equal(result.suggestions?.[0].answer,'University of Houston',label);
  }
});

test('equivalent answers must match one available choice',()=>{
  const answers={major:'Computer Science/IT'};
  const field={label:'Field of study',type:'select',options:[{label:'Computer Science/IT',value:'major-7'},{label:'Marketing',value:'major-8'}]};
  assert.equal(resolveAnswer(field,{},answers).value,'major-7');
  const unavailable=resolveAnswer({...field,options:[{label:'Marketing',value:'major-8'}]}, {}, answers);
  assert.equal(unavailable.kind,'missing');
  assert.deepEqual(unavailable.suggestions?.map(item=>[item.question,item.answer]),[['major','Computer Science/IT']]);
  assert.equal(resolveAnswer({...field,options:[{label:'Computer Science/IT',value:'a'},{label:'Computer Science/IT',value:'b'}]}, {}, answers).kind,'missing');
});

test('choice answers identify the displayed choice even when internal values are identical',()=>{
  const field={label:'Are you authorized to work legally in the US?',type:'radio',options:[{label:'Yes',value:'on'},{label:'No',value:'on'}]};
  const result=resolveAnswer(field,{}, {'are you legally authorized to work in the united states':false});
  assert.equal(result.value,'on');
  assert.equal(result.optionLabel,'No');
});

test('conflicting equivalent answers require review while an exact answer takes precedence',()=>{
  const answers={school:'University of Houston','school name':'University of Texas'};
  const conflict=resolveAnswer({label:'University name',type:'text'}, {}, answers);
  assert.equal(conflict.kind,'missing');
  assert.match(conflict.reason,/conflict/i);
  assert.equal(conflict.suggestions.length,2);
  const exact=resolveAnswer({label:'School name',type:'text'}, {}, answers);
  assert.equal(exact.value,'University of Texas');
  assert.equal(exact.match,'exact');
  const same=resolveAnswer({label:'University name',type:'text'}, {}, {school:'University of Houston','school name':'University of Houston'});
  assert.equal(same.value,'University of Houston');
  const literal=resolveAnswer({label:'Street address',type:'text'}, {}, {address:'1','address line 1':'Yes'});
  assert.equal(literal.kind,'missing');
  assert.match(literal.reason,/conflict/i);
});

test('positive US authorization aliases preserve yes and no without answering citizenship or sponsorship',()=>{
  const question='are you legally authorized to work in the united states';
  const field={label:'Are you authorized to work legally in the US?',type:'radio',options:yesNo};
  for(const [answer,want] of [[true,'yes-option'],[false,'no-option']])assert.equal(resolveAnswer(field,{}, {[question]:answer}).value,want);
  for(const label of [
    'Are you a US citizen?',
    'Are you not authorized to work in the US?',
    'Are you legally authorized to work in Canada?',
    'Are you authorized to work in the US without sponsorship?',
    'Are you authorized to work in the US and willing to relocate?',
    'Are you legally authorized to work in the US now and after graduation?'
  ])assert.equal(resolveAnswer({...field,label}, {}, {[question]:true}).kind,'missing',label);
});

test('current-or-future US sponsorship aliases stay distinct from authorization and narrower time questions',()=>{
  const question='will you now or in the future require sponsorship to work in the united states';
  const field={label:'Will you now or anytime after graduation require sponsorship for a work visa (like an H1b) to work legally in the US?',type:'radio',options:yesNo};
  assert.equal(resolveAnswer(field,{}, {[question]:false}).value,'no-option');
  assert.equal(resolveAnswer(field,{}, {[question]:true}).value,'yes-option');
  for(const label of [
    'Do you currently require sponsorship to work in the United States?',
    'Will you require sponsorship after graduation to work in the US?',
    'Will you now or in the future require sponsorship to work in Canada?',
    'Will you now or in the future not require sponsorship to work in the US?',
    'Are you authorized to work legally in the US?',
    'Will you now or in the future require sponsorship to work in the US and relocate?'
  ])assert.equal(resolveAnswer({...field,label}, {}, {[question]:false}).kind,'missing',label);
});

test('degree completion and graduation formatting require explicit compatible answers',()=>{
  const answers={'degree type':"Bachelor's Degree",'expected graduation':'Spring 2028'};
  assert.equal(resolveAnswer({label:'Highest completed degree',type:'text'}, {}, answers).kind,'missing');
  const completed=resolveAnswer({label:'Highest degree earned',type:'text'}, {}, {'highest completed degree':'High School Diploma'});
  assert.equal(completed.value,'High School Diploma');
  for(const label of ['Expected graduation date (MM/YYYY)','Expected graduation (month/year)']){
    const result=resolveAnswer({label,type:'text'}, {}, answers);
    assert.equal(result.kind,'missing');
    assert.equal(result.suggestions?.[0].answer,'Spring 2028');
    assert.match(result.reason,/format/i);
  }
  const placeholder=resolveAnswer({label:'Expected graduation date',type:'text',placeholder:'MM/YYYY'}, {}, answers);
  assert.equal(placeholder.kind,'missing');
  assert.equal(placeholder.suggestions?.[0].answer,'Spring 2028');
});

test('a graduation field with a changed format reviews the same saved question until a valid date is confirmed',()=>{
  const field={label:'Expected graduation*',type:'text',pattern:'[0-9]{2}/[0-9]{4}',placeholder:'MM/YYYY'};
  const old=resolveAnswer(field,{}, {'expected graduation':'Spring 2028'});
  assert.equal(old.kind,'missing');
  assert.equal(old.suggestions?.[0].answer,'Spring 2028');
  assert.match(old.reason,/format/i);
  assert.equal(resolveAnswer(field,{}, {'expected graduation':'05/2028'}).value,'05/2028');
  assert.equal(resolveAnswer(field,{}, {'expected graduation':'13/2028'}).kind,'missing');
});

test('day and space-separated graduation formats reject seasons and accept explicit dates',()=>{
  for(const [format,value] of [['MM/DD/YYYY','05/15/2028'],['DD/MM/YYYY','15/05/2028'],['YYYY-MM-DD','2028-05-15'],['MM YYYY','05 2028'],['Month Year','May 2028']]){
    const label=`Expected graduation date (${format})`,field={label,type:'text'};
    const old=resolveAnswer(field,{}, {'expected graduation':'Spring 2028'});
    assert.equal(old.kind,'missing',format);
    assert.equal(old.suggestions?.[0].answer,'Spring 2028',format);
    assert.equal(resolveAnswer(field,{}, {[normalizeQuestion(label)]:value}).value,value,format);
  }
  const field={label:'Expected graduation date',type:'text',placeholder:'MM/DD/YYYY'};
  assert.equal(resolveAnswer(field,{}, {'expected graduation date':'02/30/2028'}).kind,'missing');
});

test('similar wording offers a suggestion without inventing automatic equivalence',()=>{
  const result=resolveAnswer({label:'Tell us about your favorite project',type:'text'}, {}, {'describe your favorite project':'A scheduling app'});
  assert.equal(result.kind,'missing');
  assert.equal(result.suggestions?.[0].question,'describe your favorite project');
  assert.equal(result.suggestions?.[0].answer,'A scheduling app');
  for(const label of ['Years of Python experience','How many years of experience do you have with JavaScript?']){
    const skill=resolveAnswer({label,type:'number'}, {}, {'years of java experience':4});
    assert.equal(skill.kind,'missing');
    assert.equal(skill.suggestions?.length||0,0);
  }
  assert.equal(resolveAnswer({label:'Preferred job location',type:'text'},{city:'Houston'},{}).kind,'missing');
});

test('SMS consent only reuses the same employer confirmation and explains unscoped old answers',async()=>{
  const memory=await import('../src/answer-memory.mjs').catch(()=>({}));
  assert.equal(typeof memory.savedAnswerKey,'function');
  const label='If you provided a phone number, do you consent to receiving follow-up communication via text message (or SMS message) regarding your application status?';
  const field={label,company:'BGE, Inc.',type:'radio',options:yesNo};
  assert.equal(memory.savedAnswerKey(field),'sms consent for bge inc');
  const confirmed=resolveAnswer(field,{}, {'sms consent for bge inc':false});
  assert.equal(confirmed.value,'no-option');
  assert.equal(confirmed.sourceQuestion,'sms consent for bge inc');
  const old=resolveAnswer(field,{}, {'if you provided a phone number do you consent to receiving follow up communication via text message or sms message regarding your application status':true});
  assert.equal(old.kind,'missing');
  assert.equal(old.suggestions?.[0].answer,true);
  assert.match(old.reason,/employer/i);
  assert.equal(resolveAnswer({...field,company:'Other Employer'}, {}, {'sms consent for bge inc':true}).kind,'missing');
  assert.equal(resolveAnswer({...field,company:undefined}, {}, {'sms consent for bge inc':true}).kind,'missing');
  const shorter={...field,label:'Do you agree to receive text messages about your application?'};
  assert.equal(memory.savedAnswerKey(shorter),'sms consent for bge inc');
  assert.equal(resolveAnswer(shorter,{}, {'sms consent for bge inc':true}).value,'yes-option');
  assert.equal(resolveAnswer({...field,label:'SMS consent for BGE, Inc.'}, {}, {'sms consent for bge inc':true}).value,'yes-option');
  assert.equal(memory.savedAnswerKey({label:'Consent to a background check',company:'BGE, Inc.'}),'consent to a background check');
});

test('SMS consent does not reuse permission for a negated or promotional request',async()=>{
  const {savedAnswerKey}=await import('../src/answer-memory.mjs');
  for(const label of ['Do you not consent to receive SMS about your application?','Do you decline consent to SMS updates?',
    'Do you consent to receive promotional text messages?','Do you agree to receive advertising text messages?',
    'Do you consent to receiving text messages and phone calls about your application?',
    'Do you consent to receiving text messages about your application from Another Employer?']){
    const field={label,company:'BGE, Inc.',type:'radio',options:yesNo};
    assert.equal(resolveAnswer(field,{}, {'sms consent for bge inc':true}).kind,'missing',label);
    assert.notEqual(savedAnswerKey(field),'sms consent for bge inc',label);
  }
});

test('text-only application updates consent shares the confirmed employer permission',async()=>{
  const {savedAnswerKey}=await import('../src/answer-memory.mjs');
  const field={label:'Do you consent to text message updates about your application?',company:'BGE, Inc.',type:'radio',options:yesNo};
  assert.equal(savedAnswerKey(field),'sms consent for bge inc');
  assert.equal(resolveAnswer(field,{}, {'sms consent for bge inc':'No'}).value,'no-option');
});

test('different SMS meanings require employer-scoped exact confirmation rather than old unscoped answers',async()=>{
  const {savedAnswerKey}=await import('../src/answer-memory.mjs');
  const field={label:'Do you consent to SMS marketing messages?',company:'BGE, Inc.',type:'radio',options:yesNo};
  const key=savedAnswerKey(field);
  assert.equal(key,'sms consent for bge inc question do you consent to sms marketing messages');
  assert.equal(resolveAnswer(field,{}, {'do you consent to sms marketing messages':'No'}).kind,'missing');
  assert.equal(resolveAnswer(field,{}, {[key]:'No'}).value,'no-option');
  assert.equal(resolveAnswer({...field,company:'Other Employer'}, {}, {[key]:'No'}).kind,'missing');
});

test('an unknown employer placeholder cannot confirm reusable SMS permission',()=>{
  const field={label:'Do you agree to receive text messages about your application?',company:'Company on LinkedIn',type:'radio',options:yesNo};
  const result=resolveAnswer(field,{}, {'sms consent for company on linkedin':'Yes'});
  assert.equal(result.kind,'missing');
  assert.equal(result.manual,true);
  assert.match(result.reason,/directly in LinkedIn/i);
});

test('sponsorship now-or-after-graduation wording is narrower than any future',()=>{
  const field={label:'Will you now or after graduation require sponsorship to work in the US?',type:'radio',options:yesNo};
  assert.equal(resolveAnswer(field,{}, {'will you now or in the future require sponsorship to work in the united states':'No'}).kind,'missing');
});

test('common questions never supply answers before the applicant saves one',async()=>{
  const memory=await import('../src/answer-memory.mjs').catch(()=>({}));
  assert.ok(Array.isArray(memory.commonQuestions));
  assert.ok(memory.commonQuestions.length>=10);
  for(const field of memory.commonQuestions){
    assert.equal(resolveAnswer(field,{},{}).kind,'missing',field.label);
    assert.equal(memory.savedAnswerKey(field),field.key,field.label);
  }
  const authorization=memory.commonQuestions.find(field=>field.key==='are you legally authorized to work in the united states');
  assert.ok(authorization);
  assert.equal(resolveAnswer(authorization,{}, {[authorization.key]:'No'}).value,'No');
});

test('screening meanings safely reuse newly supported education and overall experience answers',()=>{
 for(const [label,key,value] of [['How many total years of experience do you have?','total years of experience',0],['How many years of professional experience do you have?','years of professional experience','1.5'],['What degree are you currently studying for?','degree type',"Bachelor's Degree"],['What is your highest completed degree?','highest degree earned','High School'],['Are you presently enrolled as a student?','are you currently a student',false]]){
  const field={label,type:label.includes('years')?'number':label.includes('student')?'radio':'text',options:[{label:'Yes',value:'yes'},{label:'No',value:'no'}]};const r=resolveAnswer(field,{},{[key]:value});assert.equal(r.kind,'fill',label);assert.equal(r.sourceQuestion,key,label);assert.equal(r.optionLabel??r.value,value===false?'No':String(value));
 }
 const f={label:'How many total years of experience do you have?',type:'number'};
 assert.equal(resolveAnswer(f,{},{'how many total years of experience do you have':0,'total years of experience':2}).value,'0');
 assert.equal(resolveAnswer({...f,label:'Total years of experience'},{},{'how many total years of experience do you have':0,'total years of experience':2}).value,'2');
 for(const value of [false,true,-1,'two','0–1 years'])assert.equal(resolveAnswer(f,{},{'total years of experience':value}).kind,'missing');
 for(const label of ['Years of professional experience','Years of Python experience','Years of paid experience','Years of recent experience','Years of experience'])assert.equal(resolveAnswer({...f,label},{},{'total years of experience':2}).kind,'missing',label);
 assert.equal(resolveAnswer({label:'What is your highest completed degree?',type:'text'},{},{'degree type':"Bachelor's Degree"}).kind,'missing');
});
test('screening sponsorship periods never derive from one another and boolean conflicts stay scoped',()=>{
 const labels=['Do you currently require sponsorship to work in the United States?','Will you require sponsorship to work in the United States in the future?','Will you now or in the future require sponsorship to work in the United States?'];
 for(let i=0;i<labels.length;i++)for(let j=0;j<labels.length;j++)if(i!==j){const f={label:labels[i],type:'radio',options:[{label:'Yes',value:'yes'},{label:'No',value:'no'}]};assert.equal(resolveAnswer(f,{},{[normalizeQuestion(labels[j])]:false}).kind,'missing');}
 const now={label:'Do you currently require sponsorship to work in the US?',type:'radio',options:[{label:'Yes',value:'same'},{label:'No',value:'same'}]};
 const bank={'do you currently require sponsorship to work in the united states':false,'do you currently need visa sponsorship for employment in the united states':'No'};
 assert.equal(resolveAnswer(now,{},bank).optionLabel,'No');bank['do you currently need visa sponsorship for employment in the united states']=true;assert.equal(resolveAnswer(now,{},bank).kind,'missing');
 for(const label of ['If hired, do you currently require sponsorship to work in the US?','Do you currently require sponsorship to work in Canada?','Are you a US citizen?'])assert.equal(resolveAnswer({...now,label},{},bank).kind,'missing');
 assert.equal(resolveAnswer({label:labels[2],type:'text'},{},{[normalizeQuestion(labels[0])]:false,[normalizeQuestion(labels[1])]:false}).kind,'missing');
 assert.equal(describeQuestion(now).screening.qualifiers.timeScope,'now');
});
