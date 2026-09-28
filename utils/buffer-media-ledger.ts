import { createAdminClient } from '@/utils/supabase/admin';
import { MEDIA_BUCKET } from '@/utils/media-source';
export function bufferStoragePath(mediaUrl:string,userId:string,projectId:string) {
  const url = new URL(mediaUrl);
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin;
  const prefix = `/storage/v1/object/sign/${MEDIA_BUCKET}/`;
  if (url.origin !== origin || !url.pathname.startsWith(prefix)) throw new Error('Buffer video must use project staging storage.');
  const path = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!path.startsWith(`${userId}/${projectId}/buffer-temp/`) || path.split('/').some(p=>p==='..'||p==='.'||!p)) throw new Error('Invalid Buffer staging path.');
  return path;
}
export async function claimBufferMedia(userId:string,projectId:string,items:Array<{mediaUrl:string}>,accountId:string|null) {
  const admin=createAdminClient();
  const paths=[...new Set(items.map(item=>bufferStoragePath(item.mediaUrl,userId,projectId)))];
  for(const path of paths){
    const {data,error}=await admin.from('buffer_staged_media').update({state:'submitting',buffer_account_id:accountId}).eq('storage_path',path).eq('user_id',userId).eq('song_id',projectId).eq('state','staged').select('storage_path').maybeSingle();
    if(error||!data)throw new Error('Staged media could not be reserved safely. Prepare fresh media; do not reuse an earlier batch.');
  }
  return paths;
}
export async function recordBufferMedia(userId:string,projectId:string,items:Array<{mediaUrl:string;channelId:string;slot:number}>,results:Array<any>) {
  const admin=createAdminClient();
  const paths=[...new Set(items.map(item=>bufferStoragePath(item.mediaUrl,userId,projectId)))];
  for(const path of paths){
    const sources=items.filter(item=>bufferStoragePath(item.mediaUrl,userId,projectId)===path);
    const attempts=sources.map(item=>{const result=results.find(r=>r.channelId===item.channelId&&r.slot===item.slot);return {channelId:item.channelId,slot:item.slot,postId:result?.post?.id||null,status:result?.post?.status||'unknown',error:result?.error||null};});
    const {error}=await admin.from('buffer_staged_media').update({state:attempts.every(a=>a.postId)?'submitted':'uncertain',attempts}).eq('storage_path',path).eq('user_id',userId).eq('song_id',projectId).eq('state','submitting');
    if(error)throw new Error('Buffer responded, but media tracking could not be saved. Media remains protected; inspect Buffer before retrying.');
  }
}

// Scheduling may only reuse the same recorded post/media pair. Lock it against
// concurrent cleanup; an interrupted request stays protected for manual review.
export async function claimBufferSchedule(userId:string, projectId:string, items:Array<{mediaUrl:string;postId:string;channelId:string;slot:number}>, accountId:string|null) {
  const admin=createAdminClient();
  const paths=[...new Set(items.map(item=>bufferStoragePath(item.mediaUrl,userId,projectId)))];
  for(const path of paths) {
    const {data:media,error}=await admin.from('buffer_staged_media').select('state,attempts,buffer_account_id').eq('storage_path',path).eq('user_id',userId).eq('song_id',projectId).maybeSingle();
    const matching=items.filter(item=>bufferStoragePath(item.mediaUrl,userId,projectId)===path);
    if(error || media?.state!=='submitted' || media.buffer_account_id!==accountId || !Array.isArray(media.attempts) || matching.some(item=>!media.attempts.some((a:any)=>a.postId===item.postId && a.channelId===item.channelId && a.slot===item.slot))) {
      throw new Error('Media dependencies must be verified before scheduling. Existing drafts have not been changed.');
    }
    const {data:locked,error:lockError}=await admin.from('buffer_staged_media').update({state:'submitting'}).eq('storage_path',path).eq('user_id',userId).eq('song_id',projectId).eq('state','submitted').select('storage_path').maybeSingle();
    if(lockError || !locked)throw new Error('Media is busy or protected; scheduling was not started.');
  }
  return async () => {
    for(const path of paths) {
      const {error}=await admin.from('buffer_staged_media').update({state:'submitted'}).eq('storage_path',path).eq('user_id',userId).eq('song_id',projectId).eq('state','submitting');
      if(error)throw new Error('Media tracking remains protected; inspect the scheduling result before retrying.');
    }
  };
}
