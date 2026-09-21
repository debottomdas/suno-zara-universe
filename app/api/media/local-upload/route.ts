import { NextResponse } from "next/server";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient } from "@/utils/supabase/server";
import {
  buildMediaAssetResponse,
  cleanString,
  deleteAssetBacking,
  makeLocalRelativePath,
  resolveLocalPath,
  type StoredMediaAsset,
} from "@/utils/media-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set([
  "final-audio",
  "youtube-video",
  "vertical-video",
  "thumbnail",
  "cover-art",
]);
const AUDIO_MIMES = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/aac"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_CHUNK_BYTES = 6 * 1024 * 1024;

function validMime(kind: string, mime: string) {
  if (kind === "final-audio") return AUDIO_MIMES.has(mime);
  if (kind === "youtube-video" || kind === "vertical-video") return VIDEO_MIMES.has(mime);
  return IMAGE_MIMES.has(mime);
}

function maxBytes(kind: string) {
  if (kind === "final-audio") return 1024 * 1024 * 1024;
  if (kind === "youtube-video") return 10 * 1024 * 1024 * 1024;
  if (kind === "vertical-video") return 2 * 1024 * 1024 * 1024;
  return 100 * 1024 * 1024;
}

async function getOwnedSong(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase
    .from("songs")
    .select("id, title")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();
  return error ? null : data;
}

function validUploadId(value: string) {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(value);
}

