import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';

// Linux abstract sockets provide exclusive ownership and are released by the
// kernel on process death. There is no stale lock file to guess about or delete.
export async function acquireDataOwnership(dataDir) {
  if(process.platform!=='linux')throw new Error('This Job Applier build requires Linux for exclusive local data ownership');
  const canonical=await realpath(dataDir);
  const path='\0job-applier-'+createHash('sha256').update(canonical).digest('hex');
  const server=createServer(connection=>connection.destroy());
  await new Promise((resolve,reject)=>{
    server.once('error',error=>reject(error.code==='EADDRINUSE'
      ?new Error('This Job Applier data folder is already in use. Close its other app process first.')
      :error));
    server.listen({path,exclusive:true},resolve);
  });
  server.unref();
  return {close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
