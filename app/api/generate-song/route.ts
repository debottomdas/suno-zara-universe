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
            "Please sign in to generate a song.",
        },
        { status: 401 }
      );
    }

    /*
     * 2. Read request.
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
     * 3. Load the song from Supabase.
     *
     * RLS means the logged-in user can only
     * retrieve their own song.
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

    if (!project.selected_hook) {
      return NextResponse.json(
        {
          error:
            "Please choose a hook first.",
        },
        { status: 400 }
      );
    }

    /*
     * 4. Generate complete song.
     */
    const response =
      await openai.responses.create({
        model: "gpt-5.6-luna",

        instructions: `
You are Suno Zara Universe Music Studio, an expert professional songwriter.

Write a complete original song based on the saved project.

IMPORTANT:

- The selected hook is the emotional anchor of the song.
- Build the rest of the song naturally around it.
- Do not simply repeat the same ideas in every section.
- Keep the song concise and memorable.
- Avoid clichés, filler lines, generic AI poetry and forced rhymes.
- Every section should advance the emotion or story.
- Lyrics must feel natural when sung.
- Use language appropriate to the listener and genre.
- Respect the requested script.

Song details:

Language: ${project.language}
Script: ${project.script}
Mood: ${project.mood}
Musical style: ${project.genre}
Creative freedom: ${project.freedom}/100

Original idea:

${project.idea}

Selected hook:

${project.selected_hook}

Use a suitable song structure.

For Hindi/Bengali/Indian songs, normally use:

[Intro]
[Mukhda / Chorus]
[Antara 1]
[Mukhda / Chorus]
[Antara 2]
[Final Chorus / Outro]

But change the structure if the song genuinely benefits from it.

The selected hook should appear naturally as the main chorus/refrain.

Return ONLY valid JSON.

Do not use markdown fences.

Use exactly this structure:

{
  "title": "song title",
  "lyrics": "complete lyrics with section labels"
}
`,

        input:
          "Generate the complete song now.",
      });

    const text =
      response.output_text.trim();

    const result = JSON.parse(text);

    if (
      typeof result.title !== "string" ||
      typeof result.lyrics !== "string"
    ) {
      throw new Error(
        "Invalid song response."
      );
    }

    const now =
      new Date().toISOString();

    /*
     * 5. If a complete song already exists,
     * preserve it in Version History first.
     */
    if (project.lyrics) {
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
            "before-full-regeneration",
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
              "The previous version could not be preserved, so the song was not regenerated.",
          },
          { status: 500 }
        );
      }
    }

    /*
     * 6. Save the newly generated song.
     */
    const {
      data: updatedSong,
      error: updateError,
    } = await supabase
      .from("songs")
      .update({
        title: result.title,
        lyrics: result.lyrics,
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
        "Supabase song update error:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "The song was generated but could not be saved.",
        },
        { status: 500 }
      );
    }


    /*
     * 8. Return same response shape
     * expected by existing UI.
     */
    return NextResponse.json({
      saved: true,
      title: updatedSong.title,
      lyrics: updatedSong.lyrics,
      status: updatedSong.status,
    });
  } catch (error) {
    console.error(
      "Full song generation error:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to generate the full song.",
      },
      { status: 500 }
    );
  }
}
