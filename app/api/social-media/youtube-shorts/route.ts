import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type YouTubeShort = {
  shortNumber: number;
  creativeAngle: string;
  lyricMoment: string;
  openingHook: string;
  title: string;
  description: string;
  hashtags: string[];
  tags: string[];
  pinnedComment: string;
  fullSongCta: string;
  visualDirection: string;
};

type YouTubeShortsPack = {
  generatorGuidance: string;
  shorts: YouTubeShort[];
};

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

function cleanShort(
  value: unknown,
  fallbackNumber: number
): YouTubeShort {
  const item =
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    shortNumber:
      typeof item.shortNumber === "number"
        ? item.shortNumber
        : fallbackNumber,

    creativeAngle:
      typeof item.creativeAngle === "string"
        ? item.creativeAngle.trim()
        : "",

    lyricMoment:
      typeof item.lyricMoment === "string"
        ? item.lyricMoment.trim()
        : "",

    openingHook:
      typeof item.openingHook === "string"
        ? item.openingHook.trim()
        : "",

    title:
      typeof item.title === "string"
        ? item.title.trim().slice(0, 100)
        : "",

    description:
      typeof item.description === "string"
        ? item.description.trim()
        : "",

    hashtags: cleanStringArray(
      item.hashtags,
      10
    ),

    tags: cleanStringArray(
      item.tags,
      20
    ),

    pinnedComment:
      typeof item.pinnedComment === "string"
        ? item.pinnedComment.trim()
        : "",

    fullSongCta:
      typeof item.fullSongCta === "string"
        ? item.fullSongCta.trim()
        : "",

    visualDirection:
      typeof item.visualDirection === "string"
        ? item.visualDirection.trim()
        : "",
  };
}


// ============================================================
// GET — load saved Shorts pack
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

    const projectId = String(
      searchParams.get("projectId") || ""
    ).trim();

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

    const { data: pack, error: packError } =
      await supabase
        .from("social_media_packs")
        .select("youtube_shorts, updated_at")
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();

    if (packError) {
      throw new Error(
        `Could not load YouTube Shorts: ${packError.message}`
      );
    }

    const saved = pack?.youtube_shorts;

    const youtubeShorts =
      saved &&
      typeof saved === "object" &&
      !Array.isArray(saved)
        ? saved
        : null;

    return NextResponse.json({
      projectId,
      youtubeShorts,
      updatedAt: pack?.updated_at || null,
    });
  } catch (error) {
    console.error(
      "Load YouTube Shorts pack error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load YouTube Shorts pack.",
      },
      { status: 500 }
    );
  }
}


// ============================================================
// PATCH — save edited Shorts pack
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

    const projectId = String(
      body.projectId || ""
    ).trim();

    const youtubeShorts = body.youtubeShorts;

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    if (
      !youtubeShorts ||
      typeof youtubeShorts !== "object" ||
      Array.isArray(youtubeShorts)
    ) {
      return NextResponse.json(
        {
          error:
            "youtubeShorts pack is required.",
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

    const rawShorts = Array.isArray(
      youtubeShorts.shorts
    )
      ? youtubeShorts.shorts
      : [];

    if (rawShorts.length === 0) {
      return NextResponse.json(
        {
          error:
            "At least one YouTube Short is required.",
        },
        { status: 400 }
      );
    }

    const cleanedPack: YouTubeShortsPack = {
      generatorGuidance: String(
        youtubeShorts.generatorGuidance || ""
      ).trim(),

      shorts: rawShorts
        .slice(0, 10)
        .map((item: unknown, index: number) =>
          cleanShort(item, index + 1)
        ),
    };

    const { error: saveError } =
      await supabase
        .from("social_media_packs")
        .upsert(
          {
            song_id: projectId,
            user_id: user.id,
            youtube_shorts: cleanedPack,
            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict: "song_id,user_id",
          }
        );

    if (saveError) {
      throw new Error(
        `Could not save YouTube Shorts: ${saveError.message}`
      );
    }

    return NextResponse.json({
      projectId,
      youtubeShorts: cleanedPack,
      saved: true,
    });
  } catch (error) {
    console.error(
      "Save YouTube Shorts pack error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save YouTube Shorts pack.",
      },
      { status: 500 }
    );
  }
}


