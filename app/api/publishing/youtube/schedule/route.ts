import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

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
  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok || !data.access_token) {
    await admin
      .from("publishing_connections")
      .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
      .eq("id", connectionId)
      .eq("user_id", userId);
    throw new Error(data.error_description || data.error || "Could not refresh YouTube authorization.");
  }

  const expiresAt = Number.isFinite(data.expires_in)
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : null;
  await admin
    .from("publishing_oauth_credentials")
    .update({
      access_token: data.access_token,
      token_type: data.token_type || "Bearer",
      scope: data.scope || credential.scope,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("connection_id", connectionId)
    .eq("user_id", userId)
    .eq("platform", "youtube");

  return data.access_token as string;
}

async function getAccessToken(userId: string) {
  const admin = createAdminClient();
  const { data: connection } = await admin
    .from("publishing_connections")
    .select("id,scopes")
    .eq("user_id", userId)
    .eq("platform", "youtube")
    .eq("status", "connected")
    .order("is_primary", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!connection?.id) throw new Error("YouTube is not connected.");
  const scopes = Array.isArray(connection.scopes) ? connection.scopes : [];
  if (scopes.length && !scopes.includes(YOUTUBE_UPLOAD_SCOPE)) {
    throw new Error("YouTube connection is missing youtube.upload permission. Reconnect YouTube.");
  }

  const { data: credential } = await admin
    .from("publishing_oauth_credentials")
    .select("connection_id,access_token,refresh_token,scope,expires_at")
    .eq("connection_id", connection.id)
    .eq("user_id", userId)
    .eq("platform", "youtube")
    .single();

  if (!credential) throw new Error("YouTube OAuth credentials are missing.");

  let accessToken = clean(credential.access_token);
  const expiry = credential.expires_at ? Date.parse(credential.expires_at) : 0;
  if (!accessToken || !Number.isFinite(expiry) || expiry < Date.now() + 90_000) {
    accessToken = await refreshAccessToken(admin, userId, connection.id, credential as OAuthCredential);
  }
  return accessToken;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const projectId = clean(body.projectId);
    const videoId = clean(body.videoId);
    const publishAtRaw = clean(body.publishAt);
    const publishAtMs = Date.parse(publishAtRaw);

    if (!projectId || !videoId || !publishAtRaw) {
      return NextResponse.json({ error: "projectId, YouTube video ID and publish time are required." }, { status: 400 });
    }
    if (!Number.isFinite(publishAtMs) || publishAtMs <= Date.now() + 120_000) {
      return NextResponse.json({ error: "Choose a YouTube publish time at least two minutes in the future." }, { status: 400 });
    }

    const { data: song } = await supabase
      .from("songs")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const accessToken = await getAccessToken(user.id);

    const listUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    listUrl.searchParams.set("part", "status");
    listUrl.searchParams.set("id", videoId);
    const listResponse = await fetch(listUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!listResponse.ok) throw new Error(await googleMessage(listResponse, "Could not read YouTube video status"));
    const listData = (await listResponse.json().catch(() => ({}))) as any;
    const video = Array.isArray(listData.items) ? listData.items[0] : null;
    if (!video?.id) throw new Error("YouTube video was not found on the connected channel.");

    const current = video.status && typeof video.status === "object" ? video.status : {};
    if (current.privacyStatus !== "private") {
      throw new Error("YouTube scheduling requires the video to be Private and never previously published.");
    }

    const status: Record<string, unknown> = {
      privacyStatus: "private",
      publishAt: new Date(publishAtMs).toISOString(),
    };
    for (const key of ["license", "embeddable", "publicStatsViewable", "selfDeclaredMadeForKids", "containsSyntheticMedia"]) {
      if (current[key] !== undefined && current[key] !== null) status[key] = current[key];
    }

    const updateUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    updateUrl.searchParams.set("part", "status");
    const updateResponse = await fetch(updateUrl, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ id: videoId, status }),
      cache: "no-store",
    });
    if (!updateResponse.ok) throw new Error(await googleMessage(updateResponse, "YouTube rejected the schedule"));
    const updated = (await updateResponse.json().catch(() => ({}))) as any;

    return NextResponse.json({
      ok: true,
      videoId,
      publishAt: updated?.status?.publishAt || status.publishAt,
      privacyStatus: updated?.status?.privacyStatus || "private",
    });
  } catch (error) {
    console.error("YouTube schedule error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not schedule YouTube video." },
      { status: 500 }
    );
  }
}
