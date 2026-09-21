import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

const STATE_COOKIE = "sz_tiktok_oauth_state";
const VERIFIER_COOKIE = "sz_tiktok_oauth_verifier";
const DEFAULT_REDIRECT_URI = "http://localhost:3000/api/publishing/tiktok/callback";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  open_id?: string;
  refresh_expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  log_id?: string;
};

type UserInfoResponse = {
  data?: {
    user?: {
      open_id?: string;
      union_id?: string;
      avatar_url?: string;
      display_name?: string;
    };
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
};

function redirectUri() {
  return process.env.TIKTOK_REDIRECT_URI || DEFAULT_REDIRECT_URI;
}

function appUrl() {
  return new URL("/music", new URL(redirectUri()).origin);
}

function redirectResult(status: "connected" | "error", reason?: string) {
  const url = appUrl();
  url.searchParams.set("workspace", "publish");
  url.searchParams.set("tiktok", status);
  if (reason) url.searchParams.set("reason", reason);

  const response = NextResponse.redirect(url);
  const clear = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
  response.cookies.set(STATE_COOKIE, "", clear);
  response.cookies.set(VERIFIER_COOKIE, "", clear);
  return response;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) return redirectResult("error", "tiktok_denied");

    const cookieStore = await cookies();
    const expectedState = cookieStore.get(STATE_COOKIE)?.value;
    const codeVerifier = cookieStore.get(VERIFIER_COOKIE)?.value;

    if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
      return redirectResult("error", "state");
    }
    if (!codeVerifier) return redirectResult("error", "pkce");

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return redirectResult("error", "session");

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) return redirectResult("error", "configuration");

    const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri(),
        code_verifier: codeVerifier,
      }),
      cache: "no-store",
    });

    const tokenData = (await tokenResponse.json().catch(() => ({}))) as TokenResponse;
    if (!tokenResponse.ok || !tokenData.access_token || !tokenData.open_id) {
      console.error("TikTok token exchange failed:", {
        status: tokenResponse.status,
        error: tokenData.error,
        description: tokenData.error_description,
        logId: tokenData.log_id,
      });
      return redirectResult("error", "token");
    }

    const scopes = (tokenData.scope || "")
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);
    if (!scopes.includes("video.publish")) {
      return redirectResult("error", "scope");
    }
    if (!tokenData.refresh_token) {
      return redirectResult("error", "refresh_token");
    }

    const profileUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
    profileUrl.searchParams.set("fields", "open_id,union_id,avatar_url,display_name");
    const profileResponse = await fetch(profileUrl, {
      headers: { authorization: `Bearer ${tokenData.access_token}` },
      cache: "no-store",
    });
    const profileData = (await profileResponse.json().catch(() => ({}))) as UserInfoResponse;
    if (
      !profileResponse.ok ||
      (profileData.error?.code && profileData.error.code !== "ok") ||
      !profileData.data?.user
    ) {
      console.error("TikTok profile lookup failed:", {
        status: profileResponse.status,
        error: profileData.error,
      });
      return redirectResult("error", "profile");
    }

    const profile = profileData.data.user;
    const openId = profile.open_id || tokenData.open_id;
    if (!openId) return redirectResult("error", "profile");

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const expiresAt = Number.isFinite(tokenData.expires_in)
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : null;
    const refreshExpiresAt = Number.isFinite(tokenData.refresh_expires_in)
      ? new Date(Date.now() + Number(tokenData.refresh_expires_in) * 1000).toISOString()
      : null;

    const { data: existing, error: existingError } = await admin
      .from("publishing_connections")
      .select("id, connected_at")
      .eq("user_id", user.id)
      .eq("platform", "tiktok")
      .eq("external_account_id", openId)
      .maybeSingle();
    if (existingError) {
      throw new Error(`Could not check existing TikTok connection: ${existingError.message}`);
    }

    await admin
      .from("publishing_connections")
      .update({ is_primary: false, updated_at: now })
      .eq("user_id", user.id)
      .eq("platform", "tiktok");

    const connectionPayload = {
      user_id: user.id,
      platform: "tiktok",
      external_account_id: openId,
      display_name: profile.display_name || "TikTok Creator",
      handle: null,
      account_type: "tiktok-creator",
      status: "connected",
      is_primary: true,
      scopes,
      metadata: {
        open_id: openId,
        union_id: profile.union_id || null,
        avatar_url: profile.avatar_url || null,
        refresh_expires_at: refreshExpiresAt,
        oauth_mode: "desktop_pkce",
        direct_post_scope: scopes.includes("video.publish"),
      },
      connected_at: existing?.connected_at || now,
      last_verified_at: now,
      updated_at: now,
    };

    let connectionId = existing?.id || "";
    if (existing) {
      const { data, error } = await admin
        .from("publishing_connections")
        .update(connectionPayload)
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Could not update TikTok connection: ${error?.message || "Unknown error"}`);
      }
      connectionId = data.id;
    } else {
      const { data, error } = await admin
        .from("publishing_connections")
        .insert(connectionPayload)
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Could not save TikTok connection: ${error?.message || "Unknown error"}`);
      }
      connectionId = data.id;
    }

    const { error: credentialError } = await admin
      .from("publishing_oauth_credentials")
      .upsert(
        {
          connection_id: connectionId,
          user_id: user.id,
          platform: "tiktok",
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          token_type: tokenData.token_type || "Bearer",
          scope: tokenData.scope || scopes.join(","),
          expires_at: expiresAt,
          updated_at: now,
        },
        { onConflict: "connection_id" }
      );

    if (credentialError) {
      await admin
        .from("publishing_connections")
        .update({ status: "error", updated_at: now })
        .eq("id", connectionId)
        .eq("user_id", user.id);
      throw new Error(`Could not save TikTok OAuth credentials: ${credentialError.message}`);
    }

    return redirectResult("connected");
  } catch (error) {
    console.error("TikTok OAuth callback error:", error);
    return redirectResult("error", "unexpected");
  }
}
