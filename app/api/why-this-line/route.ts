import OpenAI from "openai";
import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    /*
     * 1. Verify logged-in user.
     */
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          error:
            "Please sign in to analyse lyrics.",
        },
        { status: 401 }
      );
    }

    /*
     * 2. Validate request.
     */
    const body = await request.json();

    const {
      projectId,
      text,
      line,
    } = body;

    const selectedText =
      typeof text === "string" &&
      text.trim()
        ? text.trim()
        : typeof line === "string"
        ? line.trim()
        : "";

    if (
      typeof projectId !== "string" ||
      !projectId.trim()
    ) {
      return NextResponse.json(
        { error: "Invalid project." },
        { status: 400 }
      );
    }

    if (!selectedText) {
      return NextResponse.json(
        {
          error:
            "Please enter one or more lyric lines to analyse.",
        },
        { status: 400 }
      );
    }

    /*
     * 3. Load song from Supabase.
     *
     * RLS ensures this user can only access
     * their own song.
     */
    const {
      data: project,
      error: projectError,
    } = await supabase
      .from("songs")
      .select(`
        id,
        title,
        idea,
        language,
        script,
        mood,
        genre,
        freedom,
        hooks,
        selected_hook,
        lyrics,
        status,
        created_at,
        updated_at
      `)
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return NextResponse.json(
        {
          error:
            "Song not found or you do not have access to it.",
        },
        { status: 404 }
      );
    }

    if (!project.lyrics) {
      return NextResponse.json(
        {
          error:
            "Generate the full song before analysing lyrics.",
        },
        { status: 400 }
      );
    }

    /*
     * 4. Analyse selected lyrics.
     *
     * Prompt behaviour intentionally preserved.
     */
    const response =
      await openai.responses.create({
        model: "gpt-5.6-luna",

        instructions: `
You are Suno Zara Universe Music Studio's senior lyric editor.

The user may give you:

- one lyric line,

- several connected lines,

- a stanza,

- or an entire song section.

Analyse the selected lyrics in the context of the COMPLETE SONG.

Do NOT rewrite the full song.

Do NOT manufacture criticism when the writing is already strong.

SONG DETAILS

Language: ${project.language}

Script: ${project.script}

Mood: ${project.mood}

Musical style: ${project.genre}

Original idea:

${project.idea}

Selected hook:

${project.selected_hook || "None"}

SELECTED LYRICS TO ANALYSE:

${selectedText}

COMPLETE SONG:

${project.lyrics}

ANALYSE:

1. Literal meaning.

2. Emotional meaning beneath the words.

3. What role these lines perform in the song.

4. How well the lines connect to each other.

5. How naturally they connect to the surrounding section.

6. Emotional progression.

7. Originality.

8. Clichés or generic / AI-like writing.

9. Singability.

10. Rhythm and line length.

11. Word choice.

12. Whether any line is weaker than the others.

13. Whether the passage should be kept, refined or replaced.

If multiple lines are provided:

- Evaluate them as a passage, not as isolated sentences.

- Identify the strongest line if there is one.

- Identify the weakest line only if there genuinely is one.

- Explain whether the emotional movement between the lines feels natural.

- Notice repetition of meaning, not just repetition of words.

LANGUAGE GUIDANCE

For Hindi:

- Prefer natural contemporary Hindi/Hindustani.

- Avoid unnecessarily difficult Urdu words unless the song style genuinely calls for them.

- Do not flag normal everyday Hindustani vocabulary merely because it originated from Urdu.

For Bengali:

- Prefer natural contemporary Bengali.

- Avoid wording that feels translated, overly literary or unnatural unless the song deliberately calls for that tone.

ALTERNATIVES

Always provide exactly 3 alternatives.

Even if the selected lyric is already strong and the verdict is "keep", still provide 3 optional alternatives that preserve the same emotional meaning but explore different wording, rhythm, imagery, or phrasing.

If one line is weak:

- Suggest 3 replacement options for that line.

If multiple connected lines or a complete passage are selected:

- Suggest 3 alternative versions of the complete selected passage.

Each alternative must replace the same amount of selected material.

Do not shorten a multi-line selection into a single line unless there is a strong artistic reason.

Do not change the underlying emotional intention unless that intention itself is the problem.

Alternatives should sound natural, singable, and genuinely different from one another.

Never return an empty alternatives array.

Return ONLY valid JSON.

Do not use markdown fences.

Use exactly this structure:

{
  "selectedText": "the lyrics being analysed",
  "meaning": "what the selected lyrics mean",
  "emotionalPurpose": "their emotional or narrative role",
  "flow": "how well the lines work together and progress emotionally",
  "context": "how they connect to the surrounding song",
  "originality": "assessment of freshness, clichés and generic wording",
  "singability": "assessment of rhythm, line length and natural singing flow",
  "wordChoice": "assessment of the wording and language",
  "strongestLine": "strongest line, or empty string if not meaningful to choose one",
  "weakestLine": "weakest line, or empty string if there is no genuine weak line",
  "verdict": "keep | refine | replace",
  "reason": "concise explanation of the verdict",
  "alternatives": [
    "alternative version one",
    "alternative version two",
    "alternative version three"
  ]
}
`,

        input:
          "Analyse the selected lyrics professionally.",
      });

    const textOutput =
      response.output_text.trim();

    const result =
      JSON.parse(textOutput);

    if (
      typeof result.selectedText !==
        "string" ||
      typeof result.meaning !==
        "string" ||
      typeof result.emotionalPurpose !==
        "string" ||
      typeof result.flow !==
        "string" ||
      typeof result.context !==
        "string" ||
      typeof result.originality !==
        "string" ||
      typeof result.singability !==
        "string" ||
      typeof result.wordChoice !==
        "string" ||
      typeof result.strongestLine !==
        "string" ||
      typeof result.weakestLine !==
        "string" ||
      typeof result.verdict !==
        "string" ||
      typeof result.reason !==
        "string" ||
      !Array.isArray(
        result.alternatives
      )
    ) {
      throw new Error(
        "Invalid lyric analysis response."
      );
    }

    if (
      result.alternatives.length !== 3
    ) {
      throw new Error(
        "Lyric analysis must return exactly 3 alternatives."
      );
    }

    const now =
      new Date().toISOString();

    const analysis = {
      createdAt:
        now,

      songUpdatedAt:
        project.updated_at || null,

      ...result,
    };


    /*
     * 6. Return same response shape expected
     * by the current Studio UI.
     */
    return NextResponse.json({
      saved: true,
      analysis,
    });
  } catch (error) {
    console.error(
      "Why This Line error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to analyse the selected lyrics.",
      },
      { status: 500 }
    );
  }
}
