import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { assertBufferBudget, bufferGraphqlDetailed, getBufferRateLimit } from "@/utils/buffer-api";
import { cleanString } from "@/utils/media-source";

const MAX_ITEMS = 30;
const MAX_SCHEDULE_MS = 29 * 24 * 60 * 60 * 1000;

type ScheduleItem = { postId: string; dueAt: string; itemKey?: string };

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseItem(value: unknown): ScheduleItem | null {
  const row = asRecord(value);
  const postId = cleanString(row.postId);
  const dueAt = cleanString(row.dueAt);
  const itemKey = cleanString(row.itemKey);
  const time = Date.parse(dueAt);
  if (!postId || !dueAt || !Number.isFinite(time) || time <= Date.now() + 120_000 || time > Date.now() + MAX_SCHEDULE_MS) return null;
  return { postId, dueAt: new Date(time).toISOString(), itemKey: itemKey || undefined };
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = cleanString(body.projectId);
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    const items = rawItems.map(parseItem);
    if (!projectId || !rawItems.length || items.some((item: ReturnType<typeof parseItem>) => !item)) {
      return NextResponse.json({ error: "A valid projectId and up to 30 valid scheduling items are required." }, { status: 400 });
    }

    const { data: song } = await supabase.from("songs").select("id").eq("id", projectId).eq("user_id", user.id).single();
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const validItems = items as ScheduleItem[];
    const variables: Record<string, unknown> = {};
    const variableDefs: string[] = [];
    const fields: string[] = [];
    validItems.forEach((item, index) => {
      const variableName = `input${index}`;
      const alias = `p${index}`;
      variableDefs.push(`$${variableName}: EditPostInput!`);
      fields.push(`${alias}: editPost(input: $${variableName}) { ... on PostActionSuccess { post { id dueAt status externalLink } } ... on MutationError { message } }`);
      variables[variableName] = { id: item.postId, mode: "customScheduled", dueAt: item.dueAt, saveToDraft: false };
    });

    assertBufferBudget();
    const response = await bufferGraphqlDetailed<Record<string, { post?: any; message?: string }>>(
      `mutation ScheduleSunoZaraBufferPosts(${variableDefs.join(", ")}) { ${fields.join("\n")} }`,
      variables
    );

    const results = validItems.map((item, index) => {
      const result = response.data[`p${index}`];
      return result?.post?.id
        ? { ...item, post: result.post }
        : { ...item, error: result?.message || "Buffer did not schedule the post." };
    });

    return NextResponse.json({ results, rateLimit: getBufferRateLimit(), apiRequestsUsed: 1 });
  } catch (error) {
    console.error("Buffer schedule-posts-batch error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not schedule Buffer posts.", rateLimit: getBufferRateLimit() }, { status: 500 });
  }
}
