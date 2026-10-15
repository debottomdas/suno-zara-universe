import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { assertBufferBudget, bufferGraphqlDetailed, getBufferRateLimit } from "@/utils/buffer-api";
import { bufferAccessToken } from "@/utils/buffer-oauth";
import { cleanString } from "@/utils/media-source";

const MAX_ALIASES = 30;

export async function POST(request: Request) {
  let accessToken: string | undefined;
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = cleanString(body.projectId);
    const raw = Array.isArray(body.postIds) ? body.postIds : [];
    const postIds = Array.from(new Set(raw.map(cleanString).filter(Boolean))).slice(0, 60);
    if (!projectId) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    if (!postIds.length) return NextResponse.json({ posts: [], rateLimit: getBufferRateLimit(accessToken), apiRequestsUsed: 0 });

    const { data: song } = await supabase.from("songs").select("id,channel_id").eq("id", projectId).eq("user_id", user.id).single();
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const { data: bindings, error: bindingsError } = await supabase
      .from("buffer_channel_bindings")
      .select("buffer_account_id")
      .eq("user_id", user.id)
      .eq("channel_id", song.channel_id);
    if (bindingsError) throw new Error(`Could not resolve Buffer account: ${bindingsError.message}`);
    const accountIds = [...new Set((bindings || []).map((item: any) => item.buffer_account_id).filter(Boolean))];
    if (accountIds.length > 1) return NextResponse.json({ error: "This Universe channel is mapped to more than one Buffer account. Reconnect the intended Buffer account." }, { status: 400 });
    accessToken = accountIds.length === 1 ? await bufferAccessToken(String(accountIds[0]), user.id) : undefined;

    const posts: any[] = [];
    let apiRequestsUsed = 0;
    for (let start = 0; start < postIds.length; start += MAX_ALIASES) {
      assertBufferBudget(accessToken);
      const chunk = postIds.slice(start, start + MAX_ALIASES);
      const defs = chunk.map((_, index) => `$p${index}: PostInput!`).join(", ");
      const fields = chunk.map((_, index) => `p${index}: post(input: $p${index}) { id status dueAt sentAt externalLink error { message } }`).join("\n");
      const variables = Object.fromEntries(chunk.map((id, index) => [`p${index}`, { id }]));
      const result = await bufferGraphqlDetailed<Record<string, any>>(
        `query SunoZaraBufferPostStatuses(${defs}) { ${fields} }`,
        variables,
        accessToken
      );
      apiRequestsUsed += 1;
      chunk.forEach((id, index) => {
        const post = result.data[`p${index}`];
        posts.push(post || { id, status: "unknown", error: { message: "Buffer returned no status for this post." } });
      });
    }

    return NextResponse.json({ posts, rateLimit: getBufferRateLimit(accessToken), apiRequestsUsed });
  } catch (error) {
    const limited = error as { status?: number; retryAfter?: number };
    console.error("Buffer post-status error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh Buffer post status.", rateLimit: getBufferRateLimit(accessToken) }, { status: limited?.status === 429 ? 429 : 500, headers: limited?.status === 429 ? { "Retry-After": String(limited.retryAfter || 60) } : undefined });
  }
}
