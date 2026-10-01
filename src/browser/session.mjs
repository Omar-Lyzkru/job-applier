import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

export function createBrowserSession({dataDir,headless=false,baseUrl='https://www.linkedin.com',actionTimeout=10000}) {
  let context=null, opening=null, page=null;
  async function open() {
    if (context && page && !page.isClosed()) return page;
    if (opening) return opening;
    opening=(async()=>{
      process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve(dataDir,'browsers');
      const {chromium}=await import('playwright');
      await mkdir(resolve(dataDir,'browser-profile'),{recursive:true,mode:0o700});
      try {
        context=await chromium.launchPersistentContext(resolve(dataDir,'browser-profile'),{
          headless,viewport:{width:1280,height:900},locale:'en-US',args:['--disable-dev-shm-usage']
        });
      } catch(error) {
        if (/Executable doesn't exist/.test(error.message)) throw new Error('Chromium is not installed. Run ./setup.sh or npm run browser:install.');
        throw new Error(`Could not open Chromium: ${error.message.split('\n').slice(0,3).join(' ')}`);
      }
      context.setDefaultTimeout(actionTimeout);
      context.setDefaultNavigationTimeout(30000);
      context.on('close',()=>{context=null;page=null;});
      page=context.pages()[0]||await context.newPage();
      await page.goto(`${baseUrl}/feed/`,{waitUntil:'domcontentloaded'});
      return page;
    })();
    try { return await opening; } finally { opening=null; }
  }
  return {
    open,
    async close() {
      if (opening) await opening.catch(()=>{});
      const active=context;context=null;page=null;
      if (active) await active.close();
    }
  };
}
