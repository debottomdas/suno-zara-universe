import path from "node:path";
import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";

export const MEDIA_BUCKET = "song-media";
export type StorageProvider = "local" | "supabase";

export type StoredMediaAsset = {
  id: string;
  song_id: string;
  user_id?: string;
  media_kind: string;
  slot: number;
  original_filename: string;
  storage_provider?: string | null;
  storage_path?: string | null;
  local_path?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
};

export function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function safeFilename(filename: string) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "media-file";
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12);
  return `${base}${safeExt}`;
}

export function localMediaRoot() {
  return path.resolve(process.cwd(), "local-media");
}

export function mediaFolder(mediaKind: string) {
  switch (mediaKind) {
    case "final-audio":
      return "shared/final-audio";
    case "youtube-video":
      return "shared/full-video";
    case "vertical-video":
      return "shared/vertical-video";
    case "thumbnail":
      return "shared/thumbnails";
    case "cover-art":
      return "shared/cover-art";
    default:
      throw new Error(`Unsupported local media kind: ${mediaKind}`);
  }
}

export function makeLocalRelativePath(
  songId: string,
  mediaKind: string,
  slot: number,
  filename: string
) {
  const slotPart = `slot-${String(slot).padStart(2, "0")}`;
  return path.posix.join(
    "songs",
    songId,
    mediaFolder(mediaKind),
    slotPart,
    `${crypto.randomUUID()}-${safeFilename(filename)}`
  );
}

export function resolveLocalPath(relativePath: string) {
  const root = localMediaRoot();
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolute = path.resolve(root, normalized);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid local media path.");
  }
  return absolute;
}

export function storageProvider(asset: StoredMediaAsset): StorageProvider {
  return asset.storage_provider === "local" ? "local" : "supabase";
}

export async function buildMediaAssetResponse(
  supabase: any,
  asset: StoredMediaAsset
) {
  const provider = storageProvider(asset);

  if (provider === "local") {
    if (!asset.local_path) {
      throw new Error(`Local media path is missing for ${asset.original_filename}.`);
    }
    const absolute = resolveLocalPath(asset.local_path);
    await stat(absolute);
    const baseUrl = `/api/media/local-file?assetId=${encodeURIComponent(asset.id)}`;
    return {
      id: asset.id,
      songId: asset.song_id,
      mediaKind: asset.media_kind,
      slot: asset.slot,
      originalFilename: asset.original_filename,
      storageProvider: "local" as const,
      storagePath: null,
      localPath: asset.local_path,
      mimeType: asset.mime_type ?? null,
      sizeBytes: asset.size_bytes ?? null,
      metadata: asset.metadata ?? {},
      createdAt: asset.created_at,
      updatedAt: asset.updated_at,
      url: baseUrl,
      downloadUrl: `${baseUrl}&download=1`,
    };
  }

  if (!asset.storage_path) {
    throw new Error(`Supabase storage path is missing for ${asset.original_filename}.`);
  }

  const { data: playbackData, error: playbackError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(asset.storage_path, 60 * 60);

  if (playbackError || !playbackData?.signedUrl) {
    throw new Error(
      `Could not create media URL: ${playbackError?.message || "Unknown error"}`
    );
  }

  const { data: downloadData, error: downloadError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(asset.storage_path, 60 * 60, {
      download: asset.original_filename,
    });

  return {
    id: asset.id,
    songId: asset.song_id,
    mediaKind: asset.media_kind,
    slot: asset.slot,
    originalFilename: asset.original_filename,
    storageProvider: "supabase" as const,
    storagePath: asset.storage_path,
    localPath: null,
    mimeType: asset.mime_type ?? null,
    sizeBytes: asset.size_bytes ?? null,
    metadata: asset.metadata ?? {},
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
    url: playbackData.signedUrl,
    downloadUrl:
      !downloadError && downloadData?.signedUrl
        ? downloadData.signedUrl
        : playbackData.signedUrl,
  };
}

export async function deleteAssetBacking(supabase: any, asset: StoredMediaAsset) {
  const provider = storageProvider(asset);
  if (provider === "local") {
    if (!asset.local_path) return;
    try {
      await unlink(resolveLocalPath(asset.local_path));
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    return;
  }

  if (asset.storage_path) {
    await supabase.storage.from(MEDIA_BUCKET).remove([asset.storage_path]);
  }
}

export async function openMediaAssetResponse(
  supabase: any,
  asset: StoredMediaAsset,
  expiresInSeconds = 30 * 60
) {
  const provider = storageProvider(asset);
  if (provider === "local") {
    if (!asset.local_path) {
      throw new Error(`Local path is missing for ${asset.original_filename}.`);
    }
    const absolute = resolveLocalPath(asset.local_path);
    const info = await stat(absolute);
    const nodeStream = createReadStream(absolute);
    return new Response(Readable.toWeb(nodeStream) as any, {
      headers: {
        "content-type": asset.mime_type || "application/octet-stream",
        "content-length": String(info.size),
      },
    });
  }

  if (!asset.storage_path) {
    throw new Error(`Storage path is missing for ${asset.original_filename}.`);
  }
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(asset.storage_path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(
      `Could not open ${asset.original_filename}: ${error?.message || "Signed URL was not created."}`
    );
  }
  const response = await fetch(data.signedUrl, { cache: "no-store" });
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not read ${asset.original_filename} from Media Hub (HTTP ${response.status}).`
    );
  }
  return response;
}
