import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

const STATE_COOKIE = "sz_meta_oauth_state";

const DEFAULT_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
];

function graphVersion() {
  return process.env.META_GRAPH_VERSION || "v26.0";
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"));
    }

    const appId = process.env.META_APP_ID;
    const redirectUri = process.env.META_REDIRECT_URI;
    const configId = process.env.META_LOGIN_CONFIG_ID;

    if (!appId || !redirectUri) {
      const url = new URL("/music", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
      url.searchParams.set("workspace", "publish");
      url.searchParams.set("meta", "error");
      url.searchParams.set("reason", "configuration");
      return NextResponse.redirect(url);
    }

    const state = randomBytes(32).toString("base64url");
    const authUrl = new URL(`https://www.facebook.com/${graphVersion()}/dialog/oauth`);
    authUrl.searchParams.set("client_id", appId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("auth_type", "rerequest");

    if (configId) {
      authUrl.searchParams.set("config_id", configId);
      authUrl.searchParams.set("override_default_response_type", "true");
    } else {
      authUrl.searchParams.set("scope", DEFAULT_SCOPES.join(","));
    }

    const response = NextResponse.redirect(authUrl);
    response.cookies.set(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  } catch (error) {
    console.error("Meta OAuth connect error:", error);
    const url = new URL("/music", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");
    url.searchParams.set("workspace", "publish");
    url.searchParams.set("meta", "error");
    url.searchParams.set("reason", "unexpected");
    return NextResponse.redirect(url);
  }
}
