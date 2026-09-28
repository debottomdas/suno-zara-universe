import { claimBufferSchedule } from "@/utils/buffer-media-ledger";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { assertBufferBudget, bufferGraphqlDetailed, getBufferRateLimit, type BufferService } from "@/utils/buffer-api";
import { bufferAccessToken } from "@/utils/buffer-oauth";
import { cleanString } from "@/utils/media-source";

const MAX_ITEMS = 30;
const MAX_SCHEDULE_MS = 29 * 24 * 60 * 60 * 1000;
const SERVICES = new Set<BufferService>(["tiktok", "instagram", "facebook"]);

type ScheduleItem = { postId: string; dueAt: string; itemKey?: string; slot: number; channelId: string; service: BufferService; mediaUrl: string };

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}
function combineCaption(item: Record<string, unknown>, fallback: Record<string, unknown>) {
  const pieces = [cleanString(item.caption), cleanString(item.fullSongCta), cleanString(item.engagementPrompt || item.commentPrompt)];
  const tags = strings(item.hashtags).length ? strings(item.hashtags) : strings(fallback.hashtags);
  const hash = tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/^#+/, "")}`)).join(" ");
  if (hash) pieces.push(hash);
  return pieces.filter(Boolean).join("\n\n").trim();
}
function parseItem(value: unknown): ScheduleItem | null {
  const row = asRecord(value);
  const postId = cleanString(row.postId);
  const dueAt = cleanString(row.dueAt);
  const itemKey = cleanString(row.itemKey);
  const slot = Number(row.slot);
  const channelId = cleanString(row.channelId);
  const service = cleanString(row.service).toLowerCase() as BufferService;
  const mediaUrl = cleanString(row.mediaUrl);
  const time = Date.parse(dueAt);
  if (!postId || !dueAt || !Number.isFinite(time) || time <= Date.now() + 120_000 || time > Date.now() + MAX_SCHEDULE_MS) return null;
  if (!Number.isInteger(slot) || slot < 1 || slot > 6 || !channelId || !SERVICES.has(service) || !mediaUrl) return null;
  return { postId, dueAt: new Date(time).toISOString(), itemKey: itemKey || undefined, slot, channelId, service, mediaUrl };
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
      return NextResponse.json({ error: "A valid projectId and up to 30 complete Buffer scheduling items are required." }, { status: 400 });
    }

    const { data: song } = await supabase.from("songs").select("id,title,channel_id").eq("id", projectId).eq("user_id", user.id).single();
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });
    const validItems = items as ScheduleItem[];

    const requestedBufferIds = [...new Set(validItems.map((item) => item.channelId))];
    const { data: bindings, error: bindingsError } = await supabase
      .from("buffer_channel_bindings")
      .select("buffer_channel_id,buffer_account_id")
      .eq("user_id", user.id)
      .eq("channel_id", song.channel_id)
      .in("buffer_channel_id", requestedBufferIds);
    if (bindingsError) throw new Error(`Could not verify Buffer destinations: ${bindingsError.message}`);
    const allowed = new Set((bindings || []).map((item: any) => item.buffer_channel_id));
    if (requestedBufferIds.some((id) => !allowed.has(id))) return NextResponse.json({ error: "A selected Buffer destination does not belong to this Universe channel." }, { status: 403 });
    const accountIds = [...new Set((bindings || []).map((item: any) => item.buffer_account_id).filter(Boolean))];
    if (accountIds.length > 1) return NextResponse.json({ error: "This batch spans more than one Buffer account." }, { status: 400 });
    const accessToken = accountIds.length === 1 ? await bufferAccessToken(String(accountIds[0]), user.id) : undefined;

    const { data: packRow, error: packError } = await supabase.from("social_media_packs").select("facebook,instagram,tiktok").eq("song_id", projectId).eq("user_id", user.id).maybeSingle();
    if (packError) throw new Error(`Could not load social pack: ${packError.message}`);

    const variables: Record<string, unknown> = {};
    const variableDefs: string[] = [];
    const fields: string[] = [];
    validItems.forEach((item, index) => {
      const pack = asRecord((packRow as any)?.[item.service]);
      const list = item.service === "tiktok" ? (Array.isArray(pack.posts) ? pack.posts : []) : (Array.isArray(pack.reels) ? pack.reels : []);
      const packItem = asRecord(list[item.slot - 1]);
      const text = combineCaption(packItem, pack) || `${song.title || "Suno Zara Original"}\n\nSuno Zara Original`;
      const metadata: Record<string, unknown> = {};
      if (item.service === "instagram") metadata.instagram = { type: "reel", shouldShareToFeed: true, isAiGenerated: true };
      if (item.service === "facebook") metadata.facebook = { type: "reel" };
      if (item.service === "tiktok") metadata.tiktok = { isAiGenerated: true };

      const variableName = `input${index}`;
      const alias = `p${index}`;
      variableDefs.push(`$${variableName}: EditPostInput!`);
      fields.push(`${alias}: editPost(input: $${variableName}) { ... on PostActionSuccess { post { id dueAt status externalLink } } ... on MutationError { message } }`);
      variables[variableName] = {
        id: item.postId,
        text,
        assets: [{ video: { url: item.mediaUrl, metadata: { thumbnailOffset: 1000 } } }],
        metadata,
        mode: "customScheduled",
        dueAt: item.dueAt,
        saveToDraft: false,
        aiAssisted: true,
      };
    });

    assertBufferBudget();
    const releaseMedia = await claimBufferSchedule(user.id, projectId, validItems, accountIds.length === 1 ? String(accountIds[0]) : null);
    const response = await bufferGraphqlDetailed<Record<string, { post?: any; message?: string }>>(
      `mutation ScheduleSunoZaraBufferPosts(${variableDefs.join(", ")}) { ${fields.join("\n")} }`,
      variables,
      accessToken
    );

    const results = validItems.map((item, index) => {
      const result = response.data[`p${index}`];
      return result?.post?.id ? { ...item, post: result.post } : { ...item, error: result?.message || "Buffer did not schedule the post." };
    });
    await releaseMedia();
    return NextResponse.json({ results, rateLimit: getBufferRateLimit(), apiRequestsUsed: 1 });
  } catch (error) {
    console.error("Buffer schedule-posts-batch error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not schedule Buffer posts.", rateLimit: getBufferRateLimit() }, { status: 500 });
  }
}
