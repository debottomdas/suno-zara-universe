import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
const STATE_COOKIE = "sz_buffer_oauth_state";
const VERIFIER_COOKIE = "sz_buffer_oauth_verifier";
const CHANNEL_COOKIE = "sz_buffer_oauth_channel";
const MAX_AGE = 10 * 60;
const SCOPES = ["posts:write","posts:read","ideas:read","ideas:write","account:read","account:write","offline_access"];
const b64 = (value: Buffer) => value.toString("base64url");

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const channelId = new URL(request.url).searchParams.get("channelId")?.trim() || "";
    if (!channelId) return NextResponse.json({ error: "channelId is required." }, { status: 400 });
    const { data: channel } = await supabase.from("channels").select("id,workspace_id,workspaces!inner(owner_user_id)").eq("id",channelId).eq("workspaces.owner_user_id",user.id).maybeSingle();
    if (!channel) return NextResponse.json({ error: "The selected channel is not available." }, { status: 403 });
    const clientId = String(process.env.BUFFER_CLIENT_ID || "").trim();
    const redirectUri = String(process.env.BUFFER_REDIRECT_URI || "https://suno-zara-universe.vercel.app/api/publishing/buffer/callback").trim();
    if (!clientId) throw new Error("BUFFER_CLIENT_ID is not configured.");
    const state = b64(randomBytes(32));
    const verifier = b64(randomBytes(64));
    const challenge = b64(createHash("sha256").update(verifier).digest());
    const url = new URL("https://auth.buffer.com/auth");
    url.searchParams.set("client_id",clientId); url.searchParams.set("redirect_uri",redirectUri); url.searchParams.set("response_type","code");
    url.searchParams.set("scope",SCOPES.join(" ")); url.searchParams.set("state",state); url.searchParams.set("code_challenge",challenge); url.searchParams.set("code_challenge_method","S256"); url.searchParams.set("prompt","consent");
    const response = NextResponse.redirect(url); const secure = process.env.NODE_ENV === "production";
    for (const [name,value] of [[STATE_COOKIE,state],[VERIFIER_COOKIE,verifier],[CHANNEL_COOKIE,channelId]] as const) response.cookies.set(name,value,{httpOnly:true,sameSite:"lax",secure,path:"/",maxAge:MAX_AGE});
    return response;
  } catch (error) { console.error("Buffer OAuth connect error:",error); return NextResponse.json({error:error instanceof Error?error.message:"Could not start Buffer OAuth."},{status:500}); }
}
