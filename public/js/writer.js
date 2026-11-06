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
 const markDirty=()=>{dirty=true;updateCount();$('save-status').textContent='มีการแก้ไขที่ยังไม่บันทึก';updateSEO();scheduleLinks();};
 ['article-title','article-description','article-editor','writer-brief','seo-title','publication-slug'].forEach(id=>$(id).addEventListener('input',markDirty));
 document.querySelectorAll('[form=writer-brief]').forEach(el=>el.addEventListener('input',markDirty));
 window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
 editor.addEventListener('paste',e=>{e.preventDefault();document.execCommand('insertText',false,e.clipboardData.getData('text/plain'));});
 document.querySelectorAll('[data-format],[data-block]').forEach(b=>b.addEventListener('mousedown',e=>{e.preventDefault();editor.focus();document.execCommand(b.dataset.format||'formatBlock',false,b.dataset.block||null);markDirty();}));
 const brief=()=>Object.fromEntries(new FormData($('writer-brief')));
 async function refreshList(id){const v=await get('list');$('draft-picker').replaceChildren(new Option('เลือกฉบับร่าง',''),...v.drafts.map(d=>new Option(d.title||'ยังไม่ได้ตั้งชื่อ',d.id)));$('draft-picker').value=id||'';}
 function fillContent(d){$('article-title').value=d.title||'';$('article-description').value=d.description||'';$('seo-title').value=d.seo_title||'';editor.innerHTML=d.content||'';for(const el of $('writer-brief').elements)if(el.name)el.value=d.brief?.[el.name]||(el.name==='productMode'?'editorial':'');renderFAQ(Array.isArray(d.faq)?d.faq:[]);relatedChecked=new Set(Array.isArray(d.related)?d.related:[]);updateCount();updateSEO();scheduleLinks();}
 async function load(id){const v=await get('draft',{id});draft=v.draft;images=v.images;fillContent(draft);dirty=false;$('save-status').textContent='บันทึกล่าสุด '+localTime(draft.updated_at);$('writer-workspace').hidden=false;$('writer-candidate').hidden=true;renderImages();renderHistory(v);renderResearch(v.research);publication=v.publication;renderPublication();renderRelatedPicker();renderLinks();}
 function renderHistory(v){
  $('writer-revisions').replaceChildren();for(const rev of v.revisions){const row=document.createElement('div');row.className='writer-history';row.textContent='รุ่น '+rev.version+' · '+localTime(rev.created_at);const b=document.createElement('button');b.type='button';b.textContent='นำมาแก้ไข';b.onclick=()=>run(async()=>{if(dirty&&!confirm('แทนที่ข้อความที่ยังไม่บันทึกด้วยเวอร์ชันนี้?'))return;const old=await get('revision',{id:rev.id});fillContent(old.draft);markDirty();status('โหลดเวอร์ชันก่อนหน้าแล้ว กดบันทึกเพื่อใช้ฉบับนี้');});row.append(b);$('writer-revisions').append(row);}
  $('writer-jobs').replaceChildren();for(const job of v.jobs){const row=document.createElement('div');row.className='writer-history';row.textContent=(job.operation==='research'?'SERP Spy':({article:'บทความ',cover:'ภาพปก',inline:'ภาพประกอบ'})[job.kind])+' · '+({running:'กำลังสร้าง',done:'สำเร็จ',failed:'ไม่สำเร็จ'})[job.status]+' · '+localTime(job.created_at);const b=document.createElement('button');b.type='button';b.textContent='ดูผล';b.onclick=()=>run(async()=>handleJob((await get('job',{id:job.id})).job));row.append(b);$('writer-jobs').append(row);}
 }
 async function save(){if(!draft)throw Error('สร้างหรือเลือกฉบับร่างก่อน');const snapshot={title:$('article-title').value,description:$('article-description').value,content:editor.innerHTML,brief:brief(),seoTitle:$('seo-title').value.trim(),faq:collectFAQ(),related:collectRelated()};const r=await api('writer_save',{id:draft.id,version:draft.version,...snapshot});draft=r.draft;dirty=JSON.stringify(snapshot)!==JSON.stringify({title:$('article-title').value,description:$('article-description').value,content:editor.innerHTML,brief:brief(),seoTitle:$('seo-title').value.trim(),faq:collectFAQ(),related:collectRelated()});if(!dirty)editor.innerHTML=draft.content;$('save-status').textContent=dirty?'มีการแก้ไขใหม่ที่ยังไม่บันทึก':'บันทึกแล้ว '+localTime(draft.updated_at);await refreshList(draft.id);return draft;}
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
  updateSEO();
 }
 $('publish-article').onclick=()=>run(async()=>{
  const slug=$('publication-slug').value.trim()||slugFromTitle($('article-title').value),coverId=$('publication-cover').value;
  $('publication-status').textContent='กำลังบันทึกและเผยแพร่…';
  try{await save();const r=await api('writer_publish',{id:draft.id,version:draft.version,slug,coverId,relatedSlugs:collectRelated()});publication={...r.publication,cover_id:coverId};renderPublication();loadPublished();status('เผยแพร่แล้ว เปิดดูบทความบนเว็บได้');}
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
 async function shrinkImage(file){
  const bitmap=await createImageBitmap(file).catch(()=>null);if(!bitmap)throw Error('เปิดไฟล์ภาพไม่ได้ ลองบันทึกเป็น PNG JPG หรือ WebP ก่อน');
  const scale=Math.min(1,2200/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
  const url=canvas.toDataURL('image/webp',0.9);if(url.length>4300000)throw Error('ภาพยังใหญ่เกินไปหลังย่อ กรุณาครอปหรือลดความละเอียดก่อน');
  return url;
 }
 $('upload-image').onclick=()=>run(async()=>{
  const file=$('upload-file').files[0];if(!file)throw Error('เลือกไฟล์ภาพก่อน');
  if(!/^image\/(png|jpe?g|webp)$/.test(file.type))throw Error('รองรับเฉพาะไฟล์ PNG JPG และ WebP');
  if(!draft)throw Error('สร้างหรือเลือกฉบับร่างก่อน');
  status('กำลังย่อภาพและอัปโหลด…');
  const image=await shrinkImage(file);
  await api('writer_upload',{id:draft.id,kind:$('upload-kind').value,image,alt:$('upload-alt').value});
  const v=await get('draft',{id:draft.id});images=v.images;renderImages();const currentSlug=$('publication-slug').value;renderPublication();if(!publication)$('publication-slug').value=currentSlug;
  $('upload-file').value='';$('upload-alt').value='';
  status('อัปโหลดภาพแล้ว เลือกเป็นภาพปกหรือกดแทรกในบทความได้เลย');
 });
 $('apply-article').onclick=()=>{if(!candidate)return;if(editor.textContent.trim()&&!confirm('ใช้ฉบับ AI แทนเนื้อหาในช่องแก้ไข? เวอร์ชันที่บันทึกแล้วยังอยู่ในประวัติ'))return;$('article-title').value=candidate.title;$('article-description').value=candidate.description;$('seo-title').value=candidate.seoTitle||'';editor.innerHTML=candidate.content;renderFAQ(Array.isArray(candidate.faq)?candidate.faq:[]);markDirty();status('นำฉบับ AI มาแก้ไขแล้ว ตรวจลิสต์ SEO ด้านล่างก่อนบันทึก');};
 function renderImages(){
  $('writer-images').replaceChildren();for(const im of images){const card=document.createElement('div'),img=document.createElement('img');img.src=imageURL(im.id);img.alt=im.alt;img.loading='lazy';const name=document.createElement('p');name.textContent=(im.kind==='cover'?'ภาพปก':'ภาพประกอบ')+(im.prompt==='อัปโหลดโดยผู้ดูแล'?' · อัปโหลด':' · สร้างด้วย AI')+' · '+localTime(im.created_at);const a=document.createElement('a');a.href=imageURL(im.id)+'&download=1';a.textContent='ดาวน์โหลดภาพพร้อมโลโก้';const actions=document.createElement('div');actions.className='writer-actions';actions.append(a);if(im.kind==='inline'){const b=document.createElement('button');b.type='button';b.textContent='แทรกท้ายบทความ';b.onclick=()=>{const figure=document.createElement('figure'),picture=document.createElement('img');picture.src=imageURL(im.id);picture.alt=im.alt;figure.append(picture);editor.append(figure);markDirty();status('แทรกภาพแล้ว กดบันทึกฉบับร่าง');};actions.append(b);}card.append(img,name,actions);$('writer-images').append(card);}
 }
 $('preview-draft').onclick=()=>run(async()=>{await save();const cover=images.find(i=>i.kind==='cover');const faqs=collectFAQ().filter(f=>f.q&&f.a);const faqHtml=faqs.length?'<h2>คำถามที่พบบ่อย</h2>'+faqs.map(f=>'<p><strong>'+escape(f.q)+'</strong><br>'+escape(f.a)+'</p>').join(''):'';$('draft-preview').querySelector('iframe').srcdoc=previewHTML(draft.title,(cover?'<img src="'+imageURL(cover.id)+'" alt="'+escape(cover.alt)+'">':'')+draft.content+faqHtml);$('draft-preview').showModal();});$('close-preview').onclick=()=>$('draft-preview').close();

 // ---- ลิงก์ภายใน: เสนอจากคำที่พบในเนื้อหา + บทความที่เผยแพร่แล้ว ----
 const INTERNAL_TARGETS=[
  {href:'/sugarcane-straw/',label:'หน้าสินค้าหลอดชานอ้อย',terms:['หลอดชานอ้อย','หลอดชานอ้อย ราคาส่ง']},
  {href:'/paper-straw-problem/',label:'ปัญหาหลอดกระดาษเปื่อย',terms:['หลอดกระดาษเปื่อย','เปื่อยยุ่ย','หลอดกระดาษ']},
  {href:'/compare/',label:'ตารางเทียบชานอ้อย กระดาษ PLA',terms:['เปรียบเทียบหลอด','หลอด PLA','PLA']},
  {href:'/esg/',label:'คาร์บอนฟุตพริ้นต์และ ESG',terms:['คาร์บอนฟุตพริ้นต์','ESG','คาร์บอน']},
  {href:'/sample/',label:'ขอตัวอย่างฟรี',terms:['ขอตัวอย่างฟรี','ตัวอย่างฟรี','ขอตัวอย่าง']},
  {href:'/faq/',label:'คำถามที่พบบ่อยของทางร้าน',terms:['คำถามที่พบบ่อย']}
 ];
 const articleHref=slug=>'/articles/'+encodeURIComponent(slug)+'/';
 let publishedArticles=[];
 function linkTerm(term,href){
  const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);
  for(let node=walker.nextNode();node;node=walker.nextNode()){
   const at=node.data.indexOf(term);if(at<0)continue;
   const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+term.length);
   editor.focus();const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
   document.execCommand('createLink',false,href);markDirty();status('ลิงก์คำ "'+term+'" เรียบร้อย');renderLinks();return;
  }
  status('ไม่พบคำ "'+term+'" ในเนื้อหาอีก อาจถูกลบไปแล้ว',true);
 }
 function renderLinks(){
  const root=$('link-suggestions');root.replaceChildren();if(!draft)return;
  const html=editor.innerHTML,text=editor.textContent||'';
  const suggestions=[];
  for(const target of INTERNAL_TARGETS){
   if(html.includes('href="'+target.href))continue;
   const term=target.terms.find(t=>text.includes(t));
   if(term)suggestions.push({label:'ลิงก์คำ "'+term+'" → '+target.label,run:()=>linkTerm(term,target.href)});
  }
  for(const art of publishedArticles){
   if(publication?.slug===art.slug||html.includes('href="'+articleHref(art.slug)))continue;
   suggestions.push({label:'บทความ: '+art.title,run:()=>{
    editor.focus();
    const sel=getSelection();
    if(sel.rangeCount&&editor.contains(sel.anchorNode)&&String(sel).trim())document.execCommand('createLink',false,articleHref(art.slug));
    else document.execCommand('insertHTML',false,'<a href="'+articleHref(art.slug)+'">'+escape(art.title)+'</a>');
    markDirty();status('ใส่ลิงก์บทความแล้ว');renderLinks();
   }});
  }
  if(!suggestions.length)return;
  const note=document.createElement('p');note.className='muted sugg-note';note.textContent='ลิงก์ภายในที่แนะนำ (กดแล้วระบบลิงก์ให้เอง — เลือกข้อความในบทความก่อนกด หากต้องการกำหนดเอง):';root.append(note);
  for(const item of suggestions.slice(0,12)){
   const chip=document.createElement('button');chip.type='button';chip.className='sugg-chip';chip.textContent=item.label;
   chip.addEventListener('mousedown',e=>e.preventDefault());
   chip.onclick=()=>item.run();root.append(chip);
  }
 }
 let linkTimer=0;const scheduleLinks=()=>{clearTimeout(linkTimer);linkTimer=setTimeout(renderLinks,600);};

 // ---- ไดอะล็อกลิงก์และตาราง (เก็บตำแหน่ง cursor ระหว่างเปิดป้าย) ----
 let savedRange=null;
 const saveSel=()=>{const sel=getSelection();savedRange=sel.rangeCount&&editor.contains(sel.anchorNode)?sel.getRangeAt(0).cloneRange():null;};
 const restoreSel=()=>{editor.focus();if(savedRange){const sel=getSelection();sel.removeAllRanges();sel.addRange(savedRange);}};
 const keepSel=id=>$(id).addEventListener('mousedown',e=>e.preventDefault());
 keepSel('insert-link');keepSel('insert-table');
 $('insert-link').onclick=()=>{saveSel();$('link-text').value=savedRange&&!savedRange.collapsed?String(savedRange):'';$('link-url').value='';$('link-dialog').showModal();$('link-url').focus();};
 $('insert-table').onclick=()=>{saveSel();$('table-dialog').showModal();$('table-rows').focus();};
 $('link-cancel').onclick=()=>$('link-dialog').close();$('table-cancel').onclick=()=>$('table-dialog').close();
 $('link-apply').onclick=()=>{
  const url=$('link-url').value.trim(),text=$('link-text').value.trim();
  if(!url){$('link-url').focus();return;}
  const href=url.startsWith('/')?url:(url.startsWith('https://')||url.startsWith('http://'))?url:null;
  if(!href){status('URL ต้องขึ้นต้นด้วย / (หน้าในเว็บ) หรือ https://',true);return;}
  $('link-dialog').close();restoreSel();
  if(savedRange&&!savedRange.collapsed&&String(savedRange).trim()===text)document.execCommand('createLink',false,href);
  else document.execCommand('insertHTML',false,'<a href="'+escape(href)+'">'+escape(text||href)+'</a>');
  markDirty();status('ใส่ลิงก์แล้ว');
 };
 $('table-apply').onclick=()=>{
  const rows=Math.min(30,Math.max(2,Number($('table-rows').value)||4)),cols=Math.min(8,Math.max(2,Number($('table-cols').value)||3));
  let html='<table><thead><tr><th>หัวข้อ</th>'+Array.from({length:cols-1},(_,i)=>'<th>คอลัมน์ '+(i+1)+'</th>').join('')+'</tr></thead><tbody>';
  for(let r=1;r<rows;r++)html+='<tr><td>แถว '+r+'</td>'+Array.from({length:cols-1},()=>'<td>&nbsp;</td>').join('')+'</tr>';
  html+='</tbody></table><p>&nbsp;</p>';
  $('table-dialog').close();restoreSel();document.execCommand('insertHTML',false,html);markDirty();status('ใส่ตารางแล้ว คลิกที่ช่องเพื่อพิมพ์ กด Tab เลื่อนช่อง');
 };

 // ---- FAQ ----
 function addFAQRow(item={}){
  const row=document.createElement('div');row.className='faq-row';
  const q=document.createElement('input');q.maxLength=300;q.placeholder='คำถาม เช่น หลอดชานอ้อยแช่น้ำได้นานกี่ชั่วโมง';q.value=item.q||'';
  const a=document.createElement('textarea');a.rows=3;a.maxLength=1000;a.placeholder='คำตอบสั้น 2–4 ประโยค ตอบตรงคำถาม';a.value=item.a||'';
  const x=document.createElement('button');x.type='button';x.className='faq-remove';x.textContent='ลบ';x.onclick=()=>{row.remove();markDirty();};
  q.addEventListener('input',markDirty);a.addEventListener('input',markDirty);
  row.append(q,a,x);$('faq-list').append(row);
 }
 function renderFAQ(list){$('faq-list').replaceChildren();for(const item of (list&&list.length?list:[{q:'',a:''}]))addFAQRow(item);}
 const collectFAQ=()=>[...$('faq-list').querySelectorAll('.faq-row')].map(row=>({q:row.querySelector('input').value.trim(),a:row.querySelector('textarea').value.trim()})).filter(f=>f.q||f.a);
 $('faq-add').onclick=()=>{if(collectFAQ().length>=8){status('FAQ เก็บได้สูงสุด 8 ข้อ',true);return;}addFAQRow();markDirty();};
 $('faq-import').onclick=()=>{
  if(!research?.questions?.length){status('ยังไม่มีผล SERP Spy ของคำค้นนี้ กดวิเคราะห์คำค้นก่อน',true);return;}
  const have=new Set(collectFAQ().map(f=>f.q));let added=0;
  for(const q of research.questions){
   if(collectFAQ().length>=8)break;
   if(have.has(q))continue;
   addFAQRow({q,a:''});have.add(q);added++;
  }
  if(added)markDirty();
  status(added?'เพิ่ม '+added+' คำถามจาก SERP Spy แล้ว กรอกคำตอบให้ครบก่อนเผยแพร่':'คำถามจาก SERP Spy อยู่ในรายการแล้วทั้งหมด');
 };

 // ---- บทความที่เกี่ยวข้อง ----
 let relatedChecked=new Set();
 function renderRelatedPicker(){
  const root=$('related-picker');root.replaceChildren();
  if(!publishedArticles.length){const p=document.createElement('p');p.className='muted';p.textContent='ยังไม่มีบทความที่เผยแพร่แล้วให้เลือก — เผยแพร่บทความแรกก่อน แล้วบทความถัดไปจะมีรายชื่อมาให้เลือก';root.append(p);return;}
  for(const art of publishedArticles){
   const label=document.createElement('label'),box=document.createElement('input'),span=document.createElement('span');
   box.type='checkbox';box.checked=relatedChecked.has(art.slug);span.textContent=art.title;
   box.addEventListener('change',()=>{box.checked?relatedChecked.add(art.slug):relatedChecked.delete(art.slug);markDirty();});
   label.append(box,span);root.append(label);
  }
 }
 const collectRelated=()=>[...relatedChecked].filter(slug=>publication?.slug!==slug);
 async function loadPublished(){try{publishedArticles=(await get('published')).articles;}catch{publishedArticles=[];}if(draft){renderRelatedPicker();renderLinks();}}
 loadPublished();

 // ---- ตรวจ SEO + ตัวอย่างหน้าผลค้นหา ----
 function updateSEO(){
  const keyword=($('writer-brief').elements.keyword.value||'').trim();
  const title=$('seo-title').value.trim()||$('article-title').value.trim();
  const desc=$('article-description').value.trim();
  const slug=$('publication-slug').value.trim();
  const text=(editor.textContent||'').replace(/\s+/g,' ').trim();
  $('seo-title-count').textContent=(title?Array.from(title).length:0)+' ตัวอักษร · แนะนำไม่เกิน 70'+(Array.from(title).length>70?' (ตอนนี้ยาวเกิน)':'');
  $('serp-url').textContent='verdeloopthailand.com › articles › '+(slug||'…');
  $('serp-title').textContent=title||'ชื่อบทความจะแสดงที่นี่';
  $('serp-desc').textContent=desc||'คำอธิบาย SEO จะแสดงที่นี่';
  const checks=[],chip=(ok,label)=>checks.push({ok,label});
  if(keyword){
   chip(title.includes(keyword),'คำค้นอยู่ใน Title');
   chip(!!slug&&slug.includes(slugFromTitle(keyword)),'คำค้นอยู่ใน URL');
   chip(text.slice(0,120).includes(keyword),'คำค้นอยู่ใน 120 ตัวอักษรแรก');
  }
  chip(desc.length>=80&&desc.length<=160,'คำอธิบาย 80–160 ตัวอักษร (ตอนนี้ '+desc.length+')');
  chip(editor.querySelectorAll('h2').length>=3,'มี H2 อย่างน้อย 3 หัวข้อ');
  chip(editor.querySelectorAll('table,ul,ol').length>=1,'มีตารางหรือรายการ');
  chip(collectFAQ().filter(f=>f.q&&f.a).length>=3,'FAQ ครบ 3 ข้อขึ้นไป');
  chip(editor.querySelectorAll('a[href^="/"]').length>=1,'มีลิงก์ภายในอย่างน้อย 1 จุด');
  chip(!!$('publication-cover').value,'เลือกภาพปกแล้ว');
  $('seo-checklist').replaceChildren(...checks.map(c=>{const s=document.createElement('span');s.className=c.ok?'ok':'miss';s.textContent=(c.ok?'✓ ':'· ')+c.label;return s;}));
 }
 updateSEO();

 loadModels().catch(()=>{$('model-status').textContent='โหลดรายชื่อยังไม่ได้ กดโหลดใหม่ได้';});
 if(initial.config.configured)status('พร้อมสร้างฉบับร่างใหม่ หรือเลือกบทความเดิม');
})();
