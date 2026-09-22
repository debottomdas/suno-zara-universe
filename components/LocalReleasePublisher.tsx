"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LocalVideo = {
  filename?: string;
  originalFilename?: string;
  fileUrl?: string;
  source?: "generated" | "uploaded";
};

type ShortSlot = {
  slot: number;
  approvedVideo?: LocalVideo | null;
};

type Props = {
  projectId: string | null;
  releaseReady: boolean;
  approvedFullVideo: LocalVideo | null;
  shortSlots: ShortSlot[];
};

type YouTubeReceipt = {
  itemKey: string;
  kind: "full" | "short";
  slot: number;
  videoId: string;
  url: string;
  title?: string;
  publishedAt?: string;
  scheduledAt?: string | null;
  status?: string;
};

type Connection = {
  id: string;
  platform: string;
  status?: string;
  display_name?: string | null;
  handle?: string | null;
};

type BufferChannel = {
  id: string;
  name: string;
  service: "tiktok" | "instagram" | "facebook" | string;
  organizationId?: string;
  organizationName?: string;
};

type BufferReceipt = {
  itemKey: string;
  slot: number;
  service: string;
  channelId: string;
  channelName?: string;
  postId: string;
  status?: string;
  dueAt?: string | null;
  sentAt?: string | null;
  externalLink?: string | null;
  errorMessage?: string | null;
  storagePath?: string;
  mediaUrl?: string;
  publishMode?: "draft" | "queue" | "schedule";
  createdAt?: string;
  updatedAt?: string;
  cleanedAt?: string;
};

type BufferMode = "draft" | "queue" | "schedule";

const WORKER = "http://127.0.0.1:47123";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function bufferKey(channelId: string, slot: number) {
  return `buffer-${channelId}-short-${String(slot).padStart(2, "0")}`;
}

function titleCase(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

async function jsonResponse<T = any>(response: Response, fallback: string): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean((data as any).error) || fallback);
  return data as T;
}

