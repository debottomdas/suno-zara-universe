import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
type PrivacyStatus = "private" | "unlisted" | "public";

type OAuthCredential = {
  connection_id: string;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  expires_at: string | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
function isPrivacyStatus(value: string): value is PrivacyStatus {
  return value === "private" || value === "unlisted" || value === "public";
}
function stringArray(value: unknown, max = 50) {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, max)
    : [];
}
function tagsCharacterCount(tags: string[]) {
  return tags.reduce((total, tag, index) => total + (/[\s]/.test(tag) ? `"${tag}"` : tag).length + (index ? 1 : 0), 0);
}
function validateMetadata(title: string, description: string, tags: string[]) {
  if (!title) throw new Error("YouTube title is required.");
  if (Array.from(title).length > 100) throw new Error("YouTube title exceeds 100 characters.");
  if (title.includes("<") || title.includes(">")) throw new Error("YouTube title cannot contain < or >.");
  if (Buffer.byteLength(description, "utf8") > 5000) throw new Error("YouTube description exceeds 5000 bytes.");
  if (description.includes("<") || description.includes(">")) throw new Error("YouTube description cannot contain < or >.");
  if (tagsCharacterCount(tags) > 500) throw new Error("YouTube tags exceed the 500-character API limit.");
}
function appendHashtags(description: string, hashtags: string[]) {
  const missing = hashtags.filter((tag) => !description.toLowerCase().includes(tag.toLowerCase()));
  return missing.length ? [description, missing.join(" ")].filter(Boolean).join("\n\n") : description;
}

async function refreshAccessToken(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  connectionId: string,
  credential: OAuthCredential
) {
  const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_YOUTUBE_CLIENT_SECRET;
  const refreshToken = clean(credential.refresh_token);
  if (!clientId || !clientSecret) throw new Error("Google YouTube OAuth server credentials are not configured.");
  if (!refreshToken) throw new Error("YouTube refresh token is missing. Reconnect YouTube.");

  const response = await fetch("https://oauth2.googleapis.com/token", {
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
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok || !data.access_token) {
    await admin.from("publishing_connections").update({ status: "needs_reauth", updated_at: new Date().toISOString() }).eq("id", connectionId).eq("user_id", userId);
    throw new Error(data.error_description || data.error || "Could not refresh YouTube authorization.");
  }
  const expiresAt = Number.isFinite(data.expires_in) ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null;
  await admin.from("publishing_oauth_credentials").update({
    access_token: data.access_token,
    token_type: data.token_type || "Bearer",
    scope: data.scope || credential.scope,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq("connection_id", connectionId).eq("user_id", userId).eq("platform", "youtube");
  return data.access_token as string;
}

async function googleMessage(response: Response, fallback: string) {
  const text = await response.text();
  if (!text) return `${fallback} (HTTP ${response.status})`;
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || parsed?.error?.errors?.[0]?.message || `${fallback} (HTTP ${response.status})`;
  } catch {
    return `${fallback} (HTTP ${response.status})`;
  }
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
    const sizeBytes = Number(body.sizeBytes || 0);
    const mimeType = clean(body.mimeType) || "video/mp4";
    const privacyStatus = clean(body.privacyStatus);
    const selfDeclaredMadeForKids = Boolean(body.selfDeclaredMadeForKids);
    const containsSyntheticMedia = Boolean(body.containsSyntheticMedia);

    if (!projectId || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return NextResponse.json({ error: "projectId and local file size are required." }, { status: 400 });
    }
    if (!isPrivacyStatus(privacyStatus)) {
      return NextResponse.json({ error: "Choose Private, Unlisted or Public visibility." }, { status: 400 });
    }

    const { data: song } = await supabase.from("songs").select("id,title").eq("id", projectId).eq("user_id", user.id).single();
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const { data: pack, error: packError } = await supabase
      .from("social_media_packs")
      .select("youtube_full,youtube_shorts")
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (packError) throw new Error(`Could not load saved social pack: ${packError.message}`);

    let title = "";
    let description = "";
    let tags: string[] = [];
    if (kind === "full") {
      const full = (pack?.youtube_full && typeof pack.youtube_full === "object" ? pack.youtube_full : {}) as any;
      title = clean(full.recommendedTitle) || clean(song.title) || "Suno Zara Original";
      description = clean(full.finalDescription) || clean(full.fullDescription) || clean(full.openingDescription);
      const hashtags = stringArray(full.hashtags, 30);
      description = appendHashtags(description, hashtags);
      tags = stringArray(full.tags, 50);
    } else {
      const shortsPack = (pack?.youtube_shorts && typeof pack.youtube_shorts === "object" ? pack.youtube_shorts : {}) as any;
      const shorts = Array.isArray(shortsPack.shorts) ? shortsPack.shorts : [];
      const item = shorts.find((x: any) => Number(x?.shortNumber) === slot) || shorts[slot - 1] || {};
      title = clean(item.title) || `${clean(song.title) || "Suno Zara"} — Short ${slot}`;
      description = appendHashtags(clean(item.description), stringArray(item.hashtags, 15));
      tags = stringArray(item.tags, 30);
    }
    validateMetadata(title, description, tags);

    const admin = createAdminClient();
    const { data: connection } = await admin
      .from("publishing_connections")
      .select("id,scopes")
      .eq("user_id", user.id)
      .eq("platform", "youtube")
      .eq("status", "connected")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!connection?.id) return NextResponse.json({ error: "YouTube is not connected." }, { status: 400 });
    const scopes = Array.isArray(connection.scopes) ? connection.scopes : [];
    if (scopes.length && !scopes.includes(YOUTUBE_UPLOAD_SCOPE)) {
      return NextResponse.json({ error: "YouTube connection is missing youtube.upload permission. Reconnect YouTube." }, { status: 400 });
    }

    const { data: credential } = await admin
      .from("publishing_oauth_credentials")
      .select("connection_id,access_token,refresh_token,scope,expires_at")
      .eq("connection_id", connection.id)
      .eq("user_id", user.id)
      .eq("platform", "youtube")
      .single();
    if (!credential) return NextResponse.json({ error: "YouTube OAuth credentials are missing." }, { status: 400 });

    let accessToken = clean(credential.access_token);
    const expiry = credential.expires_at ? Date.parse(credential.expires_at) : 0;
    if (!accessToken || !Number.isFinite(expiry) || expiry < Date.now() + 90_000) {
      accessToken = await refreshAccessToken(admin, user.id, connection.id, credential as OAuthCredential);
    }

    const url = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
    url.searchParams.set("uploadType", "resumable");
    url.searchParams.set("part", "snippet,status");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-length": String(sizeBytes),
        "x-upload-content-type": mimeType,
      },
      body: JSON.stringify({
        snippet: { title, description, tags },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids,
          containsSyntheticMedia,
        },
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await googleMessage(response, "YouTube rejected the upload metadata"));
    const uploadUrl = response.headers.get("location");
    if (!uploadUrl) throw new Error("YouTube did not return a resumable upload session URL.");

    return NextResponse.json({
      uploadUrl,
      transientAccessToken: accessToken,
      title,
      description,
      tags,
      connectionId: connection.id,
      itemKey: kind === "full" ? "youtube-full" : `youtube-short-${String(slot).padStart(2, "0")}`,
    });
  } catch (error) {
    console.error("YouTube direct session error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare direct YouTube upload." }, { status: 500 });
  }
}
