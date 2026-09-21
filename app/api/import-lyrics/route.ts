import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Please sign in to import lyrics." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const title = cleanString(body.title);
    const lyrics = cleanString(body.lyrics);

    const language =
      cleanString(body.language) || "Hindi";

    const script =
      cleanString(body.script) || "Native";

    const mood = cleanString(body.mood);

    const genre = cleanString(body.genre);

    const idea = cleanString(body.idea);

    const freedomValue = Number(body.freedom);

    const freedom = Number.isFinite(freedomValue)
      ? Math.max(0, Math.min(100, freedomValue))
      : 50;

    if (!title) {
      return NextResponse.json(
        { error: "Please enter the song title." },
        { status: 400 }
      );
    }

    if (!lyrics) {
      return NextResponse.json(
        { error: "Please paste the complete song lyrics." },
        { status: 400 }
      );
    }

    const {
      data: savedSong,
      error: saveError,
    } = await supabase
      .from("songs")
      .insert({
        user_id: user.id,

        // Imported songs use the same song record as
        // Studio-generated songs.
        idea,
        language,
        script,
        mood,
        genre,
        freedom: String(freedom),

        // Hook generation is intentionally skipped.
        hooks: [],
        selected_hook: null,

        // The finished song already exists.
        title,
        lyrics,

        status: "lyrics-imported",
      })
      .select(
        `
        id,
        created_at,
        updated_at,
        status,
        idea,
        language,
        script,
        mood,
        genre,
        freedom,
        hooks,
        selected_hook,
        title,
        lyrics
        `
      )
      .single();

    if (saveError || !savedSong) {
      console.error(
        "Imported lyrics save error:",
        saveError
      );

      return NextResponse.json(
        {
          error:
            "The lyrics could not be saved as a song project.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      projectId: savedSong.id,

      project: {
        id: savedSong.id,
        createdAt: savedSong.created_at,
        updatedAt: savedSong.updated_at,

        status: savedSong.status,

        idea: savedSong.idea || "",
        language: savedSong.language || "Hindi",
        script: savedSong.script || "Native",
        mood: savedSong.mood || "",
        genre: savedSong.genre || "",

        freedom:
          Number(savedSong.freedom) || 50,

        hooks: Array.isArray(savedSong.hooks)
          ? savedSong.hooks
          : [],

        selectedHook:
          savedSong.selected_hook || null,

        title: savedSong.title || "",
        lyrics: savedSong.lyrics || "",

        latestCritique: null,
        latestLineAnalysis: null,
      },

      saved: true,
      imported: true,
    });
  } catch (error) {
    console.error(
      "Import existing lyrics error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to import lyrics.",
      },
      { status: 500 }
    );
  }
}
