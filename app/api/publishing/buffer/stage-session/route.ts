import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { MEDIA_BUCKET, cleanString, safeFilename } from "@/utils/media-source";

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const MIME_TYPES = new Set(["video/mp4", "video/quicktime"]);

async function ownedSong(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase.from("songs").select("id,title").eq("id", projectId).eq("user_id", userId).single();
  return error ? null : data;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = cleanString(body.projectId);
    const slot = Number(body.slot);
    const originalFilename = cleanString(body.originalFilename) || `short-${slot}.mp4`;
    const mimeType = cleanString(body.mimeType).toLowerCase();
    const sizeBytes = Number(body.sizeBytes);

    if (!projectId || !Number.isInteger(slot) || slot < 1 || slot > 6) {
      return NextResponse.json({ error: "projectId and Short slot 1–6 are required." }, { status: 400 });
    }
    if (!MIME_TYPES.has(mimeType) || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: "Buffer staging accepts MP4/MOV videos up to 1 GB." }, { status: 400 });
    }

    const song = await ownedSong(supabase, user.id, projectId);
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const storagePath = `${user.id}/${song.id}/buffer-temp/short-${slot}/${crypto.randomUUID()}-${safeFilename(originalFilename)}`;
    const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data?.token) throw new Error(`Could not prepare temporary Buffer upload: ${error?.message || "No upload token returned"}`);

    const signedUploadUrl = (data as any).signedUrl || "";
    if (!signedUploadUrl) throw new Error("Supabase did not return a signed upload URL.");

    return NextResponse.json({
      upload: {
        bucket: MEDIA_BUCKET,
        storagePath,
        signedUploadUrl,
        token: data.token,
        originalFilename,
        mimeType,
        sizeBytes,
        slot,
      },
    });
  } catch (error) {
    console.error("Buffer stage-session error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not prepare Buffer staging." }, { status: 500 });
  }
}
