import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { openMediaAssetResponse, type StoredMediaAsset } from "@/utils/media-source";

export const runtime = "nodejs";
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;

type FacebookConnection = {
  id: string;
  external_account_id: string | null;
  display_name: string | null;
  scopes: string[] | null;
};

type OAuthCredential = {
  connection_id: string;
  access_token: string | null;
  scope: string | null;
};

type MediaAsset = StoredMediaAsset & {
  user_id: string;
  storage_path: string | null;
  local_path?: string | null;
};

function graphVersion() {
  return process.env.META_GRAPH_VERSION || "v26.0";
}

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown, maxItems = 30) {
  return asArray(value)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function hasBlockingErrors(value: unknown) {
  return asArray(value).some((entry) => {
    if (typeof entry === "string") return true;
    const item = asRecord(entry);
    return cleanString(item.severity) !== "warning";
  });
}

function appendHashtags(copy: string, hashtags: string[]) {
  const missing = hashtags.filter(
    (tag) => !copy.toLocaleLowerCase().includes(tag.toLocaleLowerCase())
  );
  return [copy, missing.join(" ")].filter(Boolean).join("\n\n");
}

async function metaJson<T>(url: URL | string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  if (!response.ok) {
    throw new Error(
      data.error?.message || `Meta request failed with HTTP ${response.status}.`
    );
  }
  return data;
}

async function resolveConnection(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  preferredConnectionId: string
) {
  let connection: FacebookConnection | null = null;

  if (preferredConnectionId) {
    const { data } = await admin
      .from("publishing_connections")
      .select("id, external_account_id, display_name, scopes")
      .eq("id", preferredConnectionId)
      .eq("user_id", userId)
      .eq("platform", "facebook")
      .eq("status", "connected")
      .maybeSingle();
    connection = data as FacebookConnection | null;
  }

  if (!connection) {
    const { data } = await admin
      .from("publishing_connections")
      .select("id, external_account_id, display_name, scopes")
      .eq("user_id", userId)
      .eq("platform", "facebook")
      .eq("status", "connected")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    connection = data as FacebookConnection | null;
  }

  if (!connection?.id || !cleanString(connection.external_account_id)) {
    throw new Error("Facebook is not connected yet. Connect Meta in Publishing Hub first.");
  }

  const scopes = Array.isArray(connection.scopes) ? connection.scopes : [];
  if (scopes.length > 0 && !scopes.includes("pages_manage_posts")) {
    throw new Error(
      "The connected Facebook Page is missing pages_manage_posts permission. Reconnect Meta after granting the publishing permission."
    );
  }

  const { data: credential, error } = await admin
    .from("publishing_oauth_credentials")
    .select("connection_id, access_token, scope")
    .eq("connection_id", connection.id)
    .eq("user_id", userId)
    .eq("platform", "facebook")
    .single();

  if (error || !credential || !cleanString(credential.access_token)) {
    throw new Error("Facebook Page access token is missing. Reconnect Meta in Publishing Hub.");
  }

  const credentialScopes = cleanString(credential.scope).split(/\s+/).filter(Boolean);
  if (credentialScopes.length > 0 && !credentialScopes.includes("pages_manage_posts")) {
    throw new Error(
      "The saved Facebook authorization is missing pages_manage_posts permission. Reconnect Meta."
    );
  }

  return {
    connection,
    accessToken: cleanString((credential as OAuthCredential).access_token),
    pageId: cleanString(connection.external_account_id),
  };
}

async function publishPagePost({
  pageId,
  accessToken,
  message,
}: {
  pageId: string;
  accessToken: string;
  message: string;
}) {
  if (!message) throw new Error("The Facebook post has no saved copy to publish.");

  const body = new URLSearchParams({
    message,
    access_token: accessToken,
  });
  const result = await metaJson<{ id?: string }>(
    `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(pageId)}/feed`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }
  );

  if (!result.id) throw new Error("Facebook accepted the Page post request but returned no post ID.");
  return result.id;
}

