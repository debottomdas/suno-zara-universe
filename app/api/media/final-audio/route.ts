import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  MEDIA_BUCKET,
  buildMediaAssetResponse,
  cleanString,
  deleteAssetBacking,
  type StoredMediaAsset,
} from "@/utils/media-source";

const AUDIO_MIME_TYPES = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/aac"]);
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "audio-file";
}

async function getOwnedSong(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase.from("songs").select("id, title").eq("id", projectId).eq("user_id", userId).single();
  return error ? null : data;
}

const SELECT_FIELDS = "id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes, metadata, created_at, updated_at";

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
      const originalFilename = cleanString(body.originalFilename);
      const mimeType = cleanString(body.mimeType);
      const sizeBytes = Number(body.sizeBytes);
      if (!originalFilename || !AUDIO_MIME_TYPES.has(mimeType)) return NextResponse.json({ error: "Please choose an MP3, WAV, M4A or AAC audio file." }, { status: 400 });
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_AUDIO_BYTES) return NextResponse.json({ error: "Final Audio files are currently limited to 200 MB in Supabase mode." }, { status: 400 });
      const storagePath = `${user.id}/${song.id}/final-audio/${crypto.randomUUID()}-${safeFilename(originalFilename)}`;
      const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(storagePath);
      if (error || !data?.token) throw new Error(`Could not prepare audio upload: ${error?.message || "No upload token returned"}`);
      return NextResponse.json({ upload: { bucket: MEDIA_BUCKET, storagePath, token: data.token, originalFilename, mimeType, sizeBytes } });
    }

    if (action === "register") {
      const storagePath = cleanString(body.storagePath);
      const originalFilename = cleanString(body.originalFilename);
      const mimeType = cleanString(body.mimeType);
      const sizeBytes = Number(body.sizeBytes);
      const requiredPrefix = `${user.id}/${song.id}/final-audio/`;
      if (!storagePath.startsWith(requiredPrefix) || !originalFilename || !AUDIO_MIME_TYPES.has(mimeType) || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return NextResponse.json({ error: "Invalid Final Audio upload details." }, { status: 400 });
      }
      const { data: previousAsset } = await supabase.from("song_media_assets").select(SELECT_FIELDS).eq("song_id", song.id).eq("user_id", user.id).eq("media_kind", "final-audio").eq("slot", 1).maybeSingle();
      const { data: savedAsset, error: saveError } = await supabase.from("song_media_assets").upsert({
        song_id: song.id, user_id: user.id, media_kind: "final-audio", slot: 1,
        original_filename: originalFilename, storage_provider: "supabase", storage_path: storagePath, local_path: null,
        mime_type: mimeType, size_bytes: Math.round(sizeBytes), metadata: {}, updated_at: new Date().toISOString(),
      }, { onConflict: "song_id,user_id,media_kind,slot" }).select(SELECT_FIELDS).single();
      if (saveError || !savedAsset) throw new Error(`Could not save audio record: ${saveError?.message || "Unknown error"}`);
      if (previousAsset && (previousAsset.storage_provider !== "supabase" || previousAsset.storage_path !== storagePath)) {
        try { await deleteAssetBacking(supabase, previousAsset as StoredMediaAsset); } catch (error) { console.warn("Could not remove previous audio backing file:", error); }
      }
      return NextResponse.json({ asset: await buildMediaAssetResponse(supabase, savedAsset as StoredMediaAsset), saved: true });
    }

    return NextResponse.json({ error: 'action must be either "prepare" or "register".' }, { status: 400 });
  } catch (error) {
    console.error("Final audio media error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Final audio request failed." }, { status: 500 });
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
    const { data: asset, error } = await supabase.from("song_media_assets").select(SELECT_FIELDS).eq("song_id", song.id).eq("user_id", user.id).eq("media_kind", "final-audio").eq("slot", 1).maybeSingle();
    if (error) throw new Error(`Could not load Final Audio: ${error.message}`);
    return NextResponse.json({ projectId, songTitle: song.title || "Untitled", asset: asset ? await buildMediaAssetResponse(supabase, asset as StoredMediaAsset) : null });
  } catch (error) {
    console.error("Load Final Audio error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Final Audio." }, { status: 500 });
  }
}
