import 'server-only';
import {stat} from 'node:fs/promises';
import {localModeAvailable} from './store';
import {createLocalDatabase} from './database';
import {buildMediaAssetResponse,cleanString,resolveLocalPath,ensureLocalFile} from '@/utils/media-source';

export function isLocalRequest(request:Request){return localModeAvailable()&&['localhost:3000','127.0.0.1:3000'].includes(request.headers.get('host')||'');}
export async function localMediaRequest(request:Request,fixedKind?:string){
 try{
  const body=await request.json(),projectId=cleanString(body.projectId);
  const kind=fixedKind||cleanString(body.mediaKind),slot=Number(body.slot||1);
  const limits:Record<string,number>={'final-audio':1024**3,'youtube-video':10*1024**3,'vertical-video':2*1024**3,'cover-art':100*1024**2,thumbnail:100*1024**2};
  if(!limits[kind]||!Number.isInteger(slot)||slot<1||slot>(kind==='vertical-video'?10:1))throw Error('Invalid media kind or slot.');
  const db=createLocalDatabase(),{data:{user}}=await db.auth.getUser();
  const {data:song}=await db.from('songs').select().eq('id',projectId).eq('user_id',user.id).single();
  if(!song)return Response.json({error:'Local project not found.'},{status:404});
  const query=()=>db.from('song_media_assets').select().eq('song_id',song.id).eq('media_kind',kind).eq('slot',slot);
  if(body.action==='delete'){
   const {data:asset,error}=await query().maybeSingle();if(error)throw Error(error.message);
   if(asset){const result=await db.from('song_media_assets').delete().eq('id',asset.id);if(result.error)throw Error(result.error.message);}
   return Response.json({deleted:true,localMode:true,mediaKind:kind,slot});
  }
  const name=cleanString(body.originalFilename),mime=cleanString(body.mimeType),size=Number(body.sizeBytes);
  const valid=kind==='final-audio'?['audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','audio/aac']:kind.endsWith('video')?['video/mp4','video/quicktime']:['image/png','image/jpeg','image/webp'];
  if(!name||!valid.includes(mime)||!Number.isSafeInteger(size)||size<=0||size>limits[kind])throw Error('Invalid media filename, type or size.');
  if(body.action==='prepare')return Response.json({localMode:true,upload:{provider:'local',uploadUrl:'/api/media/local-upload',projectId:song.id,mediaKind:kind,slot,originalFilename:name,mimeType:mime,sizeBytes:size}});
  if(body.action!=='register')throw Error('Choose prepare, register or delete.');
  const relative=cleanString(body.localPath||body.storagePath);
  if(!relative.startsWith(`songs/${song.id}/`))throw Error('Media path does not belong to this project.');
  await ensureLocalFile(relative);const info=await stat(resolveLocalPath(relative));
  if(!info.isFile()||info.size!==size)throw Error('Media file is missing or its size changed.');
  const {data:asset,error}=await db.from('song_media_assets').upsert({song_id:song.id,user_id:user.id,media_kind:kind,slot,original_filename:name,storage_provider:'local',storage_path:null,local_path:relative,mime_type:mime,size_bytes:size,metadata:{...(body.metadata||{}),...(body.width?{width:body.width}:{}),...(body.height?{height:body.height}:{})},updated_at:new Date().toISOString()},{onConflict:'song_id,user_id,media_kind,slot'}).single();
  if(error)throw Error(error.message);
  return Response.json({saved:true,localMode:true,asset:await buildMediaAssetResponse(db,asset)});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Local media request failed.'},{status:400});}
}
