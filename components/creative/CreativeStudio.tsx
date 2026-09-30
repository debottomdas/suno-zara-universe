'use client';
import {useEffect,useRef,useState} from 'react';
import {approvedCandidate,emptyWorkspace,outputKey,finalAudioKey,requiredVisualSlots,videoReadiness,renderPrerequisite,type CreativeWorkspace,type VisualSlot,type Timing} from '@/utils/creative/model';
import {visualBatchState,runVisualBatch} from '@/utils/creative/visual-batch';
import styles from './CreativeStudio.module.css';
import {createClient} from '@/utils/supabase/client';
const WORKER='http://127.0.0.1:47123';
type Existing={audio?:{id?:string;url?:string;updatedAt?:string;storagePath?:string;metadata?:{durationSeconds?:number}}|null;images:any[];artwork:any[];fullVideos:any[];shorts:any[]};
type Version={id:string;slot:number;source:string;fileUrl:string;filename:string;dependencyKey:string};
type Videos={versions:Version[];approved:Record<string,string>;keys:Record<string,string>;complete?:boolean};
const outputNames=['full',...Array.from({length:6},(_,i)=>`short-${i+1}`)];
async function json(url:string,options?:RequestInit){let r:Response;try{r=await fetch(url,options);}catch{throw Error(url.startsWith(WORKER)?'Your saved videos are temporarily unavailable. Reconnect and try again; your saved work and approvals are preserved.':'Cannot reach Universe. Check the connection and reload the saved workspace.');}const d=await r.json();if(!r.ok)throw Error(d.error||`Request failed (${r.status})`);return d;}
const post=(url:string,body:unknown)=>json(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export default function CreativeStudio({projectId,title,lyrics,stage,assets,onRefresh,onContinue,onNavigate}:{projectId:string;title:string;lyrics:string;stage:'Visuals'|'Video & Shorts';assets:Existing;onRefresh:()=>void;onContinue:()=>void;onNavigate:(stage:'Final Audio'|'Visuals')=>void}){
 const [w,setW]=useState<CreativeWorkspace>(emptyWorkspace);const [videos,setVideos]=useState<Videos>({versions:[],approved:{},keys:{}});
 const [videosReady,setVideosReady]=useState(false),[workerError,setWorkerError]=useState('');
 const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
 const operation=useRef(false),active=useRef(true);
 const [batchProgress,setBatchProgress]=useState<{action:string;complete:number;total:number}|null>(null),[batchNeedsReload,setBatchNeedsReload]=useState(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const [showCompleted,setShowCompleted]=useState(false);const [instructions,setInstructions]=useState(''),[bible,setBible]=useState('');const [planDraft,setPlanDraft]=useState<{scenes:Timing[];shorts:Timing[]}|null>(null);
 const audioKey=finalAudioKey(assets.audio);
 function accept(next:CreativeWorkspace){setW(next);setInstructions(next.instructions);setBible(next.bible);setPlanDraft(next.plan?{scenes:next.plan.scenes,shorts:next.plan.shorts}:null);}
 async function loadVideos(){try{const v=await json(`${WORKER}/creative/status?projectId=${encodeURIComponent(projectId)}`);setVideos(v);setVideosReady(true);setWorkerError('');return v as Videos;}catch(e){setWorkerError(e instanceof Error?e.message:'Local video worker unavailable.');throw e;}}
 useEffect(()=>{let active=true;setLoaded(false);setError('');json(`/api/creative-workspace?projectId=${encodeURIComponent(projectId)}`).then(d=>{if(active){accept(d.workspace);setLoaded(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[projectId]);
 useEffect(()=>{if(!loaded)return;let active=true;json(`${WORKER}/creative/status?projectId=${encodeURIComponent(projectId)}`).then(d=>{if(active){setVideos(d);setVideosReady(true);setWorkerError('');}}).catch(e=>{if(active)setWorkerError(e.message);});return()=>{active=false;};},[projectId,loaded]);
 async function sync(next:CreativeWorkspace){const keys=Object.fromEntries(outputNames.map((name,slot)=>[name,outputKey(next,slot,audioKey)]));await post(`${WORKER}/creative/sync`,{projectId,keys});await loadVideos();}
 async function run(label:string,fn:()=>Promise<void>){if(operation.current)return;operation.current=true;setBusy(label);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Operation failed.');}finally{operation.current=false;setBusy('');}}
 async function command(action:string,body:Record<string,unknown>={},revision=w.revision){
  const d=await post('/api/creative-workspace',{projectId,revision,action,...body});accept(d.workspace);return d.workspace as CreativeWorkspace;
 }
 async function change(action:string,body:Record<string,unknown>={}){const next=await command(action,body);try{await sync(next);}finally{onRefresh();}}
 async function setup(){let duration=assets.audio?.metadata?.durationSeconds||180;if(assets.audio?.url){duration=await new Promise<number>((resolve,reject)=>{const a=new Audio();a.preload='metadata';const timer=setTimeout(()=>reject(Error('Final audio metadata timed out.')),15000);a.onloadedmetadata=()=>{clearTimeout(timer);resolve(a.duration);};a.onerror=()=>{clearTimeout(timer);reject(Error('Final audio duration could not be read.'));};a.src=assets.audio!.url!;});}await change('setup',{duration,audioKey,instructions});}
 async function analyse(){
  if(!assets.audio?.url)throw Error('Upload final audio in the Final Audio stage first.');
  const r=await fetch(assets.audio.url);if(!r.ok)throw Error('Final audio could not be loaded.');const context=new AudioContext();
  try{const audio=await context.decodeAudioData(await r.arrayBuffer());const samples=audio.getChannelData(0),energy=[];
   for(let second=0;second<audio.duration;second++){let power=0,count=0;for(let i=Math.floor(second*audio.sampleRate);i<Math.min(samples.length,(second+1)*audio.sampleRate);i+=32){power+=samples[i]*samples[i];count++;}energy.push({time:second,rms:Math.sqrt(power/Math.max(1,count))});}
   await change('analyse',{analysis:{duration:audio.duration,sourceKey:audioKey,energy}});setMessage('Audio energy measured. Timings are suggestions: listen and adjust before approval.');
  }finally{await context.close();}
 }
 async function uploadImage(slot:VisualSlot,file:File){
  const {upload}=await post('/api/creative-workspace',{projectId,revision:w.revision,action:'prepare-upload',slotId:slot.id,mimeType:file.type,size:file.size});
  const {error}=await createClient().storage.from(upload.bucket).uploadToSignedUrl(upload.storagePath,upload.token,file,{contentType:file.type});if(error)throw Error(error.message);
  await command('register-upload',{slotId:slot.id,storagePath:upload.storagePath});
 }
 async function render(slot:number){
  const prerequisite=renderPrerequisite(w,assets.audio,slot,dirtyPlan);if(prerequisite)throw Error(prerequisite.message);
  const timings=slot===0?w.plan!.scenes:w.plan!.shorts.filter(t=>t.slotId===`short-${slot}`);
  const selected=timings.map(t=>({t,s:w.slots.find(s=>s.id===t.slotId)!}));if(selected.some(({s})=>!approvedCandidate(s)))throw Error('Approve the required visual first.');
  await sync(w);
  await post(`${WORKER}/creative/render`,{projectId,title,slot,audioUrl:assets.audio?.url,durationSeconds:w.analysis!.duration,dependencyKey:outputKey(w,slot,audioKey),visuals:selected.map(({s})=>({url:approvedCandidate(s)!.url,format:slot===0?'landscape':'vertical',mediaType:'image',imageNumber:s.number})),sceneDurations:timings.map(t=>t.end-t.start),highlight:slot?{startSeconds:timings[0].start,endSeconds:timings[0].end}:undefined});
  await loadVideos();setMessage('New video ready for review. Your previous approved version is preserved.');
 }
 async function uploadVideo(slot:number,file:File){
  if(!['video/mp4','video/quicktime'].includes(file.type)||!file.size)throw Error('Choose a non-empty MP4 or MOV video.');
  if(file.size>(slot?3:8)*1024**3)throw Error(slot?'Short video is limited to 3 GB.':'Full video is limited to 8 GB.');
  const url=URL.createObjectURL(file);let meta:{duration:number;width:number;height:number};
  try{meta=await new Promise((resolve,reject)=>{const v=document.createElement('video');v.preload='metadata';const timer=setTimeout(()=>reject(Error('Video could not be read. Try exporting it as MP4 and upload again.')),15000);v.onloadedmetadata=()=>{clearTimeout(timer);resolve({duration:v.duration,width:v.videoWidth,height:v.videoHeight});};v.onerror=()=>{clearTimeout(timer);reject(Error('Cannot read this video. Try an MP4 or MOV export.'));};v.src=url;});}finally{URL.revokeObjectURL(url);}
  if(!Number.isFinite(meta.duration)||meta.duration<=0)throw Error('Video has no readable duration.');
  if(Math.abs(meta.width/meta.height-(slot?9/16:16/9))>.035)throw Error(slot?'Choose a 9:16 Short.':'Choose a 16:9 full video.');
  const params=new URLSearchParams({projectId,title,slot:String(slot),filename:file.name,mimeType:file.type,sizeBytes:String(file.size),durationSeconds:String(meta.duration),width:String(meta.width),height:String(meta.height)});
  await json(`${WORKER}/creative/upload?${params}`,{method:'POST',headers:{'Content-Type':file.type},body:file});await loadVideos();onRefresh();setMessage(`${slot?`Short ${slot}`:'Full video'} uploaded as a new version. Preview it below, then approve it. Previous versions and approvals are preserved.`);
 }
 const dirtyPlan=JSON.stringify(planDraft)!==JSON.stringify(w.plan?{scenes:w.plan.scenes,shorts:w.plan.shorts}:null);
 const videoState=videoReadiness(w,assets,videos,dirtyPlan);
 const {complete,approvedCount}=videoState;
 const requiredSlots=requiredVisualSlots(w,assets,videos);
 const batch=visualBatchState(w,requiredSlots);
 const requiredVisualsReady=batch.ready;
 const dirtyDirection=instructions!==w.instructions||bible!==w.bible;
 const needsDirection=!!batch.missing.length&&(!w.bible.trim()||w.bible!==w.approvedBible||dirtyDirection);
 const directionLabel=bible.trim()?(dirtyDirection?'Save & Approve Direction':'Approve Direction'):'Generate Visual Direction';
 async function saveDirection(approve=false){await command('direction',{instructions,bible,approve});onRefresh();}
 async function suggestDirection(){
  // Persist edited instructions with the existing revision before requesting a suggestion.
  const current=dirtyDirection?await command('direction',{instructions,bible}):w;
  await command('propose-direction',{},current.revision);onRefresh();
 }
 async function resolveDirection(){await run(bible.trim()?'Approving direction':'Generating Visual Direction',()=>bible.trim()?saveDirection(true):suggestDirection());}

 async function reloadWorkspace(){const d=await json(`/api/creative-workspace?projectId=${encodeURIComponent(projectId)}`);accept(d.workspace);setLoaded(true);await loadVideos();setBatchNeedsReload(false);}
 async function generateOrReview(){
  if(batch.ready){onContinue();return;}
  const action=batch.missing.length?'generate':'approve-image';
  await run(action==='generate'?'Creating your visuals':'Approving reviewed visuals',async()=>{
   try{
    const next=await runVisualBatch(w,action==='generate'?batch.missing:batch.review,action,command,(complete,total)=>{if(active.current)setBatchProgress({action,complete,total});},()=>active.current);
    if(!active.current)return;
    if(action==='approve-image')await sync(next);
    setMessage(action==='generate'?'Your visuals are ready to review. Change any exceptions, then approve the reviewed visuals together.':'Reviewed visuals approved.');
   }catch(e){setBatchNeedsReload(true);throw e;}finally{setBatchProgress(null);onRefresh();}
  });
 }
 const [videoProgress,setVideoProgress]=useState<{complete:number;total:number}|null>(null);
 const [videoNeedsReload,setVideoNeedsReload]=useState(false);
 const blocker=videoState.missing.find(o=>o.blocker)?.blocker;
 async function createMissingVideos(){await run('Creating your videos',async()=>{
  try{
   const fresh=await loadVideos();const pending=videoReadiness(w,assets,fresh,dirtyPlan).missing;
   const blocked=pending.find(o=>o.blocker);if(blocked)throw Error(blocked.blocker!.message);
   let count=0;setVideoProgress({complete:0,total:pending.length});
   for(const output of pending){
    if(!active.current)break;
    const current=await loadVideos();
    if(videoReadiness(w,assets,current,dirtyPlan).missing.some(o=>o.slot===output.slot))await render(output.slot);
    if(active.current)setVideoProgress({complete:++count,total:pending.length});
   }
   if(active.current)setMessage('Your videos are ready to review. Play each video, change any exceptions, then approve reviewed videos.');
  }catch(e){setVideoNeedsReload(true);throw e;}finally{if(active.current){setVideoProgress(null);onRefresh();}}
 });}
 async function approveReviewedVideos(){await run('Approving reviewed videos',async()=>{
  await sync(w);const fresh=await loadVideos();
  for(const output of videoReadiness(w,assets,fresh,dirtyPlan).review){
   if(!active.current)break;
   await post(`${WORKER}/creative/approve`,{projectId,slot:output.slot,id:output.candidate!.id});
  }
  await loadVideos();onRefresh();
 });}
 const primaryVideoAction=<section className={styles.panel} aria-label="Videos next step">
  <h3>{complete?'Your videos are ready':blocker?'One thing needed before creating videos':videoState.missing.length?'Ready to create your videos':'Review your videos'}</h3>
  <p>{approvedCount} of 7 approved · {videoState.review.length} ready for review · {videoState.missing.length} missing</p>
  {blocker&&<p role="status">{blocker.message}</p>}
  {videoProgress&&<p role="status">Creating your videos… {videoProgress.complete} of {videoProgress.total} complete</p>}
  {videoNeedsReload?<><p>Creation stopped. Saved videos are preserved. Reload before continuing; completed outputs will be skipped.</p><button disabled={!!busy} onClick={()=>void run('Reloading saved videos',async()=>{await reloadWorkspace();setVideoNeedsReload(false);})}>Reload saved videos</button></>:
   <button className={styles.primary} disabled={!!busy||!!workerError||!videosReady||(!complete&&!!w.pending)||blocker?.kind==='timing'} onClick={()=>{
    if(complete){onContinue();return;}
    if(blocker?.kind==='audio'){onNavigate('Final Audio');return;}
    if(blocker?.kind==='visual'){onNavigate('Visuals');return;}
    if(blocker?.kind==='analysis'){void run(!w.slots.length?'Preparing creative workspace':'Analysing audio',!w.slots.length?setup:analyse);return;}
    if(blocker?.kind==='plan'){void run('Approving Video Plan',()=>change('plan',{...planDraft,approve:true}));return;}
    void (videoState.missing.length?createMissingVideos():approveReviewedVideos());
   }}>{complete?'Continue to Social →':blocker?.kind==='audio'?'Add final audio':blocker?.kind==='visual'?'Review required visual':blocker?.kind==='analysis'?(!w.slots.length?'Prepare Video Plan':'Analyse audio & propose timings'):blocker?.kind==='plan'?'Approve Video Plan':blocker?.kind==='timing'?'Correct plan timings below':videoState.missing.length?(videoState.missing.length===7?'Create Videos':`Create ${videoState.missing.length} Missing Videos`):'Approve reviewed videos'}</button>}
  {!complete&&!blocker&&<p>Play the videos below before approving. Use Change for an individual replacement.</p>}
 </section>;
 const primaryVisualAction=<section className={styles.panel} aria-label="Visuals next step">
  <h3>{needsDirection?'Prepare your Visual Direction':batch.ready?'Your visuals are ready':batch.missing.length?'Ready to create your visuals':'Review your visuals'}</h3>
  {batch.summary&&<p>{batch.summary}</p>}
  <p>{batch.missing.length?`${batch.missing.length} missing ${batch.missing.length===1?'visual':'visuals'}. Generation uses paid image credits. You can change any individual image after they’re created.`:batch.ready?'Continue when you’re happy with your visuals.':'Review the images below and change any exceptions. Approve reviewed visuals together to make them available for rendering.'}</p>
  {needsDirection&&<p>{bible.trim()?'Save and approve your current Visual Direction to generate visuals.':'Generate a Visual Direction using AI (paid usage), or write your own below.'}</p>}
  {batchProgress&&<p role="status">{batchProgress.action==='generate'?'Creating your visuals':'Approving reviewed visuals'}… {batchProgress.complete} of {batchProgress.total} complete</p>}
  {!videosReady&&!workerError&&!batch.ready&&<p>Checking saved outputs…</p>}
  {batchNeedsReload&&<p>Batch stopped. Completed work is saved. Reload the workspace before continuing; generation will not retry automatically. <button disabled={!!busy} onClick={()=>void run('Reload',reloadWorkspace)}>Reload saved visuals</button></p>}
  <button className={styles.primary} disabled={!!busy||!!w.pending||batchNeedsReload||(!needsDirection&&!batch.ready&&(!!workerError||!videosReady))} onClick={()=>void (needsDirection?resolveDirection():generateOrReview())}>{needsDirection?directionLabel:batch.missing.length?`Generate ${batch.missing.length} Missing Visuals`:batch.label}</button>
 </section>;
 return <section className={styles.studio} aria-label="Creative production studio">
  <header><p>V5.25 · {stage}</p><h2>{stage==='Visuals'?'Build the visual world':'Review your videos'}</h2><p>Preview, approve and make it yours. Use your own assets, generated assets, or a mix of both.</p>{loaded&&stage==='Video & Shorts'&&complete&&!workerError&&videosReady&&<button onClick={onContinue}>Continue to Social →</button>}</header>
  {workerError&&<p role="alert" className={styles.error}>{workerError} <button disabled={!!busy} onClick={()=>void (async()=>{setBusy('Checking video connection');try{await loadVideos();}catch{/* The connection message remains visible; never retry a mutation. */}finally{setBusy('');}})()}>Retry video connection</button></p>}
  {error&&<p role="alert" className={styles.error}>{error} <button disabled={!!busy} onClick={()=>void run('Reload',reloadWorkspace)}>Reload workspace</button></p>}
  {w.pending&&<p role="status">A generation request is reserved. If it was interrupted, wait ten minutes before clearing it. Clearing does not retry generation or reverse charges. <button disabled={!!busy} onClick={()=>{if(window.confirm('Clear this interrupted request without retrying generation?'))void run('Clearing interrupted request',()=>change('clear-interrupted'));}}>Clear interrupted request</button></p>}{message&&<p role="status">{message}</p>}{busy&&<p role="status">{busy}…</p>}
  {!loaded?<p>Loading creative workspace…</p>:!w.slots.length&&stage==='Visuals'?<div><p>Existing assets remain in your library. Start the new workspace to review or reuse them; no approvals will be invented.</p><button disabled={!!busy} onClick={()=>void run('Starting workspace',setup)}>Start creative workspace</button></div>:<>
   {stage==='Visuals'?<>
    {primaryVisualAction}
    <section className={styles.panel} aria-label="Visual Direction"><h3>Your Visual Direction</h3><p style={{whiteSpace:'pre-wrap'}}>{bible||"Let Universe suggest a direction, or write your own."}</p><p>{dirtyDirection?'Unsaved direction edits':w.approvedBible===w.bible&&w.bible.trim()?"✓ Direction approved":w.bible.trim()?"Direction awaiting approval":"No Visual Direction yet"}</p>
    {(!w.bible.trim()||w.approvedBible!==bible||dirtyDirection)&&<button disabled={!!busy||!!w.pending} onClick={()=>void resolveDirection()}>{directionLabel}</button>}
    {!bible.trim()&&<p>Direction suggestions use AI (paid usage). Images are generated separately after approval.</p>}
    <details open={!w.bible.trim()||undefined}><summary>{w.bible.trim()?'Change Direction':'Write your own direction'}</summary><h3>Creative Instructions <small>(optional)</small></h3><p>Blank means Universe decides.</p><textarea aria-label="Creative Instructions (optional)" value={instructions} onChange={e=>setInstructions(e.target.value)}/>
    <h3>Visual Direction / Character & World Bible</h3><textarea aria-label="Visual Direction / Character & World Bible" rows={12} placeholder="Write your direction, or ask Universe to propose one. Include characters, wardrobe, places, mood, palette, lighting, camera style, continuity and things to avoid." value={bible} onChange={e=>setBible(e.target.value)}/>
    <div className={styles.actions}><button disabled={!!busy||!!w.pending||!dirtyDirection} onClick={()=>void run('Saving direction',()=>saveDirection())}>Save edits</button><button disabled={!!busy||!!w.pending} onClick={()=>void run('Generating Visual Direction',suggestDirection)}>{dirtyDirection?'Save edits & Generate Visual Direction':'Generate Visual Direction'}</button><button disabled={!!busy||!!w.pending||!bible.trim()||(!dirtyDirection&&w.approvedBible===bible)} onClick={()=>void run('Approving direction',()=>saveDirection(true))}>{w.approvedBible===bible&&bible&&!dirtyDirection?'✓ Direction approved':dirtyDirection?'Save & Approve Direction':'Approve Direction'}</button></div><p>Generating a suggestion uses AI (paid usage) and replaces the current direction draft and scene prompts.</p></details></section>
    <p>{requiredVisualsReady?'✓ Required visual assets approved':'Review the visuals needed for missing outputs, cover and thumbnail.'} Scenes follow suggested song sections; add scenes as needed.</p>
    <button onClick={()=>setShowCompleted(v=>!v)}>{showCompleted?'Show only missing work':'Show completed visuals to replace'}</button><button disabled={!!busy} onClick={()=>void run('Adding scene',()=>change('add-scene'))}>Add landscape scene</button>
    <div>{(['scene','short','artwork'] as const).map(group=><section key={group}><h3>{group==='scene'?'Your Music Video Scenes':group==='short'?'Your 6 Short Visuals':'Cover Artwork & YouTube Thumbnail'}</h3><div className={styles.grid}>{(showCompleted?w.slots:requiredSlots).filter(slot=>group==='artwork'?['cover','thumbnail'].includes(slot.kind):slot.kind===group).map(slot=><VisualCard key={slot.id} slot={slot} allSlots={w.slots} legacy={[...assets.images,...assets.artwork.map(a=>({...a,existingArtwork:true}))]} busy={!!busy} canGenerate={!!w.bible&&w.bible===w.approvedBible&&!dirtyDirection} onPrompt={prompt=>run('Saving prompt',()=>change('prompt',{slotId:slot.id,prompt}))} onUpload={file=>run('Uploading image',()=>uploadImage(slot,file))} onAction={(action,extra)=>run(action==='generate'?'Generating image':'Saving visual',()=>change(action,{slotId:slot.id,...extra}))}/>)}</div></section>)}</div>
    {primaryVisualAction}
   </>:<>
    {primaryVideoAction}
    <section className={styles.panel}><p>Upload your own missing videos below, or create them from final audio and approved song visuals.</p><h3>{w.plan?.approved?'Your Video Plan is Ready ✓':'Your Video Plan'}</h3><p>{w.plan?.scenes.length||0} scenes · {Math.floor((w.analysis?.duration||0)/60)}:{String(Math.round((w.analysis?.duration||0)%60)).padStart(2,"0")} · 6 Shorts</p><details open={!w.plan?.approved||undefined}><summary>Preview plan</summary><ol>{w.plan?.scenes.map(t=><li key={t.slotId}>{t.label} · {t.start.toFixed(1)}–{t.end.toFixed(1)} seconds</li>)}</ol><ol>{w.plan?.shorts.map(t=><li key={t.slotId}>{t.slotId} · {t.start.toFixed(1)}–{t.end.toFixed(1)} seconds</li>)}</ol><p>Section labels guide the story; they are not precise lyric alignment.</p></details><details><summary>Adjust plan</summary><p>Energy measurements suggest useful audio moments. Labelled lyrics provide section names, not precise alignment. Listen and edit every timing. Motion uses gentle pan and zoom; no text or branding is added over the clean opening.</p>
    {assets.audio?.url&&<audio controls src={assets.audio.url} preload="metadata"/>}<button disabled={!!busy||!assets.audio?.url} onClick={()=>void run('Analysing audio',analyse)}>Analyse audio & propose timings</button>
    {planDraft&&<><p>{w.plan?.approved?'✓ Plan approved':'Plan awaiting review'} · {w.analysis?.duration.toFixed(1)} seconds</p>{(['scenes','shorts'] as const).map(kind=><fieldset key={kind}><legend>{kind==='scenes'?'Full video scene sequence':'Six Short audio segments'}</legend>{planDraft[kind].map((t,i)=><div key={t.slotId} className={styles.timing}><label>{t.slotId}<input aria-label={`${t.slotId} section label`} value={t.label} onChange={e=>setPlanDraft({...planDraft,[kind]:planDraft[kind].map((r,j)=>j===i?{...r,label:e.target.value}:r)})}/></label><label>Start (seconds)<input type="number" step="0.1" value={t.start} onChange={e=>setPlanDraft({...planDraft,[kind]:planDraft[kind].map((r,j)=>j===i?{...r,start:Number(e.target.value)}:r)})}/></label><label>End (seconds)<input type="number" step="0.1" value={t.end} onChange={e=>setPlanDraft({...planDraft,[kind]:planDraft[kind].map((r,j)=>j===i?{...r,end:Number(e.target.value)}:r)})}/></label></div>)}</fieldset>)}<div className={styles.actions}><button disabled={!!busy} onClick={()=>void run('Saving timings',()=>change('plan',{...planDraft,approve:false}))}>Save plan</button><button disabled={!!busy} onClick={()=>void run('Approving plan',()=>change('plan',{...planDraft,approve:true}))}>Approve Video Plan</button></div></>}
    </details><p>Finished video uploads can be reviewed and approved independently of this render plan.</p></section>
    <h3>{workerError||!videosReady?'Video review unavailable — reconnect to read saved approvals':complete?'✓ Videos ready — continue to Social':'Review the videos that need your attention'}</h3>
    <fieldset disabled={!!workerError||!videosReady} style={{border:0,padding:0,margin:0}}>
    <div className={styles.grid}>{outputNames.map((name,slot)=>{const list=videos.versions.filter(v=>v.slot===slot);const legacy=slot===0?assets.fullVideos:assets.shorts.filter(v=>Number(v.slot)===slot);const renderVersion=(v:Version)=>{const current=v.source==='uploaded'||v.dependencyKey===outputKey(w,slot,audioKey);const approved=videos.approved[name]===v.id&&current;return <article key={v.id} className={approved?styles.approved:styles.candidate}><video aria-label={`${slot?`Short ${slot}`:'Full video'} preview · version ${list.indexOf(v)+1}`} controls preload="metadata" src={v.fileUrl}/><p>Version {list.indexOf(v)+1} · {v.source==='uploaded'?'Uploaded edit':'Universe render'}{v===list.at(-1)?' · Current review candidate':''}</p><p>{approved?'✓ Approved for publishing':current?'Awaiting your approval':'Needs updating · previous version preserved'}</p><details><summary>Advanced · file details</summary><small>{v.filename}</small></details><div className={styles.actions}><a href={`${v.fileUrl}&download=1`} download>Download</a>{!approved&&<button disabled={!!busy||approved||!current} onClick={()=>void run('Approving video',async()=>{await sync(w);await post(`${WORKER}/creative/approve`,{projectId,slot,id:v.id});await loadVideos();onRefresh();})}>Approve this version</button>}</div></article>;};return <section className={styles.panel} key={name}><h3>{slot?`Short ${slot}`:'Full music video'}</h3>{list.length>0&&!list.some(v=>videos.approved[name]===v.id&&(v.source==='uploaded'||v.dependencyKey===outputKey(w,slot,audioKey)))&&<p className={styles.attention}>{list.some(v=>v.source==='uploaded'||v.dependencyKey===outputKey(w,slot,audioKey))?'Ready for your review':`${slot?`Short ${slot}`:'Full video'} needs updating because its inputs changed.`}</p>}<details><summary>Change</summary><div className={styles.actions}><button disabled={!!busy||!!renderPrerequisite(w,assets.audio,slot,dirtyPlan)} onClick={()=>void run(`Rendering ${name}`,()=>render(slot))}>{list.length?'Re-render':'Render'}</button>{legacy.filter(v=>['generated','uploaded'].includes(v._source)).map(v=><button key={v._source} disabled={!!busy} onClick={()=>void run('Preserving existing video',async()=>{await post(`${WORKER}/creative/import`,{projectId,slot,source:v._source});await loadVideos();})}>Use existing {v._source} video</button>)}</div>{list.length>1&&<details><summary>Earlier versions · {list.length-1}</summary>{list.slice(0,-1).map(v=>renderVersion(v))}</details>}</details>
     {list.slice(-1).map(v=>renderVersion(v))}
     <div className={styles.actions}><label className={styles.file}>Upload Edited Version<input disabled={!!busy} aria-label={`Upload Edited Version for ${slot?`Short ${slot}`:'Full video'}`} type="file" accept="video/mp4,video/quicktime" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void run('Uploading video',()=>uploadVideo(slot,f));}}/></label></div>
     {list.length>0&&videos.approved[name]&&videos.approved[name]!==list.at(-1)?.id&&<p>The previous approved version remains selected for publishing until you approve this edit. You can review it under Change → Earlier versions.</p>}
    </section>;})}</div></fieldset>
    {primaryVideoAction}
   </>}
  </>}
 </section>;
}
function VisualCard({slot,allSlots,legacy,busy,canGenerate,onPrompt,onUpload,onAction}:{slot:VisualSlot;allSlots:VisualSlot[];legacy:any[];busy:boolean;canGenerate:boolean;onPrompt:(s:string)=>Promise<void>;onUpload:(f:File)=>Promise<void>;onAction:(a:string,b:Record<string,unknown>)=>Promise<void>}){
 const [prompt,setPrompt]=useState(slot.prompt),[source,setSource]=useState('');useEffect(()=>setPrompt(slot.prompt),[slot.prompt]);
 return <section className={`${styles.panel} ${styles.visualCard}`} data-kind={slot.kind}><h3>{slot.label}</h3><small>{slot.kind==='cover'?'3000 × 3000':slot.kind==='short'?'9:16 vertical':'16:9 landscape'}</small><details className={styles.change}><summary>Change / Replace</summary>{slot.approvedId&&['cover','thumbnail'].includes(slot.kind)&&<button disabled={busy} onClick={()=>void onAction('approve-image',{candidateId:slot.approvedId})}>Reapply approved artwork</button>}<details><summary>Advanced · edit prompt</summary><label>Image prompt<textarea value={prompt} onChange={e=>setPrompt(e.target.value)}/></label><div className={styles.actions}><button disabled={busy||prompt===slot.prompt} onClick={()=>void onPrompt(prompt)}>Save prompt</button></div></details><div className={styles.actions}><button disabled={busy||!canGenerate||prompt!==slot.prompt} onClick={()=>{if(window.confirm(`Generate one paid image candidate for ${slot.label}? Existing versions and approvals will be preserved.`))void onAction('generate',{confirmPaid:true});}}>{slot.candidates.length?'Generate another':'Generate image'}</button><label className={styles.file}>Upload / replace<input disabled={busy} type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void onUpload(f);}}/></label></div>
 <label>Use an existing image<select value={source} onChange={e=>setSource(e.target.value)}><option value="">Choose a source…</option>{allSlots.flatMap(s=>s.candidates.map((c,i)=><option key={c.id} value={`candidate:${c.id}`}>{s.label} · version {i+1}</option>))}{legacy.map(x=><option key={x.id} value={`${x.existingArtwork?'artwork':'legacy'}:${x.id}`}>Existing {x.mediaKind||x.format} {x.imageNumber||x.originalFilename}</option>)}</select></label><button disabled={busy||!source} onClick={()=>void onAction(source.startsWith('artwork:')?'import-artwork':source.startsWith('legacy:')?'import-image':'derive',source.startsWith('artwork:')?{assetId:source.slice(8)}:source.startsWith('legacy:')?{imageId:source.slice(7)}:{candidateId:source.slice(10)})}>Use this image</button><p>Images are cropped to the required shape. Review the framing before approval.</p><details><summary>Earlier versions · {Math.max(0,slot.candidates.length-1)}</summary>{slot.candidates.slice(0,-1).map((a,i)=><article key={a.id} className={a.id===slot.approvedId?styles.approved:styles.candidate}>{/* Signed private storage previews are intentionally plain image elements. */}<img src={a.url} alt={`${slot.label} version ${i+1}`} loading="lazy"/><p>Version {i+1} {a.id===slot.approvedId?'· ✓ Approved':'· Ready for review'}</p>{a.id!==slot.approvedId&&<button disabled={busy||(a.id===slot.approvedId&&!['cover','thumbnail'].includes(slot.kind))} onClick={()=>void onAction('approve-image',{candidateId:a.id})}>{a.id===slot.approvedId?(['cover','thumbnail'].includes(slot.kind)?'Reapply approved artwork':'✓ Approved'):`Approve version ${i+1}`}</button>}</article>)}</details></details>
 {slot.candidates.slice(-1).map(a=>{const i=slot.candidates.length-1;return <article key={a.id} className={a.id===slot.approvedId?styles.approved:styles.candidate}>{/* Signed private storage previews are intentionally plain image elements. */}<img src={a.url} alt={`${slot.label} version ${i+1}`} loading="lazy"/><p>Version {i+1} {a.id===slot.approvedId?'· ✓ Approved':'· Ready for review'}</p>{a.id!==slot.approvedId&&<button disabled={busy||(a.id===slot.approvedId&&!['cover','thumbnail'].includes(slot.kind))} onClick={()=>void onAction('approve-image',{candidateId:a.id})}>{a.id===slot.approvedId?(['cover','thumbnail'].includes(slot.kind)?'Reapply approved artwork':'✓ Approved'):`Approve version ${i+1}`}</button>}</article>;})}
 </section>;
}

function updateReason(previous:string,current:string){
 try{const a=JSON.parse(previous),b=JSON.parse(current);
 if(a.audio!==b.audio)return 'The final audio changed after this video was rendered.';
 if(JSON.stringify(a.timings?.map((t:any)=>[t.id,t.visual]))!==JSON.stringify(b.timings?.map((t:any)=>[t.id,t.visual])))return 'You changed its approved visual after this video was rendered.';
 return 'Its Video Plan changed after this video was rendered.';
 }catch{return 'Its source assets or Video Plan have changed. Review and update this video.';}
}
