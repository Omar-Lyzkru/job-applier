import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createStore} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';
import {saveFailureSnapshot} from '../src/failure-snapshots.mjs';

test('browser: dashboard setup, answers, controls and CSV work without rendering imported markup',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'job-applier-dashboard-'));
  const store=await createStore(dir);let state='idle';const commands=[];
  const runner={getStatus:()=>({state,todayCount:0,message:state==='running'?'Applying to matching jobs':'Ready',currentJob:null}),start:async options=>{commands.push(['start',options]);state='running';},stop:async()=>{state='idle';commands.push(['stop']);},openBrowser:async()=>{commands.push(['browser']);}};
  const hostileTitle='<img src=x onerror="window.injected=true">';
  await store.createRecord({id:'1001',url:'https://www.linkedin.com/jobs/view/1001/',title:hostileTitle,company:'Example'},'skipped');
  await store.saveQuestions([{key:'are you willing to relocate',label:'Are you willing to relocate?',type:'radio',options:[{label:'Yes',value:'yes'},{label:'No',value:'no'}],jobId:'1001'}]);
  const app=await createApp({dataDir:dir,store,runner,port:0});await app.listen();
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1360,height:960}});
  page.setDefaultTimeout(5000);
  t.after(async()=>{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});});
  await page.goto(app.url);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  for(const [label,value] of [['First name','Test'],['Last name','Applicant'],['Email','test@example.com'],['Phone','5551234567'],['Job titles','Software Engineer'],['Search location','Chicago']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved',{exact:true}).waitFor();
  const resume=join(dir,'test-resume.pdf');await writeFile(resume,'%PDF-1.4 fixture');
  await page.getByLabel('Upload résumé',{exact:true}).setInputFiles(resume);
  await page.getByText('Résumé saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).search.titles[0],'Software Engineer');
  assert.equal((await store.getConfig()).profile.email,'test@example.com');
  await page.getByRole('button',{name:'Answers',exact:true}).click();
  await page.getByLabel('Question',{exact:true}).fill('Years of Java experience');
  await page.getByLabel('Answer',{exact:true}).fill('0');
  await page.getByRole('button',{name:'Save answer',exact:true}).click();
  await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal((await store.getAnswers())['years of java experience'],'0');
  await page.getByRole('heading',{name:'Are you willing to relocate?',exact:true}).waitFor();
  await page.getByLabel('Answer for Are you willing to relocate?',{exact:true}).selectOption('No');
  await page.getByRole('button',{name:'Save this answer',exact:true}).click();
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();
  await page.getByRole('button',{name:'Open LinkedIn',exact:true}).click();
  await page.getByText('LinkedIn browser opened',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Start applying',exact:true}).click();
  await page.getByText('Applying to matching jobs',{exact:true}).waitFor();
  assert.equal(commands.filter(command=>command[0]==='start').length,1);
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.getByRole('button',{name:'History',exact:true}).click();
  assert.equal(await page.locator('#history-view .job-title').first().textContent(),hostileTitle);
  assert.equal(await page.locator('.job-title img').count(),0);
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('link',{name:'Export CSV',exact:true}).click();
  assert.equal((await downloadPromise).suggestedFilename(),'applications.csv');
  await mkdir(resolve('test-artifacts'),{recursive:true});
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();
  await page.screenshot({path:resolve('test-artifacts/dashboard-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve('test-artifacts/dashboard-mobile.png'),fullPage:true});
});

async function settingsPage(t,profile={},search={},intelligence){
  const dir=await mkdtemp(join(tmpdir(),'job-applier-settings-')),store=await createStore(dir);
  await store.saveConfig({profile,search,...(intelligence?{intelligence}:{})});
  const runner={getStatus:()=>({state:'idle',todayCount:0,message:'Ready',currentJob:null}),stop:async()=>{}};
  const app=await createApp({dataDir:dir,store,runner,port:0});await app.listen();
  const browser=await chromium.launch({headless:true}),page=await browser.newPage();
  page.setDefaultTimeout(5000);
  t.after(async()=>{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});});
  await page.goto(app.url);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#save-settings').disabled);
  return {store,page};
}

test('browser: matching settings round-trip with reviewed facts and editable family searches',async t=>{
  const {store,page}=await settingsPage(t);
  assert.equal(await page.getByLabel('Enable intelligent matching',{exact:true}).isChecked(),false);
  await page.getByLabel('Enable intelligent matching',{exact:true}).check();
  await page.getByLabel('Minimum fit score',{exact:true}).fill('60');
  await page.getByLabel('Confirmed skills',{exact:true}).fill('JS\nPython');
  await page.getByLabel('Professional experience in years',{exact:true}).fill('0');
  await page.getByLabel('Currently a student',{exact:true}).selectOption('false');
  await page.getByLabel('Software engineering',{exact:true}).check();
  await page.getByLabel('Titles for Software engineering',{exact:true}).fill('Software Engineer Intern\nSoftware Developer Intern');
  await page.getByRole('button',{name:'Add search region',exact:true}).click();
  await page.getByLabel('Search region 1',{exact:true}).fill('Houston, TX, USA');
  await page.getByLabel('Priority for region 1',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Add search region',exact:true}).click();
  await page.getByLabel('Search region 2',{exact:true}).fill('United States');
  await page.getByLabel('Workplace for region 2',{exact:true}).selectOption('remote');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByText('Settings saved',{exact:true}).waitFor();
  const config=await store.getConfig();assert.equal(config.intelligence.minimumFitScore,60);assert.equal(config.intelligence.candidate.student,false);assert.equal(config.intelligence.candidate.professionalYears,0);assert.deepEqual(config.intelligence.candidate.skills,['javascript','python']);assert.equal(config.intelligence.regions.length,2);assert.deepEqual(await store.getAnswers(),{});
  await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
  assert.equal(await page.getByLabel('Minimum fit score',{exact:true}).inputValue(),'60');assert.equal(await page.getByLabel('Currently a student',{exact:true}).inputValue(),'false');assert.equal(await page.getByLabel('Confirmed skills',{exact:true}).inputValue(),'JavaScript\nPython');
  await mkdir(resolve('test-artifacts'),{recursive:true});await page.screenshot({path:resolve('test-artifacts/phase1-settings-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve('test-artifacts/phase1-settings-mobile.png'),fullPage:true});
});
test('browser: unrelated settings saves preserve unknown skills until the user confirms an empty list',async t=>{
  const {store,page}=await settingsPage(t);
  await page.getByLabel('First name',{exact:true}).fill('New draft');await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByText('Settings saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).intelligence.candidate.skills,null);
  await page.getByLabel('I have reviewed my skills',{exact:true}).check();await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#save-settings').disabled);assert.deepEqual((await store.getConfig()).intelligence.candidate.skills,[]);
});
test('browser: fit result exposes its score, matched skills and uncertainty without implying submission',async t=>{
  const {store,page}=await settingsPage(t);
  await store.createRecord({id:'1001',title:'Synthetic internship',company:'Example',assessment:{decision:'review',score:85,band:'Excellent',factors:[{key:'skills',earned:25,max:25,evidence:'Required: Python',unknown:false}],matchedSkills:['python'],missingSkills:['git'],uncertainties:['Student status is unknown'],reasons:[{code:'eligibility_review',message:'Review required student status'}]}},'skipped');
  await page.reload();await page.locator('#recent-body').getByText('Fit: 85/100',{exact:true}).waitFor();await page.locator('#recent-body').getByText('Why this fit',{exact:true}).click();
  assert.equal(await page.locator('#recent-body').getByText('Student status is unknown',{exact:true}).isVisible(),true);
  assert.match(await page.locator('#recent-body').textContent(),/Matched skills: Python/);
  assert.match(await page.locator('#recent-body').textContent(),/Missing skills: Git/);
  assert.match(await page.locator('#recent-body').textContent(),/Required: Python/);
  await mkdir(resolve('test-artifacts'),{recursive:true});await page.screenshot({path:resolve('test-artifacts/phase1-fit-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve('test-artifacts/phase1-fit-mobile.png'),fullPage:true});
});

test('browser: phone country answers support typing, visible matching choices, keyboard selection and exact saved labels',async t=>{
  const {store,page}=await settingsPage(t);
  await store.saveQuestions([{key:'phone country code',label:'Phone country code*',type:'select',required:true,options:[{label:'Select an option',value:''},{label:'United States (+1)',value:'us'},{label:'United Kingdom (+44)',value:'gb'},{label:'Canada (+1)',value:'ca'}],jobId:'1001',blocker:'missing_answer'}]);
  await page.reload();await page.getByRole('button',{name:'Answers',exact:true}).click();
  const input=page.getByRole('combobox',{name:'Answer for Phone country code*',exact:true});
  await input.fill('United');
  assert.equal(await page.getByRole('option',{name:'United States (+1)',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('option',{name:'United Kingdom (+44)',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('option',{name:'Canada (+1)',exact:true}).count(),0);
  await mkdir(resolve('test-artifacts'),{recursive:true});
  await page.screenshot({path:resolve('test-artifacts/answers-search-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve('test-artifacts/answers-search-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Save this answer',exact:true}).click();
  await page.getByText('Choose an answer from the list',{exact:true}).waitFor();
  assert.deepEqual(await store.getAnswers(),{});
  await input.fill('Canada');await input.press('ArrowDown');await input.press('Enter');
  assert.equal(await input.inputValue(),'Canada (+1)');
  await input.fill('United');await page.getByRole('option',{name:'United States (+1)',exact:true}).click();
  assert.equal(await input.inputValue(),'United States (+1)');
  await input.fill('');await input.press('Escape');await page.getByRole('button',{name:'Show choices for Phone country code*',exact:true}).click();
  assert.equal(await page.getByRole('option',{name:'Canada (+1)',exact:true}).isVisible(),true);
  await input.fill('united states (+1)');
  await page.getByRole('button',{name:'Save this answer',exact:true}).click();
  await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal((await store.getAnswers())['phone country code'],'United States (+1)');
});

test('browser: saving bare profile links works with Enter and persists normalized URLs',async t=>{
  const {store,page}=await settingsPage(t);
  await page.getByLabel('LinkedIn profile URL',{exact:true}).fill('www.linkedin.com/in/test-applicant');
  await page.getByLabel('Website / portfolio',{exact:true}).fill('portfolio.example/work#about');
  await page.getByLabel('Website / portfolio',{exact:true}).press('Enter');
  await page.getByText('Settings saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).profile.linkedinUrl,'https://www.linkedin.com/in/test-applicant');
  assert.equal((await store.getConfig()).profile.website,'https://portfolio.example/work#about');
  await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#save-settings').disabled);
  assert.equal(await page.getByLabel('LinkedIn profile URL',{exact:true}).inputValue(),'https://www.linkedin.com/in/test-applicant');
});

test('browser: country and state dropdowns preserve saved values and clear stale states on country changes',async t=>{
  const {store,page}=await settingsPage(t,{country:'USA',state:'Texas'});
  const country=page.getByRole('combobox',{name:'Country',exact:true}),region=page.getByRole('combobox',{name:'State / region',exact:true});
  assert.equal(await country.inputValue(),'United States');
  assert.equal(await region.inputValue(),'Texas');
  assert.ok(await page.locator('#country-options option').count()>200);
  await region.fill('California');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).profile.country,'United States');
  assert.equal((await store.getConfig()).profile.state,'California');
  await country.fill('Canada');await country.press('Tab');
  assert.equal(await region.inputValue(),'');
  assert.equal(await page.locator('#region-options option[value=Texas]').count(),0);
  assert.equal(await page.locator('#region-options option[value=Ontario]').count(),1);
  await region.fill('Ontario');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Settings saved'&&!document.querySelector('#save-settings').disabled);
  assert.equal((await store.getConfig()).profile.country,'Canada');
  assert.equal((await store.getConfig()).profile.state,'Ontario');
  await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#save-settings').disabled);
  assert.equal(await country.inputValue(),'Canada');assert.equal(await region.inputValue(),'Ontario');
});

test('browser: dropdowns keep unlisted saved locations until explicitly changed',async t=>{
  const {store,page}=await settingsPage(t,{country:'Custom country',state:'Custom region'});
  const country=page.getByRole('combobox',{name:'Country',exact:true}),region=page.getByRole('combobox',{name:'State / region',exact:true});
  assert.equal(await country.inputValue(),'Custom country');assert.equal(await region.inputValue(),'Custom region');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).profile.state,'Custom region');
  await country.fill('United States');await country.press('Tab');
  assert.equal(await region.inputValue(),'');
  await region.fill('Texas');
  assert.equal(await region.inputValue(),'Texas');
});

test('browser: an invalid profile link explains the field and keeps saved settings',async t=>{
  const {store,page}=await settingsPage(t,{firstName:'Test',linkedinUrl:'https://www.linkedin.com/in/test-applicant'});
  await page.getByLabel('First name',{exact:true}).fill('Changed');
  await page.getByLabel('LinkedIn profile URL',{exact:true}).fill('not a link');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('LinkedIn profile URL must be a valid web address, such as linkedin.com/in/your-name',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).profile.firstName,'Test');
  assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Changed');
  await page.getByLabel('LinkedIn profile URL',{exact:true}).fill('www.linkedin.com/in/new-applicant');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).profile.firstName,'Changed');
  assert.equal(await page.getByLabel('LinkedIn profile URL',{exact:true}).inputValue(),'https://www.linkedin.com/in/new-applicant');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve('test-artifacts/settings-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1360,height:960});
  await page.screenshot({path:resolve('test-artifacts/settings-desktop.png'),fullPage:true});
});

test('browser: recognized location abbreviations save as full names for application choices',async t=>{
  const {store,page}=await settingsPage(t,{country:'U.S.A.',state:'TX'});
  assert.equal(await page.getByRole('combobox',{name:'Country',exact:true}).inputValue(),'United States');
  assert.equal(await page.getByRole('combobox',{name:'State / region',exact:true}).inputValue(),'Texas');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).profile.country,'United States');
  assert.equal((await store.getConfig()).profile.state,'Texas');
});

test('browser: typed country and state values save and survive reload even without a suggestion match',async t=>{
  const {store,page}=await settingsPage(t);
  const country=page.getByRole('combobox',{name:'Country',exact:true}),region=page.getByRole('combobox',{name:'State / region',exact:true});
  await country.fill('Custom country');await country.press('Tab');
  await region.fill('Custom region');
  await region.press('Enter');
  await page.getByText('Settings saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).profile.country,'Custom country');
  assert.equal((await store.getConfig()).profile.state,'Custom region');
  await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#save-settings').disabled);
  assert.equal(await country.inputValue(),'Custom country');assert.equal(await region.inputValue(),'Custom region');
});

test('browser: country typing updates suggestions without clearing state until a different country is committed',async t=>{
  const {store,page}=await settingsPage(t,{country:'United States',state:'Texas'});
  const country=page.getByRole('combobox',{name:'Country',exact:true}),region=page.getByRole('combobox',{name:'State / region',exact:true});
  await country.fill('Can');
  assert.equal(await country.inputValue(),'Can');assert.equal(await region.inputValue(),'Texas');
  await country.fill('USA');await country.press('Tab');
  assert.equal(await country.inputValue(),'United States');assert.equal(await region.inputValue(),'Texas');
  await country.fill('Canada');
  assert.equal(await page.locator('#region-options option[value=Ontario]').count(),1);
  assert.equal(await region.inputValue(),'Texas');
  await country.press('Tab');assert.equal(await region.inputValue(),'');
  await region.fill('ON');await region.press('Enter');
  await page.getByText('Settings saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).profile.country,'Canada');assert.equal((await store.getConfig()).profile.state,'Ontario');
});

test('browser: experience filters and keyword matching persist across reload and levels can be cleared',async t=>{
  const {store,page}=await settingsPage(t,{}, {titles:['Software Engineer'],includeKeywords:['Python','Remote'],excludeKeywords:['Unpaid']});
  const levels=page.getByRole('group',{name:'Experience level',exact:true});
  const keywordMatch=page.getByRole('combobox',{name:'Keyword matching',exact:true});
  assert.equal(await levels.getByRole('checkbox').count(),6);
  assert.equal(await levels.getByRole('checkbox',{checked:true}).count(),0);
  assert.equal(await keywordMatch.inputValue(),'all');
  assert.match(await page.locator('#include-help').textContent(),/All must match/);
  await levels.getByRole('checkbox',{name:'Internship',exact:true}).check();
  await levels.getByRole('checkbox',{name:'Entry level',exact:true}).check();
  await keywordMatch.selectOption('any');
  assert.match(await page.locator('#include-help').textContent(),/Any can match/);
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Settings saved'&&!document.querySelector('#save-settings').disabled);
  let search=(await store.getConfig()).search;
  assert.deepEqual(search.experienceLevels,['INTERNSHIP','ENTRY_LEVEL']);
  assert.equal(search.keywordMatch,'any');
  assert.deepEqual(search.titles,['Software Engineer']);
  assert.deepEqual(search.includeKeywords,['Python','Remote']);
  assert.deepEqual(search.excludeKeywords,['Unpaid']);
  await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#save-settings').disabled);
  assert.equal(await levels.getByRole('checkbox',{name:'Internship',exact:true}).isChecked(),true);
  assert.equal(await levels.getByRole('checkbox',{name:'Entry level',exact:true}).isChecked(),true);
  assert.equal(await levels.getByRole('checkbox',{checked:true}).count(),2);
  assert.equal(await keywordMatch.inputValue(),'any');
  assert.match(await page.locator('#include-help').textContent(),/Any can match/);
  await keywordMatch.selectOption('all');
  assert.match(await page.locator('#include-help').textContent(),/All must match/);
  await levels.getByRole('checkbox',{name:'Internship',exact:true}).uncheck();
  await levels.getByRole('checkbox',{name:'Entry level',exact:true}).uncheck();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Settings saved'&&!document.querySelector('#save-settings').disabled);
  search=(await store.getConfig()).search;
  assert.deepEqual(search.experienceLevels,[]);
  assert.equal(search.keywordMatch,'all');
  await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#save-settings').disabled);
  assert.equal(await levels.getByRole('checkbox',{checked:true}).count(),0);
  assert.equal(await keywordMatch.inputValue(),'all');
});

test('browser: résumé keyword recommendations are opt-in and preserve unsaved profile and search edits',async t=>{
  const {store,page}=await settingsPage(t,{firstName:'Saved'}, {titles:['Saved role'],includeKeywords:['Remote'],excludeKeywords:['Unpaid'],experienceLevels:['ENTRY_LEVEL']});
  const read=page.getByRole('button',{name:'Read résumé',exact:true});
  assert.equal(await read.count(),1);
  assert.equal(await read.isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Add selected keywords',exact:true}).isDisabled(),true);
  let requests=0;
  await page.route('**/api/resume/keywords',async route=>{
    requests++;assert.equal(route.request().method(),'POST');assert.deepEqual(route.request().postDataJSON(),{});
    assert.ok(route.request().headers()['x-app-token']);
    await route.fulfill({json:{resume:(await store.getConfig()).resume,keywords:['Python','SQL','JavaScript']}});
  });
  await page.getByLabel('First name',{exact:true}).fill('Unsaved');
  await page.getByLabel('Job titles',{exact:true}).fill('Backend Engineer');
  await page.getByLabel('Include keywords',{exact:true}).fill('python\nKubernetes');
  await page.getByLabel('Exclude keywords',{exact:true}).fill('Contract');
  await page.getByLabel('Upload résumé',{exact:true}).setInputFiles({name:'skills.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-test fixture')});
  const skills=page.getByRole('group',{name:'Recommended skills',exact:true});
  await skills.getByRole('checkbox',{name:'SQL',exact:true}).waitFor();
  assert.equal(requests,1);
  assert.equal(await page.getByLabel('Include keywords',{exact:true}).inputValue(),'python\nKubernetes');
  assert.equal(await page.getByLabel('First name',{exact:true}).inputValue(),'Unsaved');
  assert.equal((await store.getConfig()).search.keywordMatch,'all');
  await skills.getByRole('checkbox',{name:'Python',exact:true}).check();
  await skills.getByRole('checkbox',{name:'SQL',exact:true}).check();
  await page.getByRole('button',{name:'Add selected keywords',exact:true}).click();
  assert.equal(await page.getByLabel('Include keywords',{exact:true}).inputValue(),'python\nKubernetes\nSQL');
  assert.equal(await page.getByRole('combobox',{name:'Keyword matching',exact:true}).inputValue(),'any');
  assert.match(await page.locator('#toast').textContent(),/Save settings/);
  assert.deepEqual((await store.getConfig()).search.includeKeywords,['Remote']);
  assert.equal((await store.getConfig()).intelligence.candidate.skills,null);
  await page.getByRole('button',{name:'Add selected skills',exact:true}).click();
  assert.equal(await page.getByLabel('Confirmed skills',{exact:true}).inputValue(),'Python\nSQL');
  assert.equal((await store.getConfig()).intelligence.candidate.skills,null);
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Settings saved'&&!document.querySelector('#save-settings').disabled);
  const config=await store.getConfig();
  assert.equal(config.profile.firstName,'Unsaved');
  assert.deepEqual(config.intelligence.candidate.skills,['python','sql']);
  assert.deepEqual(config.search.titles,['Backend Engineer']);
  assert.deepEqual(config.search.includeKeywords,['python','Kubernetes','SQL']);
  assert.deepEqual(config.search.excludeKeywords,['Contract']);
  assert.deepEqual(config.search.experienceLevels,['ENTRY_LEVEL']);
  assert.equal(config.search.keywordMatch,'any');
  await page.reload();await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#save-settings').disabled);
  assert.equal(await read.isDisabled(),false);
  await read.click();await skills.getByRole('checkbox',{name:'SQL',exact:true}).waitFor();
  assert.equal(requests,2);
});

test('browser: résumé keyword extraction failure is inline and the uploaded résumé stays saved',async t=>{
  const {store,page}=await settingsPage(t);
  assert.equal(await page.getByRole('button',{name:'Read résumé',exact:true}).count(),1);
  await page.route('**/api/resume/keywords',route=>route.fulfill({status:400,json:{error:'No readable text. Upload a text-based résumé.'}}));
  await page.getByLabel('Include keywords',{exact:true}).fill('Manual skill');
  await page.getByLabel('Upload résumé',{exact:true}).setInputFiles({name:'scan.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-test fixture')});
  await page.locator('#recommendation-status').filter({hasText:'No readable text'}).waitFor();
  await page.getByText('Résumé saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).resume.filename,'scan.pdf');
  assert.equal(await page.locator('#resume-name').textContent(),'scan.pdf');
  assert.equal(await page.getByLabel('Include keywords',{exact:true}).inputValue(),'Manual skill');
  assert.equal(await page.locator('#toast').textContent(),'Résumé saved');
  assert.equal(await page.locator('#toast').evaluate(element=>element.classList.contains('error')),false);
  assert.equal(await page.getByRole('button',{name:'Read résumé',exact:true}).isDisabled(),false);
  assert.equal(await page.getByRole('button',{name:'Add selected keywords',exact:true}).isDisabled(),true);
});

test('browser: résumé keyword responses from an older upload cannot replace current suggestions',async t=>{
  const {store,page}=await settingsPage(t);
  assert.equal(await page.getByRole('button',{name:'Read résumé',exact:true}).count(),1);
  let requests=0,releaseOlder;
  const olderPending=new Promise(resolve=>{releaseOlder=resolve;});
  await page.route('**/api/resume/keywords',async route=>{
    const request=++requests,resume=(await store.getConfig()).resume;
    if(request===2)await olderPending;
    await route.fulfill({json:{resume,keywords:request===1?['Python']:request===2?['JavaScript']:['SQL']}});
  });
  const upload=name=>page.getByLabel('Upload résumé',{exact:true}).setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-test fixture')});
  const skills=page.getByRole('group',{name:'Recommended skills',exact:true});
  await upload('first.pdf');await skills.getByRole('checkbox',{name:'Python',exact:true}).waitFor();
  await upload('second.pdf');
  await page.waitForFunction(()=>document.querySelector('#recommendation-status').textContent.includes('Reading'));
  assert.equal(await skills.getByRole('checkbox',{name:'Python',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Read résumé',exact:true}).isDisabled(),true);
  await page.waitForFunction(()=>!document.querySelector('#resume-upload').disabled);
  await upload('third.pdf');await skills.getByRole('checkbox',{name:'SQL',exact:true}).waitFor();
  const olderResponse=page.waitForResponse(response=>response.url().endsWith('/api/resume/keywords'));
  releaseOlder();await (await olderResponse).finished();
  assert.equal((await store.getConfig()).resume.filename,'third.pdf');
  assert.equal(await skills.getByRole('checkbox',{name:'SQL',exact:true}).count(),1);
  assert.equal(await skills.getByRole('checkbox',{name:'JavaScript',exact:true}).count(),0);
});

test('browser: real résumé extraction populates selectable keywords on desktop and mobile',async t=>{
  const {store,page}=await settingsPage(t);
  await page.getByLabel('Upload résumé',{exact:true}).setInputFiles(resolve('test/fixtures/resumes/skills.pdf'));
  const skills=page.getByRole('group',{name:'Recommended skills',exact:true});
  await skills.getByRole('checkbox',{name:'Python',exact:true}).waitFor();
  assert.equal(await skills.getByRole('checkbox').count(),7);
  assert.deepEqual((await store.getConfig()).search.includeKeywords,[]);
  await skills.getByRole('checkbox',{name:'Python',exact:true}).check();
  await skills.getByRole('checkbox',{name:'SQL',exact:true}).check();
  await page.getByRole('button',{name:'Add selected keywords',exact:true}).click();
  assert.equal(await page.getByLabel('Include keywords',{exact:true}).inputValue(),'Python\nSQL');
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Settings saved'&&!document.querySelector('#save-settings').disabled);
  const search=(await store.getConfig()).search;
  assert.deepEqual(search.includeKeywords,['Python','SQL']);
  assert.equal(search.keywordMatch,'any');
  await mkdir(resolve('test-artifacts'),{recursive:true});
  await page.screenshot({path:resolve('test-artifacts/resume-keywords-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve('test-artifacts/resume-keywords-mobile.png'),fullPage:true});
});

async function answerMemoryPage(t,{answers={},questions=[],employers=[]}={}){
  const {store,page}=await settingsPage(t);
  await store.saveAnswers(answers);
  if(questions.length)await store.saveQuestions(questions);
  for(const [index,company] of employers.entries())await store.createRecord({id:String(1001+index),title:'Example role',company},'needs_answer');
  await page.reload();await page.getByRole('button',{name:'Answers',exact:true}).click();
  return {store,page};
}

const authorizationKey='are you legally authorized to work in the united states';
const sponsorshipKey='will you now or in the future require sponsorship to work in the united states';

const repeatQuestion={key:'evening work',label:'Evening work?',type:'radio',required:true,options:[{label:'Yes',value:'y'},{label:'No',value:'n'}],jobId:'1001',company:'First employer',blocker:'operational',reason:'Selection timed out'};
const waitBootstrap=page=>page.waitForResponse(response=>response.url().endsWith('/api/bootstrap'));

test('browser: grouped repeats have one editor, all job details, distinct counts and durable saved status',async t=>{
  const second={...repeatQuestion,jobId:'1002',company:'Second employer',reason:'Read-only answer differs'};
  const {store,page}=await answerMemoryPage(t,{questions:[repeatQuestion,second],employers:['First employer','Second employer']});
  const pending=page.locator('#pending-questions'),card=pending.locator('.pending-question');
  assert.equal(await card.count(),1);assert.equal(await pending.getByLabel('Answer for Evening work?',{exact:true}).count(),1);
  assert.equal(await page.locator('#question-count').textContent(),'1');assert.match(await page.locator('#question-summary').textContent(),/1 question.*2 applications/);
  await card.locator('.affected-applications > summary').click();assert.equal(await card.locator('a[href*="/jobs/view/"]').count(),2);
  assert.match(await card.textContent(),/Selection timed out/);assert.match(await card.textContent(),/Read-only answer differs/);
  await card.getByLabel('Answer for Evening work?',{exact:true}).selectOption('No');await card.getByRole('button',{name:'Save this answer',exact:true}).click();await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.deepEqual(await store.getAnswers(),{'evening work':'No'});assert.equal((await store.getQuestions()).length,2);assert.match(await card.textContent(),/Saved answer: No/);
  await page.reload();await page.getByRole('button',{name:'Answers',exact:true}).click();assert.match(await card.textContent(),/Saved answer: No/);
  await card.locator('.affected-applications > summary').click();await mkdir(resolve('test-artifacts'),{recursive:true});await page.screenshot({path:resolve('test-artifacts/grouped-questions-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve('test-artifacts/grouped-questions-mobile.png'),fullPage:true});
});

test('browser: grouped drafts survive polling membership, saved source changes and unrelated saves',async t=>{
  const q={...repeatQuestion,label:'Why this company?',key:'why this company',type:'text',options:[]};
  const {store,page}=await answerMemoryPage(t,{questions:[q],answers:{'why this company':'Prior','favorite color':'Blue'},employers:['First employer']});
  await page.getByLabel('Answer for Why this company?',{exact:true}).fill('My retained edit');
  let refreshed=waitBootstrap(page);await store.saveQuestions([{...q,jobId:'1002',reason:'New failure'},q]);await refreshed;await page.getByText('2 occurrences',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Answer for Why this company?',{exact:true}).inputValue(),'My retained edit');
  refreshed=waitBootstrap(page);await store.saveAnswers({'why this company':'Updated saved response','favorite color':'Blue'});await refreshed;await page.getByText(/Saved answer: Updated saved response/).waitFor();
  assert.equal(await page.getByLabel('Answer for Why this company?',{exact:true}).inputValue(),'My retained edit');
  await page.getByLabel('Employer for text messages',{exact:true}).selectOption('First employer');await page.getByLabel('Text message consent',{exact:true}).selectOption('No');await page.getByRole('button',{name:'Save text message consent',exact:true}).click();await page.getByText('Text message consent saved for First employer',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Answer for Why this company?',{exact:true}).inputValue(),'My retained edit');
  const library=page.locator('#answer-library').getByLabel('Answer for favorite color',{exact:true});await library.fill('Green');await library.locator('xpath=ancestor::article[1]').getByRole('button',{name:'Update answer',exact:true}).click();await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Answer for Why this company?',{exact:true}).inputValue(),'My retained edit');
  await page.getByText('Common questions',{exact:true}).click();const common=page.locator('#common-questions').getByLabel('Answer for Are you currently a student?',{exact:true});await common.selectOption('Yes');await common.locator('xpath=ancestor::article[1]').getByRole('button',{name:'Save this answer',exact:true}).click();await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Answer for Why this company?',{exact:true}).inputValue(),'My retained edit');
  refreshed=waitBootstrap(page);await store.saveQuestions([q]);await refreshed;await page.getByText('1 occurrence',{exact:true}).waitFor();assert.equal(await page.getByLabel('Answer for Why this company?',{exact:true}).inputValue(),'My retained edit');
});

test('browser: a changed choice or date format retains the old edit separately',async t=>{
  const q={...repeatQuestion,label:'Location preference',key:'location preference',type:'select',options:[{label:'Houston',value:'h'},{label:'Austin',value:'a'}]};
  const date={...repeatQuestion,label:'Expected graduation',key:'expected graduation',type:'text',options:[],pattern:'[A-Za-z]+ [0-9]{4}',placeholder:'Term YYYY'};
  const {store,page}=await answerMemoryPage(t,{questions:[q,date]});
  const pending=page.locator('#pending-questions');await pending.getByRole('combobox',{name:'Answer for Location preference',exact:true}).fill('Houston');await pending.getByLabel('Answer for Expected graduation',{exact:true}).fill('Spring 2028');
  const refreshed=waitBootstrap(page);await store.saveQuestions([{...q,options:[{label:'Dallas',value:'d'},{label:'Austin',value:'a'}]},{...date,pattern:'[0-9]{2}/[0-9]{4}',placeholder:'MM/YYYY'}]);await refreshed;
  await page.locator('#retained-question-drafts').getByText('Houston',{exact:true}).waitFor();assert.equal(await pending.getByRole('combobox',{name:'Answer for Location preference',exact:true}).inputValue(),'');assert.equal(await pending.getByLabel('Answer for Expected graduation',{exact:true}).inputValue(),'');
  assert.match(await page.locator('#retained-question-drafts').textContent(),/Spring 2028/);assert.equal(await page.locator('#retained-question-drafts button').count(),0);assert.deepEqual(await store.getAnswers(),{});
  await mkdir(resolve('test-artifacts'),{recursive:true});await page.screenshot({path:resolve('test-artifacts/retained-drafts-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve('test-artifacts/retained-drafts-mobile.png'),fullPage:true});
});

test('browser: split and merged resolution groups preserve edits until an explicit target is chosen',async t=>{
  const {store,page}=await answerMemoryPage(t,{questions:[repeatQuestion]});
  await page.getByLabel('Answer for Evening work?',{exact:true}).selectOption('No');
  let split=true;
  await page.route('**/api/bootstrap',async route=>{const response=await route.fetch(),data=await response.json();if(split){const group=data.questionGroups[0];data.questionGroups=[{...group,id:'first-split',savedAnswer:{answer:'Yes',displayAnswer:'Yes'},question:{...group.question,savedAnswer:{answer:'Yes',displayAnswer:'Yes'}}},{...group,id:'second-split',savedAnswer:null,question:{...group.question,company:'Second employer'}}];data.questionCounts.distinctQuestions=2;}await route.fulfill({response,json:data});});
  await waitBootstrap(page);await page.waitForFunction(()=>document.querySelectorAll('#pending-questions .pending-question').length===2);
  const editors=page.getByLabel('Answer for Evening work?',{exact:true});assert.deepEqual(await editors.evaluateAll(inputs=>inputs.map(input=>input.value)),['Yes','']);
  const retained=page.locator('#retained-question-drafts');await retained.getByText('No',{exact:true}).waitFor();await retained.getByRole('button',{name:/Use for this question/}).nth(1).click();
  assert.deepEqual(await editors.evaluateAll(inputs=>inputs.map(input=>input.value)),['Yes','No']);assert.deepEqual(await store.getAnswers(),{});
  split=false;await waitBootstrap(page);await page.waitForFunction(()=>document.querySelectorAll('#pending-questions .pending-question').length===1);assert.equal(await page.getByLabel('Answer for Evening work?',{exact:true}).inputValue(),'No');
});

test('browser: ambiguous C-family questions stay visible with no futile Save editor',async t=>{
  const questions=['C','C++','C#'].map(skill=>({...repeatQuestion,label:`Years of ${skill} experience`,key:'years of c experience',type:'number',options:[]}));
  const {page}=await answerMemoryPage(t,{questions,answers:{'years of c experience':2}});
  assert.equal(await page.locator('#pending-questions .pending-question').count(),3);assert.equal(await page.locator('#pending-questions .answer-row').count(),0);assert.match(await page.locator('#pending-questions').textContent(),/directly in LinkedIn/);
});

test('browser: common questions save explicit authorization without choosing sponsorship or losing another draft',async t=>{
  const {store,page}=await answerMemoryPage(t);
  await page.getByText('Common questions',{exact:true}).click();
  const authorization=page.getByLabel('Answer for Are you legally authorized to work in the United States?',{exact:true});
  const sponsorship=page.getByLabel('Answer for Will you now or in the future require sponsorship to work in the United States?',{exact:true});
  const school=page.getByLabel('Answer for School',{exact:true});
  await authorization.waitFor();
  assert.equal(await authorization.inputValue(),'');assert.equal(await sponsorship.inputValue(),'');
  await school.fill('University of Houston');
  await page.waitForResponse(response=>response.url().endsWith('/api/bootstrap'));
  assert.equal(await school.inputValue(),'University of Houston');
  await authorization.selectOption('No');
  await authorization.locator('xpath=ancestor::article[1]').getByRole('button',{name:'Save this answer',exact:true}).click();
  await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal((await store.getAnswers())[authorizationKey],'No');
  assert.equal((await store.getAnswers())[sponsorshipKey],undefined);
  assert.equal((await store.getAnswers()).school,undefined);
  assert.equal(await school.inputValue(),'University of Houston');
  assert.equal(await sponsorship.inputValue(),'');
  await page.reload();await page.getByRole('button',{name:'Answers',exact:true}).click();
  await page.getByText('Common questions',{exact:true}).click();
  assert.equal(await authorization.inputValue(),'No');
  assert.match(await authorization.locator('xpath=ancestor::article[1]').textContent(),/Saved from: are you legally authorized/);
});

test('browser: similar answer suggestions fill valid choices only and require explicit saving',async t=>{
  const question={key:'preferred programming language',label:'Preferred programming language?',type:'select',options:[{label:'Python',value:'py'},{label:'C++',value:'cpp'}],jobId:'1001',company:'BGE, Inc.',blocker:'missing_answer'};
  const {store,page}=await answerMemoryPage(t,{answers:{'favorite programming language':'Python','programming language used':'Java'},questions:[question]});
  const card=page.locator('.pending-question').filter({has:page.getByRole('heading',{name:question.label,exact:true})});
  await card.getByText('favorite programming language',{exact:true}).waitFor();
  assert.match(await card.textContent(),/Python/);
  const input=page.getByRole('combobox',{name:`Answer for ${question.label}`,exact:true});
  await card.locator('.answer-suggestion').filter({hasText:'Java'}).getByRole('button',{name:'Use this answer',exact:true}).click();
  await page.getByText('That answer is not one of the current choices',{exact:true}).waitFor();
  assert.equal(await input.inputValue(),'');
  await card.locator('.answer-suggestion').filter({hasText:'favorite programming language'}).getByRole('button',{name:'Use this answer',exact:true}).click();
  assert.equal(await input.inputValue(),'Python');
  assert.equal((await store.getAnswers())[question.key],undefined);
  await page.waitForResponse(response=>response.url().endsWith('/api/bootstrap'));
  assert.equal(await input.inputValue(),'Python');
  await card.getByRole('button',{name:'Save this answer',exact:true}).click();
  await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal((await store.getAnswers())[question.key],'Python');
});

test('browser: SMS consent starts blank and saves separately for the explicitly selected employer',async t=>{
  const {store,page}=await answerMemoryPage(t,{answers:{'sms consent for bge inc':'No'},employers:['BGE, Inc.','Another Employer']});
  const employer=page.getByLabel('Employer for text messages',{exact:true}),consent=page.getByLabel('Text message consent',{exact:true});
  await employer.waitFor();
  assert.equal(await employer.inputValue(),'');assert.equal(await consent.inputValue(),'');
  await page.getByRole('button',{name:'Save text message consent',exact:true}).click();
  await page.getByText('Choose an employer first',{exact:true}).waitFor();
  await employer.selectOption('BGE, Inc.');assert.equal(await consent.inputValue(),'No');
  await employer.selectOption('Another Employer');assert.equal(await consent.inputValue(),'');
  await consent.selectOption('Yes');
  await page.getByRole('button',{name:'Save text message consent',exact:true}).click();
  await page.getByText('Text message consent saved for Another Employer',{exact:true}).waitFor();
  assert.deepEqual(await store.getAnswers(),{'sms consent for bge inc':'No','sms consent for another employer':'Yes'});
  await employer.selectOption('BGE, Inc.');assert.equal(await consent.inputValue(),'No');
  await page.reload();await page.getByRole('button',{name:'Answers',exact:true}).click();
  assert.equal(await employer.inputValue(),'');assert.equal(await consent.inputValue(),'');
});

test('browser: recognized answers show original question and employer as text on mobile',async t=>{
  const {page}=await answerMemoryPage(t,{answers:{'field of study':'Computer Science/IT','university name':'University of Houston'},questions:[{label:'Major*',key:'major',type:'text',jobId:'1001',company:'BGE, Inc.',blocker:'missing_answer'},{label:'School*',key:'school',type:'text',jobId:'1002',company:'<img src=x onerror="window.injected=true">',blocker:'missing_answer'}]});
  const recognized=page.getByRole('region',{name:'Recognized saved answers',exact:true});
  await recognized.getByText('field of study',{exact:true}).waitFor();
  assert.match(await recognized.textContent(),/Major\*/);assert.match(await recognized.textContent(),/Computer Science\/IT/);assert.match(await recognized.textContent(),/BGE, Inc\./);
  assert.equal(await recognized.locator('img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

test('browser: a selected pending choice survives another question being answered in Common questions',async t=>{
  const question={key:'preferred programming language',label:'Preferred programming language?',type:'select',options:[{label:'Python',value:'py'},{label:'C++',value:'cpp'}],jobId:'1001',company:'BGE, Inc.',blocker:'missing_answer'};
  const authorizationQuestion={key:authorizationKey,label:'Are you legally authorized to work in the United States?',type:'radio',options:[{label:'Yes',value:'yes'},{label:'No',value:'no'}],jobId:'1001',company:'BGE, Inc.',blocker:'missing_answer'};
  const {store,page}=await answerMemoryPage(t,{questions:[question,authorizationQuestion]});
  const programming=page.getByRole('combobox',{name:`Answer for ${question.label}`,exact:true});
  await programming.fill('Py');await page.getByRole('option',{name:'Python',exact:true}).click();
  await page.getByText('Common questions',{exact:true}).click();
  const common=page.locator('#common-questions'),authorization=common.getByLabel('Answer for Are you legally authorized to work in the United States?',{exact:true});
  await authorization.selectOption('No');
  await authorization.locator('xpath=ancestor::article[1]').getByRole('button',{name:'Save this answer',exact:true}).click();
  await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal(await page.locator('#pending-questions').getByRole('heading',{name:authorizationQuestion.label,exact:true}).count(),0);
  assert.equal(await programming.inputValue(),'Python');assert.equal((await store.getAnswers())[question.key],undefined);
});

test('browser: pending SMS answer saves the employer-specific key provided by bootstrap',async t=>{
  const question={key:'do you consent to receiving sms messages about your application status',label:'Do you consent to receiving SMS messages about your application status?',type:'radio',options:[{label:'Yes',value:'yes'},{label:'No',value:'no'}],jobId:'1001',company:'BGE, Inc.',blocker:'missing_answer'};
  const {store,page}=await answerMemoryPage(t,{questions:[question],answers:{'text message consent':'Yes'}});
  const card=page.locator('.pending-question').filter({has:page.getByRole('heading',{name:question.label,exact:true})});
  const input=page.getByLabel(`Answer for ${question.label}`,{exact:true});await input.waitFor();
  await card.getByRole('button',{name:'Use this answer',exact:true}).click();
  assert.equal(await input.inputValue(),'Yes');assert.equal((await store.getAnswers())['sms consent for bge inc'],undefined);
  await card.getByRole('button',{name:'Save this answer',exact:true}).click();await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal((await store.getAnswers())['sms consent for bge inc'],'Yes');assert.equal((await store.getAnswers())[question.key],undefined);
});

test('browser: answer suggestions reject opaque option codes and repeated choice labels',async t=>{
  const questions=[{key:'department preference',label:'Department preference*',type:'select',options:[{label:'IT',value:'1'},{label:'Marketing',value:'2'}],jobId:'1001',company:'BGE, Inc.',blocker:'missing_answer'}, {key:'location preference',label:'Location preference*',type:'select',options:[{label:'Houston, TX',value:'a'},{label:'Houston, TX',value:'b'}],jobId:'1001',company:'BGE, Inc.',blocker:'missing_answer'}];
  const {store,page}=await answerMemoryPage(t,{answers:{'department preference':'1','location preference':'Houston, TX'},questions});
  for(const question of questions){
    const card=page.locator('.pending-question').filter({has:page.getByRole('heading',{name:question.label,exact:true})});
    await card.getByRole('button',{name:'Use this answer',exact:true}).click();
    await page.getByText('That answer is not one of the current choices',{exact:true}).waitFor();
    assert.equal(await page.getByRole('combobox',{name:`Answer for ${question.label}`,exact:true}).inputValue(),'');
  }
  assert.deepEqual(await store.getAnswers(),{'department preference':'1','location preference':'Houston, TX'});
});

test('browser: saved answers remain visible on operational question cards after saving and reloading',async t=>{
  const question={key:'are you authorized to work legally in the us',label:'Are you authorized to work legally in the US?*',type:'radio',required:true,options:[{label:'Yes',value:'on'},{label:'No',value:'on'}],jobId:'1001',company:'BGE, Inc.',blocker:'operational',reason:'Could not enter the saved answer: locator.isChecked: Timeout 10000ms exceeded.'};
  const {store,page}=await answerMemoryPage(t,{questions:[question]});
  const card=page.locator('.pending-question'),input=card.getByLabel(`Answer for ${question.label}`,{exact:true});
  await input.selectOption('No');await card.getByRole('button',{name:'Save this answer',exact:true}).click();
  await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal((await store.getAnswers())[question.key],'No');
  assert.equal(await input.inputValue(),'No');
  assert.match(await card.textContent(),/Saved answer: No/);
  await page.reload();await page.getByRole('button',{name:'Answers',exact:true}).click();
  assert.equal(await input.inputValue(),'No');
  assert.match(await card.textContent(),/Saved answer: No/);
  assert.match(await card.textContent(),/LinkedIn.*retry/i);
  assert.equal((await store.getQuestions()).length,1);
  await mkdir(resolve('test-artifacts'),{recursive:true});
  await page.screenshot({path:resolve('test-artifacts/saved-pending-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:resolve('test-artifacts/saved-pending-mobile.png'),fullPage:true});
});

test('browser: changing a common answer refreshes a retained equivalent question without losing another draft',async t=>{
  const question={key:'are you authorized to work legally in the us',label:'Are you authorized to work legally in the US?*',type:'radio',required:true,options:[{label:'Yes',value:'on'},{label:'No',value:'on'}],jobId:'1001',company:'BGE, Inc.',blocker:'operational',reason:'Could not enter the saved answer: locator.isChecked: Timeout 10000ms exceeded.'};
  const draftQuestion={key:'why this company',label:'Why this company?*',type:'text',required:true,options:[],jobId:'1002',company:'Example',blocker:'missing_answer'};
  const {store,page}=await answerMemoryPage(t,{answers:{[authorizationKey]:'No'},questions:[question,draftQuestion]});
  const pending=page.locator('#pending-questions'),card=pending.locator('.pending-question').filter({has:page.getByRole('heading',{name:question.label,exact:true})});
  const input=card.getByLabel(`Answer for ${question.label}`,{exact:true}),draft=page.getByLabel(`Answer for ${draftQuestion.label}`,{exact:true});
  await draft.fill('My unsaved reason');
  await page.getByText('Common questions',{exact:true}).click();
  const common=page.locator('#common-questions').getByLabel('Answer for Are you legally authorized to work in the United States?',{exact:true});
  await common.selectOption('Yes');await common.locator('xpath=ancestor::article[1]').getByRole('button',{name:'Save this answer',exact:true}).click();
  await page.getByText('Answer saved',{exact:true}).waitFor();
  assert.equal((await store.getAnswers())[authorizationKey],'Yes');
  assert.equal(await input.inputValue(),'Yes');
  assert.match(await card.textContent(),/Saved answer: Yes/);
  assert.equal(await draft.inputValue(),'My unsaved reason');
  assert.equal((await store.getAnswers())[draftQuestion.key],undefined);
});

test('browser: retained question editors show saved false and zero answers without inventing choices',async t=>{
  const questions=[{key:'willing to relocate',label:'Willing to relocate?*',type:'checkbox',required:true,options:[],jobId:'1001',blocker:'operational',reason:'Could not enter the saved answer'}, {key:'years of rust experience',label:'Years of Rust experience*',type:'number',required:true,options:[],jobId:'1001',blocker:'operational',reason:'Could not enter the saved answer'}];
  const {page}=await answerMemoryPage(t,{answers:{'willing to relocate':false,'years of rust experience':0},questions});
  assert.equal(await page.getByLabel('Answer for Willing to relocate?*',{exact:true}).inputValue(),'No');
  assert.equal(await page.getByLabel('Answer for Years of Rust experience*',{exact:true}).inputValue(),'0');
  assert.match(await page.locator('#pending-questions').textContent(),/Saved answer: No/);
  assert.match(await page.locator('#pending-questions').textContent(),/Saved answer: 0/);
});

test('browser: retained choices display their resolved meaning rather than raw answer syntax or option codes',async t=>{
  const questions=[{key:'willing to travel',label:'Willing to travel?*',type:'radio',required:true,options:[{label:'Yes',value:'on'},{label:'No',value:'on'}],jobId:'1001',blocker:'operational',reason:'Could not enter the saved answer'}, {key:'willing to relocate',label:'Willing to relocate?*',type:'checkbox',required:true,options:[],jobId:'1001',blocker:'operational',reason:'Could not enter the saved answer'}];
  const {store,page}=await answerMemoryPage(t,{answers:{'willing to travel':'Yes!','willing to relocate':'0'},questions});
  assert.equal(await page.getByLabel('Answer for Willing to travel?*',{exact:true}).inputValue(),'Yes');
  assert.equal(await page.getByLabel('Answer for Willing to relocate?*',{exact:true}).inputValue(),'No');
  assert.deepEqual(await store.getAnswers(),{'willing to travel':'Yes!','willing to relocate':'0'});
});

test('browser: rejected answer saves preserve the stored answer and keep the edited draft visible',async t=>{
  const question={key:'why this company',label:'Why this company?*',type:'text',required:true,options:[],jobId:'1001',company:'Example',blocker:'operational',reason:'Could not enter the saved answer'};
  const {store,page}=await answerMemoryPage(t,{answers:{'why this company':'Original response'},questions:[question]});
  const card=page.locator('.pending-question'),input=card.getByLabel(`Answer for ${question.label}`,{exact:true}),draft='x'.repeat(10001);
  await input.fill(draft);await card.getByRole('button',{name:'Save this answer',exact:true}).click();
  await page.getByText('Answer is too long',{exact:true}).waitFor();
  assert.equal((await store.getAnswers())[question.key],'Original response');
  assert.equal(await input.inputValue(),draft);
  assert.match(await card.textContent(),/Saved answer: Original response/);
  assert.equal(await page.locator('#toast').evaluate(element=>element.classList.contains('error')),true);
});


async function attentionPage(t){
 const dir=await mkdtemp(join(tmpdir(),'job-applier-attention-')),store=await createStore(dir),commands=[];let state='idle',rejectRetry=false;
 const resume=join(dir,'fixture.pdf');await writeFile(resume,'%PDF synthetic');
 await store.saveConfig({profile:{firstName:'Test',lastName:'Applicant',email:'test@example.com',phone:'5551234567'},search:{titles:['Developer'],location:'Houston'},resume:{path:resume,filename:'fixture.pdf',size:14}});
 const job=id=>({id:String(id),title:`Fixture role ${id}`,company:'Fixture employer',url:`https://www.linkedin.com/jobs/view/${id}/`});
 const missing=await store.createRecord(job(3301),'needs_answer'),operational=await store.createRecord(job(3302),'needs_answer'),uncertain=await store.createRecord(job(3303),'unconfirmed',{attemptedAt:new Date().toISOString()}),manual=await store.createRecord(job(3304),'needs_answer'),unknown=await store.createRecord(job(3305),'failed'),interrupted=await store.createRecord(job(3306),'interrupted');
 const question={key:'evening work',label:'Evening work?',type:'radio',required:true,options:[{label:'Yes',value:'y'},{label:'No',value:'n'}]};
 await store.saveQuestions([{...question,jobId:'3301',blocker:'missing_answer'},{...question,jobId:'3302',blocker:'operational',reason:'Selection timed out'},{key:'manual control',label:'Manual control',jobId:'3304',type:'unsupported',required:true,blocker:'operational'},{key:'years of rust experience',label:'Years of Rust experience',type:'number',required:true,jobId:'3301',blocker:'missing_answer'}]);
 await store.saveAnswers({'years of rust experience':0});
 const runner={getStatus:()=>({state,todayCount:0,currentJob:null,message:'Ready'}),start:async options=>commands.push(['start',options]),retry:async options=>{if(rejectRetry)throw new Error('Synthetic retry unavailable');commands.push(['retry',options]);state='running';},stop:async()=>{state='idle';}};
 const app=await createApp({dataDir:dir,store,runner,port:0});await app.listen();const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:1360,height:960}});page.setDefaultTimeout(5000);
 t.after(async()=>{await browser.close();await app.close();await rm(dir,{recursive:true,force:true});});await page.goto(app.url);await page.waitForFunction(()=>!document.querySelector('#browser-button').disabled);
 return {dir,page,store,commands,records:{missing,operational,uncertain,manual,unknown,interrupted},setState:value=>{state=value;},rejectRetry:value=>{rejectRetry=value;}};
}

test('browser: attention retries selected jobs explicitly, respects dry run, polling and mobile layout',async t=>{
 const {page,store,commands,records,setState,rejectRetry}=await attentionPage(t),list=page.locator('#attention-list'),card=id=>list.locator(`[data-record-id="${id}"]`);
 await page.getByRole('heading',{name:'Needs attention',exact:true}).waitFor();
 assert.equal(await card(records.missing.id).getByRole('button',{name:'Retry application',exact:true}).count(),0);
 assert.equal(await card(records.uncertain.id).getByRole('button',{name:'Retry application',exact:true}).count(),0);assert.equal(await card(records.manual.id).getByRole('button',{name:'Retry application',exact:true}).count(),0);
 assert.match(await card(records.unknown.id).textContent(),/unknown.*retry to inspect/i);
 await page.getByRole('button',{name:'Answers',exact:true}).click();await page.locator('#pending-questions').getByLabel('Answer for Evening work?',{exact:true}).selectOption('No');await page.locator('#pending-questions').getByRole('button',{name:'Save this answer',exact:true}).click();await page.getByText('Answer saved',{exact:true}).waitFor();
 assert.deepEqual(commands,[]);assert.equal((await store.getAnswers())['evening work'],'No');
 await page.locator('#answers-view').getByRole('button',{name:'View applications needing attention',exact:true}).click();
 assert.equal(await card(records.missing.id).getByRole('button',{name:'Retry application',exact:true}).count(),1);assert.match(await card(records.operational.id).textContent(),/check its form again/i);
 await page.getByLabel('Dry run (no submissions)',{exact:true}).check();await card(records.missing.id).getByRole('button',{name:'Retry application',exact:true}).click();assert.deepEqual(commands,[['retry',{recordIds:[records.missing.id],dryRun:true}]]);
 assert.equal(await page.getByRole('button',{name:'Resume ready applications',exact:true}).isDisabled(),true);setState('idle');await page.reload();
 rejectRetry(true);await card(records.unknown.id).getByRole('button',{name:'Retry application',exact:true}).click();await page.getByText('Synthetic retry unavailable',{exact:true}).waitFor();assert.equal(await card(records.unknown.id).getByRole('button',{name:'Retry application',exact:true}).isEnabled(),true);rejectRetry(false);
 await page.getByLabel('Dry run (no submissions)',{exact:true}).check();await page.getByRole('button',{name:'Resume ready applications',exact:true}).click();assert.deepEqual(commands.at(-1),['retry',{recordIds:[records.missing.id,records.interrupted.id],dryRun:true}]);
 setState('idle');await page.reload();await mkdir(resolve('test-artifacts'),{recursive:true});await page.screenshot({path:resolve('test-artifacts/attention-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve('test-artifacts/attention-mobile.png'),fullPage:true});
});

test('browser: attention diagnostics and polling preserve unrelated and retained answer drafts',async t=>{
 const {page,store,records}=await attentionPage(t);await page.getByRole('button',{name:'Answers',exact:true}).click();
 const answer=page.locator('#pending-questions').getByLabel('Answer for Evening work?',{exact:true});await answer.selectOption('No');await page.getByLabel('Question',{exact:true}).fill('Unrelated draft');await page.getByLabel('Answer',{exact:true}).fill('Keep me');
 await store.createRecord({id:'3399',title:'New unrelated failure',company:'Other'},'failed');await waitBootstrap(page);assert.equal(await answer.inputValue(),'No');assert.equal(await page.getByLabel('Answer',{exact:true}).inputValue(),'Keep me');
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.locator('#attention-list').locator(`[data-record-id="${records.unknown.id}"]`).getByRole('button',{name:'View diagnostics',exact:true}).click();await page.getByText('Diagnostic snapshot unavailable.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Answers',exact:true}).click();assert.equal(await answer.inputValue(),'No');assert.equal(await page.getByLabel('Question',{exact:true}).inputValue(),'Unrelated draft');
 await store.saveQuestions((await store.getQuestions()).filter(q=>q.jobId!=='3301'&&q.jobId!=='3302'));await waitBootstrap(page);await page.locator('#retained-question-drafts').getByText('No',{exact:true}).waitFor();assert.equal(await page.getByLabel('Answer',{exact:true}).inputValue(),'Keep me');
});


test('browser: attention shows last update and guarded sanitized diagnostics on desktop and mobile',async t=>{
 const {dir,page,records}=await attentionPage(t),card=page.locator('#attention-list').locator(`[data-record-id="${records.unknown.id}"]`);
 await card.locator('.attention-updated').waitFor();assert.equal(await card.locator('time').getAttribute('datetime'),records.unknown.startedAt);
 await saveFailureSnapshot(dir,records.unknown.id,{code:'validation',phase:'filling',controlCounts:{radio:2},html:'PLANTED SECRET',actions:[{kind:'select',durationMs:7,value:'PLANTED SECRET'}]});
 await card.getByRole('button',{name:'View diagnostics',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.attention-diagnostic:not([hidden])')?.textContent.includes('validation'));
 assert.equal((await card.locator('pre').textContent()).includes('PLANTED SECRET'),false);
 await mkdir(resolve('test-artifacts'),{recursive:true});await page.screenshot({path:resolve('test-artifacts/attention-diagnostics-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve('test-artifacts/attention-diagnostics-mobile.png'),fullPage:true});
});

test('browser: screening explanation shows safe sources and preserves drafts through polling',async t=>{
 const legal={key:'do you currently require sponsorship to work in the us',label:'Do you currently require sponsorship to work in the US?',type:'radio',required:true,options:[{label:'Yes',value:'on'},{label:'No',value:'on'}],jobId:'1001',company:'Example',blocker:'operational',reason:'Selection needs verification'};
 const years={key:'total years of experience',label:'Total years of experience',type:'number',required:true,options:[],jobId:'1001',blocker:'operational',reason:'Number needs verification'};
 const other={key:'why this company',label:'Why this company?',type:'text',required:true,options:[],jobId:'1002',blocker:'operational',reason:'<img src=x onerror="window.injected=true">'};
 const answers={'do you currently require sponsorship to work in the united states':false,'total years of experience':0,'why this company':'Original'};
 const {page,store}=await answerMemoryPage(t,{answers,questions:[legal,years,other]});const starts=[];page.on('request',r=>{if(/\/api\/(?:start|retry)$/.test(new URL(r.url()).pathname))starts.push(r.url());});
 const card=page.locator('.pending-question').filter({has:page.getByRole('heading',{name:legal.label,exact:true})});
 await card.locator('.screening-resolution').waitFor();assert.match(await card.locator('.screening-meaning').textContent(),/now.*future/i);assert.match(await card.locator('.screening-resolution').textContent(),/saved answer.*reviewed meaning/i);
 assert.equal(await card.getByLabel(`Answer for ${legal.label}`,{exact:true}).inputValue(),'No');
 await card.locator('.screening-details summary').focus();await page.keyboard.press('Enter');assert.equal(await card.locator('.screening-details').evaluate(el=>el.open),true);assert.match(await card.locator('.screening-details').textContent(),/do you currently require sponsorship to work in the united states/);
 const yearInput=page.getByLabel(`Answer for ${years.label}`,{exact:true});assert.equal(await yearInput.inputValue(),'0');await yearInput.fill('7');
 const draft=page.getByLabel(`Answer for ${other.label}`,{exact:true});await draft.fill('Retained edit');
 let refreshed=waitBootstrap(page);await store.saveAnswers({...answers,'total years of experience':1});await refreshed;
 await page.getByText('Saved answer: 1. LinkedIn entry still needs a retry.',{exact:true}).waitFor();assert.equal(await yearInput.inputValue(),'7');assert.equal(await draft.inputValue(),'Retained edit');
 refreshed=waitBootstrap(page);await store.saveQuestions([legal,years,{...other,reason:'Changed explanation context'}]);await refreshed;await page.getByText('Changed explanation context',{exact:true}).waitFor({state:'attached'});assert.equal(await draft.inputValue(),'Retained edit');
 const otherCard=page.locator('.pending-question').filter({has:page.getByRole('heading',{name:other.label,exact:true})});await draft.fill('x'.repeat(10001));await otherCard.getByRole('button',{name:'Save this answer',exact:true}).click();await page.getByText('Answer is too long',{exact:true}).waitFor();assert.equal(await draft.inputValue(),'x'.repeat(10001));assert.equal((await store.getAnswers())['why this company'],'Original');
 assert.equal(await page.locator('#pending-questions img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);assert.deepEqual(starts,[]);assert.deepEqual(await store.getHistory(),[]);
 await mkdir(resolve('test-artifacts'),{recursive:true});await page.screenshot({path:resolve('test-artifacts/screening-explanations-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:resolve('test-artifacts/screening-explanations-mobile.png'),fullPage:true});
});
