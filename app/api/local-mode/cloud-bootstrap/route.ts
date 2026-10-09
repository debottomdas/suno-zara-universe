import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function clean(v: unknown) { return typeof v === "string" ? v.trim() : ""; }

export async function GET(request: Request) {
  // Hosted-only export: localhost consumes this payload but can never create it.
  if (process.env.VERCEL !== "1") {
    return NextResponse.json({ error: "Cloud bootstrap is available only on the hosted Universe." }, { status: 404 });
  }

  const url = new URL(request.url);
  const returnTo = clean(url.searchParams.get("returnTo"));
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/local-mode\/bootstrap\/receive$/i.test(returnTo)) {
    return NextResponse.json({ error: "Invalid local return address." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", url.pathname + url.search);
    return NextResponse.redirect(login);
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces").select("id,name,entitlements").eq("owner_user_id", user.id)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });

  const { data: channels, error: channelsError } = await supabase.from("channels")
    .select("id,workspace_id,name,description,language,channel_type,profile,is_archived,created_at,updated_at")
    .eq("workspace_id", workspace.id).eq("is_archived", false).order("created_at", { ascending: true });
  if (channelsError) throw channelsError;

  const songsByChannel: Record<string, any[]> = {};
  for (const channel of channels || []) {
    const { data: songs, error } = await supabase.from("songs").select(
      "id,title,english_title,idea,language,script,mood,genre,freedom,hooks,selected_hook,lyrics,status,created_at,updated_at"
    ).eq("user_id", user.id).eq("channel_id", channel.id).order("updated_at", { ascending: false });
    if (error) throw error;
    songsByChannel[channel.id] = (songs || []).map(song => ({
      id: song.id, projectId: song.id, title: song.title, englishTitle: song.english_title || "",
      idea: song.idea, language: song.language, script: song.script, mood: song.mood, genre: song.genre,
      freedom: song.freedom, hooks: song.hooks ?? [], selectedHook: song.selected_hook, lyrics: song.lyrics,
      status: song.status, createdAt: song.created_at, updatedAt: song.updated_at
    }));
  }

  const payload = Buffer.from(JSON.stringify({ workspace, channels: channels || [], songsByChannel }), "utf8").toString("base64url");
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><body><p>Copying your Suno Zara workspace to this Mac…</p><form id="bootstrap" method="post" action="${escape(returnTo)}"><input type="hidden" name="payload" value="${escape(payload)}"></form><script>document.getElementById('bootstrap').submit()</script></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}
