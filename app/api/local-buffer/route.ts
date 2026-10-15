import { NextRequest, NextResponse } from "next/server";
import { localChannels } from "@/utils/local-first/store";
import { assertLocalYouTubeRequest } from "@/utils/local-youtube/security";
import { listBufferConnections, saveBufferKey } from "@/utils/local-buffer/credentials";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    assertLocalYouTubeRequest(request);
    const [{ channels }, connections] = await Promise.all([localChannels(), listBufferConnections()]);
    const allowed = new Set(channels.map(c => c.id));
    return NextResponse.json({ connections: connections.filter(c => allowed.has(c.universeChannelId)) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Local Buffer status unavailable" }, { status: 403 }); }
}
export async function POST(request: NextRequest) {
  try {
    assertLocalYouTubeRequest(request);
    const origin = request.headers.get("origin");
    if (origin !== "http://localhost:3000" && origin !== "http://127.0.0.1:3000") return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    const data = await request.json();
    const channelId = typeof data.channelId === "string" ? data.channelId : "";
    const apiKey = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
    if (!channelId || !apiKey || apiKey.length > 4096) return NextResponse.json({ error: "Invalid channel or API key" }, { status: 400 });
    const { channels } = await localChannels();
    if (!channels.some(c => c.id === channelId)) return NextResponse.json({ error: "Unknown local channel" }, { status: 404 });
    await saveBufferKey(channelId, apiKey);
    return NextResponse.json({ saved: true, verified: false }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not save local Buffer credentials" }, { status: 500 }); }
}
