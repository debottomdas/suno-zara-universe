import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { openMediaAssetResponse, type StoredMediaAsset } from "@/utils/media-source";

export const runtime = "nodejs";
export const maxDuration = 300;

const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;
type PrivacyStatus = "private" | "unlisted" | "public";

type OAuthCredential = {
  connection_id: string;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  expires_at: string | null;
};

type MediaAsset = {
  id: string;
  song_id: string;
  user_id: string;
  media_kind: string;
  slot: number;
  original_filename: string;
  storage_provider?: string | null;
  storage_path: string | null;
  local_path?: string | null;
  mime_type: string | null;
  size_bytes: number | null;
};

type YouTubeUploadResponse = {
  id?: string;
  status?: {
    privacyStatus?: string;
    uploadStatus?: string;
    publishAt?: string;
  };
  error?: {
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown, maxItems = 50) {
  return asArray(value)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function isPrivacyStatus(value: string): value is PrivacyStatus {
  return value === "private" || value === "unlisted" || value === "public";
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function hasBlockingErrors(value: unknown) {
  return asArray(value).some((entry) => {
    const item = asRecord(entry);
    return cleanString(item.severity) !== "warning";
  });
}

function appendSavedHashtags(description: string, hashtags: string[]) {
  const missing = hashtags.filter(
    (tag) => !description.toLocaleLowerCase().includes(tag.toLocaleLowerCase())
  );
  if (missing.length === 0) return description;
  return [description, missing.join(" ")].filter(Boolean).join("\n\n");
}

function tagsCharacterCount(tags: string[]) {
  return tags.reduce((total, tag, index) => {
    const represented = /\s/.test(tag) ? `"${tag}"` : tag;
    return total + represented.length + (index > 0 ? 1 : 0);
  }, 0);
}

function validateMetadata(title: string, description: string, tags: string[]) {
  if (!title) throw new Error("YouTube title is required.");
  if (Array.from(title).length > 100) {
    throw new Error("YouTube title exceeds the 100-character limit. Edit the campaign row first.");
  }
  if (title.includes("<") || title.includes(">")) {
    throw new Error("YouTube title cannot contain < or > characters.");
  }
  if (Buffer.byteLength(description, "utf8") > 5000) {
    throw new Error("YouTube description exceeds the 5000-byte limit. Edit the campaign row first.");
  }
  if (description.includes("<") || description.includes(">")) {
    throw new Error("YouTube description cannot contain < or > characters.");
  }
  if (tagsCharacterCount(tags) > 500) {
    throw new Error("YouTube tags exceed the 500-character API limit. Edit the campaign row first.");
  }
}

async function googleErrorMessage(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return `${fallback} (HTTP ${response.status})`;
  try {
    const parsed = JSON.parse(text) as YouTubeUploadResponse;
    return (
      parsed.error?.message ||
      parsed.error?.errors?.[0]?.message ||
      `${fallback} (HTTP ${response.status})`
    );
  } catch {
    return `${fallback} (HTTP ${response.status}): ${text.slice(0, 300)}`;
  }
}

async function refreshAccessToken(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  connectionId: string,
  credential: OAuthCredential
) {
  const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_YOUTUBE_CLIENT_SECRET;
  const refreshToken = cleanString(credential.refresh_token);

  if (!clientId || !clientSecret) {
    throw new Error("Google YouTube OAuth server credentials are not configured.");
  }
  if (!refreshToken) {
    throw new Error("YouTube refresh token is missing. Reconnect YouTube in Publishing Hub.");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  const tokenData = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenResponse.ok || !tokenData.access_token) {
    await admin
      .from("publishing_connections")
      .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
      .eq("id", connectionId)
      .eq("user_id", userId);

    throw new Error(
      tokenData.error_description || tokenData.error || "Could not refresh YouTube authorization. Reconnect YouTube."
    );
  }

  const expiresAt = Number.isFinite(tokenData.expires_in)
    ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
    : null;

  const { error: credentialUpdateError } = await admin
    .from("publishing_oauth_credentials")
    .update({
      access_token: tokenData.access_token,
      token_type: tokenData.token_type || "Bearer",
      scope: tokenData.scope || credential.scope,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("connection_id", connectionId)
    .eq("user_id", userId)
    .eq("platform", "youtube");

  if (credentialUpdateError) {
    throw new Error(`Could not update refreshed YouTube token: ${credentialUpdateError.message}`);
  }

  return tokenData.access_token;
}

async function mediaSourceResponse(
  admin: ReturnType<typeof createAdminClient>,
  asset: MediaAsset,
  expiresInSeconds = 30 * 60
) {
  return openMediaAssetResponse(
    admin,
    asset as unknown as StoredMediaAsset,
    expiresInSeconds
  );
}

async function uploadVideoToYouTube({
  admin,
  accessToken,
  asset,
  title,
  description,
  tags,
  requestedPrivacy,
  scheduledFor,
  selfDeclaredMadeForKids,
  containsSyntheticMedia,
}: {
  admin: ReturnType<typeof createAdminClient>;
  accessToken: string;
  asset: MediaAsset;
  title: string;
  description: string;
  tags: string[];
  requestedPrivacy: PrivacyStatus;
  scheduledFor: string | null;
  selfDeclaredMadeForKids: boolean | null;
  containsSyntheticMedia: boolean | null;
}) {
  const contentLength = Number(asset.size_bytes || 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new Error("The Media Hub video is missing its file-size metadata. Replace the video in Media Hub and try again.");
  }

  const contentType = cleanString(asset.mime_type) || "video/mp4";
  const scheduleTime = scheduledFor ? Date.parse(scheduledFor) : Number.NaN;
  const isFutureSchedule = Number.isFinite(scheduleTime) && scheduleTime > Date.now() + 30_000;

  if (scheduledFor && !isFutureSchedule) {
    throw new Error("The YouTube schedule must be a future date and time. Clear or update the campaign schedule first.");
  }
  if (isFutureSchedule && requestedPrivacy !== "public") {
    throw new Error("A scheduled YouTube release must use Public as the target visibility. YouTube keeps it private until the scheduled publish time.");
  }

  const apiPrivacy: PrivacyStatus = isFutureSchedule ? "private" : requestedPrivacy;
  const status: JsonRecord = { privacyStatus: apiPrivacy };
  if (isFutureSchedule) status.publishAt = new Date(scheduleTime).toISOString();
  if (selfDeclaredMadeForKids !== null) {
    status.selfDeclaredMadeForKids = selfDeclaredMadeForKids;
  }
  if (containsSyntheticMedia !== null) {
    status.containsSyntheticMedia = containsSyntheticMedia;
  }

  const initiateUrl = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
  initiateUrl.searchParams.set("uploadType", "resumable");
  initiateUrl.searchParams.set("part", "snippet,status");

  const initiateResponse = await fetch(initiateUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(contentLength),
      "x-upload-content-type": contentType,
    },
    body: JSON.stringify({
      snippet: {
        title,
        description,
        tags,
      },
      status,
    }),
    cache: "no-store",
  });

  if (!initiateResponse.ok) {
    throw new Error(await googleErrorMessage(initiateResponse, "YouTube rejected the upload metadata"));
  }

  const uploadUrl = initiateResponse.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube did not return a resumable upload session URL.");
  }

  const mediaResponse = await mediaSourceResponse(admin, asset);
  const uploadResponse = await fetch(
    uploadUrl,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": contentType,
        "content-length": String(contentLength),
        "content-range": `bytes 0-${contentLength - 1}/${contentLength}`,
      },
      body: mediaResponse.body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }
  );

  if (!uploadResponse.ok) {
    throw new Error(await googleErrorMessage(uploadResponse, "YouTube video upload failed"));
  }

  const result = (await uploadResponse.json().catch(() => ({}))) as YouTubeUploadResponse;
  if (!result.id) {
    throw new Error("YouTube completed the upload request but did not return a video ID.");
  }

  return {
    videoId: result.id,
    actualPrivacyStatus: cleanString(result.status?.privacyStatus) || apiPrivacy,
    uploadStatus: cleanString(result.status?.uploadStatus) || "uploaded",
    publishAt: isFutureSchedule ? new Date(scheduleTime).toISOString() : null,
    scheduled: isFutureSchedule,
  };
}

