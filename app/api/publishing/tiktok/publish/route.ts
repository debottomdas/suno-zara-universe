
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { MEDIA_BUCKET, resolveLocalPath, type StoredMediaAsset } from "@/utils/media-source";
import { cleanTikTokString, fetchTikTokPublishStatus, getTikTokAuthorization, queryTikTokCreatorInfo } from "@/utils/tiktok-publishing";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_FINAL_CHUNK_BYTES = 128 * 1024 * 1024;
const ALLOWED_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);

type JsonRecord = Record<string, unknown>;
type MediaAsset = StoredMediaAsset & { size_bytes: number | null };

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function asArray(value: unknown) { return Array.isArray(value) ? value : []; }
function hasBlockingErrors(value: unknown) {
  return asArray(value).some((entry) => {
    const item = asRecord(entry);
    return cleanTikTokString(item.severity) !== "warning";
  });
}
function bool(value: unknown) { return value === true; }
function validMime(asset: MediaAsset) {
  const saved = cleanTikTokString(asset.mime_type).toLowerCase();
  if (ALLOWED_MIME.has(saved)) return saved;
  const filename = cleanTikTokString(asset.original_filename).toLowerCase();
  if (filename.endsWith(".mov")) return "video/quicktime";
  if (filename.endsWith(".webm")) return "video/webm";
  if (filename.endsWith(".mp4")) return "video/mp4";
  return "";
}
function chunkPlan(videoSize: number) {
  const chunkSize = Math.min(videoSize, MAX_CHUNK_BYTES);
  const totalChunkCount = Math.max(1, Math.floor(videoSize / chunkSize));
  const finalSize = videoSize - chunkSize * (totalChunkCount - 1);
  if (finalSize <= 0 || finalSize > MAX_FINAL_CHUNK_BYTES) {
    throw new Error("Studio could not create a TikTok-compliant upload chunk plan for this video.");
  }
  return { chunkSize, totalChunkCount };
}

async function openAssetChunk(
  admin: ReturnType<typeof createAdminClient>,
  asset: MediaAsset,
  start: number,
  end: number,
  signedUrl?: string | null
) {
  const expected = end - start + 1;
  if (asset.storage_provider === "local") {
    if (!asset.local_path) throw new Error("Local TikTok media path is missing.");
    const absolute = resolveLocalPath(asset.local_path);
    const info = await stat(absolute);
    if (info.size !== Number(asset.size_bytes || 0)) {
      throw new Error("The local TikTok video size changed after it was linked. Re-upload or revalidate the media asset.");
    }
    const stream = createReadStream(absolute, { start, end });
    return { body: Readable.toWeb(stream) as ReadableStream, length: expected, signedUrl: null as string | null };
  }

  if (!asset.storage_path) throw new Error("Supabase TikTok media path is missing.");
  let url = signedUrl || "";
  if (!url) {
    const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUrl(asset.storage_path, 30 * 60);
    if (error || !data?.signedUrl) throw new Error("Could not create a signed URL for the TikTok video.");
    url = data.signedUrl;
  }
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, cache: "no-store" });
  if (!response.ok || !response.body) throw new Error(`Could not read the TikTok video from Supabase Storage (HTTP ${response.status}).`);
  const returned = Number(response.headers.get("content-length") || 0);
  if (returned && returned !== expected) {
    throw new Error("Supabase Storage did not return the requested TikTok upload byte range.");
  }
  return { body: response.body, length: expected, signedUrl: url };
}

async function tiktokEnvelope<T>(response: Response, fallback: string) {
  const envelope = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string; log_id?: string };
  };
  const code = cleanTikTokString(envelope.error?.code);
  if (!response.ok || (code && code !== "ok") || !envelope.data) {
    throw new Error(envelope.error?.message || code || `${fallback} (HTTP ${response.status}).`);
  }
  return envelope.data;
}

