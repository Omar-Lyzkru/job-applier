import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=['test/adapter.test.mjs','test/forms.test.mjs','test/dashboard.test.mjs'].filter(file=>existsSync(resolve(root,file)));
const child=spawn(process.execPath,['--test','--test-isolation=none',...files],{
  cwd:root,stdio:'inherit',env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:resolve(root,'data/browsers')}
});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
