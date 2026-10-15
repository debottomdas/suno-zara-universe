import { NextResponse } from "next/server";
import { localModeAvailable, readLocalWorkspace } from "@/utils/local-first/store";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  if (!localModeAvailable()) {
    return NextResponse.json({ localRuntime: false, cloudOnline: true, localMode: false });
  }

  const local = await readLocalWorkspace();
  const host = request.headers.get("host");
  if (host === "localhost:3000" || host === "127.0.0.1:3000") {
    return NextResponse.json({
      localRuntime: true,
      cloudOnline: false,
      localMode: true,
      snapshotReady: local.channels.length > 0,
      syncedAt: local.syncedAt,
    });
  }
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    const cloudOnline = !error && Boolean(user);
    return NextResponse.json({
      localRuntime: true,
      cloudOnline,
      localMode: !cloudOnline,
      snapshotReady: local.channels.length > 0,
      syncedAt: local.syncedAt,
    });
  } catch {
    return NextResponse.json({
      localRuntime: true,
      cloudOnline: false,
      localMode: true,
      snapshotReady: local.channels.length > 0,
      syncedAt: local.syncedAt,
    });
  }
}