async function uploadTikTokVideo(
  admin: ReturnType<typeof createAdminClient>,
  accessToken: string,
  asset: MediaAsset,
  postInfo: JsonRecord
) {
  const videoSize = Number(asset.size_bytes || 0);
  if (!Number.isFinite(videoSize) || videoSize <= 0 || videoSize > MAX_FILE_BYTES) {
    throw new Error("TikTok video size must be between 1 byte and 4 GB.");
  }
  const mimeType = validMime(asset);
  if (!mimeType) throw new Error("TikTok Direct Post supports MP4, MOV/QuickTime or WebM video files.");
  const { chunkSize, totalChunkCount } = chunkPlan(videoSize);

  const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({
      post_info: postInfo,
      source_info: {
        source: "FILE_UPLOAD",
        video_size: videoSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    }),
    cache: "no-store",
  });
  const init = await tiktokEnvelope<{ publish_id?: string; upload_url?: string }>(initResponse, "TikTok rejected the Direct Post request");
  const publishId = cleanTikTokString(init.publish_id);
  const uploadUrl = cleanTikTokString(init.upload_url);
  if (!publishId || !uploadUrl) throw new Error("TikTok did not return both publish_id and upload_url.");

  let signedUrl: string | null = null;
  try {
    for (let index = 0; index < totalChunkCount; index += 1) {
      const start = index * chunkSize;
      const end = index === totalChunkCount - 1 ? videoSize - 1 : Math.min(videoSize - 1, start + chunkSize - 1);
      const chunk = await openAssetChunk(admin, asset, start, end, signedUrl);
      signedUrl = chunk.signedUrl || signedUrl;
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "content-type": mimeType,
          "content-length": String(chunk.length),
          "content-range": `bytes ${start}-${end}/${videoSize}`,
        },
        body: chunk.body,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
      if (!uploadResponse.ok) {
        const text = await uploadResponse.text().catch(() => "");
        throw new Error(`TikTok video upload failed at chunk ${index + 1}/${totalChunkCount} (HTTP ${uploadResponse.status})${text ? `: ${text.slice(0, 260)}` : "."}`);
      }
    }
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error("TikTok video upload failed.");
    throw Object.assign(wrapped, { publishId });
  }
  return { publishId, mimeType, videoSize, chunkSize, totalChunkCount };
}