async function publishPageReel({
  admin,
  pageId,
  accessToken,
  asset,
  title,
  description,
}: {
  admin: ReturnType<typeof createAdminClient>;
  pageId: string;
  accessToken: string;
  asset: MediaAsset;
  title: string;
  description: string;
}) {
  const contentLength = Number(asset.size_bytes || 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new Error(
      "The linked vertical video is missing file-size metadata. Replace it in Media Hub and try again."
    );
  }

  const startBody = new URLSearchParams({
    access_token: accessToken,
    upload_phase: "start",
  });
  const start = await metaJson<{ video_id?: string; upload_url?: string }>(
    `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(pageId)}/video_reels`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: startBody,
    }
  );

  const videoId = cleanString(start.video_id);
  const uploadUrl = cleanString(start.upload_url) ||
    `https://rupload.facebook.com/video-upload/${graphVersion()}/${encodeURIComponent(videoId)}`;
  if (!videoId) throw new Error("Facebook did not return a Reel video ID.");

  const mediaResponse = await openMediaAssetResponse(admin, asset, 30 * 60);
  if (!mediaResponse.body) throw new Error("Studio could not open the linked vertical video.");

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: "0",
      file_size: String(contentLength),
      "content-type": "application/octet-stream",
      "content-length": String(contentLength),
    },
    body: mediaResponse.body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(
      `Facebook Reel binary upload failed (HTTP ${uploadResponse.status})${text ? `: ${text.slice(0, 300)}` : "."}`
    );
  }

  const finishBody = new URLSearchParams({
    access_token: accessToken,
    video_id: videoId,
    upload_phase: "finish",
    video_state: "PUBLISHED",
  });
  if (description) finishBody.set("description", description);
  if (title) finishBody.set("title", title);

  const finish = await metaJson<{ success?: boolean }>(
    `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(pageId)}/video_reels`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: finishBody,
    }
  );

  if (finish.success !== true) {
    throw new Error("Facebook did not confirm the Reel publish request.");
  }

  return videoId;
}

