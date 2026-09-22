"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as tus from "tus-js-client";
import { createClient } from "@/utils/supabase/client";

type LocalVideo = {
  filename?: string;
  originalFilename?: string;
  fileUrl?: string;
  durationSeconds?: number;
  source?: "generated" | "uploaded";
};

type ShortSlot = {
  slot: number;
  approvedVideo?: LocalVideo | null;
};

type ValidationIssue = {
  code?: string;
  message?: string;
  severity?: "error" | "warning";
};

type CampaignJob = {
  id: string;
  connection_id?: string | null;
  media_asset_id?: string | null;
  platform: "youtube" | "facebook" | "instagram" | "tiktok";
  content_type: string;
  item_key: string;
  title?: string | null;
  caption?: string | null;
  description?: string | null;
  hashtags?: string[];
  payload?: Record<string, unknown>;
  ready_to_publish: boolean;
  status: string;
  external_post_id?: string | null;
  external_url?: string | null;
  error_message?: string | null;
  validation_errors?: Array<ValidationIssue | string>;
};

type Connection = {
  id: string;
  platform: string;
  status?: string;
  is_primary?: boolean;
  display_name?: string | null;
  handle?: string | null;
};

type TikTokCreator = {
  creatorNickname: string;
  creatorUsername: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
};

type Props = {
  projectId: string | null;
  releaseReady: boolean;
  approvedFullVideo: LocalVideo | null;
  shortSlots: ShortSlot[];
};

const PLATFORM_ORDER = ["youtube", "instagram", "facebook", "tiktok"] as const;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

async function jsonResponse<T = any>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean((data as any).error) || fallback);
  return data as T;
}

function hasBlockingErrors(job: CampaignJob) {
  return (job.validation_errors || []).some((entry) => {
    if (typeof entry === "string") return true;
    return entry.severity !== "warning";
  });
}

function inferVideoMime(filename: string, returnedType: string) {
  if (returnedType === "video/mp4" || returnedType === "video/quicktime") return returnedType;
  return filename.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4";
}

