import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

const STATE_COOKIE = "sz_meta_oauth_state";

type JsonRecord = Record<string, unknown>;
type Platform = "facebook" | "instagram";

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
};

type PageRow = {
  id: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
  instagram_business_account?: { id?: string };
};

type PagesResponse = {
  data?: PageRow[];
  paging?: { next?: string };
  error?: { message?: string };
};

type InstagramProfile = {
  id?: string;
  username?: string;
  name?: string;
  profile_picture_url?: string;
  account_type?: string;
  error?: { message?: string };
};

type PermissionResponse = {
  data?: Array<{ permission?: string; status?: string }>;
};

function graphVersion() {
  return process.env.META_GRAPH_VERSION || "v26.0";
}

function redirectBase() {
  const redirectUri = process.env.META_REDIRECT_URI || "http://localhost:3000/api/publishing/meta/callback";
  return new URL("/music", new URL(redirectUri).origin);
}

function redirectResult(
  status: "connected" | "error",
  reason?: string,
  extras?: Record<string, string | number | boolean>
) {
  const url = redirectBase();
  url.searchParams.set("workspace", "publish");
  url.searchParams.set("meta", status);
  if (reason) url.searchParams.set("reason", reason);
  for (const [key, value] of Object.entries(extras || {})) {
    url.searchParams.set(key, String(value));
  }

  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

async function metaJson<T>(url: URL | string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message || `Meta request failed with HTTP ${response.status}.`);
  }
  return data;
}

async function loadAllPages(userAccessToken: string) {
  const pages: PageRow[] = [];
  let next: string | null = `https://graph.facebook.com/${graphVersion()}/me/accounts?fields=id,name,access_token,tasks,instagram_business_account&limit=100&access_token=${encodeURIComponent(userAccessToken)}`;
  let loops = 0;

  while (next && loops < 5) {
    const data: PagesResponse = await metaJson<PagesResponse>(next);
    pages.push(...(Array.isArray(data.data) ? data.data : []));
    next = data.paging?.next || null;
    loops += 1;
  }

  return pages;
}

async function loadInstagramProfile(igId: string, pageAccessToken: string) {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${igId}`);
  url.searchParams.set("fields", "id,username,name,profile_picture_url,account_type");
  url.searchParams.set("access_token", pageAccessToken);
  return metaJson<InstagramProfile>(url);
}

async function upsertConnection({
  admin,
  userId,
  platform,
  externalAccountId,
  displayName,
  handle,
  accountType,
  scopes,
  metadata,
  accessToken,
}: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  platform: Platform;
  externalAccountId: string;
  displayName: string;
  handle: string | null;
  accountType: string;
  scopes: string[];
  metadata: JsonRecord;
  accessToken: string;
}) {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await admin
    .from("publishing_connections")
    .select("id, is_primary, connected_at")
    .eq("user_id", userId)
    .eq("platform", platform)
    .eq("external_account_id", externalAccountId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Could not check existing ${platform} connection: ${existingError.message}`);
  }

  const payload = {
    user_id: userId,
    platform,
    external_account_id: externalAccountId,
    display_name: displayName,
    handle,
    account_type: accountType,
    status: "connected",
    is_primary: existing?.is_primary || false,
    scopes,
    metadata,
    connected_at: existing?.connected_at || now,
    last_verified_at: now,
    updated_at: now,
  };

  let connectionId = existing?.id || "";
  if (existing) {
    const { data, error } = await admin
      .from("publishing_connections")
      .update(payload)
      .eq("id", existing.id)
      .eq("user_id", userId)
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Could not update ${platform} connection: ${error?.message || "Unknown error"}`);
    }
    connectionId = data.id;
  } else {
    const { data, error } = await admin
      .from("publishing_connections")
      .insert(payload)
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Could not save ${platform} connection: ${error?.message || "Unknown error"}`);
    }
    connectionId = data.id;
  }

  const { error: credentialError } = await admin
    .from("publishing_oauth_credentials")
    .upsert(
      {
        connection_id: connectionId,
        user_id: userId,
        platform,
        access_token: accessToken,
        refresh_token: null,
        token_type: "Bearer",
        scope: scopes.join(" "),
        expires_at: null,
        updated_at: now,
      },
      { onConflict: "connection_id" }
    );

  if (credentialError) {
    await admin
      .from("publishing_connections")
      .update({ status: "error", updated_at: now })
      .eq("id", connectionId)
      .eq("user_id", userId);
    throw new Error(`Could not save ${platform} credentials: ${credentialError.message}`);
  }

  return { id: connectionId, isPrimary: Boolean(existing?.is_primary) };
}

