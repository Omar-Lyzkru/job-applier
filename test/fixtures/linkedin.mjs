import {createServer} from 'node:http';

export async function startFixture(scenario='success') {
  const state={events:[],submissions:[],searches:[],fields:null};
  const server=createServer(async(req,res)=> {
    const url=new URL(req.url,'http://localhost');
    if (url.pathname==='/events') {
      const chunks=[]; for await (const chunk of req) chunks.push(chunk);
      const event=JSON.parse(Buffer.concat(chunks).toString());
      if (event.kind==='submit') {state.events.push('submit'); state.submissions.push(event.fields); state.fields=event.fields;}
      res.writeHead(200,{'Content-Type':'application/json'}); res.end('{}'); return;
    }
    res.setHeader('Content-Type','text/html');
    if (scenario==='signed-out') {res.end('<h1>Sign in</h1><label>Email<input id="username"></label><button>Sign in</button>'); return;}
    if (url.pathname.startsWith('/jobs/search')) {
      state.searches.push(Object.fromEntries(url.searchParams));
      const start=Number(url.searchParams.get('start')||0);
      const ids=start===0?[1001,1002]:start===25?[1003,1004]:[];
      res.end(`<nav><a href="/jobs/">Jobs</a></nav><ul>${ids.map(id=>`<li><a href="/jobs/view/${id}/"><strong>Software Engineer ${id}</strong></a><span class="artdeco-entity-lockup__subtitle">Example</span></li>`).join('')}</ul>`);
      return;
    }
    if (!url.pathname.startsWith('/jobs/view')) {res.end('<nav><a href="/jobs/">Jobs</a></nav><h1>Feed</h1>');return;}
    res.end(`<!doctype html><html><body><nav><a href="/jobs/">Jobs</a></nav><main>
      <h1>Software Engineer</h1><a href="/company/example/">Example</a><div id="job-details">Remote Python software role.</div>
      ${scenario==='external'?'<a href="https://example.com/apply">Apply</a>':'<button id="easy" aria-label="Easy Apply to Software Engineer">Easy Apply</button>'}
      ${scenario==='already-applied'?'<p>Application submitted</p>':''}
      </main><script>
      const scenario=${JSON.stringify(scenario)};
      let values={};
      let documents={'old-document':{name:'selected-resume.pdf',content:'old resume content'}};
      const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
      function collect(){
        for(const el of document.querySelectorAll('[role=dialog] input,[role=dialog] select,[role=dialog] textarea')){
          if(el.type==='radio'){if(el.checked)values[el.name]=el.value;}
          else if(el.type==='checkbox')values[el.name]=el.checked;
          else if(el.type==='file')values[el.name]=el.files[0]?.name||'';
          else values[el.name]=el.value;
        }
        const documentChoice=document.querySelector('.jobs-document-upload input[type=radio]:checked');
        if(documentChoice){values.documentId=documentChoice.value;values.resume=documents[documentChoice.value].name;values.resumeContent=documents[documentChoice.value].content;}
      }
      function dismiss(){
        const confirm=document.createElement('div');confirm.setAttribute('role','alertdialog');
        confirm.innerHTML='<p>Discard application?</p><button id="discard">Discard</button>';
        document.body.append(confirm);
        confirm.querySelector('button').onclick=()=>{confirm.remove();if(scenario!=='stuck-cleanup')document.querySelector('[role=dialog]')?.remove();};
      }
      function step(n){
        let dialog=document.querySelector('[role=dialog]');
        if(!dialog){dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Apply to Example');document.body.append(dialog);}
        const close='<button aria-label="Dismiss" id="dismiss">×</button>';
        if(scenario==='limit'){dialog.innerHTML=close+'<p>You have reached the daily application limit. Please try again tomorrow.</p>';}
        else if(n===1)dialog.innerHTML=close+'<h2>Contact information</h2><label>First name<input name="first" required></label><label>Last name<input name="last" required></label><label>Email address<input name="email" type="email" required></label><label>Phone number<input name="phone" type="tel" required></label><label>Resume<input name="resume" type="file" accept=".pdf,.doc,.docx" required></label><label>Previous employer<textarea name="previous">Unknown company</textarea></label><button id="advance">Next</button>';
        else if(n===2)dialog.innerHTML=close+'<h2>Screening questions</h2><label>Years of Java experience<input name="years" type="number" required></label><label>Are you authorized to work in this country?<select name="authorized" required><option value="">Select an option</option><option value="1">Yes</option><option value="0">No</option></select></label><fieldset><legend>Are you willing to relocate?</legend><label><input type="radio" name="relocate" value="yes" required>Yes</label><label><input type="radio" name="relocate" value="no" required>No</label></fieldset><label><input name="consent" type="checkbox" required>I agree to share this information</label><label><input name="follow" type="checkbox" checked>Follow company</label><button id="advance">Review</button>';
        else dialog.innerHTML=close+'<h2>Review your application</h2><pre>'+escape(JSON.stringify(values))+'</pre><button id="submit">Submit application</button>';
        if(n===1 && scenario!=='limit'){
          const upload=dialog.querySelector('input[type=file]');
          const area=document.createElement('section');area.className='jobs-document-upload';
          upload.closest('label').replaceWith(area);
          area.innerHTML='<h3>Resume</h3><label>Resume<input name="resume" type="file" required></label><fieldset><legend>Resume</legend><label><input type="radio" name="document" value="old-document" checked>selected-resume.pdf</label></fieldset><p role="status"></p>';
          area.querySelector('input[type=file]').onchange=async(event)=>{
            area.setAttribute('aria-busy','true');
            const file=event.target.files[0],content=await file.text();
            setTimeout(()=>{
              area.removeAttribute('aria-busy');
              if(scenario==='upload-failure'){area.querySelector('[role=status]').textContent='Upload failed';return;}
              documents['new-upload']={name:file.name,content};
              const label=document.createElement('label');label.innerHTML='<input type="radio" name="document" value="new-upload">'+escape(file.name);
              area.querySelector('fieldset').append(label);
              area.querySelector('[role=status]').textContent='Upload complete';
            },scenario==='delayed-upload'||scenario==='upload-failure'?700:25);
          };
        }
        if(n===2 && scenario==='cv-question')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<fieldset><legend>Can you provide a CV?</legend><label><input type="radio" name="cv" value="yes" required>Yes</label><label><input type="radio" name="cv" value="no" required>No</label></fieldset>');
        if(n===2 && scenario==='custom-checkbox')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<div role="checkbox" aria-label="Share demographic information" aria-required="true" aria-checked="true" tabindex="0"><input type="checkbox" checked style="display:none">Share demographic information</div>');
        if(n===2 && scenario==='custom-radio')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<div role="radiogroup" aria-label="Employment status" aria-required="true"><div role="radio" aria-checked="true" tabindex="0">Employed<input type="radio" checked style="display:none"></div><div role="radio" aria-checked="false">Unemployed</div></div>');
        if(n===2 && scenario==='custom-listbox')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<div role="listbox" aria-label="Citizenship" tabindex="0"><div role="option" aria-selected="true">Citizen<input type="text" value="citizen" style="display:none"></div></div>');
        if(n===2 && scenario==='custom-combobox')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<div role="combobox" aria-label="Citizenship" tabindex="0" aria-expanded="false">Citizen<input type="hidden" value="citizen"></div>');
        dialog.querySelector('#dismiss').onclick=dismiss;
        dialog.querySelector('#advance')?.addEventListener('click',()=>{collect();step(n+1);});
        dialog.querySelector('#submit')?.addEventListener('click',async(event)=>{
          event.target.disabled=true;
          await fetch('/events',{method:'POST',body:JSON.stringify({kind:'submit',fields:values})});
          if(scenario!=='timeout')dialog.innerHTML='<h2>Application sent</h2><p>Your application was sent to Example.</p><button id="done">Done</button>';
          dialog.querySelector('#done')?.addEventListener('click',()=>dialog.remove());
        });
      }
      document.querySelector('#easy')?.addEventListener('click',()=>step(1));
      </script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,state,close:()=>new Promise(resolve=>server.close(resolve))};
}
