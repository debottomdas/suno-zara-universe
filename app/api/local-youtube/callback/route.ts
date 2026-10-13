import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { localChannels } from "@/utils/local-first/store";
import {
  getLocalYouTubeCredential,
  saveLocalYouTubeCredential,
} from "@/utils/local-youtube/credentials";
import { assertLocalYouTubeRequest } from "@/utils/local-youtube/security";
import { takeLocalOAuthSession } from "@/utils/local-youtube/oauth-state";

export const runtime = "nodejs";

const REDIRECT_URI = "http://localhost:3000/api/local-youtube/callback";

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

type YouTubeChannelResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string };
  }>;
};

function matchesState(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function finish(status: string) {
  const url = new URL("http://localhost:3000/music-next");
  url.searchParams.set("localYouTube", status);

  const response = NextResponse.redirect(url);

  for (const name of [
    "szu_yt_state",
    "szu_yt_started",
    "szu_yt_verifier",
    "szu_yt_channel",
  ]) {
    response.cookies.set(name, "", {
      path: "/api/local-youtube",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });
  }

  return response;
}

export async function GET(request: NextRequest) {
  try {
    assertLocalYouTubeRequest(request);

    const params = request.nextUrl.searchParams;
    const code = params.get("code");
    const state = params.get("state");

     const cookieState = request.cookies.get("szu_yt_state")?.value;

    if (
      !code ||
      !state ||
      !cookieState ||
      !matchesState(state, cookieState)
    ) {
      return finish("invalid_state");
    }

    const session = await takeLocalOAuthSession(state);

    if (!session) {
      return finish("expired_or_replayed_state");
    }

    const {
      universeChannelId,
      verifier,
    } = session;

   const { channels } = await localChannels();

    if (!channels.some((channel) => channel.id === universeChannelId)) {
      return finish("unknown_channel");
    }

    const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_YOUTUBE_CLIENT_SECRET;

    if (
      !clientId ||
      !clientSecret ||
      process.env.SZU_LOCAL_YOUTUBE_REDIRECT_URI !== REDIRECT_URI
    ) {
      return finish("configuration_error");
    }

    const tokenResponse = await fetch(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: REDIRECT_URI,
        }),
        cache: "no-store",
      }
    );

    if (!tokenResponse.ok) return finish("token_error");

    const tokens =
      (await tokenResponse.json()) as GoogleTokenResponse;

    if (!tokens.access_token) return finish("token_error");

    const channelUrl = new URL(
      "https://www.googleapis.com/youtube/v3/channels"
    );

    channelUrl.searchParams.set("part", "id,snippet");
    channelUrl.searchParams.set("mine", "true");
    channelUrl.searchParams.set("maxResults", "50");

    const channelResponse = await fetch(channelUrl, {
      headers: {
        authorization: `Bearer ${tokens.access_token}`,
      },
      cache: "no-store",
    });

    if (!channelResponse.ok) return finish("channel_lookup_error");

    const channelData =
      (await channelResponse.json()) as YouTubeChannelResponse;

    const youtubeChannels = channelData.items || [];

    if (youtubeChannels.length !== 1) {
      return finish(
        youtubeChannels.length === 0
          ? "no_youtube_channel"
          : "multiple_youtube_channels"
      );
    }

    const youtubeChannel = youtubeChannels[0];

    if (!youtubeChannel.id) return finish("invalid_youtube_channel");

    const existing =
      await getLocalYouTubeCredential(universeChannelId);

    if (
      existing &&
      existing.youtubeChannelId !== youtubeChannel.id
    ) {
      return finish("channel_conflict");
    }

    const refreshToken =
      tokens.refresh_token || existing?.refreshToken;

    if (!refreshToken) return finish("missing_refresh_token");

    const now = new Date().toISOString();

    await saveLocalYouTubeCredential({
      universeChannelId,
      youtubeChannelId: youtubeChannel.id,
      youtubeChannelTitle: youtubeChannel.snippet?.title || "",
      accessToken: tokens.access_token,
      refreshToken,
      expiresAt: new Date(
        Date.now() + (tokens.expires_in || 3600) * 1000
      ).toISOString(),
      scope: tokens.scope || "",
      connectedAt: existing?.connectedAt || now,
    });

    return finish("connected");
  } catch (error) {
    console.error(
      "Local YouTube OAuth callback failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    return finish("unexpected_error");
  }
}
