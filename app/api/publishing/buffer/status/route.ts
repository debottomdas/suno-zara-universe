import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { bufferConfigured, loadBufferChannels } from "@/utils/buffer-api";

const SUPPORTED = new Set(["tiktok", "instagram", "facebook"]);

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    if (!bufferConfigured()) {
      return NextResponse.json({ configured: false, channels: [] });
    }

    const channels = (await loadBufferChannels()).filter((channel) => SUPPORTED.has(String(channel.service || "").toLowerCase()));
    return NextResponse.json({ configured: true, channels });
  } catch (error) {
    console.error("Buffer status error:", error);
    return NextResponse.json({
      configured: bufferConfigured(),
      channels: [],
      error: error instanceof Error ? error.message : "Could not load Buffer channels.",
    }, { status: 500 });
  }
}
