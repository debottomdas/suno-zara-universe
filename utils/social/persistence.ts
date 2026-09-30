import {fillMissing,editablePlatform} from './intake';
import {loadReleaseShortSlots,alignSocialPlatform} from './release-slots';
import {platforms,preserveReviewed,sameSocialValue} from './copy';
// Optimistic comparison prevents a slow AI response or another tab overwriting a newer edit.
export async function saveSocialPack(supabase:any,userId:string,projectId:string,updates:Record<string,any>,missingOnly=false){
 const slots=(await loadReleaseShortSlots(supabase,userId,projectId))||(missingOnly?[1,2,3,4,5,6]:null);
 for(let attempt=0;attempt<3;attempt++){
  const {data:row,error}=await supabase.from('social_media_packs').select('*').eq('song_id',projectId).eq('user_id',userId).maybeSingle();if(error)return{error};
  const values:Record<string,any>={updated_at:new Date(Math.max(Date.now(),Date.parse(row?.updated_at||'')+1||0)).toISOString()};
  for(const platform of platforms)if(updates[platform]){const current=slots?alignSocialPlatform(missingOnly?editablePlatform(row?.[platform],platform,slots.length):row?.[platform]||{},platform,slots,values.updated_at):row?.[platform]||{};const incoming={...updates[platform]};delete incoming._copyReview;delete incoming._legacyShortPosts;delete incoming._releaseShortSlots;const alignedIncoming=slots?alignSocialPlatform(incoming,platform,slots,values.updated_at):incoming;const protectedCopy=preserveReviewed(current,missingOnly?fillMissing(current,alignedIncoming):alignedIncoming);for(const historical of alignedIncoming._legacyShortPosts||[]){const archive=protectedCopy._legacyShortPosts||[];if(!archive.some((a:any)=>sameSocialValue([a.slot,a.value,a.review],[historical.slot,historical.value,historical.review])))protectedCopy._legacyShortPosts=[...archive,historical];}values[platform]=slots?alignSocialPlatform(protectedCopy,platform,slots,values.updated_at):protectedCopy;}
  if(row&&platforms.every(platform=>!values[platform]||sameSocialValue(values[platform],row[platform])))return{error:null};
  if(!row){const result=await supabase.from('social_media_packs').insert({...values,song_id:projectId,user_id:userId});if(result.error?.code==='23505')continue;return result;}
  let q=supabase.from('social_media_packs').update(values).eq('song_id',projectId).eq('user_id',userId);
  q=row.updated_at?q.eq('updated_at',row.updated_at):q.is('updated_at',null);
  const result=await q.select('song_id');if(result.error)return result;if(result.data?.length)return{error:null};
 }
 return{error:{message:'Social copy changed in another tab. Reload before saving again.'}};
}
