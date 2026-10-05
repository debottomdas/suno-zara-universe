import {approvedCandidate,type CreativeWorkspace,type VisualSlot} from './model';

// Required slots come from the existing supplied-output/artwork rules in CreativeStudio.
// An unapproved candidate is review work, never a missing image to buy again.
export function visualBatchState(w:CreativeWorkspace,required:VisualSlot[]) {
 const missing=required.filter(s=>!s.candidates.length);
 const review=required.filter(s=>s.candidates.length&&!approvedCandidate(s));
 const artwork=required.filter(s=>['cover','thumbnail'].includes(s.kind)&&approvedCandidate(s));
 const ready=w.slots.length>0&&w.slots.filter(s=>s.kind==='short').length===6&&!missing.length&&!review.length&&!artwork.length;
 const count=(kind:VisualSlot['kind'])=>required.filter(s=>s.kind===kind).length;
 const summary=[count('scene')?`${count('scene')} music-video scenes`:null,count('short')?`${count('short')} Short visuals`:null,count('cover')?'Cover artwork':null,count('thumbnail')?'YouTube thumbnail':null].filter(Boolean).join(' · ');
 return {missing,review:[...review,...artwork],ready,summary,label:ready?'Continue to Video & Shorts →':missing.length?(missing.length===w.slots.length?'Generate Visuals':`Generate ${missing.length} Missing Visuals`):'Approve reviewed visuals'};
}

type Request=(action:string,body:Record<string,unknown>,revision:number)=>Promise<CreativeWorkspace>;
// Orchestration only: every mutation uses the existing endpoint and returned revision.
// No retries; the caller must reload after any uncertain result before another batch.
export async function runVisualBatch(initial:CreativeWorkspace,slots:VisualSlot[],action:'generate'|'approve-image',request:Request,onProgress:(complete:number,total:number)=>void,isActive:()=>boolean=()=>true) {
 let next=initial,complete=0;
 onProgress(0,slots.length);
 for(const selected of slots){
  if(!isActive())break;
  const slot=next.slots.find(s=>s.id===selected.id);
  if(!slot)throw Error('The visual plan changed. Reload before continuing.');
  if(action==='generate'){
   if(!next.scenePlan?.reviewed)throw Error('Prepare and approve a distinct scene plan before generating visuals.');
   if(!next.bible.trim()||next.bible!==next.approvedBible||next.pending)throw Error('Approve the current Visual Direction before generating visuals.');
   if(!slot.candidates.length)next=await request('generate',{slotId:slot.id,confirmPaid:true,missingOnly:true},next.revision);
  }else{
   const candidate=approvedCandidate(slot)||slot.candidates.at(-1);
   if(!candidate)throw Error('Generate or upload the missing visual first.');
   next=await request('approve-image',{slotId:slot.id,candidateId:candidate.id},next.revision);
  }
  onProgress(++complete,slots.length);
 }
 return next;
}
