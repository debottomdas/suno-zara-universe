import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { MEDIA_BUCKET, buildMediaAssetResponse, cleanString, deleteAssetBacking, type StoredMediaAsset } from "@/utils/media-source";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);
const SELECT_FIELDS = "id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes, metadata, created_at, updated_at";

function safeFilename(filename: string) { return filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "youtube-video"; }
function getTusEndpoint() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (!rawUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  const url = new URL(rawUrl);
  if (url.hostname.endsWith(".supabase.co")) return `https://${url.hostname.split(".")[0]}.storage.supabase.co/storage/v1/upload/resumable`;
  return `${url.origin}/storage/v1/upload/resumable`;
}
async function getOwnedSong(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase.from("songs").select("id, title").eq("id", projectId).eq("user_id", userId).single();
  return error ? null : data;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const body = await request.json();
    const action = cleanString(body.action);
    const projectId = cleanString(body.projectId);
    if (!projectId) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    const song = await getOwnedSong(supabase, user.id, projectId);
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    if (action === "prepare") {
      const originalFilename = cleanString(body.originalFilename), mimeType = cleanString(body.mimeType), sizeBytes = Number(body.sizeBytes);
      if (!originalFilename || !VIDEO_MIME_TYPES.has(mimeType)) return NextResponse.json({ error: "Please choose an MP4 or MOV video." }, { status: 400 });
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_BYTES) return NextResponse.json({ error: "Full YouTube videos are currently limited to 500 MB in Supabase mode." }, { status: 400 });
      const storagePath = `${user.id}/${song.id}/youtube-video/${crypto.randomUUID()}-${safeFilename(originalFilename)}`;
      return NextResponse.json({ upload: { bucket: MEDIA_BUCKET, storagePath, tusEndpoint: getTusEndpoint(), originalFilename, mimeType, sizeBytes } });
    }

    if (action === "register") {
      const storagePath = cleanString(body.storagePath), originalFilename = cleanString(body.originalFilename), mimeType = cleanString(body.mimeType), sizeBytes = Number(body.sizeBytes);
      const requiredPrefix = `${user.id}/${song.id}/youtube-video/`;
      if (!storagePath.startsWith(requiredPrefix) || !originalFilename || !VIDEO_MIME_TYPES.has(mimeType) || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_BYTES) return NextResponse.json({ error: "Invalid YouTube video upload details." }, { status: 400 });
      const { data: previousAsset } = await supabase.from("song_media_assets").select(SELECT_FIELDS).eq("song_id", song.id).eq("user_id", user.id).eq("media_kind", "youtube-video").eq("slot", 1).maybeSingle();
      const { data: savedAsset, error: saveError } = await supabase.from("song_media_assets").upsert({
        song_id: song.id, user_id: user.id, media_kind: "youtube-video", slot: 1, original_filename: originalFilename,
        storage_provider: "supabase", storage_path: storagePath, local_path: null, mime_type: mimeType, size_bytes: Math.round(sizeBytes), metadata: {}, updated_at: new Date().toISOString(),
      }, { onConflict: "song_id,user_id,media_kind,slot" }).select(SELECT_FIELDS).single();
      if (saveError || !savedAsset) throw new Error(`Could not save video record: ${saveError?.message || "Unknown error"}`);
      if (previousAsset && (previousAsset.storage_provider !== "supabase" || previousAsset.storage_path !== storagePath)) {
        try { await deleteAssetBacking(supabase, previousAsset as StoredMediaAsset); } catch (error) { console.warn("Could not remove previous video backing file:", error); }
      }
      return NextResponse.json({ asset: await buildMediaAssetResponse(supabase, savedAsset as StoredMediaAsset), saved: true });
    }

    return NextResponse.json({ error: 'action must be either "prepare" or "register".' }, { status: 400 });
  } catch (error) {
    console.error("YouTube video media error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "YouTube video request failed." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const projectId = cleanString(new URL(request.url).searchParams.get("projectId"));
    if (!projectId) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    const song = await getOwnedSong(supabase, user.id, projectId);
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });
    const { data: asset, error } = await supabase.from("song_media_assets").select(SELECT_FIELDS).eq("song_id", song.id).eq("user_id", user.id).eq("media_kind", "youtube-video").eq("slot", 1).maybeSingle();
    if (error) throw new Error(`Could not load YouTube video: ${error.message}`);
    return NextResponse.json({ projectId, songTitle: song.title || "Untitled", asset: asset ? await buildMediaAssetResponse(supabase, asset as StoredMediaAsset) : null });
  } catch (error) {
    console.error("Load YouTube video error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load YouTube video." }, { status: 500 });
  }
}
