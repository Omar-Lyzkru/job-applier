import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultConfig, validateConfig, readiness, normalizeQuestion, resolveAnswer, matchesJob, dayKey, countsTowardCap, blocksRetry} from '../src/domain.mjs';

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
