import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  createOAuthHandoff,
  verifyOAuthHandoff,
} from "@/utils/publishing/oauth-handoff";
import {
  bufferAuthorityOrigin,
  bufferReturnPath,
  createBufferState,
  BUFFER_CALLBACK_PATH,
} from "@/utils/buffer-oauth-state";

export const runtime = "nodejs";

const STATE_COOKIE = "sz_buffer_oauth_state";
const VERIFIER_COOKIE = "sz_buffer_oauth_verifier";
const CHANNEL_COOKIE = "sz_buffer_oauth_channel";
const MAX_AGE = 10 * 60;

const SCOPES = [
  "posts:write",
  "posts:read",
  "ideas:read",
  "ideas:write",
  "account:read",
  "account:write",
  "offline_access",
];

const b64 = (value: Buffer) => value.toString("base64url");

async function channelBelongsToUser(userId: string, channelId: string) {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("channels")
    .select("id,workspace_id,workspaces!inner(owner_user_id)")
    .eq("id", channelId)
    .eq("workspaces.owner_user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not verify Universe channel: ${error.message}`);
  }

  return Boolean(data);
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const requestOrigin = requestUrl.origin;
    const authorityOrigin = bufferAuthorityOrigin();
    const handoffToken =
      requestUrl.searchParams.get("handoff")?.trim() || "";

    let userId = "";
    let channelId = "";
    let returnOrigin = requestOrigin;
    let returnTo = "";

    if (handoffToken) {
      if (requestOrigin !== authorityOrigin) {
        throw new Error(
          "Buffer OAuth handoff was received by a non-authority origin."
        );
      }

      const handoff = verifyOAuthHandoff(handoffToken);

      if (!handoff) {
        throw new Error("Buffer OAuth handoff is invalid or expired.");
      }

      if (
        !(await channelBelongsToUser(
          handoff.userId,
          handoff.channelId
        ))
      ) {
        throw new Error("The selected channel is not available.");
      }

      userId = handoff.userId;
      channelId = handoff.channelId;
      returnOrigin = handoff.returnOrigin;
      returnTo = bufferReturnPath(
        handoff.returnTo,
        returnOrigin,
        channelId
      );
    } else {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json(
          { error: "You must be signed in." },
          { status: 401 }
        );
      }

      channelId =
        requestUrl.searchParams.get("channelId")?.trim() || "";

      if (!channelId) {
        return NextResponse.json(
          { error: "channelId is required." },
          { status: 400 }
        );
      }

      const { data: channel } = await supabase
        .from("channels")
        .select("id,workspace_id,workspaces!inner(owner_user_id)")
        .eq("id", channelId)
        .eq("workspaces.owner_user_id", user.id)
        .maybeSingle();

      if (!channel) {
        return NextResponse.json(
          { error: "The selected channel is not available." },
          { status: 403 }
        );
      }

      userId = user.id;
      returnTo = bufferReturnPath(
        requestUrl.searchParams.get("returnTo"),
        requestOrigin,
        channelId
      );

      if (requestOrigin !== authorityOrigin) {
        const handoff = createOAuthHandoff({
          userId,
          channelId,
          returnOrigin: requestOrigin,
          returnTo,
        });

        const authorityUrl = new URL(
          "/api/publishing/buffer/connect",
          authorityOrigin
        );
        authorityUrl.searchParams.set("handoff", handoff);

        return NextResponse.redirect(authorityUrl);
      }
    }

    const clientId = String(
      process.env.BUFFER_CLIENT_ID || ""
    ).trim();

    if (!clientId) {
      throw new Error("BUFFER_CLIENT_ID is not configured.");
    }

    const redirectUri = authorityOrigin + BUFFER_CALLBACK_PATH;
    const state = createBufferState(
      returnOrigin,
      returnTo,
      channelId,
      userId
    );

    const verifier = b64(randomBytes(64));
    const challenge = b64(
      createHash("sha256").update(verifier).digest()
    );

    const url = new URL("https:" + "//auth.buffer.com/auth");

    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "consent");

    const response = NextResponse.redirect(url);

    const cookieOptions = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: true,
      path: "/",
      maxAge: MAX_AGE,
    };

    response.cookies.set(STATE_COOKIE, state, cookieOptions);
    response.cookies.set(
      VERIFIER_COOKIE,
      verifier,
      cookieOptions
    );
    response.cookies.set(
      CHANNEL_COOKIE,
      channelId,
      cookieOptions
    );

    return response;
  } catch (error) {
    console.error("Buffer OAuth connect error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not start Buffer OAuth.",
      },
      { status: 500 }
    );
  }
}
