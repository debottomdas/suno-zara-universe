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


export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Please sign in to update your song." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const projectId = String(body.projectId || "").trim();
    const status = String(body.status || "").trim();
    const allowed = new Set([
      "creating",
      "ready-for-suno",
      "release-ready",
      "published",
    ]);

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    if (!allowed.has(status)) {
      return NextResponse.json(
        { error: "Unsupported song status." },
        { status: 400 }
      );
    }

    const { data: song, error } = await supabase
      .from("songs")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", user.id)
      .select("id, status, updated_at")
      .single();

    if (error || !song) {
      return NextResponse.json(
        { error: error?.message || "Song not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      projectId: song.id,
      status: song.status,
      updatedAt: song.updated_at,
      saved: true,
    });
  } catch (error) {
    console.error("Failed to update song:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update song.",
      },
      { status: 500 }
    );
  }
}
