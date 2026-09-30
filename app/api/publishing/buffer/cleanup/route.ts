import { createAdminClient } from "@/utils/supabase/admin";
import { bufferGraphqlDetailed, assertBufferBudget } from "@/utils/buffer-api";
import { bufferAccessToken } from "@/utils/buffer-oauth";
import { canCleanBufferMedia } from "@/utils/buffer-cleanup-policy";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { MEDIA_BUCKET, cleanString } from "@/utils/media-source";

async function ownedSong(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase.from("songs").select("id").eq("id", projectId).eq("user_id", userId).single();
  return error ? null : data;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = cleanString(body.projectId);
    const storagePath = cleanString(body.storagePath);
    if (!projectId || !storagePath) return NextResponse.json({ error: "projectId and storagePath are required." }, { status: 400 });

    const song = await ownedSong(supabase, user.id, projectId);
    if (!song) return NextResponse.json({ error: "Song not found." }, { status: 404 });

    const requiredPrefix = `${user.id}/${song.id}/buffer-temp/`;
    if (!storagePath.startsWith(requiredPrefix) || storagePath.split("/").some(part => !part || part === "." || part === "..")) return NextResponse.json({ error: "Invalid Buffer staging path." }, { status: 400 });

    const admin = createAdminClient();
    const { data: media, error: ledgerError } = await admin.from("buffer_staged_media").select("state,attempts,buffer_account_id").eq("storage_path", storagePath).eq("song_id", projectId).eq("user_id", user.id).maybeSingle();
    // Missing migration, legacy files, failed/ambiguous creates, and retries all fail closed.
    if (ledgerError || !media || media.state !== "submitted" || !Array.isArray(media.attempts) || !media.attempts.length || media.attempts.some((a:any)=>!a.postId)) {
      return NextResponse.json({ error: "Media is protected: complete server-side dependency records are required before cleanup." }, { status: 409 });
    }
    const token = media.buffer_account_id ? await bufferAccessToken(media.buffer_account_id, user.id) : undefined;
    assertBufferBudget(token);
    const ids = [...new Set<string>(media.attempts.map((a:any)=>String(a.postId)))];
    if (ids.length > 30) return NextResponse.json({error:"Media dependencies require manual review."},{status:409});
    const defs = ids.map((_,i)=>`$p${i}: PostInput!`).join(",");
    const fields = ids.map((_,i)=>`p${i}: post(input:$p${i}) { id channelId status }`).join(" ");
    const remote = await bufferGraphqlDetailed<Record<string,any>>(`query CleanupDependencies(${defs}) { ${fields} }`, Object.fromEntries(ids.map((id,i)=>[`p${i}`,{id}])), token);
    if (!canCleanBufferMedia(media.state, media.attempts, Object.values(remote.data).filter(Boolean))) {
      return NextResponse.json({ error: "Media is still required by a Buffer draft, scheduled post, failed post, or unverified dependency." }, { status: 409 });
    }
    // A staging path can be claimed for creation only once. This compare-and-set
    // prevents concurrent cleanup and new posting against a deletion candidate.
    const {data:locked,error:lockError}=await admin.from("buffer_staged_media").update({state:"deleting"}).eq("storage_path",storagePath).eq("song_id",projectId).eq("user_id",user.id).eq("state","submitted").select("storage_path").maybeSingle();
    if(lockError || !locked)return NextResponse.json({error:"Media cleanup is already in progress or protected."},{status:409});
    const { error } = await supabase.storage.from(MEDIA_BUCKET).remove([storagePath]);
    if (error) throw new Error(`Could not clean temporary Buffer media: ${error.message}`);

    await admin.from("buffer_staged_media").update({state:"deleted"}).eq("storage_path",storagePath).eq("user_id",user.id).eq("state","deleting");
    return NextResponse.json({ ok: true, storagePath });
  } catch (error) {
    const limited = error as { status?: number; retryAfter?: number };
    console.error("Buffer cleanup error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not clean temporary Buffer media." }, { status: limited?.status === 429 ? 429 : 500, headers: limited?.status === 429 ? { "Retry-After": String(limited.retryAfter || 60) } : undefined });
  }
}
