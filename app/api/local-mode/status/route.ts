import { NextResponse } from "next/server";
import { localModeAvailable, readLocalWorkspace } from "@/utils/local-first/store";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  if (!localModeAvailable()) {
    return NextResponse.json({ localRuntime: false, cloudOnline: true, localMode: false });
  }

  const local = await readLocalWorkspace();
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