export default function LocalReleasePublisher({
  projectId,
  releaseReady,
  approvedFullVideo,
  shortSlots,
}: Props) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [workerReady, setWorkerReady] = useState(false);
  const [receipts, setReceipts] = useState<YouTubeReceipt[]>([]);
  const [bufferReceipts, setBufferReceipts] = useState<BufferReceipt[]>([]);
  const [bufferConfigured, setBufferConfigured] = useState(false);
  const [bufferChannels, setBufferChannels] = useState<BufferChannel[]>([]);
  const [selectedBufferChannelIds, setSelectedBufferChannelIds] = useState<string[]>([]);
  const [bufferMode, setBufferMode] = useState<BufferMode>("draft");
  const [bufferScheduleStart, setBufferScheduleStart] = useState("");
  const [bufferGapMinutes, setBufferGapMinutes] = useState(60);
  const [bufferError, setBufferError] = useState("");
  const [bufferBusy, setBufferBusy] = useState(false);
  const [bufferMessage, setBufferMessage] = useState("");
  const [bufferProgress, setBufferProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [privacyStatus, setPrivacyStatus] = useState<"private" | "unlisted" | "public">("private");
  const [madeForKids, setMadeForKids] = useState(false);
  const [containsSyntheticMedia, setContainsSyntheticMedia] = useState(true);
  const [publishOpen, setPublishOpen] = useState(false);
  const [youtubeScheduleFull, setYoutubeScheduleFull] = useState("");
  const [youtubeScheduleShortsStart, setYoutubeScheduleShortsStart] = useState("");
  const [youtubeGapMinutes, setYoutubeGapMinutes] = useState(1440);
  const [youtubeScheduleBusy, setYoutubeScheduleBusy] = useState(false);
  const [youtubeScheduleError, setYoutubeScheduleError] = useState("");
  const [youtubeScheduleMessage, setYoutubeScheduleMessage] = useState("");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("szu:music:publish-open-v2");
      if (saved !== null) setPublishOpen(saved === "1");
    } catch {}
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem("szu:music:publish-open-v2", publishOpen ? "1" : "0"); } catch {}
  }, [publishOpen]);

  const safeProjectId = projectId || "";
  const youtubeConnected = useMemo(
    () => connections.some((item) => item.platform === "youtube" && item.status === "connected"),
    [connections]
  );

  const approvedShorts = useMemo(
    () => shortSlots.filter((item) => item.approvedVideo).sort((a, b) => a.slot - b.slot),
    [shortSlots]
  );

  const publishedKeys = useMemo(() => new Set(receipts.map((item) => item.itemKey)), [receipts]);
  const selectedBufferChannels = useMemo(
    () => bufferChannels.filter((channel) => selectedBufferChannelIds.includes(channel.id)),
    [bufferChannels, selectedBufferChannelIds]
  );

  const canonicalBufferReceipts = useMemo(
    () => bufferReceipts.filter((receipt) => receipt.itemKey === bufferKey(receipt.channelId, receipt.slot)),
    [bufferReceipts]
  );

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

  const loadWorkerStatus = useCallback(async () => {
    if (!safeProjectId) return;
    try {
      const health = await jsonResponse<any>(await fetch(`${WORKER}/health`, { cache: "no-store" }), "Worker unavailable.");
      setWorkerReady(Boolean(health.ok));
      const status = await jsonResponse<any>(
        await fetch(`${WORKER}/publishing/status?projectId=${encodeURIComponent(safeProjectId)}`, { cache: "no-store" }),
        "Could not load local publishing status."
      );
      setReceipts(Array.isArray(status.youtube) ? status.youtube : []);
      setBufferReceipts(Array.isArray(status.buffer) ? status.buffer : []);
    } catch {
      setWorkerReady(false);
      setReceipts([]);
      setBufferReceipts([]);
    }
  }, [safeProjectId]);

  const loadBufferStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/publishing/buffer/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(clean(data.error) || "Could not load Buffer.");
      const channels: BufferChannel[] = Array.isArray(data.channels) ? data.channels : [];
      setBufferConfigured(Boolean(data.configured));
      setBufferChannels(channels);
      setSelectedBufferChannelIds((current) => {
        const stillValid = current.filter((id) => channels.some((channel) => channel.id === id));
        return stillValid.length ? stillValid : channels.map((channel) => channel.id);
      });
      setBufferError("");
    } catch (err) {
      setBufferConfigured(false);
      setBufferChannels([]);
      setSelectedBufferChannelIds([]);
      setBufferError(err instanceof Error ? err.message : "Could not load Buffer.");
    }
  }, []);

  useEffect(() => {
    setError("");
    setMessage("");
    setProgress("");
    setBufferError("");
    setBufferMessage("");
    setBufferProgress("");
    setYoutubeScheduleError("");
    setYoutubeScheduleMessage("");
    if (!safeProjectId) return;
    void loadConnections();
    void loadWorkerStatus();
    void loadBufferStatus();
  }, [safeProjectId, loadConnections, loadWorkerStatus, loadBufferStatus]);

  async function publishOne(kind: "full" | "short", slot: number, label: string) {
    if (!safeProjectId) throw new Error("Choose a song project first.");

    setProgress(`${label}: checking approved local file…`);
    const info = await jsonResponse<any>(
      await fetch(
        `${WORKER}/publishing/file-info?projectId=${encodeURIComponent(safeProjectId)}&kind=${kind}&slot=${slot}`,
        { cache: "no-store" }
      ),
      `Could not find the approved local ${label}.`
    );

    setProgress(`${label}: creating secure YouTube upload session…`);
    const session = await jsonResponse<any>(
      await fetch("/api/publishing/youtube/direct-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: safeProjectId,
          kind,
          slot,
          sizeBytes: info.sizeBytes,
          mimeType: info.mimeType,
          privacyStatus,
          selfDeclaredMadeForKids: madeForKids,
          containsSyntheticMedia,
        }),
      }),
      `Could not prepare YouTube upload for ${label}.`
    );

    setProgress(`${label}: uploading directly from your Mac to YouTube…`);
    const uploaded = await jsonResponse<any>(
      await fetch(`${WORKER}/publish/youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: safeProjectId,
          kind,
          slot,
          uploadUrl: session.uploadUrl,
          accessToken: session.transientAccessToken,
        }),
      }),
      `YouTube upload failed for ${label}.`
    );

    setProgress(`${label}: saving publishing receipt…`);
    await jsonResponse<any>(
      await fetch("/api/publishing/youtube/direct-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: safeProjectId,
          kind,
          slot,
          videoId: uploaded.videoId,
          title: session.title,
          description: session.description,
          tags: session.tags,
          privacyStatus,
        }),
      }),
      `YouTube uploaded ${label}, but Universe could not save the publishing receipt.`
    );

    await loadWorkerStatus();
    return uploaded;
  }

  async function publishYouTube() {
    if (!releaseReady || !approvedFullVideo || approvedShorts.length !== 6) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (!workerReady) throw new Error("Universe local worker is not connected.");
      if (!youtubeConnected) throw new Error("YouTube is not connected in Universe.");

      if (!publishedKeys.has("youtube-full")) await publishOne("full", 1, "Full video");

      for (let slot = 1; slot <= 6; slot += 1) {
        const itemKey = `youtube-short-${String(slot).padStart(2, "0")}`;
        if (publishedKeys.has(itemKey)) continue;
        await publishOne("short", slot, `Short ${slot}`);
      }

      setProgress("");
      setMessage("YouTube publishing complete. Approved local files were uploaded directly from your Mac — no full videos were staged in Supabase.");
      await loadWorkerStatus();
    } catch (err) {
      setProgress("");
      setError(err instanceof Error ? err.message : "YouTube publishing failed.");
      await loadWorkerStatus();
    } finally {
      setBusy(false);
    }
  }

  async function saveYouTubeReceipt(receipt: YouTubeReceipt) {
    await jsonResponse<any>(
      await fetch(`${WORKER}/publishing/youtube/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: safeProjectId, receipt }),
      }),
      "YouTube was scheduled, but Universe could not save the local schedule receipt."
    );
  }

  async function scheduleYouTubeRelease() {
    if (!safeProjectId || !allYouTubePublished) return;
    setYoutubeScheduleBusy(true);
    setYoutubeScheduleError("");
    setYoutubeScheduleMessage("");

    try {
      if (!youtubeConnected) throw new Error("YouTube is not connected in Universe.");
      const fullTime = new Date(youtubeScheduleFull).getTime();
      const shortsStart = new Date(youtubeScheduleShortsStart).getTime();
      if (!Number.isFinite(fullTime) || fullTime <= Date.now() + 120_000) throw new Error("Choose a future date and time for the full YouTube video.");
      if (!Number.isFinite(shortsStart) || shortsStart <= Date.now() + 120_000) throw new Error("Choose a future start date and time for YouTube Shorts.");

      const receiptMap = new Map<string, YouTubeReceipt>(receipts.map((receipt) => [receipt.itemKey, receipt] as [string, YouTubeReceipt]));
      const fullReceipt = receiptMap.get("youtube-full");
      if (!fullReceipt?.videoId) throw new Error("The uploaded full YouTube video receipt is missing.");

      const scheduleOne = async (receipt: YouTubeReceipt, publishAt: string, label: string) => {
        setProgress(`${label}: scheduling on YouTube…`);
        const result = await jsonResponse<any>(
          await fetch("/api/publishing/youtube/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: safeProjectId, videoId: receipt.videoId, publishAt }),
          }),
          `Could not schedule ${label} on YouTube.`
        );
        await saveYouTubeReceipt({ ...receipt, scheduledAt: result.publishAt || publishAt, status: "scheduled" });
      };

      let scheduledNow = 0;
      if (!fullReceipt.scheduledAt) {
        await scheduleOne(fullReceipt, new Date(fullTime).toISOString(), "Full video");
        scheduledNow += 1;
      }
      for (let slot = 1; slot <= 6; slot += 1) {
        const key = `youtube-short-${String(slot).padStart(2, "0")}`;
        const receipt = receiptMap.get(key);
        if (!receipt?.videoId) throw new Error(`YouTube Short ${slot} receipt is missing.`);
        if (receipt.scheduledAt) continue;
        const dueAt = new Date(shortsStart + (slot - 1) * Math.max(1, youtubeGapMinutes) * 60_000).toISOString();
        await scheduleOne(receipt, dueAt, `Short ${slot}`);
        scheduledNow += 1;
      }

      await loadWorkerStatus();
      setProgress("");
      setYoutubeScheduleMessage(scheduledNow ? `YouTube scheduling updated ✓ ${scheduledNow} previously-unscheduled item${scheduledNow === 1 ? "" : "s"} added.` : "YouTube is already fully scheduled ✓ Nothing was changed.");
    } catch (err) {
      setProgress("");
      setYoutubeScheduleError(err instanceof Error ? err.message : "Could not schedule YouTube release.");
      await loadWorkerStatus();
    } finally {
      setYoutubeScheduleBusy(false);
    }
  }

  async function saveBufferReceipt(receipt: BufferReceipt) {
    await jsonResponse<any>(
      await fetch(`${WORKER}/publishing/buffer/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: safeProjectId, receipt }),
      }),
      "Buffer post was created, but Universe could not save its local receipt."
    );
  }

  async function stageShort(slot: number) {
    setBufferProgress(`Short ${slot}: checking approved local file…`);
    const info = await jsonResponse<any>(
      await fetch(`${WORKER}/publishing/file-info?projectId=${encodeURIComponent(safeProjectId)}&kind=short&slot=${slot}`, { cache: "no-store" }),
      `Could not find approved Short ${slot}.`
    );

    setBufferProgress(`Short ${slot}: preparing temporary Buffer media bridge…`);
    const stage = await jsonResponse<any>(
      await fetch("/api/publishing/buffer/stage-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: safeProjectId,
          slot,
          originalFilename: info.filename,
          mimeType: info.mimeType,
          sizeBytes: info.sizeBytes,
        }),
      }),
      `Could not prepare temporary staging for Short ${slot}.`
    );

    setBufferProgress(`Short ${slot}: uploading one temporary copy for Buffer…`);
    await jsonResponse<any>(
      await fetch(`${WORKER}/publish/buffer/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: safeProjectId,
          slot,
          signedUploadUrl: stage.upload.signedUploadUrl,
        }),
      }),
      `Could not stage Short ${slot} for Buffer.`
    );

    const opened = await jsonResponse<any>(
      await fetch("/api/publishing/buffer/stage-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: safeProjectId, storagePath: stage.upload.storagePath }),
      }),
      `Could not create Buffer media link for Short ${slot}.`
    );

    return { storagePath: stage.upload.storagePath as string, mediaUrl: opened.mediaUrl as string };
  }

  function scheduledTimeForSlot(slot: number) {
    if (bufferMode !== "schedule") return undefined;
    const start = new Date(bufferScheduleStart);
    if (!Number.isFinite(start.getTime())) throw new Error("Choose the first scheduled date and time.");
    const due = new Date(start.getTime() + (slot - 1) * Math.max(1, bufferGapMinutes) * 60_000);
    return due.toISOString();
  }

  async function runBufferBatch() {
    if (!safeProjectId) return;
    setBufferBusy(true);
    setBufferError("");
    setBufferMessage("");
    setBufferProgress("");

    try {
      if (!workerReady) throw new Error("Universe local worker is not connected.");
      if (!bufferConfigured) throw new Error("Buffer is not configured yet.");
      if (approvedShorts.length !== 6) throw new Error("Approve all 6 Shorts before sending them to Buffer.");
      if (!selectedBufferChannels.length) throw new Error("Choose at least one Buffer channel.");
      if (bufferMode === "schedule") {
        const start = new Date(bufferScheduleStart).getTime();
        if (!Number.isFinite(start) || start <= Date.now() + 60_000) throw new Error("Choose a future first scheduled time.");
        const finalTime = start + 5 * Math.max(1, bufferGapMinutes) * 60_000;
        if (finalTime > Date.now() + 29 * 24 * 60 * 60 * 1000) throw new Error("Keep the final scheduled Short within the next 29 days.");
      }

      const current = new Map<string, BufferReceipt>();
      for (const receipt of canonicalBufferReceipts) current.set(receipt.itemKey, receipt);
      let createdCount = 0;

      for (let slot = 1; slot <= 6; slot += 1) {
        const pending = selectedBufferChannels.filter((channel) => {
          const receipt = current.get(bufferKey(channel.id, slot));
          return !receipt || receipt.status === "error";
        });
        if (!pending.length) continue;

        const staged = await stageShort(slot);

        for (const channel of pending) {
          setBufferProgress(`Short ${slot}: creating ${titleCase(channel.service)} post for ${channel.name}…`);
          const dueAt = scheduledTimeForSlot(slot);
          const created = await jsonResponse<any>(
            await fetch("/api/publishing/buffer/create-post", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: safeProjectId,
                slot,
                channelId: channel.id,
                service: channel.service,
                mediaUrl: staged.mediaUrl,
                publishMode: bufferMode,
                dueAt,
              }),
            }),
            `Buffer could not create ${channel.service} Short ${slot}.`
          );

          const receipt: BufferReceipt = {
            itemKey: bufferKey(channel.id, slot),
            slot,
            service: channel.service,
            channelId: channel.id,
            channelName: channel.name,
            postId: created.post.id,
            status: created.post.status || (bufferMode === "draft" ? "draft" : "scheduled"),
            dueAt: created.post.dueAt || dueAt || null,
            externalLink: created.post.externalLink || null,
            storagePath: staged.storagePath,
            mediaUrl: staged.mediaUrl,
            publishMode: bufferMode,
            createdAt: new Date().toISOString(),
          };
          await saveBufferReceipt(receipt);
          current.set(receipt.itemKey, receipt);
          createdCount += 1;
        }
      }

      await loadWorkerStatus();
      setBufferProgress("");
      const total = selectedBufferChannels.length * 6;
      if (createdCount === 0) {
        setBufferMessage(`All ${total} selected Buffer posts already have receipts. Use Refresh Buffer Status to check delivery.`);
      } else if (bufferMode === "draft") {
        setBufferMessage(`${createdCount} Buffer draft${createdCount === 1 ? "" : "s"} created. Nothing was published.`);
      } else if (bufferMode === "queue") {
        setBufferMessage(`${createdCount} post${createdCount === 1 ? "" : "s"} added to the Buffer queues.`);
      } else {
        setBufferMessage(`${createdCount} post${createdCount === 1 ? "" : "s"} scheduled through Buffer.`);
      }
    } catch (err) {
      setBufferProgress("");
      setBufferError(err instanceof Error ? err.message : "Buffer batch failed.");
      await loadWorkerStatus();
    } finally {
      setBufferBusy(false);
    }
  }

  async function scheduleExistingBufferDrafts() {
    if (!safeProjectId) return;
    setBufferBusy(true);
    setBufferError("");
    setBufferMessage("");
    setBufferProgress("");

    try {
      if (!bufferConfigured) throw new Error("Buffer is not configured yet.");
      if (!selectedBufferChannels.length) throw new Error("Choose at least one Buffer channel.");
      const start = new Date(bufferScheduleStart).getTime();
      if (!Number.isFinite(start) || start <= Date.now() + 120_000) throw new Error("Choose a future first Buffer time.");
      const finalTime = start + 5 * Math.max(1, bufferGapMinutes) * 60_000;
      if (finalTime > Date.now() + 29 * 24 * 60 * 60 * 1000) throw new Error("Keep the final Buffer Short within the next 29 days while temporary media remains available.");

      let scheduledCount = 0;
      for (let slot = 1; slot <= 6; slot += 1) {
        const dueAt = new Date(start + (slot - 1) * Math.max(1, bufferGapMinutes) * 60_000).toISOString();
        for (const channel of selectedBufferChannels) {
          const key = bufferKey(channel.id, slot);
          const receipt = canonicalBufferMap.get(key);
          if (!receipt?.postId) throw new Error(`${channel.name} · Short ${slot} has no Buffer draft receipt.`);
          if (receipt.status === "sent" || receipt.status === "sending" || (receipt.status === "scheduled" && receipt.dueAt)) continue;

          setBufferProgress(`Scheduling ${titleCase(channel.service)} · Short ${slot}…`);
          const result = await jsonResponse<any>(
            await fetch("/api/publishing/buffer/schedule-post", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projectId: safeProjectId, postId: receipt.postId, dueAt }),
            }),
            `Could not schedule ${channel.service} Short ${slot}.`
          );

          const updated: BufferReceipt = {
            ...receipt,
            status: result.post?.status || "scheduled",
            dueAt: result.post?.dueAt || dueAt,
            externalLink: result.post?.externalLink || receipt.externalLink || null,
            publishMode: "schedule",
            updatedAt: new Date().toISOString(),
          };
          await saveBufferReceipt(updated);
          scheduledCount += 1;
        }
      }

      await loadWorkerStatus();
      setBufferProgress("");
      setBufferMessage(scheduledCount ? `${scheduledCount} previously-unscheduled Buffer post${scheduledCount === 1 ? "" : "s"} scheduled ✓ Existing drafts were reused; no videos were uploaded again.` : "All selected Buffer posts are already scheduled/sent ✓ Nothing was changed.");
    } catch (err) {
      setBufferProgress("");
      setBufferError(err instanceof Error ? err.message : "Could not schedule Buffer drafts.");
      await loadWorkerStatus();
    } finally {
      setBufferBusy(false);
    }
  }

  async function refreshBufferStatuses() {
    if (!safeProjectId || !bufferReceipts.length) return;
    setBufferBusy(true);
    setBufferError("");
    setBufferMessage("");
    setBufferProgress("Refreshing Buffer delivery status…");
    try {
      const uniqueIds = Array.from(new Set(bufferReceipts.map((receipt) => receipt.postId).filter(Boolean)));
      const data = await jsonResponse<any>(
        await fetch("/api/publishing/buffer/post-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ postIds: uniqueIds }),
        }),
        "Could not refresh Buffer status."
      );
      const statusById = new Map<string, any>((Array.isArray(data.posts) ? data.posts : []).map((post: any) => [String(post.id), post]));
      const merged: BufferReceipt[] = [];

      for (const receipt of bufferReceipts) {
        const remote = statusById.get(receipt.postId);
        const updated: BufferReceipt = remote
          ? {
              ...receipt,
              status: remote.status || receipt.status,
              dueAt: remote.dueAt ?? receipt.dueAt,
              sentAt: remote.sentAt ?? receipt.sentAt,
              externalLink: remote.externalLink ?? receipt.externalLink,
              errorMessage: remote.error?.message || null,
              updatedAt: new Date().toISOString(),
            }
          : receipt;
        await saveBufferReceipt(updated);
        merged.push(updated);
      }

      const paths = Array.from(new Set(merged.map((receipt) => receipt.storagePath).filter((value): value is string => Boolean(value))));
      let cleaned = 0;
      for (const storagePath of paths) {
        const users = merged.filter((receipt) => receipt.storagePath === storagePath);
        if (!users.length || users.some((receipt) => receipt.status !== "sent") || users.every((receipt) => receipt.cleanedAt)) continue;

        await jsonResponse<any>(
          await fetch("/api/publishing/buffer/cleanup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: safeProjectId, storagePath }),
          }),
          "A Buffer post was sent, but temporary media cleanup failed."
        );

        for (const receipt of users) {
          const cleanedReceipt: BufferReceipt = { ...receipt, mediaUrl: undefined, cleanedAt: new Date().toISOString() };
          await saveBufferReceipt(cleanedReceipt);
        }
        cleaned += 1;
      }

      await loadWorkerStatus();
      setBufferProgress("");
      setBufferMessage(cleaned ? `Buffer status refreshed. ${cleaned} temporary staged video${cleaned === 1 ? "" : "s"} cleaned up after publishing.` : "Buffer status refreshed.");
    } catch (err) {
      setBufferProgress("");
      setBufferError(err instanceof Error ? err.message : "Could not refresh Buffer status.");
    } finally {
      setBufferBusy(false);
    }
  }

  function toggleBufferChannel(id: string) {
    setSelectedBufferChannelIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  const fullPublished = publishedKeys.has("youtube-full");
  const shortPublishedCount = Array.from({ length: 6 }, (_, i) =>
    publishedKeys.has(`youtube-short-${String(i + 1).padStart(2, "0")}`)
  ).filter(Boolean).length;
  const allYouTubePublished = fullPublished && shortPublishedCount === 6;

  const expectedBufferPosts = selectedBufferChannels.length * 6;
  const canonicalBufferMap = useMemo(
    () => new Map(canonicalBufferReceipts.map((receipt) => [receipt.itemKey, receipt])),
    [canonicalBufferReceipts]
  );
  const selectedBufferCreatedCount = useMemo(() => {
    let count = 0;
    for (const channel of selectedBufferChannels) {
      for (let slot = 1; slot <= 6; slot += 1) {
        const receipt = canonicalBufferMap.get(bufferKey(channel.id, slot));
        if (receipt && receipt.status !== "error") count += 1;
      }
    }
    return count;
  }, [canonicalBufferMap, selectedBufferChannels]);

  const youtubeScheduledCount = receipts.filter((receipt) => Boolean(receipt.scheduledAt)).length;
  const bufferPreparedTotal = canonicalBufferReceipts.filter((receipt) => receipt.status !== "error").length;
  const bufferScheduledTotal = canonicalBufferReceipts.filter((receipt) => Boolean(receipt.dueAt) || ["scheduled", "sending", "sent"].includes(receipt.status || "")).length;
  const bufferSentTotal = canonicalBufferReceipts.filter((receipt) => receipt.status === "sent").length;
  const bufferFailedTotal = canonicalBufferReceipts.filter((receipt) => receipt.status === "error").length;
  const stagedPaths = Array.from(new Set(canonicalBufferReceipts.map((receipt) => receipt.storagePath).filter((value): value is string => Boolean(value))));
  const cleanedPaths = new Set(canonicalBufferReceipts.filter((receipt) => receipt.cleanedAt && receipt.storagePath).map((receipt) => receipt.storagePath as string));
  const pendingTempCount = Math.max(0, stagedPaths.length - cleanedPaths.size);
  const expectedAllBufferPosts = bufferChannels.length * 6;
  const schedulingComplete = youtubeScheduledCount === 7 && expectedAllBufferPosts > 0 && bufferScheduledTotal >= expectedAllBufferPosts;
  const releaseStatusLabel = schedulingComplete ? "Release Scheduled ✓" : allYouTubePublished && bufferPreparedTotal >= expectedAllBufferPosts && expectedAllBufferPosts > 0 ? "Publishing Prepared" : "Release Ready";

  if (!releaseReady) return null;

  return (
    <div className="mt-3 rounded-[22px] border border-cyan-300/15 bg-[#07171d]/90 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-zinc-100">Publish</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
            YouTube uploads directly from your Mac. Buffer uses one temporary copy of each Short to hand it to TikTok, Instagram and Facebook.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-cyan-200">
            YouTube local-first
          </span>
          <button type="button" onClick={() => setPublishOpen((value) => !value)} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[9px] font-black text-zinc-300 transition hover:border-white/20 hover:text-white">
            {publishOpen ? "Collapse" : "Expand"}
          </button>
        </div>
      </div>

      {!publishOpen && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-white/[0.06] bg-black/10 px-3 py-2 text-[9px] font-bold text-zinc-400">
          <span className="text-emerald-200">{releaseStatusLabel}</span>
          <span>YouTube {(fullPublished ? 1 : 0) + shortPublishedCount}/7 · {youtubeScheduledCount}/7 scheduled</span>
          <span>Buffer {bufferPreparedTotal}/{expectedAllBufferPosts || 0} · {bufferScheduledTotal} scheduled</span>
          {pendingTempCount > 0 && <span className="text-amber-200">Temp media {pendingTempCount} pending</span>}
        </div>
      )}

      {publishOpen && (<>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] px-3 py-2.5">
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-500">Release status</p>
          <p className="mt-1 text-[10px] font-black text-emerald-200">{releaseStatusLabel}</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-500">YouTube</p>
          <p className="mt-1 text-[9px] font-bold text-cyan-200">{(fullPublished ? 1 : 0) + shortPublishedCount}/7 uploaded · {youtubeScheduledCount}/7 scheduled</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-500">Buffer</p>
          <p className="mt-1 text-[9px] font-bold text-fuchsia-200">{bufferPreparedTotal}/{expectedAllBufferPosts || 0} prepared · {bufferScheduledTotal} scheduled · {bufferSentTotal} sent{bufferFailedTotal ? ` · ${bufferFailedTotal} failed` : ""}</p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <p className="text-[8px] font-black uppercase tracking-[0.12em] text-zinc-500">Temporary media</p>
          <p className={pendingTempCount ? "mt-1 text-[9px] font-bold text-amber-200" : "mt-1 text-[9px] font-bold text-emerald-200"}>{stagedPaths.length ? `${cleanedPaths.size}/${stagedPaths.length} cleaned · ${pendingTempCount} pending` : "None staged"}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <p className="text-[9px] font-black text-zinc-300">Universe worker</p>
          <p className={workerReady ? "mt-1 text-[9px] text-emerald-300" : "mt-1 text-[9px] text-amber-200"}>
            {workerReady ? "Connected ✓" : "Not connected"}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <p className="text-[9px] font-black text-zinc-300">YouTube</p>
          <p className={youtubeConnected ? "mt-1 text-[9px] text-emerald-300" : "mt-1 text-[9px] text-amber-200"}>
            {youtubeConnected ? "Connected ✓" : "Not connected"}
          </p>
        </div>
        <div className="rounded-xl border border-white/[0.07] bg-black/15 px-3 py-2.5">
          <p className="text-[9px] font-black text-zinc-300">YouTube published</p>
          <p className="mt-1 text-[9px] text-cyan-200">{fullPublished ? "Full ✓" : "Full —"} · {shortPublishedCount}/6 Shorts</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr]">
        <label className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
          <span className="text-[9px] font-black text-zinc-300">YouTube visibility</span>
          <select value={privacyStatus} onChange={(event) => setPrivacyStatus(event.target.value as any)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none">
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
          <span className="text-[9px] font-black text-zinc-300">Made for kids?</span>
          <select value={madeForKids ? "yes" : "no"} onChange={(event) => setMadeForKids(event.target.value === "yes")} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none">
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </label>
        <label className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
          <span className="text-[9px] font-black text-zinc-300">Synthetic / AI disclosure</span>
          <select value={containsSyntheticMedia ? "yes" : "no"} onChange={(event) => setContainsSyntheticMedia(event.target.value === "yes")} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none">
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>

      {progress && <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.05] px-3 py-2.5 text-[10px] font-bold text-cyan-100">{progress}</div>}
      {error && <div className="mt-3 rounded-xl border border-red-300/20 bg-red-300/[0.05] px-3 py-2.5 text-[10px] font-bold text-red-200">{error}</div>}
      {message && <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.05] px-3 py-2.5 text-[10px] font-bold text-emerald-200">{message}</div>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button disabled={busy || !workerReady || !youtubeConnected || allYouTubePublished} onClick={() => void publishYouTube()} className="rounded-xl bg-gradient-to-r from-[#ff9a84] to-[#e95ccf] px-4 py-2.5 text-xs font-black text-[#281321] disabled:cursor-not-allowed disabled:opacity-35">
          {busy ? "Publishing…" : allYouTubePublished ? "YouTube Published ✓" : receipts.length ? "Retry Unfinished YouTube Only" : "Publish YouTube — Direct from Mac"}
        </button>
        <button disabled={busy} onClick={() => void loadWorkerStatus()} className="rounded-xl border border-white/10 px-3 py-2.5 text-[10px] font-black text-zinc-300 disabled:opacity-40">Refresh YouTube Status</button>
      </div>

      {receipts.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {receipts.map((receipt) => (
            <a key={receipt.itemKey} href={receipt.url} target="_blank" rel="noreferrer" className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.04] px-3 py-2.5 transition hover:border-emerald-300/30">
              <p className="text-[9px] font-black text-emerald-200">{receipt.kind === "full" ? "Full Video" : `Short ${receipt.slot}`} ✓</p>
              <p className="mt-1 truncate text-[8px] text-zinc-500">{receipt.videoId}</p>
              {receipt.scheduledAt && <p className="mt-1 text-[8px] text-cyan-200">Scheduled: {new Date(receipt.scheduledAt).toLocaleString()}</p>}
            </a>
          ))}
        </div>
      )}

      {allYouTubePublished && (
        <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.025] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-zinc-100">Schedule YouTube</p>
              <p className="mt-1 text-[10px] leading-5 text-zinc-500">Schedule the already-uploaded private full video and Shorts. Nothing is uploaded again.</p>
            </div>
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.05] px-3 py-1.5 text-[9px] font-black text-emerald-200">7 uploads ready</span>
          </div>

          {youtubeScheduleError && <div className="mt-3 rounded-xl border border-red-300/20 bg-red-300/[0.05] px-3 py-2.5 text-[10px] font-bold text-red-200">{youtubeScheduleError}</div>}
          {youtubeScheduleMessage && <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.05] px-3 py-2.5 text-[10px] font-bold text-emerald-200">{youtubeScheduleMessage}</div>}

          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <label className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
              <span className="text-[9px] font-black text-zinc-300">Full video date & time</span>
              <input type="datetime-local" value={youtubeScheduleFull} onChange={(event) => setYoutubeScheduleFull(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none" />
            </label>
            <label className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
              <span className="text-[9px] font-black text-zinc-300">Short 1 date & time</span>
              <input type="datetime-local" value={youtubeScheduleShortsStart} onChange={(event) => setYoutubeScheduleShortsStart(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none" />
            </label>
            <label className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
              <span className="text-[9px] font-black text-zinc-300">Gap between YouTube Shorts</span>
              <select value={youtubeGapMinutes} onChange={(event) => setYoutubeGapMinutes(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none">
                <option value={60}>1 hour</option>
                <option value={240}>4 hours</option>
                <option value={720}>12 hours</option>
                <option value={1440}>1 day</option>
                <option value={2880}>2 days</option>
              </select>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button disabled={youtubeScheduleBusy || !youtubeConnected} onClick={() => void scheduleYouTubeRelease()} className="rounded-xl bg-gradient-to-r from-[#ff9a84] to-[#e95ccf] px-4 py-3 text-[10px] font-black text-[#281321] disabled:cursor-not-allowed disabled:opacity-35">
              {youtubeScheduleBusy ? "Scheduling YouTube…" : "Schedule YouTube Release"}
            </button>
            <span className="text-[8px] leading-4 text-zinc-600">YouTube scheduling requires the videos to remain Private until their release time.</span>
          </div>
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-fuchsia-300/15 bg-fuchsia-300/[0.025] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-zinc-100">Buffer — TikTok / Instagram / Facebook</p>
            <p className="mt-1 max-w-2xl text-[10px] leading-5 text-zinc-500">
              Send all six approved Shorts to the selected channels. Each Short is staged once, then reused for every selected Buffer destination.
            </p>
          </div>
          <span className={bufferConfigured ? "rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-3 py-1.5 text-[9px] font-black text-emerald-200" : "rounded-full border border-amber-300/20 bg-amber-300/[0.06] px-3 py-1.5 text-[9px] font-black text-amber-200"}>
            {bufferConfigured ? `${bufferChannels.length} channels connected` : "API key needed"}
          </span>
        </div>

        {!bufferConfigured && !bufferError && <div className="mt-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2.5 text-[10px] text-amber-100">Add <b>BUFFER_API_KEY</b> to <b>.env.local</b>, restart npm run dev, then refresh.</div>}
        {bufferError && <div className="mt-3 rounded-xl border border-red-300/20 bg-red-300/[0.05] px-3 py-2.5 text-[10px] font-bold text-red-200">{bufferError}</div>}
        {bufferMessage && <div className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.05] px-3 py-2.5 text-[10px] font-bold text-emerald-200">{bufferMessage}</div>}
        {bufferProgress && <div className="mt-3 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.05] px-3 py-2.5 text-[10px] font-bold text-cyan-100">{bufferProgress}</div>}

        <div className="mt-3 grid gap-3 lg:grid-cols-[1.3fr_1fr]">
          <div className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-black text-zinc-300">Channels</span>
              <button type="button" onClick={() => setSelectedBufferChannelIds(bufferChannels.map((channel) => channel.id))} className="text-[8px] font-bold text-cyan-200">Select all</button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {bufferChannels.map((channel) => {
                const checked = selectedBufferChannelIds.includes(channel.id);
                return (
                  <label key={channel.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-[9px] ${checked ? "border-emerald-300/25 bg-emerald-300/[0.05] text-emerald-100" : "border-white/10 bg-[#0d2029] text-zinc-400"}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleBufferChannel(channel.id)} />
                    <span className="min-w-0"><b>{titleCase(channel.service)}</b><br /><span className="block truncate text-[8px] opacity-70">{channel.name}</span></span>
                  </label>
                );
              })}
            </div>
          </div>

          <label className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
            <span className="text-[9px] font-black text-zinc-300">Send as</span>
            <select value={bufferMode} onChange={(event) => setBufferMode(event.target.value as BufferMode)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none">
              <option value="draft">Drafts — publish nothing yet</option>
              <option value="queue">Add to each Buffer queue</option>
              <option value="schedule">Schedule exact times</option>
            </select>
          </label>
        </div>

        {bufferMode === "schedule" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
              <span className="text-[9px] font-black text-zinc-300">Short 1 date & time</span>
              <input type="datetime-local" value={bufferScheduleStart} onChange={(event) => setBufferScheduleStart(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none" />
            </label>
            <label className="rounded-xl border border-white/[0.07] bg-black/10 p-3">
              <span className="text-[9px] font-black text-zinc-300">Gap between Shorts</span>
              <select value={bufferGapMinutes} onChange={(event) => setBufferGapMinutes(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none">
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={120}>2 hours</option>
                <option value={240}>4 hours</option>
                <option value={1440}>1 day</option>
              </select>
            </label>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button disabled={bufferBusy || !bufferConfigured || !workerReady || !selectedBufferChannels.length || approvedShorts.length !== 6} onClick={() => void runBufferBatch()} className="rounded-xl bg-gradient-to-r from-[#9fe8d5] to-[#6fc8dc] px-4 py-3 text-[10px] font-black text-[#092028] disabled:cursor-not-allowed disabled:opacity-35">
            {bufferBusy ? "Working…" : selectedBufferCreatedCount > 0 ? "Retry Missing / Failed" : `Prepare ${expectedBufferPosts} Buffer Posts`}
          </button>
          <button disabled={bufferBusy || !bufferReceipts.length} onClick={() => void refreshBufferStatuses()} className="rounded-xl border border-white/10 px-3 py-3 text-[10px] font-black text-zinc-300 disabled:opacity-35">Refresh + Cleanup Buffer</button>
          <span className="text-[9px] text-zinc-500">{selectedBufferCreatedCount}/{expectedBufferPosts || 0} selected destinations prepared</span>
        </div>

        {canonicalBufferReceipts.length > 0 && (
          <div className="mt-4 rounded-xl border border-emerald-300/15 bg-emerald-300/[0.025] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-black text-emerald-100">Schedule existing Buffer drafts</p>
                <p className="mt-1 text-[8px] leading-4 text-zinc-500">Uses the posts already uploaded to Buffer. No Short is uploaded again.</p>
              </div>
              <span className="text-[8px] font-black text-emerald-300">{canonicalBufferReceipts.length} receipts ready</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="rounded-lg border border-white/[0.07] bg-black/10 p-2.5 sm:col-span-2">
                <span className="text-[8px] font-black text-zinc-300">Short 1 date & time</span>
                <input type="datetime-local" value={bufferScheduleStart} onChange={(event) => setBufferScheduleStart(event.target.value)} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none" />
              </label>
              <label className="rounded-lg border border-white/[0.07] bg-black/10 p-2.5">
                <span className="text-[8px] font-black text-zinc-300">Gap between Shorts</span>
                <select value={bufferGapMinutes} onChange={(event) => setBufferGapMinutes(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-white/10 bg-[#0d2029] px-2.5 py-2 text-[9px] font-bold text-zinc-200 outline-none">
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={240}>4 hours</option>
                  <option value={720}>12 hours</option>
                  <option value={1440}>1 day</option>
                  <option value={2880}>2 days</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button disabled={bufferBusy || !selectedBufferChannels.length} onClick={() => void scheduleExistingBufferDrafts()} className="rounded-xl bg-gradient-to-r from-[#9fe8d5] to-[#6fc8dc] px-4 py-3 text-[10px] font-black text-[#092028] disabled:cursor-not-allowed disabled:opacity-35">
                {bufferBusy ? "Scheduling…" : `Schedule ${selectedBufferChannels.length * 6} Existing Buffer Posts`}
              </button>
              <span className="text-[8px] leading-4 text-zinc-600">The same Short number is scheduled at the same time on TikTok, Instagram and Facebook.</span>
            </div>
          </div>
        )}

        {canonicalBufferReceipts.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {canonicalBufferReceipts.map((receipt) => {
              const status = receipt.status || "unknown";
              const good = status === "sent" || status === "scheduled" || status === "draft" || status === "sending";
              const card = (
                <div className={`rounded-xl border px-3 py-2.5 ${status === "error" ? "border-red-300/20 bg-red-300/[0.04]" : "border-fuchsia-300/10 bg-black/10"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-black text-fuchsia-200">{titleCase(receipt.service)} · Short {receipt.slot}</p>
                    <span className={`text-[8px] font-black ${good ? "text-emerald-300" : status === "error" ? "text-red-300" : "text-zinc-400"}`}>{status}</span>
                  </div>
                  <p className="mt-1 truncate text-[8px] text-zinc-500">{receipt.channelName || receipt.channelId}</p>
                  {receipt.dueAt && <p className="mt-1 text-[8px] text-zinc-600">{new Date(receipt.dueAt).toLocaleString()}</p>}
                  {receipt.errorMessage && <p className="mt-1 text-[8px] text-red-300">{receipt.errorMessage}</p>}
                  {receipt.cleanedAt && <p className="mt-1 text-[8px] text-emerald-400/70">Temporary media cleaned ✓</p>}
                </div>
              );
              return receipt.externalLink ? <a key={receipt.itemKey} href={receipt.externalLink} target="_blank" rel="noreferrer">{card}</a> : <div key={receipt.itemKey}>{card}</div>;
            })}
          </div>
        )}

        {bufferReceipts.some((receipt) => receipt.itemKey !== bufferKey(receipt.channelId, receipt.slot)) && (
          <p className="mt-3 text-[8px] leading-4 text-amber-200/75">Older V5.3A test-draft receipts are still in the local history. They are not counted in the V5.3B batch.</p>
        )}

        <p className="mt-3 text-[8px] leading-4 text-zinc-600">
          Buffer requires a reachable video URL, so Universe temporarily stages each Short. Refreshing status removes that staged file after every Buffer post using it reaches <b>sent</b>. Drafts should be scheduled within 30 days so the temporary media link remains valid.
        </p>
      </div>
      </>)}
    </div>
  );
}
