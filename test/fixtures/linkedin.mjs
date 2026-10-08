import {createServer} from 'node:http';

export async function startFixture(scenario='success') {
  const state={uploads:[],events:[],advances:[],entries:[],submissions:[],reviews:[],searches:[],views:[],fields:null};
  const escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  const server=createServer(async(req,res)=> {
    const url=new URL(req.url,'http://localhost');
    if (url.pathname==='/events') {
      const chunks=[]; for await (const chunk of req) chunks.push(chunk);
      const event=JSON.parse(Buffer.concat(chunks).toString());
      if(event.kind==='upload')state.uploads.push(event);
      if(event.kind==='entry')state.entries.push(event);
      if(event.kind==='advance'){state.advances.push(event);if(state.beforeAdvance)await state.beforeAdvance(event,req,res);}
      if (event.kind==='submit') {state.events.push('submit'); state.submissions.push(event.fields); state.fields=event.fields;}
      if(event.kind==='review'){state.reviews.push(event.fields);state.fields=event.fields;}
      if(event.kind==='reminder-continue'||event.kind==='reminder-review')state.events.push(event.kind);
      res.writeHead(200,{'Content-Type':'application/json'}); res.end('{}'); return;
    }
    res.setHeader('Content-Type','text/html');
    if(url.pathname==='/feed/' && state.beforeFeed)await state.beforeFeed(req,res);
    if(res.destroyed)return;
    if (scenario==='signed-out') {res.end('<h1>Sign in</h1><label>Email<input id="username"></label><button>Sign in</button>'); return;}
    if (url.pathname.startsWith('/jobs/search')) {
      const params=Object.fromEntries(url.searchParams);state.searches.push(params);
      if(state.beforeSearch)await state.beforeSearch(params,req,res);
      if(res.destroyed)return;
      const start=Number(url.searchParams.get('start')||0);
      const ids=start===0?[1001,1002]:start===25?[1003,1004]:[];
      const cards=state.searchPageFor?state.searchPageFor(params):ids.map(id=>({id,title:`Software Engineer ${id}`,company:'Example'}));
      const levels=['Internship','Entry level','Associate','Mid-Senior level','Director','Executive'];
      const selected=new Set(scenario==='experience-ignored'||(scenario==='experience-ignored-later'&&start>0)?[]:(url.searchParams.get('f_E')||'').split(','));
      if(scenario==='experience-widened' && url.searchParams.has('f_E'))selected.add('4');
      const experienceOptions=`<fieldset><legend>Experience level</legend>${levels.map((label,index)=>{
        const value=String((index+1)*(scenario==='experience-values'?11:1));
        if(scenario==='experience-linkedin-labels')return `<input id="experience-${value}" type="checkbox" name="experience-level-filter-value" value="${value}"${selected.has(value)?' checked':''}><label for="experience-${value}"><span>${label}</span><span class="visually-hidden"> Filter by ${label}</span></label>`;
        return `<label><input type="checkbox" name="f_E" value="${value}"${selected.has(value)?' checked':''}>${label}${scenario==='experience-popup'?' (123)':''}</label>`;
      }).join('')}</fieldset>`;
      const experience=scenario==='experience-unavailable'?'':scenario==='experience-popup'?`<button id="experience">Experience level</button><div id="experience-options"></div><script>document.querySelector('#experience').onclick=()=>setTimeout(()=>{document.querySelector('#experience-options').innerHTML=${JSON.stringify(experienceOptions)};},150);</script>`:scenario==='experience-delayed'?`<div id="experience-options"></div><script>setTimeout(()=>{document.querySelector('#experience-options').innerHTML=${JSON.stringify(experienceOptions)};},250);</script>`:experienceOptions;
      res.end(`<nav><a href="/jobs/">Jobs</a></nav>${experience}<ul>${cards.map(card=>`<li><a href="/jobs/view/${escapeHtml(card.slug||card.id)}/"><strong>${escapeHtml(card.title)}</strong></a><span class="artdeco-entity-lockup__subtitle">${escapeHtml(card.company)}</span></li>`).join('')}</ul>`);
      return;
    }
    if (!url.pathname.startsWith('/jobs/view')) {res.end('<nav><a href="/jobs/">Jobs</a></nav><h1>Feed</h1>');return;}
    const jobId=url.pathname.match(/\/jobs\/view\/(\d+)/)?.[1];state.views.push(jobId);
    const posting=state.postingFor?.(jobId);
    const modernDescription=text=>`<div class="cky-description-section"><div></div><div><h2>About the job</h2></div><p><span>${text}</span></p></div>`;
    const descriptions={
      'description-modern':modernDescription('Build Python software for our internship team.'),
      'description-wrapped-controls':'<div><div><h2>About the job</h2><div><button>Show more</button><span hidden>Python elsewhere</span></div></div><p>Build Ruby systems for our team.</p></div>',
      'description-modern-delayed':modernDescription(''),
      'description-delayed':'<div id="job-details"></div>',
      'description-empty-first':'<div id="job-details"></div><div class="jobs-description-content__text" style="display:none">Hidden Java description.</div><div data-job-description>Visible Python engineering description.</div>',
      'description-missing':'<div><div><div><h2>About the job</h2></div><p></p></div><section><h3>Related jobs</h3><p>Python developer elsewhere.</p></section></div>',
      'description-related':modernDescription('Build Ruby systems for our team.')+'<section><h2>Related jobs</h2><p>Python developer elsewhere.</p></section>',
      'description-stopped':'<div id="job-details"></div>',
      'description-verification':'<div id="job-details"></div>',
      'description-no-metadata':'<div id="job-details">Remote Python software role.</div>'
    };
    const metadata=posting?`<header data-job-header><h1>${escapeHtml(posting.title||'Software Engineer')}</h1><a href="/company/example/">Example</a>${posting.header||''}</header>`:scenario.startsWith('description-')?'':'<h1>Software Engineer</h1><a href="/company/example/">Example</a>';
    const description=posting?`<div id="job-details">${escapeHtml(posting.description||'Required: Python')}</div>${posting.related||''}`:descriptions[scenario]??'<div id="job-details">Remote Python software role.</div>';
    res.end(`<!doctype html><html><body><nav><a href="/jobs/">Jobs</a></nav><main>
      ${metadata}${description}
      ${scenario==='external'?'<a href="https://example.com/apply">Apply</a>':'<button id="easy" aria-label="Easy Apply to Software Engineer">Easy Apply</button>'}
      ${scenario==='already-applied'?'<p>Application submitted</p>':''}
      </main><script>
      const scenario=${JSON.stringify(scenario)};
      if(scenario==='description-delayed')setTimeout(()=>{document.querySelector('#job-details').textContent='Hydrated Python software description.';},250);
      if(scenario==='description-modern-delayed')setTimeout(()=>{document.querySelector('.cky-description-section p span').textContent='Hydrated Python internship description.';},250);
      if(scenario==='description-verification')setTimeout(()=>{document.body.insertAdjacentHTML('afterbegin','<p>Complete this security check</p>');},250);
      document.addEventListener('input',()=>fetch('/events',{method:'POST',body:JSON.stringify({kind:'entry'})}));
      let values={};
      let documents=(scenario==='resume-reuse'&&JSON.parse(localStorage.getItem('fixture-documents')||'null'))||{'old-document':{name:'selected-resume.pdf',content:'old resume content'}};
      const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
      function collect(){
        for(const el of document.querySelectorAll(':is([role=dialog],dialog) input,:is([role=dialog],dialog) select,:is([role=dialog],dialog) textarea')){
          if(el.type==='radio'){if(el.checked)values[el.name]=el.value;}
          else if(el.type==='checkbox')values[el.name]=el.checked;
          else if(el.type==='file')values[el.name]=el.files[0]?.name||'';
          else values[el.name]=el.value;
        }
        const documentChoice=document.querySelector('.jobs-document-upload input[type=radio]:checked');
        if(documentChoice){values.documentId=documentChoice.value;values.resume=documents[documentChoice.value].name;values.resumeContent=documents[documentChoice.value].content;}
      }
      let dismissClicks=0;const ignoredSteps=new Set();
      function dismiss(){
        if(scenario==='dismiss-delayed'&&dismissClicks++===0)return;
        if(scenario==='modern-discard'||scenario==='dismiss-delayed'){
          const confirm=document.createElement('dialog');confirm.open=true;confirm.setAttribute('aria-label','Save this application?');confirm.style='position:fixed;top:20px;left:20px;z-index:999;background:white;padding:20px';
          confirm.innerHTML='<h2>Save this application?</h2><span id="discard"><span>Discard</span></span><button>Save</button>';document.body.append(confirm);
          confirm.querySelector('#discard').onclick=()=>{confirm.remove();document.querySelector('[role=dialog],dialog')?.remove();};return;
        }
        const confirm=document.createElement('div');confirm.setAttribute('role','alertdialog');
        confirm.style='position:fixed;top:20px;left:20px;z-index:999;background:white;padding:20px';
        confirm.innerHTML='<p>Discard application?</p><button id="discard">Discard</button>';
        document.body.append(confirm);
        confirm.querySelector('button').onclick=()=>{confirm.remove();if(scenario!=='stuck-cleanup')document.querySelector('[role=dialog],dialog')?.remove();};
      }
      function step(n){
        let dialog=document.querySelector('[role=dialog],dialog');
        if(!dialog){dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Apply to Example');document.body.append(dialog);}
        dialog.dataset.fixtureStep=String(n);
        if(scenario==='reused-page-progress'&&n===2){
          dialog.querySelector('.application-progress [role=progressbar]').setAttribute('aria-valuenow',String(2/3*100));dialog.querySelector('.application-progress p').textContent='2/3 pages';dialog.querySelector('[name=first]').value='';return;
        }
        const close='<button aria-label="Dismiss" id="dismiss">×</button>';
        if(scenario==='limit'){dialog.innerHTML=close+'<p>You have reached the daily application limit. Please try again tomorrow.</p>';}
        else if(n===1)dialog.innerHTML=close+'<h2>Contact information</h2><label>First name<input name="first" required></label><label>Last name<input name="last" required></label><label>Email address<input name="email" type="email" required></label><label>Phone number<input name="phone" type="tel" required></label><label>Resume<input name="resume" type="file" accept=".pdf,.doc,.docx" required></label><label>Previous employer<textarea name="previous">Unknown company</textarea></label><button id="advance">Next</button>';
        else if(n===2 && scenario==='answer-memory')dialog.innerHTML=close+'<h2>Additional questions</h2><label>University name*<input name="school" required></label><label>Are you authorized to work legally in the US?*<select name="authorized" required><option value="">Choose</option><option value="1">Yes</option><option value="0">No</option></select></label><fieldset><legend>Will you now or anytime after graduation require sponsorship for a work visa (like an H1b) to work legally in the US?*</legend><label><input name="sponsorship" type="radio" value="1" required>Yes</label><label><input name="sponsorship" type="radio" value="0" required>No</label></fieldset><label>Do you consent to text message updates about your application?*<select name="sms" required><option value="">Choose</option><option value="1">Yes</option><option value="0">No</option></select></label><button id="advance">Review</button>';
        else if(n===2||n===3&&scenario==='identical-text-next')dialog.innerHTML=close+'<h2>Screening questions</h2><label>Years of Java experience<input name="years" type="number" required></label><label>Are you authorized to work in this country?<select name="authorized" required><option value="">Select an option</option><option value="1">Yes</option><option value="0">No</option></select></label><fieldset><legend>Are you willing to relocate?</legend><label><input type="radio" name="relocate" value="yes" required>Yes</label><label><input type="radio" name="relocate" value="no" required>No</label></fieldset><label><input name="consent" type="checkbox" required>I agree to share this information</label><label><input name="follow" type="checkbox" checked>Follow company</label><button id="advance">Review</button>';
        else dialog.innerHTML=close+'<h2>Review your application</h2><pre>'+escape(JSON.stringify(values))+'</pre><button id="submit">Submit application</button>';
        if(scenario==='reused-page-progress'&&n===1)dialog.insertAdjacentHTML('afterbegin','<div class="application-progress"><div><svg width="100" height="4" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+(1/3*100)+'"><rect width="100" height="4"></rect></svg></div><p>1/3 pages</p></div>');
        if(['page-progress','page-progress-busy','upload-progress','indeterminate-progress','unrelated-page-counter'].includes(scenario)){
          const counter=scenario==='upload-progress'||scenario==='unrelated-page-counter'?'Uploading résumé':' '+n+'/5 pages';
          dialog.insertAdjacentHTML('afterbegin','<div class="application-progress"><div>'+n*20+' percent complete</div><div><svg width="100" height="4" role="progressbar" aria-valuemin="0" aria-valuemax="100"'+(scenario==='indeterminate-progress'?'':' aria-valuenow="'+n*20+'"')+'><rect width="100" height="4"></rect></svg></div><p>'+counter+'</p></div>');
          if(scenario==='page-progress-busy')dialog.setAttribute('aria-busy','true');
          if(scenario==='unrelated-page-counter')dialog.insertAdjacentHTML('beforeend','<p>1/5 pages</p>');
        }
        if(n===1 && scenario!=='limit'){
          const upload=dialog.querySelector('input[type=file]');
          const area=document.createElement('section');area.className='jobs-document-upload';
          upload.closest('label').replaceWith(area);
          area.innerHTML='<h3>Resume</h3><label>Resume<input name="resume" type="file" required></label><fieldset><legend>Resume</legend><label><input type="radio" name="document" value="old-document" checked>selected-resume.pdf</label></fieldset><p role="status"></p>';
          if(scenario==='resume-reuse')area.querySelector('fieldset').innerHTML='<legend>Resume</legend>'+Object.entries(documents).map(([id,doc])=>'<label><input type="radio" name="document" value="'+escape(id)+'"'+(id==='old-document'?' checked':'')+'>'+escape(doc.name)+'</label>').join('');
          area.querySelector('input[type=file]').onchange=async(event)=>{
            area.setAttribute('aria-busy','true');
            const file=event.target.files[0],content=await file.text();
            setTimeout(()=>{
              area.removeAttribute('aria-busy');
              if(scenario==='upload-failure'){area.querySelector('[role=status]').textContent='Upload failed';return;}
              const id=scenario==='resume-reuse'?'new-upload-'+Object.keys(documents).length:'new-upload';
              documents[id]={name:file.name,content};
              if(scenario==='resume-reuse'){localStorage.setItem('fixture-documents',JSON.stringify(documents));fetch('/events',{method:'POST',body:JSON.stringify({kind:'upload',name:file.name})});}
              const label=document.createElement('label');label.innerHTML='<input type="radio" name="document" value="'+escape(id)+'">'+escape(file.name);
              area.querySelector('fieldset').append(label);
              const notification=area.querySelector('[role=status]');
              notification.textContent='Upload complete';
              if(scenario==='resume-success-alert'||scenario==='resume-error-alert'){
                notification.setAttribute('role','alert');notification.textContent='Resume uploaded successfully';
                if(scenario==='resume-error-alert')area.insertAdjacentHTML('beforeend','<p role="alert">Document processing failed. Please upload another file.</p>');
              }
            },scenario==='delayed-upload'||scenario==='upload-failure'?700:25);
          };
        }
        if(n===2 && scenario==='cv-question')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<fieldset><legend>Can you provide a CV?</legend><label><input type="radio" name="cv" value="yes" required>Yes</label><label><input type="radio" name="cv" value="no" required>No</label></fieldset>');
        if(n===2 && scenario==='custom-checkbox')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<div role="checkbox" aria-label="Share demographic information" aria-required="true" aria-checked="true" tabindex="0"><input type="checkbox" checked style="display:none">Share demographic information</div>');
        if(n===2 && scenario==='custom-radio')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<div role="radiogroup" aria-label="Employment status" aria-required="true"><div role="radio" aria-checked="true" tabindex="0">Employed<input type="radio" checked style="display:none"></div><div role="radio" aria-checked="false">Unemployed</div></div>');
        if(n===2 && scenario==='custom-listbox')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<div role="listbox" aria-label="Citizenship" tabindex="0"><div role="option" aria-selected="true">Citizen<input type="text" value="citizen" style="display:none"></div></div>');
        if(n===2 && scenario==='custom-combobox')dialog.querySelector('#advance').insertAdjacentHTML('beforebegin','<div role="combobox" aria-label="Citizenship" tabindex="0" aria-expanded="false">Citizen<input type="hidden" value="citizen"></div>');
        dialog.querySelector('#dismiss').onclick=dismiss;
        dialog.querySelector('#advance')?.addEventListener('click',async()=>{const current=Number(dialog.dataset.fixtureStep);collect();await fetch('/events',{method:'POST',body:JSON.stringify({kind:'advance',step:current})});
          if(current===2&&scenario==='ignored-next-always')return;
          if(current===2&&scenario==='ignored-next-once'&&!ignoredSteps.has(current)){ignoredSteps.add(current);return;}
          if(current===2&&scenario==='next-validation'){dialog.insertAdjacentHTML('beforeend','<p role="alert">Validation private-test-secret</p>');return;}
          if(current===2&&scenario==='next-busy'){dialog.setAttribute('aria-busy','true');dialog.insertAdjacentHTML('beforeend','<p role="status">Loading</p>');return;}
          if(['answer-memory','resume-reuse'].includes(scenario)&&current===2)await fetch('/events',{method:'POST',body:JSON.stringify({kind:'review',fields:values})});step(current+1);});
        dialog.querySelector('#submit')?.addEventListener('click',async(event)=>{
          event.target.disabled=true;
          await fetch('/events',{method:'POST',body:JSON.stringify({kind:'submit',fields:values})});
          if(scenario!=='timeout')dialog.innerHTML='<h2>Application sent</h2><p>Your application was sent to Example.</p><button id="done">Done</button>';
          dialog.querySelector('#done')?.addEventListener('click',()=>dialog.remove());
        });
        if(scenario==='unrelated-dialog'&&!document.querySelector('#chat')){
          const chat=document.createElement('div');chat.id='chat';chat.setAttribute('role','dialog');chat.innerHTML='<h2>MS in Applied Analytics</h2><button>Close your conversation</button>';document.body.append(chat);
        }
      }
      function safetyReminder(){
        const dialog=document.createElement('dialog');dialog.open=true;dialog.setAttribute('aria-labelledby','dialog-header');document.body.append(dialog);
        dialog.innerHTML='<header><h2 id="dialog-header">'+(scenario==='safety-unknown'?'Job post safety warning':'Job search safety reminder')+'</h2></header><button aria-label="Dismiss" id="dismiss">×</button>';
        dialog.querySelector('#dismiss').onclick=()=>dialog.remove();
        const addReview=()=>{
          dialog.insertAdjacentHTML('beforeend','<p>Research the company on its official website and social media.</p><p>Report suspicious jobs that request credit cards, bank details, or purchases.</p><button id="review-job">Review job post</button>');
          dialog.querySelector('#review-job').onclick=()=>{fetch('/events',{method:'POST',body:JSON.stringify({kind:'reminder-review'})});dialog.remove();};
        };
        if(scenario==='safety-reminder')addReview();else setTimeout(addReview,100);
        setTimeout(()=>{
          if(!dialog.isConnected)return;
          dialog.insertAdjacentHTML('beforeend','<div id="continue-applying"><span>Continue applying</span></div>');
          dialog.querySelector('#continue-applying').onclick=()=>{
            fetch('/events',{method:'POST',body:JSON.stringify({kind:'reminder-continue'})});dialog.remove();
            const application=document.createElement('dialog');application.open=true;application.setAttribute('aria-label','Apply to Example');document.body.append(application);
            application.innerHTML='<h2>Apply to Example</h2><button aria-label="Dismiss" id="dismiss">×</button><button>Submit application</button>';
            application.querySelector('#dismiss').onclick=dismiss;
            setTimeout(()=>{if(application.isConnected)step(1);},250);
          };
        },scenario==='safety-stop'?1500:250);
      }
      const attachEasy=()=>document.querySelector('#easy')?.addEventListener('click',()=>scenario.startsWith('safety-')?safetyReminder():step(1));
      if(scenario==='opener-delayed')setTimeout(attachEasy,350);else attachEasy();
      </script></body></html>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,state,close:()=>new Promise(resolve=>server.close(resolve))};
}
