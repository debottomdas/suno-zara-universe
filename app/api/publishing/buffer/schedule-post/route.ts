import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { bufferGraphql } from "@/utils/buffer-api";
import { cleanString } from "@/utils/media-source";

const MAX_SCHEDULE_MS = 29 * 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = cleanString(body.projectId);
    const postId = cleanString(body.postId);
    const dueAtRaw = cleanString(body.dueAt);
    const dueAtMs = Date.parse(dueAtRaw);

    if (!projectId || !postId || !dueAtRaw) {
      return NextResponse.json({ error: "projectId, Buffer post ID and schedule time are required." }, { status: 400 });
    }
    if (!Number.isFinite(dueAtMs) || dueAtMs <= Date.now() + 120_000) {
      return NextResponse.json({ error: "Choose a Buffer time at least two minutes in the future." }, { status: 400 });
    }
    if (dueAtMs > Date.now() + MAX_SCHEDULE_MS) {
      return NextResponse.json({ error: "Schedule within the next 29 days while temporary Buffer media remains available." }, { status: 400 });
    }

    const { data: song } = await supabase
      .from("songs")
      .select("id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const data = await bufferGraphql<{
      editPost: {
        post?: { id: string; dueAt?: string | null; status?: string; externalLink?: string | null };
        message?: string;
      };
    }>(
      `mutation ScheduleExistingSunoZaraPost($input: EditPostInput!) {
        editPost(input: $input) {
          ... on PostActionSuccess { post { id dueAt status externalLink } }
          ... on MutationError { message }
        }
      }`,
      {
        input: {
          id: postId,
          mode: "customScheduled",
          dueAt: new Date(dueAtMs).toISOString(),
          saveToDraft: false,
        },
      }
    );

    const result = data.editPost;
    if (!result?.post?.id) throw new Error(result?.message || "Buffer did not schedule the existing post.");

    return NextResponse.json({
      ok: true,
      post: result.post,
    });
  } catch (error) {
    console.error("Buffer schedule-post error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not schedule Buffer post." },
      { status: 500 }
    );
  }
}
