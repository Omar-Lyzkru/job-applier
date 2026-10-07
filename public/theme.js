// Load before styles so the saved theme applies before the page is painted.
(()=>{
  const key='job-applier-theme';let preference='light';
  try{if(localStorage.getItem(key)==='dark')preference='dark';}catch{}
  const apply=value=>{document.documentElement.dataset.theme=value;};
  apply(preference);
  window.jobApplierTheme={toggle(){
    preference=document.documentElement.dataset.theme==='dark'?'light':'dark';apply(preference);
    try{localStorage.setItem(key,preference);}catch{}
  }};
})();
