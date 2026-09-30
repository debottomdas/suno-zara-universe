import {NextResponse} from 'next/server';
import OpenAI from 'openai';
import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {resolveLocalPath} from '@/utils/media-source';
import {createClient} from '@/utils/supabase/server';
import {emptyWorkspace,makeSlots,proposePlan,validatePlan,approvedCandidate,type CreativeWorkspace,type VisualSlot} from '@/utils/creative/model';
export const runtime='nodejs';
export const maxDuration=300;
const bucket='song-media';
const text=(x:unknown,max=12000)=>String(x??'').trim().slice(0,max);
async function context(projectId:string){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)throw Error('Sign in to continue.');
 const {data:song,error}=await db.from('songs').select('id,user_id,channel_id,title,lyrics,idea,language,mood,genre').eq('id',projectId).eq('user_id',user.id).single();if(error||!song)throw Error('Song not found.');
 const {data:row,error:loadError}=await db.from('song_creative_workspaces').select('*').eq('song_id',projectId).eq('user_id',user.id).maybeSingle();if(loadError)throw Error(`Creative workspace unavailable: ${loadError.message}`);
 return {db,user,song,row,w:(row?{...row.workspace,revision:row.revision}:emptyWorkspace()) as CreativeWorkspace};
}
async function response(c:Awaited<ReturnType<typeof context>>){
 const w=structuredClone(c.w);
 const candidates=w.slots.flatMap(s=>s.candidates);
 if(candidates.length){const {data,error}=await c.db.storage.from(bucket).createSignedUrls(candidates.map(a=>a.storagePath),3600);if(error)throw Error(error.message);for(const a of candidates){const signed=data?.find(x=>x.path===a.storagePath);if(!signed?.signedUrl||signed.error)throw Error(signed?.error||'Image preview unavailable.');a.url=signed.signedUrl;}}
 return NextResponse.json({workspace:w});
}
export async function GET(req:Request){try{return await response(await context(new URL(req.url).searchParams.get('projectId')||''));}catch(e){return failure(e);}}
function failure(e:unknown){return NextResponse.json({error:e instanceof Error?e.message:'Creative workspace request failed.'},{status:400});}
export async function POST(req:Request){
 try{
  const multipart=req.headers.get('content-type')?.includes('multipart/form-data');const form=multipart?await req.formData():null;
  const body=form?Object.fromEntries(form.entries()):await req.json();const c=await context(text(body.projectId));const {db,user,song,w}=c;
  if(Number(body.revision)!==w.revision)throw Error('This workspace changed in another window. Reload before editing.');
  const slot=w.slots.find(s=>s.id===body.slotId);const action=text(body.action);
  if(w.pending&&action!=='clear-interrupted')throw Error('An image or direction request is still reserved. Wait, or explicitly clear an interrupted request; never retry a paid call automatically.');
  async function save(){
   const clean=structuredClone(w);clean.slots.forEach(s=>s.candidates.forEach(a=>delete a.url));
   const revision=w.revision+1; const values={workspace:clean,revision,updated_at:new Date().toISOString()};
   const q=c.row?db.from('song_creative_workspaces').update(values).eq('song_id',song.id).eq('user_id',user.id).eq('revision',w.revision):db.from('song_creative_workspaces').insert({...values,song_id:song.id,user_id:user.id});
   const {data,error}=await q.select('revision').single();if(error||!data)throw Error('Workspace changed or could not be saved. Reload before continuing.');w.revision=revision;
  }
  async function addImage(bytes:Buffer,target:VisualSlot,source:'generated'|'uploaded'|'derived',prompt:string){
   const dims=target.kind==='cover'?[3000,3000]:target.kind==='short'?[1080,1920]:[1920,1080];
   const image=await sharp(bytes,{limitInputPixels:80_000_000}).rotate().resize(dims[0],dims[1],{fit:'cover'}).png().toBuffer();
   const id=crypto.randomUUID(),storagePath=`${user.id}/${song.id}/creative/${target.id}/${id}.png`;
   const {error}=await db.storage.from(bucket).upload(storagePath,image,{contentType:'image/png',upsert:false});if(error)throw Error(error.message);
   target.candidates.push({id,storagePath,source,prompt,createdAt:new Date().toISOString(),width:dims[0],height:dims[1]});
  }
  if(action==='clear-interrupted'){
   if(!w.pending||Date.now()-new Date(w.pending.startedAt).getTime()<10*60*1000)throw Error('Wait at least ten minutes before clearing an interrupted request.');delete w.pending;
  }else if(action==='setup'){
   const duration=Number(body.duration);if(!Number.isFinite(duration)||duration<8||duration>3600)throw Error('Choose final audio between 8 seconds and 60 minutes.');
   if(w.slots.length)throw Error('Workspace already exists. Existing versions are preserved.');
   w.slots=makeSlots(duration,song.lyrics||'');w.audioKey=text(body.audioKey);w.instructions=text(body.instructions);
  }else if(action==='direction'){
   if(w.instructions!==text(body.instructions))delete w.approvedBible;w.instructions=text(body.instructions);w.bible=text(body.bible);if(body.approve===true){if(!w.bible)throw Error('Write or propose a visual direction first.');w.approvedBible=w.bible;}
  }else if(action==='propose-direction'){
   // Reserve this revision before a paid call; concurrent submissions cannot both spend.
   w.pending={id:crypto.randomUUID(),startedAt:new Date().toISOString(),action};await save();c.row={revision:w.revision};
   const started=Date.now();const ai=new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0});
   const out=await ai.responses.create({model:'gpt-5.6-luna',input:`Propose an editable visual direction / Character and World Bible for this song. Cover story, consistent characters/appearance, wardrobe, locations, mood, palette, lighting, cinematography, realism, continuity and things to avoid. User direction is optional; blank means decide. No image generation. Do not claim precise audio/lyric alignment. Song: ${song.title}\nCreator context: ${song.idea || "Not supplied"}\nLanguage: ${song.language}\nMood: ${song.mood || "Not supplied"}\nMusical direction: ${song.genre || "Not supplied"}\nLyrics (optional): ${song.lyrics || "Not supplied"}\nInstructions: ${w.instructions}\nAudio duration/energy summary: ${JSON.stringify(w.analysis||{})}\nCreate a specific scene prompt for every supplied slot, with distinct narrative beats and consistent characters. Return strict JSON only: {"bible":"editable prose","prompts":[{"slotId":"id","prompt":"specific image prompt"}]}. Required slots: ${JSON.stringify(w.slots.map(s=>({id:s.id,label:s.label,kind:s.kind})))}`});
   const {error}=await db.from('ai_usage_events').insert({user_id:user.id,channel_id:song.channel_id,song_id:song.id,feature:'visual-direction',provider:'openai',model:'gpt-5.6-luna',input_tokens:out.usage?.input_tokens,output_tokens:out.usage?.output_tokens,total_tokens:out.usage?.total_tokens,duration_ms:Date.now()-started,metadata:{usage:out.usage}});if(error)throw Error(`Direction generated, but usage logging failed: ${error.message}`);
   const proposed=JSON.parse(out.output_text.replace(/^```(?:json)?\s*|\s*```$/g,''));if(typeof proposed.bible!=='string'||!text(proposed.bible)||!Array.isArray(proposed.prompts)||w.slots.some(s=>!proposed.prompts.some((p:{slotId:string;prompt:string})=>p.slotId===s.id&&typeof p.prompt==='string')))throw Error('Direction response was incomplete; do not automatically retry the paid request.');w.bible=text(proposed.bible);w.slots.forEach(s=>s.prompt=text(proposed.prompts.find((p:{slotId:string})=>p.slotId===s.id).prompt));delete w.pending;
  }else if(action==='prompt'){
   if(!slot)throw Error('Unknown visual slot.');slot.prompt=text(body.prompt);
  }else if(action==='add-scene'){
   if(w.slots.filter(s=>s.kind==='scene').length>=32)throw Error('A maximum of 32 scenes is supported.');
   const n=Math.max(0,...w.slots.filter(s=>s.kind==='scene').map(s=>s.number))+1;w.slots.splice(w.slots.findIndex(s=>s.kind!=='scene'),0,{id:`scene-${n}`,kind:'scene',number:n,label:`Scene ${n}`,prompt:text(body.prompt)||`Scene ${n}: a distinct story beat.`,candidates:[]});if(w.analysis){const proposed=proposePlan(w.slots,w.analysis,song.lyrics||'');w.plan={...proposed,shorts:w.plan?.shorts||proposed.shorts};}
   }else if(action==='prepare-upload'){
   if(!slot||!['image/png','image/jpeg','image/webp'].includes(body.mimeType)||!Number.isFinite(body.size)||body.size<=0||body.size>20*1024*1024)throw Error('Choose a PNG, JPG or WEBP image up to 20 MB.');
   const storagePath=`${user.id}/${song.id}/creative-incoming/${crypto.randomUUID()}`;const {data,error}=await db.storage.from(bucket).createSignedUploadUrl(storagePath);if(error||!data)throw Error('Could not prepare image upload.');return NextResponse.json({upload:{storagePath,token:data.token,bucket}});
  }else if(action==='register-upload'){
   if(!slot||!String(body.storagePath).startsWith(`${user.id}/${song.id}/creative-incoming/`)||String(body.storagePath).includes('..'))throw Error('Invalid image upload.');
   const {data,error}=await db.storage.from(bucket).download(body.storagePath);if(error||!data||data.size>20*1024*1024)throw Error('Uploaded image unavailable or too large.');await addImage(Buffer.from(await data.arrayBuffer()),slot,'uploaded',slot.prompt);
  }else if(action==='derive'){
   if(!slot)throw Error('Unknown destination slot.');const original=w.slots.flatMap(s=>s.candidates).find(a=>a.id===body.candidateId);if(!original)throw Error('Choose an existing image version.');
   const {data,error}=await db.storage.from(bucket).download(original.storagePath);if(error||!data)throw Error('Source image unavailable.');await addImage(Buffer.from(await data.arrayBuffer()),slot,'derived',`Derived from ${original.id}; ${slot.prompt}`);
   }else if(action==='import-artwork'){
   if(!slot)throw Error('Unknown destination slot.');
   const {data:old,error}=await db.from('song_media_assets').select('*').eq('id',text(body.assetId)).eq('song_id',song.id).eq('user_id',user.id).single();if(error||!old||!['cover-art','thumbnail'].includes(old.media_kind))throw Error('Existing artwork not found.');
   let bytes:Buffer;if(old.storage_provider==='local'){bytes=await readFile(resolveLocalPath(old.local_path));}else{const {data,error}=await db.storage.from(bucket).download(old.storage_path);if(error||!data)throw Error('Existing artwork unavailable.');bytes=Buffer.from(await data.arrayBuffer());}await addImage(bytes,slot,'derived',`Reused existing ${old.media_kind}; ${slot.prompt}`);
  }else if(action==='import-image'){
   if(!slot)throw Error('Unknown destination slot.');
   const {data:old,error}=await db.from('song_images').select('storage_path,generation_prompt').eq('id',text(body.imageId)).eq('song_id',song.id).eq('user_id',user.id).single();if(error||!old)throw Error('Existing image not found.');
   const {data,error:downloadError}=await db.storage.from('song-images').download(old.storage_path);if(downloadError||!data)throw Error('Existing image unavailable.');await addImage(Buffer.from(await data.arrayBuffer()),slot,'derived',old.generation_prompt||slot.prompt);
  }else if(action==='generate'){
   if(!slot||!w.approvedBible||w.approvedBible!==w.bible)throw Error('Approve the current Visual Direction before paid image generation.');
   if(body.confirmPaid!==true)throw Error('Confirm paid image generation.');
   // Batch requests may only fill empty slots. Check again on the server before reserving/spending.
   if(body.missingOnly===true){
    if(slot.candidates.length)return await response(c);
    if(slot.kind==='cover'||slot.kind==='thumbnail'){
     const {data:existing,error}=await db.from('song_media_assets').select('id').eq('song_id',song.id).eq('user_id',user.id).eq('media_kind',slot.kind==='cover'?'cover-art':'thumbnail').eq('slot',1).maybeSingle();
     if(error)throw Error('Could not check existing artwork. Reload before generating.');
     if(existing)return await response(c);
    }
   }
   w.pending={id:crypto.randomUUID(),startedAt:new Date().toISOString(),action};await save();c.row={revision:w.revision};
   const started=Date.now();const ai=new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0});
   const prompt=`Approved character/world bible:\n${w.approvedBible}\nSong: ${song.title}\nCreator context: ${song.idea || "Not supplied"}\nLanguage: ${song.language}\nMood: ${song.mood || "Not supplied"}\nMusical direction: ${song.genre || "Not supplied"}\nLyrics (optional): ${song.lyrics || "Not supplied"}\nSlot: ${slot.label}\n${slot.prompt}\n${slot.kind==='short'?'9:16 portrait':slot.kind==='cover'?'Square cover artwork':'16:9 landscape'}. Maintain character and world continuity. No lettering, logos or watermark. One polished cinematic image.`;
   const out=await ai.images.generate({model:'gpt-image-2.5-flare',prompt,size:(slot.kind==='short'?'864x1536':slot.kind==='cover'?'1024x1024':'1536x864') as '1024x1024',quality:'medium',output_format:'png'});
   const {error}=await db.from('ai_usage_events').insert({user_id:user.id,channel_id:song.channel_id,song_id:song.id,feature:'creative-image',provider:'openai',model:'gpt-image-2.5-flare',input_tokens:out.usage?.input_tokens,output_tokens:out.usage?.output_tokens,total_tokens:out.usage?.total_tokens,duration_ms:Date.now()-started,metadata:{slotId:slot.id,usage:out.usage,quality:'medium'}});if(error)throw Error(`Image generated, but usage logging failed: ${error.message}`);
   if(!out.data?.[0]?.b64_json)throw Error('Image provider returned no image.');await addImage(Buffer.from(out.data[0].b64_json,'base64'),slot,'generated',prompt);delete w.pending;
  }else if(action==='approve-image'){
   if(!slot||!slot.candidates.some(a=>a.id===body.candidateId))throw Error('Image candidate not found.');slot.approvedId=body.candidateId;
  }else if(action==='analyse'){
   const a=body.analysis;if(!a||!Number.isFinite(a.duration)||a.duration<8||a.duration>3600||!Array.isArray(a.energy)||a.energy.length>3601||a.energy.some((e:{time:number;rms:number})=>!Number.isFinite(e.time)||!Number.isFinite(e.rms)||e.time<0||e.time>a.duration||e.rms<0))throw Error('Invalid audio analysis.');
   w.analysis=a;w.audioKey=text(a.sourceKey);w.plan=proposePlan(w.slots,a,song.lyrics||'');
  }else if(action==='plan'){
   w.plan={scenes:body.scenes,shorts:body.shorts,approved:false};validatePlan(w);
   // Timing approval does not require visuals for outputs supplied by the creator.
   // Each render still checks its own approved candidates and dependency key.
   if(body.approve===true)w.plan.approved=true;
  }else throw Error('Unknown creative action.');
  await save();
  if(action==='approve-image'&&slot&&(slot.kind==='cover'||slot.kind==='thumbnail')){
   const a=approvedCandidate(slot)!;const mediaKind=slot.kind==='cover'?'cover-art':'thumbnail';
   const canonicalPath=`${user.id}/${song.id}/${mediaKind}/${a.id}-approved.png`;
   const {data:existing}=await db.from('song_media_assets').select('storage_path').eq('song_id',song.id).eq('user_id',user.id).eq('media_kind',mediaKind).eq('slot',1).maybeSingle();
   if(existing?.storage_path!==canonicalPath){
    const {error:copyError}=await db.storage.from(bucket).copy(a.storagePath,canonicalPath);if(copyError&&!copyError.message.toLowerCase().includes('already exists'))throw Error(`Approval saved; release artwork copy needs retry: ${copyError.message}`);
    const {error:assetError}=await db.from('song_media_assets').upsert({song_id:song.id,user_id:user.id,media_kind:mediaKind,slot:1,original_filename:`${slot.label}.png`,storage_provider:'supabase',storage_path:canonicalPath,local_path:null,mime_type:'image/png',metadata:{width:a.width,height:a.height,creativeVersionId:a.id,approved:true},updated_at:new Date().toISOString()},{onConflict:'song_id,user_id,media_kind,slot'});if(assetError)throw Error(`Approval saved; release artwork registration failed: ${assetError.message}`);
   }
  }
  return await response(c);
 }catch(e){return failure(e);}
}
