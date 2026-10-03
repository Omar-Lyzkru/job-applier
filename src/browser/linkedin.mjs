import {createBrowserSession} from './session.mjs';
import {fillApplicationFields,validationErrors,checkStopped} from './forms.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const experienceLabels={INTERNSHIP:'Internship',ENTRY_LEVEL:'Entry level',ASSOCIATE:'Associate',MID_SENIOR_LEVEL:'Mid-Senior level',DIRECTOR:'Director',EXECUTIVE:'Executive'};
export function createLinkedInAdapter({dataDir,headless=false,fixtureBaseUrl=null,timeouts={}}) {
  const baseUrl=fixtureBaseUrl||'https://www.linkedin.com';
  const action=timeouts.action||10000,confirmation=timeouts.confirmation||15000,cleanup=timeouts.cleanup||4000;
  const session=createBrowserSession({dataDir,headless,baseUrl,actionTimeout:action});
  const dialogFor=page=>page.getByRole('dialog').filter({has:page.getByRole('button',{name:/^(Dismiss|Close|Done|Cancel)$/i})}).first();
  async function signedIn(page){
    if(/\/(login|checkpoint|authwall|challenge)(\/|\?|$)/.test(new URL(page.url()).pathname))return false;
    return !(await page.locator('input#username,input[name="session_key"]').first().isVisible().catch(()=>false)) && !(await page.getByRole('button',{name:/^Sign in$/i}).first().isVisible().catch(()=>false));
  }
  async function interruption(page){
    if(!await signedIn(page))return 'Sign in or complete LinkedIn verification in the browser, then start again.';
    const body=await page.locator('body').innerText();
    if(/(?:you have reached|you['’]ve reached|reached your|daily).*application limit|applying too quickly|too many applications|try again tomorrow/i.test(body))return 'LinkedIn reported an application or speed limit. Try again later.';
    if(/security verification|verify your identity|complete this security check/i.test(body))return 'Complete LinkedIn verification in the browser, then start again.';
    return null;
  }
  async function navigateJob(job){
    if(!/^\d+$/.test(String(job.id)))throw new Error('Invalid LinkedIn job ID');
    const page=await session.open();
    await page.goto(`${baseUrl}/jobs/view/${job.id}/`,{waitUntil:'domcontentloaded'});
    return page;
  }
  async function experienceFilterValues(page,levels,signal,{confirm=false}={}){
    const unavailable=()=>new Error(confirm?'LinkedIn did not confirm the selected experience levels. Check its filters, or clear Experience level in Settings before retrying.':'LinkedIn\'s experience-level filter is unavailable or changed. Open LinkedIn to check it, or clear Experience level in Settings before retrying.');
    const normalize=label=>label.replace(/[\u2010-\u2015]/g,'-').replace(/\([\d,.\s]+\)\s*$/,'').replace(/\s+/g,' ').trim().toLowerCase();
    const read=async()=>{
      const controls=await page.locator('input[type="checkbox"]').evaluateAll(inputs=>inputs.map(input=>({
        value:input.value,checked:input.checked,
        label:Array.from(input.labels||[]).map(label=>label.textContent).join(' ') || input.getAttribute('aria-label') || (input.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ')
      })));
      const values=[];
      for(const level of levels){
        if(!experienceLabels[level])throw unavailable();
        const matches=new Set(controls.filter(control=>normalize(control.label)===normalize(experienceLabels[level]) && /^\d+$/.test(control.value)).map(control=>control.value));
        if(matches.size!==1)return null;
        values.push([...matches][0]);
      }
      if(confirm){
        const checked=new Set(Object.entries(experienceLabels).filter(([,label])=>controls.some(control=>control.checked && normalize(control.label)===normalize(label))).map(([level])=>level));
        if(checked.size!==levels.length || levels.some(level=>!checked.has(level)))return null;
      }
      return values.join(',');
    };
    const end=Date.now()+action;let opened=false;
    while(Date.now()<end){
      checkStopped(signal);
      const values=await read();
      if(values)return values;
      if(!opened){
        const button=page.getByRole('button',{name:/Experience level/i}).first();
        if(await button.isVisible().catch(()=>false)){await button.click();opened=true;}
      }
      await sleep(100);
    }
    throw unavailable();
  }
  async function closeDraft(page){
    const dialogs=page.locator('[role="dialog"]');
    if(!await dialogs.count())return true;
    const close=page.getByRole('button',{name:/^(Dismiss|Close|Done|Cancel)$/i}).last();
    try{
      if(await close.isVisible())await close.click({timeout:cleanup});
      const end=Date.now()+cleanup;
      while(Date.now()<end){
        const discard=page.getByRole('button',{name:/^Discard$/i}).last();
        if(await discard.isVisible().catch(()=>false))await discard.click({timeout:cleanup});
        if(!await dialogs.count())return true;
        await sleep(50);
      }
    }catch{}
    return !await dialogs.count();
  }
  async function finish(page,result){
    if(!await closeDraft(page))return {...result,status:'paused',reason:'Could not close the previous application dialog safely. Stop and close it in LinkedIn before starting again.'};
    return result;
  }
  const adapter={
    async openBrowser(){const page=await session.open();if(!headless)await page.bringToFront();return page;},
    async isSignedIn(){return signedIn(await session.open());},
    async *findJobs(search,{scanLimit=100,signal}={}){
      const page=await session.open(),seen=new Set();
      let experienceValues=null;
      for(const title of search.titles){
        for(let start=0;start<1000 && seen.size<scanLimit;start+=25){
          checkStopped(signal);
          const url=new URL(`${baseUrl}/jobs/search/`);
          url.searchParams.set('keywords',title);url.searchParams.set('location',search.location);url.searchParams.set('f_AL','true');url.searchParams.set('start',String(start));
          const workplaces={onsite:'1',remote:'2',hybrid:'3'};
          if(workplaces[search.workplace])url.searchParams.set('f_WT',workplaces[search.workplace]);
          if(experienceValues)url.searchParams.set('f_E',experienceValues);
          await page.goto(url.href,{waitUntil:'domcontentloaded'});
          const pause=await interruption(page);if(pause)throw new Error(pause);
          if(search.experienceLevels?.length && !experienceValues){
            experienceValues=await experienceFilterValues(page,search.experienceLevels,signal);
            checkStopped(signal);
            url.searchParams.set('f_E',experienceValues);
            await page.goto(url.href,{waitUntil:'domcontentloaded'});
            const interrupted=await interruption(page);if(interrupted)throw new Error(interrupted);
          }
          if(search.experienceLevels?.length)await experienceFilterValues(page,search.experienceLevels,signal,{confirm:true});
          await page.locator('a[href*="/jobs/view/"]').first().waitFor({state:'attached',timeout:action}).catch(()=>{});
          let found=[];
          for(let scroll=0;scroll<4;scroll++){
            const cards=await page.locator('a[href*="/jobs/view/"]').evaluateAll(links=>links.map(link=>({href:link.href,title:(link.getAttribute('aria-label')||link.textContent||'').trim(),company:link.closest('li')?.querySelector('.artdeco-entity-lockup__subtitle,.job-card-container__primary-description')?.textContent.trim()||''})));
            found.push(...cards);
            const list=page.locator('.jobs-search-results-list,.scaffold-layout__list').first();
            if(!await list.count())break;
            await list.evaluate(el=>el.scrollBy(0,600));await sleep(200);
          }
          let fresh=0;
          for(const card of found){
            const match=card.href.match(/\/jobs\/view\/(?:[^/?]*-)?(\d+)(?:\/|\?|$)/);
            if(!match||seen.has(match[1]))continue;
            seen.add(match[1]);fresh++;
            yield {id:match[1],url:`https://www.linkedin.com/jobs/view/${match[1]}/`,title:card.title||'LinkedIn job',company:card.company||'Company on LinkedIn'};
            if(seen.size>=scanLimit)return;
          }
          if(!fresh)break;
        }
      }
    },
    async inspect(job){
      const page=await navigateJob(job);
      const pause=await interruption(page);if(pause)throw new Error(pause);
      const details=page.locator('#job-details,.jobs-description-content__text,[data-job-description]').first();
      const description=await details.innerText({timeout:action}).catch(()=> '');
      const title=await page.locator('h1').first().innerText().catch(()=>job.title);
      const company=await page.locator('a[href*="/company/"]').first().innerText().catch(()=>job.company);
      job.title=title||job.title;job.company=company||job.company;
      return {description,alreadyApplied:await page.getByText(/^(Application submitted|Applied)$/i).first().isVisible().catch(()=>false),easyApply:await page.getByRole('button',{name:/Easy Apply/i}).first().isVisible().catch(()=>false)};
    },
    async apply(job,{profile,answers,resumePath,dryRun=false,signal,beforeSubmit}){
      let page,submitted=false;
      const applicationState={};
      try{
        checkStopped(signal);
        page=await navigateJob(job);
        const pause=await interruption(page);if(pause)return {status:'paused',reason:pause};
        if(await page.getByText(/^(Application submitted|Applied)$/i).first().isVisible().catch(()=>false))return {status:'skipped',reason:'LinkedIn shows this job as already applied'};
        const easy=page.getByRole('button',{name:/Easy Apply/i}).first();
        if(!await easy.isVisible())return {status:'skipped',reason:'This job does not offer LinkedIn Easy Apply'};
        await easy.click();
        await page.getByRole('dialog').first().waitFor({state:'visible',timeout:action});
        for(let step=0;step<15;step++){
          checkStopped(signal);
          const blocked=await interruption(page);if(blocked)return finish(page,{status:'paused',reason:blocked});
          const dialog=dialogFor(page);
          if(!await dialog.count())return finish(page,{status:'failed',reason:'Unsupported application dialog layout'});
          const filled=await fillApplicationFields(dialog,{profile,answers,resumePath,signal,applicationState,uploadTimeout:action});
          if(filled.questions.length)return finish(page,{status:'needs_answer',reason:'Required or prefilled questions need explicit answers',pendingQuestions:filled.questions.map(question=>({...question,jobId:job.id}))});
          if(filled.errors.length)return finish(page,{status:'failed',reason:filled.errors.join('; ')});
          const errors=await validationErrors(dialog);
          if(errors.length)return finish(page,{status:'failed',reason:`Form validation: ${errors.join('; ')}`});
          const submit=dialog.getByRole('button',{name:/^Submit application$/i}).first();
          if(await submit.isVisible().catch(()=>false)){
            if(dryRun)return finish(page,{status:'ready',reason:'Review reached. Dry run did not submit.'});
            checkStopped(signal);
            if(typeof beforeSubmit!=='function')throw new Error('Submission guard is missing');
            await beforeSubmit();checkStopped(signal);
            submitted=true;await submit.click();
            const end=Date.now()+confirmation;
            while(Date.now()<end){
              const success=page.getByText(/^(Application sent|Application submitted|Your application (?:was|has been) sent(?: to .*)?\.?|Your application has been submitted\.?)$/i).first();
              if(await success.isVisible().catch(()=>false))return finish(page,{status:'submitted',reason:'LinkedIn confirmed the application',evidence:await success.innerText()});
              const interruptionReason=await interruption(page);
              if(interruptionReason)return finish(page,{status:'unconfirmed',reason:`Submit was clicked, but confirmation was interrupted: ${interruptionReason}`});
              await sleep(100);
            }
            return finish(page,{status:'unconfirmed',reason:'Submit was clicked, but no explicit confirmation was observed. Check LinkedIn before applying again.'});
          }
          const next=dialog.getByRole('button',{name:/^(Next|Review|Continue)(?:\s|$)/i}).first();
          if(!await next.isVisible().catch(()=>false))return finish(page,{status:'failed',reason:'Unsupported application step: no Next, Review, or Submit action'});
          const previous=await dialog.innerText();
          await next.click();
          await dialog.waitFor({state:'visible',timeout:action});
          const end=Date.now()+action;
          while(Date.now()<end && await dialog.innerText()===previous)await sleep(100);
          if(await dialog.innerText()===previous)return finish(page,{status:'failed',reason:'The application did not advance. Check its validation messages in LinkedIn.'});
        }
        return finish(page,{status:'failed',reason:'Application exceeded the supported 15-step limit'});
      }catch(error){
        const result={status:submitted?'unconfirmed':'failed',reason:error.message.split('\n')[0]};
        return page&&!page.isClosed()?finish(page,result):result;
      }
    },
    close:()=>session.close()
  };
  return adapter;
}
