import { setTimeout as sleep } from "node:timers/promises";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { openMediaAssetResponse, type StoredMediaAsset } from "@/utils/media-source";

export const runtime = "nodejs";
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;

type InstagramConnection = {
  id: string;
  external_account_id: string | null;
  display_name: string | null;
  handle: string | null;
  scopes: string[] | null;
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
  let connection: InstagramConnection | null = null;

  if (preferredConnectionId) {
    const { data } = await admin
      .from("publishing_connections")
      .select("id, external_account_id, display_name, handle, scopes")
      .eq("id", preferredConnectionId)
      .eq("user_id", userId)
      .eq("platform", "instagram")
      .eq("status", "connected")
      .maybeSingle();
    connection = data as InstagramConnection | null;
  }

  if (!connection) {
    const { data } = await admin
      .from("publishing_connections")
      .select("id, external_account_id, display_name, handle, scopes")
      .eq("user_id", userId)
      .eq("platform", "instagram")
      .eq("status", "connected")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    connection = data as InstagramConnection | null;
  }

  if (!connection?.id || !cleanString(connection.external_account_id)) {
    throw new Error("Instagram is not connected yet. Connect Meta in Publishing Hub first.");
  }

  const scopes = Array.isArray(connection.scopes) ? connection.scopes : [];
  if (scopes.length > 0 && !scopes.includes("instagram_content_publish")) {
    throw new Error(
      "The connected Instagram account is missing instagram_content_publish permission. Reconnect Meta after granting the publishing permission."
    );
  }

  const { data: credential, error } = await admin
    .from("publishing_oauth_credentials")
    .select("connection_id, access_token, scope")
    .eq("connection_id", connection.id)
    .eq("user_id", userId)
    .eq("platform", "instagram")
    .single();

  if (error || !credential || !cleanString(credential.access_token)) {
    throw new Error("Instagram Page access token is missing. Reconnect Meta in Publishing Hub.");
  }

  const credentialScopes = cleanString(credential.scope).split(/\s+/).filter(Boolean);
  if (credentialScopes.length > 0 && !credentialScopes.includes("instagram_content_publish")) {
    throw new Error(
      "The saved Instagram authorization is missing instagram_content_publish permission. Reconnect Meta."
    );
  }

  return {
    connection,
    accessToken: cleanString(credential.access_token),
    igUserId: cleanString(connection.external_account_id),
  };
}

async function waitForContainer(
  containerId: string,
  accessToken: string,
  attempts = 30
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const url = new URL(
      `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(containerId)}`
    );
    url.searchParams.set("fields", "status_code,status");
    url.searchParams.set("access_token", accessToken);
    const status = await metaJson<{ status_code?: string; status?: string }>(url);
    const code = cleanString(status.status_code).toUpperCase();

    if (code === "FINISHED") return status;
    if (["ERROR", "EXPIRED"].includes(code)) {
      throw new Error(cleanString(status.status) || `Instagram container ended with status ${code}.`);
    }
    await sleep(3000);
  }
  throw new Error("Instagram is still processing the Reel after 90 seconds. No publish request was sent; retry later after checking the container status.");
}

