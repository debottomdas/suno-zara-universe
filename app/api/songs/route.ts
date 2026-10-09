import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { cacheSongs, createLocalSong, localModeAvailable, localSongs, updateLocalSong } from "@/utils/local-first/store";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    const channelId =
      new URL(request.url).searchParams.get("channelId")?.trim() || "";

    if (userError || !user) {
      if (channelId && localModeAvailable()) {
        const local = await localSongs(channelId);
        if (local.projects.length) return NextResponse.json(local);
      }
      if (channelId && localModeAvailable()) return NextResponse.json(await localSongs(channelId));
      return NextResponse.json({ error: "channelId is required." }, { status: 400 });
    }

    if (!channelId) {
      return NextResponse.json(
        { error: "channelId is required." },
        { status: 400 }
      );
    }

    // Verify the selected channel belongs to this user's workspace.
    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, workspace_id, workspaces!inner(owner_user_id)")
      .eq("id", channelId)
      .eq("workspaces.owner_user_id", user.id)
      .single();

    if (channelError || !channel) {
      return NextResponse.json(
        { error: "The selected channel is not available." },
        { status: 403 }
      );
    }

    const {
      data: songs,
      error: songsError,
    } = await supabase
      .from("songs")
      .select(`
        id,
        title,
        english_title,
        idea,
        language,
        script,
        mood,
        genre,
        freedom,
        hooks,
        selected_hook,
        lyrics,
        status,
        created_at,
        updated_at
      `)
      .eq("user_id", user.id)
      .eq("channel_id", channel.id)
      .order("updated_at", {
        ascending: false,
      });

    if (songsError) {
      console.error(
        "Supabase songs load error:",
        songsError
      );

      return NextResponse.json(
        { error: "Failed to load saved songs." },
        { status: 500 }
      );
    }

    const projects = (songs ?? []).map(
      (song) => ({
        id: song.id,
        projectId: song.id,

        title: song.title,
        englishTitle: song.english_title || "",
        idea: song.idea,
        language: song.language,
        script: song.script,
        mood: song.mood,
        genre: song.genre,
        freedom: song.freedom,

        hooks: song.hooks ?? [],

        selectedHook:
          song.selected_hook,

        lyrics: song.lyrics,

        status: song.status,

        createdAt:
          song.created_at,

        updatedAt:
          song.updated_at,
      })
    );

    await cacheSongs(channelId, projects);
    return NextResponse.json({
      projects,
      localMode: false,
    });
  } catch (error) {
    const channelId = new URL(request.url).searchParams.get("channelId")?.trim() || "";
    if (channelId && localModeAvailable()) {
      const local = await localSongs(channelId);
      if (local.projects.length) return NextResponse.json(local);
    }
    console.error(
      "Failed to load songs:",
      error
    );

    return NextResponse.json(
      { error: "Failed to load saved songs." },
      { status: 500 }
    );
  }
}


export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    const body = await request.json();
    const projectId = String(body.projectId || "").trim();
    const status = String(body.status || "").trim();
    const allowed = new Set([
      "creating",
      "ready-for-suno",
      "release-ready",
      "published",
    ]);

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required." },
        { status: 400 }
      );
    }

    if ((userError || !user) && localModeAvailable()) { if(!projectId)return NextResponse.json({error:"projectId is required."},{status:400}); if(!allowed.has(status))return NextResponse.json({error:"Unsupported song status."},{status:400}); const song=await updateLocalSong(projectId,{status}); if(!song)return NextResponse.json({error:"Song not found."},{status:404}); return NextResponse.json({projectId,status,updatedAt:song.updatedAt,saved:true,localMode:true}); }
    if (userError || !user) return NextResponse.json({ error: "Please sign in to update your song." }, { status: 401 });

    if (!allowed.has(status)) {
      return NextResponse.json(
        { error: "Unsupported song status." },
        { status: 400 }
      );
    }

    const { data: song, error } = await supabase
      .from("songs")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId)
      .eq("user_id", user.id)
      .select("id, status, updated_at")
      .single();

    if (error || !song) {
      return NextResponse.json(
        { error: error?.message || "Song not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      projectId: song.id,
      status: song.status,
      updatedAt: song.updated_at,
      saved: true,
    });
  } catch (error) {
    console.error("Failed to update song:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update song.",
      },
      { status: 500 }
    );
  }
}

// Asset-first intake reuses songs and the same channel ownership boundary as lyrics import.
export async function POST(request: Request) {
  try {
    const db = await createClient();
    const { data: { user }, error: authError } = await db.auth.getUser();
    const body = await request.json();
    const clean = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
    const requestId=clean(body.projectId,100);
    if(requestId&&!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))return NextResponse.json({error:'Invalid project request.'},{status:400});
    const channelId = clean(body.channelId, 100), title = clean(body.title, 120), englishTitle = clean(body.englishTitle, 120), language = clean(body.language, 80);
    if (!channelId || !title || !language) return NextResponse.json({error: 'Choose a channel and enter the song title and language.'}, {status: 400});
    if ((authError || !user) && localModeAvailable()) { const project=await createLocalSong(channelId,{projectId:requestId||undefined,title,englishTitle,language,idea:clean(body.idea,4000)}); if(!project)return NextResponse.json({error:'The selected local channel is not available.'},{status:403}); return NextResponse.json({projectId:project.id,project,saved:true,localMode:true},{status:201}); }
    if (authError || !user) return NextResponse.json({error:'Please sign in to create a project.'},{status:401});
    const {data: channel, error: channelError} = await db.from('channels').select('id, workspaces!inner(owner_user_id)').eq('id', channelId).eq('workspaces.owner_user_id', user.id).single();
    if (channelError || !channel) return NextResponse.json({error: 'The selected channel is not available.'}, {status: 403});
    const {data: project, error} = await db.from('songs').insert({...(requestId?{id:requestId}:{}),user_id:user.id, channel_id:channel.id, title, english_title:englishTitle||null, language, idea:clean(body.idea, 4000), script:'Native', mood:'', genre:'', freedom:'50', hooks:[], selected_hook:null, lyrics:null, status:'creating'}).select('id,title,language,idea,lyrics,status,hooks').single();
    if(error?.code==='23505'&&requestId){const {data:existing}=await db.from('songs').select('id,title,language,idea,lyrics,status,hooks').eq('id',requestId).eq('user_id',user.id).eq('channel_id',channel.id).single();if(existing)return NextResponse.json({projectId:existing.id,project:existing,saved:true});}
    if (error || !project) return NextResponse.json({error:'The project could not be saved. Your details are still available to retry.'}, {status:500});
    return NextResponse.json({projectId:project.id, project, saved:true});
  } catch { return NextResponse.json({error:'Could not create the project.'}, {status:500}); }
}