// ============================================================
// POST — generate 10 coordinated Shorts
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

    const projectId = String(
      body.projectId || ""
    ).trim();

    const generatorGuidance = String(
      body.generatorGuidance || ""
    ).trim();

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
            "Generate the full song before creating YouTube Shorts.",
        },
        { status: 400 }
      );
    }

    const systemPrompt = `
You are a senior YouTube Shorts strategist for original music.

Create EXACTLY 10 genuinely different YouTube Shorts concepts
for one finished original song.

The goal is NOT to repeat the same lyric ten times.

Study the complete song and identify different emotional moments,
lyrics, ideas and visual opportunities.

Each Short should feel like a distinct promotional creative.

IMPORTANT:

1. The first 1 to 2 seconds matter most.

2. Opening hooks must be immediately understandable and emotionally
   interesting.

3. Use different sections or emotional angles across the 10 Shorts.

4. Avoid repeating the same lyric unless absolutely necessary.

5. lyricMoment must use words that actually appear in the supplied
   lyrics. Never invent song lyrics.

6. Some Shorts can be lyric-led.
   Others can be question-led, story-led, mood-led, relatable,
   cinematic or curiosity-led.

7. Titles should be natural, readable and under 100 characters.

8. Do not keyword-stuff titles or descriptions.

9. Hashtags should be selective and relevant.

10. Search tags do not contain # symbols.

11. pinnedComment should invite genuine conversation.

12. fullSongCta should naturally lead viewers to the full song.

13. visualDirection should describe a practical vertical 9:16 visual
    idea. Do not assume a specific final video already exists.

14. The 10 Shorts should differ substantially in:
    - opening hook
    - emotional angle
    - lyric selection
    - visual idea
    - caption approach
    - viewer question

15. Preserve the song's language and cultural identity.

Return ONLY valid JSON in exactly this structure:

{
  "shorts": [
    {
      "shortNumber": 1,
      "creativeAngle": "",
      "lyricMoment": "",
      "openingHook": "",
      "title": "",
      "description": "",
      "hashtags": [],
      "tags": [],
      "pinnedComment": "",
      "fullSongCta": "",
      "visualDirection": ""
    }
  ]
}

There must be exactly 10 objects in shorts.
`.trim();

    const userPrompt = `
Create 10 high-quality YouTube Shorts packages for this song.

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

OPTIONAL CREATOR DIRECTION:

${
  generatorGuidance ||
  "No additional Shorts direction supplied. Use your best judgement."
}

Create EXACTLY 10 substantially different Shorts.

For each Short provide:

- creative angle
- exact lyric moment from the song
- first-screen / opening hook
- YouTube Shorts title
- short description
- relevant hashtags
- searchable tags
- pinned comment
- CTA leading to the full song
- practical 9:16 visual direction

Do not invent lyrics.
Do not repeat the same approach ten times.
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

    let parsed: {
      shorts?: unknown[];
    };

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "AI returned invalid JSON."
      );
    }

    if (
      !Array.isArray(parsed.shorts) ||
      parsed.shorts.length !== 10
    ) {
      throw new Error(
        "AI did not return exactly 10 Shorts."
      );
    }

    const shorts = parsed.shorts.map(
      (item, index) =>
        cleanShort(item, index + 1)
    );

    const invalidShort = shorts.find(
      (short) =>
        !short.title ||
        !short.openingHook ||
        !short.lyricMoment
    );

    if (invalidShort) {
      throw new Error(
        `Short ${invalidShort.shortNumber} is incomplete.`
      );
    }

    const youtubeShorts: YouTubeShortsPack = {
      generatorGuidance,
      shorts,
    };

    const { error: saveError } =
      await supabase
        .from("social_media_packs")
        .upsert(
          {
            song_id: song.id,
            user_id: user.id,
            youtube_shorts: youtubeShorts,
            updated_at:
              new Date().toISOString(),
          },
          {
            onConflict: "song_id,user_id",
          }
        );

    if (saveError) {
      throw new Error(
        `Could not save YouTube Shorts: ${saveError.message}`
      );
    }

    return NextResponse.json({
      projectId: song.id,
      youtubeShorts,
      saved: true,
    });
  } catch (error) {
    console.error(
      "YouTube Shorts generation error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate YouTube Shorts.",
      },
      { status: 500 }
    );
  }
}
