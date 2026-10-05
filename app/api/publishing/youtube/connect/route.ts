import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  createOAuthHandoff,
  verifyOAuthHandoff,
} from "@/utils/publishing/oauth-handoff";

export const runtime = "nodejs";

const STATE_COOKIE = "sz_youtube_oauth_state";
const VERIFIER_COOKIE = "sz_youtube_oauth_verifier";
const CHANNEL_COOKIE = "sz_youtube_oauth_channel";
const RETURN_TO_COOKIE = "sz_youtube_oauth_return_to";
const CONTEXT_COOKIE = "sz_youtube_oauth_context";
const COOKIE_MAX_AGE = 10 * 60;

const OAUTH_AUTHORITY_ORIGIN =
  process.env.YOUTUBE_OAUTH_AUTHORITY_ORIGIN ||
  "https://suno-zara-universe.vercel.app";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
];

function base64Url(buffer: Buffer) {
  return buffer.toString("base64url");
}

function safeReturnTo(value: string, channelId: string) {
  return value.startsWith("/") && !value.startsWith("//")
    ? value
    : `/music-next?channelId=${encodeURIComponent(channelId)}`;
}

function isAuthorityOrigin(origin: string) {
  return origin === new URL(OAUTH_AUTHORITY_ORIGIN).origin;
}

async function channelBelongsToUser(userId: string, channelId: string) {
  const admin = createAdminClient();

  const { data: channel, error } = await admin
    .from("channels")
    .select("id, workspace_id, workspaces!inner(owner_user_id)")
    .eq("id", channelId)
    .eq("workspaces.owner_user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not verify Universe channel: ${error.message}`);
  }

  return Boolean(channel);
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const requestOrigin = requestUrl.origin;
    const handoffToken = requestUrl.searchParams.get("handoff")?.trim() || "";

    let userId = "";
    let channelId = "";
    let returnTo = "";
    let returnOrigin = requestOrigin;
    let oauthContext = "";

    /*
     * Hosted authority path.
     *
     * Localhost signs a short-lived handoff after authenticating the local
     * Supabase session. Vercel verifies that handoff and independently checks
     * channel ownership using the server-side admin client.
     */
    if (handoffToken) {
      if (!isAuthorityOrigin(requestOrigin)) {
        throw new Error("YouTube OAuth handoff was received by a non-authority origin.");
      }

      const handoff = verifyOAuthHandoff(handoffToken);

      if (!handoff) {
        throw new Error("YouTube OAuth handoff is invalid or expired.");
      }

      const ownsChannel = await channelBelongsToUser(
        handoff.userId,
        handoff.channelId
      );

      if (!ownsChannel) {
        throw new Error("The selected Universe channel is not available.");
      }

      userId = handoff.userId;
      channelId = handoff.channelId;
      returnTo = handoff.returnTo;
      returnOrigin = handoff.returnOrigin;

      /*
       * Transform the incoming handoff into a fresh authority-owned signed
       * context. The callback can therefore finish OAuth on Vercel without
       * depending on localhost's Supabase cookies.
       */
      oauthContext = createOAuthHandoff({
        userId,
        channelId,
        returnOrigin,
        returnTo,
      }, COOKIE_MAX_AGE * 1000);
    } else {
      /*
       * Normal initiating path. Authenticate using whichever application
       * instance the user is currently using.
       */
      const supabase = await createClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        return NextResponse.redirect(new URL("/login", requestOrigin));
      }

      channelId = requestUrl.searchParams.get("channelId")?.trim() || "";

      if (!channelId) {
        throw new Error(
          "A Universe channel is required before connecting YouTube."
        );
      }

      returnTo = safeReturnTo(
        requestUrl.searchParams.get("returnTo")?.trim() || "",
        channelId
      );

      const { data: channel } = await supabase
        .from("channels")
        .select("id, workspace_id, workspaces!inner(owner_user_id)")
        .eq("id", channelId)
        .eq("workspaces.owner_user_id", user.id)
        .maybeSingle();

      if (!channel) {
        throw new Error("The selected Universe channel is not available.");
      }

      userId = user.id;

      /*
       * If OAuth starts from localhost (or any future non-authority frontend),
       * hand it to the stable Vercel authority. The initiating origin is
       * captured dynamically, so localhost:3000/3001/3002/etc. require no
       * Google OAuth configuration.
       */
      if (!isAuthorityOrigin(requestOrigin)) {
        const handoff = createOAuthHandoff({
          userId,
          channelId,
          returnOrigin: requestOrigin,
          returnTo,
        });

        const authorityUrl = new URL(
          "/api/publishing/youtube/connect",
          OAUTH_AUTHORITY_ORIGIN
        );
        authorityUrl.searchParams.set("handoff", handoff);

        return NextResponse.redirect(authorityUrl);
      }

      /*
       * OAuth was started directly on Vercel. Create the same signed context
       * so callback handling is identical for local and hosted frontends.
       */
      oauthContext = createOAuthHandoff({
        userId,
        channelId,
        returnOrigin: requestOrigin,
        returnTo,
      }, COOKIE_MAX_AGE * 1000);
    }

    const clientId = process.env.GOOGLE_YOUTUBE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_YOUTUBE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      throw new Error(
        "Google YouTube OAuth environment variables are incomplete."
      );
    }

    /*
     * The OAuth authority must own Google's callback. This prevents an old
     * localhost redirect URI from silently reintroducing port coupling.
     */
    const redirectOrigin = new URL(redirectUri).origin;

    if (!isAuthorityOrigin(redirectOrigin)) {
      throw new Error(
        "GOOGLE_YOUTUBE_REDIRECT_URI must use the hosted OAuth authority."
      );
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

    /*
     * These cookies are created by the Vercel authority, not localhost, so
     * Google returning to Vercel has the state and PKCE verifier available.
     */
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: true,
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    };

    response.cookies.set(STATE_COOKIE, state, cookieOptions);
    response.cookies.set(VERIFIER_COOKIE, codeVerifier, cookieOptions);
    response.cookies.set(CHANNEL_COOKIE, channelId, cookieOptions);
    response.cookies.set(RETURN_TO_COOKIE, returnTo, cookieOptions);
    response.cookies.set(CONTEXT_COOKIE, oauthContext, cookieOptions);

    return response;
  } catch (error) {
    console.error("YouTube OAuth connect error:", error);

    const requestOrigin = new URL(request.url).origin;
    const fallbackOrigin = isAuthorityOrigin(requestOrigin)
      ? OAUTH_AUTHORITY_ORIGIN
      : requestOrigin;

    const url = new URL("/music", fallbackOrigin);
    url.searchParams.set("workspace", "publish");
    url.searchParams.set("youtube", "error");
    url.searchParams.set("reason", "configuration");

    return NextResponse.redirect(url);
  }
}
