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
            "Please sign in to rewrite a song.",
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
      sectionName,
      instruction,
    } = body;

    if (
      typeof projectId !== "string" ||
      !projectId.trim()
    ) {
      return NextResponse.json(
        { error: "Invalid project." },
        { status: 400 }
      );
    }

    if (
      typeof sectionName !== "string" ||
      !sectionName.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "Please choose a section to rewrite.",
        },
        { status: 400 }
      );
    }

    if (
      typeof instruction !== "string" ||
      !instruction.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "Please tell me how you want this section improved.",
        },
        { status: 400 }
      );
    }

    /*
     * 3. Load current song from Supabase.
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
            "This project does not have a full song yet.",
        },
        { status: 400 }
      );
    }

    /*
     * 4. Ask OpenAI to rewrite only
     * the requested section.
     */
    const response =
      await openai.responses.create({
        model: "gpt-5.6-luna",

        instructions: `
You are Suno Zara Universe Music Studio, an expert professional songwriter and lyric editor.

Your job is to rewrite ONLY ONE requested section of an existing song.

STRICT RULES:

1. Rewrite only the requested section.
2. Keep every other section unchanged.
3. Preserve the overall emotional story and meaning of the song.
4. Preserve the selected hook / chorus unless the requested section itself is the hook.
5. Do not unnecessarily rewrite surrounding lines.
6. Avoid clichés, generic AI poetry, filler and forced rhymes.
7. Make the rewritten section natural, memorable and singable.
8. Follow the user's rewrite instruction closely.
9. Maintain the same language and script as the original song.
10. Return the COMPLETE song with the rewritten section inserted into its correct place.
11. Do not remove section labels.
12. Do not add explanations inside the lyrics.

Song language:

${project.language}

Script:

${project.script}

Mood:

${project.mood}

Musical style:

${project.genre}

Selected hook:

${project.selected_hook || "None"}

SECTION TO REWRITE:

${sectionName}

USER'S REWRITE REQUEST:

${instruction}

CURRENT COMPLETE SONG:

${project.lyrics}

Return ONLY valid JSON.

Do not use markdown fences.

Use exactly this structure:

{
  "updatedLyrics": "complete song with only the requested section rewritten",
  "rewrittenSection": "the newly rewritten section only"
}
`,

        input:
          "Rewrite the requested section now.",
      });

    const text =
      response.output_text.trim();

    const result = JSON.parse(text);

    if (
      typeof result.updatedLyrics !==
        "string" ||
      typeof result.rewrittenSection !==
        "string"
    ) {
      throw new Error(
        "Invalid rewrite response."
      );
    }

    const now =
      new Date().toISOString();

    /*
     * 5. Preserve current song in
     * Supabase Version History BEFORE
     * changing the lyrics.
     *
     * We temporarily use original_text
     * and replacement_text to retain the
     * section name and rewrite instruction.
     */
    const {
      error: versionError,
    } = await supabase
      .from("song_versions")
      .insert({
        song_id: project.id,
        user_id: user.id,
        title: project.title,
        lyrics: project.lyrics,
        version_type:
          "before-section-rewrite",
        original_text: sectionName,
        replacement_text: instruction,
        created_at:
          project.updated_at || now,
      });

    if (versionError) {
      console.error(
        "Version save error:",
        versionError
      );

      return NextResponse.json(
        {
          error:
            "The previous version could not be preserved, so the rewrite was not saved.",
        },
        { status: 500 }
      );
    }

    /*
     * 6. Update current song in Supabase.
     */
    const {
      data: updatedSong,
      error: updateError,
    } = await supabase
      .from("songs")
      .update({
        lyrics: result.updatedLyrics,
        status: "song-generated",
        updated_at: now,
      })
      .eq("id", project.id)
      .select(`
        id,
        title,
        lyrics,
        status,
        updated_at
      `)
      .single();

    if (updateError || !updatedSong) {
      console.error(
        "Supabase rewrite update error:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "The rewritten song could not be saved.",
        },
        { status: 500 }
      );
    }


    /*
     * 8. Return same response expected
     * by the existing Studio UI.
     */
    return NextResponse.json({
      saved: true,
      title:
        updatedSong.title || "",
      lyrics:
        updatedSong.lyrics,
      rewrittenSection:
        result.rewrittenSection,
      sectionName,
    });
  } catch (error) {
    console.error(
      "Section rewrite error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to rewrite the section.",
      },
      { status: 500 }
    );
  }
}
