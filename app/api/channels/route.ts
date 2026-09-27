import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

async function ensureWorkspace(supabase: any, user: any) {
  const { data: existing, error: loadError } = await supabase
    .from("workspaces").select("id, name, entitlements").eq("owner_user_id", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (loadError) throw loadError;
  if (existing) return existing;

  const fallbackName = clean(user.user_metadata?.display_name) || clean(user.user_metadata?.full_name) || "My Workspace";
  const { data: workspace, error } = await supabase.from("workspaces")
    .insert({ owner_user_id: user.id, name: fallbackName, entitlements: { channel_limit: null } })
    .select("id, name, entitlements").single();
  if (error || !workspace) {
    // A simultaneous request may have created the workspace first.
    if (error?.code === "23505") {
      const { data: racedWorkspace, error: reloadError } = await supabase
        .from("workspaces")
        .select("id, name, entitlements")
        .eq("owner_user_id", user.id)
        .single();

      if (reloadError || !racedWorkspace) {
        throw reloadError || new Error("Could not load workspace after concurrent creation.");
      }

      return racedWorkspace;
    }

    throw error || new Error("Could not create workspace.");
  }
  await supabase.from("workspace_members").upsert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
  return workspace;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    const workspace = await ensureWorkspace(supabase, user);
    let { data: channels, error } = await supabase.from("channels")
      .select("id, workspace_id, name, description, language, channel_type, profile, is_archived, created_at, updated_at")
      .eq("workspace_id", workspace.id).eq("is_archived", false).order("created_at", { ascending: true });
    if (error) throw error;
    if (!channels?.length) {
      const { data: first, error: createError } = await supabase.from("channels")
        .insert({ workspace_id: workspace.id, name: "Suno Zara", channel_type: "music", profile: {} })
        .select("id, workspace_id, name, description, language, channel_type, profile, is_archived, created_at, updated_at").single();

      if (createError || !first) {
        // Another simultaneous request may have created the first channel.
        if (createError?.code === "23505") {
          const { data: racedChannels, error: reloadError } = await supabase
            .from("channels")
            .select("id, workspace_id, name, description, language, channel_type, profile, is_archived, created_at, updated_at")
            .eq("workspace_id", workspace.id)
            .eq("is_archived", false)
            .order("created_at", { ascending: true });

          if (reloadError || !racedChannels?.length) {
            throw reloadError || new Error("Could not load channel after concurrent creation.");
          }

          channels = racedChannels;
        } else {
          throw createError || new Error("Could not create first channel.");
        }
      } else {
        channels = [first];

        // Existing unassigned songs become part of the first channel.
        const { error: backfillError } = await supabase
          .from("songs")
          .update({ channel_id: first.id })
          .eq("user_id", user.id)
          .is("channel_id", null);

        if (backfillError) throw backfillError;
      }
    }
    return NextResponse.json({ workspace, channels });
  } catch (error) {
    console.error("Channels GET error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load channels." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
    const workspace = await ensureWorkspace(supabase, user);
    const body = await request.json();
    const name = clean(body.name);
    if (!name) return NextResponse.json({ error: "Channel name is required." }, { status: 400 });
    const { data: channel, error } = await supabase.from("channels").insert({
      workspace_id: workspace.id, name, description: clean(body.description) || null,
      language: clean(body.language) || null, channel_type: clean(body.channelType) || "music",
      profile: body.profile && typeof body.profile === "object" ? body.profile : {},
    }).select("id, workspace_id, name, description, language, channel_type, profile, is_archived, created_at, updated_at").single();
    if (error || !channel) throw error || new Error("Could not create channel.");
    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    console.error("Channels POST error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create channel." }, { status: 500 });
  }
}
