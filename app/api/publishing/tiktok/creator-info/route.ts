
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { buildMediaAssetResponse, type StoredMediaAsset } from "@/utils/media-source";
import { cleanTikTokString, getTikTokAuthorization, queryTikTokCreatorInfo } from "@/utils/tiktok-publishing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const projectId = cleanTikTokString(body.projectId);
    const jobId = cleanTikTokString(body.jobId);
    if (!projectId || !jobId) return NextResponse.json({ error: "projectId and jobId are required." }, { status: 400 });

    const admin = createAdminClient();
    const { data: job, error: jobError } = await admin
      .from("publishing_jobs")
      .select("id, song_id, user_id, connection_id, media_asset_id, platform, content_type, item_key")
      .eq("id", jobId)
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .single();
    if (jobError || !job) return NextResponse.json({ error: "TikTok campaign row not found." }, { status: 404 });
    if (job.platform !== "tiktok" || job.content_type !== "video") {
      return NextResponse.json({ error: "The selected campaign row is not a TikTok video." }, { status: 400 });
    }
    if (!job.media_asset_id) return NextResponse.json({ error: "No Media Hub vertical video is linked to this TikTok row." }, { status: 400 });

    const { data: asset, error: assetError } = await admin
      .from("song_media_assets")
      .select("id, song_id, user_id, media_kind, slot, original_filename, storage_provider, storage_path, local_path, mime_type, size_bytes, metadata, created_at, updated_at")
      .eq("id", job.media_asset_id)
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .single();
    if (assetError || !asset) return NextResponse.json({ error: "The linked TikTok video could not be found in Media Hub." }, { status: 404 });

    const { connection, accessToken } = await getTikTokAuthorization(admin, user.id, job.connection_id);
    const creator = await queryTikTokCreatorInfo(accessToken);
    const media = await buildMediaAssetResponse(admin, asset as StoredMediaAsset);

    await admin
      .from("publishing_connections")
      .update({ last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", connection.id)
      .eq("user_id", user.id);

    return NextResponse.json({
      creator: {
        creatorNickname: creator.creator_nickname || connection.display_name || "TikTok Creator",
        creatorUsername: creator.creator_username || "",
        creatorAvatarUrl: creator.creator_avatar_url || "",
        privacyLevelOptions: Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options : [],
        commentDisabled: creator.comment_disabled === true,
        duetDisabled: creator.duet_disabled === true,
        stitchDisabled: creator.stitch_disabled === true,
        maxVideoPostDurationSec: Number(creator.max_video_post_duration_sec || 0),
      },
      media: {
        id: media.id,
        originalFilename: media.originalFilename,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        storageProvider: media.storageProvider,
        url: media.url,
      },
    });
  } catch (error) {
    console.error("TikTok creator-info error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load TikTok creator settings." }, { status: 500 });
  }
}
