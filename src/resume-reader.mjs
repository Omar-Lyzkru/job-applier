import {MAX_RESUME_BYTES} from './domain.mjs';
import {recommendKeywords} from './resume-keywords.mjs';

// Parser diagnostics can contain document contents; the only output is our JSON.
console.log=console.warn=console.error=()=>{};
const MAX_TEXT=100_000,MAX_EXPANDED=8_000_000;
function bounded(text){
  if(text.length>MAX_TEXT)throw new Error('This résumé has too much text. Use a shorter résumé to get keyword suggestions.');
  return text;
}
async function checkDocx(bytes){
  const {fromBufferPromise}=await import('yauzl');
  const zip=await fromBufferPromise(bytes,{lazyEntries:true,validateEntrySizes:true});
  try{
    if(zip.entryCount>1000)throw new Error('This Word document is too complex. Export a simpler PDF or DOCX.');
    let declared=0,expanded=0;
    for await(const entry of zip.eachEntry()){
      declared+=entry.uncompressedSize;
      if(declared>MAX_EXPANDED)throw new Error('This Word document expands to a large file. Export a simpler PDF or DOCX.');
      const stream=await zip.openReadStreamPromise(entry);
      for await(const chunk of stream){
        expanded+=chunk.length;
        if(expanded>MAX_EXPANDED)throw new Error('This Word document expands to a large file. Export a simpler PDF or DOCX.');
      }
    }
  }finally{zip.close();}
}
async function extract(bytes,extension){
  if(extension==='.pdf'){
    const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task=getDocument({data:new Uint8Array(bytes),useWorkerFetch:false,stopAtErrors:true,verbosity:0});
    try{
      const pdf=await task.promise;
      if(pdf.numPages>20)throw new Error('Use a résumé of 20 pages or fewer to get keyword suggestions.');
      let text='';
      for(let index=1;index<=pdf.numPages;index++){
        const page=await pdf.getPage(index);
        try{
          const content=await page.getTextContent();
          text=bounded(text+'\n'+content.items.map(item=>(item.str||'')+(item.hasEOL?'\n':' ')).join(''));
        }finally{page.cleanup();}
      }
      return text;
    }finally{await task.destroy();}
  }
  if(extension==='.docx'){
    await checkDocx(bytes);
    const {default:mammoth}=await import('mammoth');
    return bounded((await mammoth.extractRawText({buffer:bytes})).value);
  }
  if(extension==='.doc'){
    const {default:WordExtractor}=await import('word-extractor');
    const document=await new WordExtractor().extract(bytes);
    return bounded([document.getBody(),document.getTextboxes(),document.getHeaders()].join('\n'));
  }
  throw new Error('Use a PDF, DOC, or DOCX résumé.');
}
try{
  const chunks=[];let size=0;
  for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX_RESUME_BYTES)throw new Error('Use a résumé up to 2 MB.');chunks.push(chunk);}
  const text=await extract(Buffer.concat(chunks),process.argv[2]);
  if(!text.trim())throw new Error('No readable text was found. For a scanned résumé, upload a PDF with selectable text or a DOCX.');
  process.stdout.write(JSON.stringify({keywords:recommendKeywords(text)}));
}catch(error){
  const message=/^(Use a résumé|This (résumé|Word document)|No readable text|Use a PDF)/.test(error.message)?error.message:'Could not read this résumé. It may be damaged, password-protected, or saved in a different format. Export a new PDF or DOCX.';
  process.stdout.write(JSON.stringify({error:message}));
}
