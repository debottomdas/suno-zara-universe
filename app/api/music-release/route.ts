import { createClient } from '@/utils/supabase/server';
import { resolveActiveChannelDNA } from '@/utils/channel-dna/server';
import { DnaError, UUID } from '@/utils/channel-dna/validation';
export async function GET(request:Request) {
  if(process.env.NODE_ENV!=='development')return Response.json({error:'Local Music release preview only.'},{status:404});
  try {
    const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)return Response.json({error:'Sign in to continue.'},{status:401});
    const q=new URL(request.url).searchParams,channelId=q.get('channelId')||'',songId=q.get('projectId')||'';
    if(!UUID.test(songId))return Response.json({error:'Choose an existing song.'},{status:400});
    const resolved=await resolveActiveChannelDNA(db,user.id,channelId);
    const {data:song,error:songError}=await db.from('songs').select('id,title,english_title,language,lyrics').eq('id',songId).eq('channel_id',channelId).eq('user_id',user.id).maybeSingle();
    if(songError||!song)return Response.json({error:'Song not available in this channel.'},{status:404});
    const {data:plan,error:planError}=await db.from('song_production_plans').select('plan').eq('song_id',songId).eq('channel_id',channelId).eq('user_id',user.id).maybeSingle();if(planError)throw Error('Song Intelligence could not be read.');
    return Response.json({context:{requireActiveDna:true,userId:user.id,channelId,channelName:resolved.channelName,songId,title:song.title,englishTitle:song.english_title||'',language:song.language,lyrics:song.lyrics||'',intelligence:plan?.plan?.songDNA||{},dnaRevision:resolved.dnaRevision,dna:resolved.dna}},{headers:{'Cache-Control':'no-store'}});
  }catch(error){return Response.json({error:error instanceof DnaError?error.message:'Could not read Music inputs.'},{status:error instanceof DnaError?error.status:503});}
}
