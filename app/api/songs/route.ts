import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Please sign in to view your songs." },
        { status: 401 }
      );
    }

    const {
      data: songs,
      error: songsError,
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
      .order("updated_at", {
        ascending: false,
      });

    if (songsError) {
      console.error(
        "Supabase songs load error:",
        songsError
      );

      return NextResponse.json(
        { error: "Failed to load saved songs." },
        { status: 500 }
      );
    }

    const projects = (songs ?? []).map(
      (song) => ({
        id: song.id,
        projectId: song.id,

        title: song.title,
        idea: song.idea,
        language: song.language,
        script: song.script,
        mood: song.mood,
        genre: song.genre,
        freedom: song.freedom,

        hooks: song.hooks ?? [],

        selectedHook:
          song.selected_hook,

        lyrics: song.lyrics,

        status: song.status,

        createdAt:
          song.created_at,

        updatedAt:
          song.updated_at,
      })
    );

    return NextResponse.json({
      projects,
    });
  } catch (error) {
    console.error(
      "Failed to load songs:",
      error
    );

    return NextResponse.json(
      { error: "Failed to load saved songs." },
      { status: 500 }
    );
  }
}
