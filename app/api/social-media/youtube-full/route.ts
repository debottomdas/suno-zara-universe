import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type YouTubeFullPack = {
  generatorGuidance: string;
  releaseDetails: {
    releaseType: string;
    artistBrand: string;
    lyricsCredit: string;
    compositionCredit: string;
    producerCredit: string;
    preferredPlaylist: string;
    includeAiDisclosure: boolean;
    aiDisclosureDetails: string;
    descriptionLinks: string;
  };
  recommendedTitle: string;
  whyRecommended: string;
  alternativeTitles: string[];
  thumbnailTextOptions: string[];
  openingDescription: string;
  fullDescription: string;
  finalDescription: string;
  credits: string;
  aiDisclosure: string;
  hashtags: string[];
  tags: string[];
  seoKeywords: string[];
  pinnedComment: string;
  alternativePinnedComment: string;
  communityPost: string;
  informalCommunityPost: string;
  releasePost: string;
  playlistSuggestion: string;
  strongestLyricLines: string[];
  ctaOptions: string[];
  shortsBridgeCopy: string;
  filenameSuggestion: string;
  uploadChecklist: string[];
};

function buildYouTubeCredits(releaseDetails: {
  artistBrand: string;
  lyricsCredit: string;
  compositionCredit: string;
  producerCredit: string;
}) {
  return [
    releaseDetails.artistBrand
      ? `Artist / Brand: ${releaseDetails.artistBrand}`
      : "",
    releaseDetails.lyricsCredit,
    releaseDetails.compositionCredit,
    releaseDetails.producerCredit,
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

function buildFinalYouTubeDescription({
  creativeDescription,
  credits,
  aiDisclosure,
  descriptionLinks,
}: {
  creativeDescription: string;
  credits: string;
  aiDisclosure: string;
  descriptionLinks: string;
}) {
  const sections = [
    creativeDescription.trim(),

    credits.trim()
      ? `Credits\n${credits.trim()}`
      : "",

    aiDisclosure.trim()
      ? `AI / Production Disclosure\n${aiDisclosure.trim()}`
      : "",

    descriptionLinks.trim()
      ? `Listen / Follow\n${descriptionLinks.trim()}`
      : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}

function cleanStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

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

    const { searchParams } = new URL(request.url);
    const projectId = String(
      searchParams.get("projectId") || ""
    ).trim();

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    const { data: song, error: songError } = await supabase
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

    const { data: pack, error: packError } = await supabase
      .from("social_media_packs")
      .select("youtube_full, updated_at")
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (packError) {
      throw new Error(
        `Could not load YouTube pack: ${packError.message}`
      );
    }

    return NextResponse.json({
      projectId,
      youtubeFull: pack?.youtube_full || null,
      updatedAt: pack?.updated_at || null,
    });
  } catch (error) {
    console.error("Load YouTube pack error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load YouTube pack.",
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
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const projectId = String(body.projectId || "").trim();
    const youtubeFull = body.youtubeFull;

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    if (
      !youtubeFull ||
      typeof youtubeFull !== "object" ||
      Array.isArray(youtubeFull)
    ) {
      return NextResponse.json(
        { error: "youtubeFull is required." },
        { status: 400 }
      );
    }

    const recommendedTitle = String(
      youtubeFull.recommendedTitle || ""
    ).trim();

    const fullDescription = String(
      youtubeFull.fullDescription || ""
    ).trim();

    if (!recommendedTitle) {
      return NextResponse.json(
        { error: "YouTube title cannot be empty." },
        { status: 400 }
      );
    }

    if (recommendedTitle.length > 100) {
      return NextResponse.json(
        {
          error:
            "YouTube title must be 100 characters or fewer.",
        },
        { status: 400 }
      );
    }

    if (!fullDescription) {
      return NextResponse.json(
        { error: "YouTube description cannot be empty." },
        { status: 400 }
      );
    }

    const { data: song, error: songError } = await supabase
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

    const rawReleaseDetails =
      youtubeFull.releaseDetails &&
      typeof youtubeFull.releaseDetails === "object"
        ? youtubeFull.releaseDetails
        : {};

    const savedReleaseDetails = {
      releaseType: String(
        rawReleaseDetails.releaseType ||
          "Official Music Video"
      ).trim(),

      artistBrand: String(
        rawReleaseDetails.artistBrand || ""
      ).trim(),

      lyricsCredit: String(
        rawReleaseDetails.lyricsCredit || ""
      ).trim(),

      compositionCredit: String(
        rawReleaseDetails.compositionCredit || ""
      ).trim(),

      producerCredit: String(
        rawReleaseDetails.producerCredit || ""
      ).trim(),

      preferredPlaylist: String(
        rawReleaseDetails.preferredPlaylist || ""
      ).trim(),

      includeAiDisclosure:
        rawReleaseDetails.includeAiDisclosure === true,

      aiDisclosureDetails: String(
        rawReleaseDetails.aiDisclosureDetails || ""
      ).trim(),

      descriptionLinks: String(
        rawReleaseDetails.descriptionLinks || ""
      ).trim(),
    };

    const savedCredits =
      buildYouTubeCredits(savedReleaseDetails);

    const savedAiDisclosure =
      savedReleaseDetails.includeAiDisclosure
        ? savedReleaseDetails.aiDisclosureDetails
        : "";

    const savedFinalDescription =
      buildFinalYouTubeDescription({
        creativeDescription: fullDescription,
        credits: savedCredits,
        aiDisclosure: savedAiDisclosure,
        descriptionLinks:
          savedReleaseDetails.descriptionLinks,
      });

    const cleanedPack = {
      ...youtubeFull,

      releaseDetails: savedReleaseDetails,

      recommendedTitle,

      credits: savedCredits,

      aiDisclosure: savedAiDisclosure,

      playlistSuggestion:
        savedReleaseDetails.preferredPlaylist ||
        String(
          youtubeFull.playlistSuggestion || ""
        ).trim(),

      finalDescription:
        savedFinalDescription,

      fullDescription,

      alternativeTitles: Array.isArray(
        youtubeFull.alternativeTitles
      )
        ? youtubeFull.alternativeTitles
            .map((item: unknown) =>
              typeof item === "string"
                ? item.trim().slice(0, 100)
                : ""
            )
            .filter(Boolean)
        : [],

      thumbnailTextOptions: Array.isArray(
        youtubeFull.thumbnailTextOptions
      )
        ? youtubeFull.thumbnailTextOptions
            .map((item: unknown) =>
              typeof item === "string"
                ? item.trim()
                : ""
            )
            .filter(Boolean)
        : [],

      hashtags: Array.isArray(youtubeFull.hashtags)
        ? youtubeFull.hashtags
            .map((item: unknown) =>
              typeof item === "string"
                ? item.trim()
                : ""
            )
            .filter(Boolean)
        : [],

      tags: Array.isArray(youtubeFull.tags)
        ? youtubeFull.tags
            .map((item: unknown) =>
              typeof item === "string"
                ? item.trim()
                : ""
            )
            .filter(Boolean)
        : [],

      seoKeywords: Array.isArray(
        youtubeFull.seoKeywords
      )
        ? youtubeFull.seoKeywords
            .map((item: unknown) =>
              typeof item === "string"
                ? item.trim()
                : ""
            )
            .filter(Boolean)
        : [],

      strongestLyricLines: Array.isArray(
        youtubeFull.strongestLyricLines
      )
        ? youtubeFull.strongestLyricLines
            .map((item: unknown) =>
              typeof item === "string"
                ? item.trim()
                : ""
            )
            .filter(Boolean)
        : [],

      ctaOptions: Array.isArray(youtubeFull.ctaOptions)
        ? youtubeFull.ctaOptions
            .map((item: unknown) =>
              typeof item === "string"
                ? item.trim()
                : ""
            )
            .filter(Boolean)
        : [],

      uploadChecklist: Array.isArray(
        youtubeFull.uploadChecklist
      )
        ? youtubeFull.uploadChecklist
            .map((item: unknown) =>
              typeof item === "string"
                ? item.trim()
                : ""
            )
            .filter(Boolean)
        : [],
    };

    const { error: saveError } = await supabase
      .from("social_media_packs")
      .upsert(
        {
          song_id: projectId,
          user_id: user.id,
          youtube_full: cleanedPack,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "song_id,user_id",
        }
      );

    if (saveError) {
      throw new Error(
        `Could not save YouTube pack: ${saveError.message}`
      );
    }

    return NextResponse.json({
      projectId,
      youtubeFull: cleanedPack,
      saved: true,
    });
  } catch (error) {
    console.error("Save YouTube pack error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save YouTube pack.",
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
      return NextResponse.json(
        { error: "You must be signed in." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const projectId = String(body.projectId || "").trim();
    const generatorGuidance = String(
      body.generatorGuidance || ""
    ).trim();

    const releaseDetails = {
      releaseType: String(
        body.releaseDetails?.releaseType ||
          "Official Music Video"
      ).trim(),

      artistBrand: String(
        body.releaseDetails?.artistBrand || ""
      ).trim(),

      lyricsCredit: String(
        body.releaseDetails?.lyricsCredit || ""
      ).trim(),

      compositionCredit: String(
        body.releaseDetails?.compositionCredit || ""
      ).trim(),

      producerCredit: String(
        body.releaseDetails?.producerCredit || ""
      ).trim(),

      preferredPlaylist: String(
        body.releaseDetails?.preferredPlaylist || ""
      ).trim(),

      includeAiDisclosure:
        body.releaseDetails?.includeAiDisclosure === true,

      aiDisclosureDetails: String(
        body.releaseDetails?.aiDisclosureDetails || ""
      ).trim(),

      descriptionLinks: String(
        body.releaseDetails?.descriptionLinks || ""
      ).trim(),
    };

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    const { data: song, error: songError } = await supabase
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
        freedom,
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
            "Generate the full song before creating the YouTube pack.",
        },
        { status: 400 }
      );
    }

    const systemPrompt = `
You are a senior YouTube music release strategist, metadata writer,
copywriter and audience-development specialist.

Create a COMPLETE YouTube Full Song release package for one original song.

Everything must be specific to the supplied song.

Analyse:
- title
- full lyrics
- selected hook
- language
- mood
- genre
- cultural context
- listener emotion
- likely search behaviour

RULES:

1. Recommended title must balance emotional appeal,
   readability, song identity and discoverability.

2. Never keyword-stuff.

3. Every YouTube title must stay below 100 characters.

4. Alternative titles must genuinely differ.

5. Thumbnail text should normally be 2 to 6 words.

6. The opening description must be strong because it appears
   before "Show more".

7. Full description must sound human, not SEO spam.

8. Hashtags and tags must be relevant.

9. Tags must NOT contain # symbols.

10. Strongest lyric lines must be copied from the supplied lyrics.
    Never invent lyric lines.

11. Pinned comments should invite genuine conversation.

12. Never invent singers, collaborators or record labels.

13. AI disclosure is optional suggested wording only.
    Keep it neutral and concise.

14. Filename must be filesystem-friendly.

15. Adapt the writing style to the song language and audience.

Return ONLY valid JSON in exactly this structure:

{
  "recommendedTitle": "",
  "whyRecommended": "",
  "alternativeTitles": ["", "", "", ""],
  "thumbnailTextOptions": ["", "", ""],
  "openingDescription": "",
  "fullDescription": "",
  "credits": "",
  "aiDisclosure": "",
  "hashtags": [],
  "tags": [],
  "seoKeywords": [],
  "pinnedComment": "",
  "alternativePinnedComment": "",
  "communityPost": "",
  "informalCommunityPost": "",
  "releasePost": "",
  "playlistSuggestion": "",
  "strongestLyricLines": [],
  "ctaOptions": [],
  "shortsBridgeCopy": "",
  "filenameSuggestion": "",
  "uploadChecklist": []
}
`.trim();

    const userPrompt = `
Create the complete YouTube Full Song release package for this song.

TITLE:
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

CREATIVE FREEDOM:
${song.freedom ?? "Not specified"}

SELECTED HOOK:
${song.selected_hook || "Not specified"}

FULL LYRICS:
${song.lyrics}

OPTIONAL CREATOR DIRECTION FOR THIS YOUTUBE RELEASE:

${
  generatorGuidance ||
  "No additional direction supplied. Use your best judgement."
}

FACTUAL RELEASE DETAILS:

Release type:
${releaseDetails.releaseType || "Not specified"}

Artist / Brand:
${releaseDetails.artistBrand || "Not specified"}

Lyrics credit:
${releaseDetails.lyricsCredit || "Not specified"}

Music / Composition credit:
${releaseDetails.compositionCredit || "Not specified"}

Producer credit:
${releaseDetails.producerCredit || "Not specified"}

Preferred playlist:
${releaseDetails.preferredPlaylist || "Not specified"}

AI / synthetic-media disclosure requested:
${releaseDetails.includeAiDisclosure ? "Yes" : "No"}

AI usage details supplied by creator:
${releaseDetails.aiDisclosureDetails || "Not specified"}

Description / streaming / social links:
${releaseDetails.descriptionLinks || "Not specified"}

IMPORTANT FACTUAL RULES:

- These release details are creator-supplied facts.
- Never invent or replace credits.
- Never invent collaborators.
- Never invent links.
- Never claim a playlist exists if none was supplied.
- If a preferred playlist is supplied, use that exact playlist name.
- If no preferred playlist is supplied, you may suggest a playlist
  CATEGORY, but clearly describe it as a suggestion.
- If AI disclosure is set to No, aiDisclosure MUST be an empty string.
- If AI disclosure is set to Yes, base the disclosure ONLY on the
  supplied AI usage details.
- Omit unspecified credit lines rather than writing "Not specified".
- Do NOT put credits, AI disclosure, playlist information or
  description links inside fullDescription.
- fullDescription should contain only the creative/promotional
  song description.
- The application will add factual release information separately.
- Release type may be used in title/description where natural,
  but do not force it unnecessarily.

Treat creator direction as important release-specific guidance,
while still keeping all metadata truthful and relevant to the song.

Generate:

- 1 recommended title
- explanation of why it is recommended
- 4 alternative titles
- 3 thumbnail text options
- strong opening description
- complete YouTube description
- clean credits block
- optional AI / synthetic-production disclosure
- relevant hashtags
- searchable YouTube tags
- SEO keyword ideas
- primary pinned comment
- alternative pinned comment
- Community post
- informal Community post
- short release announcement
- playlist suggestion
- 5 to 10 strongest exact lyric lines
- natural CTA options
- Shorts-to-full-song bridge copy
- clean MP4 filename suggestion
- practical upload checklist

Do not invent lyric lines.
Do not invent collaborators.
Do not use generic filler.
`.trim();

    const response = await openai.responses.create({
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

    const raw = response.output_text?.trim();

    if (!raw) {
      throw new Error("No response received from AI.");
    }

    let parsed: Partial<YouTubeFullPack>;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AI returned invalid JSON.");
    }

    const deterministicCredits =
      buildYouTubeCredits(releaseDetails);

    const deterministicAiDisclosure =
      releaseDetails.includeAiDisclosure
        ? releaseDetails.aiDisclosureDetails
        : "";

    const creativeDescription =
      typeof parsed.fullDescription === "string"
        ? parsed.fullDescription.trim()
        : "";

    const finalDescription =
      buildFinalYouTubeDescription({
        creativeDescription,
        credits: deterministicCredits,
        aiDisclosure: deterministicAiDisclosure,
        descriptionLinks:
          releaseDetails.descriptionLinks,
      });

    const youtubeFull: YouTubeFullPack = {
      generatorGuidance,
      releaseDetails,

      recommendedTitle:
        typeof parsed.recommendedTitle === "string"
          ? parsed.recommendedTitle.trim().slice(0, 100)
          : "",

      whyRecommended:
        typeof parsed.whyRecommended === "string"
          ? parsed.whyRecommended.trim()
          : "",

      alternativeTitles: cleanStringArray(
        parsed.alternativeTitles,
        4
      ).map((title) => title.slice(0, 100)),

      thumbnailTextOptions: cleanStringArray(
        parsed.thumbnailTextOptions,
        3
      ),

      openingDescription:
        typeof parsed.openingDescription === "string"
          ? parsed.openingDescription.trim()
          : "",

      fullDescription: creativeDescription,

      finalDescription,

      credits: deterministicCredits,

      aiDisclosure: deterministicAiDisclosure,

      hashtags: cleanStringArray(parsed.hashtags, 15),

      tags: cleanStringArray(parsed.tags, 30),

      seoKeywords: cleanStringArray(
        parsed.seoKeywords,
        20
      ),

      pinnedComment:
        typeof parsed.pinnedComment === "string"
          ? parsed.pinnedComment.trim()
          : "",

      alternativePinnedComment:
        typeof parsed.alternativePinnedComment === "string"
          ? parsed.alternativePinnedComment.trim()
          : "",

      communityPost:
        typeof parsed.communityPost === "string"
          ? parsed.communityPost.trim()
          : "",

      informalCommunityPost:
        typeof parsed.informalCommunityPost === "string"
          ? parsed.informalCommunityPost.trim()
          : "",

      releasePost:
        typeof parsed.releasePost === "string"
          ? parsed.releasePost.trim()
          : "",

      playlistSuggestion:
        releaseDetails.preferredPlaylist ||
        (typeof parsed.playlistSuggestion === "string"
          ? parsed.playlistSuggestion.trim()
          : ""),

      strongestLyricLines: cleanStringArray(
        parsed.strongestLyricLines,
        10
      ),

      ctaOptions: cleanStringArray(
        parsed.ctaOptions,
        6
      ),

      shortsBridgeCopy:
        typeof parsed.shortsBridgeCopy === "string"
          ? parsed.shortsBridgeCopy.trim()
          : "",

      filenameSuggestion:
        typeof parsed.filenameSuggestion === "string"
          ? parsed.filenameSuggestion.trim()
          : "",

      uploadChecklist: cleanStringArray(
        parsed.uploadChecklist,
        20
      ),
    };

    if (!youtubeFull.recommendedTitle) {
      throw new Error(
        "AI did not return a recommended title."
      );
    }

    if (!youtubeFull.fullDescription) {
      throw new Error(
        "AI did not return a full description."
      );
    }

    if (youtubeFull.alternativeTitles.length < 3) {
      throw new Error(
        "AI did not return enough alternative titles."
      );
    }

    const { error: saveError } = await supabase
      .from("social_media_packs")
      .upsert(
        {
          song_id: song.id,
          user_id: user.id,
          youtube_full: youtubeFull,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "song_id,user_id",
        }
      );

    if (saveError) {
      throw new Error(
        `Could not save YouTube pack: ${saveError.message}`
      );
    }

    return NextResponse.json({
      projectId: song.id,
      youtubeFull,
      saved: true,
    });
  } catch (error) {
    console.error("YouTube full pack error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate YouTube full-song pack.",
      },
      { status: 500 }
    );
  }
}
