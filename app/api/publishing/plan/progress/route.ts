import {NextResponse} from 'next/server';
import {createClient} from '@/utils/supabase/server';
import {worker} from '@/utils/publishing/snapshot';
export async function GET(req:Request){try{
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)return NextResponse.json({error:'Please sign in.'},{status:401});
 const q=new URL(req.url).searchParams,projectId=q.get('projectId'),channelId=q.get('channelId');
 const {data:song,error}=await db.from('songs').select('id').eq('id',projectId).eq('user_id',user.id).eq('channel_id',channelId).single();
 if(error||!song)return NextResponse.json({error:'Release not available in this channel.'},{status:403});
 // Read the existing canonical receipts only. No provider calls or writes.
 const state=await worker('/publishing/status?projectId='+encodeURIComponent(projectId!));
 const receipts=[...(state.youtube||[]),...(state.buffer||[])].filter(r=>r.itemKey==='youtube-full'||/^youtube-short-0[1-6]$/.test(r.itemKey)||r.slot>=1&&r.slot<=6&&r.itemKey===`buffer-${r.channelId}-short-${String(r.slot).padStart(2,'0')}`).map(r=>({itemKey:r.itemKey,assetVersion:r.assetVersion,status:r.status,dueAt:r.dueAt,scheduledAt:r.scheduledAt}));
 return NextResponse.json({receipts},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({error:'Progress is temporarily unavailable. Saved deliveries are retained; check status before retrying.'},{status:503})}}
