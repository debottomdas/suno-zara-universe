import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { createClient } from "@/utils/supabase/server";
import { cleanString, resolveLocalPath } from "@/utils/media-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const url = new URL(request.url);
    const assetId = cleanString(url.searchParams.get("assetId"));
    const download = url.searchParams.get("download") === "1";
    if (!assetId) return NextResponse.json({ error: "assetId is required." }, { status: 400 });

    const { data: asset, error } = await supabase
      .from("song_media_assets")
      .select("id, user_id, original_filename, storage_provider, local_path, mime_type, size_bytes")
      .eq("id", assetId)
      .eq("user_id", user.id)
      .single();

    if (error || !asset || asset.storage_provider !== "local" || !asset.local_path) {
      return NextResponse.json({ error: "Local media file not found." }, { status: 404 });
    }

    const absolute = resolveLocalPath(asset.local_path);
    const info = await stat(absolute);
    const total = info.size;
    const range = request.headers.get("range");
    const baseHeaders: Record<string, string> = {
      "content-type": asset.mime_type || "application/octet-stream",
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
    };
    if (download) {
      const filename = asset.original_filename.replace(/["\r\n]/g, "_");
      baseHeaders["content-disposition"] = `attachment; filename="${filename}"`;
    }

    if (range && !download) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
        if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < total) {
          const stream = createReadStream(absolute, { start, end });
          return new Response(Readable.toWeb(stream) as any, {
            status: 206,
            headers: {
              ...baseHeaders,
              "content-range": `bytes ${start}-${end}/${total}`,
              "content-length": String(end - start + 1),
            },
          });
        }
      }
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
    }

    const stream = createReadStream(absolute);
    return new Response(Readable.toWeb(stream) as any, {
      headers: { ...baseHeaders, "content-length": String(total) },
    });
  } catch (error) {
    console.error("Local media read error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read local media file." },
      { status: 500 }
    );
  }
}