async function publishReel({
  admin,
  igUserId,
  accessToken,
  asset,
  caption,
  shareToFeed,
}: {
  admin: ReturnType<typeof createAdminClient>;
  igUserId: string;
  accessToken: string;
  asset: MediaAsset;
  caption: string;
  shareToFeed: boolean;
}) {
  const contentLength = Number(asset.size_bytes || 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new Error(
      "The linked vertical video is missing file-size metadata. Replace it in Media Hub and try again."
    );
  }

  if (contentLength > 1024 * 1024 * 1024) {
    throw new Error("Instagram Reels publishing supports files up to 1 GB.");
  }

  const createBody = new URLSearchParams({
    media_type: "REELS",
    upload_type: "resumable",
    share_to_feed: shareToFeed ? "true" : "false",
    access_token: accessToken,
  });
  if (caption) createBody.set("caption", caption);

  const container = await metaJson<{ id?: string; uri?: string }>(
    `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(igUserId)}/media`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: createBody,
    }
  );

  const containerId = cleanString(container.id);
  if (!containerId) throw new Error("Instagram did not return a media container ID.");
  const uploadUrl = cleanString(container.uri) ||
    `https://rupload.facebook.com/ig-api-upload/${graphVersion()}/${encodeURIComponent(containerId)}`;

  const mediaResponse = await openMediaAssetResponse(admin, asset, 30 * 60);
  if (!mediaResponse.body) throw new Error("Studio could not open the linked Instagram Reel video.");

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${accessToken}`,
      offset: "0",
      file_size: String(contentLength),
      "content-type": cleanString(asset.mime_type) || "application/octet-stream",
      "content-length": String(contentLength),
    },
    body: mediaResponse.body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  if (!uploadResponse.ok) {
    const text = await uploadResponse.text();
    throw new Error(
      `Instagram Reel binary upload failed (HTTP ${uploadResponse.status})${text ? `: ${text.slice(0, 300)}` : "."}`
    );
  }

  await waitForContainer(containerId, accessToken);

  const publishBody = new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  });
  const published = await metaJson<{ id?: string }>(
    `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(igUserId)}/media_publish`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: publishBody,
    }
  );

  const mediaId = cleanString(published.id);
  if (!mediaId) throw new Error("Instagram accepted the publish request but returned no media ID.");
  return { containerId, mediaId };
}

async function fetchPermalink(mediaId: string, accessToken: string) {
  try {
    const url = new URL(
      `https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(mediaId)}`
    );
    url.searchParams.set("fields", "permalink");
    url.searchParams.set("access_token", accessToken);
    const result = await metaJson<{ permalink?: string }>(url);
    return cleanString(result.permalink) || null;
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
    const shareToFeed = body.shareToFeed !== false;

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
      return NextResponse.json({ error: "Instagram campaign row not found." }, { status: 404 });
    }
    if (job.platform !== "instagram") {
      return NextResponse.json({ error: "The selected campaign row is not an Instagram item." }, { status: 400 });
    }
    if (cleanString(job.content_type) !== "reel") {
      return NextResponse.json(
        { error: "Phase 6B enables direct local-file Instagram Reels first. The Instagram feed-image row is intentionally still disabled." },
        { status: 400 }
      );
    }
    if (cleanString(job.external_post_id) || ["uploading", "published"].includes(cleanString(job.status))) {
      return NextResponse.json({ error: "This Instagram row has already been published or is currently uploading." }, { status: 409 });
    }
    if (!job.ready_to_publish) {
      return NextResponse.json({ error: "Mark this Instagram Reel Ready before publishing it." }, { status: 400 });
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
    if (!job.media_asset_id) {
      return NextResponse.json({ error: "No Media Hub vertical video is linked to this Instagram Reel." }, { status: 400 });
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

    const { data: asset, error: assetError } = await admin
      .from("song_media_assets")
      .select("id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes")
      .eq("id", job.media_asset_id)
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .single();
    if (assetError || !asset) {
      return NextResponse.json({ error: "The linked Instagram Reel video could not be found in Media Hub." }, { status: 404 });
    }

    const { connection, accessToken, igUserId } = await resolveConnection(
      admin,
      userId,
      cleanString(job.connection_id)
    );

    const hashtags = cleanStringArray(job.hashtags, 20);
    const baseCaption = cleanString(job.caption) || cleanString(job.description) || cleanString(job.title);
    const caption = appendHashtags(baseCaption, hashtags);
    if (Array.from(caption).length > 2200) {
      return NextResponse.json(
        { error: "Instagram caption exceeds 2,200 characters. Edit this campaign row before publishing." },
        { status: 400 }
      );
    }

    const payload = asRecord(job.payload);
    const startedAt = new Date().toISOString();
    const { error: startError } = await admin
      .from("publishing_jobs")
      .update({
        connection_id: connection.id,
        status: "uploading",
        error_message: null,
        payload: {
          ...payload,
          instagramPublishStartedAt: startedAt,
          instagramShareToFeed: shareToFeed,
        },
        updated_at: startedAt,
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    if (startError) throw new Error(`Could not mark the Instagram row as publishing: ${startError.message}`);

    const published = await publishReel({
      admin,
      igUserId,
      accessToken,
      asset: asset as MediaAsset,
      caption,
      shareToFeed,
    });

    const permalink = await fetchPermalink(published.mediaId, accessToken);
    const completedAt = new Date().toISOString();
    const finalPayload = {
      ...payload,
      instagramContainerId: published.containerId,
      instagramMediaId: published.mediaId,
      instagramUrl: permalink,
      instagramUserId: igUserId,
      instagramAccountName: connection.display_name || null,
      instagramHandle: connection.handle || null,
      instagramShareToFeed: shareToFeed,
      instagramPublishCompletedAt: completedAt,
    };

    const { error: completeError } = await admin
      .from("publishing_jobs")
      .update({
        connection_id: connection.id,
        status: "published",
        ready_to_publish: false,
        external_post_id: published.mediaId,
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
        `Instagram published media ${published.mediaId}, but Studio could not save the result: ${completeError.message}`
      );
    }

    await admin
      .from("publishing_connections")
      .update({ last_verified_at: completedAt, updated_at: completedAt })
      .eq("id", connection.id)
      .eq("user_id", userId);

    return NextResponse.json({
      published: true,
      platform: "instagram",
      mediaId: published.mediaId,
      containerId: published.containerId,
      postUrl: permalink,
      shareToFeed,
      accountName: connection.display_name || connection.handle || "Instagram",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram publishing failed.";
    console.error("Instagram publishing error:", error);

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
