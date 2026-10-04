import {createBrowserSession} from './session.mjs';
import {fillApplicationFields,validationErrors,checkStopped} from './forms.mjs';
import {buildSearchQueries} from '../search-profiles.mjs';

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
  async function jobContent(page,signal){
    const end=Date.now()+action;
    while(true){
      checkStopped(signal);
      const pause=await interruption(page);if(pause)throw new Error(pause);
      const content=await page.evaluate(()=>{
        const visible=element=>element.getClientRects().length>0 && !['hidden','collapse'].includes(getComputedStyle(element).visibility);
        const text=element=>visible(element)?element.innerText.trim():'';
        const narrative=element=>{
          const walk=node=>{
            if(node.nodeType===Node.TEXT_NODE)return node.textContent;
            if(node.nodeType!==Node.ELEMENT_NODE||!visible(node)||node.matches('button,nav,aside,script,style,[role="button"],[role="navigation"],[role="complementary"],[role="status"],[role="progressbar"],[aria-busy="true"]'))return '';
            if(node.tagName==='BR')return '\n';
            const value=Array.from(node.childNodes).map(walk).join('');
            return /^(block|list-item|table-row|flex|grid)$/.test(getComputedStyle(node).display)?`${value}\n`:value;
          };
          return walk(element).split('\n').map(line=>line.replace(/[\t\r ]+/g,' ').trim()).filter(Boolean).join('\n');
        };
        const firstText=selector=>Array.from(document.querySelectorAll(selector)).map(text).find(Boolean)||'';
        let description=firstText('#job-details,.jobs-description-content__text,[data-job-description]');
        if(!description){
          const headingSelector='h1,h2,h3,h4,h5,h6,[role="heading"]';
          const level=heading=>/^H[1-6]$/.test(heading.tagName)?Number(heading.tagName[1]):Number(heading.getAttribute('aria-level'))||2;
          const headings=Array.from(document.querySelectorAll(headingSelector)).filter(heading=>text(heading).replace(/\s+/g,' ').toLowerCase()==='about the job');
          for(const heading of headings){
            let branch=heading,container=heading.parentElement;
            // The current layout wraps its heading beside rich text. Stay inside that
            // section: only the heading wrapper and its parent belong to this fallback.
            for(let depth=0;container && depth<2;depth++){
              if(container.matches('main,body,html,nav,aside,[role="main"],[role="navigation"],[role="complementary"]'))break;
              if(Array.from(container.querySelectorAll(headingSelector)).some(other=>other!==heading && visible(other) && level(other)<=level(heading)))break;
              const parts=Array.from(container.childNodes).filter(node=>node!==branch).map(node=>{
                if(node.nodeType===Node.TEXT_NODE)return node.textContent.trim();
                if(node.nodeType!==Node.ELEMENT_NODE || node.matches('button,nav,aside,script,style,[role="button"],[role="navigation"],[role="complementary"]'))return '';
                return narrative(node);
              }).filter(Boolean);
              if(parts.length){description=parts.join('\n');break;}
              branch=container;container=container.parentElement;
            }
            if(description)break;
          }
        }
        return {description,title:firstText('h1'),company:firstText('a[href*="/company/"]')};
      });
      checkStopped(signal);
      if(content.description)return content;
      if(Date.now()>=end)break;
      await sleep(Math.min(100,end-Date.now()));
    }
    throw new Error('Could not read this job\'s description. LinkedIn\'s job layout may have changed or the description did not load. Open the job in the browser and try again.');
  }
  async function experienceFilterValues(page,levels,signal,{confirm=false}={}){
    const unavailable=()=>new Error(confirm?'LinkedIn did not confirm the selected experience levels. Check its filters, or clear Experience level in Settings before retrying.':'LinkedIn\'s experience-level filter is unavailable or changed. Open LinkedIn to check it, or clear Experience level in Settings before retrying.');
    const normalizePart=label=>label.replace(/[\u2010-\u2015]/g,'-').replace(/\([\d,.\s]+\)\s*$/,'').replace(/\s+/g,' ').trim().toLowerCase();
    const normalize=label=>{
      const parts=label.split(/\s+filter by\s+/i).map(normalizePart);
      return parts.length===2 && parts[0]===parts[1]?parts[0]:normalizePart(label);
    };
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
    const dialogs=dialogFor(page);
    if(!await dialogs.count())return true;
    const close=dialogs.getByRole('button',{name:/^(Dismiss|Close|Done|Cancel)$/i}).last();
    try{
      if(await close.isVisible())await close.click({timeout:cleanup});
      const end=Date.now()+cleanup,retryAt=Date.now()+Math.min(1000,cleanup/2);let retried=false,discarded=false;
      while(Date.now()<end){
        const savePrompt=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Save this application?',exact:true})}).first();
        const saving=await savePrompt.isVisible().catch(()=>false);
        const discard=saving?savePrompt.getByText('Discard',{exact:true}).first():page.getByRole('button',{name:/^Discard$/i}).last();
        if(!discarded&&await discard.isVisible().catch(()=>false)){await discard.click({timeout:Math.max(1,end-Date.now())});discarded=true;}
        if(!await dialogs.count()&&!await savePrompt.isVisible().catch(()=>false))return true;
        if(!saving&&!discarded&&!retried&&Date.now()>=retryAt&&await close.isVisible().catch(()=>false)){
          retried=true;await close.click({timeout:Math.max(1,end-Date.now())});
        }
        await sleep(50);
      }
    }catch{}
    return !await dialogs.count()&&!await page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'Save this application?',exact:true})}).first().isVisible().catch(()=>false);
  }
  async function finish(page,result){
    if(!await closeDraft(page))return {...result,status:'paused',reason:'Could not close the previous application dialog safely. Stop and close it in LinkedIn before starting again.'};
    return result;
  }
  async function applicationReady(page,signal){
    let end=Date.now()+action,continued=false,sawReminder=false,previous='';
    while(Date.now()<end){
      checkStopped(signal);
      const blocked=await interruption(page);if(blocked)return blocked;
      const dialog=dialogFor(page);
      const states=await dialog.evaluateAll(dialogs=>dialogs.map(root=>{
        const visible=element=>element.getClientRects().length>0 && getComputedStyle(element).visibility!=='hidden';
        const headings=Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')).filter(visible).map(element=>element.innerText.trim());
        const controls=Array.from(root.querySelectorAll('input,select,textarea,[role="combobox"],[role="checkbox"],[role="radiogroup"],[role="listbox"],[role="textbox"],[contenteditable="true"]')).filter(element=>visible(element) && !['hidden','submit','button','reset'].includes(element.type)).map(element=>[element.tagName,element.type,element.name,element.getAttribute('aria-label'),element.required]);
        const actions=Array.from(root.querySelectorAll('button,[role="button"]')).filter(visible).map(element=>(element.getAttribute('aria-label')||element.innerText).trim()).filter(label=>/^(?:Next|Review|Continue)(?:\s|$)|^Submit application$/i.test(label));
        const bars=Array.from(root.querySelectorAll('[role="progressbar"]')).filter(visible);
        const progress=bars.map(bar=>{
          // LinkedIn's persistent page indicator is determinate and paired with
          // an adjacent "1/5 pages" counter. Other progress bars remain loaders.
          if(!bar.hasAttribute('aria-valuenow') || bar.getAttribute('aria-valuemin')!=='0' || bar.getAttribute('aria-valuemax')!=='100')return null;
          const now=Number(bar.getAttribute('aria-valuenow'));
          if(!Number.isFinite(now)||now<0||now>100)return null;
          for(let area=bar.parentElement,depth=0;area&&area!==root&&depth<2;area=area.parentElement,depth++){
            if(area.querySelector('input,select,textarea,button,[role="button"],[role="combobox"]') || area.querySelectorAll('[role="progressbar"]').length!==1)break;
            for(const label of area.querySelectorAll('p,span,div')){
              if(label.children.length||!visible(label))continue;
              const match=label.textContent.trim().match(/^(\d+)\s*\/\s*(\d+)\s+pages?$/i);
              if(!match)continue;
              const page=Number(match[1]),total=Number(match[2]);
              if(page>=1&&page<=total&&Math.abs(now-page/total*100)<=1)return [now,page,total];
            }
          }
          return null;
        });
        const busy=root.getAttribute('aria-busy')==='true' || Array.from(root.querySelectorAll('[aria-busy="true"]')).some(visible) || progress.some(value=>value===null);
        return {headings,controls,actions,busy,progress};
      }));
      const state=states[0];
      if(state){
        if(state.headings.includes('Job search safety reminder')){
          sawReminder=true;previous='';
          const proceed=dialog.getByText('Continue applying',{exact:true}).first();
          if(!continued&&await proceed.isVisible().catch(()=>false)){
            checkStopped(signal);await proceed.click();continued=true;end=Date.now()+action;
          }
        }else if(state.headings[0] && !/^apply\b/i.test(state.headings[0]) && /safety|warning|security verification|verify your identity|suspicious|risk warning/i.test(state.headings[0])){
          return 'LinkedIn showed an unfamiliar safety or verification warning. Review it in the browser before continuing.';
        }else if((state.controls.length||state.headings.some(heading=>/^review\b/i.test(heading))) && state.actions.length && !state.busy){
          const current=JSON.stringify(state);
          if(current===previous)return null;
          previous=current;
        }else previous='';
      }else previous='';
      await sleep(100);
    }
    checkStopped(signal);
    return sawReminder&&!continued?'LinkedIn\'s safety reminder did not finish loading. Review it in the browser before continuing.':'LinkedIn\'s application form did not finish loading. Open the job in the browser and try again.';
  }
  async function *fairJobs(page,search,{scanLimit,signal,intelligence}){
    const states=buildSearchQueries(search,intelligence).map(query=>({query,start:0,buffer:[],seen:new Set(),exhausted:false})),seen=new Set();
    let experienceValues=null;
    while(seen.size<scanLimit){
      const active=states.filter(state=>state.buffer.length||!state.exhausted);if(!active.length)return;
      for(let index=0;index<active.length&&seen.size<scanLimit;index++){
        checkStopped(signal);const state=active[index],quota=Math.ceil((scanLimit-seen.size)/(active.length-index));
        // A round fetches at most one page per query. Surplus cards stay buffered.
        if(!state.buffer.length&&!state.exhausted){
          if(state.start>=1000){state.exhausted=true;continue;}
          const url=new URL(`${baseUrl}/jobs/search/`),q=state.query;
          for(const [key,value] of Object.entries({keywords:q.title,location:q.location,f_AL:'true',start:String(state.start)}))url.searchParams.set(key,value);
          const workplace={onsite:'1',remote:'2',hybrid:'3'}[q.workplace];if(workplace)url.searchParams.set('f_WT',workplace);
          if(experienceValues)url.searchParams.set('f_E',experienceValues);
          await page.goto(url.href,{waitUntil:'domcontentloaded'});checkStopped(signal);
          let pause=await interruption(page);if(pause)throw new Error(pause);
          if(search.experienceLevels?.length&&!experienceValues){
            experienceValues=await experienceFilterValues(page,search.experienceLevels,signal);checkStopped(signal);url.searchParams.set('f_E',experienceValues);
            await page.goto(url.href,{waitUntil:'domcontentloaded'});checkStopped(signal);pause=await interruption(page);if(pause)throw new Error(pause);
          }
          if(search.experienceLevels?.length)await experienceFilterValues(page,search.experienceLevels,signal,{confirm:true});
          await page.locator('a[href*="/jobs/view/"]').first().waitFor({state:'attached',timeout:action}).catch(()=>{});checkStopped(signal);
          let fresh=0;
          for(let scroll=0;scroll<4;scroll++){
            const cards=await page.locator('a[href*="/jobs/view/"]').evaluateAll(links=>links.map(link=>({href:link.href,title:(link.getAttribute('aria-label')||link.textContent||'').trim(),company:link.closest('li')?.querySelector('.artdeco-entity-lockup__subtitle,.job-card-container__primary-description')?.textContent.trim()||''})));
            for(const card of cards){
              const id=card.href.match(/\/jobs\/view\/(?:[^/?]*-)?(\d+)(?:\/|\?|$)/)?.[1];if(!id||state.seen.has(id))continue;
              state.seen.add(id);fresh++;state.buffer.push({id,url:`https://www.linkedin.com/jobs/view/${id}/`,title:card.title||'LinkedIn job',company:card.company||'Company on LinkedIn'});
            }
            checkStopped(signal);const list=page.locator('.jobs-search-results-list,.scaffold-layout__list').first();if(!await list.count())break;
            await list.evaluate(el=>el.scrollBy(0,600));await sleep(200);checkStopped(signal);
          }
          state.start+=25;if(!fresh)state.exhausted=true;
        }
        let used=0;
        while(state.buffer.length&&used<quota&&seen.size<scanLimit){
          checkStopped(signal);const job=state.buffer.shift();if(seen.has(job.id))continue;seen.add(job.id);used++;yield job;
        }
      }
    }
  }
  async function postingMetadata(page){
    return page.evaluate(()=>{
      const visible=element=>element.getClientRects().length>0&&!['hidden','collapse'].includes(getComputedStyle(element).visibility)&&!element.closest('aside,nav,[aria-hidden="true"],[hidden]');
      const header=Array.from(document.querySelectorAll('[data-job-header],.job-details-jobs-unified-top-card__container,.jobs-unified-top-card')).find(visible);
      const empty={location:null,workplace:null,postedAt:null,postedAge:null,evidence:[]};if(!header)return empty;
      const first=selector=>Array.from(header.querySelectorAll(selector)).filter(visible).find(element=>element.textContent.trim());
      const location=first('[data-job-location],.job-details-jobs-unified-top-card__primary-description-container .tvm__text,.jobs-unified-top-card__bullet'),workplace=first('[data-job-workplace],.job-details-jobs-unified-top-card__job-insight'),time=first('time[datetime]'),age=first('[data-job-posted-age],.job-details-jobs-unified-top-card__tertiary-description-container');
      const mode=workplace?.textContent.trim().match(/\b(remote|hybrid|on-site|onsite)\b/i)?.[1]?.toLowerCase().replace('on-site','onsite')||null;
      return {location:location?.textContent.trim()||null,workplace:mode,postedAt:time?.getAttribute('datetime')||null,postedAge:age?.textContent.trim()||time?.textContent.trim()||null,evidence:[location,workplace,time,age].filter(Boolean).map(element=>({kind:'posting_header',text:element.textContent.trim()}))};
    });
  }
  const adapter={
    async openBrowser(){const page=await session.open();if(!headless)await page.bringToFront();return page;},
    async isSignedIn(){return signedIn(await session.open());},
    async *findJobs(search,{scanLimit=100,signal,intelligence}={}){
      if(intelligence?.enabled){checkStopped(signal);yield* fairJobs(await session.open(),search,{scanLimit,signal,intelligence});return;}
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
    async inspect(job,{signal}={}){
      checkStopped(signal);
      const page=await navigateJob(job);
      const {description,title,company}=await jobContent(page,signal);
      job.title=title||job.title;job.company=company||job.company;
      return {description,...await postingMetadata(page),alreadyApplied:await page.getByText(/^(Application submitted|Applied)$/i).first().isVisible().catch(()=>false),easyApply:await page.getByRole('button',{name:/Easy Apply/i}).first().isVisible().catch(()=>false)};
    },
    async apply(job,{profile,answers,resumePath,dryRun=false,signal,beforeSubmit}){
      let page,submitted=false;
      const applicationState={};
      const withMatches=result=>({...result,...(applicationState.answerMatches?.length?{answerMatches:applicationState.answerMatches}: {})});
      const complete=result=>finish(page,withMatches(result));
      try{
        checkStopped(signal);
        page=await navigateJob(job);
        const pause=await interruption(page);if(pause)return {status:'paused',reason:pause};
        if(await page.getByText(/^(Application submitted|Applied)$/i).first().isVisible().catch(()=>false))return {status:'skipped',reason:'LinkedIn shows this job as already applied'};
        const easy=page.getByRole('button',{name:/Easy Apply/i}).first();
        if(!await easy.isVisible())return {status:'skipped',reason:'This job does not offer LinkedIn Easy Apply'};
        await easy.click();
        const openingEnd=Date.now()+action,retryAt=Date.now()+Math.min(1000,action/2);let retried=false;
        while(!await dialogFor(page).isVisible().catch(()=>false)){
          checkStopped(signal);
          const blocked=await interruption(page);if(blocked)return {status:'paused',reason:blocked};
          if(Date.now()>=openingEnd)throw new Error('LinkedIn did not open its application form. Open the job in the browser and try again.');
          // Opening a form is safe to retry once when its first click preceded hydration.
          if(!retried&&Date.now()>=retryAt&&await easy.isVisible().catch(()=>false)){
            checkStopped(signal);retried=true;await easy.click();
          }
          await sleep(100);
        }
        const notReady=await applicationReady(page,signal);
        if(notReady)return {status:'paused',reason:notReady};
        for(let step=0;step<15;step++){
          checkStopped(signal);
          const blocked=await interruption(page);if(blocked)return complete({status:'paused',reason:blocked});
          const dialog=dialogFor(page);
          if(!await dialog.count())return complete({status:'failed',reason:'Unsupported application dialog layout'});
          const filled=await fillApplicationFields(dialog,{profile,answers,resumePath,signal,company:job.company,applicationState,uploadTimeout:action});
          if(filled.errors.length)return complete({status:'failed',reason:filled.errors.join('; ')});
          if(filled.questions.length)return complete({status:'needs_answer',reason:'Required or prefilled questions need explicit answers',pendingQuestions:filled.questions.map(question=>({...question,jobId:job.id}))});
          const errors=await validationErrors(dialog,applicationState);
          if(errors.length)return complete({status:'failed',reason:`Form validation: ${errors.join('; ')}`});
          const submit=dialog.getByRole('button',{name:/^Submit application$/i}).first();
          if(await submit.isVisible().catch(()=>false)){
            if(dryRun)return complete({status:'ready',reason:'Review reached. Dry run did not submit.'});
            checkStopped(signal);
            if(typeof beforeSubmit!=='function')throw new Error('Submission guard is missing');
            await beforeSubmit();checkStopped(signal);
            submitted=true;await submit.click();
            const end=Date.now()+confirmation;
            while(Date.now()<end){
              const success=page.getByText(/^(Application sent|Application submitted|Your application (?:was|has been) sent(?: to .*)?\.?|Your application has been submitted\.?)$/i).first();
              if(await success.isVisible().catch(()=>false))return complete({status:'submitted',reason:'LinkedIn confirmed the application',evidence:await success.innerText()});
              const interruptionReason=await interruption(page);
              if(interruptionReason)return complete({status:'unconfirmed',reason:`Submit was clicked, but confirmation was interrupted: ${interruptionReason}`});
              await sleep(100);
            }
            return complete({status:'unconfirmed',reason:'Submit was clicked, but no explicit confirmation was observed. Check LinkedIn before applying again.'});
          }
          const next=dialog.getByRole('button',{name:/^(Next|Review|Continue)(?:\s|$)/i}).first();
          if(!await next.isVisible().catch(()=>false))return complete({status:'failed',reason:'Unsupported application step: no Next, Review, or Submit action'});
          const previous=await dialog.innerText();
          await next.click();
          await dialog.waitFor({state:'visible',timeout:action});
          const end=Date.now()+action;
          while(Date.now()<end && await dialog.innerText()===previous)await sleep(100);
          if(await dialog.innerText()===previous)return complete({status:'failed',reason:'The application did not advance. Check its validation messages in LinkedIn.'});
          const notReady=await applicationReady(page,signal);if(notReady)return withMatches({status:'paused',reason:notReady});
        }
        return complete({status:'failed',reason:'Application exceeded the supported 15-step limit'});
      }catch(error){
        const result={status:submitted?'unconfirmed':'failed',reason:error.message.split('\n')[0]};
        return page&&!page.isClosed()?complete(result):withMatches(result);
      }
    },
    close:()=>session.close()
  };
  return adapter;
}
