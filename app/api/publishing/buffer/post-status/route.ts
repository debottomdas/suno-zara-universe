import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { assertBufferBudget, bufferGraphqlDetailed, getBufferRateLimit } from "@/utils/buffer-api";
import { cleanString } from "@/utils/media-source";

const MAX_ALIASES = 30;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const raw = Array.isArray(body.postIds) ? body.postIds : [];
    const postIds = Array.from(new Set(raw.map(cleanString).filter(Boolean))).slice(0, 60);
    if (!postIds.length) return NextResponse.json({ posts: [], rateLimit: getBufferRateLimit(), apiRequestsUsed: 0 });

    const posts: any[] = [];
    let apiRequestsUsed = 0;

    for (let start = 0; start < postIds.length; start += MAX_ALIASES) {
      assertBufferBudget();
      const chunk = postIds.slice(start, start + MAX_ALIASES);
      const defs = chunk.map((_, index) => `$p${index}: PostInput!`).join(", ");
      const fields = chunk.map((_, index) => `p${index}: post(input: $p${index}) { id status dueAt sentAt externalLink error { message } }`).join("\n");
      const variables = Object.fromEntries(chunk.map((id, index) => [`p${index}`, { id }]));
      const result = await bufferGraphqlDetailed<Record<string, any>>(
        `query SunoZaraBufferPostStatuses(${defs}) { ${fields} }`,
        variables
      );
      apiRequestsUsed += 1;
      chunk.forEach((id, index) => {
        const post = result.data[`p${index}`];
        posts.push(post || { id, status: "unknown", error: { message: "Buffer returned no status for this post." } });
      });
    }

    return NextResponse.json({ posts, rateLimit: getBufferRateLimit(), apiRequestsUsed });
  } catch (error) {
    console.error("Buffer post-status error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh Buffer post status.", rateLimit: getBufferRateLimit() }, { status: 500 });
  }
}
