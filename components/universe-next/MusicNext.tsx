'use client';
import {useEffect,useMemo,useState,useCallback,useRef} from 'react';
import Link from 'next/link';
import {loadUniverseChannels} from '@/utils/universe-navigation';
import UniverseSidebar, {channelHref} from './UniverseSidebar';
import {createClient} from '@/utils/supabase/client';
import s from './MusicNext.module.css';
import {loadReleaseState} from '@/utils/release-state';
import LocalReleasePublisher from '@/components/LocalReleasePublisher';
import CreativeStudio from '@/components/creative/CreativeStudio';
import ChannelConnections from './ChannelConnections';
import SocialCopyEditor from './SocialCopyEditor';
import {missingCopy} from '@/utils/social/intake';
import {releaseGaps} from '@/utils/release-gaps';
import {readLyricsFile} from '@/utils/lyrics-import';
import {approvedCandidate,requiredVisualSlots,dependencySyncKeys} from '@/utils/creative/model';

type Theme='auto'|'light'|'dark';
type Stage='Lyrics'|'Suno Style'|'Final Audio'|'Visuals'|'Video & Shorts'|'Social'|'Publish';
type Entry='idea'|'lyrics'|'audio'|'video'|'ready';
type Channel={id:string;name:string;language?:string|null};
type Song={id:string;title?:string|null;idea?:string|null;language?:string|null;script?:string|null;mood?:string|null;genre?:string|null;freedom?:string|number|null;hooks?:string[]|null;selectedHook?:string|null;status?:string|null;lyrics?:string|null};
type ProjectAssets={unavailable?:boolean;creative?:any;creativeVideos?:any;publishingComplete?:boolean;styles:any[];audio:any|null;artwork:any[];images:any[];fullVideos:any[];approvedFullVideoSource:'generated'|'uploaded'|null;shorts:any[];social:{youtubeFull:any|null;youtubeShorts:any|null;platform:any|null};campaign:any|null};
const EMPTY_ASSETS:ProjectAssets={styles:[],audio:null,artwork:[],images:[],fullVideos:[],approvedFullVideoSource:null,shorts:[],social:{youtubeFull:null,youtubeShorts:null,platform:null},campaign:null};
const LOCAL_VIDEO_WORKER='http://127.0.0.1:47123';
async function safeJson(url:string){try{const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)return null;return await r.json()}catch{return null}}
function textValue(v:any){return typeof v==='string'?v.trim():''}
async function copyText(value:string){if(!value)return;await navigator.clipboard.writeText(value)}
function inferAudioMime(file:File){if(file.type)return file.type;const n=file.name.toLowerCase();if(n.endsWith('.wav'))return 'audio/wav';if(n.endsWith('.m4a'))return 'audio/mp4';if(n.endsWith('.aac'))return 'audio/aac';return 'audio/mpeg'}
function inferImageMime(file:File){if(['image/png','image/jpeg','image/webp'].includes(file.type))return file.type;const n=file.name.toLowerCase();if(n.endsWith('.png'))return 'image/png';if(n.endsWith('.webp'))return 'image/webp';if(n.endsWith('.jpg')||n.endsWith('.jpeg'))return 'image/jpeg';return ''}
async function imageDimensions(file:File){return await new Promise<{width:number;height:number}>((resolve,reject)=>{const u=URL.createObjectURL(file);const img=new Image();img.onload=()=>{URL.revokeObjectURL(u);resolve({width:img.naturalWidth,height:img.naturalHeight})};img.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('Universe could not read this image.'))};img.src=u})}
async function videoDetails(file:File){return await new Promise<{durationSeconds:number;width:number;height:number}>((resolve,reject)=>{const u=URL.createObjectURL(file);const v=document.createElement('video');v.preload='metadata';v.onloadedmetadata=()=>{const out={durationSeconds:Number.isFinite(v.duration)?v.duration:0,width:v.videoWidth||0,height:v.videoHeight||0};URL.revokeObjectURL(u);resolve(out)};v.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('Universe could not read this video.'))};v.src=u})}
async function audioDetails(file:File){return await new Promise<{durationSeconds:number}>((resolve,reject)=>{const u=URL.createObjectURL(file);const a=document.createElement('audio');a.preload='metadata';a.onloadedmetadata=()=>{const out={durationSeconds:Number.isFinite(a.duration)?a.duration:0};URL.revokeObjectURL(u);resolve(out)};a.onerror=()=>{URL.revokeObjectURL(u);reject(new Error('Universe could not read this audio.'))};a.src=u})}
async function audioDurationFromUrl(url:string){return await new Promise<number>((resolve,reject)=>{const a=document.createElement('audio');a.preload='metadata';a.onloadedmetadata=()=>resolve(Number.isFinite(a.duration)?a.duration:0);a.onerror=()=>reject(new Error('Universe could not read the final audio duration.'));a.src=url})}
function completedFrom(project:Song,assets:ProjectAssets):Stage[]{
 const done:Stage[]=[];
 if(project.lyrics?.trim())done.push('Lyrics');
 if(assets.styles.length)done.push('Suno Style');
 if(assets.audio)done.push('Final Audio');
 if(assets.creative?.slots?.length&&requiredVisualSlots(assets.creative,assets).every(slot=>!['cover','thumbnail'].includes(slot.kind)&&!!approvedCandidate(slot)))done.push('Visuals');
 const fullApproved=assets.fullVideos.some((x:any)=>x._approved&&x._source!=='staged');const shortSlots=new Set(assets.shorts.filter((x:any)=>x._approved&&x._source!=='staged').map((x:any)=>Number(x.slot)));if(fullApproved&&[1,2,3,4,5,6].every(n=>shortSlots.has(n)))done.push('Video & Shorts');
 const yf=assets.social.youtubeFull?.youtubeFull; const ys=assets.social.youtubeShorts?.youtubeShorts; const pp=assets.social.platform; if(!missingCopy({youtube_full:yf,youtube_shorts:ys,...pp}).length)done.push('Social');
 if(assets.publishingComplete)done.push('Publish');
 return done;
}
const stages:Stage[]=['Lyrics','Suno Style','Final Audio','Visuals','Video & Shorts','Social','Publish'];
const entries:{id:Entry;icon:string;title:string;copy:string;start:Stage}[]=[
 {id:'idea',icon:'✦',title:'Start with an idea',copy:'Turn a thought, story or feeling into lyrics, music direction and a complete release.',start:'Lyrics'},
 {id:'lyrics',icon:'✎',title:'I already have lyrics',copy:'Paste, write or upload your lyrics, then continue with Suno Style and production.',start:'Lyrics'},
 {id:'audio',icon:'♫',title:'I have a finished song',copy:'Upload the final audio. Add lyrics and context optionally for richer release content.',start:'Final Audio'},
 {id:'video',icon:'▶',title:'I have a finished music video',copy:'Upload your finished video, then add or create the missing release assets.',start:'Video & Shorts'},
 {id:'ready',icon:'✓',title:'Bring my existing release',copy:'Add what you already have. Universe will help complete what’s missing.',start:'Final Audio'},
];
function rememberProject(projectId:string){const url=new URL(window.location.href);url.searchParams.delete('new');url.searchParams.delete('stage');url.searchParams.set('projectId',projectId);window.history.replaceState(null,'',url);}
function autoTheme(){const h=new Date().getHours();return h>=7&&h<19?'light':'dark'}
export default function MusicNext(){
 const [pref,setPref]=useState<Theme>('auto'); const [theme,setTheme]=useState<'light'|'dark'>('light'); const [stage,setStage]=useState<Stage>('Lyrics'); const [entry,setEntry]=useState<Entry|null>(null); const [newOpen,setNewOpen]=useState(false); const [enrich,setEnrich]=useState(false);
 const [channels,setChannels]=useState<Channel[]>([]); const [channelId,setChannelId]=useState(''); const [songs,setSongs]=useState<Song[]>([]); const [songId,setSongId]=useState('');
 const [idea,setIdea]=useState(''); const [ideaLanguage,setIdeaLanguage]=useState('Bengali'); const [ideaScript,setIdeaScript]=useState('Native'); const [ideaMood,setIdeaMood]=useState(''); const [ideaGenre,setIdeaGenre]=useState('');
 const [ideaBusy,setIdeaBusy]=useState(false); const [ideaError,setIdeaError]=useState(''); const [ideaProjectId,setIdeaProjectId]=useState(''); const [ideaHooks,setIdeaHooks]=useState<string[]>([]); const [selectedHook,setSelectedHook]=useState(''); const [ideaComplete,setIdeaComplete]=useState(false);
 const [projectTitle,setProjectTitle]=useState('');const intakeStage=useRef<Stage|null>(null);const routedProject=useRef('');
 const creationId=useRef('');
 const lyricsScope=useRef('');lyricsScope.current=`${channelId}:${songId}`;
 const [completedStages,setCompletedStages]=useState<Stage[]>([]);
 const onPublishState=useCallback((complete:boolean)=>setCompletedStages(v=>complete?(v.includes('Publish')?v:[...v,'Publish']):(v.includes('Publish')?v.filter(x=>x!=='Publish'):v)),[]);
 const [projectAssets,setProjectAssets]=useState<ProjectAssets>(EMPTY_ASSETS); const [projectAssetsLoading,setProjectAssetsLoading]=useState(false); const [assetRefresh,setAssetRefresh]=useState(0);
 useEffect(()=>{const saved=(localStorage.getItem('sz-theme') as Theme)||'auto';setPref(saved);setTheme(saved==='auto'?autoTheme():saved)},[]);
 useEffect(()=>{localStorage.setItem('sz-theme',pref);setTheme(pref==='auto'?autoTheme():pref)},[pref]);
 useEffect(()=>{if(typeof window==='undefined')return;const params=new URLSearchParams(window.location.search);if(params.get('new')==='1'){setSongId('');setEntry(null);setEnrich(false);setNewOpen(true);}},[]);
 useEffect(()=>{loadUniverseChannels().then(list=>{setChannels(list);const requested=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('channelId')||'':'';const saved=typeof window!=='undefined'?localStorage.getItem('szu:music:active-channel')||'':'';const chosen=list.find((c:Channel)=>c.id===requested)||list.find((c:Channel)=>c.id===saved)||list[0];if(chosen)setChannelId(chosen.id)}).catch(()=>{})},[]);
 useEffect(()=>{if(!channelId)return;let active=true;setSongs([]);setSongId('');setProjectAssets(EMPTY_ASSETS);setCompletedStages([]);setIdeaProjectId('');setEntry(null);setIdeaComplete(false);setIdeaHooks([]);setSelectedHook('');setIdea('');localStorage.setItem('szu:music:active-channel',channelId);fetch(`/api/songs?channelId=${encodeURIComponent(channelId)}`).then(r=>r.json()).then(d=>{if(!active)return;const list=Array.isArray(d)?d:(d.songs||d.projects||[]);setSongs(list);const requested=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('projectId')||'':'';const fresh=new URLSearchParams(window.location.search).get('new')==='1';const chosen=fresh?undefined:list.find((x:Song)=>x.id===requested)||list[0];setSongId(chosen?.id||'')}).catch(()=>{});return()=>{active=false}},[channelId]);
 const song=useMemo(()=>songId?songs.find(x=>x.id===songId):undefined,[songs,songId]); const channel=channels.find(x=>x.id===channelId)||channels[0];
 function hydrateSongProject(project:Song){
  const savedHooks=Array.isArray(project.hooks)?project.hooks.filter((x):x is string=>typeof x==='string'&&Boolean(x.trim())):[];
  const inferredEntry:Entry=savedHooks.length?'idea':project.lyrics?.trim()?'lyrics':'ready';setProjectTitle(project.title||'');
  setEntry(inferredEntry); const requestedStage=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('stage'):null; if(routedProject.current!==project.id)setStage(intakeStage.current||(stages.includes(requestedStage as Stage)?requestedStage as Stage:'Final Audio'));  setEnrich(false); setNewOpen(false);
  setIdeaProjectId(project.id); setIdea(project.idea||''); setIdeaLanguage(project.language||channel?.language||'Bengali'); setIdeaScript(project.script||'Native'); setIdeaMood(project.mood||''); setIdeaGenre(project.genre||'');
  setIdeaHooks(savedHooks); setSelectedHook(project.selectedHook||(savedHooks[0]||'')); setIdeaComplete(Boolean(project.lyrics?.trim())); setIdeaError('');
  if(routedProject.current!==project.id)setProjectAssets(EMPTY_ASSETS); setCompletedStages(project.lyrics?.trim()?['Lyrics']:[]);
 }
 useEffect(()=>{if(!songId||!song)return;hydrateSongProject(song)},[songId,song]);
 useEffect(()=>{if(!songId||!song)return;let cancelled=false;(async()=>{setProjectAssetsLoading(true);const q=encodeURIComponent(songId);const [styles,audio,artwork,images,localFull,stagedFull,localShorts,stagedShorts,yf,ys,platform,campaign,creative]=await Promise.all([safeJson(`/api/suno-styles?projectId=${q}`),safeJson(`/api/media/final-audio?projectId=${q}`),safeJson(`/api/media/artwork?projectId=${q}`),safeJson(`/api/generate-image?projectId=${q}`),safeJson(`${LOCAL_VIDEO_WORKER}/full-video/status?projectId=${q}`),safeJson(`/api/media/youtube-video?projectId=${q}`),safeJson(`${LOCAL_VIDEO_WORKER}/shorts/status?projectId=${q}`),safeJson(`/api/media/vertical-video?projectId=${q}`),safeJson(`/api/social-media/youtube-full?projectId=${q}`),safeJson(`/api/social-media/youtube-shorts?projectId=${q}`),safeJson(`/api/social-media/platform-pack?projectId=${q}`),safeJson(`/api/publishing/campaigns?projectId=${q}`),safeJson(`/api/creative-workspace?projectId=${q}`)]);
 if(cancelled)return;
 const creativeVideos=await safeJson(`${LOCAL_VIDEO_WORKER}/creative/status?projectId=${q}`);
 let dependencyUnavailable=!creativeVideos;
 const keys=dependencySyncKeys(creative?.workspace,audio,creativeVideos);
 if(keys){
  try{
   if(cancelled)return;
   const sync=await fetch(`${LOCAL_VIDEO_WORKER}/creative/sync`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:songId,keys})});
   if(!sync.ok)throw Error('Creative approvals could not be verified.');
   const [f,ss,v]=await Promise.all([safeJson(`${LOCAL_VIDEO_WORKER}/full-video/status?projectId=${q}`),safeJson(`${LOCAL_VIDEO_WORKER}/shorts/status?projectId=${q}`),safeJson(`${LOCAL_VIDEO_WORKER}/creative/status?projectId=${q}`)]);
   if(!f||!ss||!v)throw Error('Saved video approvals could not be read.');
   Object.assign(localFull||{},f);Object.assign(localShorts||{},ss);Object.assign(creativeVideos,v);
  }catch{
   dependencyUnavailable=true;
   if(localFull)localFull.approvedSource=null;
   for(const slot of localShorts?.slots||[])slot.approvedSource=null;
  }
 }

 const fullVideos:any[]=[]; if(localFull?.generatedVideo)fullVideos.push({...localFull.generatedVideo,source:'Universe generated',_source:'generated',_approved:localFull?.approvedSource==='generated'}); if(localFull?.uploadedVideo)fullVideos.push({...localFull.uploadedVideo,source:'Uploaded',_source:'uploaded',_approved:localFull?.approvedSource==='uploaded'}); if(!fullVideos.length&&stagedFull?.asset)fullVideos.push({...stagedFull.asset,source:'Saved / staged',_source:'staged',_approved:true});
 const shorts:any[]=[]; (Array.isArray(localShorts?.slots)?localShorts.slots:[]).forEach((slot:any)=>{const n=Number(slot?.slot||0);if(slot?.generatedVideo)shorts.push({...slot.generatedVideo,slot:n,source:'Universe generated',_source:'generated',_approved:slot?.approvedSource==='generated'});if(slot?.uploadedVideo)shorts.push({...slot.uploadedVideo,slot:n,source:'Uploaded',_source:'uploaded',_approved:slot?.approvedSource==='uploaded'});}); (stagedShorts?.assets||[]).forEach((a:any)=>{const n=Number(a?.slot||0);if(!shorts.some(x=>Number(x.slot)===n))shorts.push({...a,slot:n,source:'Saved / staged',_source:'staged',_approved:true})});
 const publishing=await loadReleaseState(songId,channelId);
 const next:ProjectAssets={unavailable:dependencyUnavailable||![audio,artwork,localFull,localShorts,yf,ys,platform,creative].every(Boolean),creative:creative?.workspace,creativeVideos,publishingComplete:publishing.complete,styles:Array.isArray(styles?.styles)?styles.styles:[],audio:audio?.asset||null,artwork:Array.isArray(artwork?.assets)?artwork.assets:[],images:Array.isArray(images?.images)?images.images:[],fullVideos,approvedFullVideoSource:localFull?.approvedSource||null,shorts,social:{youtubeFull:yf,youtubeShorts:ys,platform},campaign}; if(!cancelled){setProjectAssets(next);const done=completedFrom(song,next);setCompletedStages(done);if(routedProject.current!==songId&&!next.unavailable){const requested=new URLSearchParams(window.location.search).get('stage');setStage(intakeStage.current||(stages.includes(requested as Stage)?requested as Stage:releaseGaps(song,next,done.includes('Social')).next));intakeStage.current=null;routedProject.current=songId;}setProjectAssetsLoading(false)}})();return()=>{cancelled=true}},[songId,song,channelId,assetRefresh]);
 async function reloadSongs(preferredId?:string){if(!channelId)return;try{const r=await fetch(`/api/songs?channelId=${encodeURIComponent(channelId)}`);const d=await r.json();const list=Array.isArray(d)?d:(d.songs||d.projects||[]);setSongs(list);if(preferredId)setSongId(preferredId);else if(list[0])setSongId(list[0].id);}catch{}}
 function choose(e:Entry){const x=entries.find(v=>v.id===e)!;setEntry(e);creationId.current=crypto.randomUUID();routedProject.current='';setStage(x.start);setSongId('');setNewOpen(false);setEnrich(e!=='lyrics');setProjectTitle('');setIdea('');setIdeaLanguage(channel?.language||'Bengali');setIdeaScript('Native');setIdeaMood('');setIdeaGenre('');setIdeaError('');setIdeaHooks([]);setSelectedHook('');setIdeaProjectId('');setIdeaComplete(false);setProjectAssets(EMPTY_ASSETS);setCompletedStages([]);}
 async function beginProject(){
  if(entry==='idea'||entry==='lyrics'){setEnrich(false);return;}
  const scope=lyricsScope.current;const requestId=creationId.current;setIdeaBusy(true);setIdeaError('');
  try{const r=await fetch('/api/songs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:creationId.current,channelId,title:projectTitle,language:ideaLanguage,idea})});const d=await r.json();if(!r.ok)throw Error(d.error||'Could not save project.');if(scope!==lyricsScope.current||requestId!==creationId.current)return;intakeStage.current=entry==='video'?'Video & Shorts':'Final Audio';setSongs(v=>[d.project,...v]);setSongId(d.project.id);rememberProject(d.project.id);setEnrich(false);}catch(e){setIdeaError(e instanceof Error?e.message:'Could not save project.');}finally{setIdeaBusy(false);}
 }
 async function generateIdeaHooks(){if(!idea.trim()){setIdeaError('Tell Universe what the song should be about.');return;}try{setIdeaBusy(true);setIdeaError('');const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId,title:projectTitle.trim(),idea:idea.trim(),language:ideaLanguage,script:ideaScript,mood:ideaMood.trim(),genre:ideaGenre.trim(),freedom:55})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not generate lyric hooks.');const hooks=Array.isArray(d.hooks)?d.hooks:[];if(!d.projectId||hooks.length!==3)throw new Error('Universe did not return three usable hooks.');rememberProject(String(d.projectId));setIdeaProjectId(String(d.projectId));setIdeaHooks(hooks);setSelectedHook(hooks[0]||'');await reloadSongs(String(d.projectId));}catch(e){setIdeaError(e instanceof Error?e.message:'Could not generate lyric hooks.');}finally{setIdeaBusy(false);}}
 async function writeFullLyrics(){if(!ideaProjectId||!selectedHook.trim())return;try{setIdeaBusy(true);setIdeaError('');const a=await fetch('/api/select-hook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:ideaProjectId,selectedHook})});const ad=await a.json();if(!a.ok)throw new Error(ad.error||'Could not save the selected hook.');const r=await fetch('/api/generate-song',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:ideaProjectId})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not generate the full lyrics.');await reloadSongs(ideaProjectId);setIdeaComplete(true);setCompletedStages(v=>v.includes('Lyrics')?v:[...v,'Lyrics']);}catch(e){setIdeaError(e instanceof Error?e.message:'Could not generate the full lyrics.');}finally{setIdeaBusy(false);}}
 async function saveFullLyrics(lyrics:string,continueToStyle=false){
  if(!lyrics.trim())throw new Error('Lyrics cannot be empty.');
  if(!channelId)throw new Error('Please select a channel.');
  const projectId=songId;const scope=lyricsScope.current;
  const r=await fetch(projectId?'/api/songs/lyrics':'/api/import-lyrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(projectId?{projectId,channelId,lyrics,...(entry==='lyrics'?{title:projectTitle.trim(),idea,language:ideaLanguage,script:ideaScript,mood:ideaMood,genre:ideaGenre}:{})}:{channelId,lyrics,idea,mood:ideaMood,genre:ideaGenre,title:projectTitle.trim()||lyrics.split('\n').find(line=>line.trim()&&!line.trim().startsWith('['))?.trim().slice(0,120)||'Untitled song',language:ideaLanguage,script:ideaScript})});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not save the lyrics.');
  if(lyricsScope.current!==scope)throw new Error('The selected project changed. Reopen the original project to see its saved lyrics.');
  const saved:Song=d.project||{...song,...d.context,id:projectId,lyrics:d.lyrics,status:d.status};
  if(continueToStyle){intakeStage.current='Suno Style';setStage('Suno Style');}rememberProject(saved.id);setSongs(previous=>[saved,...previous.filter(item=>item.id!==saved.id)]);setSongId(saved.id);setIdeaProjectId(saved.id);setIdeaComplete(true);return d;
 }
 async function refineLyrics(sectionName:string,instruction:string){if(!ideaProjectId)throw new Error('Song project is missing.');const r=await fetch('/api/rewrite-section',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:ideaProjectId,sectionName,instruction})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not refine that section.');await reloadSongs(ideaProjectId);return d;}
 function completeAndGo(next:Stage){setCompletedStages(v=>v.includes(stage)?v:[...v,stage]);setStage(next)}
 function backFromStage(){const current=stages.indexOf(stage);if(current<=startIndex){setNewOpen(true);return;}setStage(stages[current-1]);}
 const gaps=song?releaseGaps(song,projectAssets,completedStages.includes('Social')):null;
 const title=song?.title||'Music Production'; const lang=song?.language||channel?.language||'Music'; const startIndex=entry?stages.indexOf(entries.find(x=>x.id===entry)!.start):0; const allComplete=Boolean(gaps&&!projectAssetsLoading&&!projectAssets.unavailable&&!gaps.gaps.length);
 return <div className={s.page} data-theme={theme}><div className={s.layout}>
  <UniverseSidebar context="music" channels={channels} channelId={channelId} stage={stage} onNewProject={()=>{setSongId('');setEntry(null);setEnrich(false);setNewOpen(true)}}/>
  <main className={s.main}><header className={s.topbar}><Link href="/" className={s.homeQuick} title="Universe Home">⌂</Link><select value={channelId} onChange={e=>window.location.assign(channelHref("music",e.target.value,stage))} className={s.search} style={{maxWidth:190}}>{channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><div className={s.search}>⌕ Search music, assets, campaigns…</div><div className={s.theme}>{(['auto','light','dark'] as Theme[]).map(t=><button key={t} onClick={()=>setPref(t)} className={pref===t?s.selected:''}>{t==='auto'?'◐ Auto':t==='light'?'☀ Light':'☾ Dark'}</button>)}</div><button className={s.new} onClick={()=>setNewOpen(true)}>＋ New Music Project</button></header>
   <div className={s.content}>{newOpen?<EntryScreen onChoose={choose} onClose={()=>setNewOpen(false)}/>:<><div className={s.songhead}><div className={s.art}/><div><select value={songId} onChange={e=>{const id=e.target.value;routedProject.current='';setSongId(id);if(id){const url=new URL(window.location.href);url.searchParams.delete('new');url.searchParams.delete('stage');url.searchParams.set('projectId',id);window.history.replaceState(null,'',url);setNewOpen(false);setEnrich(false)}}} className={s.songPicker} aria-label="Select music project"><option value="">New Music Project — select one of your songs</option>{songs.map(x=><option key={x.id} value={x.id}>{x.title||'Untitled song'}</option>)}</select><div className={s.sub}>{channel?.name||'Suno Zara'} · {songId?lang:'New release'}{songId&&allComplete?' · Complete release':entry?` · ${entries.find(x=>x.id===entry)?.title}`:''}</div>{!songId&&songs.length>0&&<div className={s.songPickerHint}>Your songs are still here — choose one above to reopen its saved lyrics, hooks and workflow.</div>}</div><div className={s.badge}>{songId&&allComplete?'✓ RELEASE COMPLETE':'MUSIC PRODUCTION'}</div></div>
    <div className={s.tabs}>{stages.map((t,i)=>{const done=completedStages.includes(t);const notRequired=Boolean((projectAssets.audio||gaps?.full)&&(t==='Lyrics'||t==='Suno Style'));return <button key={t} onClick={()=>setStage(t)} className={`${stage===t?s.tabActive:''} ${done?s.tabDone:''}`}><span style={{opacity:notRequired?.45:1}}>{done?'✓':i+1}</span> {t}{notRequired?' · not required':''}</button>})}</div>
    {song&&gaps&&<section className={s.card} aria-label="Saved release assets"><h3>Your saved release</h3>{projectAssetsLoading?<p>Checking saved assets…</p>:projectAssets.unavailable?<p role="alert">Some saved assets are unavailable. Reconnect before deciding what is missing. <button onClick={()=>setAssetRefresh(v=>v+1)}>Retry</button></p>:<><p>{projectAssets.audio?'Final audio saved · ':''}{gaps.full?'Full video approved · ':''}{gaps.shorts} of 6 Shorts approved</p><p>{gaps.gaps.length?`Still needed: ${gaps.gaps.map(g=>g.label).join(' · ')}`:'Release assets and Social copy are ready.'}</p><button className={s.gradientButton} onClick={()=>setStage(gaps.next)}>Continue to {gaps.next} →</button></>}<details><summary>Add or replace your own assets</summary><div className={s.assetActions}>{(['Final Audio','Visuals','Video & Shorts','Social'] as Stage[]).map(x=><button key={x} onClick={()=>setStage(x)}>{x==='Visuals'?'Cover, thumbnail & visuals':x}</button>)}</div><p>Upload and review through the existing workspaces below. Each saved approval updates this summary.</p></details></section>}
    <div className={s.workspace}><div className={s.stack}>{enrich?<Enrichment title={projectTitle} setTitle={setProjectTitle} language={ideaLanguage} setLanguage={setIdeaLanguage} context={idea} setContext={setIdea} busy={ideaBusy} error={ideaError} onBack={()=>{setEnrich(false);setNewOpen(true)}} onContinue={()=>void beginProject()}/>:stage==='Lyrics'?<IdeaLyricsPanel title={projectTitle} setTitle={setProjectTitle} initialMode={entry==='idea'?'idea':'lyrics'} key={`${channelId}:${songId||'new'}`}  idea={idea} setIdea={setIdea} language={ideaLanguage} setLanguage={setIdeaLanguage} script={ideaScript} setScript={setIdeaScript} mood={ideaMood} setMood={setIdeaMood} genre={ideaGenre} setGenre={setIdeaGenre} busy={ideaBusy} error={ideaError} hooks={ideaHooks} setHooks={setIdeaHooks} selectedHook={selectedHook} setSelectedHook={setSelectedHook} complete={Boolean(song?.lyrics?.trim())} song={song} canReturnToHooks={ideaHooks.length>0} onBackToEntry={()=>setNewOpen(true)} onGenerate={()=>void generateIdeaHooks()} onRetry={()=>{setIdeaHooks([]);setSelectedHook('');setIdeaError('')}} onWrite={()=>void writeFullLyrics()} onSaveLyrics={saveFullLyrics} onRefine={refineLyrics} onContinue={()=>completeAndGo('Suno Style')}/>:songId?<ExistingProjectStage key={`${channelId}:${songId}:${stage}`} stage={stage} song={song} channelId={channelId} assets={projectAssets} loading={projectAssetsLoading} complete={completedStages.includes(stage)} onBack={backFromStage} onRefresh={()=>setAssetRefresh(v=>v+1)} onContinue={(next)=>setStage(next)} onPublishComplete={onPublishState}/>:<StagePanel stage={stage} song={song} entry={entry} onBack={backFromStage} onNew={()=>setNewOpen(true)}/>}</div><Assistant stage={stage} channelId={channelId} channelName={channel?.name||''}/></div></>}
   </div></main>
 </div></div>
}
function EntryScreen({onChoose,onClose}:{onChoose:(e:Entry)=>void;onClose:()=>void}){
 const createEntries=entries.filter(e=>e.id==='idea'||e.id==='lyrics');
 const readyEntries=entries.filter(e=>e.id==='audio'||e.id==='video'||e.id==='ready');
 const meta:Record<Entry,{number:string;kicker:string;route:string;note:string;className:string}>= {
  idea:{number:'01',kicker:'FROM AN IDEA',route:'Lyrics → Suno Style → Full release',note:'Create from scratch',className:s.entryIdea},
  lyrics:{number:'02',kicker:'FROM YOUR LYRICS',route:'Lyrics → Suno Style → Full release',note:'Bring your writing',className:s.entryLyrics},
  audio:{number:'03',kicker:'FINISHED AUDIO',route:'Add audio → Review missing assets → Social',note:'MP3 / WAV',className:s.entryAudio},
  video:{number:'04',kicker:'FINISHED VIDEO',route:'Add video → Complete missing assets → Social',note:'Video ready',className:s.entryVideo},
  ready:{number:'05',kicker:'EXISTING RELEASE',route:'Add assets → Review what’s missing → Complete release',note:'Mix your own assets',className:s.entryReady},
 };
 const card=(e:(typeof entries)[number],featured=false)=><button key={e.id} onClick={()=>onChoose(e.id)} className={`${s.entryCard} ${featured?s.entryFeatured:''} ${meta[e.id].className}`}>
   <div className={s.entryNumber}>{meta[e.id].number}</div>
   <div className={s.entryCardBody}>
    <div className={s.entryTop}><span className={s.entryKicker}>{meta[e.id].kicker}</span><span className={s.entryTag}>{meta[e.id].note}</span></div>
    <h3>{e.title}</h3><p>{e.copy}</p>
    <div className={s.entryRoute}>{meta[e.id].route}</div>
    <div className={s.entryGo}><span>Continue</span><span className={s.entryArrow}>→</span></div>
   </div>
  </button>;
 return <section className={s.entryWrap}>
   <div className={s.entryIntro}>
    <div className={s.entryIntroMeta}><span>NEW MUSIC PROJECT</span><span>MUSIC PRODUCTION</span></div>
    <div className={s.entryIntroGrid}><h1>Bring your song —<br/>or just an idea.</h1><div><p>Universe takes it from there. Start with what you already have. Universe adapts the production workflow around you — without making you repeat finished work.</p><div className={s.entryPromise}><b>One project.</b><span>Any starting point.</span><span>Full social pack included.</span></div></div></div>
   </div>
   <div className={s.entryGroup}><div className={s.entryGroupHead}><div><span>CREATE</span><b>Build the song</b></div><p>Begin with an idea or lyrics you already have.</p></div><div className={s.entryCreateGrid}>{createEntries.map(e=>card(e,true))}</div></div>
   <div className={s.entryGroup}><div className={s.entryGroupHead}><div><span>CONTINUE</span><b>Bring finished music</b></div><p>Universe starts from the asset you already completed.</p></div><div className={s.entryReadyGrid}>{readyEntries.map(e=>card(e))}</div></div>
   <div className={s.entryBottom}><span><b>Your work stays yours.</b> Existing assets are reused and never recreated unless you ask.</span><button onClick={onClose}>Return to current project →</button></div>
  </section>
}

function CreativeContextControls({language,setLanguage,script,setScript,mood,setMood,genre,setGenre}:{language:string;setLanguage:(v:string)=>void;script:string;setScript:(v:string)=>void;mood:string;setMood:(v:string)=>void;genre:string;setGenre:(v:string)=>void}){return <div className={s.creativeOptions}><label><span>Language</span><select value={language} onChange={e=>setLanguage(e.target.value)}>{['Bengali','Hindi','English','Hinglish'].map(v=><option key={v}>{v}</option>)}</select></label><label><span>Script</span><select value={script} onChange={e=>setScript(e.target.value)}><option value="Native">Native script</option><option value="Latin transliteration">Latin transliteration</option></select></label><label><span>Mood <em>optional</em></span><select value={mood} onChange={e=>setMood(e.target.value)}><option value="">Let Universe decide</option>{['Romantic','Intimate','Hopeful','Nostalgic','Melancholic','Bittersweet','Joyful','Dreamy','Energetic','Peaceful','Dark / moody','Playful','Empowering','Devotional / spiritual'].map(v=><option key={v} value={v}>{v}</option>)}</select></label><label><span>Genre / direction <em>optional</em></span><select value={genre} onChange={e=>setGenre(e.target.value)}><option value="">Let Universe decide</option>{['Acoustic / unplugged','Pop','Indie pop','Ballad','Singer-songwriter','Folk / acoustic folk','Soft rock','Rock','Alternative rock','R&B / soul','Lo-fi','Electronic / synth','Cinematic','Classical / orchestral','Devotional / bhakti','Experimental'].map(v=><option key={v} value={v}>{v}</option>)}</select></label></div>;}

function IdeaLyricsPanel({title,setTitle,initialMode,idea,setIdea,language,setLanguage,script,setScript,mood,setMood,genre,setGenre,busy,error,hooks,setHooks,selectedHook,setSelectedHook,complete,song,canReturnToHooks,onBackToEntry,onGenerate,onRetry,onWrite,onSaveLyrics,onRefine,onContinue}:{title:string;setTitle:(v:string)=>void;initialMode:'idea'|'lyrics';idea:string;setIdea:(v:string)=>void;language:string;setLanguage:(v:string)=>void;script:string;setScript:(v:string)=>void;mood:string;setMood:(v:string)=>void;genre:string;setGenre:(v:string)=>void;busy:boolean;error:string;hooks:string[];setHooks:(v:string[])=>void;selectedHook:string;setSelectedHook:(v:string)=>void;complete:boolean;song?:Song;onBackToEntry:()=>void;onGenerate:()=>void;onRetry:()=>void;onWrite:()=>void;onSaveLyrics:(lyrics:string,continueToStyle?:boolean)=>Promise<unknown>;onRefine:(sectionName:string,instruction:string)=>Promise<unknown>;onContinue:()=>void;canReturnToHooks:boolean}){
 const [editingHook,setEditingHook]=useState<number|null>(null);
 const [hookDraft,setHookDraft]=useState('');
 const [view,setView]=useState<'idea'|'hooks'|'lyrics'>(complete?'lyrics':hooks.length?'hooks':initialMode);
 const [editingLyrics,setEditingLyrics]=useState(!complete&&initialMode==='lyrics');
 const [lyricsDraft,setLyricsDraft]=useState(song?.lyrics||'');
 const [saveBusy,setSaveBusy]=useState(false);
 const [panelError,setPanelError]=useState('');
 const [refineOpen,setRefineOpen]=useState(false);
 const [refineSection,setRefineSection]=useState('');
 const [refineInstruction,setRefineInstruction]=useState('');
 useEffect(()=>{if(complete)setView('lyrics');else if(hooks.length)setView('hooks');},[complete,hooks.length]);
 useEffect(()=>{if(song?.lyrics&&!editingLyrics)setLyricsDraft(song.lyrics)},[song?.lyrics,editingLyrics]);
 const currentLyrics=song?.lyrics||lyricsDraft||'';
 const sections=Array.from(new Set((currentLyrics.match(/^\s*\[[^\]]+\]/gm)||[]).map(x=>x.trim())));
 useEffect(()=>{if(!sections.includes(refineSection))setRefineSection(sections[0]||'Full song')},[currentLyrics]);
 function beginEdit(i:number){setEditingHook(i);setHookDraft(hooks[i]||'')}
 function cancelEdit(){setEditingHook(null);setHookDraft('')}
 function saveEdit(i:number){const next=hookDraft.trim();if(!next)return;const old=hooks[i];const updated=hooks.map((h,n)=>n===i?next:h);setHooks(updated);if(selectedHook===old)setSelectedHook(next);setEditingHook(null);setHookDraft('')}
 async function saveLyrics(continueToStyle=false){try{setSaveBusy(true);setPanelError('');await onSaveLyrics(editingLyrics?lyricsDraft:currentLyrics,continueToStyle);setEditingLyrics(false)}catch(e){setPanelError(e instanceof Error?e.message:'Could not save the lyrics.')}finally{setSaveBusy(false)}}
 async function runRefine(){if(!refineSection||!refineInstruction.trim()){setPanelError('Choose a section and tell Universe what you want changed.');return}try{setSaveBusy(true);setPanelError('');await onRefine(refineSection,refineInstruction.trim());setRefineInstruction('');setRefineOpen(false)}catch(e){setPanelError(e instanceof Error?e.message:'Could not refine that section.')}finally{setSaveBusy(false)}}
 const fileInput=useRef<HTMLInputElement>(null);
 async function importFile(file:File){try{setPanelError('');setSaveBusy(true);const text=await readLyricsFile(file);setLyricsDraft(text);setEditingLyrics(true);setRefineOpen(false);setView('lyrics')}catch(e){setPanelError(e instanceof Error?e.message:'Could not read this file.')}finally{setSaveBusy(false)}}
 const entryTools=<div className={s.lyricTools}>
  <button className={s.secondaryButton} disabled={saveBusy||busy} onClick={()=>setView('idea')}>Generate from an idea</button>
  <button className={s.secondaryButton} disabled={saveBusy||busy} onClick={()=>{setView('lyrics');setEditingLyrics(true);setRefineOpen(false)}}>Write or paste lyrics</button>
  <button className={s.secondaryButton} disabled={saveBusy||busy} onClick={()=>fileInput.current?.click()}>Upload lyrics (TXT)</button>
  <input ref={fileInput} type="file" accept=".txt,text/plain" hidden aria-label="Upload lyrics file" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void importFile(file)}}/>
  <small>TXT files only. For DOCX or PDF, copy and paste the text.</small>
 </div>;
 if(view==='lyrics')return <section className={`${s.card} ${s.ideaPanel}`}>{entryTools}<div className={s.pageBackRow}><button className={s.backButton} onClick={()=>{setEditingLyrics(false);setRefineOpen(false);if(canReturnToHooks)setView('hooks');else onBackToEntry()}}>{canReturnToHooks?'← Back to hooks':'← Back to starting points'}</button><span className={s.stepComplete}>{complete?'✓ Lyrics saved':'Write, paste or upload your lyrics'}</span></div><div className={s.ideaStepRow}><div><div className={s.eyebrow}>Lyrics</div><h2>{complete?'Your lyrics':'Write or paste your lyrics'}</h2><p>{initialMode==='lyrics'?'Bring your words and tell Universe how the song should feel. Your lyrics are saved as written.':'Read it as a song, not as a final answer. Edit any line directly or refine one section with Universe before moving to the sound.'}</p></div>{complete&&<span className={s.readyPill}>✓ LYRICS SAVED</span>}</div>{initialMode==='lyrics'&&<><div className={s.creativeOptions}><label><span>Song title</span><input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} placeholder="Name your song"/></label></div><CreativeContextControls language={language} setLanguage={setLanguage} script={script} setScript={setScript} mood={mood} setMood={setMood} genre={genre} setGenre={setGenre}/></>}{editingLyrics?<textarea aria-label="Full lyrics" placeholder="Write or paste your lyrics here…" disabled={saveBusy} className={s.lyricsEditor} value={lyricsDraft} onChange={e=>setLyricsDraft(e.target.value)} rows={22}/>:<div className={s.lyricsPreview}>{currentLyrics||'The lyrics were generated and saved to this project. Reload the project if the text has not appeared yet.'}</div>}<div className={s.lyricTools}>{editingLyrics?<><button className={s.secondaryButton} disabled={saveBusy} onClick={()=>{setEditingLyrics(!complete);setLyricsDraft(song?.lyrics||'')}}>Cancel</button>{initialMode!=='lyrics'&&<button className={s.gradientButton} disabled={saveBusy||!lyricsDraft.trim()} onClick={()=>void saveLyrics()}>{saveBusy?'Saving…':'Save full lyrics'}</button>}</>:<><button className={s.secondaryButton} onClick={()=>void copyText(currentLyrics)}>Copy lyrics</button><button className={s.secondaryButton} onClick={()=>{setLyricsDraft(currentLyrics);setEditingLyrics(true);setRefineOpen(false)}}>Edit full lyrics</button><button className={s.secondaryButton} onClick={()=>{setRefineOpen(v=>!v);setEditingLyrics(false)}}>{refineOpen?'Close refine':'Refine a section'}</button></>}</div>{refineOpen&&<div className={s.refinePanel}><div><span>SECTION TO REFINE</span><select value={refineSection} onChange={e=>setRefineSection(e.target.value)}>{sections.length?sections.map(x=><option key={x} value={x}>{x}</option>):<option value="Full song">Full song</option>}</select></div><label><span>WHAT SHOULD CHANGE?</span><textarea value={refineInstruction} onChange={e=>setRefineInstruction(e.target.value)} rows={3} placeholder="Example: Make this verse more intimate and conversational, but keep the meaning."/></label><div className={s.refineActions}><span>Only this section will be rewritten. The previous version is preserved by the existing Universe rewrite flow.</span><button className={s.gradientButton} disabled={saveBusy||!refineInstruction.trim()} onClick={()=>void runRefine()}>{saveBusy?'Refining…':'Refine section →'}</button></div></div>}{initialMode==='lyrics'&&<label className={s.ideaPrompt}><span>Creative notes / song context <em>optional</em></span><textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={4} placeholder="Long-distance love, intimate rather than sad, gradually hopeful…"/><small>Add story, emotional intent or pronunciation guidance. Detailed sound and production choices come next in Song Style.</small></label>}{(error||panelError)&&<div className={s.formError}>{panelError||error}</div>}<div className={s.ideaActions}><span>{canReturnToHooks?'You can always return to the hooks or edit these lyrics again later.':'These saved lyrics remain editable at any time.'}</span>{initialMode==='lyrics'?<button className={s.gradientButton} disabled={saveBusy||!title.trim()||!(editingLyrics?lyricsDraft:currentLyrics).trim()} onClick={()=>void saveLyrics(true)}>{saveBusy?'Saving…':'Save & Continue to Song Style →'}</button>:<button className={s.gradientButton} disabled={!complete||editingLyrics||saveBusy} onClick={onContinue}>Continue to Song Style →</button>}</div></section>;
 if(view==='hooks')return <section className={`${s.card} ${s.ideaPanel}`}><div className={s.pageBackRow}><button className={s.backButton} onClick={()=>setView('idea')}>← Back to song idea</button>{complete&&<button className={s.textLinkButton} onClick={()=>setView('lyrics')}>Return to full lyrics →</button>}</div><div className={s.ideaStepRow}><div><div className={s.eyebrow}>Lyrics · step 2 of 2</div><h2>Choose the hook that should lead the song</h2><p>Universe created three distinct hook directions from your idea. Choose one as-is or edit the wording until it feels exactly right — the full lyrics will be written around your final version.</p></div><span className={s.quietPill}>{complete?'✓ HOOK COMPLETE':'3 HOOKS'}</span></div><div className={s.hookList}>{hooks.map((hook,i)=>{const selected=selectedHook===hook;const editing=editingHook===i;return <div key={`${i}-${hook}`} className={`${s.hookChoice} ${selected?s.hookSelected:''}`}><button className={s.hookSelect} onClick={()=>{if(!editing)setSelectedHook(hook)}} aria-label={`Choose hook ${i+1}`}><span>{selected?'✓':`0${i+1}`}</span></button><div className={s.hookBody}>{editing?<textarea className={s.hookEditor} value={hookDraft} onChange={e=>setHookDraft(e.target.value)} autoFocus rows={3}/>:<b onClick={()=>setSelectedHook(hook)}>{hook}</b>}<div className={s.hookMeta}>{selected&&!editing?<span>Selected</span>:!editing?<span>Generated hook</span>:<span>Editing — make it yours</span>}</div></div><div className={s.hookTools}>{editing?<><button className={s.hookTextButton} onClick={()=>saveEdit(i)} disabled={!hookDraft.trim()}>Save</button><button className={s.hookTextButton} onClick={cancelEdit}>Cancel</button></>:<><button className={s.hookTextButton} onClick={()=>beginEdit(i)}>Edit</button><button className={s.hookChooseButton} onClick={()=>setSelectedHook(hook)}>{selected?'✓ Chosen':'Choose'}</button></>}</div></div>})}</div><div className={s.hookNote}><b>Not quite there?</b><span>Edit the closest hook, or ask Universe for three completely different directions.</span></div>{error&&<div className={s.formError}>{error}</div>}<div className={s.ideaActions}><button className={s.secondaryButton} disabled={busy} onClick={()=>{onRetry();setView('idea')}}>Generate 3 different hooks</button><button className={s.gradientButton} disabled={busy||!selectedHook||editingHook!==null} onClick={onWrite}>{busy?'Writing the full song…':complete?'Rewrite full lyrics from this hook →':'Use chosen hook & write full lyrics →'}</button></div></section>;
 return <section className={`${s.card} ${s.ideaPanel}`}>{entryTools}{panelError&&<div role="alert" className={s.formError}>{panelError}</div>}<div className={s.pageBackRow}><button className={s.backButton} onClick={onBackToEntry}>← Back to starting points</button>{complete&&<button className={s.textLinkButton} onClick={()=>setView('lyrics')}>Return to full lyrics →</button>}</div><div className={s.ideaStepRow}><div><div className={s.eyebrow}>Lyrics · step 1 of 2</div><h2>Tell Universe what you want to write</h2><p>You only need the seed of the song. A feeling, memory, situation or one sentence is enough. The extra direction below is optional.</p></div><span className={s.quietPill}>START SIMPLE</span></div><label className={s.ideaPrompt}><span>YOUR IDEA</span><textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={6} placeholder="Example: A Bengali romantic song about leaving the window light on for someone who may finally come home…"/><small>Write naturally. Universe will turn this into three possible hooks before writing the full lyrics.</small></label><CreativeContextControls language={language} setLanguage={setLanguage} script={script} setScript={setScript} mood={mood} setMood={setMood} genre={genre} setGenre={setGenre}/><div className={s.ideaHint}><b>What happens next?</b><span>Universe creates 3 polished, different hooks → you can edit any of them → choose one → it writes the full lyrics around your final hook.</span></div>{error&&<div className={s.formError}>{error}</div>}<div className={s.ideaActions}><span>Nothing here locks the song. You can rewrite every part later.</span><button className={s.gradientButton} disabled={busy} onClick={onGenerate}>{busy?'Creating hooks…':'Generate 3 hooks →'}</button></div></section>
}

