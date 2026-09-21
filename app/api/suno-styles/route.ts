import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type SunoStyle = {
  name: string;
  category: string;
  recommended: boolean;
  whyItFits: string;
  prompt: string;
};

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

    const { data: savedStyles, error: stylesError } =
      await supabase
        .from("suno_styles")
        .select(
          `
          name,
          category,
          recommended,
          why_it_fits,
          prompt,
          created_at
          `
        )
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .order("created_at", {
          ascending: true,
        });

    if (stylesError) {
      throw new Error(
        `Could not load Suno styles: ${stylesError.message}`
      );
    }

    const styles = (savedStyles || []).map((style) => ({
      name: style.name,
      category: style.category || "Other",
      recommended: style.recommended,
      whyItFits: style.why_it_fits || "",
      prompt: style.prompt,
    }));

    return NextResponse.json({
      styles,
      projectId,
    });
  } catch (error) {
    console.error("Load Suno styles error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load Suno styles.",
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
    const additionalDirection =
      typeof body.additionalDirection === "string"
        ? body.additionalDirection.trim().slice(0, 600)
        : "";

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
        user_id,
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
        { error: "Generate the full song before creating Suno styles." },
        { status: 400 }
      );
    }

    const systemPrompt = `
You are an expert music producer, composer, arranger and Suno prompt designer.

Your job is to analyse a completed song and create between 5 and 8 genuinely different musical production directions that could be pasted directly into Suno's Style field.

These are NOT generic templates.

The user may also provide an ADDITIONAL MUSIC DIRECTION. Treat it as a production brief for the music only. It must influence arrangement, era, vocal texture, instrumentation, energy, tempo feel and production choices where relevant, but it must NOT rewrite or alter the supplied lyrics.

Every style must be specifically chosen for the supplied song based on:
- lyrics
- emotional meaning
- hook
- language
- mood
- genre
- pacing
- lyrical intensity
- structure
- likely melodic potential

IMPORTANT RULES:

1. Produce between 5 and 8 styles.
2. Each style must be meaningfully different musically.
3. Do not simply rewrite the same prompt with different adjectives.
4. Exactly ONE style must have "recommended": true.
5. The recommended style should be the musical direction you genuinely believe best suits the song.
6. Each Suno prompt may contain up to 1000 characters.
7. Do not pad prompts unnecessarily. Detail is useful only when musically meaningful.
8. The prompt must be ready to copy directly into Suno.
9. Do NOT include the song lyrics inside the Suno prompt.
10. Do NOT mention copyrighted artist names or imitate a specific living or identifiable artist.
11. You may describe eras, genres, instrumentation, production styles and musical traditions.

Where appropriate, vary directions across areas such as:
- contemporary Bollywood
- Indian indie
- acoustic
- unplugged
- cinematic
- lo-fi
- retro 70s / 80s / 90s flavour
- folk influence
- soft pop
- orchestral
- minimal
- experimental
- modern electronic-acoustic hybrid

But ONLY choose styles that genuinely suit this particular song.

Each Suno prompt should consider as many relevant details as useful:
- male, female, duet or flexible vocal
- vocal tone and texture
- emotional delivery
- tempo or perceived pace
- melodic character
- scale/mood where useful
- opening behaviour
- whether vocals begin immediately
- verse arrangement
- pre-chorus behaviour
- chorus lift
- hook treatment
- instrumentation
- percussion style
- bass treatment
- acoustic/electronic balance
- strings
- Indian instruments where appropriate
- production texture
- dynamic progression
- bridge/interlude behaviour
- final chorus treatment
- outro
- approximate song duration where useful
- elements to avoid

Prioritise SONGWRITING and MELODY over excessive production jargon.

For emotional songs, avoid making every option slow and sad.
For romantic songs, provide different emotional colours.
For nostalgic songs, distinguish authentic retro character from modern nostalgia.
For energetic songs, do not force acoustic ballad styles.

The options should feel like genuinely different ways a producer could interpret the same composition.

Return ONLY valid JSON in this exact structure:

{
  "styles": [
    {
      "name": "Short descriptive style name",
      "category": "Recommended | Modern | Indie | Retro | Cinematic | Acoustic | Experimental | Other",
      "recommended": true,
      "whyItFits": "One concise sentence explaining why this musical treatment fits this particular song.",
      "prompt": "Detailed Suno-ready style prompt, maximum 1000 characters."
    }
  ]
}
`.trim();

    const userPrompt = `
Analyse this completed song and create the strongest possible set of distinct Suno music-generation style prompts.

SONG TITLE:
${song.title || "Untitled"}

ORIGINAL IDEA:
${song.idea || "Not specified"}

LANGUAGE:
${song.language || "Not specified"}

SCRIPT:
${song.script || "Not specified"}

MOOD:
${song.mood || "Not specified"}

GENRE / DIRECTION:
${song.genre || "Not specified"}

CREATIVE FREEDOM:
${song.freedom || "Not specified"}

SELECTED HOOK:
${song.selected_hook || "Not specified"}

FULL LYRICS:
${song.lyrics}

ADDITIONAL MUSIC DIRECTION FROM THE USER:
${additionalDirection || "None — base the styles on the song itself."}

Choose styles based on what the song actually needs musically.

When an additional direction is supplied, make the recommended style honour it strongly while still respecting the emotional meaning and singability of the lyrics. The remaining options may explore adjacent alternatives rather than ignoring the user's brief.

Create 5 to 8 genuinely different options.
Mark exactly one as recommended.
Every Suno prompt must be no more than 1000 characters.
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
      throw new Error("No response received from the AI.");
    }

    let parsed: { styles?: SunoStyle[] };

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AI returned invalid JSON.");
    }

    if (!Array.isArray(parsed.styles)) {
      throw new Error("AI did not return a styles array.");
    }

    const styles = parsed.styles
      .filter(
        (style): style is SunoStyle =>
          typeof style?.name === "string" &&
          typeof style?.category === "string" &&
          typeof style?.recommended === "boolean" &&
          typeof style?.whyItFits === "string" &&
          typeof style?.prompt === "string"
      )
      .map((style) => ({
        ...style,
        name: style.name.trim(),
        category: style.category.trim(),
        whyItFits: style.whyItFits.trim(),
        prompt: style.prompt.trim().slice(0, 1000),
      }));

    if (styles.length < 5 || styles.length > 8) {
      throw new Error(
        `Expected 5 to 8 Suno styles, but received ${styles.length}.`
      );
    }

    const recommendedCount = styles.filter(
      (style) => style.recommended
    ).length;

    if (recommendedCount !== 1) {
      styles.forEach((style, index) => {
        style.recommended = index === 0;
      });
    }

    // Replace any previously generated Suno styles for this song.
    const { error: deleteStylesError } = await supabase
      .from("suno_styles")
      .delete()
      .eq("song_id", song.id)
      .eq("user_id", user.id);

    if (deleteStylesError) {
      throw new Error(
        `Could not replace previous Suno styles: ${deleteStylesError.message}`
      );
    }

    const stylesToSave = styles.map((style) => ({
      song_id: song.id,
      user_id: user.id,
      name: style.name,
      category: style.category,
      recommended: style.recommended,
      why_it_fits: style.whyItFits,
      prompt: style.prompt,
    }));

    const { error: saveStylesError } = await supabase
      .from("suno_styles")
      .insert(stylesToSave);

    if (saveStylesError) {
      throw new Error(
        `Could not save Suno styles: ${saveStylesError.message}`
      );
    }

    const { error: songStatusError } = await supabase
      .from("songs")
      .update({
        status: "creating",
        updated_at: new Date().toISOString(),
      })
      .eq("id", song.id)
      .eq("user_id", user.id);

    if (songStatusError) {
      throw new Error(
        `Suno styles were saved, but the song status could not be updated: ${songStatusError.message}`
      );
    }

    return NextResponse.json({
      styles,
      projectId: song.id,
      saved: true,
    });
  } catch (error) {
    console.error("Suno styles error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate Suno styles.",
      },
      { status: 500 }
    );
  }
}
