(() => {
 const settings=document.getElementById('measurement-settings');if(!settings)return;
 const banner=document.getElementById('measurement-banner'),dialog=document.getElementById('measurement-dialog');
 const storage={get:k=>{try{return sessionStorage.getItem(k)}catch{return null}},set:(k,v)=>{try{sessionStorage.setItem(k,v)}catch{}},remove:k=>{try{sessionStorage.removeItem(k)}catch{}}};
 let prefs={analytics:false,ads:false},decided=false;
 try{const saved=JSON.parse(localStorage.getItem('verdeloop-consent-v2')||'null');if(saved?.version===2&&typeof saved.analytics==='boolean'&&typeof saved.ads==='boolean'){prefs=saved;decided=true;}else if(localStorage.getItem('verdeloop-measurement-v1')==='denied'){decided=true;}}catch{}
 let googleLoaded=false,attrs={},configuredGA=false,configuredAds=false,formChoiceChanged=false;
 const ga=/^G-[A-Z0-9]+$/.test(settings.dataset.ga)?settings.dataset.ga:'';
 const ads=/^AW-\d+$/.test(settings.dataset.ads)?settings.dataset.ads:'';
 const adLabel=/^[A-Za-z0-9_-]+$/.test(settings.dataset.label)?settings.dataset.label:'';
 const allowed=()=>prefs.analytics||prefs.ads;
 function filtered(value){const result={};for(const touch of ['first','last'])if(value?.[touch]){result[touch]={...value[touch]};if(!prefs.ads)for(const key of ['gclid','gbraid','wbraid'])delete result[touch][key];}return result;}
 function rememberAttribution(){
  if(!allowed()){attrs={};storage.remove('verdeloop-attribution');return;}
  try{const saved=JSON.parse(storage.get('verdeloop-attribution')||'null');if(saved&&saved.expires>Date.now())attrs=filtered(saved.value);}catch{}
  attrs=filtered(attrs);const params=new URLSearchParams(location.search),touch={path:location.pathname};
  for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term',...(prefs.ads?['gclid','gbraid','wbraid']:[])])if(params.has(key))touch[key]=params.get(key).slice(0,120);
  try{if(document.referrer&&new URL(document.referrer).origin!==location.origin)touch.referrer=new URL(document.referrer).origin;}catch{}
  if(!attrs.first)attrs.first=touch;
  if(!attrs.last||touch.utm_source||touch.utm_campaign||touch.gclid||touch.gbraid||touch.wbraid||touch.referrer)attrs.last=touch;
  storage.set('verdeloop-attribution',JSON.stringify({value:attrs,expires:Date.now()+30*60*1000}));
 }
 const consentState=()=>({analytics_storage:prefs.analytics?'granted':'denied',ad_storage:prefs.ads?'granted':'denied',ad_user_data:'denied',ad_personalization:'denied'});
 function startGoogle(){
  if(!allowed()||(!ga&&!ads))return;
  window['ga-disable-'+ga]=!prefs.analytics;
  if(!googleLoaded){window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};window.gtag('consent','default',consentState());window.gtag('js',new Date());}
  else window.gtag?.('consent','update',consentState());
  const cleanURL=location.origin+location.pathname;
  if(prefs.analytics&&ga&&!configuredGA){window.gtag('config',ga,{send_page_view:false,page_location:cleanURL,page_referrer:''});configuredGA=true;}
  if(prefs.ads&&ads&&!configuredAds){window.gtag('config',ads,{page_location:cleanURL,page_referrer:'',allow_ad_personalization_signals:false});configuredAds=true;}
  if(!googleLoaded){googleLoaded=true;const script=document.createElement('script');script.src='https://www.googletagmanager.com/gtag/js?id='+(prefs.analytics&&ga?ga:ads);script.async=true;document.head.append(script);}
 }
 function track(event,details={}){
  if(!prefs.analytics)return;
  const payload={id:crypto.randomUUID(),event,path:location.pathname,attribution:attrs,consent:true,placement:details.button_position||''};
  if(event!=='generate_lead'){const text=JSON.stringify(payload);if(!navigator.sendBeacon?.('/api/events',new Blob([text],{type:'text/plain'})))fetch('/api/events',{method:'POST',headers:{'Content-Type':'text/plain'},body:text,keepalive:true}).catch(()=>{});}
  if(ga)window.gtag?.('event',event,{send_to:ga,page_location:location.origin+location.pathname,page_referrer:'',...details,...(event==='generate_lead'?{currency:'THB'}:{})});
 }
 async function reportLead(id){
  if(!allowed())return;
  try{track('generate_lead');if(!prefs.ads||!ads||!adLabel||!window.gtag)return;
   await new Promise(resolve=>{const timer=setTimeout(resolve,2000);const done=()=>{clearTimeout(timer);resolve()};try{window.gtag('event','conversion',{send_to:ads+'/'+adLabel,value:1.0,currency:'THB',transaction_id:id,event_callback:done,event_timeout:1800});}catch{done();}});
  }catch{}
 }
 function syncControls(){for(const category of ['analytics','ads']){const control=document.getElementById('consent-'+category);if(control)control.checked=prefs[category];}const all=document.getElementById('consent-all');if(all)all.checked=prefs.analytics&&prefs.ads;formChoiceChanged=false;}
 function clearCookies(){for(const part of document.cookie.split(';')){const name=part.trim().split('=')[0];if((!prefs.analytics&&/^(_ga|_gid)/.test(name))||(!prefs.ads&&/^_gcl/.test(name)))for(const domain of ['',`; Domain=${location.hostname}`,`; Domain=.${location.hostname}`])document.cookie=name+'=; Max-Age=0; Path=/'+domain;}}
 function choose(next,source){const previous=prefs;prefs={version:2,analytics:next.analytics===true,ads:next.ads===true,updatedAt:new Date().toISOString(),source};decided=true;
  try{localStorage.setItem('verdeloop-consent-v2',JSON.stringify(prefs));localStorage.removeItem('verdeloop-measurement-v1');}catch{}
  banner.hidden=true;syncControls();rememberAttribution();window['ga-disable-'+ga]=!prefs.analytics;
  if(allowed())startGoogle();else window.gtag?.('consent','update',consentState());clearCookies();
  if(prefs.analytics&&!previous.analytics)track('page_view');
 }
 let returnFocus;
 function openPreferences(event){returnFocus=event?.currentTarget;syncControls();dialog.showModal();document.getElementById('consent-analytics')?.focus();}
 function closePreferences(){dialog.close();returnFocus?.focus();}
 banner.hidden=decided;syncControls();if(allowed()){rememberAttribution();startGoogle();if(document.prerendering)document.addEventListener('prerenderingchange',()=>track('page_view'));else track('page_view');}
 document.querySelectorAll('[data-consent-accept]').forEach(button=>button.addEventListener('click',()=>{choose({analytics:true,ads:true},'banner');if(dialog.open)closePreferences();}));
 document.querySelectorAll('[data-consent-settings]').forEach(button=>button.addEventListener('click',openPreferences));
 document.getElementById('measurement-preferences')?.addEventListener('click',openPreferences);
 document.getElementById('consent-save')?.addEventListener('click',()=>{choose({analytics:document.getElementById('consent-analytics').checked,ads:document.getElementById('consent-ads').checked},'settings');closePreferences();});
 document.getElementById('consent-reject')?.addEventListener('click',()=>{choose({analytics:false,ads:false},'settings');closePreferences();});
 document.getElementById('consent-close')?.addEventListener('click',closePreferences);
 document.addEventListener('click',ev=>{const a=ev.target.closest?.('a');if(!a)return;const type=a.dataset.track;if(type==='phone')track('phone_click');if(type==='line'){const placement=a.dataset.placement||'unknown';track('line_click',{button_position:placement==='contact_bar'?(window.innerWidth<768?'mobile_bar':'desktop_float'):placement});try{const url=new URL(a.href,location.origin);if(url.origin===location.origin&&url.pathname==='/line/'){url.searchParams.set('from',location.pathname);url.searchParams.set('placement',placement==='contact_bar'?(window.innerWidth<768?'mobile_bar':'desktop_float'):placement);if(allowed())url.hash=encodeURIComponent(JSON.stringify({attribution:attrs}));a.href=url.href;}}catch{}}if(a.hasAttribute('download'))track('document_download');});
 const form=document.querySelector('form#form[action="/api/lead"]');if(!form)return;
 const allConsent=document.getElementById('consent-all');allConsent?.addEventListener('change',()=>{formChoiceChanged=true;});
 let submitting=false;
 let submissionId=storage.get('verdeloop-submission-id')||crypto.randomUUID();
 storage.set('verdeloop-submission-id',submissionId);
 form.addEventListener('submit',async ev=>{
  ev.preventDefault();if(submitting)return;submitting=true;
  const button=form.querySelector('button[type="submit"]'),original=button.textContent;
  button.disabled=true;button.textContent='กำลังส่งข้อมูล…';
  form.querySelector('.form-feedback')?.remove();
  if(allConsent&&(formChoiceChanged||(allConsent.checked&&(!prefs.analytics||!prefs.ads)))){try{choose({analytics:allConsent.checked,ads:allConsent.checked},'form');}catch{/* Tracking errors must not prevent a request. */}}
  const data=new URLSearchParams(new FormData(form));data.set('submissionId',submissionId);
  data.set('analyticsConsent',String(prefs.analytics));data.set('adsConsent',String(prefs.ads));data.set('consentVersion','2');data.set('consentSource',prefs.source||'none');
  if(allowed())data.set('attribution',JSON.stringify(attrs));
  try{
   const response=await fetch('/api/lead',{method:'POST',headers:{Accept:'application/json'},body:data});
   const result=await response.json();
   if(!response.ok||!result.ok)throw new Error(result.error==='rate_limit'?'ส่งข้อมูลหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่ หรือติดต่อเราทาง LINE':result.error==='validation'?'กรุณาตรวจข้อมูลในฟอร์มให้ครบถ้วน':'ยังส่งข้อมูลไม่ได้ กรุณาลองอีกครั้ง หรือติดต่อเราทาง LINE');
   storage.remove('verdeloop-submission-id');
   if(!result.duplicate)await reportLead(submissionId);
   location.assign('/thank-you/');
  }catch(error){
   const message=document.createElement('p');message.className='form-feedback';message.setAttribute('role','alert');message.tabIndex=-1;message.textContent=error.message==='Failed to fetch'?'การเชื่อมต่อขัดข้อง ข้อมูลที่กรอกยังอยู่ กรุณาลองส่งอีกครั้ง':error.message;form.prepend(message);message.focus();
   submitting=false;button.disabled=false;button.textContent=original;
  }
 });
})();
