import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {createStore} from '../src/store.mjs';
import {createApp} from '../src/server.mjs';

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

async function settingsPage(t,profile={},search={}){
  const dir=await mkdtemp(join(tmpdir(),'job-applier-settings-')),store=await createStore(dir);
  await store.saveConfig({profile,search});
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
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent==='Settings saved'&&!document.querySelector('#save-settings').disabled);
  const config=await store.getConfig();
  assert.equal(config.profile.firstName,'Unsaved');
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
