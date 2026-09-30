import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

const STATE_COOKIE = "sz_youtube_oauth_state";
const VERIFIER_COOKIE = "sz_youtube_oauth_verifier";
const CHANNEL_COOKIE = "sz_youtube_oauth_channel";
const RETURN_TO_COOKIE = "sz_youtube_oauth_return_to";
const COOKIE_MAX_AGE = 10 * 60;

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
];

function base64Url(buffer: Buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(
        new URL("/login", process.env.GOOGLE_YOUTUBE_REDIRECT_URI || "http://localhost:3000")
      );
    }

    const requestUrl = new URL(request.url);
    const channelId = requestUrl.searchParams.get("channelId")?.trim() || "";
    const requestedReturnTo = requestUrl.searchParams.get("returnTo")?.trim() || "";

    if (!channelId) throw new Error("A Universe channel is required before connecting YouTube.");

    // Only permit an internal application path. Never store an external redirect.
    const returnTo =
      requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
        ? requestedReturnTo
        : `/music-next?channelId=${encodeURIComponent(channelId)}`;
    const { data: channel } = await supabase
      .from("channels")
      .select("id, workspace_id, workspaces!inner(owner_user_id)")
      .eq("id", channelId)
      .eq("workspaces.owner_user_id", user.id)
      .maybeSingle();
    if (!channel) throw new Error("The selected Universe channel is not available.");

    const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_YOUTUBE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new Error("Google YouTube OAuth environment variables are incomplete.");
    }

    const state = base64Url(randomBytes(32));
    const codeVerifier = base64Url(randomBytes(64));
    const codeChallenge = base64Url(
      createHash("sha256").update(codeVerifier).digest()
    );

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("include_granted_scopes", "true");
    authUrl.searchParams.set("prompt", "consent select_account");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    const response = NextResponse.redirect(authUrl);
    const secure = process.env.NODE_ENV === "production";

    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });

    response.cookies.set(VERIFIER_COOKIE, codeVerifier, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });

    response.cookies.set(CHANNEL_COOKIE, channelId, {
      httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: COOKIE_MAX_AGE,
    });

    response.cookies.set(RETURN_TO_COOKIE, returnTo, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });

    return response;
  } catch (error) {
    console.error("YouTube OAuth connect error:", error);

    const base = new URL(
      "/",
      process.env.GOOGLE_YOUTUBE_REDIRECT_URI || "http://localhost:3000"
    );
    base.searchParams.set("workspace", "publish");
    base.searchParams.set("youtube", "error");
    base.searchParams.set("reason", "configuration");

    return NextResponse.redirect(base);
  }
}
