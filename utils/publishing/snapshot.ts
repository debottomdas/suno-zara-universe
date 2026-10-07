import {applyChannelPublishing} from '@/utils/channel-dna/social';
import {channelBranding} from '@/utils/channel-dna/context';
import {resolveActiveChannelDNA} from '@/utils/channel-dna/server';
import {publishingHandoff} from '@/utils/music-release/handoff';
import {finalAudioKey} from '@/utils/creative/model';
import {GET as musicContext} from '@/app/api/music-release/route';
import {createHash} from 'node:crypto';
import {createClient} from '@/utils/supabase/server';
import {outputKey} from '@/utils/creative/model';
import {GET as connections} from '@/app/api/publishing/connections/route';
import {GET as bufferStatus} from '@/app/api/publishing/buffer/status/route';
import {GET as artwork} from '@/app/api/media/artwork/route';
import {assessAsset,currentReceipt,type Asset,type Destination} from './plan';
import {bufferDestinations} from './destinations';
export const WORKER='http://127.0.0.1:47123';
export async function worker(path:string,body?:any){const r=await fetch(WORKER+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(300000)});const d=await r.json();if(!r.ok)throw Error(d.error||'Local worker unavailable.');return d;}
async function result(r:Response){const d=await r.json();if(!r.ok)throw Error(d.error||'Release could not be loaded.');return d;}
export async function snapshot(projectId:string,channelId:string){
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)throw Error('Please sign in.');
 // A reviewed local campaign can feed the same existing planner in development.
 // Production continues to use canonical database records exclusively.
 if(process.env.NODE_ENV==='development'){
  const local=await worker(`/creative/product?projectId=${encodeURIComponent(projectId)}&channelId=${encodeURIComponent(channelId)}&userId=${encodeURIComponent(user.id)}`).catch(()=>null);
  if(local?.record?.socialReviewed&&local.workspace&&local.snapshot){
   const c=local.snapshot.localProject?{...local.snapshot.context,requireActiveDna:true,...await resolveActiveChannelDNA(db,user.id,channelId)}:(await result(await musicContext(new Request(`http://local/api?projectId=${encodeURIComponent(projectId)}&channelId=${encodeURIComponent(channelId)}`)))).context;
   if(c.userId!==user.id||c.channelId!==channelId||c.songId!==projectId)throw Error('Local campaign scope changed.');
   const [inventory,con,buf,delivery]=await Promise.all([worker(`/creative/status?projectId=${encodeURIComponent(projectId)}`),connections(new Request(`http://local/api?channelId=${encodeURIComponent(channelId)}`)).then(result),bufferStatus(new Request(`http://local/api?channelId=${encodeURIComponent(channelId)}`)).then(result),worker(`/publishing/status?projectId=${encodeURIComponent(projectId)}`)]);
   const destinations:Destination[]=[...(con.connections||[]).filter((x:{platform:string;status:string})=>x.platform==='youtube'&&x.status==='connected').slice(0,1).map((x:{id:string;display_name?:string})=>({id:x.id,name:x.display_name||'YouTube',platform:'youtube',channelId,available:true})),...bufferDestinations(buf,channelId)];
   return publishingHandoff(c,local.record,local.workspace,inventory,finalAudioKey(local.snapshot.audio),destinations,delivery);
  }
 }
 const {data:song,error}=await db.from('songs').select('id,title,language,channel_id').eq('id',projectId).eq('user_id',user.id).eq('channel_id',channelId).single();if(error||!song)throw Error('This release does not belong to the selected channel.');
 const channelContext=await resolveActiveChannelDNA(db,user.id,channelId);
 const q=`?projectId=${encodeURIComponent(projectId)}`;
 const [creative,audio,pack,full,shorts,versions,receipts,con,buf,art]=await Promise.all([
 db.from('song_creative_workspaces').select('workspace,revision').eq('song_id',projectId).eq('user_id',user.id).maybeSingle(),
 db.from('song_media_assets').select('*').eq('song_id',projectId).eq('user_id',user.id).eq('media_kind','final-audio').maybeSingle(),
 db.from('social_media_packs').select('*').eq('song_id',projectId).eq('user_id',user.id).maybeSingle(),
 worker('/full-video/status'+q),worker('/shorts/status'+q),worker('/creative/status'+q),worker('/publishing/status'+q),
 connections(new Request(`http://local/api?channelId=${encodeURIComponent(channelId)}`)).then(result),bufferStatus(new Request(`http://local/api?channelId=${encodeURIComponent(channelId)}`)).then(result).catch(e=>({channels:[],knownChannels:[],accounts:[],error:e.message})),artwork(new Request('http://local/api'+q)).then(result)]);
 for(const x of [creative,audio,pack])if(x.error)throw Error('Current release assets could not be verified.');
 const w=creative.data?.workspace?{...creative.data.workspace,channelBranding:channelBranding(channelContext)}:undefined,a=audio.data,audioKey=JSON.stringify([a?.id,a?.storage_path,a?.updated_at]);
 const assets:Asset[]=Array.from({length:7},(_,slot)=>{
  const item=slot?shorts.slots?.find((s:any)=>s.slot===slot):full;
  return assessAsset(slot,item,versions,w?.slots?.length?outputKey(w,slot,audioKey):undefined);
 });
 const reasons=assets.filter(a=>!a.ready).map(a=>a.reason!);
 const thumbnail=(art.assets||[]).find((a:any)=>a.mediaKind==='thumbnail');if(!thumbnail)reasons.push('Add the final thumbnail in Music Production.');
 const thumbnailSlot=w?.slots?.find((s:any)=>s.kind==='thumbnail');if(thumbnail&&thumbnailSlot&&(!thumbnailSlot.approvedId||thumbnail.metadata?.creativeVersionId&&thumbnail.metadata.creativeVersionId!==thumbnailSlot.approvedId))reasons.push('Review the current thumbnail in Music Production.');
 const social=pack.data?structuredClone(pack.data):null;
 if(social)for(const platform of ['youtube_full','youtube_shorts','instagram','facebook','tiktok'])if(social[platform])social[platform]=applyChannelPublishing(channelContext,song,platform,social[platform]);
 const socialMissing:string[]=[];
 for(const platform of ['youtube_full','youtube_shorts','instagram','facebook','tiktok']){
 const p=social?.[platform];const list=platform==='youtube_shorts'?'shorts':platform==='tiktok'?'posts':platform==='youtube_full'?null:'reels';
 if(!p||list&&![1,2,3,4,5,6].every(n=>p[list]?.some((v:any,i:number)=>Number(v.shortNumber??v.reelNumber??v.postNumber??i+1)===n)))socialMissing.push(platform.replaceAll('_',' '));
 }
 if(socialMissing.length)reasons.push(`Prepare current Social copy: ${socialMissing.join(', ')}.`);
 const destinations:Destination[]=[...(con.connections||[]).filter((c:any)=>c.platform==='youtube'&&c.status==='connected').slice(0,1).map((c:any)=>({id:c.id,name:c.display_name||c.handle||'YouTube',platform:'youtube',channelId,available:true})),...bufferDestinations(buf,channelId)];
 const youtubeDestination=destinations.find((d:any)=>d.platform==='youtube');
 const normalizedYoutube=(receipts.youtube||[]).filter((r:any)=>r.itemKey==='youtube-full'||/^youtube-short-0[1-6]$/.test(r.itemKey)).map((r:any)=>{
  const slot=r.kind==='full'?0:Number(r.slot||0),asset=assets.find(a=>a.slot===slot);
  // Legacy worker receipts created before receipt-identity persistence can still
  // be adopted without another upload when their immutable local file identity
  // exactly matches the currently approved asset. The provider videoId/status
  // remains the source of delivery truth; we only restore missing scope fields.
  const legacyIdentityMissing=!r.assetVersion&&!r.channelId&&r.videoId&&['scheduled','published'].includes(r.status);
  const exactFileMatch=Boolean(asset?.ready&&asset?.version&&r.filename&&asset?.version===r.filename);
  return {...r,...(legacyIdentityMissing&&exactFileMatch&&youtubeDestination?{assetVersion:asset!.version,channelId:youtubeDestination.id,channelName:youtubeDestination.name,legacyIdentityRecovered:true}:{}) ,platform:'youtube'};
 });
 const currentReceipts=[...normalizedYoutube,...(receipts.buffer||[]).filter((r:any)=>r.slot>=1&&r.slot<=6&&r.itemKey===`buffer-${r.channelId}-short-${String(r.slot).padStart(2,'0')}`).map((r:any)=>({...r,platform:r.service}))];
 const revision=createHash('sha256').update(JSON.stringify({channelContext,assets:assets.map(({url,...a})=>a),creative:creative.data,pack:social,audio:a,thumbnail:thumbnail?.id,destinations,receipts:currentReceipts})).digest('hex');
 return {projectId,channelId,title:song.title,assets,reasons,ready:reasons.length===0,destinations,revision,thumbnail:thumbnail?.url||thumbnail?.signedUrl,social,receipts:currentReceipts.filter((r:any)=>currentReceipt(r,assets)),canonicalReceipts:currentReceipts,history:[...(receipts.bufferHistory||[]),...currentReceipts.filter((r:any)=>!currentReceipt(r,assets))],connectionNotes:[...(buf.error?[buf.error]:[]),...(buf.accounts||[]).filter((a:any)=>a.error).map((a:any)=>a.error)],userId:user.id};
}
