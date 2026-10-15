import {emptyWorkspace,requiredVisualSlots,approvedCandidate,suppliedOutput} from './creative/model';
export type ReleaseStage='Lyrics'|'Suno Style'|'Final Audio'|'Visuals'|'Video & Shorts'|'Social'|'Publish';
// This is an inventory of saved deliverables, not a second workflow or persisted state.
export function releaseGaps(song:any,assets:any,socialReady:boolean){
 const w=assets.creative||emptyWorkspace();
 const full=suppliedOutput(w,assets,0),shorts=new Set([1,2,3,4,5,6].filter(slot=>suppliedOutput(w,assets,slot)));
 const missingShorts=[1,2,3,4,5,6].filter(n=>!shorts.has(n));
 const artwork=(kind:string)=>assets.artwork.some((a:any)=>(a.mediaKind||a.media_kind)===kind);
 const gaps:Array<{label:string;stage:ReleaseStage}>=[];
 // A supplied video needs no separate master unless the creator chooses to render more video.
 if(!assets.audio&&!full){gaps.push({label:'Final audio (for rendering) or your finished video',stage:'Final Audio'});}
 if(!artwork('cover-art'))gaps.push({label:'Cover artwork',stage:'Visuals'});
 if(!artwork('thumbnail'))gaps.push({label:'YouTube thumbnail',stage:'Visuals'});
 const visualWork=requiredVisualSlots(w,assets).filter(s=>['scene','short'].includes(s.kind)&&!approvedCandidate(s));
 if(visualWork.length)gaps.push({label:`${visualWork.length} visuals to create or approve`,stage:'Visuals'});
 if(!full)gaps.push({label:'Full video',stage:'Video & Shorts'});
 if(missingShorts.length)gaps.push({label:`Shorts ${missingShorts.join(', ')}`,stage:'Video & Shorts'});
 if(!socialReady)gaps.push({label:'Social copy',stage:'Social'});
 const hasProduction=assets.audio||assets.fullVideos.length||assets.shorts.length||assets.artwork.length;
 const next:ReleaseStage=!hasProduction&&!song.lyrics?.trim()&&song.hooks?.length?'Lyrics':gaps[0]?.stage||'Publish';
 return {full,shorts:shorts.size,missingShorts,gaps,next};
}
