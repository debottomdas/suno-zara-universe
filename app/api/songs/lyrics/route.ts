import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json();
    const projectId = String(body.projectId || "").trim();
    const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
    const lyrics = typeof body.lyrics === "string" ? body.lyrics : "";
    if (!projectId) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    if (!lyrics.trim()) return NextResponse.json({ error: "Lyrics cannot be empty." }, { status: 400 });

    const { data: current, error: currentError } = await supabase
      .from("songs")
      .select("id, channel_id, title, lyrics, updated_at")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single();
    if (currentError || !current) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    if (channelId && current.channel_id !== channelId) return NextResponse.json({ error: "Song not found in the selected channel." }, { status: 403 });

    const context: Record<string, string> = {};
    for (const key of ["title", "idea", "language", "script", "mood", "genre"]) {
      if (typeof body[key] === "string") context[key] = body[key].trim();
    }
    if (("title" in context && !context.title) || ("language" in context && !context.language)) {
      return NextResponse.json({ error: "Song title and language cannot be empty." }, { status: 400 });
    }
    const now = new Date().toISOString();
    if (current.lyrics?.trim() && current.lyrics !== lyrics) {
      const { error: versionError } = await supabase.from("song_versions").insert({
        song_id: projectId,
        user_id: user.id,
        title: current.title,
        lyrics: current.lyrics,
        version_type: "before-manual-lyrics-edit",
        created_at: current.updated_at || now,
      });
      if (versionError) return NextResponse.json({ error: "The previous lyrics could not be preserved, so the edit was not saved." }, { status: 500 });
    }

    const { data: song, error } = await supabase
      .from("songs")
      .update({ ...context, lyrics, status: "creating", updated_at: now })
      .eq("id", projectId)
      .eq("user_id", user.id)
      .select("id, lyrics, status, updated_at")
      .single();
    if (error || !song) return NextResponse.json({ error: error?.message || "Could not save lyrics." }, { status: 500 });

    return NextResponse.json({ projectId: song.id, lyrics: song.lyrics, status: song.status, updatedAt: song.updated_at, context, saved: true });
  } catch (error) {
    console.error("Save lyrics error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save lyrics." }, { status: 500 });
  }
}
