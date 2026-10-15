import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { localSong } from "@/utils/local-first/store";
import { assertLocalYouTubeRequest } from "@/utils/local-youtube/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX = 100 * 1024 * 1024;
const receiptFile = path.join(process.env.SZU_WORKER_ROOT || path.join(os.homedir(), "Suno Zara Universe"), "local-state", "cloudinary-publishing-receipts.json");
let receiptWrite = Promise.resolve();
async function loadReceipts(): Promise<Record<string, { videoUrl: string; publicId?: string; uploadedAt: string }>> {
  try { return JSON.parse(await readFile(receiptFile, "utf8")); } catch { return {}; }
}
async function storeReceipt(key: string, value: { videoUrl: string; publicId?: string; uploadedAt: string }) {
  const operation = receiptWrite.then(async () => {
    const existing = await loadReceipts();
    await mkdir(path.dirname(receiptFile), { recursive: true });
    const tmp = receiptFile + "." + process.pid + ".tmp";
    await writeFile(tmp, JSON.stringify({ ...existing, [key]: value }, null, 2), { mode: 0o600 });
    await rename(tmp, receiptFile);
  });
  receiptWrite = operation.catch(() => {});
  return operation;
}
const errorResponse = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  try {
    assertLocalYouTubeRequest(request);
    if (!["http://localhost:3000", "http://127.0.0.1:3000"].includes(request.headers.get("origin") || "")) return errorResponse("Invalid origin", 403);
    const { projectId, channelId, slot } = await request.json() as { projectId?: string; channelId?: string; slot?: number };
    if (!projectId || !channelId || !/^[a-zA-Z0-9-]{1,100}$/.test(projectId) || !/^[a-zA-Z0-9-]{1,100}$/.test(channelId) || !Number.isInteger(slot) || (slot || 0) < 1 || (slot || 0) > 6) return errorResponse("Invalid project, channel or Short slot");
    const song = await localSong(projectId);
    if (!song || song.channelId !== channelId) return errorResponse("Song does not belong to this local channel", 403);
    const cloud = process.env.CLOUDINARY_CLOUD_NAME, key = process.env.CLOUDINARY_API_KEY, secret = process.env.CLOUDINARY_API_SECRET;
    if (!cloud || !key || !secret || !/^[a-zA-Z0-9_-]+$/.test(cloud)) return errorResponse("Cloudinary is not configured on this Mac.", 503);
    const query = new URLSearchParams({ projectId, kind: "short", slot: String(slot) });
    const worker = await fetch(`http://127.0.0.1:47123/publishing/approved-video?${query}`, { cache: "no-store", signal: AbortSignal.timeout(45000) });
    if (!worker.ok) return errorResponse("Approved local Short not available. Check the worker and video approval.", 422);
    const length = Number(worker.headers.get("content-length") || 0);
    if (!length || length > MAX) return errorResponse("Approved Short must be between 1 byte and 100 MB", 413);
    const bytes = Buffer.from(await worker.arrayBuffer());
    if (bytes.length !== length) return errorResponse("Incomplete local video transfer", 502);
    const mime = worker.headers.get("content-type") === "video/quicktime" ? "video/quicktime" : "video/mp4";
    const extension = mime === "video/quicktime" ? "mov" : "mp4";
    const publicId = createHash("sha256").update(bytes).digest("hex");
    const receiptKey = `${channelId}:${projectId}:short:${slot}:${publicId}`;
    const existingReceipt = (await loadReceipts())[receiptKey];
    if (existingReceipt?.videoUrl) return NextResponse.json({ status: "already_uploaded", projectId, channelId, slot, videoUrl: existingReceipt.videoUrl, publicId: existingReceipt.publicId, uploadedAt: existingReceipt.uploadedAt }, { headers: { "Cache-Control": "no-store" } });
    const folder = `suno-zara-universe/${channelId}`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHash("sha1").update(`folder=${folder}&overwrite=false&public_id=${publicId}&timestamp=${timestamp}` + secret).digest("hex");
    const upload = new FormData();
    upload.set("file", new Blob([new Uint8Array(bytes)], { type: mime }), `short-${slot}.${extension}`);
    upload.set("api_key", key); upload.set("timestamp", timestamp); upload.set("folder", folder); upload.set("public_id", publicId); upload.set("overwrite", "false"); upload.set("signature", signature);
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/video/upload`, { method: "POST", body: upload, signal: AbortSignal.timeout(120000) });
    const data = await response.json() as { secure_url?: string; public_id?: string; error?: { message?: string } };
    if (!response.ok || !data.secure_url) return errorResponse(data.error?.message || "Cloudinary upload failed", 502);
    const url = new URL(data.secure_url);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") return errorResponse("Unexpected Cloudinary URL", 502);
    const uploadedAt = new Date().toISOString();
    await storeReceipt(receiptKey, { videoUrl: data.secure_url, publicId: data.public_id, uploadedAt });
    return NextResponse.json({ status: "uploaded", projectId, channelId, slot, videoUrl: data.secure_url, publicId: data.public_id, uploadedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Publishing media preparation failed", 502);
  }
}