async function fetchPermalink(id: string, accessToken: string) {
  try {
    const url = new URL(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(id)}`);
    url.searchParams.set("fields", "permalink_url");
    url.searchParams.set("access_token", accessToken);
    const result = await metaJson<{ permalink_url?: string }>(url);
    return cleanString(result.permalink_url) || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  let userId = "";
  let jobId = "";

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }
    userId = user.id;

    const body = asRecord(await request.json().catch(() => ({})));
    const projectId = cleanString(body.projectId);
    jobId = cleanString(body.jobId);

    if (!projectId || !jobId) {
      return NextResponse.json({ error: "projectId and jobId are required." }, { status: 400 });
    }

    const { data: job, error: jobError } = await admin
      .from("publishing_jobs")
      .select(
        "id, campaign_id, song_id, connection_id, media_asset_id, platform, content_type, item_key, title, caption, description, hashtags, payload, ready_to_publish, status, scheduled_for, external_post_id, validation_errors"
      )
      .eq("id", jobId)
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Facebook campaign row not found." }, { status: 404 });
    }
    if (job.platform !== "facebook") {
      return NextResponse.json({ error: "The selected campaign row is not a Facebook item." }, { status: 400 });
    }
    if (cleanString(job.external_post_id) || ["uploading", "published"].includes(cleanString(job.status))) {
      return NextResponse.json({ error: "This Facebook row has already been published or is currently uploading." }, { status: 409 });
    }
    if (!job.ready_to_publish) {
      return NextResponse.json({ error: "Mark this Facebook row Ready before publishing it." }, { status: 400 });
    }
    if (hasBlockingErrors(job.validation_errors)) {
      return NextResponse.json({ error: "Fix the row's blocking validation errors before publishing." }, { status: 400 });
    }
    if (cleanString(job.scheduled_for)) {
      return NextResponse.json(
        { error: "Phase 6B Meta publishing is immediate-only. Clear this row's schedule before publishing so Studio never posts earlier than intended." },
        { status: 400 }
      );
    }

    const { data: campaign, error: campaignError } = await admin
      .from("publishing_campaigns")
      .select("id")
      .eq("id", job.campaign_id)
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .neq("status", "archived")
      .single();
    if (campaignError || !campaign) {
      return NextResponse.json({ error: "The active publishing campaign could not be found." }, { status: 404 });
    }

    const { connection, accessToken, pageId } = await resolveConnection(
      admin,
      userId,
      cleanString(job.connection_id)
    );

    const hashtags = cleanStringArray(job.hashtags, 20);
    const baseCopy = cleanString(job.caption) || cleanString(job.description) || cleanString(job.title);
    const publishCopy = appendHashtags(baseCopy, hashtags);
    const payload = asRecord(job.payload);
    const now = new Date().toISOString();

    const { error: startError } = await admin
      .from("publishing_jobs")
      .update({
        connection_id: connection.id,
        status: "uploading",
        error_message: null,
        payload: { ...payload, facebookPublishStartedAt: now },
        updated_at: now,
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    if (startError) throw new Error(`Could not mark the Facebook row as publishing: ${startError.message}`);

    let externalPostId = "";
    let mode: "reel" | "page-post" = "page-post";

    if (cleanString(job.content_type) === "reel") {
      mode = "reel";
      if (!job.media_asset_id) throw new Error("No Media Hub vertical video is linked to this Facebook Reel.");
      const { data: asset, error: assetError } = await admin
        .from("song_media_assets")
        .select("id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes")
        .eq("id", job.media_asset_id)
        .eq("song_id", projectId)
        .eq("user_id", userId)
        .single();
      if (assetError || !asset) throw new Error("The linked Facebook Reel video could not be found in Media Hub.");

      externalPostId = await publishPageReel({
        admin,
        pageId,
        accessToken,
        asset: asset as MediaAsset,
        title: cleanString(job.title),
        description: publishCopy,
      });
    } else if (["release-post", "short-post", "emotional-post"].includes(cleanString(job.content_type))) {
      externalPostId = await publishPagePost({ pageId, accessToken, message: publishCopy });
    } else {
      throw new Error(`Facebook content type ${cleanString(job.content_type) || "unknown"} is not enabled for direct publishing yet.`);
    }

    const permalink = await fetchPermalink(externalPostId, accessToken);
    const completedAt = new Date().toISOString();
    const finalPayload = {
      ...payload,
      facebookMode: mode,
      facebookPageId: pageId,
      facebookPageName: connection.display_name || null,
      facebookPostId: externalPostId,
      facebookUrl: permalink,
      facebookPublishCompletedAt: completedAt,
    };

    const { error: completeError } = await admin
      .from("publishing_jobs")
      .update({
        connection_id: connection.id,
        status: "published",
        ready_to_publish: false,
        external_post_id: externalPostId,
        external_url: permalink,
        error_message: null,
        published_at: completedAt,
        payload: finalPayload,
        updated_at: completedAt,
      })
      .eq("id", jobId)
      .eq("user_id", userId);

    if (completeError) {
      throw new Error(
        `Facebook published item ${externalPostId}, but Studio could not save the result: ${completeError.message}`
      );
    }

    await admin
      .from("publishing_connections")
      .update({ last_verified_at: completedAt, updated_at: completedAt })
      .eq("id", connection.id)
      .eq("user_id", userId);

    return NextResponse.json({
      published: true,
      platform: "facebook",
      mode,
      postId: externalPostId,
      postUrl: permalink,
      accountName: connection.display_name || "Facebook Page",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Facebook publishing failed.";
    console.error("Facebook publishing error:", error);

    if (jobId && userId) {
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
