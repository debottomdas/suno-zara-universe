import { NextRequest, NextResponse } from "next/server";
import { localChannels } from "@/utils/local-first/store";
import { assertLocalYouTubeRequest } from "@/utils/local-youtube/security";
import { verifyLocalBuffer } from "@/utils/local-buffer/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertLocalYouTubeRequest(request);
    const channelId = request.nextUrl.searchParams.get("channelId") || "";
    const { channels } = await localChannels();
    if (!channels.some(c => c.id === channelId)) return NextResponse.json({ error: "Unknown local channel" }, { status: 404 });
    const result = await verifyLocalBuffer(channelId);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Buffer verification failed";
    return NextResponse.json({ status: "verification_failed", error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
