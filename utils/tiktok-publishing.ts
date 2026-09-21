
import { createAdminClient } from "@/utils/supabase/admin";

export type TikTokCreatorInfo = {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

type TikTokConnection = {
  id: string;
  external_account_id: string | null;
  display_name: string | null;
  scopes: string[] | null;
};

type TikTokCredential = {
  connection_id: string;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  expires_at: string | null;
};

type TikTokApiEnvelope<T> = {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
};

export function cleanTikTokString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function scopeList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => cleanTikTokString(entry)).filter(Boolean);
  }
  return cleanTikTokString(value).split(/[\s,]+/).filter(Boolean);
}

async function refreshTikTokToken(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  connectionId: string,
  credential: TikTokCredential
) {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const refreshToken = cleanTikTokString(credential.refresh_token);
  if (!clientKey || !clientSecret) {
    throw new Error("TikTok OAuth server credentials are not configured in .env.local.");
  }
  if (!refreshToken) {
    throw new Error("TikTok refresh token is missing. Reconnect TikTok in Publishing Hub.");
  }

  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_expires_in?: number;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.access_token) {
    await admin
      .from("publishing_connections")
      .update({ status: "needs_reauth", updated_at: new Date().toISOString() })
      .eq("id", connectionId)
      .eq("user_id", userId);
    throw new Error(data.error_description || data.error || "Could not refresh TikTok authorization. Reconnect TikTok.");
  }

  const now = Date.now();
  const expiresAt = Number.isFinite(data.expires_in)
    ? new Date(now + Number(data.expires_in) * 1000).toISOString()
    : null;
  const refreshExpiresAt = Number.isFinite(data.refresh_expires_in)
    ? new Date(now + Number(data.refresh_expires_in) * 1000).toISOString()
    : null;

  const { error: updateError } = await admin
    .from("publishing_oauth_credentials")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || credential.refresh_token,
      token_type: data.token_type || "Bearer",
      scope: data.scope || credential.scope,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("connection_id", connectionId)
    .eq("user_id", userId)
    .eq("platform", "tiktok");
  if (updateError) {
    throw new Error(`Could not save refreshed TikTok authorization: ${updateError.message}`);
  }

  if (refreshExpiresAt) {
    const { data: connection } = await admin
      .from("publishing_connections")
      .select("metadata")
      .eq("id", connectionId)
      .eq("user_id", userId)
      .maybeSingle();
    const metadata = connection?.metadata && typeof connection.metadata === "object"
      ? connection.metadata
      : {};
    await admin
      .from("publishing_connections")
      .update({
        metadata: { ...metadata, refresh_expires_at: refreshExpiresAt },
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId)
      .eq("user_id", userId);
  }

  return data.access_token;
}

export async function getTikTokAuthorization(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  preferredConnectionId?: string | null
) {
  let connection: TikTokConnection | null = null;
  const preferred = cleanTikTokString(preferredConnectionId);

  if (preferred) {
    const { data } = await admin
      .from("publishing_connections")
      .select("id, external_account_id, display_name, scopes")
      .eq("id", preferred)
      .eq("user_id", userId)
      .eq("platform", "tiktok")
      .eq("status", "connected")
      .maybeSingle();
    connection = data as TikTokConnection | null;
  }

  if (!connection) {
    const { data } = await admin
      .from("publishing_connections")
      .select("id, external_account_id, display_name, scopes")
      .eq("user_id", userId)
      .eq("platform", "tiktok")
      .eq("status", "connected")
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle();
    connection = data as TikTokConnection | null;
  }

  if (!connection?.id) {
    throw new Error("TikTok is not connected yet. Connect TikTok in Publishing Hub first.");
  }
  const connectionScopes = scopeList(connection.scopes);
  if (connectionScopes.length > 0 && !connectionScopes.includes("video.publish")) {
    throw new Error("The connected TikTok account is missing video.publish permission. Reconnect after Content Posting API access is approved.");
  }

  const { data: credential, error } = await admin
    .from("publishing_oauth_credentials")
    .select("connection_id, access_token, refresh_token, scope, expires_at")
    .eq("connection_id", connection.id)
    .eq("user_id", userId)
    .eq("platform", "tiktok")
    .single();
  if (error || !credential) {
    throw new Error("TikTok OAuth credentials are missing. Reconnect TikTok in Publishing Hub.");
  }
  const credentialScopes = scopeList(credential.scope);
  if (credentialScopes.length > 0 && !credentialScopes.includes("video.publish")) {
    throw new Error("The saved TikTok authorization is missing video.publish permission. Reconnect TikTok.");
  }

  const expiresAtMs = credential.expires_at ? Date.parse(credential.expires_at) : Number.NaN;
  const stillFresh = cleanTikTokString(credential.access_token) && Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() + 10 * 60 * 1000;
  const accessToken = stillFresh
    ? cleanTikTokString(credential.access_token)
    : await refreshTikTokToken(admin, userId, connection.id, credential as TikTokCredential);

  return { connection, accessToken };
}

export async function queryTikTokCreatorInfo(accessToken: string) {
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    cache: "no-store",
  });
  const envelope = (await response.json().catch(() => ({}))) as TikTokApiEnvelope<TikTokCreatorInfo>;
  const code = cleanTikTokString(envelope.error?.code);
  if (!response.ok || (code && code !== "ok") || !envelope.data) {
    throw new Error(envelope.error?.message || code || `TikTok creator-info request failed (HTTP ${response.status}).`);
  }
  return envelope.data;
}

export async function fetchTikTokPublishStatus(accessToken: string, publishId: string) {
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
    cache: "no-store",
  });
  const envelope = (await response.json().catch(() => ({}))) as TikTokApiEnvelope<{
    status?: string;
    fail_reason?: string;
    publicly_available_post_id?: Array<string | number>;
    publicaly_available_post_id?: Array<string | number>;
    uploaded_bytes?: number;
  }>;
  const code = cleanTikTokString(envelope.error?.code);
  if (!response.ok || (code && code !== "ok") || !envelope.data) {
    throw new Error(envelope.error?.message || code || `TikTok publish-status request failed (HTTP ${response.status}).`);
  }
  return envelope.data;
}
