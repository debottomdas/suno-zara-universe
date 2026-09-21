import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type VisualConcept = {
  conceptNumber: number;
  title: string;
  description: string;
  imagePrompt: string;
};

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
    const userIdeas = String(body.userIdeas || "").trim();

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
        {
          error:
            "Generate the full song before creating visual concepts.",
        },
        { status: 400 }
      );
    }

    const systemPrompt = `
You are an expert music-video creative director, visual storyteller,
cinematographer and album-art director.

Your job is to analyse a COMPLETE original song and create exactly
THREE genuinely different visual concepts for artwork and short-form
music-video imagery.

These must NOT be generic AI music posters.

Each concept must emerge from the actual meaning, emotion, imagery,
characters, memories, relationships and atmosphere of the supplied song.

IMPORTANT RULES:

1. Return exactly 3 concepts.
2. All 3 concepts must be meaningfully different from one another.
3. Do not merely change colours, lighting or camera angles.
4. Each concept should represent a different visual interpretation of
   the song.
5. Concepts should work for both cinematic 16:9 YouTube imagery and
   9:16 Shorts/Reels/TikTok adaptations.
6. Prefer emotionally specific scenes over generic decorative imagery.
7. Human characters may be used where appropriate.
8. When the song context is Indian, Hindi or Bengali, preserve
   culturally believable clothing, environment and visual details.
9. Avoid repetitive AI-poster clichés.
10. Avoid making everything dark, gloomy or blue unless the song
    genuinely requires it.
11. Do not embed the song title, lyrics, subtitles, logos, branding,
    watermark or other text inside the generated artwork.
12. Do not use celebrity likenesses or copyrighted characters.
13. Do not create collages or split-screen compositions.
14. Leave typography to a later application layer.
15. The final artwork should feel like a beautifully art-directed
    frame from a film, music video or premium editorial shoot.

Each concept must contain:

- conceptNumber
- title
- description
- imagePrompt

DESCRIPTION:
Explain the creative idea and why it fits this specific song.

IMAGE PROMPT:
Write a detailed master art direction suitable for a high-quality
image-generation model.

The image prompt should describe relevant details such as:

- scene
- characters
- age range where useful
- body language
- wardrobe
- environment
- era
- composition
- camera perspective
- lighting
- colour character
- emotional atmosphere
- cinematic texture
- cultural details
- important objects
- foreground/background relationship
- realism/stylisation level

Do not put platform dimensions in the master image prompt. The final
generation API will handle landscape and portrait framing separately.

Return ONLY valid JSON in this exact structure:

{
  "concepts": [
    {
      "conceptNumber": 1,
      "title": "Short distinctive concept name",
      "description": "Why this direction suits the song.",
      "imagePrompt": "Detailed master visual direction."
    },
    {
      "conceptNumber": 2,
      "title": "Short distinctive concept name",
      "description": "Why this direction suits the song.",
      "imagePrompt": "Detailed master visual direction."
    },
    {
      "conceptNumber": 3,
      "title": "Short distinctive concept name",
      "description": "Why this direction suits the song.",
      "imagePrompt": "Detailed master visual direction."
    }
  ]
}
`.trim();

    const userPrompt = `
Analyse this complete song and create exactly THREE strong,
meaningfully different visual concepts.

SONG TITLE:

${song.title || "Untitled"}

ORIGINAL SONG IDEA:

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

OPTIONAL CREATOR VISUAL DIRECTION:

${userIdeas || "No additional visual direction supplied."}

The complete song must remain the primary source of visual meaning.

The creator's visual direction is additional guidance only.

Create three concepts that feel genuinely different enough that the
creator has three real artistic choices.
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

    let parsed: { concepts?: VisualConcept[] };

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AI returned invalid JSON.");
    }

    if (!Array.isArray(parsed.concepts)) {
      throw new Error("AI did not return a concepts array.");
    }

    const concepts = parsed.concepts
      .filter(
        (concept): concept is VisualConcept =>
          Number.isInteger(concept?.conceptNumber) &&
          typeof concept?.title === "string" &&
          typeof concept?.description === "string" &&
          typeof concept?.imagePrompt === "string"
      )
      .map((concept, index) => ({
        conceptNumber: index + 1,
        title: concept.title.trim(),
        description: concept.description.trim(),
        imagePrompt: concept.imagePrompt.trim(),
      }));

    if (concepts.length !== 3) {
      throw new Error(
        `Expected exactly 3 visual concepts, but received ${concepts.length}.`
      );
    }

    const { error: deleteConceptsError } = await supabase
      .from("song_visual_concepts")
      .delete()
      .eq("song_id", song.id)
      .eq("user_id", user.id);

    if (deleteConceptsError) {
      throw new Error(
        `Could not replace previous visual concepts: ${deleteConceptsError.message}`
      );
    }

    const conceptsToSave = concepts.map((concept) => ({
      song_id: song.id,
      user_id: user.id,
      user_ideas: userIdeas || null,
      concept_number: concept.conceptNumber,
      title: concept.title,
      description: concept.description,
      image_prompt: concept.imagePrompt,
      selected: false,
    }));

    const { data: savedConcepts, error: saveConceptsError } =
      await supabase
        .from("song_visual_concepts")
        .insert(conceptsToSave)
        .select(
          `
          id,
          concept_number,
          title,
          description,
          image_prompt,
          selected
          `
        )
        .order("concept_number", {
          ascending: true,
        });

    if (saveConceptsError) {
      throw new Error(
        `Could not save visual concepts: ${saveConceptsError.message}`
      );
    }

    const returnedConcepts = (savedConcepts || []).map(
      (concept) => ({
        id: concept.id,
        conceptNumber: concept.concept_number,
        title: concept.title,
        description: concept.description,
        imagePrompt: concept.image_prompt,
        selected: concept.selected,
      })
    );

    return NextResponse.json({
      concepts: returnedConcepts,
      projectId: song.id,
      saved: true,
    });
  } catch (error) {
    console.error("Visual concepts error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to generate visual concepts.",
      },
      { status: 500 }
    );
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

    const { data: savedConcepts, error: conceptsError } =
      await supabase
        .from("song_visual_concepts")
        .select(
          `
          id,
          concept_number,
          title,
          description,
          image_prompt,
          user_ideas,
          selected,
          created_at
          `
        )
        .eq("song_id", projectId)
        .eq("user_id", user.id)
        .order("concept_number", {
          ascending: true,
        });

    if (conceptsError) {
      throw new Error(
        `Could not load visual concepts: ${conceptsError.message}`
      );
    }

    const concepts = (savedConcepts || []).map((concept) => ({
      id: concept.id,
      conceptNumber: concept.concept_number,
      title: concept.title,
      description: concept.description,
      imagePrompt: concept.image_prompt,
      selected: Boolean(concept.selected),
    }));

    const selectedConcept =
      concepts.find((concept) => concept.selected) || null;

    return NextResponse.json({
      concepts,
      selectedConceptId: selectedConcept?.id || null,
      userIdeas: savedConcepts?.[0]?.user_ideas || "",
      projectId,
    });
  } catch (error) {
    console.error("Load visual concepts error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load visual concepts.",
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
    const conceptId = String(body.conceptId || "").trim();

    if (!projectId || !conceptId) {
      return NextResponse.json(
        { error: "projectId and conceptId are required." },
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

    const { data: concept, error: conceptError } = await supabase
      .from("song_visual_concepts")
      .select("id")
      .eq("id", conceptId)
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .single();

    if (conceptError || !concept) {
      return NextResponse.json(
        { error: "Visual concept not found." },
        { status: 404 }
      );
    }

    const { error: resetError } = await supabase
      .from("song_visual_concepts")
      .update({ selected: false })
      .eq("song_id", projectId)
      .eq("user_id", user.id);

    if (resetError) {
      throw new Error(
        `Could not reset visual selection: ${resetError.message}`
      );
    }

    const { error: selectError } = await supabase
      .from("song_visual_concepts")
      .update({ selected: true })
      .eq("id", conceptId)
      .eq("song_id", projectId)
      .eq("user_id", user.id);

    if (selectError) {
      throw new Error(
        `Could not save visual selection: ${selectError.message}`
      );
    }

    return NextResponse.json({
      projectId,
      selectedConceptId: conceptId,
      saved: true,
    });
  } catch (error) {
    console.error("Save visual selection error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save visual selection.",
      },
      { status: 500 }
    );
  }
}

