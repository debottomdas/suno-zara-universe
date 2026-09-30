import { claimBufferMedia, recordBufferMedia } from "@/utils/buffer-media-ledger";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { assertBufferBudget, bufferGraphqlDetailed, getBufferRateLimit, type BufferService } from "@/utils/buffer-api";
import { cleanString } from "@/utils/media-source";
import { bufferAccessToken } from "@/utils/buffer-oauth";

const SERVICES = new Set<BufferService>(["tiktok", "instagram", "facebook"]);
const MODES = new Set(["draft", "queue", "schedule"]);
const MAX_ITEMS = 30;
const MAX_SCHEDULE_MS = 29 * 24 * 60 * 60 * 1000;

type BatchItem = {
  slot: number;
  channelId: string;
  service: BufferService;
  mediaUrl: string;
  publishMode: "draft" | "queue" | "schedule";
  dueAt?: string;
};

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function combineCaption(item: Record<string, unknown>, fallback: Record<string, unknown>) {
  const pieces = [cleanString(item.caption), cleanString(item.fullSongCta), cleanString(item.engagementPrompt || item.commentPrompt)];
  const tags = strings(item.hashtags).length ? strings(item.hashtags) : strings(fallback.hashtags);
  const hash = tags.map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/^#+/, "")}`)).join(" ");
  if (hash) pieces.push(hash);
  return pieces.filter(Boolean).join("\n\n").trim();
}

function parseItem(value: unknown): BatchItem | null {
  const row = asRecord(value);
  const slot = Number(row.slot);
  const channelId = cleanString(row.channelId);
  const service = cleanString(row.service).toLowerCase() as BufferService;
  const mediaUrl = cleanString(row.mediaUrl);
  const publishMode = cleanString(row.publishMode || "draft").toLowerCase() as BatchItem["publishMode"];
  const dueAt = cleanString(row.dueAt);
  if (!Number.isInteger(slot) || slot < 1 || slot > 6 || !channelId || !SERVICES.has(service) || !mediaUrl || !MODES.has(publishMode)) return null;
  if (publishMode === "schedule") {
    const time = Date.parse(dueAt);
    if (!dueAt || !Number.isFinite(time) || time <= Date.now() + 60_000 || time > Date.now() + MAX_SCHEDULE_MS) return null;
  }
  return { slot, channelId, service, mediaUrl, publishMode, dueAt: dueAt || undefined };
}

