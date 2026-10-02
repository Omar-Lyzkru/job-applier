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

async function settingsPage(t,profile={}){
  const dir=await mkdtemp(join(tmpdir(),'job-applier-settings-')),store=await createStore(dir);
  await store.saveConfig({profile});
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
  assert.equal(await country.locator('option:checked').textContent(),'United States');
  assert.equal(await region.inputValue(),'Texas');
  assert.ok(await country.locator('option').count()>200);
  await region.selectOption({label:'California'});
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved',{exact:true}).waitFor();
  assert.equal((await store.getConfig()).profile.country,'United States');
  assert.equal((await store.getConfig()).profile.state,'California');
  await country.selectOption({label:'Canada'});
  assert.equal(await region.inputValue(),'');
  assert.equal(await region.locator('option').filter({hasText:'Texas'}).count(),0);
  await region.selectOption({label:'Ontario'});
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
  await country.selectOption({label:'United States'});
  assert.equal(await region.inputValue(),'');
  await region.selectOption({label:'Texas'});
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