function ExistingProjectStage({stage,song,channelId,assets,loading,complete,onBack,onRefresh,onContinue,onPublishComplete}:{stage:Stage;song?:Song;channelId:string;assets:ProjectAssets;loading:boolean;complete:boolean;onBack:()=>void;onRefresh:()=>void;onContinue:(next:Stage)=>void;onPublishComplete?:(complete:boolean)=>void}){
 const [busy,setBusy]=useState('');
 const [message,setMessage]=useState('');
 const [actionError,setActionError]=useState('');const [socialRefresh,setSocialRefresh]=useState(0);
 const [editingStyle,setEditingStyle]=useState<number|null>(null);
 const [styleNameDraft,setStyleNameDraft]=useState('');
 const [stylePromptDraft,setStylePromptDraft]=useState('');
 const [styleDirection,setStyleDirection]=useState('');
 const [visualPlan,setVisualPlan]=useState<any|null>(null);
 const [visualConcepts,setVisualConcepts]=useState<any[]>([]);
 const [selectedConceptId,setSelectedConceptId]=useState('');
 const [visualDirection,setVisualDirection]=useState('');
 const projectId=song?.id||'';
 const socialCopy={youtube_full:assets.social.youtubeFull?.youtubeFull,youtube_shorts:assets.social.youtubeShorts?.youtubeShorts,...(assets.social.platform||{})};
 const hasSocialPack=missingCopy(socialCopy).length<missingCopy(null).length;
 const header=<div className={s.pageBackRow}><button className={s.backButton} onClick={onBack}>← Back</button>{complete&&<span className={s.stageComplete}>✓ {stage} complete</span>}</div>;

 useEffect(()=>{
  if(!projectId||stage!=='Visuals')return;
  let cancelled=false;
  (async()=>{
   const [planData,conceptData]=await Promise.all([safeJson(`/api/production-plan?projectId=${encodeURIComponent(projectId)}`),safeJson(`/api/image-concepts?projectId=${encodeURIComponent(projectId)}`)]);
   if(cancelled)return;
   if(planData?.plan)setVisualPlan(planData.plan);
   const concepts=Array.isArray(conceptData?.concepts)?conceptData.concepts:Array.isArray(planData?.plan?.concepts)?planData.plan.concepts:[];
   setVisualConcepts(concepts);
   setSelectedConceptId(conceptData?.selectedConceptId||planData?.plan?.selectedConceptId||concepts.find((x:any)=>x.selected)?.id||concepts[0]?.id||'');
  })();
  return()=>{cancelled=true};
 },[projectId,stage]);

 async function uploadAudio(file:File|null){
  if(!file||!projectId||busy==='audio')return;
  try{
   setBusy('audio');setActionError('');setMessage('Inspecting final audio…');
   const mimeType=inferAudioMime(file);const meta=await audioDetails(file);
   const prep=await fetch('/api/media/final-audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare',projectId,originalFilename:file.name,mimeType,sizeBytes:file.size})});
   const pd=await prep.json();if(!prep.ok)throw new Error(pd.error||'Could not prepare audio upload.');
   const upload=pd.upload;const supabase=createClient();const {error}=await supabase.storage.from(upload.bucket||'song-media').uploadToSignedUrl(upload.storagePath,upload.token,file,{contentType:mimeType});if(error)throw new Error(error.message);
   const reg=await fetch('/api/media/final-audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'register',projectId,storagePath:upload.storagePath,originalFilename:file.name,mimeType,sizeBytes:file.size,metadata:{source:'uploaded-from-v5',durationSeconds:meta.durationSeconds}})});
   const rd=await reg.json();if(!reg.ok)throw new Error(rd.error||'Could not save final audio.');
   setMessage(`✓ Final audio saved${meta.durationSeconds?` · ${Math.round(meta.durationSeconds)}s`:''}`);onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not upload final audio.')}finally{setBusy('')}
 }

 async function uploadArtwork(kind:'cover-art'|'thumbnail',file:File|null){
  if(!file||!projectId)return;
  try{
   setBusy(kind);setActionError('');setMessage(`Preparing ${kind==='cover-art'?'artwork':'thumbnail'}…`);
   const mimeType=inferImageMime(file);if(!mimeType)throw new Error('Please choose a PNG, JPG or WEBP image.');
   const dims=await imageDimensions(file);
   if(kind==='cover-art'&&dims.width!==dims.height)throw new Error(`Cover artwork should be square. This image is ${dims.width}×${dims.height}.`);
   if(kind==='thumbnail'&&Math.abs(dims.width/dims.height-16/9)>.03)throw new Error(`YouTube thumbnail should be 16:9. This image is ${dims.width}×${dims.height}.`);
   const prep=await fetch('/api/media/artwork',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'prepare',projectId,mediaKind:kind,originalFilename:file.name,mimeType,sizeBytes:file.size})});
   const pd=await prep.json();if(!prep.ok)throw new Error(pd.error||'Could not prepare artwork upload.');
   const upload=pd.upload;const supabase=createClient();const {error}=await supabase.storage.from(upload.bucket||'song-media').uploadToSignedUrl(upload.storagePath,upload.token,file,{contentType:mimeType});if(error)throw new Error(error.message);
   const reg=await fetch('/api/media/artwork',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'register',projectId,mediaKind:kind,storagePath:upload.storagePath,originalFilename:file.name,mimeType,sizeBytes:file.size,width:dims.width,height:dims.height})});
   const rd=await reg.json();if(!reg.ok)throw new Error(rd.error||'Could not save artwork.');setMessage(`✓ ${kind==='cover-art'?'Artwork':'Thumbnail'} saved`);onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not upload artwork.')}finally{setBusy('')}
 }

 async function saveStyle(index:number){
  if(!projectId)return;
  try{
   setBusy(`style-${index}`);setActionError('');
   const next=assets.styles.map((x:any,i:number)=>i===index?{...x,name:styleNameDraft.trim()||x.name,prompt:stylePromptDraft.trim()}:x);
   const r=await fetch('/api/suno-styles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',projectId,styles:next})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not save Suno Style.');
   setEditingStyle(null);setMessage('✓ Suno Style saved');onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not save Suno Style.')}finally{setBusy('')}
 }

 async function generateStyles(){
  if(!projectId)return;
  if(assets.styles.length&&typeof window!=='undefined'&&!window.confirm('Regenerating will replace the current saved Suno Style set for this song. Continue?'))return;
  try{
   setBusy('generate-styles');setActionError('');setMessage('Universe is reading the lyrics and creating 5–8 production directions…');
   const r=await fetch('/api/suno-styles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'generate',projectId,additionalDirection:styleDirection.trim()})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not generate Suno Styles.');
   setMessage(`✓ ${Array.isArray(d.styles)?d.styles.length:'New'} Suno Styles generated`);onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not generate Suno Styles.')}finally{setBusy('')}
 }

 async function prepareVisualPlan(force=false){
  if(!projectId){setActionError('Song project is missing.');return null;}
  if(force&&visualConcepts.length&&typeof window!=='undefined'&&!window.confirm('Create three new visual directions? Existing generated images stay in the Library, but the current visual concept set will be replaced.'))return null;
  try{
   setBusy('visual-plan');setActionError('');setMessage('Universe is preparing one reusable visual plan…');
   const r=await fetch('/api/production-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,additionalDirection:visualDirection.trim(),preserveStyles:true,force})});
   const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not prepare the visual plan.');
   const plan=d.plan||null;const concepts=Array.isArray(d.concepts)?d.concepts:Array.isArray(plan?.concepts)?plan.concepts:[];
   setVisualPlan(plan);setVisualConcepts(concepts);
   const selected=plan?.selectedConceptId||concepts.find((x:any)=>x.selected)?.id||concepts[0]?.id||'';
   if(selected){
    const sr=await fetch('/api/image-concepts',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,conceptId:selected})});
    if(!sr.ok){const sd=await sr.json().catch(()=>({}));throw new Error(sd.error||'Could not select the visual direction.');}
    setSelectedConceptId(selected);
   }
   setMessage(`✓ Visual plan ready · ${concepts.length||3} directions`);return {plan,concepts,selected};
  }catch(e){setActionError(e instanceof Error?e.message:'Could not prepare the visual plan.');return null;}finally{setBusy('')}
 }

 async function chooseVisualConcept(id:string){
  if(!projectId||!id)return;
  try{
   setBusy('select-concept');setActionError('');
   const r=await fetch('/api/image-concepts',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,conceptId:id})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not select this concept.');
   setSelectedConceptId(id);setMessage('✓ Visual direction selected');
  }catch(e){setActionError(e instanceof Error?e.message:'Could not select visual direction.')}finally{setBusy('')}
 }

 async function generateVisualSet(which:'youtube'|'shorts'|'all'){
  if(!projectId)return;
  try{
   setActionError('');
   let plan=visualPlan;let concepts=visualConcepts;let conceptId=selectedConceptId;
   if(!plan||!concepts.length){const prepared=await prepareVisualPlan(false);if(!prepared)return;plan=prepared.plan;concepts=prepared.concepts;conceptId=prepared.selected;}
   if(!conceptId)conceptId=concepts[0]?.id||'';
   if(!conceptId)throw new Error('Choose a visual direction first.');
   if(selectedConceptId!==conceptId)await chooseVisualConcept(conceptId);
   const formats=(which==='all'?['youtube','shorts']:[which]) as Array<'youtube'|'shorts'>;
   setBusy(`generate-${which}`);
   for(const format of formats){
    const briefs=Array.isArray(format==='youtube'?plan?.landscapeBriefs:plan?.verticalBriefs)?(format==='youtube'?plan.landscapeBriefs:plan.verticalBriefs):[];
    const count=format==='youtube'?3:6;
    if(briefs.length<count)throw new Error(`The saved production plan does not contain ${count} ${format==='youtube'?'landscape':'vertical'} shot briefs.`);
    setMessage(`Preparing ${format==='youtube'?'3 landscape visuals':'6 vertical visuals'}…`);
    const setR=await fetch('/api/image-sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,conceptId,format})});const setD=await setR.json();if(!setR.ok)throw new Error(setD.error||'Could not prepare image set.');
    const imageSetId=setD.imageSet?.id||'';
    for(let i=1;i<=count;i+=1){
     setMessage(`Generating ${format==='youtube'?'landscape':'vertical'} visual ${i} of ${count}…`);
     const brief=briefs[i-1]?.brief||'';
     const r=await fetch('/api/generate-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,conceptId,format,imageNumber:i,imageSetId,shotBrief:brief,imageUseSongTitle:false,imageIncludeBranding:false})});
     const d=await r.json();if(!r.ok)throw new Error(d.error||`Could not generate visual ${i}.`);
    }
   }
   setMessage(`✓ ${which==='all'?'9 release visuals':which==='youtube'?'3 landscape visuals':'6 vertical visuals'} generated`);onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not generate visuals.')}finally{setBusy('')}
 }

 async function uploadEditedVideo(file:File|null){
  if(!file||!projectId||!song)return;
  try{
   setBusy('video');setActionError('');if(!['video/mp4','video/quicktime'].includes(file.type))throw new Error('Please upload an MP4 or MOV video.');
   setMessage('Inspecting edited video…');const meta=await videoDetails(file);const params=new URLSearchParams({projectId,title:song.title||song.idea||'Untitled song',filename:file.name,mimeType:file.type||'video/mp4',sizeBytes:String(file.size),durationSeconds:String(meta.durationSeconds),width:String(meta.width),height:String(meta.height)});
   setMessage('Uploading edited video…');const r=await fetch(`${LOCAL_VIDEO_WORKER}/full-video/upload?${params.toString()}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});const d=await r.json();if(!r.ok||!d?.video)throw new Error(d?.error||'Could not upload edited video.');
   setMessage('✓ Edited video uploaded — choose which version to publish');onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not upload edited video.')}finally{setBusy('')}
 }

 async function approveVideo(source:'generated'|'uploaded'){
  if(!projectId)return;
  try{setBusy(`approve-${source}`);setActionError('');const r=await fetch(`${LOCAL_VIDEO_WORKER}/full-video/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,source})});const d=await r.json();if(!r.ok)throw new Error(d?.error||'Could not choose this video.');setMessage(`✓ ${source==='generated'?'Universe-generated':'Uploaded edited'} video selected for publishing`);onRefresh()}catch(e){setActionError(e instanceof Error?e.message:'Could not choose publishing video.')}finally{setBusy('')}
 }

 async function uploadShort(slot:number,file:File|null){
  if(!file||!projectId||!song)return;
  try{
   setBusy(`short-upload-${slot}`);setActionError('');if(!['video/mp4','video/quicktime'].includes(file.type))throw new Error('Please upload an MP4 or MOV Short.');
   const meta=await videoDetails(file);const params=new URLSearchParams({projectId,title:song.title||song.idea||'Untitled song',slot:String(slot),filename:file.name,mimeType:file.type||'video/mp4',sizeBytes:String(file.size),durationSeconds:String(meta.durationSeconds),width:String(meta.width),height:String(meta.height)});
   setMessage(`Uploading edited Short ${slot}…`);const r=await fetch(`${LOCAL_VIDEO_WORKER}/short/upload?${params.toString()}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});const d=await r.json();if(!r.ok||!d?.video)throw new Error(d?.error||`Could not upload Short ${slot}.`);
   setMessage(`✓ Edited Short ${slot} uploaded`);onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:`Could not upload Short ${slot}.`)}finally{setBusy('')}
 }

 async function approveShort(slot:number,source:'generated'|'uploaded'){
  if(!projectId)return;
  try{
   setBusy(`short-approve-${slot}-${source}`);setActionError('');const r=await fetch(`${LOCAL_VIDEO_WORKER}/short/approve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,slot,source})});const d=await r.json();if(!r.ok)throw new Error(d?.error||`Could not choose Short ${slot}.`);
   setMessage(`✓ Short ${slot} publishing version selected`);onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:`Could not choose Short ${slot}.`)}finally{setBusy('')}
 }

 async function getAudioDuration(){
  const stored=Number(assets.audio?.metadata?.durationSeconds||assets.audio?.durationSeconds||0);if(stored>0)return stored;
  const url=textValue(assets.audio?.url);if(!url)throw new Error('Upload Final Audio before generating video.');
  const duration=await audioDurationFromUrl(url);if(!duration)throw new Error('Universe could not determine the final audio duration.');return duration;
 }

 function releaseVisuals(prefer:'landscape'|'vertical'){
  const desired=assets.images.filter((x:any)=>prefer==='vertical'?x.format==='shorts':x.format==='youtube').map((x:any,i:number)=>({url:x.url,format:prefer,mediaType:'image',imageNumber:Number(x.imageNumber||i+1),label:x.title||''})).filter((x:any)=>x.url);
  if(desired.length)return desired;
  return assets.artwork.map((x:any,i:number)=>({url:x.url,format:'landscape',mediaType:'image',imageNumber:i+1,label:x.originalFilename||''})).filter((x:any)=>x.url);
 }

 async function generateFullVideo(){
  if(!projectId||!song)return;
  try{
   setBusy('render-full');setActionError('');const audioUrl=textValue(assets.audio?.url);if(!audioUrl)throw new Error('Upload Final Audio first.');
   const visuals=releaseVisuals('landscape');if(!visuals.length)throw new Error('Generate or upload at least one visual first.');
   const durationSeconds=await getAudioDuration();setMessage('Rendering the full music video locally…');
   const brandingResponse=await fetch(`/api/channel-context?projectId=${encodeURIComponent(projectId)}`);const branding=await brandingResponse.json();if(!brandingResponse.ok)throw new Error(branding.error);
   const r=await fetch(`${LOCAL_VIDEO_WORKER}/render/full-video`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({finishing:branding.finishing,projectId,title:song.title||song.idea||'Untitled song',audioUrl,durationSeconds,visuals})});const d=await r.json();if(!r.ok)throw new Error(d?.error||'Could not render the full video.');
   setMessage('✓ Full Universe video generated — review and choose it for publishing');onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not generate the full video.')}finally{setBusy('')}
 }

 async function generateSixShorts(){
  if(!projectId||!song)return;
  try{
   setBusy('render-shorts');setActionError('');const audioUrl=textValue(assets.audio?.url);if(!audioUrl)throw new Error('Upload Final Audio first.');
   const visuals=releaseVisuals('vertical');if(!visuals.length)throw new Error('Generate or upload release visuals first.');
   const durationSeconds=await getAudioDuration();setMessage('Rendering six Shorts locally…');
   const brandingResponse=await fetch(`/api/channel-context?projectId=${encodeURIComponent(projectId)}`);const branding=await brandingResponse.json();if(!brandingResponse.ok)throw new Error(branding.error);
   const r=await fetch(`${LOCAL_VIDEO_WORKER}/render/shorts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({finishing:branding.finishing,projectId,title:song.title||song.idea||'Untitled song',audioUrl,durationSeconds,visuals})});const d=await r.json();if(!r.ok)throw new Error(d?.error||'Could not render the Shorts.');
   setMessage('✓ Six Shorts generated — review each slot and choose the publishing version');onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not generate Shorts.')}finally{setBusy('')}
 }

 async function prepareSocial(force=false){
  if(!projectId)return;
  if(force&&typeof window!=='undefined'&&!window.confirm('Regenerate the complete social pack? This replaces the current saved platform copy.'))return;
  try{
   setBusy('social');setActionError('');setMessage('Universe is preparing one coordinated campaign across YouTube, Instagram, Facebook and TikTok…');
   const r=await fetch('/api/campaign-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,force})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not prepare the social pack.');
   setMessage(d.cached?'✓ Existing social pack loaded':hasSocialPack?'✓ Missing Social copy generated and saved':'✓ Social copy generated and saved');setSocialRefresh(v=>v+1);onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not prepare social content.')}finally{setBusy('')}
 }

 if(loading&&!(stage==='Social'&&assets.social.youtubeFull)&&!((stage==='Visuals'||stage==='Video & Shorts')&&assets.creative?.slots?.length))return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>{stage}</div><h2>Loading saved project content…</h2><p>Universe is gathering the assets already attached to {song?.title||'this song'}.</p></section>;
 const feedback=(message||actionError)?<div className={actionError?s.formError:s.actionSuccess}>{actionError||message}</div>:null;
 const nextStage=stage==='Final Audio'&&assets.audio?releaseGaps(song,assets,completedFrom(song||{id:projectId},assets).includes('Social')).next:stages[stages.indexOf(stage)+1];
 const nextLabel:Partial<Record<Stage,string>>={'Final Audio':'Audio','Video & Shorts':'Video & Shorts'};
 const continueFooter=nextStage?<div className={s.ideaActions}><span>Everything stays editable — move forward when you are ready.</span><button className={s.gradientButton} onClick={()=>onContinue(nextStage)}>Continue to {nextLabel[nextStage]||nextStage} →</button></div>:null;

 if(stage==='Suno Style')return <section className={`${s.card} ${s.tabPanel}`}>{header}{typeof process !== 'undefined' && process.env.NODE_ENV === 'development' && <p><Link href={`/music-director?projectId=${encodeURIComponent(projectId)}&channelId=${encodeURIComponent(channelId)}`}>Open Music Director development preview</Link></p>}<div className={s.eyebrow}>Suno Style · production direction</div><h2>{assets.styles.length?`${assets.styles.length} saved style directions`:'Generate the sound for this song'}</h2><p>This is where Suno Style belongs. Lyrics stay on the Lyrics page; this page reads those saved lyrics and creates 5–8 production directions with exactly one recommendation.</p><div className={s.styleGenerator}><div><b>{assets.styles.length?'Want a different direction?':'Create Suno Styles from these lyrics'}</b><span>Add an optional music note such as “faster”, “unplugged”, “Indian Bengali pronunciation” or “more rock”. It changes the production direction, not the lyrics.</span></div><textarea value={styleDirection} onChange={e=>setStyleDirection(e.target.value)} rows={3} maxLength={600} placeholder="Optional music direction…"/><div className={s.styleGeneratorActions}>{song?.lyrics&&<button className={s.secondaryButton} onClick={()=>void copyText(song.lyrics||'')}>Copy lyrics</button>}<button className={s.gradientButton} disabled={busy==='generate-styles'||!song?.lyrics?.trim()} onClick={()=>void generateStyles()}>{busy==='generate-styles'?'Generating 5–8 styles…':assets.styles.length?'Regenerate 5–8 styles':'Generate 5–8 Suno Styles'}</button></div></div>{assets.styles.length?<div className={s.existingGrid}>{assets.styles.map((x:any,i:number)=>{const editing=editingStyle===i;return <article className={s.existingTextCard} key={x.id||i}><div className={s.assetMeta}>{x.recommended?'✓ RECOMMENDED':textValue(x.category)||`STYLE ${i+1}`}</div>{editing?<><input className={s.inlineTitleInput} value={styleNameDraft} onChange={e=>setStyleNameDraft(e.target.value)}/>{textValue(x.whyItFits)&&<p>{textValue(x.whyItFits)}</p>}<textarea className={s.styleEditor} rows={9} value={stylePromptDraft} onChange={e=>setStylePromptDraft(e.target.value)}/><div className={s.assetActions}><button className={s.secondaryButton} onClick={()=>setEditingStyle(null)}>Cancel</button><button className={s.gradientButton} disabled={busy===`style-${i}`||!stylePromptDraft.trim()} onClick={()=>void saveStyle(i)}>{busy===`style-${i}`?'Saving…':'Save style'}</button></div></>:<><h3>{x.name||`Style ${i+1}`}</h3>{textValue(x.whyItFits)&&<p>{textValue(x.whyItFits)}</p>}<pre>{textValue(x.prompt)||'Saved style prompt'}</pre><div className={s.assetActions}><button className={s.secondaryButton} onClick={()=>void copyText(textValue(x.prompt))}>Copy style</button><button className={s.secondaryButton} onClick={()=>{setEditingStyle(i);setStyleNameDraft(x.name||`Style ${i+1}`);setStylePromptDraft(textValue(x.prompt))}}>Edit style</button></div></>}</article>})}</div>:<EmptyStage label="No Suno Style has been saved yet. Use Generate 5–8 Suno Styles above."/>}{feedback}{continueFooter}</section>;

 if(stage==='Final Audio'){
  const a=assets.audio;const duration=Number(a?.metadata?.durationSeconds||a?.durationSeconds||0);
  return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>Final Audio · master</div><h2>{a?'Finished master attached':'Add the finished master'}</h2><p>The current WAV/MP3 is the authoritative audio for downstream release work. Universe stores its duration now so video and Shorts can use the real master length.</p>{a?<div className={s.mediaPanel}><div><b>{a.originalFilename||'Final audio'}</b><span>{a.mimeType||'Audio'}{a.sizeBytes?` · ${(Number(a.sizeBytes)/(1024*1024)).toFixed(1)} MB`:''}{duration?` · ${Math.round(duration)}s`:''}</span></div>{a.url&&<audio controls src={a.url}/>}<div className={s.assetActions}>{a.url&&<a className={s.secondaryButton} href={a.url} download={a.originalFilename||'final-audio'}>Download audio ↓</a>}<label className={s.secondaryButton}>Upload replacement<input hidden type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,.aac" disabled={busy==='audio'} onChange={e=>{const file=e.currentTarget.files?.[0]||null;e.currentTarget.value='';void uploadAudio(file)}}/></label></div></div>:<div className={s.uploadEmpty}><EmptyStage label="Upload the final WAV, MP3, M4A or AAC to complete this stage."/><label className={s.gradientButton}>Upload final audio<input hidden type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,.aac" disabled={busy==='audio'} onChange={e=>{const file=e.currentTarget.files?.[0]||null;e.currentTarget.value='';void uploadAudio(file)}}/></label></div>}{busy==='audio'&&<div className={s.actionProgress}>Uploading final audio…</div>}{feedback}{continueFooter}</section>;
 }

 if(stage==='Visuals'||stage==='Video & Shorts')return <><CreativeStudio key={projectId} projectId={projectId} title={song?.title||song?.idea||'Untitled song'} lyrics={song?.lyrics||''} stage={stage} assets={assets} onNavigate={onContinue} onRefresh={onRefresh} onContinue={()=>onContinue(stage==='Visuals'?'Video & Shorts':'Social')}/></>;

 if(stage==='Social')return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>Social · release copy</div><h2>Prepare your Social copy</h2><p>Write or paste your own copy below, or let Universe prepare what is missing from your title, language, description and optional lyrics. Saved copy and reviewed edits are preserved.</p><button className={s.gradientButton} disabled={busy==='social'} onClick={()=>void prepareSocial(false)}>{busy==='social'?(hasSocialPack?'Preparing missing copy…':'Generating Social Copy…'):(hasSocialPack?'Generate Missing Copy with Universe':'Generate Social Copy with Universe')}</button><SocialCopyEditor key={`${projectId}:${channelId}:${socialRefresh}`} projectId={projectId} channelId={channelId} onSaved={onRefresh}/>{feedback}{complete&&continueFooter}</section>;

 if(stage==='Publish'){
  const jobs=Array.isArray(assets.campaign?.jobs)?assets.campaign.jobs:[];
  const approvedFull=assets.fullVideos.find((x:any)=>x._approved&&(x._source==='generated'||x._source==='uploaded'))||null;
  const shortSlots=Array.from({length:6},(_,i)=>{const slot=i+1;const approved=assets.shorts.find((x:any)=>Number(x.slot)===slot&&x._approved&&(x._source==='generated'||x._source==='uploaded'));return {slot,approvedVideo:approved?{filename:approved.filename,originalFilename:approved.originalFilename,fileUrl:approved.fileUrl||approved.url,durationSeconds:approved.durationSeconds,source:approved._source}:null};});
  const socialReady=completedFrom(song||{id:projectId},assets).includes('Social');
  const releaseReady=Boolean(approvedFull&&shortSlots.every(x=>x.approvedVideo)&&socialReady);
  const publisherFull=approvedFull?{filename:approvedFull.filename,originalFilename:approvedFull.originalFilename,fileUrl:approvedFull.fileUrl||approvedFull.url,durationSeconds:approvedFull.durationSeconds,source:approvedFull._source}:null;
  return <section className={`${s.card} ${s.tabPanel} ${s.publishCreator}`}>{header}<div className={s.eyebrow}>Your release · Publish</div>{typeof process !== 'undefined' && process.env.NODE_ENV === 'development' && <p><Link href={`/music-release?channelId=${encodeURIComponent(channelId)}&projectId=${encodeURIComponent(projectId)}`}>Review complete Music release locally</Link></p>}<h2>{releaseReady?'Release package is ready':'One more review before release'}</h2><p>Your videos and Social pack come together here. Review what is ready, then choose how to release it.</p><div className={s.releaseSummary}><div><span className={s.eyebrow}>Release package</span><h3>{song?.title||'Your song'}</h3><p>{assets.publishingComplete?'Release complete':'Release incomplete'} · {releaseReady?'Assets ready for publishing review':'Finish the review below before publishing'}</p></div><button className={s.secondaryButton} onClick={()=>onContinue('Social')}>Review Social pack</button></div>{!releaseReady&&<div role="status" className={s.releaseAttention}><b>Needs your attention</b><p>{!approvedFull?'Review your full video. ':''}{shortSlots.filter(x=>!x.approvedVideo).map(x=>`Short ${x.slot} needs review. `).join('')}{!socialReady?'Prepare your Social pack.':''}<button className={s.secondaryButton} onClick={()=>onContinue(!approvedFull||shortSlots.some(x=>!x.approvedVideo)?'Video & Shorts':'Social')}>Continue review →</button></p></div>}<div className={s.readinessGrid}>
   <div className={approvedFull&&shortSlots.every(x=>x.approvedVideo)?s.readyItem:s.missingItem}><b>YouTube · {Number(Boolean(approvedFull))+shortSlots.filter(x=>x.approvedVideo).length}/7 videos approved</b><span>{approvedFull?'Full Video approved':'Full Video needs review'} · {shortSlots.filter(x=>x.approvedVideo).length}/6 Shorts approved</span></div>
   <div className={socialReady?s.readyItem:s.missingItem}><b>Buffer · Instagram · Facebook · TikTok</b><span>{socialReady?'Social copy ready':'Social copy needs review'} · saved destinations shown in the planner</span></div>
  </div>
  <div className={s.scheduleNext}><div><div className={s.eyebrow}>Next · Plan your release</div><h3>Choose when your song goes live</h3><p>Set dates and times in Publishing. Your saved timezone and draft stay with your plan.</p></div><Link className={s.gradientButton} onClick={()=>{const url=new URL(window.location.href);url.searchParams.set('channelId',channelId);url.searchParams.set('projectId',projectId||'');url.searchParams.set('stage','Publish');window.history.replaceState(null,'',url);}} href={`/publishing?channelId=${encodeURIComponent(channelId)}&projectId=${encodeURIComponent(projectId||'')}&editSchedule=1`}>Schedule YouTube & Buffer →</Link></div>
  {jobs.length>0&&<details className={s.releaseDetails}><summary>Previous publishing activity · {jobs.length} items</summary><div className={s.publishList}>{jobs.map((j:any,i:number)=><div className={s.publishRow} key={j.id||i}><div><b>{String(j.platform||'Destination').toUpperCase()}</b><span>{j.title||j.item_key||j.content_type||`Item ${i+1}`}</span></div><strong className={(j.published_at||j.external_post_id||['published','scheduled','complete','completed'].includes(String(j.status||'').toLowerCase()))?s.publishDone:''}>{j.published_at?'Published':j.status||'Prepared'}</strong></div>)}</div></details>}{releaseReady?<details key={`advanced:${projectId}:${channelId}`} className={s.releaseDetails}><summary><span>Advanced publishing details</span><small>Legacy controls for troubleshooting</small></summary><p className={s.releaseDetailsNote}>Use the scheduling button above for your release plan. These legacy controls remain available for troubleshooting. Opening this panel does not schedule or publish anything.</p><div className={s.operationalConsole}><LocalReleasePublisher key={`${projectId}:${channelId}`} projectId={projectId||null} songTitle={song?.title || "Untitled song"} channelId={channelId||null} releaseReady={releaseReady} approvedFullVideo={publisherFull as any} shortSlots={shortSlots as any} onPublishComplete={onPublishComplete}/></div></details>:<EmptyStage label="Once the full video, all six Shorts and Social pack are ready, Advanced publishing details will be available here. Nothing is published automatically."/>}</section>;
 }

 return <StagePanel stage={stage} song={song} entry="lyrics" onBack={onBack} onNew={()=>{}}/>;
}
function EmptyStage({label}:{label:string}){return <div className={s.emptyStage}>{label}</div>}

function Enrichment({title,setTitle,language,setLanguage,context,setContext,busy,error,onBack,onContinue}:{title:string;setTitle:(v:string)=>void;language:string;setLanguage:(v:string)=>void;context:string;setContext:(v:string)=>void;busy:boolean;error:string;onBack:()=>void;onContinue:()=>void}){return <section className={`${s.card} ${s.tabPanel}`}><button className={s.backButton} disabled={busy} onClick={onBack}>← Back to starting points</button><h2>About your song</h2><p>These details stay with your project. Lyrics are optional when you bring finished audio or video.</p><label>Song title<input className={s.inlineTitleInput} value={title} onChange={e=>setTitle(e.target.value)} maxLength={120}/></label><label>Language<input className={s.inlineTitleInput} value={language} onChange={e=>setLanguage(e.target.value)} maxLength={80}/></label><label>Song description / context (optional)<textarea className={s.styleEditor} value={context} onChange={e=>setContext(e.target.value)} maxLength={4000} placeholder="A nostalgic Bengali love song about two people separated by distance…"/></label><p>Universe uses your description and any supplied lyrics for meaning. Audio measurements provide duration and energy, not lyrical understanding.</p>{error&&<p role="alert">{error}</p>}<button className={s.gradientButton} disabled={busy||!title.trim()||!language.trim()} onClick={onContinue}>{busy?'Saving…':'Continue →'}</button></section>}

function StagePanel({stage,song,entry,onBack,onNew}:{stage:Stage;song?:Song;entry:Entry|null;onBack:()=>void;onNew:()=>void}){const data:Record<Stage,[string,string,Array<[string,string]>]>={
 Lyrics:['Write the song','Start from an idea, write directly, paste existing lyrics or upload a document.',[['Generate from an idea','Describe the story, feeling or concept and let Universe draft the lyrics.'],['Write or paste lyrics',song?.lyrics?'Your existing lyrics are ready to edit.':'Use the full lyrics editor.'],['Upload lyrics','Import a TXT file into the editor for review.'],['Refine','Rewrite a section, explain a line or try alternatives without losing the rest.']]],
 'Suno Style':['Find the sound','Universe reads the lyrics and prepares 5–8 precise Suno style directions, with one recommendation.',[['Recommended style','One clearly recommended direction based on the song.'],['Style alternatives','Compare 5–8 different production directions.'],['Edit or write your own','Keep complete manual control over the prompt.'],['Ready for Suno','Copy final lyrics and selected style when you are ready to create externally.']]],
 'Final Audio':['Bring in the finished song','Upload the final WAV or MP3. Universe analyses the actual finished recording before preparing the release.',[['Upload final audio','WAV or MP3 — replace it later if the master changes.'],['Song analysis','Structure, duration, tempo, energy, strongest sections and emotional movement.'],['Combine the context','Reuse lyrics, selected style, Song DNA and any supplied release information.'],['Prepare Release','After analysis, prepare only the downstream assets that are still missing.']]],
 Visuals:['Build the visual world','Artwork and promotional visuals informed by the finished song — not just the original idea.',[['Artwork','Generate, upload, replace or approve the final artwork.'],['3 YouTube thumbnails','Three genuinely different thumbnail/title directions for testing.'],['Landscape visuals','Horizontal images for the full music video.'],['Vertical visuals','Portrait assets for Shorts, Reels and TikTok.']]],
 'Video & Shorts':['Turn the music into video','Use the finished audio, structure and visuals to create the full video and six strong short-form cuts.',[['Full music video','Create or upload the finished long-form video.'],['Six Shorts','Choose strong moments intelligently from the actual track.'],['Captions & timing','Review text, timing and presentation before approval.'],['Use what already exists','Never recreate customer assets unless they ask Universe to replace them.']]],
 Social:['Create the full social media pack','Universe prepares the complete release pack by default using everything it has learned about the finished song.',[['YouTube full release','Titles, description and relevant release metadata.'],['YouTube Shorts','Platform-ready metadata for each Short.'],['Instagram & Facebook','Captions, hooks and post copy suited to each destination.'],['TikTok','Caption, hashtags and short-form promotional copy.']]],
 Publish:['Review, then release','Nothing is published blindly. Review the prepared assets, destinations and timing first.',[['Readiness','See missing or optional items without false “incomplete” warnings.'],['Destinations','Use the channel-scoped platform connections already configured.'],['Schedule or publish','Choose timing per destination.'],['Final approval','Explicit human approval before anything is sent.']]],
};const [title,copy,items]=data[stage];return <section className={`${s.card} ${s.tabPanel}`}><div className={s.pageBackRow}><button className={s.backButton} onClick={onBack}>← Back</button></div><div className={s.eyebrow}>{stage}</div><h2>{title}</h2><p>{copy}</p>{!entry&&<div className={s.next}><span>Starting a new release?</span><button className={s.primary} onClick={onNew}>Choose your starting point →</button></div>}<div className={s.sectionGrid}>{items.map(([a,b])=><div className={s.section} key={a}><h4>{a}</h4><p>{b}</p></div>)}</div><div className={s.footerNote}>V5 workflow shell — designed to reuse the existing Universe backend rather than duplicate it.</div></section>}
function Assistant({stage,channelId,channelName}:{stage:Stage;channelId:string;channelName:string}){const tips:Record<Stage,string>={Lyrics:'Rewrite a verse, strengthen the hook or explain why a line works.','Suno Style':'Create another production direction or make the selected style more precise.','Final Audio':'Use the measured duration and audio energy to suggest moments to review for Shorts.',Visuals:'Try another artwork direction or refine a thumbnail without changing the song.', 'Video & Shorts':'Change a clip, caption or section while keeping approved assets untouched.',Social:'Rewrite one platform caption or title without regenerating the whole pack.',Publish:'Check what is genuinely missing before scheduling or publishing.'};return <aside className={`${s.card} ${s.assistant}`}><div className={s.eyebrow}>Universe Assistant</div><h3>{stage} workspace</h3><div className={s.suggestion}><b>Context-aware help</b><p>{tips[stage]}</p></div><ChannelConnections channelId={channelId} name={channelName}/></aside>}
