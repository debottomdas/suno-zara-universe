import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  MEDIA_BUCKET,
  deleteAssetBacking,
  type StoredMediaAsset,
} from "@/utils/media-source";

const IMAGE_BUCKET = "song-images";

type StorageItem = {
  name: string;
  id?: string | null;
  metadata?: Record<string, unknown> | null;
};

async function listAllFiles(admin: any, bucket: string, prefix: string) {
  const files: string[] = [];

  async function walk(folder: string) {
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(folder, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Could not list ${bucket}/${folder}: ${error.message}`);
      const items = (data || []) as StorageItem[];
      if (!items.length) break;

      for (const item of items) {
        const child = folder ? `${folder}/${item.name}` : item.name;
        const looksLikeFolder = !item.id && !item.metadata;
        if (looksLikeFolder) {
          await walk(child);
        } else {
          files.push(child);
        }
      }

      if (items.length < 100) break;
      offset += items.length;
    }
  }

  await walk(prefix.replace(/\/+$/, ""));
  return files;
}

async function removeStoragePrefix(admin: any, bucket: string, prefix: string) {
  const paths = await listAllFiles(admin, bucket, prefix);
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    const { error } = await admin.storage.from(bucket).remove(batch);
    if (error) throw new Error(`Could not delete ${bucket} files: ${error.message}`);
  }
  return paths.length;
}

async function deleteRows(admin: any, table: string, songId: string, userId?: string) {
  let query = admin.from(table).delete().eq("song_id", songId);
  if (userId) query = query.eq("user_id", userId);
  const { error } = await query;
  if (error) throw new Error(`Could not clear ${table}: ${error.message}`);
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Please sign in to delete your song." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const projectId = String(body.projectId || "").trim();
    const channelId = String(body.channelId || "").trim();
    const confirmation = String(body.confirmation || "").trim();
    if (!projectId || !channelId) {
      return NextResponse.json({ error: "projectId and channelId are required." }, { status: 400 });
    }

    // Verify ownership using the signed-in user's session before using the admin client.
    const { data: ownedSong, error: songError } = await supabase
      .from("songs")
      .select("id, title, channel_id")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .eq("channel_id", channelId)
      .single();

    if (songError || !ownedSong) {
      return NextResponse.json({ error: "Song not found in the selected channel." }, { status: 404 });
    }
    if (confirmation !== ownedSong.title) {
      return NextResponse.json({ error: "Type the exact project title to confirm permanent deletion." }, { status: 400 });
    }

    const admin = createAdminClient();
    const warnings: string[] = [];

    // Capture media rows before deleting database records so any backing files can be removed.
    const { data: mediaRows, error: mediaError } = await admin
      .from("song_media_assets")
      .select("id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes, metadata")
      .eq("song_id", projectId)
      .eq("user_id", user.id);
    if (mediaError) throw new Error(`Could not inspect song media: ${mediaError.message}`);

    // Explicitly clear project-owned rows that predate or do not rely on cascading FKs.
    // Newer cascade-owned rows (production plan, creative workspace, Buffer staging ledger)
    // are removed by the songs FK. AI usage intentionally survives with song_id set null.
    await deleteRows(admin, "publishing_jobs", projectId, user.id);
    await deleteRows(admin, "publishing_campaigns", projectId, user.id);
    await deleteRows(admin, "song_images", projectId, user.id);
    await deleteRows(admin, "song_image_sets", projectId, user.id);
    await deleteRows(admin, "song_visual_concepts", projectId, user.id);
    await deleteRows(admin, "social_media_packs", projectId, user.id);
    await deleteRows(admin, "suno_styles", projectId, user.id);

    // song_versions historically does not always carry user_id, but ownership has already been verified.
    await deleteRows(admin, "song_versions", projectId);
    await deleteRows(admin, "song_media_assets", projectId, user.id);

    const { error: deleteSongError } = await admin
      .from("songs")
      .delete()
      .eq("id", projectId)
      .eq("user_id", user.id)
      .eq("channel_id", channelId);
    if (deleteSongError) throw new Error(`Could not delete song: ${deleteSongError.message}`);

    // Remove all tracked local/Supabase media. Local file deletion succeeds when this route
    // is running on the Mac and safely no-ops if the file is not present on the server.
    for (const row of mediaRows || []) {
      try {
        await deleteAssetBacking(admin, row as StoredMediaAsset);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "Could not remove one media file.");
      }
    }

    // Also clear any stale/untracked files, including Buffer temporary staging objects.
    let removedSongMedia = 0;
    let removedImages = 0;
    try {
      removedSongMedia = await removeStoragePrefix(admin, MEDIA_BUCKET, `${user.id}/${projectId}`);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Could not fully clear song-media storage.");
    }
    try {
      removedImages = await removeStoragePrefix(admin, IMAGE_BUCKET, `${user.id}/${projectId}`);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : "Could not fully clear song-images storage.");
    }

    return NextResponse.json({
      deleted: true,
      projectId,
      title: ownedSong.title || "Untitled",
      channelId,
      removedStorageObjects: removedSongMedia + removedImages,
      warnings,
    });
  } catch (error) {
    console.error("Delete song error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete song." },
      { status: 500 }
    );
  }
}
