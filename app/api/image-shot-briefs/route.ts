import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ImageFormat = "youtube" | "shorts";

type ShotBrief = {
  imageNumber: number;
  role: string;
  brief: string;
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
    const conceptId = String(body.conceptId || "").trim();
    const format = String(body.format || "youtube").trim() as ImageFormat;

    if (!projectId || !conceptId) {
      return NextResponse.json(
        { error: "projectId and conceptId are required." },
        { status: 400 }
      );
    }

    if (format !== "youtube" && format !== "shorts") {
      return NextResponse.json(
        { error: "format must be youtube or shorts." },
        { status: 400 }
      );
    }

    const { data: song, error: songError } = await supabase
      .from("songs")
      .select(`
        id,
        user_id,
        title,
        idea,
        language,
        mood,
        genre,
        selected_hook,
        lyrics
      `)
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
      .select(`
        id,
        song_id,
        user_id,
        title,
        description,
        image_prompt,
        user_ideas
      `)
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

    const isYouTube = format === "youtube";
    const count = isYouTube ? 3 : 6;

    const roleInstructions = isYouTube
      ? `
IMAGE 1 — CINEMATIC WORLD
- wide or very wide frame
- environment dominates
- subject small / off-centre / partly obscured
- no close portrait

IMAGE 2 — HUMAN MOMENT
- medium or medium-close
- body language and emotion dominate
- different narrative moment
- environment secondary

IMAGE 3 — CONCEPTUAL / ART-DIRECTED
- must not resemble Image 2
- use reflection, silhouette, object, negative space,
  foreground obstruction, unusual viewpoint or partial human presence
- avoid a standard portrait
`
      : `
IMAGE 1 — VERTICAL WORLD
- strong 9:16 environmental composition
- architecture/location/landscape important
- subject smaller or secondary
- layered depth from foreground to background

IMAGE 2 — INTIMATE HUMAN MOMENT
- medium-close vertical framing
- expressive natural gesture/body language
- emotional face/profile/back-view where appropriate
- environment secondary

IMAGE 3 — MOVEMENT / ACTION
- walking, turning, leaving, arriving, reaching,
  running, dancing, travelling or another meaningful action
- visible sense of movement
- not a static portrait

IMAGE 4 — SYMBOLIC / OBJECT-LED
- symbolic object, shadow, reflection, texture,
  meaningful detail or visual metaphor
- ideally no conventional portrait
- substantially different visual hierarchy

IMAGE 5 — NEGATIVE SPACE / ARCHITECTURAL
- strong use of empty space, doorway, corridor,
  street geometry, landscape, interior geometry or framing device
- unusual subject placement
- composition should feel graphic and bold

IMAGE 6 — CLOSE EMOTIONAL DETAIL
- extreme close detail, profile, silhouette,
  hand/gesture/detail, back-view or partial figure
- intimate but visually different from Image 2
- do not repeat Image 2 camera distance or pose
`;

    const systemPrompt = `
You are a senior music-video director, cinematographer and visual editor.

Create exactly ${count} shot briefs for ${count} separate
${isYouTube ? "16:9 landscape" : "9:16 vertical"} images.

THE MOST IMPORTANT REQUIREMENT:

EVERY IMAGE MUST LOOK OBVIOUSLY AND SUBSTANTIALLY DIFFERENT.

Design the entire set together before answering.

The images must NOT feel like alternate takes of the same photograph.

HARD DIVERSITY RULES:

Across the complete set, deliberately vary:

- camera distance
- camera height
- camera angle
- subject placement
- number of visible people
- focal point
- narrative moment
- body language
- foreground/background structure
- location or part of location where possible
- movement versus stillness
- human presence versus object/environment focus
- negative space
- visual hierarchy

STRICTLY AVOID:

- repeating the same pose
- repeating the same couple arrangement
- repeating the same centred subject
- repeating the same camera distance
- repeating the same background structure
- merely changing colour or lighting
- generating a collection of similar portraits
- placing the subject in the same part of every image

${roleInstructions}

All images must still belong to the SAME selected visual concept
and the SAME song.

The set should feel curated like frames selected from a professionally
directed music film — coherent in identity but strongly varied in imagery.

Do not include text, title, lyrics, logo, subtitle or watermark.

Return ONLY valid JSON:

{
  "briefs": [
    {
      "imageNumber": 1,
      "role": "Role name",
      "brief": "Detailed generation-ready shot direction"
    }
  ]
}
`.trim();

    const userPrompt = `
SONG TITLE:
${song.title || "Untitled"}

LANGUAGE:
${song.language || "Not specified"}

MOOD:
${song.mood || "Not specified"}

GENRE:
${song.genre || "Not specified"}

SELECTED HOOK:
${song.selected_hook || "Not specified"}

FULL LYRICS:
${song.lyrics || ""}

SELECTED VISUAL CONCEPT:
${concept.title}

CONCEPT DESCRIPTION:
${concept.description}

MASTER VISUAL DIRECTION:
${concept.image_prompt}

CREATOR NOTES:
${concept.user_ideas || "None"}

Create exactly ${count} visually distinct ${isYouTube ? "landscape" : "vertical"} shot briefs.

Before returning them, compare every brief against every other brief.

Remove any repeated:
- composition
- camera distance
- pose
- subject arrangement
- focal point
- visual hierarchy
- narrative moment

The final set must be immediately distinguishable even when viewed as small thumbnails.
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
      throw new Error("No shot briefs returned from AI.");
    }

    let parsed: { briefs?: ShotBrief[] };

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("AI returned invalid shot-brief JSON.");
    }

    if (!Array.isArray(parsed.briefs)) {
      throw new Error("AI did not return a briefs array.");
    }

    const briefs = parsed.briefs
      .filter(
        (brief): brief is ShotBrief =>
          Number.isInteger(brief?.imageNumber) &&
          typeof brief?.role === "string" &&
          typeof brief?.brief === "string"
      )
      .slice(0, count)
      .map((brief, index) => ({
        imageNumber: index + 1,
        role: brief.role.trim(),
        brief: brief.brief.trim(),
      }));

    if (briefs.length !== count) {
      throw new Error(
        `Expected ${count} shot briefs, received ${briefs.length}.`
      );
    }

    return NextResponse.json({
      format,
      briefs,
    });
  } catch (error) {
    console.error("Image shot briefs error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to create image shot briefs.",
      },
      { status: 500 }
    );
  }
}
