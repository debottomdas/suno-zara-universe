import {NextResponse} from 'next/server';
import {createClient} from '@/utils/supabase/server';

const STATES=new Set(['current','later','completed']);

export async function PATCH(request:Request){
 try{
  const db=await createClient();
  const {data:{user},error:authError}=await db.auth.getUser();
  if(authError||!user)return NextResponse.json({error:'Please sign in to update your project.'},{status:401});
  const body=await request.json();
  const projectId=String(body.projectId||'').trim();
  const channelId=String(body.channelId||'').trim();
  const projectState=String(body.projectState||'').trim();
  if(!projectId||!channelId)return NextResponse.json({error:'projectId and channelId are required.'},{status:400});
  if(!STATES.has(projectState))return NextResponse.json({error:'Unsupported project state.'},{status:400});

  // Both channel ownership and song ownership are required. Lifecycle changes never
  // mutate production status, assets, publishing receipts, DNA, or connections.
  const {data:channel,error:channelError}=await db.from('channels')
   .select('id,workspaces!inner(owner_user_id)')
   .eq('id',channelId).eq('workspaces.owner_user_id',user.id).single();
  if(channelError||!channel)return NextResponse.json({error:'The selected channel is not available.'},{status:403});

  const updatedAt=new Date().toISOString();
  const {data:song,error}=await db.from('songs').update({project_state:projectState,updated_at:updatedAt})
   .eq('id',projectId).eq('user_id',user.id).eq('channel_id',channel.id)
   .select('id,channel_id,status,project_state,updated_at').single();
  if(error||!song)return NextResponse.json({error:'Project not found in the selected channel.'},{status:404});
  return NextResponse.json({projectId:song.id,channelId:song.channel_id,status:song.status,projectState:song.project_state,updatedAt:song.updated_at,saved:true});
 }catch(error){
  return NextResponse.json({error:error instanceof Error?error.message:'Could not update project state.'},{status:500});
 }
}
