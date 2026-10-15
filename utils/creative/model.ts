import {lyricCueState,lyricSubtitleDependency,type LyricCueReview,type LyricCueContext} from './lyric-cues';
import type {VisualIdentity} from '../channel-dna/model';
import type {ScenePlan} from './scene-plan';
export type AssetKind = 'scene' | 'short' | 'cover' | 'thumbnail';
export type Candidate = {visualProduction?:{channelId:string;dnaRevision:number|null;sceneSourceKey?:string;sceneSlotId?:string;branding?:unknown};id:string; storagePath:string; prompt:string; source:'generated'|'uploaded'|'derived'; createdAt:string; width:number; height:number; url?:string};
export type VisualSlot = {id:string; kind:AssetKind; number:number; label:string; prompt:string; candidates:Candidate[]; approvedId?:string};
export type Timing = {slotId:string; start:number; end:number; label:string};
export type AudioAnalysis = {duration:number; energy:Array<{time:number; rms:number}>; sourceKey:string};
export type CreativeWorkspace = {subtitleContext?:{identity:VisualIdentity;cueContext:LyricCueContext};lyricCueReview?:LyricCueReview;subtitlesEnabled?:boolean;scenePlan?:ScenePlan;channelBranding?:unknown;pending?:{id:string;startedAt:string;action:string};revision:number; instructions:string; bible:string; approvedBible?:string; slots:VisualSlot[]; analysis?:AudioAnalysis; plan?:{scenes:Timing[]; shorts:Timing[]; approved:boolean}; audioKey?:string};
export const emptyWorkspace = ():CreativeWorkspace=>({revision:0,instructions:'',bible:'',slots:[]});
export function lyricSections(lyrics:string) {return [...lyrics.matchAll(/^\s*\[([^\]]+)\]/gm)].map(m=>m[1]);}
export function makeSlots(duration:number,lyrics:string):VisualSlot[] {
 const sections=lyricSections(lyrics);const count=Math.max(1,Math.min(24,Math.max(sections.length,Math.ceil(duration/30))));
 return [
  ...Array.from({length:count},(_,i)=>({kind:'scene' as const,id:`scene-${i+1}`,number:i+1,label:sections[i]||`Scene ${i+1}`})),
  ...Array.from({length:6},(_,i)=>({kind:'short' as const,id:`short-${i+1}`,number:i+1,label:`Short ${i+1}`})),
  {kind:'cover' as const,id:'cover',number:1,label:'Cover artwork'}, {kind:'thumbnail' as const,id:'thumbnail',number:1,label:'YouTube thumbnail'},
 ].map(s=>({...s,prompt:`${s.label}: a distinct cinematic moment inspired by the song.`,candidates:[]}));
}
export function proposePlan(slots:VisualSlot[],analysis:AudioAnalysis,lyrics:string) {
 const {duration,energy}=analysis;const scenes=slots.filter(s=>s.kind==='scene');const labels=lyricSections(lyrics);
 const length=Math.min(22,duration); const maxStart=Math.max(0,duration-length);
 const boundaries=[0];for(let i=1;i<scenes.length;i++){const expected=duration*i/scenes.length,radius=Math.min(8,duration/scenes.length/4);const quiet=energy.filter(e=>Math.abs(e.time-expected)<=radius&&e.time>boundaries[i-1]+1).sort((a,b)=>a.rms-b.rms)[0];boundaries.push(Math.round((quiet?.time??expected)*100)/100);}boundaries.push(duration);
 return {approved:false,scenes:scenes.map((s,i)=>({slotId:s.id,start:boundaries[i],end:boundaries[i+1],label:labels[i]||s.label})),shorts:slots.filter(s=>s.kind==='short').map((s,i)=>{
  const anchor=maxStart*i/5;const radius=maxStart/12;
  const best=energy.filter(x=>Math.abs(x.time-anchor)<=radius&&x.time<=maxStart).sort((a,b)=>b.rms-a.rms)[0];
  const start=Math.round((best?.time??anchor)*100)/100;
  return {slotId:s.id,start,end:Math.min(duration,start+length),label:`Energy suggestion ${i+1} — review by listening`};
 })};
}
export function validatePlan(w:CreativeWorkspace) {
 if(!w.plan||!w.analysis||!(w.analysis.duration>0))throw Error('Analyse the final audio and create a plan first.');
 const scenes=w.slots.filter(s=>s.kind==='scene');
 if(w.plan.scenes.length!==scenes.length||w.plan.shorts.length!==6)throw Error('Plan needs every scene and exactly six Shorts.');
 for(const [kind,rows] of [['scene',w.plan.scenes],['short',w.plan.shorts]] as const){
  if(new Set(rows.map(r=>r.slotId)).size!==rows.length)throw Error('Each slot must appear once.');
  rows.forEach((r,i)=>{
   if(!w.slots.some(s=>s.id===r.slotId&&s.kind===kind)||!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start||r.end>w.analysis!.duration+.05)throw Error('Timing is outside the final audio.');
   if(kind==='short'&&(r.end-r.start<8||r.end-r.start>60))throw Error('Shorts must be between 8 and 60 seconds.');
   if(kind==='scene'&&Math.abs(r.start-(i?rows[i-1].end:0))>.05)throw Error('Full-video scenes must join without gaps or overlaps.');
  });
 }
 if(Math.abs(w.plan.scenes.at(-1)!.end-w.analysis.duration)>.05)throw Error('Full-video plan must cover the complete song.');
}
export function approvedCandidate(s:VisualSlot){return s.candidates.find(c=>c.id===s.approvedId);}
export function visualsComplete(w:CreativeWorkspace){return w.slots.length>0&&w.slots.filter(s=>s.kind==='short').length===6&&w.slots.every(s=>!!approvedCandidate(s));}
// Stable dependency keys exclude signed URLs, draft prompts and unrelated slots.
export function outputKey(w:CreativeWorkspace,slot:number,audioKey:string) {
 const timings=slot===0?w.plan?.scenes:w.plan?.shorts.filter(t=>t.slotId===`short-${slot}`);
 return JSON.stringify({...(subtitleOutputDependency(w,slot)?{lyricSubtitles:subtitleOutputDependency(w,slot)}:{}),...(w.channelBranding?{channelBranding:w.channelBranding}:{}),audio:audioKey,kind:slot===0?'full':`short-${slot}`,timings:timings?.map(t=>({start:t.start,end:t.end,id:t.slotId,visual:w.slots.find(s=>s.id===t.slotId)?.approvedId}))||[]});
}

