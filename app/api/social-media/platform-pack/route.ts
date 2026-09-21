import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type FacebookReel = {
  reelNumber: number;
  creativeAngle: string;
  openingHook: string;
  caption: string;
  hashtags: string[];
  engagementPrompt: string;
  fullSongCta: string;
};

type FacebookPack = {
  generatorGuidance: string;
  mainReleasePost: string;
  shortReleasePost: string;
  emotionalStoryPost: string;
  engagementQuestions: string[];
  ctaOptions: string[];
  hashtags: string[];
  reels: FacebookReel[];
};

type InstagramReel = {
  reelNumber: number;
  creativeAngle: string;
  openingHook: string;
  caption: string;
  hashtags: string[];
  fullSongCta: string;
  visualDirection: string;
};

type InstagramPack = {
  generatorGuidance: string;
  feedCaption: string;
  shortCaption: string;
  storyTextIdeas: string[];
  ctaOptions: string[];
  hashtags: string[];
  reels: InstagramReel[];
};

type TikTokPost = {
  postNumber: number;
  creativeAngle: string;
  lyricMoment: string;
  openingHook: string;
  caption: string;
  hashtags: string[];
  commentPrompt: string;
  fullSongCta: string;
  visualDirection: string;
};

type TikTokPack = {
  generatorGuidance: string;
  posts: TikTokPost[];
};

function asRecord(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }

  return {};
}