export async function POST(request: Request) {
  let tempPath = "";
  try {
    if (process.env.VERCEL) {
      return NextResponse.json(
        { error: "Local Media Mode is only available while Suno Zara Universe Music Studio is running on your Mac." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const url = new URL(request.url);
    const projectId = cleanString(url.searchParams.get("projectId"));
    const mediaKind = cleanString(url.searchParams.get("mediaKind"));
    const originalFilename = cleanString(url.searchParams.get("filename"));
    const mimeType = cleanString(url.searchParams.get("mimeType"));
    const sizeBytes = Number(url.searchParams.get("sizeBytes"));
    const slot = Number(url.searchParams.get("slot") || "1");
    const metadataText = cleanString(url.searchParams.get("metadata"));
    const uploadId = cleanString(url.searchParams.get("uploadId"));
    const chunkIndex = Number(url.searchParams.get("chunkIndex"));
    const totalChunks = Number(url.searchParams.get("totalChunks"));
    const chunkStart = Number(url.searchParams.get("chunkStart"));
    const chunkEnd = Number(url.searchParams.get("chunkEnd"));

    if (!projectId || !ALLOWED_KINDS.has(mediaKind)) {
      return NextResponse.json({ error: "Valid projectId and mediaKind are required." }, { status: 400 });
    }
    if (!originalFilename || !validMime(mediaKind, mimeType)) {
      return NextResponse.json({ error: "Unsupported local media file type." }, { status: 400 });
    }
    if (!Number.isInteger(slot) || slot < 1 || (mediaKind === "vertical-video" && slot > 10)) {
      return NextResponse.json({ error: "Invalid media slot." }, { status: 400 });
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytes(mediaKind)) {
      return NextResponse.json({ error: "Invalid or unsupported local media file size." }, { status: 400 });
    }
    if (!validUploadId(uploadId)) {
      return NextResponse.json({ error: "Invalid local upload ID." }, { status: 400 });
    }
    if (
      !Number.isInteger(chunkIndex) ||
      !Number.isInteger(totalChunks) ||
      chunkIndex < 0 ||
      totalChunks < 1 ||
      chunkIndex >= totalChunks
    ) {
      return NextResponse.json({ error: "Invalid local upload chunk." }, { status: 400 });
    }
    if (
      !Number.isInteger(chunkStart) ||
      !Number.isInteger(chunkEnd) ||
      chunkStart < 0 ||
      chunkEnd <= chunkStart ||
      chunkEnd > sizeBytes ||
      chunkEnd - chunkStart > MAX_CHUNK_BYTES
    ) {
      return NextResponse.json({ error: "Invalid local upload chunk range." }, { status: 400 });
    }
    if (chunkIndex === 0 && chunkStart !== 0) {
      return NextResponse.json({ error: "The first local upload chunk must start at byte 0." }, { status: 400 });
    }
    if (chunkIndex === totalChunks - 1 && chunkEnd !== sizeBytes) {
      return NextResponse.json({ error: "The final local upload chunk does not match the file size." }, { status: 400 });
    }
    if (!request.body) {
      return NextResponse.json({ error: "No media file body was received." }, { status: 400 });
    }

    const song = await getOwnedSong(supabase, user.id, projectId);
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    let metadata: Record<string, unknown> = {};
    if (metadataText) {
      try { metadata = JSON.parse(metadataText); } catch { metadata = {}; }
    }

    const tempRelative = path.posix.join("temp", "uploads", user.id, `${uploadId}.part`);
    tempPath = resolveLocalPath(tempRelative);
    await mkdir(path.dirname(tempPath), { recursive: true });

    if (chunkIndex === 0) {
      try { await unlink(tempPath); } catch (error: any) {
        if (error?.code !== "ENOENT") throw error;
      }
    } else {
      let currentSize = -1;
      try {
        currentSize = (await stat(tempPath)).size;
      } catch {}
      if (currentSize !== chunkStart) {
        return NextResponse.json(
          { error: `Local upload chunk out of sequence (${currentSize < 0 ? 0 : currentSize} bytes stored, ${chunkStart} expected). Please retry the upload.` },
          { status: 409 }
        );
      }
    }

    await pipeline(
      Readable.fromWeb(request.body as any),
      createWriteStream(tempPath, { flags: chunkIndex === 0 ? "w" : "a" })
    );

    const partialInfo = await stat(tempPath);
    if (partialInfo.size !== chunkEnd) {
      try { await unlink(tempPath); } catch {}
      throw new Error(
        `Local upload chunk size mismatch (${partialInfo.size} bytes stored, ${chunkEnd} expected). Please retry.`
      );
    }

    if (chunkIndex !== totalChunks - 1) {
      return NextResponse.json({
        saved: false,
        complete: false,
        uploadId,
        uploadedBytes: partialInfo.size,
        totalBytes: sizeBytes,
      });
    }

    if (partialInfo.size !== Math.round(sizeBytes)) {
      try { await unlink(tempPath); } catch {}
      throw new Error(`Local upload size mismatch (${partialInfo.size} received, ${Math.round(sizeBytes)} expected).`);
    }

    const relativePath = makeLocalRelativePath(song.id, mediaKind, slot, originalFilename);
    const absolutePath = resolveLocalPath(relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await rename(tempPath, absolutePath);
    tempPath = "";

    const { data: previousAsset } = await supabase
      .from("song_media_assets")
      .select("id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes")
      .eq("song_id", song.id)
      .eq("user_id", user.id)
      .eq("media_kind", mediaKind)
      .eq("slot", slot)
      .maybeSingle();

    const { data: savedAsset, error: saveError } = await supabase
      .from("song_media_assets")
      .upsert({
        song_id: song.id,
        user_id: user.id,
        media_kind: mediaKind,
        slot,
        original_filename: originalFilename,
        storage_provider: "local",
        storage_path: null,
        local_path: relativePath,
        mime_type: mimeType,
        size_bytes: Math.round(sizeBytes),
        metadata,
        updated_at: new Date().toISOString(),
      }, { onConflict: "song_id,user_id,media_kind,slot" })
      .select("id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes, metadata, created_at, updated_at")
      .single();

    if (saveError || !savedAsset) {
      try { await unlink(absolutePath); } catch {}
      throw new Error(`Could not save local media record: ${saveError?.message || "Unknown error"}`);
    }

    if (previousAsset) {
      const sameLocal = previousAsset.storage_provider === "local" && previousAsset.local_path === relativePath;
      if (!sameLocal) {
        try { await deleteAssetBacking(supabase, previousAsset as StoredMediaAsset); } catch (error) {
          console.warn("Could not remove previous media backing file:", error);
        }
      }
    }

    return NextResponse.json({
      saved: true,
      complete: true,
      provider: "local",
      asset: await buildMediaAssetResponse(supabase, savedAsset as StoredMediaAsset),
    });
  } catch (error) {
    if (tempPath) {
      try { await unlink(tempPath); } catch {}
    }
    console.error("Local media upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Local media upload failed." },
      { status: 500 }
    );
  }
}
