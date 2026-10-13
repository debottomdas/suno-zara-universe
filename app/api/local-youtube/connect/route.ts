import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";
import { localChannels } from "@/utils/local-first/store";
import { assertLocalYouTubeRequest } from "@/utils/local-youtube/security";
import { createLocalOAuthSession } from "@/utils/local-youtube/oauth-state";

export const runtime = "nodejs";

const GOOGLE_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";

const REDIRECT_URI =
  "http://localhost:3000/api/local-youtube/callback";

function randomString() {
  return randomBytes(32).toString("base64url");
}

export async function GET(request: NextRequest) {
  try {
    assertLocalYouTubeRequest(request);

    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");

    if (
      origin !== "http://localhost:3000" &&
      origin !== "http://127.0.0.1:3000" &&
      fetchSite !== "same-origin"
    ) {
      return NextResponse.json(
        { error: "Connection must start from the local application." },
        { status: 403 }
      );
    }

    const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID;
    const configuredRedirect =
      process.env.SZU_LOCAL_YOUTUBE_REDIRECT_URI;

    if (!clientId || configuredRedirect !== REDIRECT_URI) {
      return NextResponse.json(
        { error: "Local YouTube OAuth configuration is invalid." },
        { status: 500 }
      );
    }

    const universeChannelId =
      request.nextUrl.searchParams.get("channelId");

    if (!universeChannelId) {
      return NextResponse.json(
        { error: "Missing channelId." },
        { status: 400 }
      );
    }

    const { channels } = await localChannels();
    const channel = channels.find(
      (item) => item.id === universeChannelId
    );

    if (!channel) {
      return NextResponse.json(
        { error: "Channel not found in local workspace." },
        { status: 404 }
      );
    }

    const verifier = randomString();
    const state = await createLocalOAuthSession(
      universeChannelId,
      verifier
    );

    const challenge = createHash("sha256")
      .update(verifier)
      .digest("base64url");

    const url = new URL(GOOGLE_AUTHORIZE_URL);

    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", REDIRECT_URI);
    url.searchParams.set("response_type", "code");

    url.searchParams.set(
      "scope",
      [
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.upload",
      ].join(" ")
    );

    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    const response = NextResponse.redirect(url);

    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: false,
      path: "/api/local-youtube",
      maxAge: 600,
    };

    // The PKCE verifier and channel ID remain server-side.
    response.cookies.set("szu_yt_state", state, cookieOptions);

    return response;
  } catch {
    return NextResponse.json(
      { error: "Local YouTube connection could not start." },
      { status: 403 }
    );
  }
}
