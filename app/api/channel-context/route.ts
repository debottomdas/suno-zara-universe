import {buildMediaAssetResponse,type StoredMediaAsset} from '@/utils/media-source';
import {createClient} from '@/utils/supabase/server';
import {resolveActiveChannelDNA} from '@/utils/channel-dna/server';
import {brandingFinishing} from '@/utils/channel-dna/context';
export async function GET(request:Request){
 try{
  const db=await createClient(),{data:{user}}=await db.auth.getUser();if(!user)return Response.json({error:'Sign in to continue.'},{status:401});
  const projectId=new URL(request.url).searchParams.get('projectId');
  const {data:song,error}=await db.from('songs').select('channel_id').eq('id',projectId).eq('user_id',user.id).single();if(error||!song)throw Error('Song not found.');
  const context=await resolveActiveChannelDNA(db,user.id,song.channel_id);
  const finishing=brandingFinishing(context);
  const refs=finishing.assets.filter(a=>['watermark','logo','intro','outro','font'].includes(a.role));
  const renderAssets=[];
  if(refs.length){
   const {data:assets,error:assetError}=await db.from('song_media_assets').select('*,songs!inner(channel_id,user_id)').in('id',refs.map(a=>a.mediaAssetId)).eq('user_id',user.id).eq('songs.channel_id',context.channelId).eq('songs.user_id',user.id);
   if(assetError||assets?.length!==new Set(refs.map(a=>a.mediaAssetId)).size)throw Error('Branding asset unavailable in this channel.');
   for(const ref of refs){const asset=assets!.find(a=>a.id===ref.mediaAssetId)!;const publicAsset=await buildMediaAssetResponse(db,asset as StoredMediaAsset);renderAssets.push({...ref,url:publicAsset.url,mimeType:asset.mime_type});}
  }
  return Response.json({finishing:{...finishing,renderAssets}},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Channel branding unavailable.'},{status:400});}
}
