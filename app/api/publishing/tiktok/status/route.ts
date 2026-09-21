
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { cleanTikTokString, fetchTikTokPublishStatus, getTikTokAuthorization } from "@/utils/tiktok-publishing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function publicPostIds(status: JsonRecord) {
  const values = Array.isArray(status.publicly_available_post_id)
    ? status.publicly_available_post_id
    : Array.isArray(status.publicaly_available_post_id)
      ? status.publicaly_available_post_id
      : [];
  return values.map((value) => String(value)).filter(Boolean);
}

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
      .select("id, song_id, user_id, connection_id, platform, external_post_id, payload")
      .eq("id", jobId)
      .eq("song_id", projectId)
      .eq("user_id", user.id)
      .single();
    if (jobError || !job) return NextResponse.json({ error: "TikTok campaign row not found." }, { status: 404 });
    if (job.platform !== "tiktok") return NextResponse.json({ error: "The selected row is not a TikTok item." }, { status: 400 });

    const payload = asRecord(job.payload);
    const publishId = cleanTikTokString(job.external_post_id) || cleanTikTokString(payload.tiktokPublishId);
    if (!publishId) return NextResponse.json({ error: "This TikTok row does not have a publish ID yet." }, { status: 400 });

    const { connection, accessToken } = await getTikTokAuthorization(admin, user.id, job.connection_id);
    const statusData = await fetchTikTokPublishStatus(accessToken, publishId);
    const status = cleanTikTokString(statusData.status) || "UNKNOWN";
    const ids = publicPostIds(statusData as unknown as JsonRecord);
    const publicPostId = ids[0] || cleanTikTokString(payload.tiktokPublicPostId);
    const username = cleanTikTokString(payload.tiktokCreatorUsername);
    const postUrl = publicPostId && username
      ? `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${encodeURIComponent(publicPostId)}`
      : cleanTikTokString(payload.tiktokPostUrl) || null;
    const complete = status === "PUBLISH_COMPLETE";
    const failed = status === "FAILED";
    const now = new Date().toISOString();

    const nextPayload = {
      ...payload,
      tiktokPublishId: publishId,
      tiktokPublishStatus: status,
      tiktokPublicPostId: publicPostId || null,
      tiktokPostUrl: postUrl,
      tiktokLastStatusAt: now,
      tiktokUploadedBytes: Number(statusData.uploaded_bytes || 0) || null,
    };
    const updates: JsonRecord = {
      connection_id: connection.id,
      status: complete ? "published" : failed ? "failed" : "uploading",
      external_post_id: publishId,
      external_url: postUrl,
      error_message: failed ? cleanTikTokString(statusData.fail_reason) || "TikTok processing failed." : null,
      published_at: complete ? now : null,
      payload: nextPayload,
      updated_at: now,
    };
    if (complete) updates.ready_to_publish = false;
    await admin
      .from("publishing_jobs")
      .update(updates)
      .eq("id", jobId)
      .eq("user_id", user.id);

    return NextResponse.json({ publishId, status, failed, complete, failReason: cleanTikTokString(statusData.fail_reason) || null, publicPostId: publicPostId || null, postUrl });
  } catch (error) {
    console.error("TikTok status error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh TikTok status." }, { status: 500 });
  }
}
