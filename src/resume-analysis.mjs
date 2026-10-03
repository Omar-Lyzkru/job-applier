import {open} from 'node:fs/promises';
import {extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {MAX_RESUME_BYTES} from './domain.mjs';

const worker=fileURLToPath(new URL('./resume-reader.mjs',import.meta.url));

export async function analyzeResume(resume){
  if(!resume)throw new Error('Upload a résumé first to get recommended keywords.');
  const extension=extname(resume.filename).toLowerCase();
  if(!['.pdf','.doc','.docx'].includes(extension))throw new Error('Use a PDF, DOC, or DOCX résumé.');
  let bytes;
  try{
    const file=await open(resume.path,'r');
    try{
      const info=await file.stat();
      if(!info.isFile()||!info.size||info.size>MAX_RESUME_BYTES)throw new Error('Invalid file size');
      bytes=await file.readFile();
      if(bytes.length>MAX_RESUME_BYTES)throw new Error('Invalid file size');
    }finally{await file.close();}
  }catch{throw new Error('Could not read the saved résumé. Upload it again (up to 2 MB).');}
  // Isolate document parsing so malformed files cannot stall the dashboard.
  const result=await new Promise((resolve,reject)=>{
    const child=execFile(process.execPath,['--max-old-space-size=128',worker,extension],{
      timeout:12_000,maxBuffer:32_000,windowsHide:true
    },(error,stdout)=>{
      if(error){reject(new Error(error.killed?'Reading this résumé took too long. Try exporting a simpler PDF or DOCX.':'Could not read this résumé. Try exporting it as a new PDF or DOCX.'));return;}
      try{resolve(JSON.parse(stdout));}catch{reject(new Error('Could not read this résumé. Try exporting it as a new PDF or DOCX.'));}
    });
    child.stdin.on('error',()=>{});child.stdin.end(bytes);
  });
  if(result.error)throw new Error(result.error);
  if(!Array.isArray(result.keywords)||result.keywords.length>200||result.keywords.some(word=>typeof word!=='string'||word.length>100))throw new Error('Could not get keywords from this résumé.');
  return result.keywords;
}