// Keep the existing key format: saved plans and immutable render versions use it.
export function finalAudioKey(audio?:{id?:string;storagePath?:string;updatedAt?:string}|null) {
 return JSON.stringify([audio?.id,audio?.storagePath,audio?.updatedAt]);
}
export type VideoVersion={id:string;slot:number;source:string;dependencyKey:string};
export type VideoInventory={versions:VideoVersion[];approved:Record<string,string>};
export const outputNames=['full',...Array.from({length:6},(_,i)=>`short-${i+1}`)];
export function currentVideo(w:CreativeWorkspace,v:VideoVersion,audioKey:string){return v.source==='uploaded'||v.dependencyKey===outputKey(w,v.slot,audioKey);}
export function suppliedOutput(w:CreativeWorkspace,assets:any,slot:number,videos?:VideoInventory){
 const inventory=videos||assets.creativeVideos;
 const name=outputNames[slot],version=inventory?.versions.find((v:VideoVersion)=>v.slot===slot&&v.id===inventory.approved[name]);
 if(version)return currentVideo(w,version,finalAudioKey(assets.audio));
 return (slot?assets.shorts:assets.fullVideos).some((v:any)=>v._approved&&['generated','uploaded'].includes(v._source)&&(!slot||Number(v.slot)===slot)&&(!inventory?.versions.some((c:VideoVersion)=>c.id===v.id)||inventory.approved[name]===v.id&&currentVideo(w,v,finalAudioKey(assets.audio))));
}
export function requiredVisualSlots(w:CreativeWorkspace,assets:any,videos?:VideoInventory){
 return w.slots.filter(s=>s.kind==='scene'?!suppliedOutput(w,assets,0,videos):s.kind==='short'?!suppliedOutput(w,assets,s.number,videos):!assets.artwork.some((a:any)=>(a.mediaKind||a.media_kind)===(s.kind==='cover'?'cover-art':'thumbnail')));
}
export function renderPrerequisite(w:CreativeWorkspace,audio:any,slot:number,dirtyPlan=false){
 if(!audio?.url)return {kind:'audio',message:'Add final audio to create this video.'};
 const subtitleError=subtitleBlocker(w,finalAudioKey(audio));if(subtitleError)return {kind:'subtitles',message:subtitleError};
 if(!w.analysis||w.analysis.sourceKey!==finalAudioKey(audio))return {kind:'analysis',message:'Analyse the current final audio to prepare its Video Plan.'};
 if(dirtyPlan)return {kind:'plan',message:'Save and approve your edited Video Plan.'};
 if(!w.plan)return {kind:'analysis',message:'Analyse the final audio to prepare its Video Plan.'};
 try{validatePlan(w);}catch(e){return {kind:'timing',message:e instanceof Error?e.message:'Review the Video Plan timings.'};}
 if(!w.plan.approved)return {kind:'plan',message:'Review and approve the Video Plan before creating videos.'};
 const timings=slot===0?w.plan.scenes:w.plan.shorts.filter(t=>t.slotId===`short-${slot}`);
 const missing=timings.find(t=>{const s=w.slots.find(s=>s.id===t.slotId);return !s||!approvedCandidate(s);});
 if(missing)return {kind:'visual',message:`Approve ${w.slots.find(s=>s.id===missing.slotId)?.label||missing.slotId} before creating ${slot?`Short ${slot}`:'the full video'}.`};
 return null;
}
export function videoReadiness(w:CreativeWorkspace,assets:any,videos:VideoInventory,dirtyPlan=false){
 const audioKey=finalAudioKey(assets.audio);
 const outputs=outputNames.map((name,slot)=>{
  const approved=suppliedOutput(w,assets,slot,videos);
  const candidate=videos.versions.filter(v=>v.slot===slot&&currentVideo(w,v,audioKey)).at(-1);
  return {name,slot,approved,candidate,blocker:!approved&&!candidate?renderPrerequisite(w,assets.audio,slot,dirtyPlan):null};
 });
 return {outputs,missing:outputs.filter(o=>!o.approved&&!o.candidate),review:outputs.filter(o=>!o.approved&&o.candidate),approvedCount:outputs.filter(o=>o.approved).length,complete:outputs.every(o=>o.approved)};
}

