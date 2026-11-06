(() => {
 const $=id=>document.getElementById(id),settings=$('writer-settings'),keyForm=$('writer-key-settings'),editor=$('article-editor');
 if(!settings)return;
 let draft=null,publication=null,candidate=null,research=null,images=[],dirty=false,busy=false;
 const initial=JSON.parse($('writer-config').textContent);
 const status=(message,error=false)=>{$('writer-status').textContent=message;$('writer-status').dataset.error=String(error);for(const id of ['generation-status','image-status']){const local=$(id);if(local){local.textContent=message;local.dataset.error=String(error);}}};
 const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const imageURL=id=>'/admin?view=writer&image='+encodeURIComponent(id);
 async function api(action,body={}){
  const r=await fetch('/admin',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({action,...body})});
  if(!r.headers.get('content-type')?.includes('application/json'))throw Error('กรุณาเข้าสู่ระบบอีกครั้ง ข้อความที่แก้ไขยังอยู่ในหน้านี้');
  const data=await r.json();if(!r.ok||!data.ok)throw Error(data.error||'ดำเนินการไม่สำเร็จ');return data;
 }
 async function get(data,extra={}){const r=await fetch('/admin?'+new URLSearchParams({view:'writer',data,...extra}));if(!r.headers.get('content-type')?.includes('application/json'))throw Error('กรุณาเข้าสู่ระบบอีกครั้ง');const v=await r.json();if(!r.ok||!v.ok)throw Error(v.error||'โหลดข้อมูลไม่ได้');return v;}
 async function run(fn){if(busy)return;busy=true;$('draft-picker').disabled=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){status(e.message,true);}finally{busy=false;$('draft-picker').disabled=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 const localTime=v=>new Date(v).toLocaleString('th-TH');
 const characterCount=text=>Array.from((text||'').replace(/\s+/g,' ').trim()).length;
 const countLabel=text=>characterCount(text).toLocaleString('th-TH')+' ตัวอักษร'+($('writer-brief').elements.targetChars.value?' / เป้าหมาย '+Number($('writer-brief').elements.targetChars.value).toLocaleString('th-TH'):'');
 const updateCount=()=>{$('article-count').textContent=countLabel(editor.textContent);};
 const markDirty=()=>{dirty=true;updateCount();$('save-status').textContent='มีการแก้ไขที่ยังไม่บันทึก';};
 ['article-title','article-description','article-editor','writer-brief'].forEach(id=>$(id).addEventListener('input',markDirty));
 document.querySelectorAll('[form=writer-brief]').forEach(el=>el.addEventListener('input',markDirty));
 window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
 editor.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));});
 document.querySelectorAll('[data-format],[data-block]').forEach(b=>b.addEventListener('mousedown',e=>{e.preventDefault();editor.focus();document.execCommand(b.dataset.format||'formatBlock',false,b.dataset.block||null);markDirty();}));
 const brief=()=>Object.fromEntries(new FormData($('writer-brief')));
 async function refreshList(id){const v=await get('list');$('draft-picker').replaceChildren(new Option('เลือกฉบับร่าง',''),...v.drafts.map(d=>new Option(d.title||'ยังไม่ได้ตั้งชื่อ',d.id)));$('draft-picker').value=id||'';}
 function fillContent(d){$('article-title').value=d.title||'';$('article-description').value=d.description||'';editor.innerHTML=d.content||'';for(const el of $('writer-brief').elements)if(el.name)el.value=d.brief?.[el.name]||(el.name==='productMode'?'editorial':'');updateCount();}
 async function load(id){const v=await get('draft',{id});draft=v.draft;images=v.images;fillContent(draft);dirty=false;$('save-status').textContent='บันทึกล่าสุด '+localTime(draft.updated_at);$('writer-workspace').hidden=false;$('writer-candidate').hidden=true;renderImages();renderHistory(v);renderResearch(v.research);publication=v.publication;renderPublication();}
 function renderHistory(v){
  $('writer-revisions').replaceChildren();for(const rev of v.revisions){const row=document.createElement('div');row.className='writer-history';row.textContent='รุ่น '+rev.version+' · '+localTime(rev.created_at);const b=document.createElement('button');b.type='button';b.textContent='นำมาแก้ไข';b.onclick=()=>run(async()=>{if(dirty&&!confirm('แทนที่ข้อความที่ยังไม่บันทึกด้วยเวอร์ชันนี้?'))return;const old=await get('revision',{id:rev.id});fillContent(old.draft);markDirty();status('โหลดเวอร์ชันก่อนหน้าแล้ว กดบันทึกเพื่อใช้ฉบับนี้');});row.append(b);$('writer-revisions').append(row);}
  $('writer-jobs').replaceChildren();for(const job of v.jobs){const row=document.createElement('div');row.className='writer-history';row.textContent=(job.operation==='research'?'SERP Spy':({article:'บทความ',cover:'ภาพปก',inline:'ภาพประกอบ'})[job.kind])+' · '+({running:'กำลังสร้าง',done:'สำเร็จ',failed:'ไม่สำเร็จ'})[job.status]+' · '+localTime(job.created_at);const b=document.createElement('button');b.type='button';b.textContent='ดูผล';b.onclick=()=>run(async()=>handleJob((await get('job',{id:job.id})).job));row.append(b);$('writer-jobs').append(row);}
 }
 async function save(){if(!draft)throw Error('สร้างหรือเลือกฉบับร่างก่อน');const snapshot={title:$('article-title').value,description:$('article-description').value,content:editor.innerHTML,brief:brief()};const r=await api('writer_save',{id:draft.id,version:draft.version,...snapshot});draft=r.draft;dirty=JSON.stringify(snapshot)!==JSON.stringify({title:$('article-title').value,description:$('article-description').value,content:editor.innerHTML,brief:brief()});if(!dirty)editor.innerHTML=draft.content;$('save-status').textContent=dirty?'มีการแก้ไขใหม่ที่ยังไม่บันทึก':'บันทึกแล้ว '+localTime(draft.updated_at);await refreshList(draft.id);return draft;}
 $('save-draft').onclick=()=>run(async()=>{await save();const v=await get('draft',{id:draft.id});renderHistory(v);status('บันทึกฉบับร่างแล้ว');});
 $('new-draft').onclick=()=>run(async()=>{if(dirty&&!confirm('มีข้อความยังไม่บันทึก ต้องการเปิดบทความใหม่หรือไม่?'))return;const {id}=await api('writer_new',{id:crypto.randomUUID()});await refreshList(id);await load(id);status('สร้างฉบับร่างแล้ว');});
 $('draft-picker').onchange=()=>run(async()=>{const id=$('draft-picker').value;if(dirty&&!confirm('เปิดฉบับอื่นโดยไม่บันทึกการแก้ไข?')){$('draft-picker').value=draft?.id||'';return;}if(id)await load(id);});
 async function loadModels(){const data=await get('models');for(const kind of ['text','image'])$('writer-'+kind+'-models').replaceChildren(...data[kind].map(m=>new Option(m.name,m.id)));$('model-status').textContent='พร้อมเลือก '+data.text.length+' โมเดลข้อความ / '+data.image.length+' โมเดลภาพ';}
 $('load-models').onclick=()=>run(loadModels);
 async function saveApiKey(){
  const key=keyForm.elements.apiKey.value.trim();
  $('api-key-status').textContent='กำลังบันทึก…';
  try{
   if(!key)throw Error('กรุณาใส่ OpenRouter API Key ก่อนบันทึก');
   await api('writer_settings',{apiKey:key,keyOnly:true});
   const saved=await get('list');if(!saved.config?.configured)throw Error('เซิร์ฟเวอร์ยังไม่ยืนยันการบันทึก กรุณาลองใหม่');
   keyForm.elements.apiKey.value='';keyForm.elements.apiKey.placeholder='เว้นว่างเพื่อใช้คีย์เดิม';
   $('key-status').textContent='· บันทึกคีย์แล้ว';
   $('api-key-status').textContent='บันทึก API Key แล้ว';status('บันทึก API Key แล้ว');
  }catch(e){$('api-key-status').textContent=e.message;throw e;}
 }
 const submitKey=e=>{e.preventDefault();run(saveApiKey);};
 keyForm.onsubmit=submitKey;
 $('save-api-key').onclick=submitKey;
 settings.onsubmit=e=>{e.preventDefault();run(async()=>{const values=Object.fromEntries(new FormData(settings));const file=settings.elements.logoFile.files[0];delete values.logoFile;values.resetLogo=settings.elements.resetLogo.checked;if(file?.size){if(file.size>2*1024*1024)throw Error('โลโก้ใหญ่เกิน 2 MB');values.logo=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});}await api('writer_settings',values);keyForm.elements.apiKey.value='';settings.elements.logoFile.value='';settings.elements.resetLogo.checked=false;$('key-status').textContent='· บันทึกการตั้งค่าแล้ว';$('writer-logo').src='/admin?view=writer&logo=1&t='+Date.now();status('บันทึกการตั้งค่าแล้ว');});};
 $('check-key').onclick=()=>run(async()=>{
  try{
   if(keyForm.elements.apiKey.value.trim())await saveApiKey();
   $('api-key-status').textContent='กำลังทดสอบการเชื่อมต่อ…';
   const result=await api('writer_check');$('api-key-status').textContent=result.message;status(result.message);
  }catch(e){$('api-key-status').textContent=e.message;throw e;}
 });


 const slugFromTitle=title=>title.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,120).replace(/-+$/,'');
 function renderPublication(){
  const slug=$('publication-slug');slug.value=publication?.slug||slugFromTitle(draft?.title||'');slug.readOnly=!!publication;
  const covers=$('publication-cover');covers.replaceChildren(new Option('ไม่ใช้ภาพปก',''),...images.map(i=>new Option((i.kind==='cover'?'ภาพปก':'ภาพประกอบ')+' · '+localTime(i.created_at),i.id)));
  covers.value=publication?.cover_id||(!publication?images.find(i=>i.kind==='cover')?.id||'':'');
  $('publication-status').textContent=publication?.published?'เผยแพร่แล้ว · '+(publication.draft_version===draft.version?'ตรงกับฉบับร่างที่บันทึก':'มีฉบับร่างใหม่ กดอัปเดตเพื่อเปลี่ยนบนเว็บ'):'ยังไม่เผยแพร่';
  $('publish-article').textContent=publication?.published?'อัปเดตบทความบนเว็บ':'เผยแพร่บนเว็บ';
  $('unpublish-article').hidden=!publication?.published;$('published-link').hidden=!publication?.published;
  if(publication)$('published-link').href=publication.url;
 }
 $('publish-article').onclick=()=>run(async()=>{
  const slug=$('publication-slug').value.trim()||slugFromTitle($('article-title').value),coverId=$('publication-cover').value;
  $('publication-status').textContent='กำลังบันทึกและเผยแพร่…';
  try{await save();const r=await api('writer_publish',{id:draft.id,version:draft.version,slug,coverId});publication={...r.publication,cover_id:coverId};renderPublication();status('เผยแพร่แล้ว เปิดดูบทความบนเว็บได้');}
  catch(e){$('publication-status').textContent=e.message;throw e;}
 });
 $('unpublish-article').onclick=()=>run(async()=>{
  if(!confirm('นำบทความออกจากเว็บสาธารณะ? ฉบับร่างยังอยู่'))return;
  await api('writer_unpublish',{id:draft.id});publication.published=false;renderPublication();status('ยกเลิกเผยแพร่แล้ว ฉบับร่างยังอยู่');
 });
 function renderResearch(value){
  research=value||null;const panel=$('research-panel'),root=$('research-content');root.replaceChildren();panel.hidden=!research;if(!research)return;
  const add=(heading,text)=>{const h=document.createElement('h3'),p=document.createElement('p');h.textContent=heading;p.textContent=text;p.style.whiteSpace='pre-wrap';root.append(h,p);};
  add('คำค้นและเวลาที่ค้น',research.keyword+' · '+localTime(research.checkedAt));add('Intent',research.intent);add('ผู้อ่าน',research.audience);
  for(const [key,label] of [['mustCover','ประเด็นที่ควรตอบ'],['gaps','มุมที่เสนอให้ขยาย'],['questions','คำถามที่เสนอ']])add(label,(research[key]||[]).join('\n'));
  add('โครงบทความ',research.outline);add('ความเกี่ยวข้องกับสินค้า',research.productFit);
  const h=document.createElement('h3');h.textContent='แหล่งข้อมูลที่ค้นพบ';root.append(h);
  for(const source of research.sources||[]){const p=document.createElement('p'),a=document.createElement('a');a.href=source.url;a.textContent=source.title||source.url;a.target='_blank';a.rel='noopener noreferrer';p.append(a);root.append(p);}
 }
 $('apply-research').onclick=()=>{
  if(!research)return;const form=$('writer-brief');if(form.elements.keyword.value.trim()!==research.keyword){status('คำค้นเปลี่ยนแล้ว กรุณาวิเคราะห์คำค้นใหม่',true);return;}
  if(form.elements.outline.value.trim()&&!confirm('แทนโครงบทความที่กรอกไว้ด้วยผลวิเคราะห์นี้?'))return;
  form.elements.intent.value=research.intent;form.elements.outline.value=research.outline;markDirty();status('ใส่ Intent และโครงบทความแล้ว พร้อมสร้างบทความ');
 };
 function previewHTML(title,content){return '<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https://verdeloopthailand.com '+location.origin+'; style-src \'unsafe-inline\'"><style>body{font-family:system-ui,sans-serif;max-width:760px;margin:24px auto;padding:0 20px;color:#183b2d;line-height:1.9;overflow-wrap:anywhere}img{max-width:100%;height:auto}h1,h2,h3{line-height:1.5}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px}</style><h1>'+escape(title)+'</h1>'+content+'</html>';}
 async function handleJob(job){
  if(job.status==='failed')throw Error(job.error||'งานนี้ไม่สำเร็จ');
  if(job.status==='running'){status('งานยังประมวลผลอยู่ รอสักครู่แล้วกดดูผลอีกครั้ง');return;}
  if(job.result?.type==='research'){
   renderResearch(job.result);status('วิเคราะห์แล้ว ตรวจ Intent และแหล่งข้อมูลด้านล่างก่อนนำโครงบทความไปใช้');
  }else if(job.kind==='article'){
   candidate=job.result;const counted=document.createElement('div');counted.innerHTML=candidate.content;$('candidate-count').textContent=countLabel(counted.textContent);$('candidate-title').textContent=candidate.title;$('candidate-preview').srcdoc=previewHTML(candidate.title,candidate.content);$('writer-candidate').hidden=false;
   $('image-suggestions').replaceChildren();for(const [i,prompt] of [candidate.coverPrompt,...(candidate.imagePrompts||[])].filter(Boolean).entries()){const b=document.createElement('button');b.type='button';b.textContent=i===0?'แนวภาพปก':'แนวภาพประกอบ '+i;b.onclick=()=>{$('image-prompt').value=prompt;};$('image-suggestions').append(b);}
   if(candidate.coverPrompt)$('image-prompt').value=candidate.coverPrompt;
   status('สร้างบทความแล้ว ตรวจฉบับที่ AI เสนอก่อนกดใช้');
  }else{const v=await get('draft',{id:draft.id});images=v.images;renderImages();const currentSlug=$('publication-slug').value;renderPublication();if(!publication)$('publication-slug').value=currentSlug;status('บันทึกภาพพร้อมโลโก้แล้ว');}
  const v=await get('draft',{id:draft.id});renderHistory(v);
 }
 async function generate(kind,mode){status(mode==='research'?'กำลังบันทึกและค้นเว็บ…':'กำลังบันทึกแนวทางบทความ…');await save();const jobId=crypto.randomUUID();status(mode==='research'?'กำลังค้นเว็บและวิเคราะห์ Intent… อาจใช้เวลา 1–3 นาที':'กำลังสร้าง'+(kind==='article'?'บทความ':'ภาพ')+'… อาจใช้เวลา 1–3 นาที');try{const r=await api('writer_generate',{id:draft.id,jobId,kind,mode,prompt:$('image-prompt').value});await handleJob(r.job);}catch(e){const v=await get('draft',{id:draft.id}).catch(()=>null);if(v)renderHistory(v);throw e;}}
 $('research-keyword').onclick=()=>run(()=>generate('article','research'));
 $('generate-article').onclick=()=>run(()=>generate('article'));$('generate-cover').onclick=()=>run(()=>generate('cover'));$('generate-inline').onclick=()=>run(()=>generate('inline'));
 $('apply-article').onclick=()=>{if(!candidate)return;if(editor.textContent.trim()&&!confirm('ใช้ฉบับ AI แทนเนื้อหาในช่องแก้ไข? เวอร์ชันที่บันทึกแล้วยังอยู่ในประวัติ'))return;$('article-title').value=candidate.title;$('article-description').value=candidate.description;editor.innerHTML=candidate.content;markDirty();status('นำฉบับ AI มาแก้ไขแล้ว กดบันทึกเมื่อพร้อม');};
 function renderImages(){
  $('writer-images').replaceChildren();for(const im of images){const card=document.createElement('div'),img=document.createElement('img');img.src=imageURL(im.id);img.alt=im.alt;img.loading='lazy';const name=document.createElement('p');name.textContent=(im.kind==='cover'?'ภาพปก':'ภาพประกอบ')+' · '+localTime(im.created_at);const a=document.createElement('a');a.href=imageURL(im.id)+'&download=1';a.textContent='ดาวน์โหลดภาพพร้อมโลโก้';const actions=document.createElement('div');actions.className='writer-actions';actions.append(a);if(im.kind==='inline'){const b=document.createElement('button');b.type='button';b.textContent='แทรกท้ายบทความ';b.onclick=()=>{const figure=document.createElement('figure'),picture=document.createElement('img');picture.src=imageURL(im.id);picture.alt=im.alt;figure.append(picture);editor.append(figure);markDirty();status('แทรกภาพแล้ว กดบันทึกฉบับร่าง');};actions.append(b);}card.append(img,name,actions);$('writer-images').append(card);}
 }
 $('preview-draft').onclick=()=>run(async()=>{await save();const cover=images.find(i=>i.kind==='cover');$('draft-preview').querySelector('iframe').srcdoc=previewHTML(draft.title,(cover?'<img src="'+imageURL(cover.id)+'" alt="'+escape(cover.alt)+'">':'')+draft.content);$('draft-preview').showModal();});$('close-preview').onclick=()=>$('draft-preview').close();
 loadModels().catch(()=>{$('model-status').textContent='โหลดรายชื่อยังไม่ได้ กดโหลดใหม่ได้';});
 if(initial.config.configured)status('พร้อมสร้างฉบับร่างใหม่ หรือเลือกบทความเดิม');
})();
