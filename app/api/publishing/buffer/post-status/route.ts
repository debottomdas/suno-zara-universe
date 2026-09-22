import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { bufferGraphql } from "@/utils/buffer-api";
import { cleanString } from "@/utils/media-source";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const raw = Array.isArray(body.postIds) ? body.postIds : [];
    const postIds = Array.from(new Set(raw.map(cleanString).filter(Boolean))).slice(0, 60);
    if (!postIds.length) return NextResponse.json({ posts: [] });

    const posts = [];
    for (const id of postIds) {
      try {
        const data = await bufferGraphql<{
          post: {
            id: string;
            status: string;
            dueAt?: string | null;
            sentAt?: string | null;
            externalLink?: string | null;
            error?: { message?: string } | null;
          };
        }>(
          `query SunoZaraBufferPostStatus($input: PostInput!) {
            post(input: $input) { id status dueAt sentAt externalLink error { message } }
          }`,
          { input: { id } }
        );
        posts.push(data.post);
      } catch (postError) {
        posts.push({ id, status: "unknown", error: { message: postError instanceof Error ? postError.message : "Could not refresh Buffer post." } });
      }
    }

    return NextResponse.json({ posts });
  } catch (error) {
    console.error("Buffer post-status error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh Buffer post status." }, { status: 500 });
  }
}