// A failed read is unknown, not removal of the master. Refresh only writes real changes.
export function dependencySyncKeys(w:CreativeWorkspace|undefined,audioResponse:any,videos:{keys?:Record<string,string>}|null){
 if(!audioResponse||!w?.slots.length||!videos)return null;
 const keys=Object.fromEntries(outputNames.map((name,slot)=>[name,outputKey(w,slot,finalAudioKey(audioResponse.asset))]));
 return Object.entries(keys).some(([name,key])=>videos.keys?.[name]!==key)?keys:null;
}

export const SUBTITLE_REVIEW_REQUIRED='Subtitles are enabled, but reviewed lyric timings are required.';
export function subtitleSettings(w:CreativeWorkspace,slot=0){
 const identity=w.subtitleContext?.identity;if(!identity)return undefined;
 const layout=slot===0?'landscape':'portrait';
 return {...identity.subtitles,...identity[layout]?.subtitles,enabled:w.subtitlesEnabled??identity.subtitles.enabled};
}
export function subtitleBlocker(w:CreativeWorkspace,audioKey?:string){
 if(!subtitleSettings(w)?.enabled)return null;
 const context=w.subtitleContext!.cueContext;
 return (!context.source||audioKey!==undefined&&context.source.audioKey!==audioKey||lyricCueState(w.lyricCueReview,context.source,context.phrases)!=='current')?SUBTITLE_REVIEW_REQUIRED:null;
}
function subtitleOutputDependency(w:CreativeWorkspace,slot:number){
 const settings=subtitleSettings(w,slot);if(!settings?.enabled)return undefined;
 const context=w.subtitleContext!.cueContext;
 // Unavailable data has a non-renderable key: it cannot revive an old subtitled approval.
 const blocked=subtitleBlocker(w);
 return {settings,language:context.language,...(blocked?{unavailable:true,source:context.source}:{review:JSON.parse(lyricSubtitleDependency(w,context,true)!)})};
}
export function structuredSubtitleFinishing(w:CreativeWorkspace,slot:number){
 const settings=subtitleSettings(w,slot);if(!settings)return {};
 const blocked=subtitleBlocker(w);if(blocked)throw Error(blocked);
 return {structuredSubtitles:settings,subtitles:settings.enabled,cues:settings.enabled?w.lyricCueReview!.cues:[],reviewed:settings.enabled,language:w.subtitleContext!.cueContext.language,lyrics:''};
}
