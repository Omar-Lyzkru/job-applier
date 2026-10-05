import {ApplicationFailure} from '../application-lifecycle.mjs';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

export function browserLaunchError(error) {
  const message=String(error?.message||error).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'');
  if(/Opening in existing browser session|user data directory is already in use|SingletonLock.*(?:File exists|already exists)/i.test(message)){
    return new ApplicationFailure('browser_unavailable','The Job Applier browser profile is already open in another Chromium window. Close that app browser, then choose Open LinkedIn again.');
  }
  if(/Executable doesn't exist/i.test(message))return new ApplicationFailure('browser_unavailable','Chromium is not installed. Run ./setup.sh or npm run browser:install.');
  const reason=message.split(/\r?\n/).find(line=>line.trim())?.trim().replace(/^browserType\.launchPersistentContext:\s*/,'')||'Browser launch failed';
  return new ApplicationFailure('browser_unavailable',`Could not open Chromium: ${reason}`);
}

export function createBrowserSession({dataDir,headless=false,baseUrl='https://www.linkedin.com',actionTimeout=10000}) {
  let context=null, opening=null, closing=null, page=null;
  async function open() {
    if (closing) await closing;
    if (opening) return opening;
    if (context && page && !page.isClosed()) return page;
    const pending=(async()=>{
      let active=context,target;
      if (!active) {
        process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve(dataDir,'browsers');
        const {chromium}=await import('playwright');
        await mkdir(resolve(dataDir,'browser-profile'),{recursive:true,mode:0o700});
        try {
          active=await chromium.launchPersistentContext(resolve(dataDir,'browser-profile'),{
            headless,viewport:{width:1280,height:900},locale:'en-US',args:['--disable-dev-shm-usage']
          });
        } catch(error) {
          throw browserLaunchError(error);
        }
        context=active;
        active.setDefaultTimeout(actionTimeout);
        active.setDefaultNavigationTimeout(30000);
        active.on('close',()=>{
          if(context===active){context=null;page=null;}
        });
        target=active.pages()[0];
      }
      target ||= await active.newPage();
      try {
        await target.goto(`${baseUrl}/feed/`,{waitUntil:'domcontentloaded'});
      } catch(error) {
        await target.close().catch(()=>{});
        throw error;
      }
      page=target;
      return page;
    })();
    opening=pending;
    try { return await pending; } finally { if(opening===pending)opening=null; }
  }
  return {
    open,
    async close() {
      if(closing)return closing;
      const pending=(async()=>{
        if(opening)await opening.catch(()=>{});
        const active=context;
        try {
          if(active)await active.close();
        } finally {
          if(context===active){context=null;page=null;}
        }
      })();
      closing=pending;
      try { await pending; } finally { if(closing===pending)closing=null; }
    }
  };
}
