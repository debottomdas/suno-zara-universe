import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { MEDIA_BUCKET, cleanString } from "@/utils/media-source";

const THIRTY_DAYS = 30 * 24 * 60 * 60;

async function ownedSong(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase.from("songs").select("id").eq("id", projectId).eq("user_id", userId).single();
  return error ? null : data;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = cleanString(body.projectId);
    const storagePath = cleanString(body.storagePath);
    if (!projectId || !storagePath) return NextResponse.json({ error: "projectId and storagePath are required." }, { status: 400 });

    const song = await ownedSong(supabase, user.id, projectId);
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });
    const requiredPrefix = `${user.id}/${song.id}/buffer-temp/`;
    if (!storagePath.startsWith(requiredPrefix)) return NextResponse.json({ error: "Invalid Buffer staging path." }, { status: 400 });

    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(storagePath, THIRTY_DAYS);
    if (error || !data?.signedUrl) throw new Error(`Could not open staged Buffer video: ${error?.message || "No signed URL returned"}`);

    return NextResponse.json({ mediaUrl: data.signedUrl, expiresInSeconds: THIRTY_DAYS });
  } catch (error) {
    console.error("Buffer stage-complete error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not complete Buffer staging." }, { status: 500 });
  }
}
