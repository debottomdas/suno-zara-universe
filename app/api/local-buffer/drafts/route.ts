import { NextRequest, NextResponse } from "next/server";
import { localChannels } from "@/utils/local-first/store";
import { assertLocalYouTubeRequest } from "@/utils/local-youtube/security";
import { createLocalBufferDraft } from "@/utils/local-buffer/drafts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertLocalYouTubeRequest(request);
    const origin = request.headers.get("origin");
    if (origin !== "http://localhost:3000" && origin !== "http://127.0.0.1:3000")
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const data = await request.json() as Record<string, unknown>;
    const channelId = typeof data.channelId === "string" ? data.channelId : "";
    const bufferChannelId = typeof data.bufferChannelId === "string" ? data.bufferChannelId : "";
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!channelId || !bufferChannelId || !text || text.length > 3000)
      return NextResponse.json({ error: "Invalid channel, destination or draft text." }, { status: 400 });
    const { channels } = await localChannels();
    if (!channels.some(c => c.id === channelId))
      return NextResponse.json({ error: "Unknown local Universe channel." }, { status: 404 });
    const result = await createLocalBufferDraft(channelId, bufferChannelId, text);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Draft creation failed." }, { status: 502 });
  }
}
