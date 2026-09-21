import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

const STATE_COOKIE = "sz_tiktok_oauth_state";
const VERIFIER_COOKIE = "sz_tiktok_oauth_verifier";
const DEFAULT_REDIRECT_URI = "http://localhost:3000/api/publishing/tiktok/callback";
const SCOPES = ["user.info.basic", "video.publish"];

function appUrl() {
  const redirectUri = process.env.TIKTOK_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  return new URL("/music", new URL(redirectUri).origin);
}

function errorRedirect(reason: string) {
  const url = appUrl();
  url.searchParams.set("workspace", "publish");
  url.searchParams.set("tiktok", "error");
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(
        new URL("/login", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
      );
    }

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI || DEFAULT_REDIRECT_URI;
    if (!clientKey || !redirectUri) {
      return errorRedirect("configuration");
    }

    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url").slice(0, 96);
    // TikTok Desktop Login Kit documents S256 as a hex-encoded SHA-256 challenge.
    const challenge = createHash("sha256").update(verifier).digest("hex");

    const authUrl = new URL("https://www.tiktok.com/v2/auth/authorize/");
    authUrl.searchParams.set("client_key", clientKey);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPES.join(","));
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    const response = NextResponse.redirect(authUrl);
    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    };
    response.cookies.set(STATE_COOKIE, state, cookieOptions);
    response.cookies.set(VERIFIER_COOKIE, verifier, cookieOptions);
    return response;
  } catch (error) {
    console.error("TikTok OAuth connect error:", error);
    return errorRedirect("unexpected");
  }
}
