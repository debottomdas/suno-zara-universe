import {applyChannelPublishing} from '@/utils/channel-dna/social';
import {resolveActiveChannelDNA} from '@/utils/channel-dna/server';
import {saveSocialPack} from '@/utils/social/persistence';
import {buildYouTubeCredits,buildFinalYouTubeDescription,generateYouTubeFullPack} from '@/utils/social/youtube-full-generator';
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

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
      .select("id,channel_id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();

    if (songError || !song) {
      return NextResponse.json(
        { error: "Song not found." },
        { status: 404 }
      );
    }

    const channelContext = await resolveActiveChannelDNA(
      supabase,
      user.id,
      song.channel_id
    );

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
        cta: channelContext.dna?.sections.publishing.fields.youtubeFullCta ||
          "❤️ Enjoyed the song? Subscribe for more Suno Zara originals.",
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

    const { error: saveError } = await saveSocialPack(supabase,user.id,projectId,{
          song_id: projectId,
          user_id: user.id,
          youtube_full: cleanedPack,
          updated_at: new Date().toISOString(),
        });

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
        channel_id,
        id,
        title,
        english_title,
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

    const channelContext = await resolveActiveChannelDNA(supabase,user.id,song.channel_id);
    const {youtubeFull} = await generateYouTubeFullPack({
      song,
      channelContext,
      generatorGuidance,
      releaseDetails,
    });

    const { error: saveError } = await saveSocialPack(supabase,user.id,projectId,{
          song_id: song.id,
          user_id: user.id,
          youtube_full: youtubeFull,
          updated_at: new Date().toISOString(),
        },false,{context:channelContext,song});

    if (saveError) {
      throw new Error(
        `Could not save YouTube pack: ${saveError.message}`
      );
    }

    Object.assign(youtubeFull,applyChannelPublishing(channelContext,song,'youtube_full',youtubeFull));

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