function inferImageMime(filename: string, returnedType: string) {
  if (["image/png", "image/jpeg", "image/webp"].includes(returnedType)) return returnedType;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function slotFromJob(job: CampaignJob) {
  const payloadNumber = Number(job.payload?.postNumber || job.payload?.reelNumber || job.payload?.shortNumber || 0);
  if (Number.isInteger(payloadNumber) && payloadNumber >= 1 && payloadNumber <= 10) return payloadNumber;
  const match = job.item_key.match(/(\d+)$/);
  const parsed = Number(match?.[1] || 0);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function labelPrivacy(value: string) {
  if (value === "SELF_ONLY") return "Only me";
  if (value === "MUTUAL_FOLLOW_FRIENDS") return "Friends";
  if (value === "FOLLOWER_OF_CREATOR") return "Followers";
  if (value === "PUBLIC_TO_EVERYONE") return "Everyone";
  return value || "Choose privacy";
}

export default function ReleasePublisher({
  projectId,
  releaseReady,
  approvedFullVideo,
  shortSlots,
}: Props) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [jobs, setJobs] = useState<CampaignJob[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [prepareStep, setPrepareStep] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [platformProgress, setPlatformProgress] = useState("");

  const [youtubeVisibility, setYoutubeVisibility] = useState<"private" | "unlisted" | "public">("private");
  const [youtubeMadeForKids, setYoutubeMadeForKids] = useState<"yes" | "no">("no");
  const [youtubeSynthetic, setYoutubeSynthetic] = useState<"yes" | "no">("yes");
  const [instagramShareToFeed, setInstagramShareToFeed] = useState(true);

  const [tiktokCreator, setTikTokCreator] = useState<TikTokCreator | null>(null);
  const [tiktokPrivacy, setTikTokPrivacy] = useState("");
  const [tiktokMusicConsent, setTikTokMusicConsent] = useState(false);
  const [tiktokAigc, setTikTokAigc] = useState(true);
  const [tiktokAllowComment, setTikTokAllowComment] = useState(false);
  const [tiktokLoadingCreator, setTikTokLoadingCreator] = useState(false);

  const safeProjectId = projectId || "";

  const connected = useMemo(() => {
    const set = new Set<string>();
    for (const connection of connections) {
      if (connection.status === "connected") set.add(connection.platform);
    }
    return set;
  }, [connections]);

  const loadConnections = useCallback(async () => {
    try {
      const data = await jsonResponse<any>(
        await fetch("/api/publishing/connections", { cache: "no-store" }),
        "Could not load publishing connections."
      );
      setConnections(Array.isArray(data.connections) ? data.connections : []);
    } catch {
      setConnections([]);
    }
  }, []);

  const loadCampaign = useCallback(async () => {
    if (!safeProjectId) { setJobs([]); return [] as CampaignJob[]; }
    try {
      const data = await jsonResponse<any>(
        await fetch(`/api/publishing/campaigns?projectId=${encodeURIComponent(safeProjectId)}`, { cache: "no-store" }),
        "Could not load publishing campaign."
      );
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
      return Array.isArray(data.jobs) ? (data.jobs as CampaignJob[]) : [];
    } catch {
      setJobs([]);
      return [] as CampaignJob[];
    }
  }, [safeProjectId]);

  useEffect(() => {
    setError("");
    setMessage("");
    setPlatformProgress("");
    setTikTokCreator(null);
    setTikTokPrivacy("");
    setTikTokMusicConsent(false);
    if (!safeProjectId) return;
    void loadConnections();
    void loadCampaign();
  }, [safeProjectId, loadCampaign, loadConnections]);

  async function fetchLocalVideo(video: LocalVideo, fallbackFilename: string) {
    const sourceUrl = clean(video.fileUrl);
    if (!sourceUrl) throw new Error("Approved local video URL is missing. Restart the Universe worker and refresh this song.");
    const response = await fetch(sourceUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not read approved local video (${response.status}).`);
    const blob = await response.blob();
    const filename = clean(video.originalFilename) || clean(video.filename) || fallbackFilename;
    const mimeType = inferVideoMime(filename, blob.type);
    return new File([blob], filename, { type: mimeType });
  }

  async function tusUpload(file: File, upload: any, progressLabel: string) {
    const supabase = createClient();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.access_token) {
      throw new Error("Your login session could not be used for the publishing-media upload. Please sign in again.");
    }

    await new Promise<void>((resolve, reject) => {
      const task = new tus.Upload(file, {
        endpoint: upload.tusEndpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${session.access_token}` },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: upload.bucket || "song-media",
          objectName: upload.storagePath,
          contentType: file.type,
          cacheControl: "3600",
        },
        chunkSize: 6 * 1024 * 1024,
        onError: reject,
        onProgress: (uploaded, total) => {
          const percent = total > 0 ? Math.round((uploaded / total) * 100) : 0;
          setPrepareStep(`${progressLabel} ${percent}%`);
        },
        onSuccess: () => resolve(),
      });
      task.start();
    });
  }

  async function stageVideo(kind: "youtube-video" | "vertical-video", slot: number, video: LocalVideo) {
    const file = await fetchLocalVideo(
      video,
      kind === "youtube-video" ? "Suno-Zara-Full-Video.mp4" : `Suno-Zara-Short-${String(slot).padStart(2, "0")}.mp4`
    );
    const endpoint = kind === "youtube-video" ? "/api/media/youtube-video" : "/api/media/vertical-video";
    const prepareBody: Record<string, unknown> = {
      action: "prepare",
      projectId: safeProjectId,
      originalFilename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    };
    if (kind === "vertical-video") prepareBody.slot = slot;

    const prepare = await jsonResponse<any>(
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepareBody),
      }),
      "Could not prepare publishing-media upload."
    );
    if (!prepare.upload?.storagePath || !prepare.upload?.tusEndpoint) {
      throw new Error("Secure publishing-media upload details were not returned.");
    }

    await tusUpload(file, prepare.upload, kind === "youtube-video" ? "Uploading approved full video…" : `Uploading approved Short ${slot}…`);

    const registerBody: Record<string, unknown> = {
      action: "register",
      projectId: safeProjectId,
      storagePath: prepare.upload.storagePath,
      originalFilename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    };
    if (kind === "vertical-video") registerBody.slot = slot;

    await jsonResponse(
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerBody),
      }),
      "Video uploaded but could not be registered for publishing."
    );
  }

  async function stageThumbnail() {
    const imageData = await jsonResponse<any>(
      await fetch(`/api/generate-image?projectId=${encodeURIComponent(safeProjectId)}`, { cache: "no-store" }),
      "Could not load prepared artwork."
    );
    const images = Array.isArray(imageData.images) ? imageData.images : [];
    const chosen =
      images.find((image: any) => image.format === "youtube" && Number(image.imageNumber) === 1) ||
      images.find((image: any) => image.format === "youtube");
    if (!chosen?.url) throw new Error("No prepared 16:9 YouTube thumbnail was found. Run Prepare Everything in CREATE first.");

    setPrepareStep("Preparing YouTube thumbnail…");
    const imageResponse = await fetch(chosen.url, { cache: "no-store" });
    if (!imageResponse.ok) throw new Error("Could not read the prepared YouTube thumbnail.");
    const blob = await imageResponse.blob();
    const filename = "Suno-Zara-YouTube-Thumbnail.jpg";
    const mimeType = inferImageMime(filename, blob.type);
    const file = new File([blob], filename, { type: mimeType });

    const prepare = await jsonResponse<any>(
      await fetch("/api/media/artwork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          projectId: safeProjectId,
          mediaKind: "thumbnail",
          originalFilename: file.name,
          mimeType,
          sizeBytes: file.size,
        }),
      }),
      "Could not prepare thumbnail upload."
    );
    if (!prepare.upload?.storagePath || !prepare.upload?.token) {
      throw new Error("Secure thumbnail upload details were not returned.");
    }

    const supabase = createClient();
    const { error: storageError } = await supabase.storage
      .from(prepare.upload.bucket || "song-media")
      .uploadToSignedUrl(prepare.upload.storagePath, prepare.upload.token, file, { contentType: mimeType });
    if (storageError) throw new Error(`Thumbnail upload failed: ${storageError.message}`);

    await jsonResponse(
      await fetch("/api/media/artwork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          projectId: safeProjectId,
          mediaKind: "thumbnail",
          storagePath: prepare.upload.storagePath,
          originalFilename: file.name,
          mimeType,
          sizeBytes: file.size,
        }),
      }),
      "Thumbnail uploaded but could not be registered."
    );
  }

  async function markSupportedJobsReady(currentJobs: CampaignJob[]) {
    const supported = currentJobs.filter((job) => {
      if (!job.connection_id || hasBlockingErrors(job)) return false;
      if (job.platform === "instagram" && job.content_type !== "reel") return false;
      return true;
    });
    if (!supported.length) return currentJobs;

    const patched = await jsonResponse<any>(
      await fetch("/api/publishing/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: safeProjectId,
          updates: supported.map((job) => ({ id: job.id, ready_to_publish: true })),
        }),
      }),
      "Could not mark the publishing package ready."
    );
    return Array.isArray(patched.jobs) ? (patched.jobs as CampaignJob[]) : currentJobs;
  }

  async function preparePublishing() {
    if (!releaseReady || !approvedFullVideo || shortSlots.filter((slot) => slot.approvedVideo).length !== 6) {
      setError("Approve the full video and all six Shorts before preparing publishing.");
      return;
    }

    setPreparing(true);
    setError("");
    setMessage("");
    try {
      setPrepareStep("Staging the approved full video for publishing…");
      await stageVideo("youtube-video", 1, approvedFullVideo);

      for (const item of [...shortSlots].sort((a, b) => a.slot - b.slot)) {
        if (!item.approvedVideo) throw new Error(`Short ${item.slot} is not approved.`);
        setPrepareStep(`Staging approved Short ${item.slot} of 6…`);
        await stageVideo("vertical-video", item.slot, item.approvedVideo);
      }

      await stageThumbnail();

      setPrepareStep("Matching approved media with the saved Social Media Pack…");
      const campaign = await jsonResponse<any>(
        await fetch("/api/publishing/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: safeProjectId }),
        }),
        "Could not build the publishing package."
      );

      let nextJobs = Array.isArray(campaign.jobs) ? (campaign.jobs as CampaignJob[]) : [];
      nextJobs = await markSupportedJobsReady(nextJobs);
      setJobs(nextJobs);
      await loadConnections();
      setMessage("Publishing package is ready. Nothing has been posted yet.");
      setPrepareStep("");
    } catch (prepareError) {
      setPrepareStep("");
      setError(prepareError instanceof Error ? prepareError.message : "Could not prepare publishing.");
    } finally {
      setPreparing(false);
    }
  }

  async function reloadAfterPublish() {
    await loadCampaign();
    await loadConnections();
  }

  async function publishYouTube() {
    const candidates = jobs.filter(
      (job) =>
        job.platform === "youtube" &&
        job.ready_to_publish &&
        !hasBlockingErrors(job) &&
        !job.external_post_id &&
        !["published", "uploading"].includes(job.status)
    );
    if (!candidates.length) {
      setMessage("No unpublished YouTube items are waiting.");
      return;
    }
    const confirmed = window.confirm(
      `REAL YOUTUBE ACTION\n\nUpload ${candidates.length} approved item${candidates.length === 1 ? "" : "s"} to your connected YouTube channel as ${youtubeVisibility.toUpperCase()}?\n\nThis includes the approved full video and any approved Shorts that have not already been uploaded.`
    );
    if (!confirmed) return;

    setBusyPlatform("youtube");
    setError("");
    setMessage("");
    const failures: string[] = [];
    let completed = 0;
    for (const job of candidates) {
      setPlatformProgress(`YouTube ${completed + 1}/${candidates.length} • ${job.item_key}`);
      try {
        await jsonResponse(
          await fetch("/api/publishing/youtube/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: safeProjectId,
              jobId: job.id,
              privacyStatus: youtubeVisibility,
              selfDeclaredMadeForKids: youtubeMadeForKids === "yes",
              containsSyntheticMedia: youtubeSynthetic === "yes",
            }),
          }),
          `YouTube failed for ${job.item_key}.`
        );
        completed += 1;
      } catch (publishError) {
        failures.push(`${job.item_key}: ${publishError instanceof Error ? publishError.message : "failed"}`);
      }
    }
    await reloadAfterPublish();
    setBusyPlatform(null);
    setPlatformProgress("");
    if (failures.length) {
      setError(`${completed}/${candidates.length} YouTube items completed. Retry will only target unfinished items. ${failures.join(" • ")}`);
    } else {
      setMessage(`${completed} YouTube item${completed === 1 ? "" : "s"} uploaded successfully.`);
    }
  }

  async function publishFacebook() {
    const candidates = jobs.filter(
      (job) =>
        job.platform === "facebook" &&
        job.ready_to_publish &&
        !hasBlockingErrors(job) &&
        !job.external_post_id &&
        !["published", "uploading"].includes(job.status)
    );
    if (!candidates.length) {
      setMessage("No unpublished Facebook items are waiting.");
      return;
    }
    if (!window.confirm(`REAL FACEBOOK ACTION\n\nPublish ${candidates.length} prepared Facebook item${candidates.length === 1 ? "" : "s"} now?`)) return;

    setBusyPlatform("facebook");
    setError("");
    const failures: string[] = [];
    let completed = 0;
    for (const job of candidates) {
      setPlatformProgress(`Facebook ${completed + 1}/${candidates.length} • ${job.item_key}`);
      try {
        await jsonResponse(
          await fetch("/api/publishing/facebook/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: safeProjectId, jobId: job.id }),
          }),
          `Facebook failed for ${job.item_key}.`
        );
        completed += 1;
      } catch (publishError) {
        failures.push(`${job.item_key}: ${publishError instanceof Error ? publishError.message : "failed"}`);
      }
    }
    await reloadAfterPublish();
    setBusyPlatform(null);
    setPlatformProgress("");
    if (failures.length) setError(`${completed}/${candidates.length} Facebook items completed. ${failures.join(" • ")}`);
    else setMessage(`${completed} Facebook item${completed === 1 ? "" : "s"} published.`);
  }

  async function publishInstagram() {
    const candidates = jobs.filter(
      (job) =>
        job.platform === "instagram" &&
        job.content_type === "reel" &&
        job.ready_to_publish &&
        !hasBlockingErrors(job) &&
        !job.external_post_id &&
        !["published", "uploading"].includes(job.status)
    );
    if (!candidates.length) {
      setMessage("No unpublished Instagram Reels are waiting.");
      return;
    }
    if (!window.confirm(`REAL INSTAGRAM ACTION\n\nPublish ${candidates.length} approved Reel${candidates.length === 1 ? "" : "s"} now?`)) return;

    setBusyPlatform("instagram");
    setError("");
    const failures: string[] = [];
    let completed = 0;
    for (const job of candidates) {
      setPlatformProgress(`Instagram ${completed + 1}/${candidates.length} • ${job.item_key}`);
      try {
        await jsonResponse(
          await fetch("/api/publishing/instagram/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: safeProjectId, jobId: job.id, shareToFeed: instagramShareToFeed }),
          }),
          `Instagram failed for ${job.item_key}.`
        );
        completed += 1;
      } catch (publishError) {
        failures.push(`${job.item_key}: ${publishError instanceof Error ? publishError.message : "failed"}`);
      }
    }
    await reloadAfterPublish();
    setBusyPlatform(null);
    setPlatformProgress("");
    if (failures.length) setError(`${completed}/${candidates.length} Instagram Reels completed. ${failures.join(" • ")}`);
    else setMessage(`${completed} Instagram Reel${completed === 1 ? "" : "s"} published.`);
  }

  async function loadTikTokCreator() {
    const firstJob = jobs.find(
      (job) => job.platform === "tiktok" && job.ready_to_publish && !hasBlockingErrors(job) && job.media_asset_id
    );
    if (!firstJob) {
      setError("No ready TikTok video is available. Prepare Publishing first.");
      return;
    }
    setTikTokLoadingCreator(true);
    setError("");
    try {
      const data = await jsonResponse<any>(
        await fetch("/api/publishing/tiktok/creator-info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: safeProjectId, jobId: firstJob.id }),
        }),
        "Could not load TikTok creator settings."
      );
      const creator = data.creator || {};
      const next: TikTokCreator = {
        creatorNickname: clean(creator.creatorNickname),
        creatorUsername: clean(creator.creatorUsername),
        privacyLevelOptions: Array.isArray(creator.privacyLevelOptions)
          ? creator.privacyLevelOptions.map((value: unknown) => clean(value)).filter(Boolean)
          : [],
        commentDisabled: creator.commentDisabled === true,
        duetDisabled: creator.duetDisabled === true,
        stitchDisabled: creator.stitchDisabled === true,
        maxVideoPostDurationSec: Number(creator.maxVideoPostDurationSec || 0),
      };
      setTikTokCreator(next);
      if (next.privacyLevelOptions.length === 1) setTikTokPrivacy(next.privacyLevelOptions[0]);
      setMessage(`TikTok settings loaded for ${next.creatorNickname || next.creatorUsername || "your creator account"}.`);
    } catch (creatorError) {
      setError(creatorError instanceof Error ? creatorError.message : "Could not load TikTok settings.");
    } finally {
      setTikTokLoadingCreator(false);
    }
  }

  function tikTokTitle(job: CampaignJob) {
    const tags = Array.isArray(job.hashtags) ? job.hashtags.filter(Boolean).join(" ") : "";
    return [clean(job.caption), tags].filter(Boolean).join("\n\n").slice(0, 2200);
  }

  async function publishTikTok() {
    const candidates = jobs.filter(
      (job) =>
        job.platform === "tiktok" &&
        job.ready_to_publish &&
        !hasBlockingErrors(job) &&
        !job.external_post_id &&
        !["published", "uploading"].includes(job.status)
    );
    if (!candidates.length) {
      setMessage("No unpublished TikTok videos are waiting.");
      return;
    }
    if (!tiktokCreator) {
      setError("Load TikTok creator settings first.");
      return;
    }
    if (!tiktokPrivacy || !tiktokCreator.privacyLevelOptions.includes(tiktokPrivacy)) {
      setError("Choose one of TikTok's current privacy options first.");
      return;
    }
    if (!tiktokMusicConsent) {
      setError("Confirm TikTok's Music Usage Confirmation before publishing.");
      return;
    }
    if (!window.confirm(`REAL TIKTOK ACTION\n\nSend ${candidates.length} approved video${candidates.length === 1 ? "" : "s"} to TikTok with privacy: ${labelPrivacy(tiktokPrivacy)}?`)) return;

    setBusyPlatform("tiktok");
    setError("");
    const failures: string[] = [];
    let completed = 0;
    for (const job of candidates) {
      const slot = slotFromJob(job);
      const localShort = shortSlots.find((item) => item.slot === slot)?.approvedVideo;
      const durationSeconds = Number(localShort?.durationSeconds || 0);
      if (!durationSeconds) {
        failures.push(`${job.item_key}: duration unavailable`);
        continue;
      }
      setPlatformProgress(`TikTok ${completed + 1}/${candidates.length} • ${job.item_key}`);
      try {
        await jsonResponse(
          await fetch("/api/publishing/tiktok/publish", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: safeProjectId,
              jobId: job.id,
              title: tikTokTitle(job),
              privacyLevel: tiktokPrivacy,
              allowComment: tiktokAllowComment && !tiktokCreator.commentDisabled,
              allowDuet: false,
              allowStitch: false,
              commercialContent: false,
              brandOrganic: false,
              brandContent: false,
              isAigc: tiktokAigc,
              musicUsageConfirmed: true,
              durationSeconds,
            }),
          }),
          `TikTok failed for ${job.item_key}.`
        );
        completed += 1;
      } catch (publishError) {
        failures.push(`${job.item_key}: ${publishError instanceof Error ? publishError.message : "failed"}`);
      }
    }
    await reloadAfterPublish();
    setBusyPlatform(null);
    setPlatformProgress("");
    if (failures.length) setError(`${completed}/${candidates.length} TikTok uploads accepted. ${failures.join(" • ")}`);
    else setMessage(`${completed} TikTok upload${completed === 1 ? "" : "s"} accepted. TikTok may still be processing them.`);
  }

  async function refreshTikTokStatus() {
    const candidates = jobs.filter(
      (job) => job.platform === "tiktok" && job.external_post_id && job.status !== "published"
    );
    if (!candidates.length) {
      setMessage("No TikTok uploads are currently waiting for a status refresh.");
      return;
    }
    setBusyPlatform("tiktok-status");
    setError("");
    for (const [index, job] of candidates.entries()) {
      setPlatformProgress(`Checking TikTok ${index + 1}/${candidates.length}…`);
      try {
        await jsonResponse(
          await fetch("/api/publishing/tiktok/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: safeProjectId, jobId: job.id }),
          }),
          `Could not refresh ${job.item_key}.`
        );
      } catch {}
    }
    await reloadAfterPublish();
    setBusyPlatform(null);
    setPlatformProgress("");
    setMessage("TikTok statuses refreshed.");
  }

  const counts = useMemo(() => {
    const result: Record<string, { total: number; published: number; uploading: number; failed: number }> = {};
    for (const platform of PLATFORM_ORDER) result[platform] = { total: 0, published: 0, uploading: 0, failed: 0 };
    for (const job of jobs) {
      if (!result[job.platform]) continue;
      if (job.platform === "instagram" && job.content_type !== "reel") continue;
      result[job.platform].total += 1;
      if (job.status === "published") result[job.platform].published += 1;
      if (job.status === "uploading") result[job.platform].uploading += 1;
      if (job.status === "failed") result[job.platform].failed += 1;
    }
    return result;
  }, [jobs]);

  const publishedLinks = jobs.filter((job) => clean(job.external_url));
  const campaignPrepared = jobs.length > 0;

  if (!safeProjectId) return null;

  return (
    <div className="mt-3 rounded-[22px] border border-cyan-300/10 bg-white/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-black">Publish</p>
          <p className="mt-1 max-w-xl text-xs leading-5 text-zinc-500">
            Universe stages only your approved full video and six approved Shorts, matches them with the Social Media Pack from CREATE, then publishes only when you press a platform button.
          </p>
        </div>
        {!campaignPrepared ? (
          <button
            onClick={() => void preparePublishing()}
            disabled={!releaseReady || preparing}
            className="rounded-xl bg-gradient-to-r from-[#ffbd78] via-[#ff8d8a] to-[#e768d8] px-4 py-2.5 text-xs font-black text-[#281321] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {preparing ? "Preparing…" : releaseReady ? "Prepare Publishing" : "Complete Review"}
          </button>
        ) : (
          <button
            onClick={() => void preparePublishing()}
            disabled={preparing || !releaseReady}
            className="rounded-xl border border-white/10 px-3 py-2 text-[10px] font-black text-zinc-300 disabled:opacity-40"
          >
            {preparing ? "Refreshing…" : "Refresh Publishing Package"}
          </button>
        )}
      </div>

      {(prepareStep || platformProgress) && (
        <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.05] px-3 py-2.5 text-[10px] font-bold text-cyan-100">
          {prepareStep || platformProgress}
        </div>
      )}
      {error && <div className="mt-3 rounded-xl border border-rose-300/20 bg-rose-400/[0.08] px-3 py-2.5 text-[10px] font-bold leading-5 text-rose-200">{error}</div>}
      {message && <div className="mt-3 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2.5 text-[10px] font-bold leading-5 text-emerald-200">{message}</div>}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PLATFORM_ORDER.map((platform) => {
          const connection = connections.find((item) => item.platform === platform && item.status === "connected");
          return (
            <div key={platform} className="rounded-xl border border-white/[0.07] bg-black/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black capitalize">{platform}</span>
                <span className={`h-2 w-2 rounded-full ${connection ? "bg-emerald-300" : "bg-zinc-700"}`} />
              </div>
              <p className={`mt-1 text-[9px] ${connection ? "text-emerald-300" : "text-zinc-600"}`}>
                {connection ? "Connected" : "Not connected"}
              </p>
              {campaignPrepared && counts[platform].total > 0 && (
                <p className="mt-1 text-[8px] text-zinc-600">
                  {counts[platform].published}/{counts[platform].total} published
                  {counts[platform].uploading ? ` • ${counts[platform].uploading} processing` : ""}
                  {counts[platform].failed ? ` • ${counts[platform].failed} failed` : ""}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {campaignPrepared && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-red-300/10 bg-black/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-black text-white">YouTube</p>
                <p className="mt-1 text-[9px] text-zinc-500">Full video + six Shorts. Private is the safest test setting.</p>
              </div>
              {connected.has("youtube") ? (
                <button onClick={() => void publishYouTube()} disabled={Boolean(busyPlatform)} className="rounded-xl bg-red-500 px-3 py-2 text-[10px] font-black text-white disabled:opacity-40">
                  {busyPlatform === "youtube" ? "Publishing…" : counts.youtube.published ? "Retry Unfinished" : "Publish YouTube"}
                </button>
              ) : (
                <button onClick={() => { window.location.href = "/api/publishing/youtube/connect"; }} className="rounded-xl border border-white/10 px-3 py-2 text-[10px] font-black text-zinc-300">Connect YouTube</button>
              )}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label className="text-[9px] font-bold text-zinc-500">Visibility
                <select value={youtubeVisibility} onChange={(event) => setYoutubeVisibility(event.target.value as any)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#07151f] px-2 py-2 text-[10px] text-zinc-200">
                  <option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option>
                </select>
              </label>
              <label className="text-[9px] font-bold text-zinc-500">Made for kids?
                <select value={youtubeMadeForKids} onChange={(event) => setYoutubeMadeForKids(event.target.value as any)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#07151f] px-2 py-2 text-[10px] text-zinc-200">
                  <option value="no">No</option><option value="yes">Yes</option>
                </select>
              </label>
              <label className="text-[9px] font-bold text-zinc-500">Synthetic / altered media?
                <select value={youtubeSynthetic} onChange={(event) => setYoutubeSynthetic(event.target.value as any)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#07151f] px-2 py-2 text-[10px] text-zinc-200">
                  <option value="yes">Yes</option><option value="no">No</option>
                </select>
              </label>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-pink-300/10 bg-black/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-[11px] font-black">Instagram Reels</p><p className="mt-1 text-[9px] text-zinc-500">Publishes the six approved vertical videos.</p></div>
                {connected.has("instagram") ? (
                  <button onClick={() => void publishInstagram()} disabled={Boolean(busyPlatform)} className="rounded-xl bg-pink-500 px-3 py-2 text-[10px] font-black text-white disabled:opacity-40">{busyPlatform === "instagram" ? "Publishing…" : counts.instagram.published ? "Retry Unfinished" : "Publish Reels"}</button>
                ) : (
                  <button onClick={() => { window.location.href = "/api/publishing/meta/connect"; }} className="rounded-xl border border-white/10 px-3 py-2 text-[10px] font-black text-zinc-300">Connect Meta</button>
                )}
              </div>
              <label className="mt-3 flex items-center gap-2 text-[9px] font-bold text-zinc-400"><input type="checkbox" checked={instagramShareToFeed} onChange={(event) => setInstagramShareToFeed(event.target.checked)} /> Share Reels to Instagram feed</label>
            </div>

            <div className="rounded-2xl border border-blue-300/10 bg-black/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-[11px] font-black">Facebook</p><p className="mt-1 text-[9px] text-zinc-500">Prepared release posts + approved Reels.</p></div>
                {connected.has("facebook") ? (
                  <button onClick={() => void publishFacebook()} disabled={Boolean(busyPlatform)} className="rounded-xl bg-blue-500 px-3 py-2 text-[10px] font-black text-white disabled:opacity-40">{busyPlatform === "facebook" ? "Publishing…" : counts.facebook.published ? "Retry Unfinished" : "Publish Facebook"}</button>
                ) : (
                  <button onClick={() => { window.location.href = "/api/publishing/meta/connect"; }} className="rounded-xl border border-white/10 px-3 py-2 text-[10px] font-black text-zinc-300">Connect Meta</button>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-300/10 bg-black/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="text-[11px] font-black">TikTok</p><p className="mt-1 text-[9px] text-zinc-500">Load TikTok's current creator rules once, then publish the six approved Shorts.</p></div>
              {connected.has("tiktok") ? (
                <div className="flex gap-2">
                  <button onClick={() => void loadTikTokCreator()} disabled={tiktokLoadingCreator || Boolean(busyPlatform)} className="rounded-xl border border-cyan-200/15 px-3 py-2 text-[10px] font-black text-cyan-100 disabled:opacity-40">{tiktokLoadingCreator ? "Loading…" : "Load TikTok Settings"}</button>
                  <button onClick={() => void publishTikTok()} disabled={Boolean(busyPlatform) || !tiktokCreator || !tiktokPrivacy || !tiktokMusicConsent} className="rounded-xl bg-cyan-300 px-3 py-2 text-[10px] font-black text-cyan-950 disabled:opacity-35">{busyPlatform === "tiktok" ? "Publishing…" : counts.tiktok.published ? "Retry Unfinished" : "Publish TikTok"}</button>
                </div>
              ) : (
                <button onClick={() => { window.location.href = "/api/publishing/tiktok/connect"; }} className="rounded-xl border border-white/10 px-3 py-2 text-[10px] font-black text-zinc-300">Connect TikTok</button>
              )}
            </div>

            {tiktokCreator && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-[9px] font-bold text-zinc-500">Privacy
                  <select value={tiktokPrivacy} onChange={(event) => setTikTokPrivacy(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#07151f] px-2 py-2 text-[10px] text-zinc-200">
                    <option value="">Choose privacy</option>
                    {tiktokCreator.privacyLevelOptions.map((value) => <option key={value} value={value}>{labelPrivacy(value)}</option>)}
                  </select>
                </label>
                <div className="space-y-2 pt-1 text-[9px] font-bold text-zinc-400">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={tiktokMusicConsent} onChange={(event) => setTikTokMusicConsent(event.target.checked)} /> I confirm TikTok Music Usage Confirmation</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={tiktokAigc} onChange={(event) => setTikTokAigc(event.target.checked)} /> Mark as AI-generated content</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={tiktokAllowComment} disabled={tiktokCreator.commentDisabled} onChange={(event) => setTikTokAllowComment(event.target.checked)} /> Allow comments</label>
                </div>
              </div>
            )}

            {counts.tiktok.uploading > 0 && (
              <button onClick={() => void refreshTikTokStatus()} disabled={Boolean(busyPlatform)} className="mt-3 rounded-xl border border-white/10 px-3 py-2 text-[9px] font-black text-zinc-300 disabled:opacity-40">Refresh TikTok Processing Status</button>
            )}
          </div>

          {publishedLinks.length > 0 && (
            <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.04] p-3">
              <p className="text-[10px] font-black text-emerald-200">Published links</p>
              <div className="mt-2 grid gap-1.5">
                {publishedLinks.slice(0, 20).map((job) => (
                  <a key={job.id} href={clean(job.external_url)} target="_blank" rel="noreferrer" className="truncate text-[9px] font-bold text-cyan-200 underline decoration-cyan-300/30 underline-offset-2">
                    {job.platform} • {job.item_key}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