function cleanString(value: unknown) {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function cleanStringArray(
  value: unknown,
  maxItems: number
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(
      (item): item is string =>
        typeof item === "string"
    )
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanFacebookReel(
  value: unknown,
  fallbackNumber: number
): FacebookReel {
  const item = asRecord(value);

  return {
    reelNumber:
      typeof item.reelNumber === "number"
        ? item.reelNumber
        : fallbackNumber,

    creativeAngle: cleanString(
      item.creativeAngle
    ),

    openingHook: cleanString(
      item.openingHook
    ),

    caption: cleanString(item.caption),

    hashtags: cleanStringArray(
      item.hashtags,
      12
    ),

    engagementPrompt: cleanString(
      item.engagementPrompt
    ),

    fullSongCta: cleanString(
      item.fullSongCta
    ),
  };
}

function cleanInstagramReel(
  value: unknown,
  fallbackNumber: number
): InstagramReel {
  const item = asRecord(value);

  return {
    reelNumber:
      typeof item.reelNumber === "number"
        ? item.reelNumber
        : fallbackNumber,

    creativeAngle: cleanString(
      item.creativeAngle
    ),

    openingHook: cleanString(
      item.openingHook
    ),

    caption: cleanString(item.caption),

    hashtags: cleanStringArray(
      item.hashtags,
      15
    ),

    fullSongCta: cleanString(
      item.fullSongCta
    ),

    visualDirection: cleanString(
      item.visualDirection
    ),
  };
}

function cleanTikTokPost(
  value: unknown,
  fallbackNumber: number
): TikTokPost {
  const item = asRecord(value);

  return {
    postNumber:
      typeof item.postNumber === "number"
        ? item.postNumber
        : fallbackNumber,

    creativeAngle: cleanString(
      item.creativeAngle
    ),

    lyricMoment: cleanString(
      item.lyricMoment
    ),

    openingHook: cleanString(
      item.openingHook
    ),

    caption: cleanString(item.caption),

    hashtags: cleanStringArray(
      item.hashtags,
      10
    ),

    commentPrompt: cleanString(
      item.commentPrompt
    ),

    fullSongCta: cleanString(
      item.fullSongCta
    ),

    visualDirection: cleanString(
      item.visualDirection
    ),
  };
}

function cleanFacebookPack(
  value: unknown,
  generatorGuidance = ""
): FacebookPack {
  const pack = asRecord(value);

  return {
    generatorGuidance:
      cleanString(pack.generatorGuidance) ||
      generatorGuidance,

    mainReleasePost: cleanString(
      pack.mainReleasePost
    ),

    shortReleasePost: cleanString(
      pack.shortReleasePost
    ),

    emotionalStoryPost: cleanString(
      pack.emotionalStoryPost
    ),

    engagementQuestions: cleanStringArray(
      pack.engagementQuestions,
      8
    ),

    ctaOptions: cleanStringArray(
      pack.ctaOptions,
      8
    ),

    hashtags: cleanStringArray(
      pack.hashtags,
      15
    ),

    reels: Array.isArray(pack.reels)
      ? pack.reels
          .slice(0, 10)
          .map((item, index) =>
            cleanFacebookReel(
              item,
              index + 1
            )
          )
      : [],
  };
}

function cleanInstagramPack(
  value: unknown,
  generatorGuidance = ""
): InstagramPack {
  const pack = asRecord(value);

  return {
    generatorGuidance:
      cleanString(pack.generatorGuidance) ||
      generatorGuidance,

    feedCaption: cleanString(
      pack.feedCaption
    ),

    shortCaption: cleanString(
      pack.shortCaption
    ),

    storyTextIdeas: cleanStringArray(
      pack.storyTextIdeas,
      10
    ),

    ctaOptions: cleanStringArray(
      pack.ctaOptions,
      8
    ),

    hashtags: cleanStringArray(
      pack.hashtags,
      20
    ),

    reels: Array.isArray(pack.reels)
      ? pack.reels
          .slice(0, 10)
          .map((item, index) =>
            cleanInstagramReel(
              item,
              index + 1
            )
          )
      : [],
  };
}

function cleanTikTokPack(
  value: unknown,
  generatorGuidance = ""
): TikTokPack {
  const pack = asRecord(value);

  return {
    generatorGuidance:
      cleanString(pack.generatorGuidance) ||
      generatorGuidance,

    posts: Array.isArray(pack.posts)
      ? pack.posts
          .slice(0, 10)
          .map((item, index) =>
            cleanTikTokPost(
              item,
              index + 1
            )
          )
      : [],
  };
}


// ============================================================
// GET — load all three saved platform packs
// ============================================================

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const { searchParams } =
      new URL(request.url);

    const projectId = cleanString(
      searchParams.get("projectId")
    );

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    const { data: song, error: songError } =
      await supabase
        .from("songs")
        .select("id")
        .eq("id", projectId)
        .eq("user_id", user.id)
        .single();

    if (songError || !song) {
      return NextResponse.json(
        { error: "Song not found." },
        { status: 404 }
      );
    }

    const { data: row, error: packError } =
      await supabase
        .from("social_media_packs")
        .select(
          "facebook, instagram, tiktok, updated_at"
        )
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (packError) {
      throw new Error(
        `Could not load platform packs: ${packError.message}`
      );
    }

    return NextResponse.json({
      projectId,
      facebook:
        row?.facebook &&
        typeof row.facebook === "object" &&
        !Array.isArray(row.facebook) &&
        Object.keys(row.facebook).length > 0
          ? row.facebook
          : null,

      instagram:
        row?.instagram &&
        typeof row.instagram === "object" &&
        !Array.isArray(row.instagram) &&
        Object.keys(row.instagram).length > 0
          ? row.instagram
          : null,

      tiktok:
        row?.tiktok &&
        typeof row.tiktok === "object" &&
        !Array.isArray(row.tiktok) &&
        Object.keys(row.tiktok).length > 0
          ? row.tiktok
          : null,

      updatedAt: row?.updated_at || null,
    });
  } catch (error) {
    console.error(
      "Load platform packs error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load platform packs.",
      },
      { status: 500 }
    );
  }
}


// ============================================================
// PATCH — save ONE edited platform independently
// ============================================================

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const projectId = cleanString(
      body.projectId
    );

    const platform = cleanString(
      body.platform
    );

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    if (
      !["facebook", "instagram", "tiktok"].includes(
        platform
      )
    ) {
      return NextResponse.json(
        {
          error:
            "platform must be facebook, instagram or tiktok.",
        },
        { status: 400 }
      );
    }

    const { data: song, error: songError } =
      await supabase
        .from("songs")
        .select("id")
        .eq("id", projectId)
        .eq("user_id", user.id)
        .single();

    if (songError || !song) {
      return NextResponse.json(
        { error: "Song not found." },
        { status: 404 }
      );
    }

    let cleanedPack:
      | FacebookPack
      | InstagramPack
      | TikTokPack;

    if (platform === "facebook") {
      cleanedPack = cleanFacebookPack(
        body.pack
      );
    } else if (platform === "instagram") {
      cleanedPack = cleanInstagramPack(
        body.pack
      );
    } else {
      cleanedPack = cleanTikTokPack(
        body.pack
      );
    }

    const { error: saveError } =
      await supabase
        .from("social_media_packs")
        .upsert(
          {
            song_id: projectId,
            user_id: user.id,
            [platform]: cleanedPack,
            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict: "song_id,user_id",
          }
        );

    if (saveError) {
      throw new Error(
        `Could not save ${platform} pack: ${saveError.message}`
      );
    }

    return NextResponse.json({
      projectId,
      platform,
      pack: cleanedPack,
      saved: true,
    });
  } catch (error) {
    console.error(
      "Save platform pack error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save platform pack.",
      },
      { status: 500 }
    );
  }
}


