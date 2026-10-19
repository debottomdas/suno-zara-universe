'use client';
import LyricTimingReview from './LyricTimingReview';
import type {LyricCueContext} from '@/utils/creative/lyric-cues';
import {useEffect,useRef,useState} from 'react';
import {structuredSubtitleFinishing,subtitleSettings,subtitleBlocker,approvedCandidate,emptyWorkspace,outputKey,finalAudioKey,requiredVisualSlots,videoReadiness,renderPrerequisite,type CreativeWorkspace,type VisualSlot,type Timing} from '@/utils/creative/model';
import {visualBatchState,runVisualBatch} from '@/utils/creative/visual-batch';
import styles from './CreativeStudio.module.css';
import {createClient} from '@/utils/supabase/client';
const WORKER='http://127.0.0.1:47123';
type Existing={audio?:{id?:string;url?:string;updatedAt?:string;storagePath?:string;metadata?:{durationSeconds?:number}}|null;images:any[];artwork:any[];fullVideos:any[];shorts:any[]};
type Version={id:string;slot:number;source:string;fileUrl:string;filename:string;dependencyKey:string};
type Videos={versions:Version[];approved:Record<string,string>;keys:Record<string,string>;complete?:boolean};
const outputNamesFor=(w:CreativeWorkspace)=>['full',...w.slots.filter(s=>s.kind==='short').sort((a,b)=>a.number-b.number).map(s=>s.id)];
async function json(url:string,options?:RequestInit){let r:Response;try{r=await fetch(url,options);}catch{throw Error(url.startsWith(WORKER)?'Your saved videos are temporarily unavailable. Reconnect and try again; your saved work and approvals are preserved.':'Cannot reach Universe. Check the connection and reload the saved workspace.');}const d=await r.json();if(!r.ok)throw Error(d.error||`Request failed (${r.status})`);return d;}
const post=(url:string,body:unknown)=>json(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function UnifiedTimelinePreview({workspace,audioUrl,onSequence,onUpload,onBulkUpload,busy}:{workspace:CreativeWorkspace;audioUrl:string;onSequence:(slot:number,ids:string[],durations?:number[])=>Promise<void>;onUpload:(slotId:string,file:File)=>Promise<void>;onBulkUpload:(slot:number,files:File[])=>Promise<void>;busy:boolean}){
 const [slot,setSlot]=useState(1);
 const [lastShort,setLastShort]=useState(1);
 const [clock,setClock]=useState(0);
 const [playing,setPlaying]=useState(false);
 const [dragIndex,setDragIndex]=useState<number|null>(null);
 const [editError,setEditError]=useState('');
 const [dropActive,setDropActive]=useState(false);
 const [dropNotice,setDropNotice]=useState('');
 const dropDepth=useRef(0);
 const audio=useRef<HTMLAudioElement|null>(null);
 const duration=workspace.analysis?.duration||0;
 const shorts=workspace.slots.filter(s=>s.kind==='short').sort((a,b)=>a.number-b.number);
 const chosen=slot===0?workspace.plan?.scenes||[]:(workspace.plan?.shorts||[]).filter(t=>t.slotId===`short-${slot}`);
 const rangeStart=slot===0?0:(chosen[0]?.start||0);
 const rangeEnd=slot===0?duration:(chosen[0]?.end||duration);
 const span=Math.max(0.1,rangeEnd-rangeStart);
 const candidates=workspace.slots.flatMap(s=>s.candidates);
 const sequence=slot===0?workspace.fullImageSequence||[]:workspace.shortImageSequences?.[`short-${slot}`]||[];
 const fullDurations=workspace.fullImageDurations?.length===sequence.length?workspace.fullImageDurations:sequence.map(()=>duration/Math.max(1,sequence.length));
 const segments=slot===0?(sequence.length?sequence.map((id,i)=>({start:fullDurations.slice(0,i).reduce((a,b)=>a+b,0),end:fullDurations.slice(0,i+1).reduce((a,b)=>a+b,0),label:`Image ${i+1}`,url:candidates.find(c=>c.id===id)?.url||''})):chosen.map(t=>({start:t.start,end:t.end,label:t.label,url:approvedCandidate(workspace.slots.find(s=>s.id===t.slotId)!)?.url||''}))):sequence.length?sequence.map((id,i)=>({start:rangeStart+i*span/sequence.length,end:rangeStart+(i+1)*span/sequence.length,label:`Image ${i+1}`,url:candidates.find(c=>c.id===id)?.url||''})):chosen.map(t=>({start:t.start,end:t.end,label:t.label,url:approvedCandidate(workspace.slots.find(s=>s.id===t.slotId)!)?.url||''}));
 const active=segments.find(x=>clock>=x.start&&clock<x.end)||segments[0];
 function uploadDroppedFiles(files:File[]){
  if(busy)return;
  const images=files.filter(file=>['image/jpeg','image/png','image/webp'].includes(file.type));
  if(images.length!==files.length){setEditError('Only JPG, PNG and WebP images can be dropped here.');return;}
  if(!images.length)return;
  const unique=images.filter((file,index)=>images.findIndex(other=>other.name===file.name&&other.size===file.size&&other.lastModified===file.lastModified)===index);
  setEditError('');
  setDropNotice(`Uploading ${unique.length} image${unique.length===1?'':'s'} to ${slot===0?'Full video':`Short ${slot}`}…`);
  void onBulkUpload(slot,unique).then(()=>setDropNotice(`${unique.length} image${unique.length===1?'':'s'} uploaded. Arrange them below.`)).catch(error=>{setDropNotice('');setEditError(error instanceof Error?error.message:String(error));});
 }
 function seek(t:number){const v=Math.max(rangeStart,Math.min(rangeEnd,t));setClock(v);if(audio.current)audio.current.currentTime=v;}
 useEffect(()=>{audio.current?.pause();setPlaying(false);setClock(slot===0?0:(workspace.plan?.shorts.find(t=>t.slotId===`short-${slot}`)?.start||0));},[slot,workspace.plan]);
 const stamp=(t:number)=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
 if(!workspace.plan||!audioUrl)return null;
 return <section className={styles.panel} aria-label="Unified full video and Shorts timeline">
  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12,marginBottom:12}}>
   <h2 style={{margin:0,fontSize:28}}>Video Editor</h2>
   <div role="group" aria-label="Video editor format" style={{display:'flex',background:'#eee',borderRadius:40,padding:4,gap:4}}>
    <button type="button" aria-pressed={slot!==0} onClick={()=>setSlot(shorts.some(x=>x.number===lastShort)?lastShort:(shorts[0]?.number||1))} style={{border:0,borderRadius:30,padding:'10px 20px',fontSize:17,background:slot!==0?'white':'transparent',color:slot!==0?'#111':'#666',fontWeight:slot!==0?700:400}}>Short · 9:16</button>
    <button type="button" aria-pressed={slot===0} onClick={()=>{if(slot!==0)setLastShort(slot);setSlot(0);}} style={{border:0,borderRadius:30,padding:'10px 20px',fontSize:17,background:slot===0?'white':'transparent',color:slot===0?'#111':'#666',fontWeight:slot===0?700:400}}>Full · 16:9</button>
   </div>
  </div>
  <p>{slot===0?'Full video · Landscape image library and full-song timeline':'Shorts · Portrait image library and Short timeline'}. Preview follows the song playhead; rendered transitions and captions are reviewed after rendering.</p>
  {slot!==0&&<label>Choose Short <select value={slot} onChange={e=>{const n=Number(e.target.value);setLastShort(n);setSlot(n);}}>{shorts.map(x=><option key={x.id} value={x.number}>Short {x.number}</option>)}</select></label>}
  <div style={{display:'flex',justifyContent:'center',background:'#14151b',padding:12,borderRadius:10,marginTop:12}}>
   {active?.url?<img src={active.url} alt={active.label} style={{width:slot?'min(100%,220px)':'min(100%,600px)',aspectRatio:slot?'9 / 16':'16 / 9',objectFit:'cover',borderRadius:6}}/>:<div style={{color:'white',padding:40}}>No approved image for this scene yet</div>}
  </div>
  <audio ref={audio} src={audioUrl} preload="metadata" onTimeUpdate={e=>{const t=e.currentTarget.currentTime;setClock(t);if(slot!==0&&t>=rangeEnd){e.currentTarget.pause();setPlaying(false);}}} onEnded={()=>setPlaying(false)} onPause={()=>setPlaying(false)}/>
  <div style={{display:'flex',alignItems:'center',gap:12,margin:'12px 0'}}>
   <button type="button" onClick={async()=>{const a=audio.current;if(!a)return;if(!a.paused){a.pause();return;}if(a.currentTime<rangeStart||a.currentTime>=rangeEnd)seek(rangeStart);try{await a.play();setPlaying(true);}catch{setPlaying(false);}}}>{playing?'Pause':'Play'}</button>
   <span>{stamp(clock)} / {stamp(rangeEnd)}</span>
   <span style={{marginLeft:'auto'}}>Scene: {active?.label||'None'}</span>
  </div>
  <input aria-label="Scrub video timeline" type="range" min={rangeStart} max={rangeEnd} step={0.1} value={Math.max(rangeStart,Math.min(rangeEnd,clock))} onChange={e=>seek(Number(e.target.value))} style={{width:'100%'}}/>
  {editError&&<p role="alert" style={{color:'#b33'}}>{editError}</p>}
  <div style={{display:'flex',gap:2,width:'100%',minHeight:48,marginTop:8}}> 
   {segments.map((part,i)=><button key={i} type="button" title={`${part.label} · ${stamp(part.start)}–${stamp(part.end)}`} onClick={()=>seek(part.start)} style={{flex:Math.max(0.1,part.end-part.start),minWidth:0,padding:'6px 2px',overflow:'hidden',background:clock>=part.start&&clock<part.end?'#b8a2e8':'#9bb5ce',color:'#17202b',border:'1px solid #657f99',borderRadius:4,fontSize:11}}>{part.label}</button>)}
  </div>
  <div style={{marginTop:12}}>
   <h4>Timeline images</h4>
   <div role="group" aria-label="Drop images to upload" onDragEnter={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();dropDepth.current+=1;setDropActive(true);}} onDragOver={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();e.dataTransfer.dropEffect=busy?'none':'copy';}} onDragLeave={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();dropDepth.current=Math.max(0,dropDepth.current-1);if(dropDepth.current===0)setDropActive(false);}} onDrop={e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();e.stopPropagation();dropDepth.current=0;setDropActive(false);uploadDroppedFiles(Array.from(e.dataTransfer.files));}} style={{border:dropActive?'3px dashed #8a65d6':'2px dashed #8290a3',background:dropActive?'rgba(138,101,214,.14)':'transparent',borderRadius:12,padding:20,textAlign:'center',margin:'12px 0'}}>
    <strong>{dropActive?'Release to upload images':'Drag images here from Finder'}</strong>
    <p style={{fontSize:12}}>Drop multiple JPG, PNG or WebP files (20 MB each) into {slot===0?'Full video':`Short ${slot}`}. You can still use the file picker.</p>
    <label style={{display:'inline-block'}}>Choose images <input aria-label="Bulk upload timeline images" type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const files=Array.from(e.currentTarget.files||[]);e.currentTarget.value='';uploadDroppedFiles(files);}}/></label>
    {dropNotice&&<p role="status">{dropNotice}</p>}
   </div>
   <p style={{fontSize:12}}>{slot===0?'For full video, files are assigned in selected order to consecutive scene slots. Review and approve each image before rendering.':'For Shorts, uploaded images are added to this Short’s sequence in selected order. Drag them into your preferred order afterwards.'}</p>
   <p>Drag Short images to reorder them, or use the move buttons. Upload a replacement to a full-video scene or Short image slot; uploaded images remain unapproved until reviewed.</p>
   {slot===0&&<label>Add image from library <select disabled={busy||sequence.length>=100} value="" onChange={e=>{const id=e.target.value;if(!id)return;const next=[...sequence,id];const durations=Array.from({length:next.length},()=>duration/next.length);void onSequence(0,next,durations).catch(err=>setEditError(String(err)));}}><option value="">Choose an image…</option>{workspace.slots.filter(x=>x.kind==='scene'||x.kind==='short').flatMap(x=>x.candidates.map(c=><option key={c.id} value={c.id}>{x.label} · {c.id.slice(0,8)}</option>))}</select></label>}
   <div style={{display:'flex',flexWrap:'wrap',gap:6,margin:'12px 0'}} aria-label="Uploaded image library">{workspace.slots.filter(x=>x.kind==='scene'||x.kind==='short').flatMap(x=>x.candidates).map(c=><button type="button" key={c.id} disabled={busy} title="Add this image to the timeline" onClick={()=>{if(slot===0){const ids=[...sequence,c.id];void onSequence(0,ids,ids.map(()=>duration/ids.length)).catch(err=>setEditError(String(err)));}else void onSequence(slot,[...sequence,c.id]).catch(err=>setEditError(String(err)));}} style={{border:'1px solid #888',padding:3,borderRadius:5}}><img src={c.url} alt="Saved uploaded image" style={{width:72,height:55,objectFit:'cover'}}/></button>)}</div>
   {slot!==0&&<label>Add saved image <select disabled={busy||sequence.length>=20} value="" onChange={e=>{if(!e.target.value)return;void onSequence(slot,[...sequence,e.target.value]).catch(err=>setEditError(String(err)));}}><option value="">Choose an image…</option>{workspace.slots.filter(x=>x.kind==='scene'||x.kind==='short').flatMap(x=>x.candidates.map(c=><option key={c.id} value={c.id}>{x.label} · {c.id.slice(0,8)}</option>))}</select></label>}
   {slot===0&&<button type="button" disabled={busy||workspace.slots.filter(s=>s.kind==='scene').some(s=>!approvedCandidate(s))} onClick={()=>{const ids=workspace.plan?.scenes.map(t=>approvedCandidate(workspace.slots.find(s=>s.id===t.slotId)!)?.id||'')||[];if(ids.length)void onSequence(0,ids).catch(err=>setEditError(String(err)));}}>Enable full-video drag-and-drop using approved scene images</button>}
   <div style={{display:'flex',gap:8,overflowX:'auto',padding:'10px 0'}}>
    {segments.map((part,i)=><div key={i} draggable={sequence.length>1&&!busy} onDragStart={()=>setDragIndex(i)} onDragOver={e=>{if(sequence.length)e.preventDefault();}} onDrop={e=>{e.preventDefault();if(dragIndex===null||dragIndex===i||!sequence.length)return;const next=[...sequence];const [moved]=next.splice(dragIndex,1);next.splice(i,0,moved);setDragIndex(null);void onSequence(slot,next,slot===0?(()=>{const d=[...fullDurations];const [m]=d.splice(dragIndex,1);d.splice(i,0,m);return d;})():undefined).catch(err=>setEditError(String(err)));}} onDragEnd={()=>setDragIndex(null)} style={{minWidth:135,border:'1px solid #888',borderRadius:8,padding:8}}>
      {part.url&&<img src={part.url} alt={part.label} style={{width:118,height:75,objectFit:'cover'}}/>}
      <div style={{fontSize:12}}>{part.label}</div>
      <div style={{fontSize:11}}>{stamp(part.start)}–{stamp(part.end)}</div>
      {slot===0&&sequence.length>0&&<label style={{fontSize:11}}>Duration (seconds)<input type="number" min={0.25} max={duration} step={0.25} defaultValue={fullDurations[i]?.toFixed(2)} key={`${sequence[i]}-${fullDurations[i]}`} disabled={busy||sequence.length<2} onBlur={e=>{const desired=Number(e.currentTarget.value),next=[...fullDurations],adjacent=i===next.length-1?i-1:i+1;if(!Number.isFinite(desired)||desired<0.25||next[adjacent]+next[i]-desired<0.25){e.currentTarget.value=next[i].toFixed(2);setEditError('Each image needs at least 0.25 seconds; adjust neighbouring images.');return;}next[adjacent]+=next[i]-desired;next[i]=desired;void onSequence(0,sequence,next).catch(err=>setEditError(String(err)));}} style={{width:78,display:'block'}}/></label>}
      {sequence.length>0&&<div style={{display:'flex',gap:4}}>
       <button type="button" disabled={busy||i===0} onClick={()=>{const next=[...sequence];[next[i-1],next[i]]=[next[i],next[i-1]];void onSequence(slot,next,slot===0?next.map(id=>fullDurations[sequence.indexOf(id)]):undefined).catch(err=>setEditError(String(err)));}}>←</button>
       <button type="button" disabled={busy||i===sequence.length-1} onClick={()=>{const next=[...sequence];[next[i+1],next[i]]=[next[i],next[i+1]];void onSequence(slot,next,slot===0?next.map(id=>fullDurations[sequence.indexOf(id)]):undefined).catch(err=>setEditError(String(err)));}}>→</button>
       <button type="button" disabled={busy||sequence.length===1} onClick={()=>void onSequence(slot,sequence.filter((_,j)=>j!==i),slot===0?fullDurations.filter((_,j)=>j!==i).map(x=>x+fullDurations[i]/(sequence.length-1)):undefined).catch(err=>setEditError(String(err)))}>Remove</button>
      </div>}
      {(()=>{const sourceSlot=slot===0?workspace.slots.find(x=>x.id===chosen[i]?.slotId):workspace.slots.find(x=>x.candidates.some(c=>c.id===sequence[i]))||workspace.slots.find(x=>x.id===`short-${slot}`);return sourceSlot?<label style={{display:'block',fontSize:11,marginTop:6}}>Upload image<input aria-label={`Upload image for ${part.label}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)void onUpload(sourceSlot.id,file).catch(err=>setEditError(String(err)));}}/></label>:null;})()}
     </div>)}
   </div>
  </div>
  <p style={{fontSize:12}}>Timeline is linked to the saved scene plan and Short image sequences. Edit timings and image order using the existing controls below; playback updates after saving.</p>
 </section>;
}
export default function CreativeStudio({projectId,title,lyrics,stage,assets,onRefresh,onContinue,onNavigate}:{projectId:string;title:string;lyrics:string;stage:'Visuals'|'Video & Shorts';assets:Existing;onRefresh:()=>void;onContinue:()=>void;onNavigate:(stage:'Final Audio'|'Visuals')=>void}){
 const [cueContext,setCueContext]=useState<LyricCueContext|null>(null);
 const [w,setW]=useState<CreativeWorkspace>(emptyWorkspace);const [videos,setVideos]=useState<Videos>({versions:[],approved:{},keys:{}});
 const [videosReady,setVideosReady]=useState(false),[workerError,setWorkerError]=useState('');const [bulkFiles,setBulkFiles]=useState<{file:File;slot:number;prefix:string}[]>([]),[bulkIssue,setBulkIssue]=useState(''),[bulkProgress,setBulkProgress]=useState('');
 const [imageBatch,setImageBatch]=useState<{file:File;slotId:string}[]>([]),[imageBatchError,setImageBatchError]=useState(''),[imageBatchProgress,setImageBatchProgress]=useState('');
 const [selectedShorts,setSelectedShorts]=useState<number[]>([]);
 const [cinematic,setCinematic]=useState<{mode:'basic'|'romantic';warmth:number;contrast:number;softness:number;glow:number;vignette:number;atmosphere:number;overlay:'none'|'golden-light-leak';overlayIntensity:number}>({mode:'basic',warmth:0.55,contrast:0.25,softness:0.2,glow:0.45,vignette:0.4,atmosphere:0.25,overlay:'none',overlayIntensity:0.7});
 const [showStylePreview,setShowStylePreview]=useState(false);
 useEffect(()=>{try{const raw=window.localStorage.getItem(`szu-cinematic-${projectId}`);if(raw){const parsed=JSON.parse(raw);if((parsed.mode==='basic'||parsed.mode==='romantic')&&['warmth','contrast','softness'].every(k=>typeof parsed[k]==='number'&&parsed[k]>=0&&parsed[k]<=1))setCinematic({glow:0.45,vignette:0.4,atmosphere:0.25,overlay:'none',overlayIntensity:0.7,...parsed});}}catch{}},[projectId]);
 function updateCinematic(next:{mode:'basic'|'romantic';warmth:number;contrast:number;softness:number;glow:number;vignette:number;atmosphere:number}){setCinematic(next);try{window.localStorage.setItem(`szu-cinematic-${projectId}`,JSON.stringify(next));}catch{}}

 const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('');
 const operation=useRef(false),active=useRef(true);
 const [batchProgress,setBatchProgress]=useState<{action:string;complete:number;total:number}|null>(null),[batchNeedsReload,setBatchNeedsReload]=useState(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const [sceneDraft,setSceneDraft]=useState('');
 const [showCompleted,setShowCompleted]=useState(false);const [instructions,setInstructions]=useState(''),[bible,setBible]=useState('');const [planDraft,setPlanDraft]=useState<{scenes:Timing[];shorts:Timing[]}|null>(null);
 const shortPreviewAudio=useRef<HTMLAudioElement|null>(null);
 const [previewShort,setPreviewShort]=useState<string|null>(null);
 const [previewPlaying,setPreviewPlaying]=useState(false);
 const [capturingShort,setCapturingShort]=useState<string|null>(null);
 const [captureStart,setCaptureStart]=useState<number|null>(null);
 function updateShortTiming(slotId:string,field:'start'|'end',value:number){
  setPlanDraft(previous=>{
   if(!previous)return previous;
   return {...previous,shorts:previous.shorts.map(t=>{if(t.slotId!==slotId||!Number.isFinite(value))return t;const duration=w.analysis?.duration||0;const rounded=Math.round(value*10)/10;if(field==='start'){const start=Math.max(0,Math.min(rounded,t.end-8,duration-8));return {...t,start,end:Math.min(t.end,start+60)};}const end=Math.min(duration,Math.max(t.start+8,Math.min(rounded,t.start+60)));return {...t,end};})};
  });
 }
 async function previewClip(t:Timing){
  const audio=shortPreviewAudio.current;if(!audio)return;
  if(previewPlaying&&previewShort===t.slotId){audio.pause();setPreviewPlaying(false);return;}
  audio.pause();setCapturingShort(null);setCaptureStart(null);audio.currentTime=t.start;setPreviewShort(t.slotId);
  try{await audio.play();setPreviewPlaying(true);}catch{setPreviewPlaying(false);setError('Audio preview could not start. Try the play button again.');}
 }
 function setStartWhileListening(t:Timing){
  const audio=shortPreviewAudio.current;if(!audio)return;
  const duration=w.analysis?.duration||0;
  const position=Math.round(audio.currentTime*10)/10;
  if(!Number.isFinite(position)||position>duration-8){setError('Choose a start at least 8 seconds before the song ends.');return;}
  setCapturingShort(t.slotId);setCaptureStart(position);setPreviewShort(t.slotId);
  // Keep playing the master song. End is selected when Stop & Set End is pressed.
  setError('');setMessage(`Start marked at ${position.toFixed(1)}s for ${t.slotId.replace('short-','Short ')}. Press Stop & Set End to finish the clip.`);
 }
 async function listenToMaster(t:Timing){
  const audio=shortPreviewAudio.current;if(!audio)return;
  audio.pause();setCapturingShort(null);setCaptureStart(null);setPreviewShort(t.slotId);
  try{await audio.play();setPreviewPlaying(true);}catch{setError('Could not play the master song.');}
 }
 function stopAndSetEnd(t:Timing){
  const audio=shortPreviewAudio.current;
  if(!audio||previewShort!==t.slotId)return;
  const position=Math.round(audio.currentTime*10)/10;
  const start=capturingShort===t.slotId&&captureStart!==null?captureStart:t.start;
  audio.pause();setPreviewPlaying(false);
  if(position<start+8||position>Math.min(start+60,w.analysis?.duration||0)){
   setError('The selected clip must be 8–60 seconds long. Resume playback or adjust the start/end handles.');
   return;
  }
  setPlanDraft(previous=>previous?{...previous,shorts:previous.shorts.map(row=>row.slotId===t.slotId?{...row,start,end:position}:row)}:previous);
  setCapturingShort(null);setCaptureStart(null);
  setError('');setMessage(`${t.slotId.replace('short-','Short ')}: ${start.toFixed(1)}s–${position.toFixed(1)}s. Save & approve the Video Plan to keep this selection.`);
 }
 const audioKey=finalAudioKey(assets.audio);
 function accept(next:CreativeWorkspace){setW(next);setSceneDraft(next.scenePlan?JSON.stringify(next.scenePlan.scenes,null,2):'');setInstructions(next.instructions);setBible(next.bible);setPlanDraft(next.plan?{scenes:next.plan.scenes,shorts:next.plan.shorts}:null);}
 async function loadVideos(){try{const v=await json(`${WORKER}/creative/status?projectId=${encodeURIComponent(projectId)}`);setVideos(v);setVideosReady(true);setWorkerError('');return v as Videos;}catch(e){setWorkerError(e instanceof Error?e.message:'Local video worker unavailable.');throw e;}}
 useEffect(()=>{let active=true;setLoaded(false);setError('');json(`/api/creative-workspace?projectId=${encodeURIComponent(projectId)}`).then(d=>{if(active){accept(d.workspace);setCueContext(d.lyricCueContext||null);setLoaded(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[projectId,lyrics,audioKey]);
 useEffect(()=>{let active=true;setVideosReady(false);json(`${WORKER}/creative/status?projectId=${encodeURIComponent(projectId)}`).then(d=>{if(active){setVideos(d);setVideosReady(true);setWorkerError('');}}).catch(e=>{if(active)setWorkerError(e.message);});return()=>{active=false;};},[projectId]);
 async function sync(next:CreativeWorkspace){const keys=Object.fromEntries(outputNamesFor(next).map((name,slot)=>[name,outputKey(next,slot,audioKey)]));await post(`${WORKER}/creative/sync`,{projectId,keys});await loadVideos();}
 async function run(label:string,fn:()=>Promise<void>){if(operation.current)return;operation.current=true;setBusy(label);setError('');setMessage('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Operation failed.');}finally{operation.current=false;setBusy('');}}
 async function command(action:string,body:Record<string,unknown>={},revision=w.revision){
  const d=await post('/api/creative-workspace',{projectId,revision,action,...body});accept(d.workspace);setCueContext(d.lyricCueContext||null);return d.workspace as CreativeWorkspace;
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
  const {upload,localMode}=await post('/api/creative-workspace',{projectId,revision:w.revision,action:'prepare-upload',slotId:slot.id,mimeType:file.type,size:file.size});
  if(localMode){const response=await fetch(upload.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});const data=await response.json();if(!response.ok)throw Error(data.error||'Image upload failed.');}
  else{const {error}=await createClient().storage.from(upload.bucket).uploadToSignedUrl(upload.storagePath,upload.token,file,{contentType:file.type});if(error)throw Error(error.message);}
  await command('register-upload',{slotId:slot.id,storagePath:upload.storagePath});
 }
 async function render(slot:number){
  const fresh=await json(`/api/creative-workspace?projectId=${encodeURIComponent(projectId)}`);
   const current=fresh.workspace as CreativeWorkspace;
   if(current.revision!==w.revision||outputKey(current,slot,audioKey)!==outputKey(w,slot,audioKey)){accept(current);setCueContext(fresh.lyricCueContext||null);throw Error('Video inputs changed. Review the refreshed workspace before rendering.');}
   const prerequisite=renderPrerequisite(current,assets.audio,slot,dirtyPlan);if(prerequisite)throw Error(prerequisite.message);
  const timings=slot===0?w.plan!.scenes:w.plan!.shorts.filter(t=>t.slotId===`short-${slot}`);
  const selected=timings.map(t=>({t,s:w.slots.find(s=>s.id===t.slotId)!}));
  const sequenceIds=slot?(w.shortImageSequences?.[`short-${slot}`]||[]):(w.fullImageSequence||[]);
  if(!sequenceIds.length&&selected.some(({s})=>!approvedCandidate(s)))throw Error('Approve the required visual first.');
  const orderedImages=sequenceIds.map(id=>w.slots.flatMap(s=>s.candidates).find(c=>c.id===id));
  if(sequenceIds.length&&orderedImages.some(c=>!c?.url))throw Error('A selected image is unavailable. Reload the workspace.');
  const {finishing,subtitleSource}=await json(`/api/channel-context?projectId=${encodeURIComponent(projectId)}&layout=${slot===0?'landscape':'portrait'}`);
  const expectedSubtitles=structuredSubtitleFinishing(current,slot);
   if(finishing.structuredSubtitles&&finishing.subtitles&&JSON.stringify(subtitleSource)!==JSON.stringify(current.subtitleContext?.cueContext.source))throw Error('Lyric or audio source changed. Reload before rendering.');
   for(const [key,value] of Object.entries(expectedSubtitles))if(JSON.stringify(finishing[key])!==JSON.stringify(value))throw Error('Subtitle inputs changed. Reload before rendering.');
   if(finishing.channelId!==(w.channelBranding as any)?.channelId||finishing.dnaRevision!==(w.channelBranding as any)?.dnaRevision)throw Error('Channel DNA changed. Reload before rendering.');
  await sync(current);
  await post(`${WORKER}/creative/render`,{finishing,cinematic,projectId,title,slot,audioUrl:assets.audio?.url,durationSeconds:w.analysis!.duration,dependencyKey:outputKey(w,slot,audioKey),visuals:sequenceIds.length?orderedImages.map((c,i)=>({url:c!.url,format:slot===0?'landscape':'vertical',mediaType:'image',imageNumber:i+1})):selected.map(({s})=>({url:approvedCandidate(s)!.url,format:slot===0?'landscape':'vertical',mediaType:'image',imageNumber:s.number})),sceneDurations:slot===0&&sequenceIds.length?w.fullImageDurations:timings.map(t=>t.end-t.start),highlight:slot?{startSeconds:timings[0].start,endSeconds:timings[0].end}:undefined});
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
 const configuredShortCount=w.slots.filter(slot=>slot.kind==='short').length||6;
 const outputNames=outputNamesFor(w);
 const shortNumbers=w.slots.filter(slot=>slot.kind==='short').map(slot=>slot.number).sort((a,b)=>a-b);
 const effectiveShortSelection=selectedShorts.filter(n=>shortNumbers.includes(n));
 const requiredSlots=requiredVisualSlots(w,assets,videos);
 const batch=visualBatchState(w,requiredSlots);
 const requiredVisualsReady=batch.ready;
 const dirtyDirection=instructions!==w.instructions||bible!==w.bible;
 const needsDirection=!!batch.missing.length&&(!w.bible.trim()||w.bible!==w.approvedBible||dirtyDirection);
 const needsScenePlan=!!batch.missing.length&&!w.scenePlan?.reviewed;
 const scenePlanLabel=w.scenePlan?'Approve distinct scene plan':'Plan distinct scenes (text AI)';
 async function prepareScenes(){await command('plan-scenes',{confirmPaid:true});onRefresh();}
 async function approveScenes(){await command('approve-scene-plan');onRefresh();}
 const directionLabel=bible.trim()?(dirtyDirection?'Save & Approve Direction':'Approve Direction'):'Generate Visual Direction';
 async function saveDirection(approve=false){await command('direction',{instructions,bible,approve});onRefresh();}
 async function suggestDirection(){
  // Persist edited instructions with the existing revision before requesting a suggestion.
  const current=dirtyDirection?await command('direction',{instructions,bible}):w;
  await command('propose-direction',{},current.revision);onRefresh();
 }
 async function resolveDirection(){await run(bible.trim()?'Approving direction':'Generating Visual Direction',()=>bible.trim()?saveDirection(true):suggestDirection());}

 async function reloadWorkspace(){const d=await json(`/api/creative-workspace?projectId=${encodeURIComponent(projectId)}`);accept(d.workspace);setCueContext(d.lyricCueContext||null);setLoaded(true);await loadVideos();setBatchNeedsReload(false);}
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
 async function renderSelectedShorts(slots:number[]){await run('Rendering selected Shorts',async()=>{
  const chosen=[...new Set(slots)].filter(slot=>shortNumbers.includes(slot)).sort((a,b)=>a-b);
  if(!chosen.length)throw Error('Select at least one Short.');
  if(!videosReady||workerError)throw Error('Connect the local video worker before rendering.');
  if(dirtyPlan)throw Error('Save and approve the current timing plan before rendering.');
  const problems=chosen.map(slot=>({slot,issue:renderPrerequisite(w,assets.audio,slot,dirtyPlan)})).filter(x=>x.issue);
  if(problems.length)throw Error(problems.map(x=>`Short ${x.slot}: ${x.issue!.message}`).join(' | '));
  setVideoProgress({complete:0,total:chosen.length});
  const failures:string[]=[];
  try{
   for(let i=0;i<chosen.length;i++){
    if(!active.current)break;
    const slot=chosen[i];
    try{await render(slot);}catch(e){failures.push(`Short ${slot}: ${e instanceof Error?e.message:'Render failed'}`);}
    if(active.current)setVideoProgress({complete:i+1,total:chosen.length});
   }
   if(failures.length)throw Error(`Completed ${chosen.length-failures.length}/${chosen.length} Shorts. Saved results are preserved. ${failures.join(' | ')}`);
   setMessage(`Rendered ${chosen.length} Short(s). Preview and approve each individually; nothing was published.`);
  }finally{if(active.current){setVideoProgress(null);await loadVideos();onRefresh();}}
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
  <p>{approvedCount} of {outputNames.length} approved · {videoState.review.length} ready for review · {videoState.missing.length} missing</p>
  {blocker&&<p role="status">{blocker.message}</p>}
  {videoProgress&&<p role="status">Creating your videos… {videoProgress.complete} of {videoProgress.total} complete</p>}
  {videoNeedsReload?<><p>Creation stopped. Saved videos are preserved. Reload before continuing; completed outputs will be skipped.</p><button disabled={!!busy} onClick={()=>void run('Reloading saved videos',async()=>{await reloadWorkspace();setVideoNeedsReload(false);})}>Reload saved videos</button></>:
   <button className={styles.primary} disabled={!!busy||!!workerError||!videosReady||(!complete&&!!w.pending)||blocker?.kind==='timing'||blocker?.kind==='subtitles'} onClick={()=>{
    if(complete){onContinue();return;}
    if(blocker?.kind==='audio'){onNavigate('Final Audio');return;}
    if(blocker?.kind==='visual'){onNavigate('Visuals');return;}
    if(blocker?.kind==='analysis'){void run(!w.slots.length?'Preparing creative workspace':'Analysing audio',!w.slots.length?setup:analyse);return;}
    if(blocker?.kind==='plan'){void run('Approving Video Plan',()=>change('plan',{...planDraft,approve:true}));return;}
    void (videoState.missing.length?createMissingVideos():approveReviewedVideos());
   }}>{complete?'Continue to Social →':blocker?.kind==='audio'?'Add final audio':blocker?.kind==='visual'?'Review required visual':blocker?.kind==='analysis'?(!w.slots.length?'Prepare Video Plan':'Analyse audio & propose timings'):blocker?.kind==='plan'?'Approve Video Plan':blocker?.kind==='timing'?'Correct plan timings below':blocker?.kind==='subtitles'?'Review lyric timings or choose Off':videoState.missing.length?(videoState.missing.length===outputNames.length?'Create Videos':`Create ${videoState.missing.length} Missing Videos`):'Approve reviewed videos'}</button>}
  {!complete&&!blocker&&<p>Play the videos below before approving. Use Change for an individual replacement.</p>}
 </section>;
 const primaryVisualAction=<section className={styles.panel} aria-label="Visuals next step">
  <h3>{needsDirection?'Prepare your Visual Direction':batch.ready?'Your visuals are ready':batch.missing.length?'Ready to create your visuals':'Review your visuals'}</h3>
  {batch.summary&&<p>{batch.summary}</p>}
  <p>{batch.missing.length?`${batch.missing.length} missing ${batch.missing.length===1?'visual':'visuals'}. Generation uses paid image credits. You can change any individual image after they’re created.`:batch.ready?'Continue when you’re happy with your visuals.':'Review the images below and change any exceptions. Approve reviewed visuals together to make them available for rendering.'}</p>
  {!needsDirection&&needsScenePlan&&<p>Plan a different story moment for every image before generating. Planning uses text AI only; review the plan below before any image request.</p>}
  {needsDirection&&<p>{bible.trim()?'Save and approve your current Visual Direction to generate visuals.':'Generate a Visual Direction using AI (paid usage), or write your own below.'}</p>}
  {batchProgress&&<p role="status">{batchProgress.action==='generate'?'Creating your visuals':'Approving reviewed visuals'}… {batchProgress.complete} of {batchProgress.total} complete</p>}
  {!videosReady&&!workerError&&!batch.ready&&<p>Checking saved outputs…</p>}
  {batchNeedsReload&&<p>Batch stopped. Completed work is saved. Reload the workspace before continuing; generation will not retry automatically. <button disabled={!!busy} onClick={()=>void run('Reload',reloadWorkspace)}>Reload saved visuals</button></p>}
  <button className={styles.primary} disabled={!!busy||!!w.pending||batchNeedsReload||(!needsDirection&&!batch.ready&&(!!workerError||!videosReady))} onClick={()=>void (needsDirection?resolveDirection():needsScenePlan?run(scenePlanLabel,w.scenePlan?approveScenes:prepareScenes):generateOrReview())}>{needsDirection?directionLabel:needsScenePlan?scenePlanLabel:batch.missing.length?`Generate ${batch.missing.length} Missing Visuals`:batch.label}</button>
 </section>;

 function selectImageBatch(files:FileList|null){
  setImageBatchError('');setImageBatchProgress('');
  if(!files)return;
  const selected=Array.from(files);
  if(selected.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||!f.size||f.size>100*1024*1024)){setImageBatchError('Choose non-empty JPG, PNG or WebP images under 100 MB each.');setImageBatch([]);return;}
  const slots=w.slots.filter(slot=>['scene','short','cover','thumbnail'].includes(slot.kind));
  if(!slots.length){setImageBatchError('Prepare your visual workspace before importing images.');return;}
  const assignments=selected.map((file,i)=>{
   const stem=file.name.toLowerCase();
   const match=stem.match(/(?:scene|landscape|short|vertical)[-_ ]*0*(\d+)/);
   const kind=/(?:short|vertical)/.test(stem)?'short':/(?:scene|landscape)/.test(stem)?'scene':/thumbnail|thumb/.test(stem)?'thumbnail':/cover|artwork/.test(stem)?'cover':'';
   const numbered=match?slots.find(slot=>slot.kind===kind&&slot.number===Number(match[1])):undefined;
   return {file,slotId:numbered?.id||slots[i%slots.length].id};
  });
  setImageBatch(assignments);
 }
 async function importImageBatch(){
  if(!imageBatch.length)return;
  const ids=imageBatch.map(x=>x.slotId);
  if(new Set(ids).size!==ids.length){setImageBatchError('Assign each image to a different slot for this batch. Import additional versions separately.');return;}
  if(!window.confirm('Import '+imageBatch.length+' images into this project? Existing approvals will be preserved.'))return;
  await run('Importing images',async()=>{
   for(let i=0;i<imageBatch.length;i++){
    const item=imageBatch[i];setImageBatchProgress('Uploading image '+(i+1)+' of '+imageBatch.length+': '+item.file.name);
    try{
     const current=(await json('/api/creative-workspace?projectId='+encodeURIComponent(projectId))).workspace as CreativeWorkspace;
     if(!current.slots.some(x=>x.id===item.slotId))throw Error('Visual slot no longer exists: '+item.slotId);
     const prepared=await post('/api/creative-workspace',{projectId,revision:current.revision,action:'prepare-upload',slotId:item.slotId,mimeType:item.file.type,size:item.file.size});
     if(prepared.localMode){const response=await fetch(prepared.upload.uploadUrl,{method:'PUT',headers:{'Content-Type':item.file.type},body:item.file});const data=await response.json();if(!response.ok)throw Error(data.error||'Image upload failed.');}
     else{const {error}=await createClient().storage.from(prepared.upload.bucket).uploadToSignedUrl(prepared.upload.storagePath,prepared.upload.token,item.file,{contentType:item.file.type});if(error)throw Error(error.message);}
     const saved=await post('/api/creative-workspace',{projectId,revision:current.revision,action:'register-upload',slotId:item.slotId,storagePath:prepared.upload.storagePath});
     accept(saved.workspace);
    }catch(e){setImageBatchProgress('Stopped after '+i+' image(s). Previously uploaded images remain saved.');throw e;}
   }
   setImageBatchProgress('Imported '+imageBatch.length+' images. Review and approve individually.');setImageBatch([]);onRefresh();
  });
 }
 const imageBulkUpload=<section className={styles.panel} aria-label="Bulk image upload">
  <h3>Import multiple images</h3><p>Select JPG, PNG or WebP images, then assign each image to a scene, Short, cover or thumbnail. Nothing is approved automatically.</p>
  <label className={styles.file}>Choose images<input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={!!busy} onChange={e=>{selectImageBatch(e.currentTarget.files);e.currentTarget.value='';}}/></label>
  {imageBatchError&&<p role="alert" className={styles.error}>{imageBatchError}</p>}
  {imageBatch.length>0&&<><ul>{imageBatch.map((item,i)=><li key={i}>{item.file.name} — <select aria-label={'Assign '+item.file.name} value={item.slotId} disabled={!!busy} onChange={e=>setImageBatch(current=>current.map((x,j)=>i===j?{...x,slotId:e.target.value}:x))}>{w.slots.filter(slot=>['scene','short','cover','thumbnail'].includes(slot.kind)).map(slot=><option key={slot.id} value={slot.id}>{slot.label}</option>)}</select></li>)}</ul><button disabled={!!busy} onClick={()=>void importImageBatch()}>Import {imageBatch.length} images</button></>}
  {imageBatchProgress&&<p role="status">{imageBatchProgress}</p>}
 </section>;
 function selectBulk(files:FileList|null){setBulkIssue('');setBulkProgress('');if(!files)return;const parsed:{file:File;slot:number;prefix:string}[]=[];const problems:string[]=[];const seen=new Set<number>();for(const file of Array.from(files)){const m=file.name.match(/^(.+?)\s*[-_–—]\s*(full[\s_-]*video|short[\s_-]*0?[1-6])\.(mp4|mov)$/i);if(!m){problems.push('Unrecognised name: '+file.name);continue;}const slot=/^full/i.test(m[2])?0:Number(m[2].match(/[1-6]/)?.[0]);if(seen.has(slot)){problems.push('Duplicate slot: '+file.name);continue;}seen.add(slot);parsed.push({file,slot,prefix:m[1].trim()});}const prefixes=new Set(parsed.map(x=>x.prefix.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'')));if(prefixes.size>1)problems.push('Different song-name prefixes. Select files for one song only.');if(problems.length){setBulkFiles([]);setBulkIssue(problems.join(' · '));return;}setBulkFiles(parsed.sort((a,b)=>a.slot-b.slot));}
 async function importBulk(){if(!bulkFiles.length)return;if(!window.confirm('Import '+bulkFiles.length+' video(s) to selected song "'+title+'"? Existing approvals remain unchanged.'))return;await run('Importing finished videos',async()=>{for(let i=0;i<bulkFiles.length;i++){const item=bulkFiles[i];setBulkProgress('Uploading '+(i+1)+' of '+bulkFiles.length+': '+item.file.name);try{await uploadVideo(item.slot,item.file);}catch(e){setBulkProgress('Stopped after '+i+' uploads. Earlier files remain saved.');throw e;}}setBulkProgress('Imported '+bulkFiles.length+' videos. Review and approve below.');setBulkFiles([]);});}
 const bulkUpload=stage==='Video & Shorts'?<section className={styles.panel} aria-label="Bulk upload finished videos"><h3>Upload Finished Videos — All at Once</h3><p>No audio, visuals or cloud login required. Selected song: <strong>{title}</strong>.</p><p>Use <code>Song Name - Full Video.mp4</code> and <code>Song Name - Short 01.mp4</code> through <code>Short 06.mp4</code>.</p><label className={styles.file}>Choose multiple videos<input type="file" multiple accept=".mp4,.mov,video/mp4,video/quicktime" disabled={!!busy} onChange={e=>{selectBulk(e.currentTarget.files);e.currentTarget.value='';}}/></label>{bulkIssue&&<p role="alert" className={styles.error}>{bulkIssue}</p>}{bulkFiles.length>0&&<><p>Review assignments:</p><ul>{bulkFiles.map(x=><li key={x.slot}>{x.slot?'Short '+x.slot:'Full Video'} — {x.file.name}</li>)}</ul><button disabled={!!busy||!!workerError||!videosReady} onClick={()=>void importBulk()}>Import {bulkFiles.length} video(s)</button></>}{bulkProgress&&<p role="status">{bulkProgress}</p>}<p>Files create new local versions; no automatic approval, scheduling or publishing.</p></section>:null;
 return <section className={styles.studio} aria-label="Creative production studio">
  <header><p>V5.25 · {stage}</p><h2>{stage==='Visuals'?'Build the visual world':'Review your videos'}</h2><p>Preview, approve and make it yours. Use your own assets, generated assets, or a mix of both.</p>{stage==='Video & Shorts'&&videosReady&&!workerError&&outputNames.every(name=>Boolean(videos.approved[name]))&&<button className={styles.primary} disabled={!!busy} onClick={onContinue}>Continue to Social →</button>}</header>
  {workerError&&<p role="alert" className={styles.error}>{workerError} <button disabled={!!busy} onClick={()=>void (async()=>{setBusy('Checking video connection');try{await loadVideos();}catch{/* The connection message remains visible; never retry a mutation. */}finally{setBusy('');}})()}>Retry video connection</button></p>}
  {error&&<p role="alert" className={styles.error}>{error} <button disabled={!!busy} onClick={()=>void run('Reload',reloadWorkspace)}>Reload workspace</button></p>}
  {w.pending&&<p role="status">A generation request is reserved. If it was interrupted, wait ten minutes before clearing it. Clearing does not retry generation or reverse charges. <button disabled={!!busy} onClick={()=>{if(window.confirm('Clear this interrupted request without retrying generation?'))void run('Clearing interrupted request',()=>change('clear-interrupted'));}}>Clear interrupted request</button></p>}{message&&<p role="status">{message}</p>}{busy&&<p role="status">{busy}…</p>}
  {bulkUpload}
  {!loaded&&stage==='Video & Shorts'?<section className={styles.panel}><h3>Saved local video versions</h3><p>Cloud creative workspace unavailable; local upload and review remain available.</p>{!videosReady?<p>Checking local worker…</p>:<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,260px),1fr))',gap:16,alignItems:'start'}}>{outputNames.map((name,slot)=>{const list=videos.versions.filter(v=>v.slot===slot);return <section key={name} style={{minWidth:0,border:'1px solid var(--border, #ddd)',borderRadius:10,padding:12}}><h4>{slot?'Short '+slot:'Full music video'}</h4>{list.length?list.slice(-1).map(v=><article key={v.id}><video controls preload="metadata" src={v.fileUrl} style={{width:'100%',maxHeight:230,objectFit:'contain',background:'#101827',borderRadius:8}}/><p style={{fontSize:12,overflowWrap:'anywhere'}}>{v.filename}</p><p>{videos.approved[name]===v.id?'✓ Approved':'Awaiting approval'}</p>{videos.approved[name]!==v.id&&<><button disabled={!!busy||!!workerError||(v.source!=='uploaded'&&(!loaded||v.dependencyKey!==outputKey(w,slot,audioKey)))} onClick={()=>void run('Approving reviewed video',async()=>{if(v.source!=='uploaded'){if(!loaded||v.dependencyKey!==outputKey(w,slot,audioKey))throw Error('Generated video cannot be approved until its audio and visual dependencies are verified.');await sync(w);const fresh=await loadVideos();if(fresh.keys[name]!==v.dependencyKey)throw Error('Video inputs have changed. Regenerate before approval.');}await post(`${WORKER}/creative/approve`,{projectId,slot,id:v.id});await loadVideos();onRefresh();})}>Approve this version</button>{v.source==='generated'&&<button disabled={!!busy||!!workerError} onClick={()=>void run('Preparing reviewed finished video',async()=>{if(!window.confirm('Have you watched this video and confirmed it is ready to use as a finished video? The original Universe render will be preserved. This does not approve or publish it.'))return;await post(`${WORKER}/creative/adopt`,{projectId,slot,id:v.id,confirmReviewed:true});await loadVideos();})}>Use as reviewed finished video</button>}{v.source!=='uploaded'&&(!loaded||v.dependencyKey!==outputKey(w,slot,audioKey))&&<p style={{fontSize:12}}>{!videos.keys[name]?'Local dependency record missing; source audio and visuals cannot yet be verified.':videos.keys[name]!==v.dependencyKey?'Local dependency record differs from this render. Regenerate or recover the matching source workspace.':'Saved render dependency matches the local worker record, but the current source audio and visual approvals still need verification before approval.'}</p>}</>}</article>):<p>No saved local version.</p>}</section>;})}</div>}</section>:!loaded?<p>Loading creative workspace…</p>:!w.slots.length&&stage==='Visuals'?<div><p>Existing assets remain in your library. Start the new workspace to review or reuse them; no approvals will be invented.</p><button disabled={!!busy} onClick={()=>void run('Starting workspace',setup)}>Start creative workspace</button></div>:<>
   {stage==='Visuals'?<>
    {primaryVisualAction}
    <section className={styles.panel} aria-label="Visual Direction"><h3>Your Visual Direction</h3><p style={{whiteSpace:'pre-wrap'}}>{bible||"Let Universe suggest a direction, or write your own."}</p><p>{dirtyDirection?'Unsaved direction edits':w.approvedBible===w.bible&&w.bible.trim()?"✓ Direction approved":w.bible.trim()?"Direction awaiting approval":"No Visual Direction yet"}</p>
    {(!w.bible.trim()||w.approvedBible!==bible||dirtyDirection)&&<button disabled={!!busy||!!w.pending} onClick={()=>void resolveDirection()}>{directionLabel}</button>}
    {!bible.trim()&&<p>Direction suggestions use AI (paid usage). Images are generated separately after approval.</p>}
    <details open={!w.bible.trim()||undefined}><summary>{w.bible.trim()?'Change Direction':'Write your own direction'}</summary><h3>Creative Instructions <small>(optional)</small></h3><p>Blank means Universe decides.</p><textarea aria-label="Creative Instructions (optional)" value={instructions} onChange={e=>setInstructions(e.target.value)}/>
    <h3>Visual Direction / Character & World Bible</h3><textarea aria-label="Visual Direction / Character & World Bible" rows={12} placeholder="Write your direction, or ask Universe to propose one. Include characters, wardrobe, places, mood, palette, lighting, camera style, continuity and things to avoid." value={bible} onChange={e=>setBible(e.target.value)}/>
    <div className={styles.actions}><button disabled={!!busy||!!w.pending||!dirtyDirection} onClick={()=>void run('Saving direction',()=>saveDirection())}>Save edits</button><button disabled={!!busy||!!w.pending} onClick={()=>void run('Generating Visual Direction',suggestDirection)}>{dirtyDirection?'Save edits & Generate Visual Direction':'Generate Visual Direction'}</button><button disabled={!!busy||!!w.pending||!bible.trim()||(!dirtyDirection&&w.approvedBible===bible)} onClick={()=>void run('Approving direction',()=>saveDirection(true))}>{w.approvedBible===bible&&bible&&!dirtyDirection?'✓ Direction approved':dirtyDirection?'Save & Approve Direction':'Approve Direction'}</button></div><p>Generating a suggestion uses AI (paid usage) and replaces the current direction draft and scene prompts.</p></details></section>
    <section className={styles.panel} aria-label="Distinct scene plan"><h3>Distinct scene plan</h3><p>The Character Bible preserves identity. Each image gets its own narrative beat, location, characters and action. Repetition is checked before image credits are used.</p>
     {w.scenePlan?<><p>{w.scenePlan.reviewed?'✓ Scene plan reviewed':'Review this scene plan before generating images'}</p><ol>{w.scenePlan.scenes.map(scene=><li key={scene.slotId}><strong>{scene.slotId} · {scene.beat}</strong><p>{scene.state} · {scene.location} · {scene.characters.join(', ')||'Detail / environment'}</p><p>{scene.action} · {scene.composition}</p><small>{scene.evidence.map(e=>e.quote).join(' / ')}</small></li>)}</ol>{!w.scenePlan.reviewed&&<button disabled={!!busy||!!w.pending||dirtyDirection} onClick={()=>void run('Approving distinct scene plan',approveScenes)}>Approve distinct scene plan</button>}</>:<p>No scene plan yet. Existing images are preserved. New generations require a reviewed plan.</p>}
     <button disabled={!!busy||!!w.pending||dirtyDirection||w.approvedBible!==w.bible||!w.bible} onClick={()=>void run('Planning distinct scenes',prepareScenes)}>{w.scenePlan?'Replan scenes (text AI)':'Plan distinct scenes (text AI)'}</button><p>Text planning uses paid AI. This button does not generate images.</p>
     <details><summary>Write or edit scene plan without AI</summary><textarea aria-label="Scene plan JSON" rows={12} value={sceneDraft} onChange={e=>setSceneDraft(e.target.value)} placeholder="Structured scenes with beat, state, location, characters, action, composition and exact lyric/source evidence"/><button disabled={!!busy||!!w.pending||!sceneDraft.trim()||dirtyDirection} onClick={()=>void run('Saving scene plan',async()=>{await command('scene-plan',{scenes:JSON.parse(sceneDraft)});onRefresh();})}>Save scene plan draft</button></details>
    </section>
    <p>{requiredVisualsReady?'✓ Required visual assets approved':'Review the visuals needed for missing outputs, cover and thumbnail.'} Scenes follow suggested song sections; add scenes as needed.</p>
    <button onClick={()=>setShowCompleted(v=>!v)}>{showCompleted?'Show only missing work':'Show completed visuals to replace'}</button><button disabled={!!busy} onClick={()=>void run('Adding scene',()=>change('add-scene'))}>Add landscape scene</button>
    <section className={styles.panel} aria-label="Short count settings"><h3>Number of Shorts</h3><p>Six by default; choose 1–10. Existing images and approvals are preserved. Removing a Short that has saved images is blocked.</p><label>Shorts per song <select aria-label="Shorts per song" disabled={!!busy||!w.slots.length} value={configuredShortCount} onChange={e=>void run('Updating Short count',()=>change('short-count',{count:Number(e.target.value)}))}>{Array.from({length:10},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></label></section>
    {imageBulkUpload}
    <div>{(['scene','short','artwork'] as const).map(group=><section key={group}><h3>{group==='scene'?'Your Music Video Scenes':group==='short'?`Your ${configuredShortCount} Short Visuals`:'Cover Artwork & YouTube Thumbnail'}</h3><div className={styles.grid}>{(showCompleted?w.slots:requiredSlots).filter(slot=>group==='artwork'?['cover','thumbnail'].includes(slot.kind):slot.kind===group).map(slot=><VisualCard key={slot.id} slot={slot} allSlots={w.slots} legacy={[...assets.images,...assets.artwork.map(a=>({...a,existingArtwork:true}))]} busy={!!busy} canGenerate={!!w.scenePlan?.reviewed&&!!w.bible&&w.bible===w.approvedBible&&!dirtyDirection} onPrompt={prompt=>run('Saving prompt',()=>change('prompt',{slotId:slot.id,prompt}))} onUpload={file=>run('Uploading image',()=>uploadImage(slot,file))} onAction={(action,extra)=>run(action==='generate'?'Generating image':'Saving visual',()=>change(action,{slotId:slot.id,...extra}))}/>)}</div></section>)}</div>
    {primaryVisualAction}
   </>:<>
    {assets.audio?.url&&planDraft&&<section aria-label="Choose Short audio clips" className={styles.panel}>
     <h3>1 · Choose song sections for Shorts</h3><p>All Shorts use the same master song. Play the full song, press Set Start, then Stop & Set End; or drag either handle. Shorts may overlap. Listen before saving. Changes to one Short do not move another.</p>
     <audio ref={shortPreviewAudio} src={assets.audio.url} preload="metadata" controls onPause={()=>setPreviewPlaying(false)} onEnded={()=>setPreviewPlaying(false)} onTimeUpdate={e=>{const t=planDraft.shorts.find(x=>x.slotId===previewShort);if(t&&capturingShort!==t.slotId&&e.currentTarget.currentTime>=t.end){e.currentTarget.pause();e.currentTarget.currentTime=t.end;setPreviewPlaying(false);}}}/>
     {planDraft.shorts.map(t=>{const duration=w.analysis?.duration||0;const length=Math.round((t.end-t.start)*10)/10;return <div key={t.slotId} style={{padding:'12px 0',borderBottom:'1px solid var(--border, #ccc)'}}>
      <strong>{t.slotId.replace('short-','Short ')} · {length.toFixed(1)}s</strong>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" disabled={!!busy} onClick={()=>void listenToMaster(t)}>▶ Listen to full song</button><button type="button" disabled={!!busy||!previewPlaying} onClick={()=>setStartWhileListening(t)}>● Set Start</button><button type="button" disabled={!previewPlaying||previewShort!==t.slotId||!!busy} onClick={()=>stopAndSetEnd(t)}>■ Stop & Set End</button><button type="button" disabled={!assets.audio?.url||t.end<=t.start||!!busy} onClick={()=>void previewClip(t)}>{previewPlaying&&previewShort===t.slotId&&capturingShort!==t.slotId?'Pause clip':'▶ Preview selected clip'}</button></div>
      <div aria-label={`${t.slotId} draggable audio selection`} style={{position:'relative',height:46,margin:'14px 8px',touchAction:'none',userSelect:'none'}}>
       <div style={{position:'absolute',left:0,right:0,top:19,height:8,borderRadius:5,background:'#8886'}}/>
       <div style={{position:'absolute',top:19,height:8,left:`${100*t.start/duration}%`,width:`${100*(t.end-t.start)/duration}%`,background:'#16a34a',borderRadius:4,pointerEvents:'none'}}/>
       {(['start','end'] as const).map(field=><button key={field} type="button" aria-label={`${t.slotId} ${field} drag handle`} aria-valuemin={field==='start'?0:t.start+8} aria-valuemax={field==='start'?t.end-8:Math.min(duration,t.start+60)} aria-valuenow={t[field]} title={`${field}: ${t[field].toFixed(1)}s`} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const track=e.currentTarget.parentElement;if(!track)return;const bounds=track.getBoundingClientRect();const seconds=Math.round(Math.max(0,Math.min(duration,(e.clientX-bounds.left)/bounds.width*duration))*10)/10;updateShortTiming(t.slotId,field,seconds);}} onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();updateShortTiming(t.slotId,field,t[field]+(e.key==='ArrowRight'?0.1:-0.1));}}} style={{position:'absolute',left:`calc(${100*t[field]/duration}% - 11px)`,top:8,width:22,height:30,border:'2px solid #fff',borderRadius:6,background:field==='start'?'#15803d':'#1665bd',cursor:'ew-resize',touchAction:'none',padding:0}}/>)}
      </div>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
       <label>Start (s) <input type="number" min={0} max={Math.max(0,t.end-8)} step={0.1} value={t.start} onChange={e=>updateShortTiming(t.slotId,'start',Number(e.target.value))}/></label>
       <label>End (s) <input type="number" min={t.start+8} max={Math.min(duration,t.start+60)} step={0.1} value={t.end} onChange={e=>updateShortTiming(t.slotId,'end',Number(e.target.value))}/></label>
      </div>
     </div>;})}
     <div className={styles.actions}><button disabled={!!busy||!dirtyPlan} onClick={()=>void run('Saving Short clips',()=>change('plan',{...planDraft,approve:false}))}>Save clip selections</button><button disabled={!!busy} onClick={()=>void run('Approving Short clips',()=>change('plan',{...planDraft,approve:true}))}>Save & approve Video Plan</button></div>
     {dirtyPlan&&<p role="status">Unsaved timing changes. Rendering is blocked until you save and approve the updated plan.</p>}
    </section>}
    <UnifiedTimelinePreview workspace={w} audioUrl={assets.audio?.url||""} busy={!!busy} onSequence={async(slot,ids,durations)=>{await run('Updating timeline images',()=>change(slot===0?'full-image-sequence':'short-image-sequence',slot===0?{candidateIds:ids,durations}:{slotId:`short-${slot}`,candidateIds:ids}));}} onBulkUpload={async(slot,files)=>{await run('Uploading timeline images',async()=>{
  if(files.some(file=>!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size<=0||file.size>20*1024*1024))throw Error('Select PNG, JPG or WEBP files up to 20 MB each.');
  const destinations=slot===0?w.slots.filter(s=>s.kind==='scene'):w.slots.filter(s=>s.id===`short-${slot}`);
  if(!destinations.length)throw Error('No image destinations available.');
  if(slot===0&&files.length>100)throw Error('Upload up to 100 images per batch.');
  if(slot!==0&&files.length+(w.shortImageSequences?.[`short-${slot}`]?.length||0)>20)throw Error('A Short can contain at most 20 timeline images.');
  let current=w;const uploadedIds:string[]=[];
  for(let i=0;i<files.length;i++){
   const file=files[i],target=destinations[slot===0?i%destinations.length:0];
   const prepared=await post('/api/creative-workspace',{projectId,revision:current.revision,action:'prepare-upload',slotId:target.id,mimeType:file.type,size:file.size});
   if(prepared.localMode){const response=await fetch(prepared.upload.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});if(!response.ok)throw Error(`Upload failed for ${file.name}`);}
   else{const {error}=await createClient().storage.from(prepared.upload.bucket).uploadToSignedUrl(prepared.upload.storagePath,prepared.upload.token,file,{contentType:file.type});if(error)throw Error(error.message);}
   const before=new Set(current.slots.find(s=>s.id===target.id)?.candidates.map(c=>c.id)||[]);
   current=await command('register-upload',{slotId:target.id,storagePath:prepared.upload.storagePath},current.revision);
   const added=current.slots.find(s=>s.id===target.id)?.candidates.find(c=>!before.has(c.id));
   if(!added)throw Error(`Uploaded ${file.name}, but could not locate its saved image version.`);
   uploadedIds.push(added.id);
  }
  if(slot===0&&uploadedIds.length){const ids=[...(current.fullImageSequence||[]),...uploadedIds];if(ids.length>100)throw Error('Full video supports up to 100 images.');current=await command('full-image-sequence',{candidateIds:ids,durations:ids.map(()=>current.analysis!.duration/ids.length)},current.revision);}
  if(slot!==0&&uploadedIds.length)current=await command('short-image-sequence',{slotId:`short-${slot}`,candidateIds:[...(current.shortImageSequences?.[`short-${slot}`]||[]),...uploadedIds]},current.revision);
  await sync(current);onRefresh();setMessage(`${uploadedIds.length} images uploaded. ${slot===0?'Drag to rearrange full-video images; review each scene before rendering.':'Drag to rearrange your Short images.'}`);
 });}} onUpload={async(slotId,file)=>{const target=w.slots.find(s=>s.id===slotId);if(!target)throw Error('Image slot not found');await run('Uploading timeline image',async()=>{await uploadImage(target,file);const fresh=await json(`/api/creative-workspace?projectId=${encodeURIComponent(projectId)}`);accept(fresh.workspace);onRefresh();});}}/>
    <section className={styles.panel} aria-label="Short image sequences"><h3>2 · Choose images for each Short</h3><p>Add saved scene or Short images in playback order. Each image gets an equal share of the Short duration. Changes affect only that Short; previous video versions are preserved.</p>
    {shortNumbers.map(slot=>{const id=`short-${slot}`,ids=w.shortImageSequences?.[id]||[],candidates=w.slots.filter(s=>s.kind==='scene'||s.kind==='short').flatMap(s=>s.candidates.map((c,i)=>({id:c.id,label:`${s.label} · version ${i+1}`})));return <details key={id}><summary>Short {slot} · {ids.length?ids.length+' selected images':'Default approved image'}</summary>
      <ol>{ids.map((candidateId,index)=><li key={index}>{candidates.find(c=>c.id===candidateId)?.label||'Unavailable image'} <button disabled={!!busy||index===0} onClick={()=>void run('Moving image',()=>change('short-image-sequence',{slotId:id,candidateIds:ids.map((x,i)=>i===index-1?ids[index]:i===index?ids[index-1]:x)}))}>↑</button><button disabled={!!busy||index===ids.length-1} onClick={()=>void run('Moving image',()=>change('short-image-sequence',{slotId:id,candidateIds:ids.map((x,i)=>i===index+1?ids[index]:i===index?ids[index+1]:x)}))}>↓</button><button disabled={!!busy||ids.length===1} onClick={()=>void run('Removing image',()=>change('short-image-sequence',{slotId:id,candidateIds:ids.filter((_,i)=>i!==index)}))}>Remove</button></li>)}</ol>
      <label>Add image <select disabled={!!busy||ids.length>=20} value="" onChange={e=>{if(e.target.value)void run('Adding Short image',()=>change('short-image-sequence',{slotId:id,candidateIds:[...ids,e.target.value]}));}}><option value="">Choose saved image…</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    </details>;})}</section>
    <section className={styles.panel} aria-label="Video cinematic direction">
      <h3>3 · Video direction</h3><p>Choose Basic (original renderer) or Romantic Cinematic. This affects new renders only; previously generated and approved videos remain available.</p>
      <label>Video style <select value={cinematic.mode} disabled={!!busy} onChange={e=>updateCinematic({...cinematic,mode:e.target.value==='romantic'?'romantic':'basic'})}><option value="basic">Basic · original</option><option value="romantic">Romantic Cinematic · warm and soft</option></select></label>
      {cinematic.mode==='romantic'&&<div>
        {(['warmth','contrast','softness','glow','vignette','atmosphere'] as const).map(key=><label key={key} style={{display:'block',margin:'10px 0'}}>{key[0].toUpperCase()+key.slice(1)} · {Math.round(cinematic[key]*100)}% <input aria-label={`Cinematic ${key}`} type="range" min={0} max={1} step={0.05} value={cinematic[key]} onChange={e=>updateCinematic({...cinematic,[key]:Number(e.target.value)})} style={{width:'100%'}}/></label>)}
      </div>}
      {cinematic.mode==='romantic'&&<div style={{margin:'12px 0'}}>
       <label>Animated overlay <select aria-label="Animated overlay" value={cinematic.overlay} disabled={!!busy} onChange={e=>updateCinematic({...cinematic,overlay:e.target.value==='golden-light-leak'?'golden-light-leak':'none'})}><option value="none">None</option><option value="golden-light-leak">Golden Light Leak · moving warm illumination</option></select></label>
       {cinematic.overlay==='golden-light-leak'&&<label style={{display:'block',marginTop:10}}>Overlay intensity · {Math.round(cinematic.overlayIntensity*100)}%<input aria-label="Overlay intensity" type="range" min={0} max={1} step={0.05} value={cinematic.overlayIntensity} onChange={e=>updateCinematic({...cinematic,overlayIntensity:Number(e.target.value)})} style={{width:'100%'}}/></label>}
       <p>Animated overlay is applied in exported MP4 renders, not the still-image preview. Try one Short first; the effect may increase render time.</p>
      </div>}
      <button type="button" onClick={()=>setShowStylePreview(p=>!p)}>{showStylePreview?'Hide':'Show'} style preview</button>
      {showStylePreview&&<div style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:12}}>
        {(['basic','romantic'] as const).map(mode=><div key={mode} style={{width:180}}><strong>{mode==='basic'?'Basic':'Romantic Cinematic'}</strong><div style={{aspectRatio:'9 / 16',overflow:'hidden',borderRadius:8,background:'#333'}}>{(()=>{const candidate=w.slots.flatMap(x=>x.candidates).find(c=>!!c.url);return candidate?.url?<img alt={mode+' approximate still preview'} src={candidate.url} style={{width:'100%',height:'100%',objectFit:'cover',filter:mode==='basic'?'none':`sepia(${cinematic.warmth*0.28}) saturate(${1+cinematic.warmth*0.12}) contrast(${1+cinematic.contrast*0.15}) brightness(${1+cinematic.glow*0.08}) blur(${cinematic.softness*0.5}px)`}}/>:<p style={{padding:12,color:'white'}}>Add an image to preview the style.</p>;})()}</div></div>)}
      </div>}
      <p>Style preview approximates the look on a still image. Render a new candidate to review the actual video with motion, audio, captions and branding.</p>
    </section>
    <section className={styles.panel} aria-label="Shorts batch production"><h3>Produce Shorts · individually or together</h3><p>Select which Shorts to render from their approved images and audio segments. Existing approved videos are preserved; each render creates a reviewable version. No automatic approval or publishing.</p>
     <div className={styles.actions}><button disabled={!!busy} onClick={()=>setSelectedShorts(shortNumbers)}>Select all</button><button disabled={!!busy} onClick={()=>setSelectedShorts([])}>Clear selection</button></div>
     <div className={styles.actions}>{shortNumbers.map(slot=><label key={slot} style={{display:'inline-flex',alignItems:'center',gap:6}}><input type="checkbox" checked={effectiveShortSelection.includes(slot)} disabled={!!busy} onChange={e=>setSelectedShorts(previous=>e.target.checked?[...previous.filter(n=>n!==slot),slot]:previous.filter(n=>n!==slot))}/>Short {slot}</label>)}</div>
     <div className={styles.actions}><button className={styles.primary} disabled={!!busy||!videosReady||!!workerError||!effectiveShortSelection.length} onClick={()=>void renderSelectedShorts(effectiveShortSelection)}>Render {effectiveShortSelection.length||'selected'} Shorts</button></div>
     {videoProgress&&<p role="status">Rendering… {videoProgress.complete} of {videoProgress.total} completed</p>}
    </section>
    {primaryVideoAction}
    <section className={styles.panel}><p>Upload your own missing videos below, or create them from final audio and approved song visuals.</p><h3>{w.plan?.approved?'Your Video Plan is Ready ✓':'Your Video Plan'}</h3><p>{w.plan?.scenes.length||0} scenes · {Math.floor((w.analysis?.duration||0)/60)}:{String(Math.round((w.analysis?.duration||0)%60)).padStart(2,"0")} · {configuredShortCount} Shorts</p><details open={!w.plan?.approved||undefined}><summary>Preview plan</summary><ol>{w.plan?.scenes.map(t=><li key={t.slotId}>{t.label} · {t.start.toFixed(1)}–{t.end.toFixed(1)} seconds</li>)}</ol><ol>{w.plan?.shorts.map(t=><li key={t.slotId}>{t.slotId} · {t.start.toFixed(1)}–{t.end.toFixed(1)} seconds</li>)}</ol><p>Section labels guide the story; they are not precise lyric alignment.</p></details><details><summary>Adjust plan</summary><p>Energy measurements suggest useful audio moments. Labelled lyrics provide section names, not precise alignment. Listen and edit every timing. Motion uses gentle pan and zoom; no text or branding is added over the clean opening.</p>
    {assets.audio?.url&&<audio controls src={assets.audio.url} preload="metadata"/>}<button disabled={!!busy||!assets.audio?.url} onClick={()=>void run('Analysing audio',analyse)}>Analyse audio & propose timings</button>
    {planDraft&&<><p>{w.plan?.approved?'✓ Plan approved':'Plan awaiting review'} · {w.analysis?.duration.toFixed(1)} seconds</p>{(['scenes','shorts'] as const).map(kind=><fieldset key={kind}><legend>{kind==='scenes'?'Full video scene sequence':`${configuredShortCount} Short audio segments`}</legend>{planDraft[kind].map((t,i)=><div key={t.slotId} className={styles.timing}><label>{t.slotId}<input aria-label={`${t.slotId} section label`} value={t.label} onChange={e=>setPlanDraft({...planDraft,[kind]:planDraft[kind].map((r,j)=>j===i?{...r,label:e.target.value}:r)})}/></label><label>Start (seconds)<input type="number" step="0.1" value={t.start} onChange={e=>setPlanDraft({...planDraft,[kind]:planDraft[kind].map((r,j)=>j===i?{...r,start:Number(e.target.value)}:r)})}/></label><label>End (seconds)<input type="number" step="0.1" value={t.end} onChange={e=>setPlanDraft({...planDraft,[kind]:planDraft[kind].map((r,j)=>j===i?{...r,end:Number(e.target.value)}:r)})}/></label></div>)}</fieldset>)}<div className={styles.actions}><button disabled={!!busy} onClick={()=>void run('Saving timings',()=>change('plan',{...planDraft,approve:false}))}>Save plan</button><button disabled={!!busy} onClick={()=>void run('Approving plan',()=>change('plan',{...planDraft,approve:true}))}>Approve Video Plan</button></div></>}
    </details><p>Finished video uploads can be reviewed and approved independently of this render plan.</p></section>
    <section aria-label="Subtitle choice"><h3>Add subtitles to video</h3>
     <label>Add subtitles to video <select aria-label="Add subtitles to video" disabled={!!busy||!w.subtitleContext} value={w.subtitlesEnabled===undefined?'default':w.subtitlesEnabled?'on':'off'} onChange={e=>void run('Saving subtitle choice',()=>change('subtitle-preference',{subtitlesEnabled:e.target.value==='default'?null:e.target.value==='on'}))}>
      <option value="default">Use channel default</option><option value="on">On</option><option value="off">Off</option>
     </select></label>
     <p role="status">{w.subtitleContext?`Effective subtitles: ${subtitleSettings(w)?.enabled?'On':'Off'} · Channel default: ${w.subtitleContext.identity.subtitles.enabled?'On':'Off'}`:'Structured subtitle identity is not configured for this channel.'}</p>
     {subtitleBlocker(w,audioKey)&&<p role="status">{subtitleBlocker(w,audioKey)} Review timings below, or choose Off for a clean render.</p>}
     {!subtitleSettings(w)?.enabled&&<p>No lyric subtitles will be burned in. Saved lyrics and timings remain available for editing in CapCut, Premiere or DaVinci.</p>}
    </section>
    <LyricTimingReview context={cueContext} review={w.lyricCueReview} audioUrl={assets.audio?.url} audioKey={audioKey} busy={!!busy} onSave={body=>run('Saving lyric timings',()=>change('lyric-cues',body))}/>
    <h3>{workerError||!videosReady?'Video review unavailable — reconnect to read saved approvals':complete?'✓ Videos ready — continue to Social':'Review the videos that need your attention'}</h3>
    <fieldset disabled={!!workerError||!videosReady} style={{border:0,padding:0,margin:0}}>
    <div className={styles.grid}>{outputNames.map((name,slot)=>{const list=videos.versions.filter(v=>v.slot===slot);const legacy=slot===0?assets.fullVideos:assets.shorts.filter(v=>Number(v.slot)===slot);const renderVersion=(v:Version)=>{const current=v.source==='uploaded'||v.dependencyKey===outputKey(w,slot,audioKey);const approved=videos.approved[name]===v.id&&current;return <article key={v.id} className={approved?styles.approved:styles.candidate}><video aria-label={`${slot?`Short ${slot}`:'Full video'} preview · version ${list.indexOf(v)+1}`} controls preload="metadata" src={v.fileUrl}/><p>Version {list.indexOf(v)+1} · {v.source==='uploaded'?'Uploaded edit':'Universe render'}{v===list.at(-1)?' · Current review candidate':''}</p><p>{approved?'✓ Approved for publishing':current?'Awaiting your approval':'Needs updating · previous version preserved'}</p><details><summary>Advanced · file details</summary><small>{v.filename}</small></details><div className={styles.actions}><a href={`${v.fileUrl}&download=1`} download>Download</a>{!approved&&v.source==='generated'&&!current&&<button disabled={!!busy} onClick={()=>void run('Preparing reviewed finished video',async()=>{if(!window.confirm('Have you watched this video and confirmed it is ready to use as a finished video? The original Universe render will be preserved. This does not approve or publish it.'))return;await post(`${WORKER}/creative/adopt`,{projectId,slot,id:v.id,confirmReviewed:true});await loadVideos();})}>Use as reviewed finished video</button>}{!approved&&<button disabled={!!busy||approved||!current} onClick={()=>void run('Approving video',async()=>{if(v.source!=='uploaded')await sync(w);await post(`${WORKER}/creative/approve`,{projectId,slot,id:v.id});await loadVideos();onRefresh();})}>Approve this version</button>}</div></article>;};return <section className={styles.panel} key={name}><h3>{slot?`Short ${slot}`:'Full music video'}</h3>{list.length>0&&!list.some(v=>videos.approved[name]===v.id&&(v.source==='uploaded'||v.dependencyKey===outputKey(w,slot,audioKey)))&&<p className={styles.attention}>{list.some(v=>v.source==='uploaded'||v.dependencyKey===outputKey(w,slot,audioKey))?'Ready for your review':`${slot?`Short ${slot}`:'Full video'} needs updating because its inputs changed.`}</p>}<details><summary>Change</summary><div className={styles.actions}><button disabled={!!busy||!!renderPrerequisite(w,assets.audio,slot,dirtyPlan)} onClick={()=>void run(`Rendering ${name}`,()=>render(slot))}>{list.length?'Re-render':'Render'}</button>{legacy.filter(v=>['generated','uploaded'].includes(v._source)).map(v=><button key={v._source} disabled={!!busy} onClick={()=>void run('Preserving existing video',async()=>{await post(`${WORKER}/creative/import`,{projectId,slot,source:v._source});await loadVideos();})}>Use existing {v._source} video</button>)}</div>{list.length>1&&<details><summary>Earlier versions · {list.length-1}</summary>{list.slice(0,-1).map(v=>renderVersion(v))}</details>}</details>
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
