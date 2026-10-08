import {NextResponse} from 'next/server';
import {mkdir,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {snapshot,worker} from '@/utils/publishing/snapshot';
import {executeApproved,assertDeliveryHistory,resumeDeliveryRows,preserveConfirmedDelivery,classifyBufferReconciliation} from '@/utils/publishing/execute';
import {validatePlan} from '@/utils/publishing/plan';
import {POST as youtubeSession} from '@/app/api/publishing/youtube/direct-session/route';
import {POST as youtubeComplete} from '@/app/api/publishing/youtube/direct-complete/route';
import {POST as youtubeSchedule} from '@/app/api/publishing/youtube/schedule/route';
import {POST as stageSession} from '@/app/api/publishing/buffer/stage-session/route';
import {POST as stageComplete} from '@/app/api/publishing/buffer/stage-complete/route';
import {POST as bufferCreate} from '@/app/api/publishing/buffer/create-posts-batch/route';
import {POST as bufferPostStatus} from '@/app/api/publishing/buffer/post-status/route';
import {POST as bufferSchedule} from '@/app/api/publishing/buffer/schedule-posts-batch/route';
import {GET as bufferStatus} from '@/app/api/publishing/buffer/status/route';
export const runtime='nodejs';
export const maxDuration=300;
const lockRoot=join(tmpdir(),'sunozara-publishing-locks');
type PublishingErrorCode='auth_required'|'provider_unavailable'|'destination_mismatch'|'local_service_unavailable'|'safe_failure'|'uncertain_outcome'|'validation_failed';
function classifyPublishingError(message:string,retrySafe=false):PublishingErrorCode{
 const value=message.toLowerCase();
 if(/sign in|oauth|authorization|reconnect|token|permission/.test(value))return 'auth_required';
 if(/destination preflight failed|assigned channel|more than one youtube destination/.test(value))return 'destination_mismatch';
 if(/local worker unavailable|127\.0\.0\.1|local service/.test(value))return 'local_service_unavailable';
 if(/buffer|youtube|provider|rate.?limit|quota|temporarily unavailable/.test(value))return 'provider_unavailable';
 if(retrySafe)return 'safe_failure';
 if(/reconcil|uncertain|unknown|failed to fetch|network|timeout/.test(value))return 'uncertain_outcome';
 return 'validation_failed';
}
function publishingError(message:string,retrySafe=false){return Object.assign(new Error(message),{retrySafe,code:classifyPublishingError(message,retrySafe)});}
async function callGet(handler:(r:Request)=>Promise<Response>,url:string){const r=await handler(new Request(url));const d=await r.json();if(!r.ok)throw publishingError(d.error||'Provider preflight failed.');return d;}
async function call(handler:(r:Request)=>Promise<Response>,body:any){const r=await handler(new Request('http://local/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));const d=await r.json();if(!r.ok)throw publishingError(d.error||'Delivery stopped.',d.retrySafe===true);return d;}
export async function POST(req:Request){let lock='',acquired=false;try{
 const {plan,approved,madeForKids,containsSyntheticMedia,resumeCampaign}=await req.json();
 if(approved!==true)throw Error('Explicit creator approval is required.');
 let state=await snapshot(plan.projectId,plan.channelId);let rows=validatePlan(plan,state);
 await mkdir(lockRoot,{recursive:true});lock=join(lockRoot,createHash('sha256').update(state.userId+':'+state.projectId).digest('hex'));
 try{await mkdir(lock);acquired=true;}catch{throw Error('This release has an active or interrupted delivery. Reconcile it before retrying.');}
 state=await snapshot(plan.projectId,plan.channelId);rows=validatePlan(plan,state);
 const projectId=state.projectId,timezone=plan.timezone;
 const keyFor=(row:any)=>row.destination.platform==='youtube'?(row.asset.slot?`youtube-short-${String(row.asset.slot).padStart(2,'0')}`:'youtube-full'):`buffer-${row.destination.id}-short-${String(row.asset.slot).padStart(2,'0')}`;
 // Resume never replays confirmed work. Uncertain receipts stay untouched while
 // independent not-started publications can continue safely.
 let resume=resumeCampaign===true?resumeDeliveryRows(rows,state):{actionable:rows,skipped:[],unresolved:[]};
 // Resume reconciles uncertain Buffer receipts against the exact existing provider
 // post before deciding whether that publication may be retried.
 if(resumeCampaign===true){
  const remaining:any[]=[];
  for(const row of resume.unresolved){
   const old=state.canonicalReceipts.find((r:any)=>r.itemKey===keyFor(row));
   if(row.destination.platform==='youtube'||!old?.postId){remaining.push(row);continue;}
   const status=await call(bufferPostStatus,{projectId,postIds:[old.postId]});
   const providerPost=status.posts?.find((p:any)=>p.id===old.postId);
   const decision=classifyBufferReconciliation(old,providerPost);
   const resolvedAt=new Date().toISOString();
   if(decision.state==='delivered'){
    const receipt={...old,status:decision.status,scheduledAt:decision.scheduledAt,publishedAt:decision.publishedAt,externalLink:decision.externalLink,providerCheckedAt:resolvedAt,reconciliation:{state:'delivered',resolvedAt,note:'Confirmed from Buffer before resume.'}};
    await worker('/publishing/buffer/receipt',{projectId,receipt});
    resume.skipped.push(row);
    continue;
   }
   if(decision.state==='retry_allowed'){
    const receipt={...old,status:decision.status,providerCheckedAt:resolvedAt,reconciliation:{state:'retry_allowed',resolvedAt,note:'Buffer explicitly confirmed a retry-safe state.'}};
    await worker('/publishing/buffer/receipt',{projectId,receipt});
    // Keep the locked in-memory snapshot aligned with the persisted reconciliation.
    // assertDeliveryHistory below must see the explicit retry permission we just earned.
    const receiptIndex=state.canonicalReceipts.findIndex((r:any)=>r.itemKey===old.itemKey);
    if(receiptIndex>=0)state.canonicalReceipts[receiptIndex]=receipt;
    resume.actionable.push(row);
    continue;
   }
   remaining.push(row);
  }
  resume={...resume,unresolved:remaining};
 }
 rows=resume.actionable;
 // Campaign-wide provider preflight must finish before any receipt write, media
 // staging, upload session or external mutation begins.
 const youtubeRows=rows.filter((r:any)=>r.destination.platform==='youtube');
 if(youtubeRows.length){
  const uniqueYoutube=[...new Set(youtubeRows.map((r:any)=>r.destination.id))];
  if(uniqueYoutube.length!==1)throw Error('Publishing plan contains more than one YouTube destination.');
  const probe=youtubeRows[0];
  const info=await worker(`/publishing/file-info?projectId=${encodeURIComponent(projectId)}&kind=${probe.asset.slot?'short':'full'}&slot=${probe.asset.slot||1}`);
  const verified=await call(youtubeSession,{projectId,kind:probe.asset.slot?'short':'full',slot:probe.asset.slot||1,...info,connectionId:probe.destination.id,privacyStatus:'private',publishAt:probe.dueAt,selfDeclaredMadeForKids:madeForKids===true,containsSyntheticMedia:containsSyntheticMedia!==false,preflightOnly:true});
  if(verified.preflightVerified!==true)throw Error('YouTube destination could not be verified before publishing.');
 }
 const bufferRowsForPreflight=rows.filter((r:any)=>r.destination.platform!=='youtube');
 if(bufferRowsForPreflight.length){
  const status=await callGet(bufferStatus,`http://local/api?channelId=${encodeURIComponent(plan.channelId)}&refresh=1`);
  const live=new Set((status.channels||[]).map((x:any)=>`${String(x.service).toLowerCase()}:${x.id}:${x.bufferAccountId||''}`));
  const missing=bufferRowsForPreflight.filter((r:any)=>!live.has(`${r.destination.platform}:${r.destination.id}:${r.destination.accountId||''}`));
  if(missing.length)throw Error(`Buffer destination preflight failed for: ${[...new Set(missing.map((r:any)=>r.destination.name||r.destination.platform))].join(', ')}. Nothing was published.`);
 }
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
 const base={...old,...(relatedVideo?{relatedVideo}:{}),itemKey,slot:slot||1,kind,platform:row.destination.platform,service:row.destination.platform,channelId:row.destination.id,channelName:row.destination.name,assetVersion:row.asset.version,timezone,localTime:row.localTime,dueAt:row.dueAt,status:'submitting',reconciliation:undefined};
 await worker(receiptPath,{projectId,receipt:base});
 // An interrupted attempt stays submitting. A retry must reconcile provider state,
 // rather than treating an unknown outcome as permission to create a duplicate.
 if(row.destination.platform==='youtube'){
  if(old?.videoId){const result=await call(youtubeSchedule,{projectId,videoId:old.videoId,publishAt:row.dueAt});if(Date.parse(result.publishAt)!==Date.parse(row.dueAt))throw Error('YouTube did not confirm the requested time. Check provider status before retrying.');await worker(receiptPath,{projectId,receipt:{...base,status:'scheduled',scheduledAt:row.dueAt}});return;}
  const info=await worker(`/publishing/file-info?projectId=${encodeURIComponent(projectId)}&kind=${kind}&slot=${slot||1}`);
  let session;
 try{
  session=await call(youtubeSession,{projectId,kind,slot:slot||1,...info,connectionId:row.destination.id,privacyStatus:'private',publishAt:row.dueAt,selfDeclaredMadeForKids:madeForKids===true,containsSyntheticMedia:containsSyntheticMedia!==false});
 }catch(e){
  if((e as Error & {retrySafe?:boolean}).retrySafe===true){
   await worker(receiptPath,{projectId,receipt:{...base,status:'draft'}});
  }
  throw e;
 }
  const upload=await worker('/publish/youtube',{projectId,kind,slot:slot||1,uploadUrl:session.uploadUrl,accessToken:session.transientAccessToken,publishAt:row.dueAt,timezone,assetVersion:row.asset.version,channelId:row.destination.id,channelName:row.destination.name});
  await worker(receiptPath,{projectId,receipt:{...base,...upload,assetVersion:row.asset.version,status:'scheduled',scheduledAt:row.dueAt,timezone}});
  await call(youtubeComplete,{projectId,kind,slot:slot||1,videoId:upload.videoId,title:session.title,description:session.description,tags:session.tags,privacyStatus:'private',publishAt:row.dueAt,timezone});
 }
 },rows);
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
   const prepared=pending.map(row=>{const old=state.canonicalReceipts.find((r:any)=>r.itemKey===keyFor(row));return {row,receipt:{...old,...(reuse?{}:{...media,postId:undefined}),itemKey:keyFor(row),slot,service:row.destination.platform,channelId:row.destination.id,channelName:row.destination.name,assetVersion:row.asset.version,timezone,localTime:row.localTime,dueAt:row.dueAt,publishMode:'schedule',status:'submitting',reconciliation:undefined}}});
   for(const p of prepared){const old=state.canonicalReceipts.find((r:any)=>r.itemKey===p.receipt.itemKey);await worker('/publishing/buffer/receipt',{projectId,receipt:preserveConfirmedDelivery(old,p.receipt)});}
   const response=await call(reuse?bufferSchedule:bufferCreate,{projectId,items:prepared.map(({receipt:r})=>({slot,channelId:r.channelId,service:r.service,mediaUrl:r.mediaUrl,publishMode:'schedule',dueAt:r.dueAt,...(reuse?{postId:r.postId,itemKey:r.itemKey}:{})}))});
   let failed=false;
   for(const p of prepared){const result=response.results?.find((x:any)=>x.channelId===p.receipt.channelId&&x.slot===slot);if(!result?.post?.id){failed=true;continue;}const confirmed=result.post.status==='scheduled'&&Date.parse(result.post.dueAt)===Date.parse(p.receipt.dueAt);if(!confirmed)failed=true;{const old=state.canonicalReceipts.find((r:any)=>r.itemKey===p.receipt.itemKey);const next={...p.receipt,postId:result.post.id,status:confirmed?'scheduled':['error','failed','draft'].includes(result.post.status)?result.post.status:'submitting',externalLink:result.post.externalLink};await worker('/publishing/buffer/receipt',{projectId,receipt:preserveConfirmedDelivery(old,next)});}}
   if(failed)throw Error('Some provider outcomes need reconciliation. Successful receipts are saved; no uncertain post will be retried automatically.');
  }
 }
 return NextResponse.json({scheduled:count,skipped:resume.skipped.length,unresolved:resume.unresolved.length});
 }catch(e){const message=e instanceof Error?e.message:'Scheduling stopped. Check delivery status before retrying.';const code=(e as Error & {code?:PublishingErrorCode;retrySafe?:boolean})?.code||classifyPublishingError(message,(e as any)?.retrySafe===true);return NextResponse.json({error:message,code,retrySafe:(e as any)?.retrySafe===true},{status:409});}finally{if(acquired)await rmdir(lock).catch(()=>{});}}
