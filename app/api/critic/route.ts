import OpenAI from "openai";
import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenAI API key is not configured." },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey,
    });
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
            "Please sign in to use Critic Mode.",
        },
        { status: 401 }
      );
    }

    /*
     * 2. Validate request.
     */
    const body = await request.json();

    const { projectId } = body;

    if (
      typeof projectId !== "string" ||
      !projectId.trim()
    ) {
      return NextResponse.json(
        { error: "Invalid project." },
        { status: 400 }
      );
    }

    /*
     * 3. Load song from Supabase.
     *
     * RLS ensures the user can only access
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
            "Generate the full song before using Critic Mode.",
        },
        { status: 400 }
      );
    }

    /*
     * 4. Run Critic Mode.
     *
     * Prompt behaviour intentionally preserved.
     */
    const response =
      await openai.responses.create({
        model: "gpt-5.6-luna",

        instructions: `
You are the senior lyric editor inside Suno Zara Universe Music Studio.

Your job is to CRITIQUE an existing song.

Do NOT rewrite the complete song.

Do NOT praise weak writing just to be polite.

Be constructive, specific and demanding.

Evaluate the song as a professional songwriter, lyric editor and music listener.

SONG DETAILS

Language: ${project.language}

Script: ${project.script}

Mood: ${project.mood}

Musical style: ${project.genre}

Original song idea:

${project.idea}

Selected hook:

${project.selected_hook || "None"}

FULL SONG:

${project.lyrics}

Evaluate these areas:

1. Hook strength

2. Emotional impact

3. Originality

4. Clichés

5. Repetition

6. Natural language

7. Singability

8. Rhythm and line length

9. Story or emotional progression

10. Strength of Antaras / Verses

11. Chorus payoff

12. Ending

13. Lines that feel generic or AI-written

14. Lines that are especially strong

Be culturally and linguistically aware.

For Hindi songs:

- Flag unnecessary Urdu vocabulary if simpler natural Hindi would suit the song better.

- Do not treat normal commonly-used Hindustani words as a problem.

For Bengali songs:

- Prefer natural contemporary Bengali over overly literary or unnatural wording unless the song clearly calls for it.

IMPORTANT:

- Quote only short relevant lines from the song.

- Identify exactly what works and what does not.

- Do not manufacture problems just to fill the response.

- A strong song can have fewer issues.

- Suggestions should explain the direction for improvement, not automatically rewrite everything.

Give an overall score from 1 to 10.

Return ONLY valid JSON.

Do not use markdown fences.

Use exactly this structure:

{
  "score": 8,
  "verdict": "short overall assessment",
  "strengths": [
    "specific strength",
    "specific strength"
  ],
  "issues": [
    {
      "section": "Antara 1",
      "line": "short quoted line",
      "severity": "high",
      "problem": "what is weak",
      "why": "why it weakens the song",
      "suggestion": "direction for improving it"
    }
  ],
  "strongLines": [
    {
      "line": "short quoted line",
      "why": "why this line works"
    }
  ],
  "priority": [
    "most important improvement",
    "second most important improvement",
    "third most important improvement"
  ]
}
`,

        input:
          "Critique this song professionally.",
      });

    const text =
      response.output_text.trim();

    const result =
      JSON.parse(text);

    if (
      typeof result.score !==
        "number" ||
      typeof result.verdict !==
        "string" ||
      !Array.isArray(
        result.strengths
      ) ||
      !Array.isArray(
        result.issues
      ) ||
      !Array.isArray(
        result.strongLines
      ) ||
      !Array.isArray(
        result.priority
      )
    ) {
      throw new Error(
        "Invalid critic response."
      );
    }

    const now =
      new Date().toISOString();

    const critique = {
      createdAt: now,

      songUpdatedAt:
        project.updated_at || null,

      score:
        result.score,

      verdict:
        result.verdict,

      strengths:
        result.strengths,

      issues:
        result.issues,

      strongLines:
        result.strongLines,

      priority:
        result.priority,
    };


    return NextResponse.json({
      saved: true,
      critique,
    });
  } catch (error) {
    console.error(
      "Critic Mode error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to critique the song.",
      },
      { status: 500 }
    );
  }
}
