import {mkdir,lstat,open,rename,unlink,readdir,rmdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {makeBlocker,workPhases} from './application-lifecycle.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);
const types=new Set(['text','email','tel','url','number','date','month','select','textarea','radio','checkbox','file','unsupported']);
const validity=new Set(['valueMissing','typeMismatch','patternMismatch','tooLong','tooShort','rangeUnderflow','rangeOverflow','stepMismatch','badInput','customError','employer_feedback']);
const integer=(value,max)=>Number.isInteger(value)&&value>=0&&value<=max;
const enumValue=(value,values,fallback)=>values.includes(value)?value:fallback;
export function buildDiagnostic(input={}){
 const timestamp=typeof input.timestamp==='string'&&Number.isFinite(Date.parse(input.timestamp))?new Date(input.timestamp).toISOString():null;
 const controlCounts={};for(const [type,count] of Object.entries(input.controlCounts||{}))if(types.has(type)&&integer(count,1000))controlCounts[type]=count;
 const fingerprints=[...new Set((Array.isArray(input.fingerprints)?input.fingerprints:[]).filter(v=>typeof v==='string'&&/^[a-f\d]{64}$/.test(v)))].slice(0,256);
 const validationCategories=[...new Set((Array.isArray(input.validationCategories)?input.validationCategories:[]).filter(v=>validity.has(v)))];
 const actions=(Array.isArray(input.actions)?input.actions:[]).slice(0,100).map(action=>({kind:enumValue(action?.kind,['fill','check','select','upload','next','review','navigation'],'unknown'),durationMs:integer(action?.durationMs,60000)?action.durationMs:0,retries:integer(action?.retries,8)?action.retries:0}));
 return {version:1,recordId:uuid(input.recordId)?input.recordId:null,phase:workPhases.has(input.phase)?input.phase:'unknown',pageIndex:integer(input.pageIndex,15)?input.pageIndex:null,timestamp,code:makeBlocker(input.code).code,controlCounts,fingerprints,validationCategories,busy:input.busy===true,transition:enumValue(input.transition,['unchanged','advanced','busy','timeout'],'unknown'),actions,cleanup:enumValue(input.cleanup,['closed','failed','not_needed'],'unknown')};
}
const MAX_BYTES=65536,queues=new Map();
async function directory(path,create=false){
 if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe snapshot directory');
 const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{if(create)await handle.chmod(0o700);}finally{await handle.close();}
}
async function ordinaryFile(path,missing=false){try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsafe snapshot file');return info;}catch(error){if(missing&&error.code==='ENOENT')return null;throw error;}}
async function prune(root){
 const owned=[];
 for(const name of await readdir(root)){
  if(!uuid(name))continue;const path=join(root,name);
  try{await directory(path);const names=await readdir(path);if(names.length!==1||names[0]!=='snapshot.json')continue;const info=await ordinaryFile(join(path,'snapshot.json'));owned.push({path,time:info.mtimeMs});}catch{}
 }
 owned.sort((a,b)=>b.time-a.time);
 for(const item of owned.slice(100)){try{await directory(item.path);if((await readdir(item.path)).length!==1)continue;await ordinaryFile(join(item.path,'snapshot.json'));await unlink(join(item.path,'snapshot.json'));await rmdir(item.path);}catch{}}
}
export async function saveFailureSnapshot(dataDir,recordId,diagnostic){
 if(!uuid(recordId))return {available:false};const root=join(resolve(dataDir),'failures');
 const action=(queues.get(root)||Promise.resolve()).then(async()=>{
  let temp;
  try{
   if(Buffer.byteLength(JSON.stringify(diagnostic),'utf8')>MAX_BYTES)return {available:false};
   const safe=buildDiagnostic({...diagnostic,recordId}),body=JSON.stringify(safe,null,2)+'\n';if(Buffer.byteLength(body)>MAX_BYTES)return {available:false};
   await directory(root,true);const path=join(root,recordId);await directory(path,true);const destination=join(path,'snapshot.json');await ordinaryFile(destination,true);
   temp=join(path,`.${randomUUID()}.tmp`);const file=await open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
   try{await file.writeFile(body);await file.sync();}finally{await file.close();}
   await ordinaryFile(destination,true);await rename(temp,destination);temp=null;
   const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await handle.sync();}finally{await handle.close();}
   await prune(root);return {available:true,reference:{recordId}};
  }catch{return {available:false};}finally{if(temp)await unlink(temp).catch(()=>{});}
 });const queued=action.catch(()=>{});queues.set(root,queued);try{return await action;}finally{if(queues.get(root)===queued)queues.delete(root);}
}
export async function readFailureSnapshot(dataDir,recordId){
 if(!uuid(recordId))return null;
 try{
  const root=join(resolve(dataDir),'failures'),path=join(root,recordId);await directory(root);await directory(path);const file=join(path,'snapshot.json'),info=await ordinaryFile(file);if(info.size>MAX_BYTES)return null;
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let text;try{const current=await handle.stat();if(current.size>MAX_BYTES)return null;const buffer=Buffer.alloc(MAX_BYTES+1),{bytesRead}=await handle.read(buffer,0,buffer.length,0);if(bytesRead>MAX_BYTES)return null;text=buffer.subarray(0,bytesRead).toString('utf8');}finally{await handle.close();}
  const parsed=JSON.parse(text);if(parsed.recordId!==recordId)return null;return buildDiagnostic(parsed);
 }catch{return null;}
}
