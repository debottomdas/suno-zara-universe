import {NextResponse} from 'next/server';
import {mkdir,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {snapshot,worker} from '@/utils/publishing/snapshot';
import {executeApproved,assertDeliveryHistory} from '@/utils/publishing/execute';
import {validatePlan} from '@/utils/publishing/plan';
import {POST as youtubeSession} from '@/app/api/publishing/youtube/direct-session/route';
import {POST as youtubeComplete} from '@/app/api/publishing/youtube/direct-complete/route';
import {POST as youtubeSchedule} from '@/app/api/publishing/youtube/schedule/route';
import {POST as stageSession} from '@/app/api/publishing/buffer/stage-session/route';
import {POST as stageComplete} from '@/app/api/publishing/buffer/stage-complete/route';
import {POST as bufferCreate} from '@/app/api/publishing/buffer/create-posts-batch/route';
import {POST as bufferPostStatus} from '@/app/api/publishing/buffer/post-status/route';
import {POST as bufferSchedule} from '@/app/api/publishing/buffer/schedule-posts-batch/route';
export const runtime='nodejs';
export const maxDuration=300;
const lockRoot=join(tmpdir(),'sunozara-publishing-locks');
async function call(handler:(r:Request)=>Promise<Response>,body:any){const r=await handler(new Request('http://local/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));const d=await r.json();if(!r.ok)throw Error(d.error||'Delivery stopped.');return d;}
export async function POST(req:Request){let lock='',acquired=false;try{
 const {plan,approved,madeForKids,containsSyntheticMedia}=await req.json();
 if(approved!==true)throw Error('Explicit creator approval is required.');
 let state=await snapshot(plan.projectId,plan.channelId);let rows=validatePlan(plan,state);
 await mkdir(lockRoot,{recursive:true});lock=join(lockRoot,createHash('sha256').update(state.userId+':'+state.projectId).digest('hex'));
 try{await mkdir(lock);acquired=true;}catch{throw Error('This release has an active or interrupted delivery. Reconcile it before retrying.');}
 state=await snapshot(plan.projectId,plan.channelId);rows=validatePlan(plan,state);
 const projectId=state.projectId,timezone=plan.timezone;
 const keyFor=(row:any)=>row.destination.platform==='youtube'?(row.asset.slot?`youtube-short-${String(row.asset.slot).padStart(2,'0')}`:'youtube-full'):`buffer-${row.destination.id}-short-${String(row.asset.slot).padStart(2,'0')}`;
 // Preflight the entire campaign before the first external change. Never overwrite
 // an unresolved attempt or infer that an older asset's receipt is current success.
 assertDeliveryHistory(rows,state);
 for(const row of rows){const old=state.canonicalReceipts.find((r:any)=>r.itemKey===keyFor(row));if(old?.status==='error'){const status=await call(bufferPostStatus,{projectId,postIds:[old.postId]});if(status.posts?.find((p:any)=>p.id===old.postId)?.status!=='error')throw Error('The provider no longer confirms a failed post. Refresh status before retrying.');}}
 const bufferRows:any[]=[];
 const count=await executeApproved(plan,state,approved,async row=>{
 if(row.destination.platform!=='youtube'){bufferRows.push(row);return;}
 const fresh=await snapshot(projectId,plan.channelId);
 if(!fresh.ready||JSON.stringify(fresh.assets.map((a:any)=>a.version))!==JSON.stringify(state.assets.map((a:any)=>a.version))||JSON.stringify(fresh.social)!==JSON.stringify(state.social))throw Error('Release changed during scheduling. Remaining posts were stopped.');
 const slot=row.asset.slot,kind=slot?'short':'full',itemKey=keyFor(row),old=state.canonicalReceipts.find((r:any)=>r.itemKey===itemKey);
 const receiptPath=row.destination.platform==='youtube'?'/publishing/youtube/receipt':'/publishing/buffer/receipt';
 const shortRecords=(state.social?.youtube_shorts as {shorts?:{shortNumber:number;relatedVideo?:{dependency?:string;[key:string]:unknown}}[]}|undefined)?.shorts;
 const shortCopy=slot?shortRecords?.find(s=>s.shortNumber===slot):null;
 const related=shortCopy?.relatedVideo;
 let relatedVideo;
 if(row.destination.platform==='youtube'&&slot&&related?.dependency==='publish-long-video-first'){
  const long=fresh.canonicalReceipts.find((r:{itemKey:string;channelId:string;assetVersion:string;status:string;videoId?:string})=>r.itemKey==='youtube-full'&&r.channelId===row.destination.id&&r.assetVersion===fresh.assets.find(a=>a.slot===0)?.version&&['scheduled','published'].includes(r.status));
  if(!/^[A-Za-z0-9_-]{11}$/.test(long?.videoId||''))throw Error('The corresponding long video ID is unavailable. Shorts were stopped.');
  relatedVideo={...related,youtubeVideoId:long.videoId,method:'youtube-studio',status:'needs-studio-link-after-long-is-public-or-unlisted'};
 }
 const base={...old,...(relatedVideo?{relatedVideo}:{}),itemKey,slot:slot||1,kind,platform:row.destination.platform,service:row.destination.platform,channelId:row.destination.id,channelName:row.destination.name,assetVersion:row.asset.version,timezone,localTime:row.localTime,dueAt:row.dueAt,status:'submitting'};
 await worker(receiptPath,{projectId,receipt:base});
 // An interrupted attempt stays submitting. A retry must reconcile provider state,
 // rather than treating an unknown outcome as permission to create a duplicate.
 if(row.destination.platform==='youtube'){
  if(old?.videoId){const result=await call(youtubeSchedule,{projectId,videoId:old.videoId,publishAt:row.dueAt});if(Date.parse(result.publishAt)!==Date.parse(row.dueAt))throw Error('YouTube did not confirm the requested time. Check provider status before retrying.');await worker(receiptPath,{projectId,receipt:{...base,status:'scheduled',scheduledAt:row.dueAt}});return;}
  const info=await worker(`/publishing/file-info?projectId=${encodeURIComponent(projectId)}&kind=${kind}&slot=${slot||1}`);
  const session=await call(youtubeSession,{projectId,kind,slot:slot||1,...info,connectionId:row.destination.id,privacyStatus:'private',publishAt:row.dueAt,selfDeclaredMadeForKids:madeForKids===true,containsSyntheticMedia:containsSyntheticMedia!==false});
  const upload=await worker('/publish/youtube',{projectId,kind,slot:slot||1,uploadUrl:session.uploadUrl,accessToken:session.transientAccessToken,publishAt:row.dueAt,timezone});
  await worker(receiptPath,{projectId,receipt:{...base,...upload,assetVersion:row.asset.version,status:'scheduled',scheduledAt:row.dueAt,timezone}});
  await call(youtubeComplete,{projectId,kind,slot:slot||1,videoId:upload.videoId,title:session.title,description:session.description,tags:session.tags,privacyStatus:'private',publishAt:row.dueAt,timezone});
 }
 });
 // Submit every destination that shares a staged Short in ONE batch. The existing
 // media ledger reserves that file once and records all its dependent posts.
 for(const groupKey of [...new Set(bufferRows.map(r=>`${r.asset.slot}:${r.destination.accountId||'legacy'}`))]){
  const group=bufferRows.filter(r=>`${r.asset.slot}:${r.destination.accountId||'legacy'}`===groupKey);const slot=group[0].asset.slot;
  const fresh=await snapshot(projectId,plan.channelId);
  if(!fresh.ready||JSON.stringify(fresh.assets.map((a:any)=>a.version))!==JSON.stringify(state.assets.map((a:any)=>a.version))||JSON.stringify(fresh.social)!==JSON.stringify(state.social))throw Error('Release changed during scheduling. Remaining posts were stopped.');
  for(const reuse of [false,true]){
   const pending=group.filter(row=>{const old=state.canonicalReceipts.find((r:any)=>r.itemKey===keyFor(row));return Boolean(old?.postId&&old.status!=='error')===reuse;});
   if(!pending.length)continue;
   let media:any;
   if(!reuse){const info=await worker(`/publishing/file-info?projectId=${encodeURIComponent(projectId)}&kind=short&slot=${slot}`);const session=await call(stageSession,{projectId,slot,originalFilename:info.filename,mimeType:info.mimeType,sizeBytes:info.sizeBytes});await worker('/publish/buffer/stage',{projectId,slot,signedUploadUrl:session.upload.signedUploadUrl});const opened=await call(stageComplete,{projectId,storagePath:session.upload.storagePath});media={storagePath:session.upload.storagePath,mediaUrl:opened.mediaUrl};}
   const prepared=pending.map(row=>{const old=state.canonicalReceipts.find((r:any)=>r.itemKey===keyFor(row));return {row,receipt:{...old,...(reuse?{}:{...media,postId:undefined}),itemKey:keyFor(row),slot,service:row.destination.platform,channelId:row.destination.id,channelName:row.destination.name,assetVersion:row.asset.version,timezone,localTime:row.localTime,dueAt:row.dueAt,publishMode:'schedule',status:'submitting'}}});
   for(const p of prepared)await worker('/publishing/buffer/receipt',{projectId,receipt:p.receipt});
   const response=await call(reuse?bufferSchedule:bufferCreate,{projectId,items:prepared.map(({receipt:r})=>({slot,channelId:r.channelId,service:r.service,mediaUrl:r.mediaUrl,publishMode:'schedule',dueAt:r.dueAt,...(reuse?{postId:r.postId,itemKey:r.itemKey}:{})}))});
   let failed=false;
   for(const p of prepared){const result=response.results?.find((x:any)=>x.channelId===p.receipt.channelId&&x.slot===slot);if(!result?.post?.id){failed=true;continue;}const confirmed=result.post.status==='scheduled'&&Date.parse(result.post.dueAt)===Date.parse(p.receipt.dueAt);if(!confirmed)failed=true;await worker('/publishing/buffer/receipt',{projectId,receipt:{...p.receipt,postId:result.post.id,status:confirmed?'scheduled':['error','failed','draft'].includes(result.post.status)?result.post.status:'submitting',externalLink:result.post.externalLink}});}
   if(failed)throw Error('Some provider outcomes need reconciliation. Successful receipts are saved; no uncertain post will be retried automatically.');
  }
 }
 return NextResponse.json({scheduled:count});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Scheduling stopped. Check delivery status before retrying.'},{status:409});}finally{if(acquired)await rmdir(lock).catch(()=>{});}}
