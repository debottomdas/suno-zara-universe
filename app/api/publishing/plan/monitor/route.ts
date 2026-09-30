import {NextResponse} from 'next/server';
import {mkdir,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {localDateTime} from '@/utils/publishing/plan';
import {snapshot,worker} from '@/utils/publishing/snapshot';
import {GET as youtubeStatus} from '@/app/api/publishing/youtube/schedule/route';
import {POST as bufferStatus} from '@/app/api/publishing/buffer/post-status/route';
export const runtime='nodejs';
export async function POST(req:Request){let lock='',acquired=false;try{
 const {projectId,channelId}=await req.json();let state=await snapshot(projectId,channelId);
 const root=join(tmpdir(),'sunozara-publishing-locks');await mkdir(root,{recursive:true});lock=join(root,createHash('sha256').update(state.userId+':'+state.projectId).digest('hex'));try{await mkdir(lock);acquired=true;}catch{throw Error('Wait until the current delivery finishes before checking status.');}state=await snapshot(projectId,channelId);
 const youtube=state.receipts.filter((r:any)=>r.platform==='youtube'&&r.videoId),buffer=state.receipts.filter((r:any)=>r.platform!=='youtube'&&r.postId);
 let checked=0;const providerCheckedAt=new Date().toISOString();
 if(youtube.length){const response=await youtubeStatus(new Request(`http://local/api?projectId=${encodeURIComponent(projectId)}&ids=${youtube.map((r:any)=>r.videoId).join(',')}`));const data=await response.json();if(!response.ok)throw Error(data.error);for(const r of youtube){const v=data.videos.find((v:any)=>v.videoId===r.videoId);if(!v)continue;await worker('/publishing/youtube/receipt',{projectId,receipt:{...r,...v,...(v.status==='scheduled'&&v.scheduledAt?{dueAt:v.scheduledAt,...(r.timezone?{localTime:localDateTime(v.scheduledAt,r.timezone)}:{})}:{}),providerCheckedAt,...(v.status==='published'?{publishedAt:r.publishedAt||providerCheckedAt}:{})}});checked++;}}
 if(buffer.length){const response=await bufferStatus(new Request('http://local/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,postIds:buffer.map((r:any)=>r.postId)})}));const data=await response.json();if(!response.ok)throw Error(data.error);for(const r of buffer){const p=data.posts.find((p:any)=>p.id===r.postId);if(!p||p.status==='unknown')continue;await worker('/publishing/buffer/receipt',{projectId,receipt:{...r,status:p.status,dueAt:p.dueAt,...(p.dueAt&&r.timezone?{localTime:localDateTime(p.dueAt,r.timezone)}:{}),sentAt:p.sentAt,externalLink:p.externalLink,errorMessage:p.error?.message||null,providerCheckedAt}});checked++;}}
 return NextResponse.json({checked});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Provider status unavailable.'},{status:400});}finally{if(acquired)await rmdir(lock).catch(()=>{});}}
