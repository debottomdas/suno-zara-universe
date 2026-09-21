import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

const PLATFORMS = new Set(["youtube", "facebook", "instagram", "tiktok"]);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const platform = typeof body?.platform === "string" ? body.platform.trim() : "";
    const connectionId = typeof body?.connectionId === "string" ? body.connectionId.trim() : "";

    if (!PLATFORMS.has(platform) || !connectionId) {
      return NextResponse.json({ error: "A valid platform and connectionId are required." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
      .from("publishing_connections")
      .select("id, platform, status")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .eq("platform", platform)
      .single();

    if (targetError || !target) {
      return NextResponse.json({ error: "Connected account not found." }, { status: 404 });
    }

    if (target.status !== "connected") {
      return NextResponse.json({ error: "Only a connected account can be made primary." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { error: clearError } = await admin
      .from("publishing_connections")
      .update({ is_primary: false, updated_at: now })
      .eq("user_id", user.id)
      .eq("platform", platform);

    if (clearError) {
      throw new Error(`Could not clear the previous primary account: ${clearError.message}`);
    }

    const { error: setError } = await admin
      .from("publishing_connections")
      .update({ is_primary: true, updated_at: now })
      .eq("id", connectionId)
      .eq("user_id", user.id);

    if (setError) {
      throw new Error(`Could not set the primary account: ${setError.message}`);
    }

    return NextResponse.json({ ok: true, platform, connectionId });
  } catch (error) {
    console.error("Set primary publishing connection error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update the primary account." },
      { status: 500 }
    );
  }
}
