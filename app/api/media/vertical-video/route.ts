import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { MEDIA_BUCKET, buildMediaAssetResponse, cleanString, deleteAssetBacking, type StoredMediaAsset } from "@/utils/media-source";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_SLOTS = 10;
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);
const SELECT_FIELDS = "id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes, metadata, created_at, updated_at";

function safeFilename(filename: string) { return filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "vertical-video"; }
function parseSlot(value: unknown) { const n=Number(value); return Number.isInteger(n)&&n>=1&&n<=MAX_SLOTS?n:null; }
function getTusEndpoint() {
  const rawUrl=process.env.NEXT_PUBLIC_SUPABASE_URL||""; if(!rawUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  const url=new URL(rawUrl); if(url.hostname.endsWith(".supabase.co")) return `https://${url.hostname.split(".")[0]}.storage.supabase.co/storage/v1/upload/resumable`; return `${url.origin}/storage/v1/upload/resumable`;
}
async function getOwnedSong(supabase:any,userId:string,projectId:string){const{data,error}=await supabase.from("songs").select("id, title").eq("id",projectId).eq("user_id",userId).single();return error?null:data;}

export async function POST(request: Request) {
  try {
    const supabase=await createClient(); const{data:{user},error:authError}=await supabase.auth.getUser(); if(authError||!user)return NextResponse.json({error:"You must be signed in."},{status:401});
    const body=await request.json(); const action=cleanString(body.action), projectId=cleanString(body.projectId), slot=parseSlot(body.slot); if(!projectId)return NextResponse.json({error:"projectId is required."},{status:400}); if(!slot)return NextResponse.json({error:`slot must be between 1 and ${MAX_SLOTS}.`},{status:400});
    const song=await getOwnedSong(supabase,user.id,projectId); if(!song)return NextResponse.json({error:"Song not found."},{status:404});

    if(action==="prepare"){
      const originalFilename=cleanString(body.originalFilename),mimeType=cleanString(body.mimeType),sizeBytes=Number(body.sizeBytes); if(!originalFilename||!VIDEO_MIME_TYPES.has(mimeType))return NextResponse.json({error:"Please choose an MP4 or MOV video."},{status:400}); if(!Number.isFinite(sizeBytes)||sizeBytes<=0||sizeBytes>MAX_VIDEO_BYTES)return NextResponse.json({error:"Vertical videos are currently limited to 500 MB in Supabase mode."},{status:400});
      const storagePath=`${user.id}/${song.id}/vertical-video/slot-${slot}/${crypto.randomUUID()}-${safeFilename(originalFilename)}`; return NextResponse.json({upload:{bucket:MEDIA_BUCKET,storagePath,tusEndpoint:getTusEndpoint(),originalFilename,mimeType,sizeBytes,slot}});
    }

    if(action==="register"){
      const storagePath=cleanString(body.storagePath),originalFilename=cleanString(body.originalFilename),mimeType=cleanString(body.mimeType),sizeBytes=Number(body.sizeBytes),requiredPrefix=`${user.id}/${song.id}/vertical-video/slot-${slot}/`;
      if(!storagePath.startsWith(requiredPrefix)||!originalFilename||!VIDEO_MIME_TYPES.has(mimeType)||!Number.isFinite(sizeBytes)||sizeBytes<=0||sizeBytes>MAX_VIDEO_BYTES)return NextResponse.json({error:"Invalid vertical video upload details."},{status:400});
      const{data:previousAsset}=await supabase.from("song_media_assets").select(SELECT_FIELDS).eq("song_id",song.id).eq("user_id",user.id).eq("media_kind","vertical-video").eq("slot",slot).maybeSingle();
      const{data:savedAsset,error:saveError}=await supabase.from("song_media_assets").upsert({song_id:song.id,user_id:user.id,media_kind:"vertical-video",slot,original_filename:originalFilename,storage_provider:"supabase",storage_path:storagePath,local_path:null,mime_type:mimeType,size_bytes:Math.round(sizeBytes),metadata:{},updated_at:new Date().toISOString()},{onConflict:"song_id,user_id,media_kind,slot"}).select(SELECT_FIELDS).single();
      if(saveError||!savedAsset)throw new Error(`Could not save vertical video record: ${saveError?.message||"Unknown error"}`); if(previousAsset&&(previousAsset.storage_provider!=="supabase"||previousAsset.storage_path!==storagePath)){try{await deleteAssetBacking(supabase,previousAsset as StoredMediaAsset);}catch(error){console.warn("Could not remove previous vertical-video backing file:",error);}}
      return NextResponse.json({asset:await buildMediaAssetResponse(supabase,savedAsset as StoredMediaAsset),saved:true});
    }

    if(action==="delete"){
      const{data:existing,error:findError}=await supabase.from("song_media_assets").select(SELECT_FIELDS).eq("song_id",song.id).eq("user_id",user.id).eq("media_kind","vertical-video").eq("slot",slot).maybeSingle(); if(findError)throw new Error(`Could not find vertical video: ${findError.message}`); if(!existing)return NextResponse.json({deleted:true,slot});
      const{error:deleteError}=await supabase.from("song_media_assets").delete().eq("id",existing.id).eq("user_id",user.id); if(deleteError)throw new Error(`Could not delete vertical video record: ${deleteError.message}`); try{await deleteAssetBacking(supabase,existing as StoredMediaAsset);}catch(error){console.warn("Could not remove vertical-video backing file:",error);} return NextResponse.json({deleted:true,slot});
    }
    return NextResponse.json({error:'action must be "prepare", "register" or "delete".'},{status:400});
  } catch(error){console.error("Vertical video media error:",error);return NextResponse.json({error:error instanceof Error?error.message:"Vertical video request failed."},{status:500});}
}

export async function GET(request: Request){
  try{const supabase=await createClient();const{data:{user},error:authError}=await supabase.auth.getUser();if(authError||!user)return NextResponse.json({error:"You must be signed in."},{status:401});const projectId=cleanString(new URL(request.url).searchParams.get("projectId"));if(!projectId)return NextResponse.json({error:"projectId is required."},{status:400});const song=await getOwnedSong(supabase,user.id,projectId);if(!song)return NextResponse.json({error:"Song not found."},{status:404});const{data:rows,error}=await supabase.from("song_media_assets").select(SELECT_FIELDS).eq("song_id",song.id).eq("user_id",user.id).eq("media_kind","vertical-video").order("slot",{ascending:true});if(error)throw new Error(`Could not load vertical videos: ${error.message}`);const assets=[];for(const row of rows||[]){try{assets.push(await buildMediaAssetResponse(supabase,row as StoredMediaAsset));}catch(error){console.error(`Could not open vertical video slot ${row.slot}:`,error);}}return NextResponse.json({projectId,songTitle:song.title||"Untitled",maxSlots:MAX_SLOTS,assets});}catch(error){console.error("Load vertical videos error:",error);return NextResponse.json({error:error instanceof Error?error.message:"Could not load vertical videos."},{status:500});}
}