async function normalizeThumbnail(buffer: Buffer, mimeType: string) {
  const normalizedMime = mimeType.toLowerCase();
  if (
    buffer.length <= MAX_THUMBNAIL_BYTES &&
    (normalizedMime === "image/jpeg" || normalizedMime === "image/png")
  ) {
    return { body: buffer, mimeType: normalizedMime };
  }

  let quality = 90;
  let converted = await sharp(buffer)
    .rotate()
    .resize({ width: 1280, height: 720, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  while (converted.length > MAX_THUMBNAIL_BYTES && quality > 50) {
    quality -= 10;
    converted = await sharp(buffer)
      .rotate()
      .resize({ width: 1280, height: 720, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
  }

  if (converted.length > MAX_THUMBNAIL_BYTES) {
    throw new Error("The thumbnail could not be reduced below YouTube's 2 MB API limit.");
  }

  return { body: converted, mimeType: "image/jpeg" };
}

async function setYouTubeThumbnail({
  admin,
  accessToken,
  videoId,
  asset,
}: {
  admin: ReturnType<typeof createAdminClient>;
  accessToken: string;
  videoId: string;
  asset: MediaAsset;
}) {
  const source = await mediaSourceResponse(admin, asset, 10 * 60);
  const original = Buffer.from(await source.arrayBuffer());
  const normalized = await normalizeThumbnail(original, cleanString(asset.mime_type) || "application/octet-stream");

  const url = new URL("https://www.googleapis.com/upload/youtube/v3/thumbnails/set");
  url.searchParams.set("videoId", videoId);
  url.searchParams.set("uploadType", "media");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": normalized.mimeType,
      "content-length": String(normalized.body.length),
    },
    body: Uint8Array.from(normalized.body).buffer,
  });

  if (!response.ok) {
    throw new Error(await googleErrorMessage(response, "YouTube thumbnail upload failed"));
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  }

  const userId = user.id;
  let jobId = "";
  const admin = createAdminClient();

  try {
    const body = await request.json();
    const projectId = cleanString(body.projectId);
    jobId = cleanString(body.jobId);
    const requestedPrivacy = cleanString(body.privacyStatus);
    const selfDeclaredMadeForKids = optionalBoolean(body.selfDeclaredMadeForKids);
    const containsSyntheticMedia = optionalBoolean(body.containsSyntheticMedia);

    if (!projectId || !jobId) {
      return NextResponse.json({ error: "projectId and jobId are required." }, { status: 400 });
    }
    if (!isPrivacyStatus(requestedPrivacy)) {
      return NextResponse.json(
        { error: "Choose a YouTube visibility: Private, Unlisted or Public." },
        { status: 400 }
      );
    }

    const { data: song, error: songError } = await supabase
      .from("songs")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single();

    if (songError || !song) {
      return NextResponse.json({ error: "Song not found." }, { status: 404 });
    }

    const { data: job, error: jobError } = await admin
      .from("publishing_jobs")
      .select(
        "id, campaign_id, song_id, user_id, connection_id, media_asset_id, platform, content_type, item_key, title, caption, description, hashtags, tags, payload, ready_to_publish, status, scheduled_for, validation_errors, external_post_id"
      )
      .eq("id", jobId)
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Publishing row not found." }, { status: 404 });
    }

    if (cleanString(job.platform) !== "youtube") {
      return NextResponse.json({ error: "This publishing action only supports YouTube rows." }, { status: 400 });
    }
    if (cleanString(job.external_post_id)) {
      return NextResponse.json(
        { error: "This campaign row already has a YouTube video ID. Refusing to upload a duplicate." },
        { status: 409 }
      );
    }
    if (cleanString(job.status) === "uploading") {
      return NextResponse.json(
        { error: "This campaign row is already marked as uploading. Refresh the campaign before retrying." },
        { status: 409 }
      );
    }
    if (!job.ready_to_publish) {
      return NextResponse.json({ error: "Mark this campaign row Ready before uploading it." }, { status: 400 });
    }
    if (hasBlockingErrors(job.validation_errors)) {
      return NextResponse.json({ error: "Fix the row's blocking validation errors before uploading." }, { status: 400 });
    }

    const { data: campaign, error: campaignError } = await admin
      .from("publishing_campaigns")
      .select("id, status")
      .eq("id", job.campaign_id)
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .neq("status", "archived")
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: "The active publishing campaign could not be found." }, { status: 404 });
    }

    if (!job.media_asset_id) {
      return NextResponse.json({ error: "No Media Hub video is linked to this YouTube row." }, { status: 400 });
    }

    const { data: videoAsset, error: videoError } = await admin
      .from("song_media_assets")
      .select("id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes")
      .eq("id", job.media_asset_id)
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .single();

    if (videoError || !videoAsset) {
      return NextResponse.json({ error: "The linked Media Hub video could not be found." }, { status: 404 });
    }

    let connectionId = cleanString(job.connection_id);
    let connection: { id: string; display_name: string | null; scopes: string[] | null } | null = null;

    if (connectionId) {
      const { data } = await admin
        .from("publishing_connections")
        .select("id, display_name, scopes")
        .eq("id", connectionId)
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("status", "connected")
        .maybeSingle();
      connection = data;
    }

    if (!connection) {
      const { data } = await admin
        .from("publishing_connections")
        .select("id, display_name, scopes")
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("status", "connected")
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      connection = data;
      connectionId = cleanString(data?.id);
    }

    if (!connection || !connectionId) {
      return NextResponse.json({ error: "YouTube is not connected. Reconnect it in Publishing Hub." }, { status: 400 });
    }

    const connectionScopes = Array.isArray(connection.scopes) ? connection.scopes : [];
    if (connectionScopes.length > 0 && !connectionScopes.includes(YOUTUBE_UPLOAD_SCOPE)) {
      return NextResponse.json(
        { error: "The connected YouTube account does not include youtube.upload permission. Reconnect YouTube." },
        { status: 400 }
      );
    }

    const { data: credential, error: credentialError } = await admin
      .from("publishing_oauth_credentials")
      .select("connection_id, access_token, refresh_token, scope, expires_at")
      .eq("connection_id", connectionId)
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .single();

    if (credentialError || !credential) {
      return NextResponse.json({ error: "YouTube OAuth credentials are missing. Reconnect YouTube." }, { status: 400 });
    }

    const credentialScope = cleanString(credential.scope);
    if (credentialScope && !credentialScope.split(/\s+/).includes(YOUTUBE_UPLOAD_SCOPE)) {
      return NextResponse.json(
        { error: "The saved YouTube authorization is missing youtube.upload permission. Reconnect YouTube." },
        { status: 400 }
      );
    }

    const title = cleanString(job.title);
    const hashtags = cleanStringArray(job.hashtags, 30);
    const description = appendSavedHashtags(
      cleanString(job.description) || cleanString(job.caption),
      hashtags
    );
    const tags = cleanStringArray(job.tags, 50);
    validateMetadata(title, description, tags);

    const accessToken = await refreshAccessToken(
      admin,
      userId,
      connectionId,
      credential as OAuthCredential
    );

    const payload = asRecord(job.payload);
    const startTime = new Date().toISOString();

    const { error: startError } = await admin
      .from("publishing_jobs")
      .update({
        connection_id: connectionId,
        status: "uploading",
        error_message: null,
        payload: {
          ...payload,
          youtubeUploadStartedAt: startTime,
          youtubeRequestedPrivacyStatus: requestedPrivacy,
        },
        updated_at: startTime,
      })
      .eq("id", jobId)
      .eq("user_id", userId);

    if (startError) {
      throw new Error(`Could not mark the campaign row as uploading: ${startError.message}`);
    }

    const upload = await uploadVideoToYouTube({
      admin,
      accessToken,
      asset: videoAsset as MediaAsset,
      title,
      description,
      tags,
      requestedPrivacy,
      scheduledFor: cleanString(job.scheduled_for) || null,
      selfDeclaredMadeForKids,
      containsSyntheticMedia,
    });

    const now = new Date().toISOString();
    const videoUrl = `https://www.youtube.com/watch?v=${upload.videoId}`;
    let finalPayload: JsonRecord = {
      ...payload,
      youtubeVideoId: upload.videoId,
      youtubeUrl: videoUrl,
      youtubeChannelName: connection.display_name || null,
      youtubeRequestedPrivacyStatus: requestedPrivacy,
      youtubePrivacyStatus: upload.actualPrivacyStatus,
      youtubeUploadStatus: upload.uploadStatus,
      youtubePublishAt: upload.publishAt,
      youtubeUploadCompletedAt: now,
      youtubeSelfDeclaredMadeForKids: selfDeclaredMadeForKids,
      youtubeContainsSyntheticMedia: containsSyntheticMedia,
      youtubeThumbnailStatus: "not-requested",
    };

    const finalStatus = upload.scheduled ? "scheduled" : "published";
    const { error: completeError } = await admin
      .from("publishing_jobs")
      .update({
        connection_id: connectionId,
        status: finalStatus,
        ready_to_publish: false,
        external_post_id: upload.videoId,
        external_url: videoUrl,
        error_message: null,
        published_at: upload.scheduled ? null : now,
        payload: finalPayload,
        updated_at: now,
      })
      .eq("id", jobId)
      .eq("user_id", userId);

    if (completeError) {
      throw new Error(
        `YouTube uploaded video ${upload.videoId}, but Studio could not save the result: ${completeError.message}`
      );
    }

    let thumbnailStatus = "not-requested";
    let thumbnailWarning = "";
    const thumbnailAssetId = cleanString(payload.thumbnailAssetId);

    if (thumbnailAssetId) {
      const { data: thumbnailAsset, error: thumbnailAssetError } = await admin
        .from("song_media_assets")
        .select("id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes")
        .eq("id", thumbnailAssetId)
        .eq("song_id", projectId)
        .eq("user_id", userId)
        .maybeSingle();

      if (thumbnailAssetError || !thumbnailAsset) {
        thumbnailStatus = "failed";
        thumbnailWarning = "Video uploaded, but the saved thumbnail asset could not be found.";
      } else {
        try {
          await setYouTubeThumbnail({
            admin,
            accessToken,
            videoId: upload.videoId,
            asset: thumbnailAsset as MediaAsset,
          });
          thumbnailStatus = "set";
        } catch (thumbnailError) {
          thumbnailStatus = "failed";
          thumbnailWarning =
            thumbnailError instanceof Error
              ? `Video uploaded, but thumbnail failed: ${thumbnailError.message}`
              : "Video uploaded, but thumbnail upload failed.";
        }
      }

      finalPayload = {
        ...finalPayload,
        youtubeThumbnailStatus: thumbnailStatus,
        youtubeThumbnailUpdatedAt: new Date().toISOString(),
      };

      await admin
        .from("publishing_jobs")
        .update({
          payload: finalPayload,
          error_message: thumbnailWarning || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("user_id", userId);
    }

    await admin
      .from("publishing_connections")
      .update({ last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", connectionId)
      .eq("user_id", userId);

    return NextResponse.json({
      uploaded: true,
      scheduled: upload.scheduled,
      videoId: upload.videoId,
      videoUrl,
      requestedPrivacyStatus: requestedPrivacy,
      actualPrivacyStatus: upload.actualPrivacyStatus,
      publishAt: upload.publishAt,
      thumbnailStatus,
      warning: thumbnailWarning || null,
      channelName: connection.display_name || "YouTube",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "YouTube upload failed.";
    console.error("YouTube publishing error:", error);

    if (jobId) {
      const { data: existing } = await admin
        .from("publishing_jobs")
        .select("external_post_id")
        .eq("id", jobId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!cleanString(existing?.external_post_id)) {
        await admin
          .from("publishing_jobs")
          .update({
            status: "failed",
            error_message: message.slice(0, 1000),
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId)
          .eq("user_id", userId);
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