// ============================================================
// POST — generate Facebook + Instagram + TikTok together
// ============================================================

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const projectId = cleanString(
      body.projectId
    );

    const generatorGuidance = cleanString(
      body.generatorGuidance
    );

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    const { data: song, error: songError } =
      await supabase
        .from("songs")
        .select(
          `
          id,
          title,
          idea,
          language,
          script,
          mood,
          genre,
          selected_hook,
          lyrics
          `
        )
        .eq("id", projectId)
        .eq("user_id", user.id)
        .single();

    if (songError || !song) {
      return NextResponse.json(
        { error: "Song not found." },
        { status: 404 }
      );
    }

    if (!song.lyrics?.trim()) {
      return NextResponse.json(
        {
          error:
            "Generate the full song before creating platform packs.",
        },
        { status: 400 }
      );
    }

    // Reuse YouTube Shorts as creative intelligence when available.
    const { data: existingSocialPack } =
      await supabase
        .from("social_media_packs")
        .select("youtube_shorts")
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();

    const youtubeShortsRaw =
      existingSocialPack?.youtube_shorts;

    const youtubeShortIdeas: {
      shortNumber: number;
      creativeAngle: string;
      lyricMoment: string;
      openingHook: string;
      visualDirection: string;
    }[] = [];

    if (
      youtubeShortsRaw &&
      typeof youtubeShortsRaw === "object" &&
      !Array.isArray(youtubeShortsRaw)
    ) {
      const shortsValue = (
        youtubeShortsRaw as Record<
          string,
          unknown
        >
      ).shorts;

      if (Array.isArray(shortsValue)) {
        shortsValue
          .slice(0, 10)
          .forEach((value, index) => {
            const item = asRecord(value);

            youtubeShortIdeas.push({
              shortNumber: index + 1,
              creativeAngle: cleanString(
                item.creativeAngle
              ),
              lyricMoment: cleanString(
                item.lyricMoment
              ),
              openingHook: cleanString(
                item.openingHook
              ),
              visualDirection: cleanString(
                item.visualDirection
              ),
            });
          });
      }
    }

    const systemPrompt = `
You are a senior social-media strategist for original music releases.

Create a coordinated but platform-native promotional campaign for:

1. Facebook
2. Instagram
3. TikTok

You are working from ONE completed original song.

The three platform packs must feel connected as one campaign,
but they must NOT simply copy and paste the same text.

GENERAL RULES:

- Study the complete lyrics carefully.
- Preserve the song's language and cultural identity.
- Never invent lyrics.
- Never invent facts about the artist, credits, collaborators,
  streaming performance, audience numbers or release success.
- Avoid generic AI marketing language.
- Avoid excessive emojis.
- Avoid fake urgency.
- Avoid meaningless hashtag stuffing.
- Keep copy human, emotional and natural.
- Different short-form concepts should genuinely differ.
- Strong first-screen hooks matter.
- Reuse good creative angles from supplied YouTube Shorts when useful,
  but rewrite them naturally for each platform.
- Do NOT blindly copy YouTube metadata into Facebook, Instagram
  or TikTok.

FACEBOOK:

Create:
- one substantial main release post
- one shorter release post
- one emotional/story-led post
- 4 to 6 engagement questions
- 4 to 6 CTA options
- sensible Facebook hashtags
- exactly 6 Facebook Reels concepts

Facebook should feel conversational and community-oriented.

INSTAGRAM:

Create:
- one polished feed caption
- one shorter caption
- 6 to 8 Story text ideas
- 4 to 6 CTA options
- relevant Instagram hashtags
- exactly 10 Instagram Reels concepts

Instagram Reels should have strong opening hooks and concise captions.
Visual directions should be practical for vertical 9:16 video.

TIKTOK:

Create exactly 10 distinct TikTok post concepts.

Each TikTok must include:
- creative angle
- exact lyric moment from the supplied song
- first-screen/on-screen hook
- short natural caption
- focused hashtags
- comment prompt
- CTA toward the full song
- practical visual direction

TikTok copy should feel native and conversational, never like
a formal advertisement.

Return ONLY valid JSON using exactly this structure:

{
  "facebook": {
    "mainReleasePost": "",
    "shortReleasePost": "",
    "emotionalStoryPost": "",
    "engagementQuestions": [],
    "ctaOptions": [],
    "hashtags": [],
    "reels": [
      {
        "reelNumber": 1,
        "creativeAngle": "",
        "openingHook": "",
        "caption": "",
        "hashtags": [],
        "engagementPrompt": "",
        "fullSongCta": ""
      }
    ]
  },
  "instagram": {
    "feedCaption": "",
    "shortCaption": "",
    "storyTextIdeas": [],
    "ctaOptions": [],
    "hashtags": [],
    "reels": [
      {
        "reelNumber": 1,
        "creativeAngle": "",
        "openingHook": "",
        "caption": "",
        "hashtags": [],
        "fullSongCta": "",
        "visualDirection": ""
      }
    ]
  },
  "tiktok": {
    "posts": [
      {
        "postNumber": 1,
        "creativeAngle": "",
        "lyricMoment": "",
        "openingHook": "",
        "caption": "",
        "hashtags": [],
        "commentPrompt": "",
        "fullSongCta": "",
        "visualDirection": ""
      }
    ]
  }
}
`.trim();

    const youtubeShortsContext =
      youtubeShortIdeas.length > 0
        ? JSON.stringify(
            youtubeShortIdeas,
            null,
            2
          )
        : "No saved YouTube Shorts concepts are available.";

    const userPrompt = `
Build the Facebook, Instagram and TikTok release campaign
for this finished song.

SONG TITLE:
${song.title || "Untitled"}

IDEA:
${song.idea || "Not specified"}

LANGUAGE:
${song.language || "Not specified"}

SCRIPT:
${song.script || "Not specified"}

MOOD:
${song.mood || "Not specified"}

GENRE:
${song.genre || "Not specified"}

SELECTED HOOK:
${song.selected_hook || "Not specified"}

FULL LYRICS:
${song.lyrics}

SAVED YOUTUBE SHORTS CREATIVE IDEAS:
${youtubeShortsContext}

OPTIONAL CREATOR DIRECTION:
${
  generatorGuidance ||
  "No additional direction supplied. Use your best judgement."
}

Create one coordinated campaign while respecting the different
behaviour and tone of Facebook, Instagram and TikTok.

Do not invent song lyrics.

Facebook must contain exactly 6 Reels.
Instagram must contain exactly 10 Reels.
TikTok must contain exactly 10 posts.
`.trim();

    const response =
      await openai.responses.create({
        model: "gpt-5.6-luna",

        input: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],

        text: {
          format: {
            type: "json_object",
          },
        },
      });

    const raw =
      response.output_text?.trim();

    if (!raw) {
      throw new Error(
        "No response received from AI."
      );
    }

    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "AI returned invalid JSON."
      );
    }

    const facebook = cleanFacebookPack(
      parsed.facebook,
      generatorGuidance
    );

    const instagram = cleanInstagramPack(
      parsed.instagram,
      generatorGuidance
    );

    const tiktok = cleanTikTokPack(
      parsed.tiktok,
      generatorGuidance
    );

    if (facebook.reels.length !== 6) {
      throw new Error(
        "AI did not return exactly 6 Facebook Reels."
      );
    }

    if (instagram.reels.length !== 10) {
      throw new Error(
        "AI did not return exactly 10 Instagram Reels."
      );
    }

    if (tiktok.posts.length !== 10) {
      throw new Error(
        "AI did not return exactly 10 TikTok posts."
      );
    }

    if (
      !facebook.mainReleasePost ||
      !instagram.feedCaption ||
      !tiktok.posts[0]?.caption
    ) {
      throw new Error(
        "One or more platform packs are incomplete."
      );
    }

    const { error: saveError } =
      await supabase
        .from("social_media_packs")
        .upsert(
          {
            song_id: song.id,
            user_id: user.id,
            facebook,
            instagram,
            tiktok,
            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict: "song_id,user_id",
          }
        );

    if (saveError) {
      throw new Error(
        `Could not save platform packs: ${saveError.message}`
      );
    }

    return NextResponse.json({
      projectId: song.id,
      facebook,
      instagram,
      tiktok,
      saved: true,
    });
  } catch (error) {
    console.error(
      "Platform pack generation error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate platform packs.",
      },
      { status: 500 }
    );
  }
}
