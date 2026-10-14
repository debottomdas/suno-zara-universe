import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { localChannels } from "@/utils/local-first/store";
import { assertLocalYouTubeRequest } from "@/utils/local-youtube/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BYTES = 100 * 1024 * 1024;
const allowed = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function POST(request: NextRequest) {
  try {
    assertLocalYouTubeRequest(request);
    if (!["http://localhost:3000", "http://127.0.0.1:3000"].includes(request.headers.get("origin") || "")) return fail("Invalid origin", 403);
    const cloud = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const secret = process.env.CLOUDINARY_API_SECRET;
    if (!cloud || !apiKey || !secret) return fail("Cloudinary is not configured on this Mac. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in .env.local.", 503);
    if (!/^[a-zA-Z0-9_-]+$/.test(cloud)) return fail("Invalid Cloudinary cloud name", 503);
    const form = await request.formData();
    const channelId = form.get("channelId");
    const file = form.get("video");
    if (typeof channelId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(channelId)) return fail("Invalid channel");
    const { channels } = await localChannels();
    if (!channels.some(c => c.id === channelId)) return fail("Unknown local Universe channel", 404);
    if (!(file instanceof File) || !allowed.has(file.type) || !file.size || file.size > MAX_BYTES) return fail("Choose an MP4, MOV or WebM video up to 100 MB.");
    const filename = file.name.toLowerCase();
    if (!/\.(mp4|mov|webm)$/.test(filename)) return fail("Unsupported video extension.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = `suno-zara-universe/${channelId}`;
    const publicId = createHash("sha256").update(bytes).digest("hex");
    const toSign = `folder=${folder}&overwrite=false&public_id=${publicId}&timestamp=${timestamp}`;
    const signature = createHash("sha1").update(toSign + secret).digest("hex");
    const upload = new FormData();
    upload.set("file", new Blob([new Uint8Array(bytes)], { type: file.type }), file.name);
    upload.set("api_key", apiKey);
    upload.set("timestamp", timestamp);
    upload.set("folder", folder);
    upload.set("public_id", publicId);
    upload.set("overwrite", "false");
    upload.set("signature", signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/video/upload`, { method: "POST", body: upload, signal: AbortSignal.timeout(120000) });
    const data = await response.json() as { secure_url?: string; public_id?: string; error?: { message?: string } };
    if (!response.ok || !data.secure_url || !data.public_id) return fail(data.error?.message || "Cloudinary upload failed", 502);
    const url = new URL(data.secure_url);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") return fail("Unexpected Cloudinary response", 502);
    return NextResponse.json({ videoUrl: data.secure_url, publicId: data.public_id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Video upload failed", 502);
  }
}