function postIds(status: JsonRecord) {
  const list = Array.isArray(status.publicly_available_post_id)
    ? status.publicly_available_post_id
    : Array.isArray(status.publicaly_available_post_id)
      ? status.publicaly_available_post_id
      : [];
  return list.map((value) => String(value)).filter(Boolean);
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  let userId = "";
  let jobId = "";
  let durablePublishId = "";

  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    userId = user.id;

    const body = await request.json().catch(() => ({}));
    const projectId = cleanTikTokString(body.projectId);
    jobId = cleanTikTokString(body.jobId);
    const title = typeof body.title === "string" ? body.title : "";
    const privacyLevel = cleanTikTokString(body.privacyLevel);
    const durationSeconds = Number(body.durationSeconds);
    const commercialContent = bool(body.commercialContent);
    const brandOrganic = commercialContent && bool(body.brandOrganic);
    const brandContent = commercialContent && bool(body.brandContent);
    const isAigc = bool(body.isAigc);
    const musicUsageConfirmed = bool(body.musicUsageConfirmed);

    if (!projectId || !jobId) return NextResponse.json({ error: "projectId and jobId are required." }, { status: 400 });
    if (!privacyLevel) return NextResponse.json({ error: "Choose TikTok privacy manually before publishing." }, { status: 400 });
    if (!musicUsageConfirmed) return NextResponse.json({ error: "TikTok Music Usage Confirmation must be accepted before publishing." }, { status: 400 });
    if (title.length > 2200) return NextResponse.json({ error: "TikTok caption/title exceeds the 2200 UTF-16 character limit." }, { status: 400 });
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return NextResponse.json({ error: "Studio must verify the linked video's duration before TikTok publishing." }, { status: 400 });
    if (commercialContent && !brandOrganic && !brandContent) return NextResponse.json({ error: "Choose Your brand, Branded content, or both for Commercial Content." }, { status: 400 });
    if (brandContent && privacyLevel === "SELF_ONLY") return NextResponse.json({ error: "TikTok does not allow Branded content with Only me visibility." }, { status: 400 });

    const { data: job, error: jobError } = await admin
      .from("publishing_jobs")
      .select("id, campaign_id, song_id, user_id, connection_id, media_asset_id, platform, content_type, item_key, payload, ready_to_publish, status, scheduled_for, external_post_id, validation_errors")
      .eq("id", jobId)
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .single();
    if (jobError || !job) return NextResponse.json({ error: "TikTok campaign row not found." }, { status: 404 });
    if (job.platform !== "tiktok" || job.content_type !== "video") return NextResponse.json({ error: "The selected campaign row is not a TikTok video." }, { status: 400 });
    if (cleanTikTokString(job.external_post_id) || ["uploading", "published"].includes(cleanTikTokString(job.status))) {
      return NextResponse.json({ error: "This TikTok row already has a publish ID or is currently processing. Check status instead of creating a duplicate." }, { status: 409 });
    }
    if (!job.ready_to_publish) return NextResponse.json({ error: "Mark this TikTok row Ready before publishing it." }, { status: 400 });
    if (hasBlockingErrors(job.validation_errors)) return NextResponse.json({ error: "Fix the row's blocking validation errors before publishing." }, { status: 400 });
    if (cleanTikTokString(job.scheduled_for)) return NextResponse.json({ error: "TikTok Step 7B is immediate-only. Clear the Studio schedule before publishing." }, { status: 400 });
    if (!job.media_asset_id) return NextResponse.json({ error: "No Media Hub vertical video is linked to this TikTok row." }, { status: 400 });

    const { data: campaign, error: campaignError } = await admin
      .from("publishing_campaigns")
      .select("id")
      .eq("id", job.campaign_id)
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .neq("status", "archived")
      .single();
    if (campaignError || !campaign) return NextResponse.json({ error: "The active publishing campaign could not be found." }, { status: 404 });

    const { data: asset, error: assetError } = await admin
      .from("song_media_assets")
      .select("id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes")
      .eq("id", job.media_asset_id)
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .single();
    if (assetError || !asset) return NextResponse.json({ error: "The linked TikTok video could not be found in Media Hub." }, { status: 404 });

    const { connection, accessToken } = await getTikTokAuthorization(admin, userId, job.connection_id);
    const creator = await queryTikTokCreatorInfo(accessToken);
    const privacyOptions = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options : [];
    if (!privacyOptions.includes(privacyLevel)) {
      return NextResponse.json({ error: "The selected privacy is no longer available for this TikTok creator. Reload current TikTok settings." }, { status: 400 });
    }
    const creatorMax = Number(creator.max_video_post_duration_sec || 0);
    if (creatorMax > 0 && durationSeconds > creatorMax + 0.05) {
      return NextResponse.json({ error: `This video is ${durationSeconds.toFixed(1)}s, but TikTok currently allows this creator up to ${creatorMax}s.` }, { status: 400 });
    }

    const allowComment = bool(body.allowComment) && creator.comment_disabled !== true;
    const allowDuet = bool(body.allowDuet) && creator.duet_disabled !== true;
    const allowStitch = bool(body.allowStitch) && creator.stitch_disabled !== true;
    const postInfo: JsonRecord = {
      privacy_level: privacyLevel,
      title,
      disable_comment: !allowComment,
      disable_duet: !allowDuet,
      disable_stitch: !allowStitch,
      brand_content_toggle: brandContent,
      brand_organic_toggle: brandOrganic,
      is_aigc: isAigc,
    };

    const payload = asRecord(job.payload);
    const startedAt = new Date().toISOString();
    const prepared = await uploadTikTokVideo(admin, accessToken, asset as MediaAsset, postInfo);
    durablePublishId = prepared.publishId;

    const { error: savePublishIdError } = await admin
      .from("publishing_jobs")
      .update({
        connection_id: connection.id,
        status: "uploading",
        external_post_id: prepared.publishId,
        error_message: null,
        payload: {
          ...payload,
          tiktokPublishId: prepared.publishId,
          tiktokUploadStartedAt: startedAt,
          tiktokCreatorNickname: creator.creator_nickname || connection.display_name || null,
          tiktokCreatorUsername: creator.creator_username || null,
          tiktokPrivacyLevel: privacyLevel,
          tiktokAllowComment: allowComment,
          tiktokAllowDuet: allowDuet,
          tiktokAllowStitch: allowStitch,
          tiktokCommercialContent: commercialContent,
          tiktokBrandOrganic: brandOrganic,
          tiktokBrandContent: brandContent,
          tiktokIsAigc: isAigc,
          tiktokDurationSeconds: durationSeconds,
          tiktokMusicUsageConfirmed: true,
          tiktokUploadMimeType: prepared.mimeType,
          tiktokUploadBytes: prepared.videoSize,
          tiktokChunkSize: prepared.chunkSize,
          tiktokChunkCount: prepared.totalChunkCount,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    if (savePublishIdError) {
      throw new Error(`TikTok accepted publish ID ${prepared.publishId}, but Studio could not save it: ${savePublishIdError.message}`);
    }

    const statusData = await fetchTikTokPublishStatus(accessToken, prepared.publishId);
    const status = cleanTikTokString(statusData.status) || "PROCESSING_UPLOAD";
    const ids = postIds(statusData as unknown as JsonRecord);
    const publicPostId = ids[0] || "";
    const creatorUsername = cleanTikTokString(creator.creator_username);
    const postUrl = publicPostId && creatorUsername
      ? `https://www.tiktok.com/@${encodeURIComponent(creatorUsername)}/video/${encodeURIComponent(publicPostId)}`
      : null;
    const now = new Date().toISOString();
    const failed = status === "FAILED";
    const complete = status === "PUBLISH_COMPLETE";

    await admin
      .from("publishing_jobs")
      .update({
        status: complete ? "published" : failed ? "failed" : "uploading",
        ready_to_publish: complete ? false : job.ready_to_publish,
        external_url: postUrl,
        error_message: failed ? cleanTikTokString(statusData.fail_reason) || "TikTok processing failed." : null,
        published_at: complete ? now : null,
        payload: {
          ...payload,
          tiktokPublishId: prepared.publishId,
          tiktokPublishStatus: status,
          tiktokPublicPostId: publicPostId || null,
          tiktokPostUrl: postUrl,
          tiktokLastStatusAt: now,
          tiktokCreatorNickname: creator.creator_nickname || connection.display_name || null,
          tiktokCreatorUsername: creator.creator_username || null,
          tiktokPrivacyLevel: privacyLevel,
          tiktokAllowComment: allowComment,
          tiktokAllowDuet: allowDuet,
          tiktokAllowStitch: allowStitch,
          tiktokCommercialContent: commercialContent,
          tiktokBrandOrganic: brandOrganic,
          tiktokBrandContent: brandContent,
          tiktokIsAigc: isAigc,
          tiktokDurationSeconds: durationSeconds,
          tiktokMusicUsageConfirmed: true,
          tiktokUploadMimeType: prepared.mimeType,
          tiktokUploadBytes: prepared.videoSize,
          tiktokChunkSize: prepared.chunkSize,
          tiktokChunkCount: prepared.totalChunkCount,
        },
        updated_at: now,
      })
      .eq("id", jobId)
      .eq("user_id", userId);

    if (failed) {
      throw new Error(cleanTikTokString(statusData.fail_reason) || "TikTok accepted the upload but processing failed.");
    }

    return NextResponse.json({ accepted: true, publishId: prepared.publishId, status, postUrl, publicPostId: publicPostId || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TikTok publishing failed.";
    const maybePublishId = cleanTikTokString((error as { publishId?: unknown })?.publishId) || durablePublishId;
    console.error("TikTok publishing error:", error);
    if (jobId && userId) {
      const update: JsonRecord = {
        status: "failed",
        error_message: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      };
      if (maybePublishId) update.external_post_id = maybePublishId;
      await admin.from("publishing_jobs").update(update).eq("id", jobId).eq("user_id", userId);
    }
    return NextResponse.json({ error: message, publishId: maybePublishId || null }, { status: 500 });
  }
}
