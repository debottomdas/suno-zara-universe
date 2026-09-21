import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Please sign in to select a hook." },
        { status: 401 }
      );
    }

    const body = await request.json();

    const {
      projectId,
      selectedHook,
    } = body;

    if (
      !projectId ||
      !selectedHook?.trim()
    ) {
      return NextResponse.json(
        {
          error:
            "Project ID and selected hook are required.",
        },
        { status: 400 }
      );
    }

    const {
      data: existingSong,
      error: loadError,
    } = await supabase
      .from("songs")
      .select(`
        id,
        title,
        lyrics,
        selected_hook
      `)
      .eq("id", projectId)
      .single();

    if (loadError || !existingSong) {
      return NextResponse.json(
        {
          error:
            "Song not found or you do not have access to it.",
        },
        { status: 404 }
      );
    }

    const hookChanged =
      existingSong.selected_hook !== selectedHook;

    const updateData: {
      selected_hook: string;
      status: string;
      updated_at: string;
      title?: null;
      lyrics?: null;
    } = {
      selected_hook: selectedHook,
      status: "hook-selected",
      updated_at: new Date().toISOString(),
    };

    if (
      hookChanged &&
      existingSong.lyrics
    ) {
      updateData.title = null;
      updateData.lyrics = null;
    }

    const {
      data: updatedSong,
      error: updateError,
    } = await supabase
      .from("songs")
      .update(updateData)
      .eq("id", projectId)
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
      .single();

    if (updateError || !updatedSong) {
      console.error(
        "Failed to update selected hook:",
        updateError
      );

      return NextResponse.json(
        {
          error:
            "Failed to save selected hook.",
        },
        { status: 500 }
      );
    }

    const project = {
      id: updatedSong.id,
      projectId: updatedSong.id,

      title: updatedSong.title,
      idea: updatedSong.idea,
      language: updatedSong.language,
      script: updatedSong.script,
      mood: updatedSong.mood,
      genre: updatedSong.genre,
      freedom: updatedSong.freedom,

      hooks: updatedSong.hooks ?? [],

      selectedHook:
        updatedSong.selected_hook,

      lyrics: updatedSong.lyrics,

      status: updatedSong.status,

      createdAt:
        updatedSong.created_at,

      updatedAt:
        updatedSong.updated_at,
    };

    return NextResponse.json({
      saved: true,
      project,
    });
  } catch (error) {
    console.error(
      "Failed to save selected hook:",
      error
    );

    return NextResponse.json(
      {
        error:
          "Failed to save selected hook.",
      },
      { status: 500 }
    );
  }
}
