import { NextRequest, NextResponse } from "next/server";
import { localChannels } from "@/utils/local-first/store";
import { listLocalYouTubeConnections } from "@/utils/local-youtube/credentials";
import { assertLocalYouTubeRequest } from "@/utils/local-youtube/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    assertLocalYouTubeRequest(request);
    const [{ channels }, connections] = await Promise.all([
      localChannels(),
      listLocalYouTubeConnections(),
    ]);
    const allowed = new Set(channels.map((channel) => channel.id));
    return NextResponse.json({
      connections: connections.filter((connection) =>
        allowed.has(connection.universeChannelId)
      ),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Local YouTube connections unavailable." },
      { status: 403 }
    );
  }
}
