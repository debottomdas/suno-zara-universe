import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type Platform = "youtube" | "facebook" | "instagram" | "tiktok";
type JsonRecord = Record<string, unknown>;

type MediaAsset = {
  id: string;
  media_kind: string;
  slot: number;
  original_filename: string;
  mime_type: string | null;
  size_bytes: number | null;
};

type ConnectionRow = {
  id: string;
  platform: Platform;
  is_primary: boolean;
};

type ValidationIssue = {
  code: string;
  message: string;
  severity: "error" | "warning";
};

type JobDraft = {
  campaign_id: string;
  song_id: string;
  user_id: string;
  connection_id: string | null;
  media_asset_id: string | null;
  platform: Platform;
  content_type: string;
  item_key: string;
  title: string | null;
  caption: string | null;
  description: string | null;
  hashtags: string[];
  tags: string[];
  payload: JsonRecord;
  ready_to_publish: boolean;
  status: "draft";
  scheduled_for: null;
  schedule_timezone: null;
  external_post_id: null;
  external_url: null;
  error_message: null;
  validation_errors: ValidationIssue[];
  published_at: null;
  updated_at: string;
};

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanStringArray(value: unknown, maxItems = 50) {
  return asArray(value)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function positiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function issue(
  code: string,
  message: string,
  severity: "error" | "warning" = "error"
): ValidationIssue {
  return { code, message, severity };
}

function mediaKey(kind: string, slot: number) {
  return `${kind}:${slot}`;
}

function summarizeJobs(jobs: Array<Record<string, unknown>>) {
  const byPlatform: Record<Platform, number> = {
    youtube: 0,
    facebook: 0,
    instagram: 0,
    tiktok: 0,
  };

  let withMedia = 0;
  let issueCount = 0;
  let errorCount = 0;

  for (const job of jobs) {
    const platform = cleanString(job.platform) as Platform;
    if (platform in byPlatform) {
      byPlatform[platform] += 1;
    }

    if (cleanString(job.media_asset_id)) {
      withMedia += 1;
    }

    const issues = asArray(job.validation_errors);
    issueCount += issues.length;
    errorCount += issues.filter((entry) => {
      const item = asRecord(entry);
      return cleanString(item.severity) !== "warning";
    }).length;
  }

  return {
    total: jobs.length,
    withMedia,
    issueCount,
    errorCount,
    byPlatform,
  };
}

async function getOwnedSong(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string
) {
  const { data: song, error } = await supabase
    .from("songs")
    .select("id, title")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single();

  if (error || !song) return null;
  return song;
}

async function loadCampaign(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string
) {
  const { data: campaign, error: campaignError } = await supabase
    .from("publishing_campaigns")
    .select("id, song_id, user_id, name, status, created_at, updated_at")
    .eq("song_id", projectId)
    .eq("user_id", userId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campaignError) {
    throw new Error(`Could not load publishing campaign: ${campaignError.message}`);
  }

  if (!campaign) {
    return {
      campaign: null,
      jobs: [],
      summary: summarizeJobs([]),
    };
  }

  const { data: jobs, error: jobsError } = await supabase
    .from("publishing_jobs")
    .select(
      `
      id,
      campaign_id,
      song_id,
      connection_id,
      media_asset_id,
      platform,
      content_type,
      item_key,
      title,
      caption,
      description,
      hashtags,
      tags,
      payload,
      ready_to_publish,
      status,
      scheduled_for,
      schedule_timezone,
      external_post_id,
      external_url,
      error_message,
      validation_errors,
      published_at,
      created_at,
      updated_at
      `
    )
    .eq("campaign_id", campaign.id)
    .eq("user_id", userId);

  if (jobsError) {
    throw new Error(`Could not load publishing jobs: ${jobsError.message}`);
  }

  const orderedJobs = [...(jobs || [])].sort((a, b) => {
    const aOrder = Number(asRecord(a.payload).orderIndex || 0);
    const bOrder = Number(asRecord(b.payload).orderIndex || 0);
    return aOrder - bOrder;
  });

  return {
    campaign,
    jobs: orderedJobs,
    summary: summarizeJobs(orderedJobs),
  };
}


function hasBlockingErrors(value: unknown) {
  return asArray(value).some((entry) => {
    const item = asRecord(entry);
    return cleanString(item.severity) !== "warning";
  });
}

function expectedMediaForJob(job: JsonRecord) {
  const itemKey = cleanString(job.item_key);
  const platform = cleanString(job.platform) as Platform;
  const contentType = cleanString(job.content_type);

  if (platform === "youtube" && contentType === "full-video") {
    return { kind: "youtube-video", slot: 1, required: true };
  }

  if (platform === "instagram" && contentType === "feed-post") {
    return { kind: "cover-art", slot: 1, required: true };
  }

  const match = itemKey.match(/^(?:youtube-short|facebook-reel|instagram-reel|tiktok-post)-(\d+)$/);
  if (match) {
    return {
      kind: "vertical-video",
      slot: Math.max(1, Number.parseInt(match[1], 10) || 1),
      required: true,
    };
  }

  return { kind: "", slot: 0, required: false };
}

function mediaMissingLabel(job: JsonRecord, expected: { kind: string; slot: number }) {
  const platform = cleanString(job.platform);
  const itemKey = cleanString(job.item_key);

  if (itemKey === "youtube-full") {
    return "Full YouTube video is missing from Media Hub.";
  }
  if (itemKey === "instagram-feed-post") {
    return "Cover artwork is missing for the default Instagram feed post.";
  }

  const prettyPlatform = platform.charAt(0).toUpperCase() + platform.slice(1);
  return `${expected.kind === "vertical-video" ? "Vertical video" : "Media"} slot ${expected.slot} is missing for ${prettyPlatform}.`;
}

async function revalidateCampaign(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string
) {
  const { data: campaign, error: campaignError } = await supabase
    .from("publishing_campaigns")
    .select("id")
    .eq("song_id", projectId)
    .eq("user_id", userId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campaignError) {
    throw new Error(`Could not load publishing campaign: ${campaignError.message}`);
  }
  if (!campaign) return;

  const [jobsResult, mediaResult, connectionsResult] = await Promise.all([
    supabase
      .from("publishing_jobs")
      .select("id, platform, content_type, item_key, title, caption, description, payload, media_asset_id, connection_id, ready_to_publish, scheduled_for, validation_errors")
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId),
    supabase
      .from("song_media_assets")
      .select("id, media_kind, slot, original_filename, mime_type, size_bytes")
      .eq("song_id", projectId)
      .eq("user_id", userId),
    supabase
      .from("publishing_connections")
      .select("id, platform, is_primary")
      .eq("user_id", userId)
      .eq("status", "connected")
      .order("is_primary", { ascending: false }),
  ]);

  if (jobsResult.error) {
    throw new Error(`Could not load publishing jobs: ${jobsResult.error.message}`);
  }
  if (mediaResult.error) {
    throw new Error(`Could not load media assets: ${mediaResult.error.message}`);
  }
  if (connectionsResult.error) {
    throw new Error(`Could not load publishing connections: ${connectionsResult.error.message}`);
  }

  const mediaMap = new Map<string, MediaAsset>();
  for (const asset of (mediaResult.data || []) as MediaAsset[]) {
    mediaMap.set(mediaKey(asset.media_kind, asset.slot), asset);
  }

  const connections = new Map<Platform, ConnectionRow>();
  for (const row of (connectionsResult.data || []) as ConnectionRow[]) {
    if (!connections.has(row.platform) || row.is_primary) {
      connections.set(row.platform, row);
    }
  }

  const nowMs = Date.now();
  const updateRows = (jobsResult.data || []).map((rawJob) => {
    const job = asRecord(rawJob);
    const platform = cleanString(job.platform) as Platform;
    const title = cleanString(job.title);
    const caption = cleanString(job.caption);
    const description = cleanString(job.description);
    const expected = expectedMediaForJob(job);
    const asset = expected.required
      ? mediaMap.get(mediaKey(expected.kind, expected.slot)) || null
      : null;
    const connectionId = connections.get(platform)?.id || null;
    const issues: ValidationIssue[] = [];

    if (!connectionId) {
      issues.push(
        issue(
          "missing_connection",
          `${platform.charAt(0).toUpperCase() + platform.slice(1)} is not connected yet.`,
          "warning"
        )
      );
    }

    if (expected.required && !asset) {
      issues.push(issue("missing_media", mediaMissingLabel(job, expected)));
    }

    const payload = asRecord(job.payload);
    if (platform === "youtube" && cleanString(job.content_type) === "full-video") {
      const thumbnail = mediaMap.get(mediaKey("thumbnail", 1)) || null;
      if (!thumbnail) {
        issues.push(issue("missing_thumbnail", "YouTube thumbnail slot 1 is missing."));
      }
      payload.thumbnailAssetId = thumbnail?.id || null;
      payload.thumbnailFilename = thumbnail?.original_filename || null;
    }

    if (platform === "youtube" && !title) {
      issues.push(issue("missing_title", "YouTube title is missing."));
    }

    if (!title && !caption && !description) {
      issues.push(issue("missing_copy", "No publishable copy is saved for this item."));
    }

    const scheduledFor = cleanString(job.scheduled_for);
    if (scheduledFor) {
      const scheduleMs = Date.parse(scheduledFor);
      if (!Number.isFinite(scheduleMs) || scheduleMs <= nowMs) {
        issues.push(issue("invalid_schedule", "Scheduled time must be a valid future date and time."));
      }
    }

    const ready = Boolean(job.ready_to_publish) && !hasBlockingErrors(issues);

    if (asset) {
      payload.mediaKind = asset.media_kind;
      payload.mediaSlot = asset.slot;
      payload.mediaFilename = asset.original_filename;
    } else if (expected.required) {
      payload.mediaKind = expected.kind;
      payload.mediaSlot = expected.slot;
      payload.mediaFilename = null;
    }

    return {
      id: cleanString(job.id),
      connection_id: connectionId,
      media_asset_id: asset?.id || (expected.required ? null : cleanString(job.media_asset_id) || null),
      payload,
      ready_to_publish: ready,
      validation_errors: issues,
      updated_at: new Date().toISOString(),
    };
  });

  for (const row of updateRows) {
    const { id, ...changes } = row;
    const { error } = await supabase
      .from("publishing_jobs")
      .update(changes)
      .eq("id", id)
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Could not revalidate publishing job: ${error.message}`);
    }
  }

  const { error: campaignUpdateError } = await supabase
    .from("publishing_campaigns")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", campaign.id)
    .eq("user_id", userId);

  if (campaignUpdateError) {
    throw new Error(`Could not update campaign timestamp: ${campaignUpdateError.message}`);
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = cleanString(searchParams.get("projectId"));

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    const song = await getOwnedSong(supabase, user.id, projectId);
    if (!song) {
      return NextResponse.json({ error: "Song not found." }, { status: 404 });
    }

    return NextResponse.json({
      projectId,
      songTitle: song.title || "Untitled",
      ...(await loadCampaign(supabase, user.id, projectId)),
    });
  } catch (error) {
    console.error("Load publishing campaign error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not load publishing campaign.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const userId = user.id;

    const body = await request.json();
    const projectId = cleanString(body.projectId);

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    const song = await getOwnedSong(supabase, userId, projectId);
    if (!song) {
      return NextResponse.json({ error: "Song not found." }, { status: 404 });
    }

    const [{ data: packRow, error: packError }, { data: mediaRows, error: mediaError }, { data: connectionRows, error: connectionError }] =
      await Promise.all([
        supabase
          .from("social_media_packs")
          .select("youtube_full, youtube_shorts, facebook, instagram, tiktok, updated_at")
          .eq("song_id", projectId)
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("song_media_assets")
          .select("id, media_kind, slot, original_filename, mime_type, size_bytes")
          .eq("song_id", projectId)
          .eq("user_id", userId),
        supabase
          .from("publishing_connections")
          .select("id, platform, is_primary")
          .eq("user_id", userId)
          .eq("status", "connected")
          .order("is_primary", { ascending: false }),
      ]);

    if (packError) {
      throw new Error(`Could not load social media pack: ${packError.message}`);
    }
    if (mediaError) {
      throw new Error(`Could not load media assets: ${mediaError.message}`);
    }
    if (connectionError) {
      throw new Error(`Could not load publishing connections: ${connectionError.message}`);
    }

    const media = (mediaRows || []) as MediaAsset[];
    const mediaMap = new Map<string, MediaAsset>();
    for (const asset of media) {
      mediaMap.set(mediaKey(asset.media_kind, asset.slot), asset);
    }

    const connections = new Map<Platform, ConnectionRow>();
    for (const row of (connectionRows || []) as ConnectionRow[]) {
      if (!connections.has(row.platform) || row.is_primary) {
        connections.set(row.platform, row);
      }
    }

    const youtubeFull = asRecord(packRow?.youtube_full);
    const youtubeShorts = asRecord(packRow?.youtube_shorts);
    const facebook = asRecord(packRow?.facebook);
    const instagram = asRecord(packRow?.instagram);
    const tiktok = asRecord(packRow?.tiktok);

    const hasAnyPack =
      Object.keys(youtubeFull).length > 0 ||
      asArray(youtubeShorts.shorts).length > 0 ||
      Object.keys(facebook).length > 0 ||
      Object.keys(instagram).length > 0 ||
      Object.keys(tiktok).length > 0;

    if (!hasAnyPack) {
      return NextResponse.json(
        {
          error:
            "No saved Social Media Pack content was found for this song. Generate and save the social details first.",
        },
        { status: 400 }
      );
    }

    const campaignName = `${song.title || "Untitled"} — Release Campaign`;

    const { data: previousCampaigns, error: previousError } = await supabase
      .from("publishing_campaigns")
      .select("id")
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .in("status", ["draft", "ready"]);

    if (previousError) {
      throw new Error(`Could not check existing campaigns: ${previousError.message}`);
    }

    const now = new Date().toISOString();
    const { data: newCampaign, error: createError } = await supabase
      .from("publishing_campaigns")
      .insert({
        song_id: projectId,
        user_id: userId,
        name: campaignName,
        status: "draft",
        updated_at: now,
      })
      .select("id")
      .single();

    if (createError || !newCampaign) {
      throw new Error(
        `Could not create publishing campaign: ${createError?.message || "Unknown error"}`
      );
    }

    const campaignId = newCampaign.id;

    let orderIndex = 0;
    const jobs: JobDraft[] = [];

    function connectionFor(platform: Platform) {
      return connections.get(platform)?.id || null;
    }

    function baseIssues(platform: Platform) {
      const issues: ValidationIssue[] = [];
      if (!connectionFor(platform)) {
        issues.push(
          issue(
            "missing_connection",
            `${platform.charAt(0).toUpperCase() + platform.slice(1)} is not connected yet.`,
            "warning"
          )
        );
      }
      return issues;
    }

    function addJob(input: {
      platform: Platform;
      contentType: string;
      itemKey: string;
      title?: string;
      caption?: string;
      description?: string;
      hashtags?: string[];
      tags?: string[];
      media?: MediaAsset | null;
      mediaRequired?: boolean;
      mediaRequirementLabel?: string;
      payload?: JsonRecord;
      issues?: ValidationIssue[];
    }) {
      const issues = [...baseIssues(input.platform), ...(input.issues || [])];

      if (input.mediaRequired && !input.media) {
        issues.push(
          issue(
            "missing_media",
            input.mediaRequirementLabel || "Required media is missing."
          )
        );
      }

      const title = cleanString(input.title) || null;
      const caption = cleanString(input.caption) || null;
      const description = cleanString(input.description) || null;

      if (input.platform === "youtube" && !title) {
        issues.push(issue("missing_title", "YouTube title is missing."));
      }

      if (!title && !caption && !description) {
        issues.push(issue("missing_copy", "No publishable copy is saved for this item."));
      }

      orderIndex += 1;
      jobs.push({
        campaign_id: campaignId,
        song_id: projectId,
        user_id: userId,
        connection_id: connectionFor(input.platform),
        media_asset_id: input.media?.id || null,
        platform: input.platform,
        content_type: input.contentType,
        item_key: input.itemKey,
        title,
        caption,
        description,
        hashtags: input.hashtags || [],
        tags: input.tags || [],
        payload: {
          orderIndex,
          mediaKind: input.media?.media_kind || null,
          mediaSlot: input.media?.slot || null,
          mediaFilename: input.media?.original_filename || null,
          ...(input.payload || {}),
        },
        ready_to_publish: false,
        status: "draft",
        scheduled_for: null,
        schedule_timezone: null,
        external_post_id: null,
        external_url: null,
        error_message: null,
        validation_errors: issues,
        published_at: null,
        updated_at: now,
      });
    }

    if (Object.keys(youtubeFull).length > 0) {
      const video = mediaMap.get(mediaKey("youtube-video", 1)) || null;
      const thumbnail = mediaMap.get(mediaKey("thumbnail", 1)) || null;
      const ytIssues: ValidationIssue[] = [];

      if (!thumbnail) {
        ytIssues.push(issue("missing_thumbnail", "YouTube thumbnail slot 1 is missing."));
      }

      addJob({
        platform: "youtube",
        contentType: "full-video",
        itemKey: "youtube-full",
        title: cleanString(youtubeFull.recommendedTitle),
        description:
          cleanString(youtubeFull.finalDescription) ||
          cleanString(youtubeFull.fullDescription),
        hashtags: cleanStringArray(youtubeFull.hashtags, 30),
        tags: cleanStringArray(youtubeFull.tags, 50),
        media: video,
        mediaRequired: true,
        mediaRequirementLabel: "Full YouTube video is missing from Media Hub.",
        issues: ytIssues,
        payload: {
          thumbnailAssetId: thumbnail?.id || null,
          thumbnailFilename: thumbnail?.original_filename || null,
          playlistSuggestion: cleanString(youtubeFull.playlistSuggestion),
          pinnedComment: cleanString(youtubeFull.pinnedComment),
          alternativePinnedComment: cleanString(youtubeFull.alternativePinnedComment),
          communityPost: cleanString(youtubeFull.communityPost),
          informalCommunityPost: cleanString(youtubeFull.informalCommunityPost),
          releasePost: cleanString(youtubeFull.releasePost),
          releaseDetails: asRecord(youtubeFull.releaseDetails),
        },
      });
    }

    for (const [index, rawShort] of asArray(youtubeShorts.shorts).entries()) {
      const short = asRecord(rawShort);
      const number = positiveNumber(short.shortNumber, index + 1);
      const vertical = mediaMap.get(mediaKey("vertical-video", number)) || null;

      addJob({
        platform: "youtube",
        contentType: "short",
        itemKey: `youtube-short-${String(number).padStart(2, "0")}`,
        title: cleanString(short.title),
        description: cleanString(short.description),
        hashtags: cleanStringArray(short.hashtags, 15),
        tags: cleanStringArray(short.tags, 30),
        media: vertical,
        mediaRequired: true,
        mediaRequirementLabel: `Vertical video slot ${number} is missing for YouTube Short ${number}.`,
        payload: {
          shortNumber: number,
          creativeAngle: cleanString(short.creativeAngle),
          lyricMoment: cleanString(short.lyricMoment),
          openingHook: cleanString(short.openingHook),
          pinnedComment: cleanString(short.pinnedComment),
          fullSongCta: cleanString(short.fullSongCta),
          visualDirection: cleanString(short.visualDirection),
        },
      });
    }

    if (Object.keys(facebook).length > 0) {
      const fbHashtags = cleanStringArray(facebook.hashtags, 20);
      const fbCommonPayload = {
        engagementQuestions: cleanStringArray(facebook.engagementQuestions, 20),
        ctaOptions: cleanStringArray(facebook.ctaOptions, 20),
      };

      [
        ["facebook-main-post", "release-post", facebook.mainReleasePost],
        ["facebook-short-post", "short-post", facebook.shortReleasePost],
        ["facebook-emotional-post", "emotional-post", facebook.emotionalStoryPost],
      ].forEach(([itemKey, contentType, copy]) => {
        addJob({
          platform: "facebook",
          contentType: String(contentType),
          itemKey: String(itemKey),
          caption: cleanString(copy),
          hashtags: fbHashtags,
          payload: fbCommonPayload,
        });
      });

      for (const [index, rawReel] of asArray(facebook.reels).entries()) {
        const reel = asRecord(rawReel);
        const number = positiveNumber(reel.reelNumber, index + 1);
        const vertical = mediaMap.get(mediaKey("vertical-video", number)) || null;

        addJob({
          platform: "facebook",
          contentType: "reel",
          itemKey: `facebook-reel-${String(number).padStart(2, "0")}`,
          caption: cleanString(reel.caption),
          hashtags: cleanStringArray(reel.hashtags, 20),
          media: vertical,
          mediaRequired: true,
          mediaRequirementLabel: `Vertical video slot ${number} is missing for Facebook Reel ${number}.`,
          payload: {
            reelNumber: number,
            creativeAngle: cleanString(reel.creativeAngle),
            openingHook: cleanString(reel.openingHook),
            engagementPrompt: cleanString(reel.engagementPrompt),
            fullSongCta: cleanString(reel.fullSongCta),
          },
        });
      }
    }

    if (Object.keys(instagram).length > 0) {
      const cover = mediaMap.get(mediaKey("cover-art", 1)) || null;
      addJob({
        platform: "instagram",
        contentType: "feed-post",
        itemKey: "instagram-feed-post",
        caption: cleanString(instagram.feedCaption),
        hashtags: cleanStringArray(instagram.hashtags, 20),
        media: cover,
        mediaRequired: true,
        mediaRequirementLabel: "Cover artwork is missing for the default Instagram feed post.",
        payload: {
          shortCaption: cleanString(instagram.shortCaption),
          storyTextIdeas: cleanStringArray(instagram.storyTextIdeas, 20),
          ctaOptions: cleanStringArray(instagram.ctaOptions, 20),
          defaultMediaNote: "Cover artwork slot 1 is used as the initial feed-post media and can be changed before publishing.",
        },
      });

      for (const [index, rawReel] of asArray(instagram.reels).entries()) {
        const reel = asRecord(rawReel);
        const number = positiveNumber(reel.reelNumber, index + 1);
        const vertical = mediaMap.get(mediaKey("vertical-video", number)) || null;

        addJob({
          platform: "instagram",
          contentType: "reel",
          itemKey: `instagram-reel-${String(number).padStart(2, "0")}`,
          caption: cleanString(reel.caption),
          hashtags: cleanStringArray(reel.hashtags, 20),
          media: vertical,
          mediaRequired: true,
          mediaRequirementLabel: `Vertical video slot ${number} is missing for Instagram Reel ${number}.`,
          payload: {
            reelNumber: number,
            creativeAngle: cleanString(reel.creativeAngle),
            openingHook: cleanString(reel.openingHook),
            fullSongCta: cleanString(reel.fullSongCta),
            visualDirection: cleanString(reel.visualDirection),
          },
        });
      }
    }

    if (Object.keys(tiktok).length > 0) {
      for (const [index, rawPost] of asArray(tiktok.posts).entries()) {
        const post = asRecord(rawPost);
        const number = positiveNumber(post.postNumber, index + 1);
        const vertical = mediaMap.get(mediaKey("vertical-video", number)) || null;

        addJob({
          platform: "tiktok",
          contentType: "video",
          itemKey: `tiktok-post-${String(number).padStart(2, "0")}`,
          caption: cleanString(post.caption),
          hashtags: cleanStringArray(post.hashtags, 15),
          media: vertical,
          mediaRequired: true,
          mediaRequirementLabel: `Vertical video slot ${number} is missing for TikTok post ${number}.`,
          payload: {
            postNumber: number,
            creativeAngle: cleanString(post.creativeAngle),
            lyricMoment: cleanString(post.lyricMoment),
            openingHook: cleanString(post.openingHook),
            commentPrompt: cleanString(post.commentPrompt),
            fullSongCta: cleanString(post.fullSongCta),
            visualDirection: cleanString(post.visualDirection),
          },
        });
      }
    }

    if (jobs.length === 0) {
      await supabase
        .from("publishing_campaigns")
        .delete()
        .eq("id", campaignId)
        .eq("user_id", userId);

      return NextResponse.json(
        { error: "The saved social packs did not contain any publishable campaign items." },
        { status: 400 }
      );
    }

    const { error: insertError } = await supabase.from("publishing_jobs").insert(jobs);
    if (insertError) {
      await supabase
        .from("publishing_campaigns")
        .delete()
        .eq("id", campaignId)
        .eq("user_id", userId);

      throw new Error(`Could not create bulk publishing rows: ${insertError.message}`);
    }

    const previousIds = (previousCampaigns || [])
      .map((row) => cleanString(row.id))
      .filter((id) => id && id !== campaignId);

    if (previousIds.length > 0) {
      const { error: archiveError } = await supabase
        .from("publishing_campaigns")
        .update({ status: "archived", updated_at: now })
        .in("id", previousIds)
        .eq("user_id", userId);

      if (archiveError) {
        console.error("Could not archive previous publishing campaigns:", archiveError);
      }
    }

    return NextResponse.json({
      projectId,
      generated: true,
      sourcePackUpdatedAt: packRow?.updated_at || null,
      ...(await loadCampaign(supabase, userId, projectId)),
    });
  } catch (error) {
    console.error("Generate publishing campaign error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not generate publishing campaign.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const userId = user.id;
    const body = await request.json();
    const projectId = cleanString(body.projectId);

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    const song = await getOwnedSong(supabase, userId, projectId);
    if (!song) {
      return NextResponse.json({ error: "Song not found." }, { status: 404 });
    }

    const { data: campaign, error: campaignError } = await supabase
      .from("publishing_campaigns")
      .select("id")
      .eq("song_id", projectId)
      .eq("user_id", userId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (campaignError) {
      throw new Error(`Could not load publishing campaign: ${campaignError.message}`);
    }
    if (!campaign) {
      return NextResponse.json({ error: "No active publishing campaign was found." }, { status: 404 });
    }

    const action = cleanString(body.action);
    if (action === "revalidate") {
      await revalidateCampaign(supabase, userId, projectId);
      return NextResponse.json({
        projectId,
        revalidated: true,
        ...(await loadCampaign(supabase, userId, projectId)),
      });
    }

    const updates = asArray(body.updates).map(asRecord).slice(0, 250);
    if (updates.length === 0) {
      return NextResponse.json({ error: "At least one campaign update is required." }, { status: 400 });
    }

    const ids = updates.map((row) => cleanString(row.id)).filter(Boolean);
    const { data: currentJobs, error: jobsError } = await supabase
      .from("publishing_jobs")
      .select("id, status, external_post_id")
      .in("id", ids)
      .eq("campaign_id", campaign.id)
      .eq("user_id", userId);

    if (jobsError) {
      throw new Error(`Could not load publishing rows: ${jobsError.message}`);
    }

    const editableIds = new Set(
      (currentJobs || [])
        .filter(
          (row) =>
            !["uploading", "published"].includes(cleanString(row.status)) &&
            !cleanString(row.external_post_id)
        )
        .map((row) => cleanString(row.id))
    );

    let updatedCount = 0;
    for (const row of updates) {
      const id = cleanString(row.id);
      if (!id || !editableIds.has(id)) continue;

      const changes: JsonRecord = { updated_at: new Date().toISOString() };

      if (Object.prototype.hasOwnProperty.call(row, "title")) {
        changes.title = cleanString(row.title) || null;
      }
      if (Object.prototype.hasOwnProperty.call(row, "caption")) {
        changes.caption = cleanString(row.caption) || null;
      }
      if (Object.prototype.hasOwnProperty.call(row, "description")) {
        changes.description = cleanString(row.description) || null;
      }
      if (Object.prototype.hasOwnProperty.call(row, "hashtags")) {
        changes.hashtags = cleanStringArray(row.hashtags, 50);
      }
      if (Object.prototype.hasOwnProperty.call(row, "tags")) {
        changes.tags = cleanStringArray(row.tags, 75);
      }
      if (Object.prototype.hasOwnProperty.call(row, "ready_to_publish")) {
        changes.ready_to_publish = Boolean(row.ready_to_publish);
      }
      if (Object.prototype.hasOwnProperty.call(row, "scheduled_for")) {
        const scheduled = cleanString(row.scheduled_for);
        changes.scheduled_for = scheduled || null;
      }
      if (Object.prototype.hasOwnProperty.call(row, "schedule_timezone")) {
        changes.schedule_timezone = cleanString(row.schedule_timezone) || null;
      }

      const { error } = await supabase
        .from("publishing_jobs")
        .update(changes)
        .eq("id", id)
        .eq("campaign_id", campaign.id)
        .eq("user_id", userId);

      if (error) {
        throw new Error(`Could not update publishing row: ${error.message}`);
      }
      updatedCount += 1;
    }

    await revalidateCampaign(supabase, userId, projectId);

    return NextResponse.json({
      projectId,
      updatedCount,
      ...(await loadCampaign(supabase, userId, projectId)),
    });
  } catch (error) {
    console.error("Update publishing campaign error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update publishing campaign.",
      },
      { status: 500 }
    );
  }
}

