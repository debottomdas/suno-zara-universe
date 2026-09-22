import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { bufferGraphql, type BufferService } from "@/utils/buffer-api";
import { cleanString } from "@/utils/media-source";

const SERVICES = new Set<BufferService>(["tiktok", "instagram", "facebook"]);
const MODES = new Set(["draft", "queue", "schedule"]);
const MAX_SCHEDULE_MS = 29 * 24 * 60 * 60 * 1000;

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

async function ownedSong(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase.from("songs").select("id,title").eq("id", projectId).eq("user_id", userId).single();
  return error ? null : data;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = cleanString(body.projectId);
    const channelId = cleanString(body.channelId);
    const service = cleanString(body.service).toLowerCase() as BufferService;
    const mediaUrl = cleanString(body.mediaUrl);
    const slot = Number(body.slot);
    const publishMode = cleanString(body.publishMode || "draft").toLowerCase();
    const dueAtRaw = cleanString(body.dueAt);

    if (!projectId || !channelId || !SERVICES.has(service) || !mediaUrl || !Number.isInteger(slot) || slot < 1 || slot > 6) {
      return NextResponse.json({ error: "projectId, Buffer channel, service, media URL and Short slot 1–6 are required." }, { status: 400 });
    }
    if (!MODES.has(publishMode)) {
      return NextResponse.json({ error: "Buffer publish mode must be draft, queue or schedule." }, { status: 400 });
    }

    let dueAt: string | undefined;
    if (publishMode === "schedule") {
      const date = new Date(dueAtRaw);
      const time = date.getTime();
      if (!dueAtRaw || !Number.isFinite(time) || time <= Date.now() + 60_000) {
        return NextResponse.json({ error: "Choose a future schedule time." }, { status: 400 });
      }
      if (time > Date.now() + MAX_SCHEDULE_MS) {
        return NextResponse.json({ error: "For temporary Buffer media, schedule within the next 29 days." }, { status: 400 });
      }
      dueAt = date.toISOString();
    }

    const song = await ownedSong(supabase, user.id, projectId);
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const { data: packRow, error: packError } = await supabase
      .from("social_media_packs")
      .select("facebook,instagram,tiktok")
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (packError) throw new Error(`Could not load social pack: ${packError.message}`);

    const pack = asRecord((packRow as any)?.[service]);
    const list = service === "tiktok" ? (Array.isArray(pack.posts) ? pack.posts : []) : (Array.isArray(pack.reels) ? pack.reels : []);
    const item = asRecord(list[slot - 1]);
    const text = combineCaption(item, pack) || `${song.title || "Suno Zara Original"}\n\nSuno Zara Original`;

    const metadata: Record<string, unknown> = {};
    if (service === "instagram") metadata.instagram = { type: "reel", shouldShareToFeed: true, isAiGenerated: true };
    if (service === "facebook") metadata.facebook = { type: "reel" };
    if (service === "tiktok") metadata.tiktok = { isAiGenerated: true };

    const input: Record<string, unknown> = {
      text,
      channelId,
      schedulingType: "automatic",
      mode: publishMode === "schedule" ? "customScheduled" : "addToQueue",
      saveToDraft: publishMode === "draft",
      aiAssisted: true,
      assets: [{ video: { url: mediaUrl, metadata: { thumbnailOffset: 1000 } } }],
      metadata,
    };
    if (dueAt) input.dueAt = dueAt;

    const data = await bufferGraphql<{
      createPost: {
        post?: { id: string; text: string; dueAt?: string | null; status?: string; externalLink?: string | null };
        message?: string;
      };
    }>(
      `mutation CreateSunoZaraBufferPost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess { post { id text dueAt status externalLink } }
          ... on MutationError { message }
        }
      }`,
      { input }
    );

    const result = data.createPost;
    if (!result?.post?.id) throw new Error(result?.message || "Buffer did not create the post.");

    return NextResponse.json({
      post: result.post,
      service,
      channelId,
      slot,
      text,
      publishMode,
      dueAt: result.post.dueAt || dueAt || null,
    });
  } catch (error) {
    console.error("Buffer create-post error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create Buffer post." }, { status: 500 });
  }
}
