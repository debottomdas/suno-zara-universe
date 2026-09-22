import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { openMediaAssetResponse, type StoredMediaAsset } from "@/utils/media-source";

export const runtime = "nodejs";
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function strings(value: unknown, max = 50) {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, max) : [];
}
async function googleMessage(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return `${fallback} (HTTP ${response.status})`;
  try { const parsed = JSON.parse(text); return parsed?.error?.message || `${fallback} (HTTP ${response.status})`; }
  catch { return `${fallback} (HTTP ${response.status})`; }
}
async function currentAccessToken(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data: connection } = await admin.from("publishing_connections").select("id").eq("user_id", userId).eq("platform", "youtube").eq("status", "connected").order("is_primary", { ascending: false }).limit(1).maybeSingle();
  if (!connection?.id) return "";
  const { data: credential } = await admin.from("publishing_oauth_credentials").select("access_token").eq("connection_id", connection.id).eq("user_id", userId).eq("platform", "youtube").maybeSingle();
  return clean(credential?.access_token);
}
async function normalizeThumbnail(buffer: Buffer, mimeType: string) {
  if (buffer.length <= MAX_THUMBNAIL_BYTES && ["image/jpeg", "image/png"].includes(mimeType.toLowerCase())) return { body: buffer, mimeType: mimeType.toLowerCase() };
  let quality = 90;
  let converted = await sharp(buffer).rotate().resize({ width: 1280, height: 720, fit: "inside", withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
  while (converted.length > MAX_THUMBNAIL_BYTES && quality > 50) {
    quality -= 10;
    converted = await sharp(buffer).rotate().resize({ width: 1280, height: 720, fit: "inside", withoutEnlargement: true }).jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  if (converted.length > MAX_THUMBNAIL_BYTES) throw new Error("Thumbnail could not be reduced below YouTube's 2 MB limit.");
  return { body: converted, mimeType: "image/jpeg" };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  try {
    const body = await request.json();
    const projectId = clean(body.projectId);
    const kind = clean(body.kind) === "short" ? "short" : "full";
    const slot = Math.max(1, Math.min(6, Number(body.slot || 1)));
    const videoId = clean(body.videoId);
    const title = clean(body.title);
    const description = clean(body.description);
    const tags = strings(body.tags, 50);
    const privacyStatus = clean(body.privacyStatus) || "private";
    if (!projectId || !videoId) return NextResponse.json({ error: "projectId and videoId are required." }, { status: 400 });

    const { data: song } = await supabase.from("songs").select("id,title").eq("id", projectId).eq("user_id", user.id).single();
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const admin = createAdminClient();

    // Set the already-generated cloud thumbnail only for the full video. Large video bytes never touch Supabase here.
    let thumbnailStatus = "not-applicable";
    if (kind === "full") {
      const { data: thumbnail } = await admin
        .from("song_media_assets")
        .select("id,song_id,user_id,media_kind,slot,original_filename,storage_provider,storage_path,local_path,mime_type,size_bytes")
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .eq("media_kind", "thumbnail")
        .eq("slot", 1)
        .maybeSingle();
      const token = await currentAccessToken(admin, user.id);
      if (thumbnail && token) {
        try {
          const source = await openMediaAssetResponse(admin, thumbnail as unknown as StoredMediaAsset, 10 * 60);
          const original = Buffer.from(await source.arrayBuffer());
          const normalized = await normalizeThumbnail(original, clean(thumbnail.mime_type) || "application/octet-stream");
          const url = new URL("https://www.googleapis.com/upload/youtube/v3/thumbnails/set");
          url.searchParams.set("videoId", videoId);
          url.searchParams.set("uploadType", "media");
          const response = await fetch(url, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": normalized.mimeType, "content-length": String(normalized.body.length) },
            body: Uint8Array.from(normalized.body).buffer,
          });
          if (!response.ok) throw new Error(await googleMessage(response, "YouTube thumbnail upload failed"));
          thumbnailStatus = "set";
        } catch (error) {
          thumbnailStatus = error instanceof Error ? `warning: ${error.message}` : "warning: thumbnail failed";
        }
      } else {
        thumbnailStatus = "warning: no saved thumbnail found";
      }
    }

    const itemKey = kind === "full" ? "youtube-full" : `youtube-short-${String(slot).padStart(2, "0")}`;
    const now = new Date().toISOString();
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    let campaignId = "";
    const { data: existingCampaign } = await admin
      .from("publishing_campaigns")
      .select("id")
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    campaignId = clean(existingCampaign?.id);
    if (!campaignId) {
      const { data: created, error } = await admin.from("publishing_campaigns").insert({
        song_id: projectId,
        user_id: user.id,
        name: `${clean(song.title) || "Untitled"} — Local-First Release`,
        status: "ready",
        updated_at: now,
      }).select("id").single();
      if (error || !created) throw new Error(`Could not create publishing history: ${error?.message || "unknown error"}`);
      campaignId = created.id;
    }

    const { data: connection } = await admin.from("publishing_connections").select("id").eq("user_id", user.id).eq("platform", "youtube").eq("status", "connected").order("is_primary", { ascending: false }).limit(1).maybeSingle();
    const { data: existingJob } = await admin.from("publishing_jobs").select("id").eq("campaign_id", campaignId).eq("user_id", user.id).eq("item_key", itemKey).maybeSingle();
    const values = {
      campaign_id: campaignId,
      song_id: projectId,
      user_id: user.id,
      connection_id: connection?.id || null,
      media_asset_id: null,
      platform: "youtube",
      content_type: kind === "full" ? "full-video" : "short",
      item_key: itemKey,
      title: title || null,
      caption: null,
      description: description || null,
      hashtags: [],
      tags,
      payload: { localFirst: true, localMedia: true, shortNumber: kind === "short" ? slot : null, privacyStatus, thumbnailStatus },
      ready_to_publish: true,
      status: "published",
      external_post_id: videoId,
      external_url: url,
      error_message: null,
      validation_errors: [],
      published_at: now,
      updated_at: now,
    };
    if (existingJob?.id) {
      const { error } = await admin.from("publishing_jobs").update(values).eq("id", existingJob.id).eq("user_id", user.id);
      if (error) throw new Error(`Could not update publishing history: ${error.message}`);
    } else {
      const { error } = await admin.from("publishing_jobs").insert(values);
      if (error) throw new Error(`Could not save publishing history: ${error.message}`);
    }
    await admin.from("publishing_campaigns").update({ status: "ready", updated_at: now }).eq("id", campaignId).eq("user_id", user.id);

    return NextResponse.json({ ok: true, videoId, url, itemKey, thumbnailStatus });
  } catch (error) {
    console.error("YouTube direct complete error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save YouTube publishing result." }, { status: 500 });
  }
}