async function normalizePrimary(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  platform: Platform,
  connectionIds: string[]
) {
  if (connectionIds.length === 0) return false;
  const now = new Date().toISOString();

  const { data: rows, error } = await admin
    .from("publishing_connections")
    .select("id, is_primary")
    .eq("user_id", userId)
    .eq("platform", platform)
    .in("id", connectionIds);

  if (error) throw new Error(`Could not normalize ${platform} primary connection: ${error.message}`);

  if (connectionIds.length === 1) {
    await admin
      .from("publishing_connections")
      .update({ is_primary: false, updated_at: now })
      .eq("user_id", userId)
      .eq("platform", platform);
    const { error: setError } = await admin
      .from("publishing_connections")
      .update({ is_primary: true, updated_at: now })
      .eq("id", connectionIds[0])
      .eq("user_id", userId);
    if (setError) throw new Error(`Could not set primary ${platform} account: ${setError.message}`);
    return false;
  }

  const primaries = (rows || []).filter((row) => row.is_primary);
  if (primaries.length > 1) {
    const keepId = primaries[0].id;
    const { error: clearError } = await admin
      .from("publishing_connections")
      .update({ is_primary: false, updated_at: now })
      .eq("user_id", userId)
      .eq("platform", platform)
      .neq("id", keepId);
    if (clearError) throw new Error(`Could not normalize ${platform} accounts: ${clearError.message}`);
    return false;
  }

  return primaries.length === 0;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      return redirectResult("error", "meta_denied");
    }

    const cookieStore = await cookies();
    const expectedState = cookieStore.get(STATE_COOKIE)?.value;
    if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
      return redirectResult("error", "state");
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return redirectResult("error", "session");
    }

    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const redirectUri = process.env.META_REDIRECT_URI;
    if (!appId || !appSecret || !redirectUri) {
      return redirectResult("error", "configuration");
    }

    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
    tokenUrl.searchParams.set("client_id", appId);
    tokenUrl.searchParams.set("client_secret", appSecret);
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);

    const shortToken = await metaJson<TokenResponse>(tokenUrl);
    if (!shortToken.access_token) {
      return redirectResult("error", "token");
    }

    const longUrl = new URL(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`);
    longUrl.searchParams.set("grant_type", "fb_exchange_token");
    longUrl.searchParams.set("client_id", appId);
    longUrl.searchParams.set("client_secret", appSecret);
    longUrl.searchParams.set("fb_exchange_token", shortToken.access_token);

    const longToken = await metaJson<TokenResponse>(longUrl);
    const userAccessToken = longToken.access_token;
    if (!userAccessToken) {
      return redirectResult("error", "long_token");
    }

    const permissionsUrl = new URL(`https://graph.facebook.com/${graphVersion()}/me/permissions`);
    permissionsUrl.searchParams.set("access_token", userAccessToken);
    const permissions = await metaJson<PermissionResponse>(permissionsUrl);
    const granted = (permissions.data || [])
      .filter((entry) => entry.status === "granted" && entry.permission)
      .map((entry) => String(entry.permission));

    const pages = await loadAllPages(userAccessToken);
    const usablePages = pages.filter((page) => page.id && page.access_token);
    if (usablePages.length === 0) {
      return redirectResult("error", "no_pages");
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const userExpiresAt = Number.isFinite(longToken.expires_in)
      ? new Date(Date.now() + Number(longToken.expires_in) * 1000).toISOString()
      : null;

    await admin
      .from("publishing_connections")
      .update({ status: "needs_reauth", updated_at: now })
      .eq("user_id", user.id)
      .in("platform", ["facebook", "instagram"]);

    const facebookIds: string[] = [];
    const instagramIds: string[] = [];

    for (const page of usablePages) {
      const pageToken = String(page.access_token);
      const igId = page.instagram_business_account?.id || null;

      const facebook = await upsertConnection({
        admin,
        userId: user.id,
        platform: "facebook",
        externalAccountId: page.id,
        displayName: page.name || "Facebook Page",
        handle: null,
        accountType: "facebook-page",
        scopes: granted,
        accessToken: pageToken,
        metadata: {
          page_id: page.id,
          page_name: page.name || null,
          tasks: Array.isArray(page.tasks) ? page.tasks : [],
          instagram_business_account_id: igId,
          oauth_user_expires_at: userExpiresAt,
          graph_version: graphVersion(),
        },
      });
      facebookIds.push(facebook.id);

      if (igId) {
        try {
          const profile = await loadInstagramProfile(igId, pageToken);
          const instagram = await upsertConnection({
            admin,
            userId: user.id,
            platform: "instagram",
            externalAccountId: igId,
            displayName: profile.name || profile.username || "Instagram Professional Account",
            handle: profile.username || null,
            accountType: profile.account_type
              ? `instagram-${profile.account_type.toLowerCase()}`
              : "instagram-professional",
            scopes: granted,
            accessToken: pageToken,
            metadata: {
              instagram_user_id: igId,
              username: profile.username || null,
              account_type: profile.account_type || null,
              profile_picture_url: profile.profile_picture_url || null,
              facebook_page_id: page.id,
              facebook_page_name: page.name || null,
              oauth_user_expires_at: userExpiresAt,
              graph_version: graphVersion(),
            },
          });
          instagramIds.push(instagram.id);
        } catch (error) {
          console.error(`Could not read linked Instagram account ${igId}:`, error);
        }
      }
    }

    const facebookNeedsSelection = await normalizePrimary(admin, user.id, "facebook", facebookIds);
    const instagramNeedsSelection = await normalizePrimary(admin, user.id, "instagram", instagramIds);

    return redirectResult("connected", undefined, {
      fb: facebookIds.length,
      ig: instagramIds.length,
      selection: facebookNeedsSelection || instagramNeedsSelection ? 1 : 0,
    });
  } catch (error) {
    console.error("Meta OAuth callback error:", error);
    return redirectResult("error", "unexpected");
  }
}
