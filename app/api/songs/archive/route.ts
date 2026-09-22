import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: "Please sign in to update your song." }, { status: 401 });
    }

    const body = await request.json();
    const projectId = String(body.projectId || "").trim();
    const archived = Boolean(body.archived);
    if (!projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    // Archive is intentionally a lightweight catalogue state. Finished songs are
    // restored to Published so they return to the normal completed-song view.
    const status = archived ? "archived" : "published";
    const updatedAt = new Date().toISOString();
    const { data: song, error } = await supabase
      .from("songs")
      .update({ status, updated_at: updatedAt })
      .eq("id", projectId)
      .eq("user_id", user.id)
      .select("id, status, updated_at")
      .single();

    if (error || !song) {
      return NextResponse.json({ error: error?.message || "Song not found." }, { status: 404 });
    }

    return NextResponse.json({
      projectId: song.id,
      status: song.status,
      updatedAt: song.updated_at,
      archived,
      saved: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update archive status." },
      { status: 500 }
    );
  }
}
