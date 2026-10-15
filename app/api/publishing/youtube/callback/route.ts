import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { verifyOAuthHandoff } from "@/utils/publishing/oauth-handoff";

export const runtime = "nodejs";

const STATE_COOKIE = "sz_youtube_oauth_state";
const VERIFIER_COOKIE = "sz_youtube_oauth_verifier";
const CHANNEL_COOKIE = "sz_youtube_oauth_channel";
const RETURN_TO_COOKIE = "sz_youtube_oauth_return_to";
const CONTEXT_COOKIE = "sz_youtube_oauth_context";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type YouTubeChannel = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    country?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
  status?: {
    privacyStatus?: string;
    isLinked?: boolean;
  };
};

type YouTubeChannelsResponse = {
  items?: YouTubeChannel[];
  error?: {
    message?: string;
  };
};

function appUrl() {
  const redirectUri =
    process.env.GOOGLE_YOUTUBE_REDIRECT_URI ||
    "http://localhost:3000/api/publishing/youtube/callback";

  return new URL("/music", new URL(redirectUri).origin);
}

function redirectResult(
  status: "connected" | "error",
  reason?: string,
  returnTo?: string,
  returnOrigin?: string
) {
  const safeReturnTo =
    returnTo?.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : "";

  let safeOrigin = appUrl().origin;

  if (returnOrigin) {
    try {
      const parsedOrigin = new URL(returnOrigin);
      const allowed =
        parsedOrigin.protocol === "https:" ||
        ((parsedOrigin.hostname === "localhost" ||
          parsedOrigin.hostname === "127.0.0.1") &&
          parsedOrigin.protocol === "http:");

      if (allowed && parsedOrigin.origin === returnOrigin) {
        safeOrigin = parsedOrigin.origin;
      }
    } catch {
      // Fall back to the hosted application origin.
    }
  }

  const url = safeReturnTo
    ? new URL(safeReturnTo, safeOrigin)
    : new URL(appUrl().pathname, safeOrigin);

  if (!safeReturnTo) url.searchParams.set("workspace", "publish");
  url.searchParams.set("youtube", status);
  if (reason) url.searchParams.set("reason", reason);

  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(VERIFIER_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(CHANNEL_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  response.cookies.set(RETURN_TO_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  response.cookies.set(CONTEXT_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError) {
      return redirectResult("error", "google_denied");
    }

    const cookieStore = await cookies();
    const expectedState = cookieStore.get(STATE_COOKIE)?.value;
    const codeVerifier = cookieStore.get(VERIFIER_COOKIE)?.value;
    const cookieChannelId = cookieStore.get(CHANNEL_COOKIE)?.value || "";
    const cookieReturnTo = cookieStore.get(RETURN_TO_COOKIE)?.value || "";
    const contextToken = cookieStore.get(CONTEXT_COOKIE)?.value || "";
    const context = verifyOAuthHandoff(contextToken);

    const returnTo = context?.returnTo || cookieReturnTo;
    const returnOrigin = context?.returnOrigin;

    if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
      return redirectResult("error", "state", returnTo, returnOrigin);
    }

    if (!codeVerifier) {
      return redirectResult("error", "pkce", returnTo, returnOrigin);
    }

    if (!context) {
      return redirectResult("error", "context", returnTo);
    }

    const userId = context.userId;
    const universeChannelId = context.channelId;

    if (!universeChannelId || universeChannelId !== cookieChannelId) {
      return redirectResult("error", "channel", returnTo, returnOrigin);
    }

    /*
     * The OAuth callback runs on the Vercel authority. It must not depend on
     * the initiating localhost Supabase cookie. The signed context identifies
     * the initiating user/channel, then the admin client independently checks
     * that ownership before credentials are written.
     */
    const admin = createAdminClient();

    const { data: universeChannel, error: universeChannelError } = await admin
      .from("channels")
      .select("id, workspace_id, workspaces!inner(owner_user_id)")
      .eq("id", universeChannelId)
      .eq("workspaces.owner_user_id", userId)
      .maybeSingle();

    if (universeChannelError || !universeChannel) {
      return redirectResult("error", "channel", returnTo, returnOrigin);
    }

    const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_YOUTUBE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_YOUTUBE_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return redirectResult("error", "configuration");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });

    const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Google token exchange failed:", {
        status: tokenResponse.status,
        error: tokenData.error,
        description: tokenData.error_description,
      });
      return redirectResult("error", "token");
    }

    const channelUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    channelUrl.searchParams.set("part", "id,snippet,contentDetails,status");
    channelUrl.searchParams.set("mine", "true");
    channelUrl.searchParams.set("maxResults", "50");

    const channelResponse = await fetch(channelUrl, {
      headers: {
        authorization: `Bearer ${tokenData.access_token}`,
      },
      cache: "no-store",
    });

    const channelData = (await channelResponse.json()) as YouTubeChannelsResponse;

    if (!channelResponse.ok) {
      console.error("YouTube channel lookup failed:", {
        status: channelResponse.status,
        message: channelData.error?.message,
      });
      return redirectResult("error", "channel_lookup", returnTo, returnOrigin);
    }

    const channels = Array.isArray(channelData.items) ? channelData.items : [];

    if (channels.length === 0) {
      return redirectResult("error", "no_channel", returnTo, returnOrigin);
    }

    if (channels.length > 1) {
      console.warn("Multiple YouTube channels returned for OAuth user; refusing to guess.", {
        count: channels.length,
      });
      return redirectResult("error", "multiple_channels", returnTo, returnOrigin);
    }

    const channel = channels[0];
    const now = new Date().toISOString();
    const scopes = (tokenData.scope || "")
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean);

    const { data: existingConnection, error: existingConnectionError } =
      await admin
        .from("publishing_connections")
        .select("id")
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("external_account_id", channel.id)
        .eq("channel_id", universeChannelId)
        .maybeSingle();

    if (existingConnectionError) {
      throw new Error(
        `Could not check existing YouTube connection: ${existingConnectionError.message}`
      );
    }

    await admin
      .from("publishing_connections")
      .update({ is_primary: false, updated_at: now })
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .eq("channel_id", universeChannelId);

    const connectionPayload = {
      user_id: userId,
      channel_id: universeChannelId,
      platform: "youtube",
      external_account_id: channel.id,
      display_name: channel.snippet?.title || "YouTube Channel",
      handle: channel.snippet?.customUrl || null,
      account_type: "youtube-channel",
      status: "connected",
      is_primary: true,
      scopes,
      metadata: {
        channel_id: channel.id,
        channel_url: `https://www.youtube.com/channel/${channel.id}`,
        thumbnail_url:
          channel.snippet?.thumbnails?.high?.url ||
          channel.snippet?.thumbnails?.medium?.url ||
          channel.snippet?.thumbnails?.default?.url ||
          null,
        uploads_playlist_id:
          channel.contentDetails?.relatedPlaylists?.uploads || null,
        privacy_status: channel.status?.privacyStatus || null,
        is_linked: channel.status?.isLinked ?? null,
        country: channel.snippet?.country || null,
      },
      connected_at: existingConnection ? undefined : now,
      last_verified_at: now,
      updated_at: now,
    };

    let connectionId = existingConnection?.id || "";

    if (existingConnection) {
      const { data: updatedConnection, error: updateError } = await admin
        .from("publishing_connections")
        .update(connectionPayload)
        .eq("id", existingConnection.id)
        .eq("user_id", userId)
        .select("id")
        .single();

      if (updateError || !updatedConnection) {
        throw new Error(
          `Could not update YouTube connection: ${updateError?.message || "Unknown error"}`
        );
      }

      connectionId = updatedConnection.id;
    } else {
      const { data: insertedConnection, error: insertError } = await admin
        .from("publishing_connections")
        .insert({
          ...connectionPayload,
          connected_at: now,
        })
        .select("id")
        .single();

      if (insertError || !insertedConnection) {
        throw new Error(
          `Could not save YouTube connection: ${insertError?.message || "Unknown error"}`
        );
      }

      connectionId = insertedConnection.id;
    }

    const { data: existingCredential, error: existingCredentialError } =
      await admin
        .from("publishing_oauth_credentials")
        .select("refresh_token")
        .eq("connection_id", connectionId)
        .maybeSingle();

    if (existingCredentialError) {
      throw new Error(
        `Could not check existing YouTube credentials: ${existingCredentialError.message}`
      );
    }

    const refreshToken =
      tokenData.refresh_token || existingCredential?.refresh_token || null;

    if (!refreshToken) {
      await admin
        .from("publishing_connections")
        .update({ status: "needs_reauth", updated_at: now })
        .eq("id", connectionId);

      return redirectResult("error", "refresh_token", returnTo, returnOrigin);
    }

    const expiresAt = Number.isFinite(tokenData.expires_in)
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : null;

    const { error: credentialError } = await admin
      .from("publishing_oauth_credentials")
      .upsert(
        {
          connection_id: connectionId,
          user_id: userId,
          channel_id: universeChannelId,
          platform: "youtube",
          access_token: tokenData.access_token,
          refresh_token: refreshToken,
          token_type: tokenData.token_type || "Bearer",
          scope: tokenData.scope || scopes.join(" "),
          expires_at: expiresAt,
          updated_at: now,
        },
        {
          onConflict: "connection_id",
        }
      );

    if (credentialError) {
      await admin
        .from("publishing_connections")
        .update({ status: "error", updated_at: now })
        .eq("id", connectionId);

      throw new Error(`Could not save YouTube OAuth credentials: ${credentialError.message}`);
    }

    return redirectResult("connected", undefined, returnTo, returnOrigin);
  } catch (error) {
    console.error("YouTube OAuth callback error:", error);
    return redirectResult("error", "unexpected");
  }
}
