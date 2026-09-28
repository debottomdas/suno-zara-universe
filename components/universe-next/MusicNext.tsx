'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {createClient} from '@/utils/supabase/client';
import s from './MusicNext.module.css';
import LocalReleasePublisher from '@/components/LocalReleasePublisher';

type Theme='auto'|'light'|'dark';
type Stage='Lyrics'|'Suno Style'|'Final Audio'|'Visuals'|'Video & Shorts'|'Social'|'Publish';
type Entry='idea'|'lyrics'|'audio'|'video'|'ready';
type Channel={id:string;name:string;language?:string|null};
type Song={id:string;title?:string|null;idea?:string|null;language?:string|null;script?:string|null;mood?:string|null;genre?:string|null;freedom?:string|number|null;hooks?:string[]|null;selectedHook?:string|null;status?:string|null;lyrics?:string|null};
type ProjectAssets={styles:any[];audio:any|null;artwork:any[];images:any[];fullVideos:any[];approvedFullVideoSource:'generated'|'uploaded'|null;shorts:any[];social:{youtubeFull:any|null;youtubeShorts:any|null;platform:any|null};campaign:any|null};
const EMPTY_ASSETS:ProjectAssets={styles:[],audio:null,artwork:[],images:[],fullVideos:[],approvedFullVideoSource:null,shorts:[],social:{youtubeFull:null,youtubeShorts:null,platform:null},campaign:null};
const LOCAL_VIDEO_WORKER='http://127.0.0.1:47123';
async function safeJson(url:string){try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)return null;return await r.json()}catch{return null}}
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
 const hasVisuals=assets.artwork.length>0||assets.images.length>0; if(hasVisuals)done.push('Visuals');
 const hasFullVideo=assets.fullVideos.length>0; const shortSlots=new Set(assets.shorts.map((x:any)=>Number(x.slot||0)).filter(Boolean)); if(hasFullVideo&&shortSlots.size>=6)done.push('Video & Shorts');
 const yf=assets.social.youtubeFull?.youtubeFull; const ys=assets.social.youtubeShorts?.youtubeShorts; const pp=assets.social.platform; if(yf&&ys&&pp?.instagram&&pp?.facebook&&pp?.tiktok)done.push('Social');
 const jobs=Array.isArray(assets.campaign?.jobs)?assets.campaign.jobs:[]; const published=jobs.filter((j:any)=>Boolean(j?.published_at||j?.external_post_id||['published','scheduled','complete','completed'].includes(String(j?.status||'').toLowerCase()))); const projectPublished=['published','released','complete','completed'].includes(String(project.status||'').toLowerCase()); if(projectPublished||(jobs.length>0&&published.length>0))done.push('Publish');
 return done;
}
const stages:Stage[]=['Lyrics','Suno Style','Final Audio','Visuals','Video & Shorts','Social','Publish'];
const entries:{id:Entry;icon:string;title:string;copy:string;start:Stage}[]=[
 {id:'idea',icon:'✦',title:'Start with an idea',copy:'Turn a thought, story or feeling into lyrics, music direction and a complete release.',start:'Lyrics'},
 {id:'lyrics',icon:'✎',title:'I already have lyrics',copy:'Paste, write or upload your lyrics, then continue with Suno Style and production.',start:'Lyrics'},
 {id:'audio',icon:'♫',title:'I have a finished song',copy:'Upload the final audio. Add lyrics and context optionally for richer release content.',start:'Final Audio'},
 {id:'video',icon:'▶',title:'I have a finished music video',copy:'Upload the finished video. Universe will analyse it and prepare the full social pack.',start:'Video & Shorts'},
 {id:'ready',icon:'✓',title:'Everything is ready',copy:'Bring your finished assets. Universe uses what you already have and prepares publishing.',start:'Social'},
];
function autoTheme(){const h=new Date().getHours();return h>=7&&h<19?'light':'dark'}
export default function MusicNext(){
 const [pref,setPref]=useState<Theme>('auto'); const [theme,setTheme]=useState<'light'|'dark'>('light'); const [stage,setStage]=useState<Stage>('Lyrics'); const [entry,setEntry]=useState<Entry|null>(null); const [newOpen,setNewOpen]=useState(false); const [enrich,setEnrich]=useState(false);
 const [channels,setChannels]=useState<Channel[]>([]); const [channelId,setChannelId]=useState(''); const [songs,setSongs]=useState<Song[]>([]); const [songId,setSongId]=useState('');
 const [idea,setIdea]=useState(''); const [ideaLanguage,setIdeaLanguage]=useState('Bengali'); const [ideaScript,setIdeaScript]=useState('Native'); const [ideaMood,setIdeaMood]=useState(''); const [ideaGenre,setIdeaGenre]=useState('');
 const [ideaBusy,setIdeaBusy]=useState(false); const [ideaError,setIdeaError]=useState(''); const [ideaProjectId,setIdeaProjectId]=useState(''); const [ideaHooks,setIdeaHooks]=useState<string[]>([]); const [selectedHook,setSelectedHook]=useState(''); const [ideaComplete,setIdeaComplete]=useState(false);
 const [completedStages,setCompletedStages]=useState<Stage[]>([]);
 const [projectAssets,setProjectAssets]=useState<ProjectAssets>(EMPTY_ASSETS); const [projectAssetsLoading,setProjectAssetsLoading]=useState(false); const [assetRefresh,setAssetRefresh]=useState(0);
 useEffect(()=>{const saved=(localStorage.getItem('sz-theme') as Theme)||'auto';setPref(saved);setTheme(saved==='auto'?autoTheme():saved)},[]);
 useEffect(()=>{localStorage.setItem('sz-theme',pref);setTheme(pref==='auto'?autoTheme():pref)},[pref]);
 useEffect(()=>{if(typeof window==='undefined')return;const params=new URLSearchParams(window.location.search);if(params.get('new')==='1'){setSongId('');setEntry(null);setEnrich(false);setNewOpen(true);}},[]);
 useEffect(()=>{fetch('/api/channels').then(r=>r.json()).then(d=>{const list=Array.isArray(d)?d:(d.channels||[]);setChannels(list);const requested=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('channelId')||'':'';const saved=typeof window!=='undefined'?localStorage.getItem('szu:music:active-channel')||'':'';const chosen=list.find((c:Channel)=>c.id===requested)||list.find((c:Channel)=>c.id===saved)||list[0];if(chosen)setChannelId(chosen.id)}).catch(()=>{})},[]);
 useEffect(()=>{if(!channelId)return;localStorage.setItem('szu:music:active-channel',channelId);fetch(`/api/songs?channelId=${encodeURIComponent(channelId)}`).then(r=>r.json()).then(d=>{const list=Array.isArray(d)?d:(d.songs||d.projects||[]);setSongs(list);const requested=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('projectId')||'':'';const chosen=list.find((x:Song)=>x.id===requested)||list[0];if(chosen)setSongId(chosen.id)}).catch(()=>{})},[channelId]);
 const song=useMemo(()=>songId?songs.find(x=>x.id===songId):undefined,[songs,songId]); const channel=channels.find(x=>x.id===channelId)||channels[0];
 function hydrateSongProject(project:Song){
  const savedHooks=Array.isArray(project.hooks)?project.hooks.filter((x):x is string=>typeof x==='string'&&Boolean(x.trim())):[];
  const inferredEntry:Entry=(project.idea||savedHooks.length)?'idea':'lyrics';
  setEntry(inferredEntry); const requestedStage=typeof window!=='undefined'?new URLSearchParams(window.location.search).get('stage'):null; setStage(stages.includes(requestedStage as Stage)?requestedStage as Stage:'Lyrics'); setEnrich(false); setNewOpen(false);
  setIdeaProjectId(project.id); setIdea(project.idea||''); setIdeaLanguage(project.language||channel?.language||'Bengali'); setIdeaScript(project.script||'Native'); setIdeaMood(project.mood||''); setIdeaGenre(project.genre||'');
  setIdeaHooks(savedHooks); setSelectedHook(project.selectedHook||(savedHooks[0]||'')); setIdeaComplete(Boolean(project.lyrics?.trim())); setIdeaError('');
  setProjectAssets(EMPTY_ASSETS); setCompletedStages(project.lyrics?.trim()?['Lyrics']:[]);
 }
 useEffect(()=>{if(!songId||!song)return;hydrateSongProject(song)},[songId,song]);
 useEffect(()=>{if(!songId||!song)return;let cancelled=false;(async()=>{setProjectAssetsLoading(true);const q=encodeURIComponent(songId);const [styles,audio,artwork,images,localFull,stagedFull,localShorts,stagedShorts,yf,ys,platform,campaign]=await Promise.all([safeJson(`/api/suno-styles?projectId=${q}`),safeJson(`/api/media/final-audio?projectId=${q}`),safeJson(`/api/media/artwork?projectId=${q}`),safeJson(`/api/generate-image?projectId=${q}`),safeJson(`${LOCAL_VIDEO_WORKER}/full-video/status?projectId=${q}`),safeJson(`/api/media/youtube-video?projectId=${q}`),safeJson(`${LOCAL_VIDEO_WORKER}/shorts/status?projectId=${q}`),safeJson(`/api/media/vertical-video?projectId=${q}`),safeJson(`/api/social-media/youtube-full?projectId=${q}`),safeJson(`/api/social-media/youtube-shorts?projectId=${q}`),safeJson(`/api/social-media/platform-pack?projectId=${q}`),safeJson(`/api/publishing/campaigns?projectId=${q}`)]);
 const fullVideos:any[]=[]; if(localFull?.generatedVideo)fullVideos.push({...localFull.generatedVideo,source:'Universe generated',_source:'generated',_approved:localFull?.approvedSource==='generated'}); if(localFull?.uploadedVideo)fullVideos.push({...localFull.uploadedVideo,source:'Uploaded',_source:'uploaded',_approved:localFull?.approvedSource==='uploaded'}); if(!fullVideos.length&&stagedFull?.asset)fullVideos.push({...stagedFull.asset,source:'Saved / staged',_source:'staged',_approved:true});
 const shorts:any[]=[]; (Array.isArray(localShorts?.slots)?localShorts.slots:[]).forEach((slot:any)=>{const n=Number(slot?.slot||0);if(slot?.generatedVideo)shorts.push({...slot.generatedVideo,slot:n,source:'Universe generated',_source:'generated',_approved:slot?.approvedSource==='generated'});if(slot?.uploadedVideo)shorts.push({...slot.uploadedVideo,slot:n,source:'Uploaded',_source:'uploaded',_approved:slot?.approvedSource==='uploaded'});}); (stagedShorts?.assets||[]).forEach((a:any)=>{const n=Number(a?.slot||0);if(!shorts.some(x=>Number(x.slot)===n))shorts.push({...a,slot:n,source:'Saved / staged',_source:'staged',_approved:true})});
 const next:ProjectAssets={styles:Array.isArray(styles?.styles)?styles.styles:[],audio:audio?.asset||null,artwork:Array.isArray(artwork?.assets)?artwork.assets:[],images:Array.isArray(images?.images)?images.images:[],fullVideos,approvedFullVideoSource:localFull?.approvedSource||null,shorts,social:{youtubeFull:yf,youtubeShorts:ys,platform},campaign}; if(!cancelled){setProjectAssets(next);setCompletedStages(completedFrom(song,next));setProjectAssetsLoading(false)}})();return()=>{cancelled=true}},[songId,song,assetRefresh]);
 async function reloadSongs(preferredId?:string){if(!channelId)return;try{const r=await fetch(`/api/songs?channelId=${encodeURIComponent(channelId)}`);const d=await r.json();const list=Array.isArray(d)?d:(d.songs||d.projects||[]);setSongs(list);if(preferredId)setSongId(preferredId);else if(list[0])setSongId(list[0].id);}catch{}}
 function choose(e:Entry){const x=entries.find(v=>v.id===e)!;setEntry(e);setStage(x.start);setSongId('');setNewOpen(false);setEnrich(e==='audio'||e==='video');setIdeaError('');setIdeaHooks([]);setSelectedHook('');setIdeaProjectId('');setIdeaComplete(false);setProjectAssets(EMPTY_ASSETS);setCompletedStages([]);}
 async function generateIdeaHooks(){if(!idea.trim()){setIdeaError('Tell Universe what the song should be about.');return;}try{setIdeaBusy(true);setIdeaError('');const r=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId,idea:idea.trim(),language:ideaLanguage,script:ideaScript,mood:ideaMood.trim(),genre:ideaGenre.trim(),freedom:55})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not generate lyric hooks.');const hooks=Array.isArray(d.hooks)?d.hooks:[];if(!d.projectId||hooks.length!==3)throw new Error('Universe did not return three usable hooks.');setIdeaProjectId(String(d.projectId));setIdeaHooks(hooks);setSelectedHook(hooks[0]||'');await reloadSongs(String(d.projectId));}catch(e){setIdeaError(e instanceof Error?e.message:'Could not generate lyric hooks.');}finally{setIdeaBusy(false);}}
 async function writeFullLyrics(){if(!ideaProjectId||!selectedHook.trim())return;try{setIdeaBusy(true);setIdeaError('');const a=await fetch('/api/select-hook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:ideaProjectId,selectedHook})});const ad=await a.json();if(!a.ok)throw new Error(ad.error||'Could not save the selected hook.');const r=await fetch('/api/generate-song',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:ideaProjectId})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not generate the full lyrics.');await reloadSongs(ideaProjectId);setIdeaComplete(true);setCompletedStages(v=>v.includes('Lyrics')?v:[...v,'Lyrics']);}catch(e){setIdeaError(e instanceof Error?e.message:'Could not generate the full lyrics.');}finally{setIdeaBusy(false);}}
 async function saveFullLyrics(lyrics:string){if(!ideaProjectId||!lyrics.trim())throw new Error('Lyrics cannot be empty.');const r=await fetch('/api/songs/lyrics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:ideaProjectId,lyrics})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not save the lyrics.');await reloadSongs(ideaProjectId);return d;}
 async function refineLyrics(sectionName:string,instruction:string){if(!ideaProjectId)throw new Error('Song project is missing.');const r=await fetch('/api/rewrite-section',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:ideaProjectId,sectionName,instruction})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not refine that section.');await reloadSongs(ideaProjectId);return d;}
 function completeAndGo(next:Stage){setCompletedStages(v=>v.includes(stage)?v:[...v,stage]);setStage(next)}
 function backFromStage(){const current=stages.indexOf(stage);if(current<=startIndex){setNewOpen(true);return;}setStage(stages[current-1]);}
 const title=song?.title||'Music Production'; const lang=song?.language||channel?.language||'Music'; const startIndex=entry?stages.indexOf(entries.find(x=>x.id===entry)!.start):0; const allComplete=completedStages.length===stages.length;
 return <div className={s.page} data-theme={theme}><div className={s.layout}>
  <aside className={s.side}><Link href="/" className={s.brand} title="Back to Universe Home">SUNO ZARA<span>UNIVERSE</span></Link><nav className={s.nav}><Link href="/">⌂ <span>Universe Home</span></Link><button className={s.navCreate} onClick={()=>{setSongId('');setEntry(null);setEnrich(false);setNewOpen(true)}}>＋ <span>New Music Project</span></button><Link className={s.active} href="/music-next">♫ <span>Music Production</span></Link><div className={s.navGroup}><Link href={channelId?`/library-next?channelId=${encodeURIComponent(channelId)}`:"/library-next"}>▱ <span>Library</span><b>→</b></Link></div><button className={s.navFuture} title="The publishing engine already exists; its V5 release hub will be wired into this navigation next.">⇧ <span>Publishing</span><i>Next</i></button><button className={s.navFuture} title="Plan organic release campaigns, reuse existing assets and coordinate promotion across platforms. This V5 workspace is coming after Publishing.">✦ <span>Marketing</span><i>Soon</i></button><button className={s.navFuture} title="Cross-platform performance analytics will appear here after publishing is integrated.">▥ <span>Analytics</span><i>Soon</i></button></nav><div className={s.spacer}/><nav className={s.nav}><button className={s.navFuture} title="Workspace, channel, platform, appearance and production defaults will live here.">⚙ <span>Settings</span><i>Soon</i></button></nav></aside>
  <main className={s.main}><header className={s.topbar}><Link href="/" className={s.homeQuick} title="Universe Home">⌂</Link><select value={channelId} onChange={e=>setChannelId(e.target.value)} className={s.search} style={{maxWidth:190}}>{channels.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><div className={s.search}>⌕ Search music, assets, campaigns…</div><div className={s.theme}>{(['auto','light','dark'] as Theme[]).map(t=><button key={t} onClick={()=>setPref(t)} className={pref===t?s.selected:''}>{t==='auto'?'◐ Auto':t==='light'?'☀ Light':'☾ Dark'}</button>)}</div><button className={s.new} onClick={()=>setNewOpen(true)}>＋ New Music Project</button></header>
   <div className={s.content}>{newOpen?<EntryScreen onChoose={choose} onClose={()=>setNewOpen(false)}/>:<><div className={s.songhead}><div className={s.art}/><div><select value={songId} onChange={e=>{const id=e.target.value;setSongId(id);if(id){setNewOpen(false);setEnrich(false)}}} className={s.songPicker} aria-label="Select music project"><option value="">New Music Project — select one of your songs</option>{songs.map(x=><option key={x.id} value={x.id}>{x.title||'Untitled song'}</option>)}</select><div className={s.sub}>{channel?.name||'Suno Zara'} · {songId?lang:'New release'}{songId&&allComplete?' · Complete release':entry?` · ${entries.find(x=>x.id===entry)?.title}`:''}</div>{!songId&&songs.length>0&&<div className={s.songPickerHint}>Your songs are still here — choose one above to reopen its saved lyrics, hooks and workflow.</div>}</div><div className={s.badge}>{songId&&allComplete?'✓ RELEASE COMPLETE':'MUSIC PRODUCTION'}</div></div>
    <div className={s.tabs}>{stages.map((t,i)=>{const done=completedStages.includes(t);const notRequired=i<startIndex;return <button key={t} onClick={()=>setStage(t)} className={`${stage===t?s.tabActive:''} ${done?s.tabDone:''}`}><span style={{opacity:notRequired?.45:1}}>{done?'✓':i+1}</span> {t}{notRequired?' · not required':''}</button>})}</div>
    <div className={s.workspace}><div className={s.stack}>{enrich?<Enrichment onBack={()=>{setEnrich(false);setNewOpen(true)}} onContinue={()=>setEnrich(false)}/>:stage==='Lyrics'&&(entry==='idea'||Boolean(songId&&(song?.lyrics||song?.idea||(song?.hooks?.length||0))))?<IdeaLyricsPanel key={ideaProjectId||songId||'new-idea'} idea={idea} setIdea={setIdea} language={ideaLanguage} setLanguage={setIdeaLanguage} script={ideaScript} setScript={setIdeaScript} mood={ideaMood} setMood={setIdeaMood} genre={ideaGenre} setGenre={setIdeaGenre} busy={ideaBusy} error={ideaError} hooks={ideaHooks} setHooks={setIdeaHooks} selectedHook={selectedHook} setSelectedHook={setSelectedHook} complete={ideaComplete} song={song} canReturnToHooks={ideaHooks.length>0} onBackToEntry={()=>setNewOpen(true)} onGenerate={()=>void generateIdeaHooks()} onRetry={()=>{setIdeaHooks([]);setSelectedHook('');setIdeaError('')}} onWrite={()=>void writeFullLyrics()} onSaveLyrics={saveFullLyrics} onRefine={refineLyrics} onContinue={()=>completeAndGo('Suno Style')}/>:songId&&stage!=='Lyrics'?<ExistingProjectStage stage={stage} song={song} channelId={channelId} assets={projectAssets} loading={projectAssetsLoading} complete={completedStages.includes(stage)} onBack={backFromStage} onRefresh={()=>setAssetRefresh(v=>v+1)} onContinue={(next)=>setStage(next)} onPublishComplete={()=>setCompletedStages(v=>v.includes('Publish')?v:[...v,'Publish'])}/>:<StagePanel stage={stage} song={song} entry={entry} onBack={backFromStage} onNew={()=>setNewOpen(true)}/>}</div><Assistant stage={stage}/></div></>}
   </div></main>
 </div></div>
}
function EntryScreen({onChoose,onClose}:{onChoose:(e:Entry)=>void;onClose:()=>void}){
 const createEntries=entries.filter(e=>e.id==='idea'||e.id==='lyrics');
 const readyEntries=entries.filter(e=>e.id==='audio'||e.id==='video'||e.id==='ready');
 const meta:Record<Entry,{number:string;kicker:string;route:string;note:string;className:string}>= {
  idea:{number:'01',kicker:'FROM AN IDEA',route:'Lyrics → Suno Style → Full release',note:'Create from scratch',className:s.entryIdea},
  lyrics:{number:'02',kicker:'FROM YOUR LYRICS',route:'Lyrics → Suno Style → Full release',note:'Bring your writing',className:s.entryLyrics},
  audio:{number:'03',kicker:'FINISHED AUDIO',route:'Analyse → Visuals → Video & Shorts → Social',note:'MP3 / WAV',className:s.entryAudio},
  video:{number:'04',kicker:'FINISHED VIDEO',route:'Analyse → Shorts → Social → Publish',note:'Video ready',className:s.entryVideo},
  ready:{number:'05',kicker:'RELEASE READY',route:'Use existing assets → Social → Publish',note:'Fastest route',className:s.entryReady},
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
    <div className={s.entryIntroGrid}><h1>Where do you want<br/>to begin?</h1><div><p>Start with what you already have. Universe adapts the production workflow around you — without making you repeat finished work.</p><div className={s.entryPromise}><b>One project.</b><span>Any starting point.</span><span>Full social pack included.</span></div></div></div>
   </div>
   <div className={s.entryGroup}><div className={s.entryGroupHead}><div><span>CREATE</span><b>Build the song</b></div><p>Begin with an idea or lyrics you already have.</p></div><div className={s.entryCreateGrid}>{createEntries.map(e=>card(e,true))}</div></div>
   <div className={s.entryGroup}><div className={s.entryGroupHead}><div><span>CONTINUE</span><b>Bring finished music</b></div><p>Universe starts from the asset you already completed.</p></div><div className={s.entryReadyGrid}>{readyEntries.map(e=>card(e))}</div></div>
   <div className={s.entryBottom}><span><b>Your work stays yours.</b> Existing assets are reused and never recreated unless you ask.</span><button onClick={onClose}>Return to current project →</button></div>
  </section>
}

function IdeaLyricsPanel({idea,setIdea,language,setLanguage,script,setScript,mood,setMood,genre,setGenre,busy,error,hooks,setHooks,selectedHook,setSelectedHook,complete,song,canReturnToHooks,onBackToEntry,onGenerate,onRetry,onWrite,onSaveLyrics,onRefine,onContinue}:{idea:string;setIdea:(v:string)=>void;language:string;setLanguage:(v:string)=>void;script:string;setScript:(v:string)=>void;mood:string;setMood:(v:string)=>void;genre:string;setGenre:(v:string)=>void;busy:boolean;error:string;hooks:string[];setHooks:(v:string[])=>void;selectedHook:string;setSelectedHook:(v:string)=>void;complete:boolean;song?:Song;onBackToEntry:()=>void;onGenerate:()=>void;onRetry:()=>void;onWrite:()=>void;onSaveLyrics:(lyrics:string)=>Promise<unknown>;onRefine:(sectionName:string,instruction:string)=>Promise<unknown>;onContinue:()=>void;canReturnToHooks:boolean}){
 const [editingHook,setEditingHook]=useState<number|null>(null);
 const [hookDraft,setHookDraft]=useState('');
 const [view,setView]=useState<'idea'|'hooks'|'lyrics'>(complete?'lyrics':hooks.length?'hooks':'idea');
 const [editingLyrics,setEditingLyrics]=useState(false);
 const [lyricsDraft,setLyricsDraft]=useState(song?.lyrics||'');
 const [saveBusy,setSaveBusy]=useState(false);
 const [panelError,setPanelError]=useState('');
 const [refineOpen,setRefineOpen]=useState(false);
 const [refineSection,setRefineSection]=useState('');
 const [refineInstruction,setRefineInstruction]=useState('');
 useEffect(()=>{if(complete)setView('lyrics');else if(hooks.length)setView('hooks');else setView('idea')},[complete,hooks.length]);
 useEffect(()=>{if(song?.lyrics&&!editingLyrics)setLyricsDraft(song.lyrics)},[song?.lyrics,editingLyrics]);
 const currentLyrics=song?.lyrics||lyricsDraft||'';
 const sections=Array.from(new Set((currentLyrics.match(/^\s*\[[^\]]+\]/gm)||[]).map(x=>x.trim())));
 useEffect(()=>{if(!refineSection&&sections[0])setRefineSection(sections[0])},[currentLyrics]);
 function beginEdit(i:number){setEditingHook(i);setHookDraft(hooks[i]||'')}
 function cancelEdit(){setEditingHook(null);setHookDraft('')}
 function saveEdit(i:number){const next=hookDraft.trim();if(!next)return;const old=hooks[i];const updated=hooks.map((h,n)=>n===i?next:h);setHooks(updated);if(selectedHook===old)setSelectedHook(next);setEditingHook(null);setHookDraft('')}
 async function saveLyrics(){try{setSaveBusy(true);setPanelError('');await onSaveLyrics(lyricsDraft);setEditingLyrics(false)}catch(e){setPanelError(e instanceof Error?e.message:'Could not save the lyrics.')}finally{setSaveBusy(false)}}
 async function runRefine(){if(!refineSection||!refineInstruction.trim()){setPanelError('Choose a section and tell Universe what you want changed.');return}try{setSaveBusy(true);setPanelError('');await onRefine(refineSection,refineInstruction.trim());setRefineInstruction('');setRefineOpen(false)}catch(e){setPanelError(e instanceof Error?e.message:'Could not refine that section.')}finally{setSaveBusy(false)}}
 if(view==='lyrics')return <section className={`${s.card} ${s.ideaPanel}`}><div className={s.pageBackRow}><button className={s.backButton} onClick={()=>{setEditingLyrics(false);setRefineOpen(false);if(canReturnToHooks)setView('hooks');else onBackToEntry()}}>{canReturnToHooks?'← Back to hooks':'← Back to starting points'}</button><span className={s.stepComplete}>{canReturnToHooks?'✓ Hook chosen & full draft created':'✓ Lyrics saved'}</span></div><div className={s.ideaStepRow}><div><div className={s.eyebrow}>Lyrics · complete</div><h2>Your first full draft is ready</h2><p>Read it as a song, not as a final answer. Edit any line directly or refine one section with Universe before moving to the sound.</p></div><span className={s.readyPill}>✓ LYRICS COMPLETE</span></div>{editingLyrics?<textarea className={s.lyricsEditor} value={lyricsDraft} onChange={e=>setLyricsDraft(e.target.value)} rows={22}/>:<div className={s.lyricsPreview}>{currentLyrics||'The lyrics were generated and saved to this project. Reload the project if the text has not appeared yet.'}</div>}<div className={s.lyricTools}>{editingLyrics?<><button className={s.secondaryButton} disabled={saveBusy} onClick={()=>{setEditingLyrics(false);setLyricsDraft(song?.lyrics||'')}}>Cancel</button><button className={s.gradientButton} disabled={saveBusy||!lyricsDraft.trim()} onClick={()=>void saveLyrics()}>{saveBusy?'Saving…':'Save full lyrics'}</button></>:<><button className={s.secondaryButton} onClick={()=>void copyText(currentLyrics)}>Copy lyrics</button><button className={s.secondaryButton} onClick={()=>{setLyricsDraft(currentLyrics);setEditingLyrics(true);setRefineOpen(false)}}>Edit full lyrics</button><button className={s.secondaryButton} onClick={()=>{setRefineOpen(v=>!v);setEditingLyrics(false)}}>{refineOpen?'Close refine':'Refine a section'}</button></>}</div>{refineOpen&&<div className={s.refinePanel}><div><span>SECTION TO REFINE</span><select value={refineSection} onChange={e=>setRefineSection(e.target.value)}>{sections.length?sections.map(x=><option key={x} value={x}>{x}</option>):<option value="Full song">Full song</option>}</select></div><label><span>WHAT SHOULD CHANGE?</span><textarea value={refineInstruction} onChange={e=>setRefineInstruction(e.target.value)} rows={3} placeholder="Example: Make this verse more intimate and conversational, but keep the meaning."/></label><div className={s.refineActions}><span>Only this section will be rewritten. The previous version is preserved by the existing Universe rewrite flow.</span><button className={s.gradientButton} disabled={saveBusy||!refineInstruction.trim()} onClick={()=>void runRefine()}>{saveBusy?'Refining…':'Refine section →'}</button></div></div>}{(error||panelError)&&<div className={s.formError}>{panelError||error}</div>}<div className={s.ideaActions}><span>{canReturnToHooks?'You can always return to the hooks or edit these lyrics again later.':'These saved lyrics remain editable at any time.'}</span><button className={s.gradientButton} disabled={editingLyrics||saveBusy} onClick={onContinue}>Continue to Suno Style →</button></div></section>;
 if(view==='hooks')return <section className={`${s.card} ${s.ideaPanel}`}><div className={s.pageBackRow}><button className={s.backButton} onClick={()=>setView('idea')}>← Back to song idea</button>{complete&&<button className={s.textLinkButton} onClick={()=>setView('lyrics')}>Return to full lyrics →</button>}</div><div className={s.ideaStepRow}><div><div className={s.eyebrow}>Lyrics · step 2 of 2</div><h2>Choose the hook that should lead the song</h2><p>Universe created three distinct hook directions from your idea. Choose one as-is or edit the wording until it feels exactly right — the full lyrics will be written around your final version.</p></div><span className={s.quietPill}>{complete?'✓ HOOK COMPLETE':'3 HOOKS'}</span></div><div className={s.hookList}>{hooks.map((hook,i)=>{const selected=selectedHook===hook;const editing=editingHook===i;return <div key={`${i}-${hook}`} className={`${s.hookChoice} ${selected?s.hookSelected:''}`}><button className={s.hookSelect} onClick={()=>{if(!editing)setSelectedHook(hook)}} aria-label={`Choose hook ${i+1}`}><span>{selected?'✓':`0${i+1}`}</span></button><div className={s.hookBody}>{editing?<textarea className={s.hookEditor} value={hookDraft} onChange={e=>setHookDraft(e.target.value)} autoFocus rows={3}/>:<b onClick={()=>setSelectedHook(hook)}>{hook}</b>}<div className={s.hookMeta}>{selected&&!editing?<span>Selected</span>:!editing?<span>Generated hook</span>:<span>Editing — make it yours</span>}</div></div><div className={s.hookTools}>{editing?<><button className={s.hookTextButton} onClick={()=>saveEdit(i)} disabled={!hookDraft.trim()}>Save</button><button className={s.hookTextButton} onClick={cancelEdit}>Cancel</button></>:<><button className={s.hookTextButton} onClick={()=>beginEdit(i)}>Edit</button><button className={s.hookChooseButton} onClick={()=>setSelectedHook(hook)}>{selected?'✓ Chosen':'Choose'}</button></>}</div></div>})}</div><div className={s.hookNote}><b>Not quite there?</b><span>Edit the closest hook, or ask Universe for three completely different directions.</span></div>{error&&<div className={s.formError}>{error}</div>}<div className={s.ideaActions}><button className={s.secondaryButton} disabled={busy} onClick={()=>{onRetry();setView('idea')}}>Generate 3 different hooks</button><button className={s.gradientButton} disabled={busy||!selectedHook||editingHook!==null} onClick={onWrite}>{busy?'Writing the full song…':complete?'Rewrite full lyrics from this hook →':'Use chosen hook & write full lyrics →'}</button></div></section>;
 return <section className={`${s.card} ${s.ideaPanel}`}><div className={s.pageBackRow}><button className={s.backButton} onClick={onBackToEntry}>← Back to starting points</button>{complete&&<button className={s.textLinkButton} onClick={()=>setView('lyrics')}>Return to full lyrics →</button>}</div><div className={s.ideaStepRow}><div><div className={s.eyebrow}>Lyrics · step 1 of 2</div><h2>Tell Universe what you want to write</h2><p>You only need the seed of the song. A feeling, memory, situation or one sentence is enough. The extra direction below is optional.</p></div><span className={s.quietPill}>START SIMPLE</span></div><label className={s.ideaPrompt}><span>YOUR IDEA</span><textarea value={idea} onChange={e=>setIdea(e.target.value)} rows={6} placeholder="Example: A Bengali romantic song about leaving the window light on for someone who may finally come home…"/><small>Write naturally. Universe will turn this into three possible hooks before writing the full lyrics.</small></label><div className={s.creativeOptions}><label><span>Language</span><select value={language} onChange={e=>setLanguage(e.target.value)}>{['Bengali','Hindi','English','Hinglish'].map(v=><option key={v}>{v}</option>)}</select></label><label><span>Script</span><select value={script} onChange={e=>setScript(e.target.value)}><option value="Native">Native script</option><option value="Latin transliteration">Latin transliteration</option></select></label><label><span>Mood <em>optional</em></span><select value={mood} onChange={e=>setMood(e.target.value)}><option value="">Let Universe decide</option>{['Romantic','Intimate','Hopeful','Nostalgic','Melancholic','Bittersweet','Joyful','Dreamy','Energetic','Peaceful','Dark / moody','Playful','Empowering','Devotional / spiritual'].map(v=><option key={v} value={v}>{v}</option>)}</select></label><label><span>Genre / direction <em>optional</em></span><select value={genre} onChange={e=>setGenre(e.target.value)}><option value="">Let Universe decide</option>{['Acoustic / unplugged','Pop','Indie pop','Ballad','Singer-songwriter','Folk / acoustic folk','Soft rock','Rock','Alternative rock','R&B / soul','Lo-fi','Electronic / synth','Cinematic','Classical / orchestral','Devotional / bhakti','Experimental'].map(v=><option key={v} value={v}>{v}</option>)}</select></label></div><div className={s.ideaHint}><b>What happens next?</b><span>Universe creates 3 polished, different hooks → you can edit any of them → choose one → it writes the full lyrics around your final hook.</span></div>{error&&<div className={s.formError}>{error}</div>}<div className={s.ideaActions}><span>Nothing here locks the song. You can rewrite every part later.</span><button className={s.gradientButton} disabled={busy} onClick={onGenerate}>{busy?'Creating hooks…':'Generate 3 hooks →'}</button></div></section>
}

function ExistingProjectStage({stage,song,channelId,assets,loading,complete,onBack,onRefresh,onContinue,onPublishComplete}:{stage:Stage;song?:Song;channelId:string;assets:ProjectAssets;loading:boolean;complete:boolean;onBack:()=>void;onRefresh:()=>void;onContinue:(next:Stage)=>void;onPublishComplete?:()=>void}){
 const [busy,setBusy]=useState('');
 const [message,setMessage]=useState('');
 const [actionError,setActionError]=useState('');
 const [editingStyle,setEditingStyle]=useState<number|null>(null);
 const [styleNameDraft,setStyleNameDraft]=useState('');
 const [stylePromptDraft,setStylePromptDraft]=useState('');
 const [styleDirection,setStyleDirection]=useState('');
 const [visualPlan,setVisualPlan]=useState<any|null>(null);
 const [visualConcepts,setVisualConcepts]=useState<any[]>([]);
 const [selectedConceptId,setSelectedConceptId]=useState('');
 const [visualDirection,setVisualDirection]=useState('');
 const projectId=song?.id||'';
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
  if(!file||!projectId)return;
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
   setMessage('Inspecting edited video…');const meta=await videoDetails(file);const params=new URLSearchParams({projectId,title:song.title||song.idea||'Suno Zara Song',filename:file.name,mimeType:file.type||'video/mp4',sizeBytes:String(file.size),durationSeconds:String(meta.durationSeconds),width:String(meta.width),height:String(meta.height)});
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
   const meta=await videoDetails(file);const params=new URLSearchParams({projectId,title:song.title||song.idea||'Suno Zara Song',slot:String(slot),filename:file.name,mimeType:file.type||'video/mp4',sizeBytes:String(file.size),durationSeconds:String(meta.durationSeconds),width:String(meta.width),height:String(meta.height)});
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
   const r=await fetch(`${LOCAL_VIDEO_WORKER}/render/full-video`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,title:song.title||song.idea||'Suno Zara Song',audioUrl,durationSeconds,visuals})});const d=await r.json();if(!r.ok)throw new Error(d?.error||'Could not render the full video.');
   setMessage('✓ Full Universe video generated — review and choose it for publishing');onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not generate the full video.')}finally{setBusy('')}
 }

 async function generateSixShorts(){
  if(!projectId||!song)return;
  try{
   setBusy('render-shorts');setActionError('');const audioUrl=textValue(assets.audio?.url);if(!audioUrl)throw new Error('Upload Final Audio first.');
   const visuals=releaseVisuals('vertical');if(!visuals.length)throw new Error('Generate or upload release visuals first.');
   const durationSeconds=await getAudioDuration();setMessage('Rendering six Shorts locally…');
   const r=await fetch(`${LOCAL_VIDEO_WORKER}/render/shorts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,title:song.title||song.idea||'Suno Zara Song',audioUrl,durationSeconds,visuals})});const d=await r.json();if(!r.ok)throw new Error(d?.error||'Could not render the Shorts.');
   setMessage('✓ Six Shorts generated — review each slot and choose the publishing version');onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not generate Shorts.')}finally{setBusy('')}
 }

 async function prepareSocial(force=false){
  if(!projectId)return;
  if(force&&typeof window!=='undefined'&&!window.confirm('Regenerate the complete social pack? This replaces the current saved platform copy.'))return;
  try{
   setBusy('social');setActionError('');setMessage('Universe is preparing one coordinated campaign across YouTube, Instagram, Facebook and TikTok…');
   const r=await fetch('/api/campaign-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,force})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not prepare the social pack.');
   setMessage(d.cached?'✓ Existing social pack loaded':'✓ Social pack generated and saved');onRefresh();
  }catch(e){setActionError(e instanceof Error?e.message:'Could not prepare social content.')}finally{setBusy('')}
 }

 if(loading)return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>{stage}</div><h2>Loading saved project content…</h2><p>Universe is gathering the assets already attached to {song?.title||'this song'}.</p></section>;
 const feedback=(message||actionError)?<div className={actionError?s.formError:s.actionSuccess}>{actionError||message}</div>:null;
 const nextStage=stages[stages.indexOf(stage)+1];
 const nextLabel:Partial<Record<Stage,string>>={'Final Audio':'Audio','Video & Shorts':'Video & Shorts'};
 const continueFooter=nextStage?<div className={s.ideaActions}><span>Everything stays editable — move forward when you are ready.</span><button className={s.gradientButton} onClick={()=>onContinue(nextStage)}>Continue to {nextLabel[nextStage]||nextStage} →</button></div>:null;

 if(stage==='Suno Style')return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>Suno Style · production direction</div><h2>{assets.styles.length?`${assets.styles.length} saved style directions`:'Generate the sound for this song'}</h2><p>This is where Suno Style belongs. Lyrics stay on the Lyrics page; this page reads those saved lyrics and creates 5–8 production directions with exactly one recommendation.</p><div className={s.styleGenerator}><div><b>{assets.styles.length?'Want a different direction?':'Create Suno Styles from these lyrics'}</b><span>Add an optional music note such as “faster”, “unplugged”, “Indian Bengali pronunciation” or “more rock”. It changes the production direction, not the lyrics.</span></div><textarea value={styleDirection} onChange={e=>setStyleDirection(e.target.value)} rows={3} maxLength={600} placeholder="Optional music direction…"/><div className={s.styleGeneratorActions}>{song?.lyrics&&<button className={s.secondaryButton} onClick={()=>void copyText(song.lyrics||'')}>Copy lyrics</button>}<button className={s.gradientButton} disabled={busy==='generate-styles'||!song?.lyrics?.trim()} onClick={()=>void generateStyles()}>{busy==='generate-styles'?'Generating 5–8 styles…':assets.styles.length?'Regenerate 5–8 styles':'Generate 5–8 Suno Styles'}</button></div></div>{assets.styles.length?<div className={s.existingGrid}>{assets.styles.map((x:any,i:number)=>{const editing=editingStyle===i;return <article className={s.existingTextCard} key={x.id||i}><div className={s.assetMeta}>{x.recommended?'✓ RECOMMENDED':textValue(x.category)||`STYLE ${i+1}`}</div>{editing?<><input className={s.inlineTitleInput} value={styleNameDraft} onChange={e=>setStyleNameDraft(e.target.value)}/>{textValue(x.whyItFits)&&<p>{textValue(x.whyItFits)}</p>}<textarea className={s.styleEditor} rows={9} value={stylePromptDraft} onChange={e=>setStylePromptDraft(e.target.value)}/><div className={s.assetActions}><button className={s.secondaryButton} onClick={()=>setEditingStyle(null)}>Cancel</button><button className={s.gradientButton} disabled={busy===`style-${i}`||!stylePromptDraft.trim()} onClick={()=>void saveStyle(i)}>{busy===`style-${i}`?'Saving…':'Save style'}</button></div></>:<><h3>{x.name||`Style ${i+1}`}</h3>{textValue(x.whyItFits)&&<p>{textValue(x.whyItFits)}</p>}<pre>{textValue(x.prompt)||'Saved style prompt'}</pre><div className={s.assetActions}><button className={s.secondaryButton} onClick={()=>void copyText(textValue(x.prompt))}>Copy style</button><button className={s.secondaryButton} onClick={()=>{setEditingStyle(i);setStyleNameDraft(x.name||`Style ${i+1}`);setStylePromptDraft(textValue(x.prompt))}}>Edit style</button></div></>}</article>})}</div>:<EmptyStage label="No Suno Style has been saved yet. Use Generate 5–8 Suno Styles above."/>}{feedback}{continueFooter}</section>;

 if(stage==='Final Audio'){
  const a=assets.audio;const duration=Number(a?.metadata?.durationSeconds||a?.durationSeconds||0);
  return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>Final Audio · master</div><h2>{a?'Finished master attached':'Add the finished master'}</h2><p>The current WAV/MP3 is the authoritative audio for downstream release work. Universe stores its duration now so video and Shorts can use the real master length.</p>{a?<div className={s.mediaPanel}><div><b>{a.originalFilename||'Final audio'}</b><span>{a.mimeType||'Audio'}{a.sizeBytes?` · ${(Number(a.sizeBytes)/(1024*1024)).toFixed(1)} MB`:''}{duration?` · ${Math.round(duration)}s`:''}</span></div>{a.url&&<audio controls src={a.url}/>}<div className={s.assetActions}>{a.url&&<a className={s.secondaryButton} href={a.url} download={a.originalFilename||'final-audio'}>Download audio ↓</a>}<label className={s.secondaryButton}>Upload replacement<input hidden type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,.aac" onChange={e=>void uploadAudio(e.target.files?.[0]||null)}/></label></div></div>:<div className={s.uploadEmpty}><EmptyStage label="Upload the final WAV, MP3, M4A or AAC to complete this stage."/><label className={s.gradientButton}>Upload final audio<input hidden type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,.aac" onChange={e=>void uploadAudio(e.target.files?.[0]||null)}/></label></div>}{busy==='audio'&&<div className={s.actionProgress}>Uploading final audio…</div>}{feedback}{continueFooter}</section>;
 }

 if(stage==='Visuals'){
  const cover=assets.artwork.find((x:any)=>x.mediaKind==='cover-art');const thumb=assets.artwork.find((x:any)=>x.mediaKind==='thumbnail');const generated=assets.images;
  return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>Visuals · artwork & images</div><h2>Create the release visual world</h2><p>Universe prepares one reusable visual plan, lets you choose the direction, then can generate 3 landscape visuals and 6 vertical visuals. Final cover artwork and the final YouTube thumbnail stay explicit upload/replace slots.</p>
   <div className={s.styleGenerator}><div><b>{visualConcepts.length?'Visual direction ready':'Prepare visual directions'}</b><span>The Production Plan reuses the song understanding and preserves your current Suno Styles.</span></div><textarea value={visualDirection} onChange={e=>setVisualDirection(e.target.value)} rows={2} maxLength={600} placeholder="Optional visual direction — e.g. rainy Kolkata at night, warmer, no visible faces…"/><div className={s.styleGeneratorActions}><button className={s.secondaryButton} disabled={busy==='visual-plan'} onClick={()=>void prepareVisualPlan(Boolean(visualConcepts.length))}>{visualConcepts.length?'Regenerate 3 concepts':'Prepare 3 concepts'}</button>{visualConcepts.length>0&&<><button className={s.secondaryButton} disabled={busy.startsWith('generate-')} onClick={()=>void generateVisualSet('youtube')}>Generate 3 landscape</button><button className={s.secondaryButton} disabled={busy.startsWith('generate-')} onClick={()=>void generateVisualSet('shorts')}>Generate 6 vertical</button><button className={s.gradientButton} disabled={busy.startsWith('generate-')} onClick={()=>void generateVisualSet('all')}>{busy==='generate-all'?'Generating release visuals…':'Generate all 9 visuals'}</button></>}</div></div>
   {visualConcepts.length>0&&<><h3 className={s.subsectionTitle}>Choose visual direction</h3><div className={s.conceptGrid}>{visualConcepts.map((c:any)=><button key={c.id} className={`${s.conceptCard} ${selectedConceptId===c.id?s.conceptSelected:''}`} onClick={()=>void chooseVisualConcept(c.id)}><span>{selectedConceptId===c.id?'✓ SELECTED':`CONCEPT ${c.conceptNumber||''}`}</span><b>{c.title||'Visual direction'}</b><p>{c.description||''}</p></button>)}</div></>}
   <h3 className={s.subsectionTitle}>Final artwork</h3><div className={s.artworkPair}>{([['cover-art','Cover artwork',cover],['thumbnail','YouTube thumbnail',thumb]] as any[]).map(([kind,label,item])=><article className={s.artworkSlot} key={kind}>{item?.url?<img src={item.url} alt=""/>:<div className={s.mediaFallback}>IMAGE</div>}<div className={s.artworkSlotBody}><span>{label}</span><b>{item?.originalFilename||(kind==='cover-art'?'Square release artwork':'16:9 publishing thumbnail')}</b><div className={s.assetActions}>{item?.url&&<a className={s.secondaryButton} href={item.url} download={item.originalFilename||label}>Download ↓</a>}<label className={s.secondaryButton}>{item?'Replace':'Upload'}<input hidden type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={e=>void uploadArtwork(kind,e.target.files?.[0]||null)}/></label></div></div></article>)}</div>
   <h3 className={s.subsectionTitle}>Generated visuals</h3>{generated.length?<div className={s.existingMediaGrid}>{generated.map((x:any,i:number)=><article key={x.id||i} className={s.existingMediaCard}>{x.url?<img src={x.url} alt=""/>:<div className={s.mediaFallback}>IMAGE</div>}<div><span>{x.format==='shorts'?'Vertical visual':'Landscape visual'}</span><b>{x.title||`Generated visual ${x.imageNumber||i+1}`}</b><div className={s.assetActions}>{x.url&&<a className={s.secondaryButton} href={x.url} download>Download ↓</a>}</div></div></article>)}</div>:<EmptyStage label="No generated still visuals are saved yet. Prepare a visual direction above, then generate the set you need."/>}
   {feedback}{continueFooter}</section>;
 }

 if(stage==='Video & Shorts'){
  const bySlot=Array.from({length:6},(_,i)=>{const slot=i+1;return {slot,versions:assets.shorts.filter((x:any)=>Number(x.slot)===slot)}});
  return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>Video & Shorts · create & review</div><h2>{assets.fullVideos.length||assets.shorts.length?`${assets.fullVideos.length} full video version${assets.fullVideos.length===1?'':'s'} · ${new Set(assets.shorts.map((x:any)=>Number(x.slot||0)).filter(Boolean)).size} Short slots`:'Create the release videos'}</h2><p>Universe can render the full video and six Shorts locally from your Final Audio and saved visuals. You can then download, edit externally, upload replacements and explicitly choose the publishing version.</p>
   <div className={s.videoWorkflowBar}><div><b>Generate from the approved release assets</b><span>Final Audio + landscape visuals → full video · Final Audio + vertical visuals → six Shorts</span></div><div className={s.assetActions}><button className={s.secondaryButton} disabled={busy==='render-full'} onClick={()=>void generateFullVideo()}>{busy==='render-full'?'Rendering full video…':'Generate full video'}</button><button className={s.gradientButton} disabled={busy==='render-shorts'} onClick={()=>void generateSixShorts()}>{busy==='render-shorts'?'Rendering 6 Shorts…':'Generate 6 Shorts'}</button></div></div>
   <div className={s.videoWorkflowBar}><div><b>Edited full video</b><span>Download the Universe master, edit externally if you want, then upload the edited version without losing the original.</span></div><label className={s.secondaryButton}>{busy==='video'?'Uploading…':'Upload edited full video'}<input hidden type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={e=>void uploadEditedVideo(e.target.files?.[0]||null)}/></label></div>
   {assets.fullVideos.length>0&&<><h3 className={s.subsectionTitle}>Full video versions</h3><div className={s.existingMediaGrid}>{assets.fullVideos.map((x:any,i:number)=>{const url=x.fileUrl||x.url;const source=x._source as 'generated'|'uploaded'|'staged';return <article className={`${s.existingMediaCard} ${x._approved?s.approvedMedia:''}`} key={`full-${i}`}>{url?<video src={url} controls preload="metadata"/>:<div className={s.mediaFallback}>VIDEO</div>}<div><span>{x._approved?'✓ CHOSEN FOR PUBLISHING':x.source||'Full video'}</span><b>{x.originalFilename||x.filename||'Full music video'}</b><div className={s.assetActions}>{(x.downloadUrl||url)&&<a className={s.secondaryButton} href={x.downloadUrl||url} download>Download video ↓</a>}{source!=='staged'&&<button className={x._approved?s.chosenButton:s.secondaryButton} disabled={busy===`approve-${source}`||x._approved} onClick={()=>void approveVideo(source)}>{x._approved?'✓ Publishing version':'Choose to publish'}</button>}</div></div></article>})}</div></>}
   <h3 className={s.subsectionTitle}>Six Shorts</h3><div className={s.shortSlotGrid}>{bySlot.map(({slot,versions})=><section className={s.shortSlot} key={slot}><div className={s.shortSlotHead}><b>Short {slot}</b><label className={s.secondaryButton}>{busy===`short-upload-${slot}`?'Uploading…':'Upload edited'}<input hidden type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={e=>void uploadShort(slot,e.target.files?.[0]||null)}/></label></div>{versions.length?versions.map((x:any,i:number)=>{const url=x.fileUrl||x.url;const source=x._source as 'generated'|'uploaded'|'staged';return <article className={`${s.shortVersion} ${x._approved?s.approvedMedia:''}`} key={`${slot}-${source}-${i}`}>{url?<video src={url} controls preload="metadata"/>:<div className={s.mediaFallback}>SHORT</div>}<div><span>{x._approved?'✓ CHOSEN':x.source||'Short'}</span><div className={s.assetActions}>{(x.downloadUrl||url)&&<a className={s.secondaryButton} href={x.downloadUrl||url} download>Download ↓</a>}{source!=='staged'&&<button className={x._approved?s.chosenButton:s.secondaryButton} disabled={x._approved||busy===`short-approve-${slot}-${source}`} onClick={()=>void approveShort(slot,source)}>{x._approved?'✓ Publishing version':'Choose to publish'}</button>}</div></div></article>}):<div className={s.shortEmpty}>No Short in this slot yet.</div>}</section>)}</div>
   {feedback}{continueFooter}</section>;
 }

 if(stage==='Social'){
  const yf=assets.social.youtubeFull?.youtubeFull;const ys=assets.social.youtubeShorts?.youtubeShorts;const p=assets.social.platform;
  const blocks=[yf&&['YouTube full',textValue(yf.recommendedTitle),textValue(yf.finalDescription)||textValue(yf.fullDescription)],ys&&['YouTube Shorts',`${Array.isArray(ys.shorts)?ys.shorts.length:0} Shorts prepared`,(ys.shorts||[]).map((x:any)=>[textValue(x.title),textValue(x.description)].filter(Boolean).join('\n')).filter(Boolean).join('\n\n')],p?.instagram&&['Instagram',textValue(p.instagram.feedCaption)||textValue(p.instagram.shortCaption),Array.isArray(p.instagram.hashtags)?p.instagram.hashtags.join(' '):''],p?.facebook&&['Facebook',textValue(p.facebook.mainReleasePost)||textValue(p.facebook.shortReleasePost),Array.isArray(p.facebook.hashtags)?p.facebook.hashtags.join(' '):''],p?.tiktok&&['TikTok',`${Array.isArray(p.tiktok.posts)?p.tiktok.posts.length:0} posts prepared`,(p.tiktok.posts||[]).map((x:any)=>textValue(x.caption)).filter(Boolean).join('\n\n')]].filter(Boolean) as any[];
  return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>Social · campaign pack</div><h2>{blocks.length?`Social pack ready across ${blocks.length} destinations`:'Prepare the release campaign'}</h2><p>One coordinated AI call prepares YouTube full metadata, YouTube Shorts, Instagram, Facebook and TikTok from the same song understanding.</p><div className={s.videoWorkflowBar}><div><b>{blocks.length?'Campaign content is saved':'Prepare everything for social'}</b><span>Nothing is published from here. Review and copy the content before the Publish stage.</span></div><div className={s.assetActions}>{blocks.length&&<button className={s.secondaryButton} disabled={busy==='social'} onClick={()=>void prepareSocial(true)}>Regenerate pack</button>}<button className={s.gradientButton} disabled={busy==='social'} onClick={()=>void prepareSocial(false)}>{busy==='social'?'Preparing social pack…':blocks.length?'Refresh saved pack':'Prepare social pack'}</button></div></div>{blocks.length?<div className={s.existingGrid}>{blocks.map((x:any,i:number)=>{const copy=[x[1],x[2]].filter(Boolean).join('\n\n');return <article className={s.existingTextCard} key={i}><div className={s.assetMeta}>READY</div><h3>{x[0]}</h3>{x[1]&&<p>{x[1]}</p>}{x[2]&&<pre>{x[2]}</pre>}<div className={s.assetActions}>{copy&&<button className={s.secondaryButton} onClick={()=>void copyText(copy)}>Copy</button>}</div></article>})}</div>:<EmptyStage label="No social pack saved yet. Prepare it above when the song and release assets are ready."/>}{feedback}{continueFooter}</section>;
 }

 if(stage==='Publish'){
  const jobs=Array.isArray(assets.campaign?.jobs)?assets.campaign.jobs:[];
  const approvedFull=assets.fullVideos.find((x:any)=>x._approved&&(x._source==='generated'||x._source==='uploaded'))||null;
  const shortSlots=Array.from({length:6},(_,i)=>{const slot=i+1;const approved=assets.shorts.find((x:any)=>Number(x.slot)===slot&&x._approved&&(x._source==='generated'||x._source==='uploaded'));return {slot,approvedVideo:approved?{filename:approved.filename,originalFilename:approved.originalFilename,fileUrl:approved.fileUrl||approved.url,durationSeconds:approved.durationSeconds,source:approved._source}:null};});
  const socialReady=Boolean(assets.social.youtubeFull?.youtubeFull&&assets.social.youtubeShorts?.youtubeShorts&&assets.social.platform?.instagram&&assets.social.platform?.facebook&&assets.social.platform?.tiktok);
  const releaseReady=Boolean(approvedFull&&shortSlots.every(x=>x.approvedVideo)&&socialReady);
  const publisherFull=approvedFull?{filename:approvedFull.filename,originalFilename:approvedFull.originalFilename,fileUrl:approvedFull.fileUrl||approvedFull.url,durationSeconds:approvedFull.durationSeconds,source:approvedFull._source}:null;
  return <section className={`${s.card} ${s.tabPanel}`}>{header}<div className={s.eyebrow}>Publish · final review</div><h2>{releaseReady?'Release package is ready':'Finish the release checklist'}</h2><p>Publishing remains explicit. Universe will not post anything until you open the controls and choose the destination/timing.</p><div className={s.readinessGrid}><div className={approvedFull?s.readyItem:s.missingItem}><b>{approvedFull?'✓':'○'} Full video chosen</b><span>{approvedFull?'Publishing version selected':'Choose a generated or edited full video in Video & Shorts'}</span></div><div className={shortSlots.every(x=>x.approvedVideo)?s.readyItem:s.missingItem}><b>{shortSlots.filter(x=>x.approvedVideo).length===6?'✓':'○'} Shorts chosen · {shortSlots.filter(x=>x.approvedVideo).length}/6</b><span>Each Short needs an explicit publishing version.</span></div><div className={assets.artwork.some((x:any)=>x.mediaKind==='thumbnail')?s.readyItem:s.missingItem}><b>{assets.artwork.some((x:any)=>x.mediaKind==='thumbnail')?'✓':'○'} YouTube thumbnail</b><span>{assets.artwork.some((x:any)=>x.mediaKind==='thumbnail')?'Final thumbnail attached':'Upload the final thumbnail in Visuals'}</span></div><div className={socialReady?s.readyItem:s.missingItem}><b>{socialReady?'✓':'○'} Social pack</b><span>{socialReady?'YouTube + Instagram + Facebook + TikTok ready':'Prepare the Social stage first'}</span></div></div>{jobs.length>0&&<div className={s.publishList}>{jobs.map((j:any,i:number)=><div className={s.publishRow} key={j.id||i}><div><b>{String(j.platform||'Destination').toUpperCase()}</b><span>{j.title||j.item_key||j.content_type||`Item ${i+1}`}</span></div><strong className={(j.published_at||j.external_post_id||['published','scheduled','complete','completed'].includes(String(j.status||'').toLowerCase()))?s.publishDone:''}>{j.published_at?'Published':j.status||'Prepared'}</strong></div>)}</div>}{releaseReady?<LocalReleasePublisher projectId={projectId||null} channelId={channelId||null} releaseReady={releaseReady} approvedFullVideo={publisherFull as any} shortSlots={shortSlots as any} onPublishComplete={onPublishComplete}/>:<EmptyStage label="Complete the items above. Once the full video, all six Shorts and the social pack are approved, the real YouTube + Buffer publishing controls appear here."/>}</section>;
 }

 return <StagePanel stage={stage} song={song} entry="lyrics" onBack={onBack} onNew={()=>{}}/>;
}
function EmptyStage({label}:{label:string}){return <div className={s.emptyStage}>{label}</div>}

function Enrichment({onBack,onContinue}:{onBack:()=>void;onContinue:()=>void}){return <section className={`${s.card} ${s.tabPanel}`}><div className={s.pageBackRow}><button className={s.backButton} onClick={onBack}>← Back to starting points</button></div><div className={s.eyebrow}>Optional enrichment</div><h2>Help Universe understand your song</h2><p><b>Everything here is optional.</b> Universe can analyse your finished audio or music video and create the full social media pack anyway. Original lyrics and a little context help it understand the meaning, story and emotion more accurately — improving titles, descriptions, captions, hashtags, visual direction and promotional hooks.</p><div className={s.sectionGrid}><div className={s.section}><h4>Lyrics</h4><p>Paste your lyrics or upload TXT, DOCX or PDF.</p><button className={s.primary}>Paste / Upload lyrics</button></div><div className={s.section}><h4>Song title & language</h4><p>Universe can detect these where possible. You can confirm or correct them.</p></div><div className={s.section}><h4>What is the song about?</h4><p>Add a short story, meaning or background if you want more context-aware copy.</p></div><div className={s.section}><h4>Anything Universe should know?</h4><p>Audience, release context, mood, instructions or anything important to preserve.</p></div></div><div className={s.next}><span>No information is mandatory.</span><button className={s.gradientButton} onClick={onContinue}>Continue & analyse →</button></div></section>}
function StagePanel({stage,song,entry,onBack,onNew}:{stage:Stage;song?:Song;entry:Entry|null;onBack:()=>void;onNew:()=>void}){const data:Record<Stage,[string,string,Array<[string,string]>]>={
 Lyrics:['Write the song','Start from an idea, write directly, paste existing lyrics or upload a document.',[['Generate from an idea','Describe the story, feeling or concept and let Universe draft the lyrics.'],['Write or paste lyrics',song?.lyrics?'Your existing lyrics are ready to edit.':'Use the full lyrics editor.'],['Upload lyrics','Import TXT, DOCX or PDF and extract it into the editor.'],['Refine','Rewrite a section, explain a line or try alternatives without losing the rest.']]],
 'Suno Style':['Find the sound','Universe reads the lyrics and prepares 5–8 precise Suno style directions, with one recommendation.',[['Recommended style','One clearly recommended direction based on the song.'],['Style alternatives','Compare 5–8 different production directions.'],['Edit or write your own','Keep complete manual control over the prompt.'],['Ready for Suno','Copy final lyrics and selected style when you are ready to create externally.']]],
 'Final Audio':['Bring in the finished song','Upload the final WAV or MP3. Universe analyses the actual finished recording before preparing the release.',[['Upload final audio','WAV or MP3 — replace it later if the master changes.'],['Song analysis','Structure, duration, tempo, energy, strongest sections and emotional movement.'],['Combine the context','Reuse lyrics, selected style, Song DNA and any supplied release information.'],['Prepare Release','After analysis, prepare only the downstream assets that are still missing.']]],
 Visuals:['Build the visual world','Artwork and promotional visuals informed by the finished song — not just the original idea.',[['Artwork','Generate, upload, replace or approve the final artwork.'],['3 YouTube thumbnails','Three genuinely different thumbnail/title directions for testing.'],['Landscape visuals','Horizontal images for the full music video.'],['Vertical visuals','Portrait assets for Shorts, Reels and TikTok.']]],
 'Video & Shorts':['Turn the music into video','Use the finished audio, structure and visuals to create the full video and six strong short-form cuts.',[['Full music video','Create or upload the finished long-form video.'],['Six Shorts','Choose strong moments intelligently from the actual track.'],['Captions & timing','Review text, timing and presentation before approval.'],['Use what already exists','Never recreate customer assets unless they ask Universe to replace them.']]],
 Social:['Create the full social media pack','Universe prepares the complete release pack by default using everything it has learned about the finished song.',[['YouTube full release','Titles, description and relevant release metadata.'],['YouTube Shorts','Platform-ready metadata for each Short.'],['Instagram & Facebook','Captions, hooks and post copy suited to each destination.'],['TikTok','Caption, hashtags and short-form promotional copy.']]],
 Publish:['Review, then release','Nothing is published blindly. Review the prepared assets, destinations and timing first.',[['Readiness','See missing or optional items without false “incomplete” warnings.'],['Destinations','Use the channel-scoped platform connections already configured.'],['Schedule or publish','Choose timing per destination.'],['Final approval','Explicit human approval before anything is sent.']]],
};const [title,copy,items]=data[stage];return <section className={`${s.card} ${s.tabPanel}`}><div className={s.pageBackRow}><button className={s.backButton} onClick={onBack}>← Back</button></div><div className={s.eyebrow}>{stage}</div><h2>{title}</h2><p>{copy}</p>{!entry&&<div className={s.next}><span>Starting a new release?</span><button className={s.primary} onClick={onNew}>Choose your starting point →</button></div>}<div className={s.sectionGrid}>{items.map(([a,b])=><div className={s.section} key={a}><h4>{a}</h4><p>{b}</p></div>)}</div><div className={s.footerNote}>V5 workflow shell — designed to reuse the existing Universe backend rather than duplicate it.</div></section>}
function Assistant({stage}:{stage:Stage}){const tips:Record<Stage,string>={Lyrics:'Rewrite a verse, strengthen the hook or explain why a line works.','Suno Style':'Create another production direction or make the selected style more precise.','Final Audio':'Explain the finished-song analysis or identify strong moments for Shorts.',Visuals:'Try another artwork direction or refine a thumbnail without changing the song.', 'Video & Shorts':'Change a clip, caption or section while keeping approved assets untouched.',Social:'Rewrite one platform caption or title without regenerating the whole pack.',Publish:'Check what is genuinely missing before scheduling or publishing.'};return <aside className={`${s.card} ${s.assistant}`}><div className={s.eyebrow}>Universe Assistant</div><h3>{stage} workspace</h3><div className={s.suggestion}><b>Context-aware help</b><p>{tips[stage]}</p><button className={s.primary}>Help me →</button></div><input className={s.ask} placeholder={`Ask about ${stage.toLowerCase()}…`}/><div style={{marginTop:18}}><div className={s.eyebrow}>Connected</div><div className={s.platforms}><div className={s.platform}>YouTube</div><div className={s.platform}>Instagram</div><div className={s.platform}>Facebook</div><div className={s.platform}>TikTok</div></div></div></aside>}