export async function POST(request: Request) {
  let accessToken: string | undefined;
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = cleanString(body.projectId);
    const rawItems = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    const items = rawItems.map(parseItem);
    if (!projectId || !rawItems.length || items.some((item: ReturnType<typeof parseItem>) => !item)) {
      return NextResponse.json({ error: "A valid projectId and up to 30 valid Buffer post items are required." }, { status: 400 });
    }
    const validItems = items as BatchItem[];
    if (new Set(validItems.map(item => `${item.channelId}:${item.slot}`)).size !== validItems.length) {
      return NextResponse.json({ error: "Each destination and Short slot must occur only once per batch." }, { status: 400 });
    }

    const { data: song, error: songError } = await supabase
      .from("songs")
      .select("id,title,channel_id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (songError || !song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const requestedBufferIds = [...new Set(validItems.map((item) => item.channelId))];
    const { data: bindings, error: bindingsError } = await supabase
      .from("buffer_channel_bindings")
      .select("buffer_channel_id,buffer_account_id")
      .eq("user_id", user.id)
      .eq("channel_id", song.channel_id)
      .in("buffer_channel_id", requestedBufferIds);
    if (bindingsError) throw new Error(`Could not verify Buffer destinations: ${bindingsError.message}`);
    const allowedBufferIds = new Set((bindings || []).map((item) => item.buffer_channel_id));
    const accountIds = [...new Set((bindings || []).map((item: any) => item.buffer_account_id).filter(Boolean))];
    if (accountIds.length > 1) return NextResponse.json({ error: "This batch spans more than one Buffer account. Select destinations from one Buffer account at a time." }, { status: 400 });
    accessToken = accountIds.length === 1 ? await bufferAccessToken(String(accountIds[0]), user.id) : undefined;
    const invalidDestination = requestedBufferIds.find((id) => !allowedBufferIds.has(id));
    if (invalidDestination) {
      return NextResponse.json(
        { error: "A selected Buffer destination does not belong to this Universe channel. Publishing blocked." },
        { status: 403 }
      );
    }

    const { data: packRow, error: packError } = await supabase
      .from("social_media_packs")
      .select("facebook,instagram,tiktok")
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (packError) throw new Error(`Could not load social pack: ${packError.message}`);

    const variables: Record<string, unknown> = {};
    const variableDefs: string[] = [];
    const fields: string[] = [];
    const prepared = validItems.map((item, index) => {
      const pack = asRecord((packRow as any)?.[item.service]);
      const list = item.service === "tiktok" ? (Array.isArray(pack.posts) ? pack.posts : []) : (Array.isArray(pack.reels) ? pack.reels : []);
      const packItem = asRecord(list[item.slot - 1]);
      const text = combineCaption(packItem, pack) || `${song.title || "Suno Zara Original"}\n\nSuno Zara Original`;
      const metadata: Record<string, unknown> = {};
      if (item.service === "instagram") metadata.instagram = { type: "reel", shouldShareToFeed: true, isAiGenerated: true };
      if (item.service === "facebook") metadata.facebook = { type: "reel" };
      if (item.service === "tiktok") metadata.tiktok = { isAiGenerated: true };

      const input: Record<string, unknown> = {
        text,
        channelId: item.channelId,
        schedulingType: "automatic",
        mode: item.publishMode === "schedule" ? "customScheduled" : "addToQueue",
        saveToDraft: item.publishMode === "draft",
        aiAssisted: true,
        assets: [{ video: { url: item.mediaUrl, metadata: { thumbnailOffset: 1000 } } }],
        metadata,
      };
      if (item.publishMode === "schedule" && item.dueAt) input.dueAt = new Date(item.dueAt).toISOString();

      const variableName = `input${index}`;
      const alias = `p${index}`;
      variableDefs.push(`$${variableName}: CreatePostInput!`);
      fields.push(`${alias}: createPost(input: $${variableName}) { ... on PostActionSuccess { post { id text dueAt status externalLink } } ... on MutationError { message } }`);
      variables[variableName] = input;
      return { ...item, text, alias };
    });

    assertBufferBudget(accessToken);
    await claimBufferMedia(user.id, projectId, validItems, accountIds.length === 1 ? String(accountIds[0]) : null);
    const response = await bufferGraphqlDetailed<Record<string, { post?: any; message?: string }>>(
      `mutation CreateSunoZaraBufferPosts(${variableDefs.join(", ")}) { ${fields.join("\n")} }`,
      variables,
      accessToken
    );

    const results = prepared.map((item) => {
      const result = response.data[item.alias];
      if (!result?.post?.id) {
        return { slot: item.slot, channelId: item.channelId, service: item.service, publishMode: item.publishMode, dueAt: item.dueAt || null, text: item.text, error: result?.message || "Buffer did not create the post." };
      }
      return { slot: item.slot, channelId: item.channelId, service: item.service, publishMode: item.publishMode, dueAt: result.post.dueAt || item.dueAt || null, text: item.text, post: result.post };
    });

    await recordBufferMedia(user.id, projectId, validItems, results);
    return NextResponse.json({ results, rateLimit: getBufferRateLimit(accessToken), apiRequestsUsed: 1 });
  } catch (error) {
    const limited = error as { status?: number; retryAfter?: number };
    console.error("Buffer create-posts-batch error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create Buffer posts.", rateLimit: getBufferRateLimit(accessToken) }, { status: limited?.status === 429 ? 429 : 500, headers: limited?.status === 429 ? { "Retry-After": String(limited.retryAfter || 60) } : undefined });
  }
}
