import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const child=spawn(process.execPath,[resolve(root,'node_modules/playwright/cli.js'),'install','chromium'],{
  cwd:root,stdio:'inherit',env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:resolve(root,'data/browsers')}
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
