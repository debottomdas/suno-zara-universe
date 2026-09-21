import OpenAI from "openai";
import { NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    /*
     * 1. Verify the user BEFORE spending OpenAI credits.
     */
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Please sign in to create a song." },
        { status: 401 }
      );
    }

    /*
     * 2. Read songwriting request.
     */
    const body = await request.json();

    const {
      idea,
      language,
      script,
      mood,
      genre,
      freedom,
    } = body;

    if (!idea?.trim()) {
      return NextResponse.json(
        { error: "Please enter a song idea." },
        { status: 400 }
      );
    }

    /*
     * 3. Generate the three hooks.
     */
    const response = await openai.responses.create({
      model: "gpt-5.6-luna",

      instructions: `
You are Suno Zara Universe Music Studio, an expert multilingual lyric-writing assistant.

Create exactly 3 genuinely different song hooks.

Rules:

- Language: ${language}
- Script: ${script}
- Mood: ${mood}
- Musical style: ${genre}
- Creative freedom: ${freedom}/100
- Make each hook memorable, singable, emotional, and concise.
- Avoid clichés and filler.
- Each hook should feel like a different creative direction.
- Return ONLY valid JSON.
- Do not add markdown fences.
- Use this exact structure:

{
  "hooks": [
    "hook one",
    "hook two",
    "hook three"
  ]
}
`,

      input: `Song idea: ${idea}`,
    });

    const text = response.output_text.trim();
    const result = JSON.parse(text);

    if (
      !Array.isArray(result.hooks) ||
      result.hooks.length !== 3
    ) {
      throw new Error(
        "OpenAI did not return exactly three hooks."
      );
    }

    /*
     * 4. Save the new project to Supabase.
     *
     * Supabase generates the UUID.
     * We reuse that UUID as projectId everywhere else.
     */
    const {
      data: savedSong,
      error: saveError,
    } = await supabase
      .from("songs")
      .insert({
        user_id: user.id,
        idea,
        language,
        script,
        mood,
        genre,
        freedom: String(freedom ?? ""),
        hooks: result.hooks,
        selected_hook: null,
        lyrics: null,
        title: null,
        status: "hooks-generated",
      })
      .select("id, created_at, updated_at")
      .single();

    if (saveError || !savedSong) {
      console.error(
        "Supabase song save error:",
        saveError
      );

      return NextResponse.json(
        {
          error:
            "Hooks were generated but the song could not be saved.",
        },
        { status: 500 }
      );
    }

    const projectId = savedSong.id;


    /*
     * 6. Return the same shape expected by the existing UI.
     */
    return NextResponse.json({
      ...result,
      projectId,
      saved: true,
    });
  } catch (error) {
    console.error("Song generation error:", error);

    return NextResponse.json(
      { error: "Failed to generate hooks." },
      { status: 500 }
    );
  }
}
