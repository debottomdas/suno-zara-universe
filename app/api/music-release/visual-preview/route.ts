import {createClient} from '@/utils/supabase/server';
import {resolveActiveChannelDNA} from '@/utils/channel-dna/server';
import {UUID} from '@/utils/channel-dna/validation';
import {generateCreativeImage} from '@/utils/creative/image-generation';
import {prepareVisual} from '@/utils/music-release/visuals';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request:Request) {
 if(process.env.NODE_ENV!=='development')return Response.json({error:'Local Music release preview only.'},{status:404});
 try {
  const db=await createClient(),{data:{user},error}=await db.auth.getUser();if(error||!user)return Response.json({error:'Sign in to continue.'},{status:401});
  const body=await request.json();if(body.confirmPaid!==true)throw Error('Confirm paid image generation.');
  const c=body.context;if(!c||c.userId!==user.id||!UUID.test(c.songId))throw Error('This local campaign belongs to another account.');
  const resolved=await resolveActiveChannelDNA(db,user.id,c.channelId);
  const current={...c,...resolved};
  const {slot,prompt}=prepareVisual(current,body.record,body.workspace,String(body.slotId||''));
  const out=await generateCreativeImage(prompt,slot.kind),image=out.data?.[0]?.b64_json;
  if(!image)throw Error('The image provider returned no image. Do not automatically retry this paid request.');
  return Response.json({imageBase64:image,slotId:slot.id,provider:'openai',model:'gpt-image-2.5-flare',usage:out.usage,productionWrites:false},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Visual generation failed; do not automatically retry.'},{status:400});}
}
