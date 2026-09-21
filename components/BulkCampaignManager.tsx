"use client";

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Platform = "youtube" | "facebook" | "instagram" | "tiktok";
type JsonRecord = Record<string, unknown>;
type FilterMode = "all" | "errors" | "ready" | "missing-media" | "scheduled";

type ValidationIssue = {
  code?: string;
  message?: string;
  severity?: "error" | "warning";
};

type Campaign = {
  id: string;
  song_id?: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type CampaignJob = {
  id: string;
  campaign_id?: string;
  song_id?: string;
  connection_id?: string | null;
  platform: Platform;
  content_type: string;
  item_key: string;
  title: string | null;
  caption: string | null;
  description: string | null;
  hashtags: string[];
  tags: string[];
  media_asset_id: string | null;
  payload: Record<string, unknown>;
  ready_to_publish: boolean;
  status: string;
  scheduled_for: string | null;
  schedule_timezone: string | null;
  external_post_id?: string | null;
  external_url?: string | null;
  error_message?: string | null;
  published_at?: string | null;
  validation_errors: Array<ValidationIssue | string>;
};

type CampaignSummary = {
  total: number;
  withMedia: number;
  issueCount: number;
  errorCount: number;
  byPlatform: Record<Platform, number>;
};

type Props = {
  projectId?: string | null;
  songTitle?: string;
};

type EditDraft = {
  title: string;
  caption: string;
  description: string;
  hashtags: string;
  tags: string;
  ready_to_publish: boolean;
  scheduled_for: string;
  schedule_timezone: string;
};

type TikTokCreatorInfo = {
  creatorNickname: string;
  creatorUsername: string;
  creatorAvatarUrl: string;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
  mediaUrl: string;
  mediaFilename: string;
  mediaMimeType: string;
};

const platforms: Platform[] = ["youtube", "facebook", "instagram", "tiktok"];

const emptySummary: CampaignSummary = {
  total: 0,
  withMedia: 0,
  issueCount: 0,
  errorCount: 0,
  byPlatform: {
    youtube: 0,
    facebook: 0,
    instagram: 0,
    tiktok: 0,
  },
};

const platformStyles: Record<Platform, string> = {
  youtube: "border-red-400/20 bg-red-400/10 text-red-200",
  facebook: "border-blue-400/20 bg-blue-400/10 text-blue-200",
  instagram: "border-pink-400/20 bg-pink-400/10 text-pink-200",
  tiktok: "border-cyan-400/20 bg-cyan-400/10 text-cyan-200",
};

const platformLabels: Record<Platform, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
};

function asRecord(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function issueMessage(issue: ValidationIssue | string) {
  if (typeof issue === "string") return issue;
  return issue.message || issue.code || "Validation issue";
}

function issueSeverity(issue: ValidationIssue | string) {
  if (typeof issue === "string") return "error";
  return issue.severity === "warning" ? "warning" : "error";
}

function blockingIssues(job: CampaignJob) {
  const issues = Array.isArray(job.validation_errors) ? job.validation_errors : [];
  return issues.filter((entry) => issueSeverity(entry) === "error");
}

function warningIssues(job: CampaignJob) {
  const issues = Array.isArray(job.validation_errors) ? job.validation_errors : [];
  return issues.filter((entry) => issueSeverity(entry) === "warning");
}

function hasMissingMedia(job: CampaignJob) {
  return (job.validation_errors || []).some((entry) => {
    if (typeof entry === "string") return /media/i.test(entry);
    return entry.code === "missing_media" || entry.code === "missing_thumbnail";
  });
}

function compactCopy(job: CampaignJob) {
  return job.title || job.caption || job.description || "No copy saved";
}

function prettyContentType(value: string) {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function timezoneName() {
  return "Europe/London";
}

function isoToLocalInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localInputToIso(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function parseListInput(value: string) {
  return value
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseSpreadsheetArray(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Fall back to human-editable separators.
  }
  return trimmed
    .split(/\s*\|\s*|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toBoolean(value: string) {
  return ["yes", "true", "1", "ready", "y"].includes(value.trim().toLowerCase());
}

function escapeCsv(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  row.push(field.replace(/\r$/, ""));
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(cleanString(asRecord(data).error) || fallback);
  }
  return asRecord(data);
}

function tikTokPrivacyLabel(value: string) {
  const labels: Record<string, string> = {
    PUBLIC_TO_EVERYONE: "Everyone",
    MUTUAL_FOLLOW_FRIENDS: "Friends",
    FOLLOWER_OF_CREATOR: "Followers",
    SELF_ONLY: "Only me",
  };
  return labels[value] || value;
}

function tikTokCampaignTitle(job: CampaignJob) {
  const copy = cleanString(job.caption) || cleanString(job.title) || cleanString(job.description);
  const hashtags = Array.isArray(job.hashtags)
    ? job.hashtags.map((tag) => cleanString(tag)).filter(Boolean)
    : [];
  const missing = hashtags.filter(
    (tag) => !copy.toLocaleLowerCase().includes(tag.toLocaleLowerCase())
  );
  return [copy, missing.join(" ")].filter(Boolean).join("\n\n");
}

async function probeVideoDuration(url: string) {
  if (!url) throw new Error("TikTok media preview URL is missing.");
  return new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      callback();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error("Could not read the linked video's duration.")));
    }, 15000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      finish(() => {
        if (Number.isFinite(duration) && duration > 0) resolve(duration);
        else reject(new Error("The linked video's duration could not be determined."));
      });
    };
    video.onerror = () => {
      finish(() => reject(new Error("Could not open the linked video to check its duration.")));
    };
    video.src = url;
  });
}

function sanitizeFilename(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9\u00C0-\u024F\u0980-\u09FF\u0900-\u097F_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "release-campaign";
}

export default function BulkCampaignManager({ projectId, songTitle }: Props) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [jobs, setJobs] = useState<CampaignJob[]>([]);
  const [summary, setSummary] = useState<CampaignSummary>(emptySummary);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generationStage, setGenerationStage] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"all" | Platform>("all");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSchedule, setBulkSchedule] = useState("");
  const [youtubePublishing, setYoutubePublishing] = useState(false);
  const [youtubeVisibility, setYoutubeVisibility] = useState<"private" | "unlisted" | "public">("private");
  const [youtubeMadeForKids, setYoutubeMadeForKids] = useState<"default" | "yes" | "no">("default");
  const [youtubeSyntheticMedia, setYoutubeSyntheticMedia] = useState<"default" | "yes" | "no">("default");
  const [facebookPublishing, setFacebookPublishing] = useState(false);
  const [instagramPublishing, setInstagramPublishing] = useState(false);
  const [instagramShareToFeed, setInstagramShareToFeed] = useState(true);
  const [tiktokPublishing, setTikTokPublishing] = useState(false);
  const [tiktokLoadingCreator, setTikTokLoadingCreator] = useState(false);
  const [tiktokCheckingStatus, setTikTokCheckingStatus] = useState(false);
  const [tiktokCreator, setTikTokCreator] = useState<TikTokCreatorInfo | null>(null);
  const [tiktokTitle, setTikTokTitle] = useState("");
  const [tiktokPrivacy, setTikTokPrivacy] = useState("");
  const [tiktokAllowComment, setTikTokAllowComment] = useState(false);
  const [tiktokAllowDuet, setTikTokAllowDuet] = useState(false);
  const [tiktokAllowStitch, setTikTokAllowStitch] = useState(false);
  const [tiktokCommercialContent, setTikTokCommercialContent] = useState(false);
  const [tiktokOwnBrand, setTikTokOwnBrand] = useState(false);
  const [tiktokBrandedContent, setTikTokBrandedContent] = useState(false);
  const [tiktokAigc, setTikTokAigc] = useState(false);
  const [tiktokMusicConsent, setTikTokMusicConsent] = useState(false);
  const [tiktokDurationSeconds, setTikTokDurationSeconds] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [collapsed, setCollapsed] = useState<Record<Platform, boolean>>({
    youtube: false,
    facebook: false,
    instagram: false,
    tiktok: false,
  });
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const applyCampaignData = useCallback((data: JsonRecord) => {
    setCampaign((data.campaign as Campaign | null) || null);
    setJobs(Array.isArray(data.jobs) ? (data.jobs as CampaignJob[]) : []);
    setSummary((data.summary as CampaignSummary | undefined) || emptySummary);
    setSelectedIds(new Set());
  }, []);

  const loadCampaign = useCallback(async () => {
    if (!projectId) {
      setCampaign(null);
      setJobs([]);
      setSummary(emptySummary);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/publishing/campaigns?projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store" }
      );
      const data = await readJson(response, "Could not load bulk campaign.");
      applyCampaignData(data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load bulk campaign."
      );
    } finally {
      setLoading(false);
    }
  }, [applyCampaignData, projectId]);

  useEffect(() => {
    void loadCampaign();
  }, [loadCampaign]);

  async function patchCampaign(body: JsonRecord, successMessage?: string) {
    if (!projectId) return null;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/publishing/campaigns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, ...body }),
      });
      const data = await readJson(response, "Could not update the publishing campaign.");
      applyCampaignData(data);
      if (successMessage) setMessage(successMessage);
      return data;
    } catch (patchError) {
      setError(
        patchError instanceof Error
          ? patchError.message
          : "Could not update the publishing campaign."
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function buildCampaignRows(options?: { confirmReplace?: boolean }) {
    if (!projectId) return null;

    if (
      options?.confirmReplace !== false &&
      campaign &&
      !window.confirm(
        "Rebuilding will replace the current draft campaign rows with the latest saved Social Media Pack and Media Hub assets. Continue?"
      )
    ) {
      return null;
    }

    const response = await fetch("/api/publishing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });

    return readJson(response, "Could not build bulk campaign rows.");
  }

  async function generateFromSavedDetails() {
    if (!projectId) return;

    setGenerating(true);
    setGenerationStage("Building campaign from saved social details…");
    setError("");
    setMessage("");

    try {
      const data = await buildCampaignRows();
      if (!data) return;

      applyCampaignData(data);
      setMessage(
        `Campaign built with ${asRecord(data.summary).total || 0} items from the social details already saved for this song. Nothing has been published.`
      );
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not build bulk campaign."
      );
    } finally {
      setGenerating(false);
      setGenerationStage("");
    }
  }

  async function generateFullCampaign() {
    if (!projectId) return;

    if (
      campaign &&
      !window.confirm(
        "Generate Full Campaign will regenerate the social copy for YouTube, YouTube Shorts, Facebook, Instagram and TikTok, then replace the current draft campaign rows. Existing creator-supplied YouTube release facts such as credits, links and AI disclosure settings will be preserved. Continue?"
      )
    ) {
      return;
    }

    setGenerating(true);
    setError("");
    setMessage("");

    try {
      setGenerationStage("Reading existing release facts and creator guidance…");

      const encodedProjectId = encodeURIComponent(projectId);
      const [youtubeFullResponse, youtubeShortsResponse, platformsResponse] =
        await Promise.all([
          fetch(`/api/social-media/youtube-full?projectId=${encodedProjectId}`, {
            cache: "no-store",
          }),
          fetch(`/api/social-media/youtube-shorts?projectId=${encodedProjectId}`, {
            cache: "no-store",
          }),
          fetch(`/api/social-media/platform-pack?projectId=${encodedProjectId}`, {
            cache: "no-store",
          }),
        ]);

      const youtubeFullSaved = await readJson(
        youtubeFullResponse,
        "Could not read the saved YouTube release details."
      );
      const youtubeShortsSaved = await readJson(
        youtubeShortsResponse,
        "Could not read the saved YouTube Shorts settings."
      );
      const platformsSaved = await readJson(
        platformsResponse,
        "Could not read the saved platform settings."
      );

      const existingYoutubeFull = asRecord(youtubeFullSaved.youtubeFull);
      const existingYoutubeShorts = asRecord(youtubeShortsSaved.youtubeShorts);
      const existingFacebook = asRecord(platformsSaved.facebook);
      const existingInstagram = asRecord(platformsSaved.instagram);
      const existingTikTok = asRecord(platformsSaved.tiktok);

      const youtubeGuidance = cleanString(existingYoutubeFull.generatorGuidance);
      const shortsGuidance =
        cleanString(existingYoutubeShorts.generatorGuidance) || youtubeGuidance;
      const platformGuidance =
        cleanString(existingFacebook.generatorGuidance) ||
        cleanString(existingInstagram.generatorGuidance) ||
        cleanString(existingTikTok.generatorGuidance) ||
        shortsGuidance ||
        youtubeGuidance;

      const releaseDetails = asRecord(existingYoutubeFull.releaseDetails);

      setGenerationStage("1 of 4 — generating YouTube Full metadata…");
      await readJson(
        await fetch("/api/social-media/youtube-full", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, generatorGuidance: youtubeGuidance, releaseDetails }),
        }),
        "Could not generate YouTube Full metadata."
      );

      setGenerationStage("2 of 4 — generating 10 YouTube Shorts…");
      await readJson(
        await fetch("/api/social-media/youtube-shorts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, generatorGuidance: shortsGuidance }),
        }),
        "Could not generate the YouTube Shorts pack."
      );

      setGenerationStage(
        "3 of 4 — generating Facebook, Instagram and TikTok campaign details…"
      );
      await readJson(
        await fetch("/api/social-media/platform-pack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, generatorGuidance: platformGuidance }),
        }),
        "Could not generate Facebook, Instagram and TikTok campaign details."
      );

      setGenerationStage("4 of 4 — linking media and building the bulk campaign…");
      const campaignData = await buildCampaignRows({ confirmReplace: false });
      if (!campaignData) throw new Error("Could not build the final campaign rows.");

      applyCampaignData(campaignData);
      const total = Number(asRecord(campaignData.summary).total || 0);
      setMessage(
        `Full social campaign generated and saved: ${total} campaign items are now ready for review. Nothing has been published — every row remains Draft.`
      );
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not generate the full social campaign."
      );
    } finally {
      setGenerating(false);
      setGenerationStage("");
    }
  }

  async function validateCampaign() {
    await patchCampaign(
      { action: "revalidate" },
      "Campaign revalidated against the latest connected accounts, Media Hub assets, copy and schedules."
    );
  }

  const platformCounts = useMemo(
    () =>
      platforms.map((platform) => ({
        platform,
        count: summary.byPlatform?.[platform] || 0,
      })),
    [summary.byPlatform]
  );

  const readyCount = useMemo(
    () => jobs.filter((job) => job.ready_to_publish).length,
    [jobs]
  );
  const scheduledCount = useMemo(
    () => jobs.filter((job) => Boolean(job.scheduled_for)).length,
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      if (platformFilter !== "all" && job.platform !== platformFilter) return false;
      if (filterMode === "errors" && blockingIssues(job).length === 0) return false;
      if (filterMode === "ready" && !job.ready_to_publish) return false;
      if (filterMode === "missing-media" && !hasMissingMedia(job)) return false;
      if (filterMode === "scheduled" && !job.scheduled_for) return false;
      return true;
    });
  }, [filterMode, jobs, platformFilter]);

  const visibleIds = useMemo(() => filteredJobs.map((job) => job.id), [filteredJobs]);
  const selectedJobs = useMemo(
    () => jobs.filter((job) => selectedIds.has(job.id)),
    [jobs, selectedIds]
  );
  const selectedYouTubeJob =
    selectedJobs.length === 1 && selectedJobs[0].platform === "youtube"
      ? selectedJobs[0]
      : null;
  const selectedFacebookJob =
    selectedJobs.length === 1 && selectedJobs[0].platform === "facebook"
      ? selectedJobs[0]
      : null;
  const selectedInstagramJob =
    selectedJobs.length === 1 && selectedJobs[0].platform === "instagram"
      ? selectedJobs[0]
      : null;
  const selectedTikTokJob =
    selectedJobs.length === 1 && selectedJobs[0].platform === "tiktok"
      ? selectedJobs[0]
      : null;

  useEffect(() => {
    setTikTokCreator(null);
    setTikTokPrivacy("");
    setTikTokAllowComment(false);
    setTikTokAllowDuet(false);
    setTikTokAllowStitch(false);
    setTikTokCommercialContent(false);
    setTikTokOwnBrand(false);
    setTikTokBrandedContent(false);
    setTikTokAigc(false);
    setTikTokMusicConsent(false);
    setTikTokDurationSeconds(null);
    setTikTokTitle(selectedTikTokJob ? tikTokCampaignTitle(selectedTikTokJob) : "");
  }, [selectedTikTokJob?.id]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleVisibleSelection() {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleJobSelection(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function setSelectedReady(ready: boolean) {
    const selected = jobs.filter((job) => selectedIds.has(job.id));
    if (selected.length === 0) {
      setError("Select at least one campaign row first.");
      return;
    }

    const eligible = ready
      ? selected.filter((job) => blockingIssues(job).length === 0)
      : selected;
    const skipped = selected.length - eligible.length;

    if (eligible.length === 0) {
      setError("The selected rows have blocking validation errors and cannot be marked Ready yet.");
      return;
    }

    await patchCampaign(
      {
        updates: eligible.map((job) => ({ id: job.id, ready_to_publish: ready })),
      },
      `${eligible.length} row${eligible.length === 1 ? "" : "s"} marked ${ready ? "Ready" : "Draft"}${skipped ? `; ${skipped} blocked row${skipped === 1 ? "" : "s"} skipped` : ""}.`
    );
  }

  async function scheduleSelected() {
    const selected = jobs.filter((job) => selectedIds.has(job.id));
    if (selected.length === 0) {
      setError("Select at least one campaign row first.");
      return;
    }
    if (!bulkSchedule) {
      setError("Choose a schedule date and time first.");
      return;
    }

    const scheduledFor = localInputToIso(bulkSchedule);
    await patchCampaign(
      {
        updates: selected.map((job) => ({
          id: job.id,
          scheduled_for: scheduledFor,
          schedule_timezone: timezoneName(),
        })),
      },
      `Schedule applied to ${selected.length} selected row${selected.length === 1 ? "" : "s"}.`
    );
  }

  async function clearSelectedSchedule() {
    const selected = jobs.filter((job) => selectedIds.has(job.id));
    if (selected.length === 0) {
      setError("Select at least one campaign row first.");
      return;
    }
    await patchCampaign(
      {
        updates: selected.map((job) => ({
          id: job.id,
          scheduled_for: "",
          schedule_timezone: "",
        })),
      },
      `Schedule cleared for ${selected.length} selected row${selected.length === 1 ? "" : "s"}.`
    );
  }

  async function publishSelectedYouTube() {
    if (!projectId || !selectedYouTubeJob) {
      setError("Select exactly one YouTube campaign row first.");
      return;
    }

    const job = selectedYouTubeJob;
    const errors = blockingIssues(job);
    if (errors.length > 0) {
      setError("Fix the selected YouTube row's blocking validation errors first.");
      return;
    }
    if (!job.ready_to_publish) {
      setError("Mark the selected YouTube row Ready before uploading it.");
      return;
    }
    if (!job.media_asset_id) {
      setError("The selected YouTube row does not have a Media Hub video linked.");
      return;
    }
    if (job.external_post_id || job.status === "published" || job.status === "uploading") {
      setError("This YouTube row has already been uploaded or is currently uploading.");
      return;
    }

    const futureSchedule = job.scheduled_for
      ? Date.parse(job.scheduled_for) > Date.now() + 30_000
      : false;
    if (futureSchedule && youtubeVisibility !== "public") {
      setError("For a scheduled YouTube release, choose Public visibility. YouTube will keep it private until the scheduled time.");
      return;
    }

    const mediaFilename = cleanString(job.payload?.mediaFilename) || "linked Media Hub video";
    const scheduleLine = futureSchedule
      ? `\nScheduled: ${new Date(job.scheduled_for as string).toLocaleString()}`
      : "";
    const confirmed = window.confirm(
      `REAL YOUTUBE ACTION\n\nUpload: ${mediaFilename}\nTitle: ${job.title || "Untitled"}\nVisibility: ${youtubeVisibility}${scheduleLine}\n\nThis sends the video to your connected YouTube channel. Continue?`
    );
    if (!confirmed) return;

    setYoutubePublishing(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/publishing/youtube/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          jobId: job.id,
          privacyStatus: youtubeVisibility,
          selfDeclaredMadeForKids:
            youtubeMadeForKids === "yes"
              ? true
              : youtubeMadeForKids === "no"
                ? false
                : null,
          containsSyntheticMedia:
            youtubeSyntheticMedia === "yes"
              ? true
              : youtubeSyntheticMedia === "no"
                ? false
                : null,
        }),
      });

      const data = await readJson(response, "YouTube upload failed.");
      await loadCampaign();

      const warning = cleanString(data.warning);
      const actualPrivacy = cleanString(data.actualPrivacyStatus) || youtubeVisibility;
      const videoUrl = cleanString(data.videoUrl);
      const scheduled = data.scheduled === true;
      setMessage(
        `${scheduled ? "YouTube upload scheduled" : "YouTube upload completed"} · ${actualPrivacy}${videoUrl ? ` · ${videoUrl}` : ""}${warning ? ` · ${warning}` : ""}`
      );
    } catch (publishError) {
      await loadCampaign();
      setError(
        publishError instanceof Error ? publishError.message : "YouTube upload failed."
      );
    } finally {
      setYoutubePublishing(false);
    }
  }

  async function publishSelectedFacebook() {
    if (!projectId || !selectedFacebookJob) {
      setError("Select exactly one Facebook campaign row first.");
      return;
    }

    const job = selectedFacebookJob;
    if (blockingIssues(job).length > 0) {
      setError("Fix the selected Facebook row's blocking validation errors first.");
      return;
    }
    if (!job.ready_to_publish) {
      setError("Mark the selected Facebook row Ready before publishing it.");
      return;
    }
    if (!job.connection_id) {
      setError("Facebook is not connected yet. Connect Meta in Publishing Hub, then Validate Campaign.");
      return;
    }
    if (job.content_type === "reel" && !job.media_asset_id) {
      setError("The selected Facebook Reel does not have a Media Hub vertical video linked.");
      return;
    }
    if (job.scheduled_for) {
      setError("Phase 6B Meta publishing is immediate-only. Clear this Facebook row's schedule before publishing.");
      return;
    }
    if (job.external_post_id || ["published", "uploading"].includes(job.status)) {
      setError("This Facebook row has already been published or is currently uploading.");
      return;
    }

    const mediaLine = job.content_type === "reel"
      ? `\nMedia: ${cleanString(job.payload?.mediaFilename) || "linked vertical video"}`
      : "";
    const confirmed = window.confirm(
      `REAL FACEBOOK ACTION\n\nItem: ${job.item_key}${mediaLine}\n\nThis publishes immediately to the connected Facebook Page. Continue?`
    );
    if (!confirmed) return;

    setFacebookPublishing(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/publishing/facebook/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, jobId: job.id }),
      });
      const data = await readJson(response, "Facebook publishing failed.");
      await loadCampaign();
      const postUrl = cleanString(data.postUrl);
      setMessage(`Facebook published successfully${postUrl ? ` · ${postUrl}` : ""}`);
    } catch (publishError) {
      await loadCampaign();
      setError(
        publishError instanceof Error ? publishError.message : "Facebook publishing failed."
      );
    } finally {
      setFacebookPublishing(false);
    }
  }

  async function publishSelectedInstagram() {
    if (!projectId || !selectedInstagramJob) {
      setError("Select exactly one Instagram campaign row first.");
      return;
    }

    const job = selectedInstagramJob;
    if (job.content_type !== "reel") {
      setError("Phase 6B enables direct local-file Instagram Reels first. Feed-image publishing remains disabled for now.");
      return;
    }
    if (blockingIssues(job).length > 0) {
      setError("Fix the selected Instagram Reel's blocking validation errors first.");
      return;
    }
    if (!job.ready_to_publish) {
      setError("Mark the selected Instagram Reel Ready before publishing it.");
      return;
    }
    if (!job.connection_id) {
      setError("Instagram is not connected yet. Connect Meta in Publishing Hub, then Validate Campaign.");
      return;
    }
    if (!job.media_asset_id) {
      setError("The selected Instagram Reel does not have a Media Hub vertical video linked.");
      return;
    }
    if (job.scheduled_for) {
      setError("Phase 6B Meta publishing is immediate-only. Clear this Instagram row's schedule before publishing.");
      return;
    }
    if (job.external_post_id || ["published", "uploading"].includes(job.status)) {
      setError("This Instagram Reel has already been published or is currently uploading.");
      return;
    }

    const confirmed = window.confirm(
      `REAL INSTAGRAM ACTION\n\nReel: ${job.item_key}\nMedia: ${cleanString(job.payload?.mediaFilename) || "linked vertical video"}\nShare to Feed: ${instagramShareToFeed ? "Yes" : "No"}\n\nThis publishes immediately to the connected Instagram professional account. Continue?`
    );
    if (!confirmed) return;

    setInstagramPublishing(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/publishing/instagram/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          jobId: job.id,
          shareToFeed: instagramShareToFeed,
        }),
      });
      const data = await readJson(response, "Instagram publishing failed.");
      await loadCampaign();
      const postUrl = cleanString(data.postUrl);
      setMessage(`Instagram Reel published successfully${postUrl ? ` · ${postUrl}` : ""}`);
    } catch (publishError) {
      await loadCampaign();
      setError(
        publishError instanceof Error ? publishError.message : "Instagram publishing failed."
      );
    } finally {
      setInstagramPublishing(false);
    }
  }

  async function loadTikTokCreatorInfo() {
    if (!projectId || !selectedTikTokJob) {
      setError("Select exactly one TikTok campaign row first.");
      return;
    }
    if (!selectedTikTokJob.media_asset_id) {
      setError("The selected TikTok row does not have a Media Hub vertical video linked.");
      return;
    }

    setTikTokLoadingCreator(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/publishing/tiktok/creator-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, jobId: selectedTikTokJob.id }),
      });
      const data = await readJson(response, "Could not load TikTok creator settings.");
      const creator = asRecord(data.creator);
      const media = asRecord(data.media);
      const nextCreator: TikTokCreatorInfo = {
        creatorNickname: cleanString(creator.creatorNickname),
        creatorUsername: cleanString(creator.creatorUsername),
        creatorAvatarUrl: cleanString(creator.creatorAvatarUrl),
        privacyLevelOptions: Array.isArray(creator.privacyLevelOptions)
          ? creator.privacyLevelOptions.map((value) => cleanString(value)).filter(Boolean)
          : [],
        commentDisabled: creator.commentDisabled === true,
        duetDisabled: creator.duetDisabled === true,
        stitchDisabled: creator.stitchDisabled === true,
        maxVideoPostDurationSec: Number(creator.maxVideoPostDurationSec || 0),
        mediaUrl: cleanString(media.url),
        mediaFilename: cleanString(media.originalFilename),
        mediaMimeType: cleanString(media.mimeType),
      };
      const duration = await probeVideoDuration(nextCreator.mediaUrl);
      setTikTokCreator(nextCreator);
      setTikTokDurationSeconds(duration);
      setTikTokPrivacy("");
      setTikTokAllowComment(false);
      setTikTokAllowDuet(false);
      setTikTokAllowStitch(false);
      setTikTokCommercialContent(false);
      setTikTokOwnBrand(false);
      setTikTokBrandedContent(false);
      setTikTokAigc(false);
      setTikTokMusicConsent(false);
      setTikTokTitle(tikTokCampaignTitle(selectedTikTokJob));
      setMessage(
        `TikTok creator settings loaded for ${nextCreator.creatorNickname || nextCreator.creatorUsername || "the connected creator"}. Choose privacy and posting options manually before publishing.`
      );
    } catch (loadError) {
      setTikTokCreator(null);
      setTikTokDurationSeconds(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load TikTok creator settings.");
    } finally {
      setTikTokLoadingCreator(false);
    }
  }

  async function publishSelectedTikTok() {
    if (!projectId || !selectedTikTokJob) {
      setError("Select exactly one TikTok campaign row first.");
      return;
    }
    const job = selectedTikTokJob;
    if (blockingIssues(job).length > 0) {
      setError("Fix the selected TikTok row's blocking validation errors first.");
      return;
    }
    if (!job.ready_to_publish) {
      setError("Mark the selected TikTok row Ready before publishing it.");
      return;
    }
    if (!job.media_asset_id) {
      setError("The selected TikTok row does not have a Media Hub vertical video linked.");
      return;
    }
    if (job.scheduled_for) {
      setError("TikTok Step 7B is immediate-only. Clear this row's Studio schedule before publishing.");
      return;
    }
    if (job.external_post_id || ["published", "uploading"].includes(job.status)) {
      setError("This TikTok row already has a TikTok publish ID or is currently processing. Use Check TikTok Status instead of creating a duplicate.");
      return;
    }
    if (!tiktokCreator) {
      setError("Load current TikTok creator settings before publishing.");
      return;
    }
    if (!tiktokPrivacy) {
      setError("Choose TikTok privacy manually before publishing.");
      return;
    }
    if (!tiktokCreator.privacyLevelOptions.includes(tiktokPrivacy)) {
      setError("Choose one of the current privacy options returned by TikTok.");
      return;
    }
    if (!tiktokMusicConsent) {
      setError("Confirm TikTok's Music Usage Confirmation before publishing.");
      return;
    }
    if (!(typeof tiktokDurationSeconds === "number" && Number.isFinite(tiktokDurationSeconds)) || tiktokDurationSeconds <= 0) {
      setError("Studio could not verify the linked video's duration. Reload TikTok creator settings.");
      return;
    }
    if (
      tiktokCreator.maxVideoPostDurationSec > 0 &&
      Number(tiktokDurationSeconds) > tiktokCreator.maxVideoPostDurationSec + 0.05
    ) {
      setError(`This video is ${Number(tiktokDurationSeconds).toFixed(1)}s, but this TikTok creator currently allows up to ${tiktokCreator.maxVideoPostDurationSec}s.`);
      return;
    }
    if (tiktokCommercialContent && !tiktokOwnBrand && !tiktokBrandedContent) {
      setError("When Commercial Content is enabled, choose Your brand, Branded content, or both.");
      return;
    }
    if (tiktokBrandedContent && tiktokPrivacy === "SELF_ONLY") {
      setError("TikTok does not allow third-party Branded content with Only me visibility.");
      return;
    }
    if (tiktokTitle.length > 2200) {
      setError("TikTok caption/title exceeds the 2200 UTF-16 character limit.");
      return;
    }

    const confirmed = window.confirm(
      `REAL TIKTOK ACTION\n\nCreator: ${tiktokCreator.creatorNickname || tiktokCreator.creatorUsername || "TikTok creator"}\nVideo: ${tiktokCreator.mediaFilename || cleanString(job.payload?.mediaFilename) || "linked vertical video"}\nPrivacy: ${tikTokPrivacyLabel(tiktokPrivacy)}\nDuration: ${Number(tiktokDurationSeconds).toFixed(1)}s\n\nThis sends the local Media Hub video to TikTok now. Continue?`
    );
    if (!confirmed) return;

    setTikTokPublishing(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/publishing/tiktok/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          jobId: job.id,
          title: tiktokTitle,
          privacyLevel: tiktokPrivacy,
          allowComment: tiktokAllowComment,
          allowDuet: tiktokAllowDuet,
          allowStitch: tiktokAllowStitch,
          commercialContent: tiktokCommercialContent,
          brandOrganic: tiktokCommercialContent && tiktokOwnBrand,
          brandContent: tiktokCommercialContent && tiktokBrandedContent,
          isAigc: tiktokAigc,
          musicUsageConfirmed: tiktokMusicConsent,
          durationSeconds: tiktokDurationSeconds,
        }),
      });
      const data = await readJson(response, "TikTok publishing failed.");
      await loadCampaign();
      const status = cleanString(data.status) || "PROCESSING_UPLOAD";
      const postUrl = cleanString(data.postUrl);
      if (status === "PUBLISH_COMPLETE") {
        setMessage(`TikTok post completed${postUrl ? ` · ${postUrl}` : ""}`);
      } else {
        setMessage(`TikTok accepted the upload · ${status}. Waiting for TikTok to finish processing…`);
        await pollTikTokUntilSettled(job.id);
      }
    } catch (publishError) {
      await loadCampaign();
      setError(publishError instanceof Error ? publishError.message : "TikTok publishing failed.");
    } finally {
      setTikTokPublishing(false);
    }
  }

  async function pollTikTokUntilSettled(jobId: string) {
    if (!projectId) return;

    setTikTokCheckingStatus(true);

    try {
      const maxAttempts = 18;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const response = await fetch("/api/publishing/tiktok/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, jobId }),
        });

        const data = await readJson(
          response,
          "Could not refresh TikTok publish status."
        );

        const status = cleanString(data.status) || "UNKNOWN";
        const postUrl = cleanString(data.postUrl);
        const failReason = cleanString(data.failReason);

        await loadCampaign();

        if (status === "PUBLISH_COMPLETE") {
          setError("");
          setMessage(
            `TikTok published successfully${postUrl ? ` · ${postUrl}` : ""}`
          );
          return;
        }

        if (status === "FAILED") {
          setMessage("");
          setError(
            failReason
              ? `TikTok processing failed: ${failReason}`
              : "TikTok processing failed."
          );
          return;
        }

        setMessage(
          `TikTok processing · ${status} · check ${attempt}/${maxAttempts}`
        );

        if (attempt < maxAttempts) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 5000);
          });
        }
      }

      setMessage(
        "TikTok is still processing the upload. You can use Check TikTok Status to refresh it later."
      );
    } catch (statusError) {
      await loadCampaign();
      setError(
        statusError instanceof Error
          ? statusError.message
          : "Could not refresh TikTok publish status."
      );
    } finally {
      setTikTokCheckingStatus(false);
    }
  }

  async function checkSelectedTikTokStatus() {
    if (!projectId || !selectedTikTokJob) {
      setError("Select exactly one TikTok campaign row first.");
      return;
    }
    if (!selectedTikTokJob.external_post_id) {
      setError("This TikTok row does not have a publish ID yet.");
      return;
    }
    setTikTokCheckingStatus(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/publishing/tiktok/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, jobId: selectedTikTokJob.id }),
      });
      const data = await readJson(response, "Could not refresh TikTok publish status.");
      await loadCampaign();
      const status = cleanString(data.status) || "UNKNOWN";
      const postUrl = cleanString(data.postUrl);
      setMessage(`TikTok status: ${status}${postUrl ? ` · ${postUrl}` : ""}`);
    } catch (statusError) {
      await loadCampaign();
      setError(statusError instanceof Error ? statusError.message : "Could not refresh TikTok publish status.");
    } finally {
      setTikTokCheckingStatus(false);
    }
  }

  function openEditor(job: CampaignJob) {
    setEditingId(job.id);
    setEditDraft({
      title: job.title || "",
      caption: job.caption || "",
      description: job.description || "",
      hashtags: (job.hashtags || []).join(", "),
      tags: (job.tags || []).join(", "),
      ready_to_publish: job.ready_to_publish,
      scheduled_for: isoToLocalInput(job.scheduled_for),
      schedule_timezone: job.schedule_timezone || timezoneName(),
    });
  }

  async function saveEditor() {
    if (!editingId || !editDraft) return;
    const data = await patchCampaign(
      {
        updates: [
          {
            id: editingId,
            title: editDraft.title,
            caption: editDraft.caption,
            description: editDraft.description,
            hashtags: parseListInput(editDraft.hashtags),
            tags: parseListInput(editDraft.tags),
            ready_to_publish: editDraft.ready_to_publish,
            scheduled_for: localInputToIso(editDraft.scheduled_for),
            schedule_timezone: editDraft.scheduled_for
              ? editDraft.schedule_timezone || timezoneName()
              : "",
          },
        ],
      },
      "Campaign row saved and revalidated."
    );
    if (data) {
      setEditingId(null);
      setEditDraft(null);
    }
  }

  function exportSpreadsheet() {
    if (!campaign) return;

    const headers = [
      "manifest_version",
      "campaign_id",
      "song_id",
      "job_id",
      "item_key",
      "platform",
      "content_type",
      "media_asset_id",
      "media_filename",
      "title",
      "caption",
      "description",
      "hashtags_json",
      "tags_json",
      "ready_to_publish",
      "scheduled_for_iso",
      "schedule_timezone",
      "status_read_only",
      "validation_read_only",
    ];

    const lines = [headers.map(escapeCsv).join(",")];
    for (const job of jobs) {
      const mediaFilename = cleanString(job.payload?.mediaFilename);
      const validation = (job.validation_errors || []).map(issueMessage).join(" | ");
      const row = [
        "SZ-PUBLISH-1",
        campaign.id,
        job.song_id || campaign.song_id || projectId || "",
        job.id,
        job.item_key,
        job.platform,
        job.content_type,
        job.media_asset_id || "",
        mediaFilename,
        job.title || "",
        job.caption || "",
        job.description || "",
        JSON.stringify(job.hashtags || []),
        JSON.stringify(job.tags || []),
        job.ready_to_publish ? "YES" : "NO",
        job.scheduled_for || "",
        job.schedule_timezone || "",
        job.status,
        validation,
      ];
      lines.push(row.map(escapeCsv).join(","));
    }

    const blob = new Blob(["\uFEFF", lines.join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sanitizeFilename(songTitle || campaign.name)}-publishing-manifest.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setMessage(
      "Spreadsheet exported. Edit only the copy, hashtags/tags, Ready and schedule columns; IDs and media references are used to match rows safely on re-import."
    );
  }

  async function importSpreadsheet(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !campaign) return;

    setError("");
    setMessage("");

    try {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("The spreadsheet contains no campaign rows.");

      const headers = rows[0].map((header) => header.trim());
      const requiredHeaders = [
        "campaign_id",
        "job_id",
        "item_key",
        "title",
        "caption",
        "description",
        "hashtags_json",
        "tags_json",
        "ready_to_publish",
        "scheduled_for_iso",
        "schedule_timezone",
      ];
      const missing = requiredHeaders.filter((header) => !headers.includes(header));
      if (missing.length) {
        throw new Error(`Spreadsheet is missing required columns: ${missing.join(", ")}`);
      }

      const jobById = new Map(jobs.map((job) => [job.id, job]));
      const updates: JsonRecord[] = [];
      let ignored = 0;
      let wrongCampaign = 0;

      for (const cells of rows.slice(1)) {
        if (!cells.some((cell) => cell.trim())) continue;
        const row = Object.fromEntries(
          headers.map((header, index) => [header, cells[index] ?? ""])
        );

        if (row.campaign_id.trim() !== campaign.id) {
          wrongCampaign += 1;
          continue;
        }

        const job = jobById.get(row.job_id.trim());
        if (!job || row.item_key.trim() !== job.item_key) {
          ignored += 1;
          continue;
        }

        const next = {
          id: job.id,
          title: row.title,
          caption: row.caption,
          description: row.description,
          hashtags: parseSpreadsheetArray(row.hashtags_json),
          tags: parseSpreadsheetArray(row.tags_json),
          ready_to_publish: toBoolean(row.ready_to_publish),
          scheduled_for: row.scheduled_for_iso.trim(),
          schedule_timezone: row.schedule_timezone.trim(),
        };

        const changed =
          (job.title || "") !== next.title.trim() ||
          (job.caption || "") !== next.caption.trim() ||
          (job.description || "") !== next.description.trim() ||
          JSON.stringify(job.hashtags || []) !== JSON.stringify(next.hashtags) ||
          JSON.stringify(job.tags || []) !== JSON.stringify(next.tags) ||
          job.ready_to_publish !== next.ready_to_publish ||
          (job.scheduled_for || "") !== next.scheduled_for ||
          (job.schedule_timezone || "") !== next.schedule_timezone;

        if (changed) updates.push(next);
      }

      if (wrongCampaign) {
        throw new Error(
          `${wrongCampaign} spreadsheet row${wrongCampaign === 1 ? " belongs" : "s belong"} to a different campaign. Export a fresh manifest from this campaign before importing.`
        );
      }
      if (updates.length === 0) {
        setMessage(
          ignored
            ? `No valid changes found. ${ignored} unmatched row${ignored === 1 ? " was" : "s were"} ignored.`
            : "No changes were detected in the spreadsheet."
        );
        return;
      }

      const confirmed = window.confirm(
        `Import ${updates.length} changed campaign row${updates.length === 1 ? "" : "s"}? This updates the draft only and will NOT publish anything.${ignored ? ` ${ignored} unmatched row${ignored === 1 ? " will" : "s will"} be ignored.` : ""}`
      );
      if (!confirmed) return;

      await patchCampaign(
        { updates },
        `Spreadsheet imported: ${updates.length} changed row${updates.length === 1 ? "" : "s"} saved and revalidated. Nothing was published.`
      );
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import the spreadsheet."
      );
    }
  }

  if (!projectId) {
    return (
      <section className="mt-7 rounded-[24px] border border-slate-800 bg-[#0a1421] p-6">
        <p className="text-sm font-semibold text-white">Bulk release campaign</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Open a song first. Studio will then generate the full social campaign and turn it into one bulk publishing workspace.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-7 rounded-[26px] border border-indigo-400/15 bg-gradient-to-br from-indigo-400/[0.045] to-[#0a1421] p-5 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-300/75">
            Bulk Publishing
          </p>
          <h3 className="mt-2 text-xl font-semibold text-white">Release campaign</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Generate, edit, schedule and approve the complete social campaign for {songTitle ? `“${songTitle}”` : "this song"} from one workspace. Direct single-row YouTube publishing is proven; Facebook and Instagram single-row publishers are now prepared but remain connection-gated until Meta developer access works.
          </p>
        </div>

        <div className="flex max-w-2xl shrink-0 flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => void loadCampaign()}
            disabled={loading || generating || saving}
            className="rounded-xl border border-slate-700 bg-[#0a1421] px-4 py-2.5 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void validateCampaign()}
            disabled={!campaign || loading || generating || saving}
            className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-2.5 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-400/10 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Validate Campaign"}
          </button>
          <button
            type="button"
            onClick={() => void generateFromSavedDetails()}
            disabled={generating || loading || saving}
            title="Build campaign rows from the social details that are already saved, without calling AI again."
            className="rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
          >
            Build from Saved
          </button>
          <button
            type="button"
            onClick={() => void generateFullCampaign()}
            disabled={generating || loading || saving}
            className="rounded-xl border border-indigo-400/30 bg-indigo-400/15 px-4 py-2.5 text-xs font-bold text-indigo-100 transition hover:bg-indigo-400/20 disabled:opacity-50"
          >
            {generating ? "Generating Full Campaign…" : "Generate Full Campaign"}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-sky-400/15 bg-sky-400/[0.04] px-4 py-3 text-xs leading-5 text-sky-100/75">
        <span className="font-semibold text-sky-200">Campaign control:</span> edit individual rows here, or export the Excel-compatible CSV spreadsheet for bulk changes and re-import it. The database remains the source of truth.
      </div>
      <div className="mt-3 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] px-4 py-3 text-xs leading-5 text-emerald-100/75">
        <span className="font-semibold text-emerald-200">Safety:</span> Ready means approved for the future publisher; it does not publish. Rows with blocking validation errors cannot remain Ready.
      </div>

      {generationStage && (
        <div className="mt-4 rounded-2xl border border-indigo-400/20 bg-indigo-400/[0.055] px-4 py-3 text-sm text-indigo-100">
          {generationStage}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/[0.055] px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {message && (
        <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.055] px-4 py-3 text-sm text-emerald-100">
          {message}
        </div>
      )}

      {!campaign && !loading ? (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-700 bg-[#0a1421]/70 p-6 text-center">
          <p className="text-sm font-semibold text-white">No bulk campaign yet</p>
          <p className="mx-auto mt-2 max-w-2xl text-xs leading-6 text-slate-500">
            Use Generate Full Campaign to create every platform pack and the publishing table in one go. If you have already prepared the Social Media Pack manually, Build from Saved skips the AI generation and only rebuilds the table.
          </p>
        </div>
      ) : campaign ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="rounded-2xl border border-slate-800 bg-[#0a1421] p-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">Campaign items</p>
              <p className="mt-2 text-2xl font-semibold text-white">{summary.total}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[#0a1421] p-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">Media linked</p>
              <p className="mt-2 text-2xl font-semibold text-white">{summary.withMedia}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[#0a1421] p-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">Blocking errors</p>
              <p className={`mt-2 text-2xl font-semibold ${summary.errorCount ? "text-red-300" : "text-emerald-300"}`}>
                {summary.errorCount}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[#0a1421] p-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">Ready</p>
              <p className="mt-2 text-2xl font-semibold text-emerald-300">{readyCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[#0a1421] p-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">Scheduled</p>
              <p className="mt-2 text-2xl font-semibold text-sky-300">{scheduledCount}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-[#0a1421] p-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-600">Campaign status</p>
              <p className="mt-2 text-lg font-semibold capitalize text-amber-200">{campaign.status}</p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-[#08121d] p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPlatformFilter("all")}
                    className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] ${platformFilter === "all" ? "border-white/20 bg-white/10 text-white" : "border-slate-800 text-slate-500"}`}
                  >
                    All · {summary.total}
                  </button>
                  {platformCounts.map(({ platform, count }) => (
                    <button
                      key={platform}
                      type="button"
                      onClick={() => setPlatformFilter(platform)}
                      className={`rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] ${platformStyles[platform]} ${platformFilter === platform ? "ring-1 ring-white/20" : "opacity-70"}`}
                    >
                      {platform} · {count}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["all", "All states"],
                    ["errors", "Errors"],
                    ["missing-media", "Missing media"],
                    ["ready", "Ready"],
                    ["scheduled", "Scheduled"],
                  ] as Array<[FilterMode, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilterMode(value)}
                      className={`rounded-lg border px-3 py-1.5 text-[10px] font-semibold ${filterMode === value ? "border-indigo-400/30 bg-indigo-400/10 text-indigo-200" : "border-slate-800 text-slate-500"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => void importSpreadsheet(event)}
                />
                <button
                  type="button"
                  onClick={exportSpreadsheet}
                  className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] px-3.5 py-2 text-[11px] font-semibold text-sky-200"
                >
                  Export Spreadsheet
                </button>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  disabled={saving}
                  className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] px-3.5 py-2 text-[11px] font-semibold text-sky-200 disabled:opacity-50"
                >
                  Import Spreadsheet
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-slate-800 pt-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={toggleVisibleSelection}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] font-semibold text-slate-300"
                >
                  {allVisibleSelected ? "Clear visible selection" : "Select visible"}
                </button>
                <span className="text-[11px] text-slate-500">{selectedIds.size} selected</span>
                <button
                  type="button"
                  onClick={() => void setSelectedReady(true)}
                  disabled={saving || selectedIds.size === 0}
                  className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-[10px] font-semibold text-emerald-200 disabled:opacity-40"
                >
                  Mark Ready
                </button>
                <button
                  type="button"
                  onClick={() => void setSelectedReady(false)}
                  disabled={saving || selectedIds.size === 0}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] font-semibold text-slate-300 disabled:opacity-40"
                >
                  Mark Draft
                </button>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                  Schedule selected
                  <input
                    type="datetime-local"
                    value={bulkSchedule}
                    onChange={(event) => setBulkSchedule(event.target.value)}
                    className="mt-1 block rounded-lg border border-slate-700 bg-[#0a1421] px-3 py-2 text-xs normal-case tracking-normal text-slate-200 outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void scheduleSelected()}
                  disabled={saving || selectedIds.size === 0 || !bulkSchedule}
                  className="rounded-lg border border-sky-400/20 bg-sky-400/[0.06] px-3 py-2 text-[10px] font-semibold text-sky-200 disabled:opacity-40"
                >
                  Apply Schedule
                </button>
                <button
                  type="button"
                  onClick={() => void clearSelectedSchedule()}
                  disabled={saving || selectedIds.size === 0}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] font-semibold text-slate-400 disabled:opacity-40"
                >
                  Clear Schedule
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.035] p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-2xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-300/80">Phase 5 · Direct YouTube</p>
                <h4 className="mt-1 text-sm font-semibold text-white">Upload one selected YouTube row</h4>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Safety test only: select exactly one validated YouTube row, mark it Ready, choose the required YouTube visibility, then upload. Bulk publishing is still disabled.
                </p>
                {selectedYouTubeJob ? (
                  <div className="mt-3 rounded-xl border border-slate-800 bg-[#08121d] px-3 py-2.5 text-xs text-slate-400">
                    <span className="font-semibold text-slate-200">Selected:</span> {selectedYouTubeJob.item_key}
                    <span className="mx-2 text-slate-700">·</span>
                    {cleanString(selectedYouTubeJob.payload?.mediaFilename) || "No media filename"}
                    <span className="mx-2 text-slate-700">·</span>
                    {selectedYouTubeJob.ready_to_publish ? "Ready" : "Draft"}
                    {selectedYouTubeJob.scheduled_for ? (
                      <><span className="mx-2 text-slate-700">·</span>{new Date(selectedYouTubeJob.scheduled_for).toLocaleString()}</>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-amber-300/80">Select exactly one YouTube row to enable the upload review.</p>
                )}
              </div>

              <div className="grid min-w-0 gap-2 sm:grid-cols-3 xl:min-w-[590px]">
                <label className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">
                  Visibility · required
                  <select
                    value={youtubeVisibility}
                    onChange={(event) => setYoutubeVisibility(event.target.value as "private" | "unlisted" | "public")}
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#08121d] px-3 py-2 text-xs normal-case tracking-normal text-slate-200 outline-none"
                  >
                    <option value="private">Private</option>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <label className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">
                  Made for kids
                  <select
                    value={youtubeMadeForKids}
                    onChange={(event) => setYoutubeMadeForKids(event.target.value as "default" | "yes" | "no")}
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#08121d] px-3 py-2 text-xs normal-case tracking-normal text-slate-200 outline-none"
                  >
                    <option value="default">Use channel/default setting</option>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
                <label className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-600">
                  Altered / synthetic
                  <select
                    value={youtubeSyntheticMedia}
                    onChange={(event) => setYoutubeSyntheticMedia(event.target.value as "default" | "yes" | "no")}
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-[#08121d] px-3 py-2 text-xs normal-case tracking-normal text-slate-200 outline-none"
                  >
                    <option value="default">Not set</option>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </label>
                <div className="sm:col-span-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="max-w-md text-[10px] leading-4 text-slate-600">
                    A future campaign schedule requires Public target visibility; YouTube keeps the upload private until publishAt. Unaudited API projects may still be forced private by Google.
                  </p>
                  <button
                    type="button"
                    onClick={() => void publishSelectedYouTube()}
                    disabled={
                      youtubePublishing ||
                      saving ||
                      !selectedYouTubeJob ||
                      !selectedYouTubeJob.ready_to_publish ||
                      blockingIssues(selectedYouTubeJob).length > 0 ||
                      !selectedYouTubeJob.media_asset_id ||
                      Boolean(selectedYouTubeJob.external_post_id) ||
                      selectedYouTubeJob.status === "uploading" ||
                      selectedYouTubeJob.status === "published"
                    }
                    className="shrink-0 rounded-xl border border-red-400/30 bg-red-400/12 px-4 py-2.5 text-xs font-bold text-red-100 transition hover:bg-red-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {youtubePublishing
                      ? "Uploading to YouTube…"
                      : selectedYouTubeJob?.scheduled_for && youtubeVisibility === "public"
                        ? "Upload & Schedule on YouTube"
                        : "Upload Selected to YouTube"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-blue-400/20 bg-blue-400/[0.025] p-4 sm:p-5">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-2xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-300/80">Phase 6B · Direct Meta</p>
                <h4 className="mt-1 text-sm font-semibold text-white">Facebook + Instagram single-row publishing</h4>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  The publisher is prepared around the same local Media Hub files already proven with YouTube. Facebook Page posts and Reels can publish directly; Instagram local Reel files use Meta's resumable upload flow. Meta OAuth must be connected before either button can run.
                </p>
                <p className="mt-2 text-[10px] leading-4 text-amber-300/75">
                  Safety: Phase 6B publishes immediately only. Any selected Meta row with a saved schedule is blocked until the schedule is cleared. Instagram feed-image publishing remains disabled for now.
                </p>
              </div>

              <div className="grid min-w-0 gap-3 xl:min-w-[650px] xl:grid-cols-2">
                <div className="rounded-xl border border-blue-400/15 bg-[#08121d] p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-blue-300/70">Facebook</p>
                  {selectedFacebookJob ? (
                    <div className="mt-2 text-[10px] leading-4 text-slate-500">
                      <p><span className="font-semibold text-slate-300">Selected:</span> {selectedFacebookJob.item_key}</p>
                      <p>{selectedFacebookJob.content_type === "reel" ? cleanString(selectedFacebookJob.payload?.mediaFilename) || "No media filename" : "Page text post"}</p>
                      <p>{selectedFacebookJob.connection_id ? "Meta account linked" : "Meta connection pending"} · {selectedFacebookJob.ready_to_publish ? "Ready" : "Draft"}</p>
                      {selectedFacebookJob.scheduled_for ? <p className="text-amber-300/80">Schedule must be cleared before Phase 6B publish.</p> : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] leading-4 text-slate-600">Select exactly one Facebook row.</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void publishSelectedFacebook()}
                    disabled={
                      facebookPublishing ||
                      saving ||
                      !selectedFacebookJob ||
                      !selectedFacebookJob.connection_id ||
                      !selectedFacebookJob.ready_to_publish ||
                      blockingIssues(selectedFacebookJob).length > 0 ||
                      Boolean(selectedFacebookJob.scheduled_for) ||
                      (selectedFacebookJob.content_type === "reel" && !selectedFacebookJob.media_asset_id) ||
                      Boolean(selectedFacebookJob.external_post_id) ||
                      ["uploading", "published"].includes(selectedFacebookJob.status)
                    }
                    className="mt-3 w-full rounded-xl border border-blue-400/30 bg-blue-400/10 px-4 py-2.5 text-xs font-bold text-blue-100 transition hover:bg-blue-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {facebookPublishing ? "Publishing to Facebook…" : "Publish Selected to Facebook"}
                  </button>
                </div>

                <div className="rounded-xl border border-pink-400/15 bg-[#08121d] p-3">
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-pink-300/70">Instagram Reel</p>
                  {selectedInstagramJob ? (
                    <div className="mt-2 text-[10px] leading-4 text-slate-500">
                      <p><span className="font-semibold text-slate-300">Selected:</span> {selectedInstagramJob.item_key}</p>
                      <p>{selectedInstagramJob.content_type === "reel" ? cleanString(selectedInstagramJob.payload?.mediaFilename) || "No media filename" : "Feed image · not enabled in Phase 6B"}</p>
                      <p>{selectedInstagramJob.connection_id ? "Meta account linked" : "Meta connection pending"} · {selectedInstagramJob.ready_to_publish ? "Ready" : "Draft"}</p>
                      {selectedInstagramJob.scheduled_for ? <p className="text-amber-300/80">Schedule must be cleared before Phase 6B publish.</p> : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] leading-4 text-slate-600">Select exactly one Instagram Reel row.</p>
                  )}
                  <label className="mt-3 flex items-center gap-2 text-[10px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={instagramShareToFeed}
                      onChange={(event) => setInstagramShareToFeed(event.target.checked)}
                    />
                    Share Reel to Instagram Feed too
                  </label>
                  <button
                    type="button"
                    onClick={() => void publishSelectedInstagram()}
                    disabled={
                      instagramPublishing ||
                      saving ||
                      !selectedInstagramJob ||
                      selectedInstagramJob.content_type !== "reel" ||
                      !selectedInstagramJob.connection_id ||
                      !selectedInstagramJob.ready_to_publish ||
                      blockingIssues(selectedInstagramJob).length > 0 ||
                      Boolean(selectedInstagramJob.scheduled_for) ||
                      !selectedInstagramJob.media_asset_id ||
                      Boolean(selectedInstagramJob.external_post_id) ||
                      ["uploading", "published"].includes(selectedInstagramJob.status)
                    }
                    className="mt-3 w-full rounded-xl border border-pink-400/30 bg-pink-400/10 px-4 py-2.5 text-xs font-bold text-pink-100 transition hover:bg-pink-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {instagramPublishing ? "Publishing Instagram Reel…" : "Publish Selected Instagram Reel"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.025] p-4 sm:p-5">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-2xl">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300/80">Phase 7B · TikTok Direct Post</p>
                <h4 className="mt-1 text-sm font-semibold text-white">Local vertical video → TikTok</h4>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Select exactly one TikTok row, load TikTok's latest creator settings, review the caption, then choose privacy and interaction settings yourself. The linked Media Hub file is sent directly from Studio; Supabase Storage is not required for local assets.
                </p>
                <p className="mt-2 text-[10px] leading-4 text-amber-300/75">
                  TikTok unaudited-client testing is restricted to private posting. For the first live API test, choose Only me. Studio does not preselect privacy, comments, Duet or Stitch.
                </p>
              </div>

              <div className="min-w-0 xl:w-[660px]">
                <div className="rounded-xl border border-cyan-400/15 bg-[#08121d] p-3 sm:p-4">
                  {selectedTikTokJob ? (
                    <div className="text-[10px] leading-4 text-slate-500">
                      <p><span className="font-semibold text-slate-300">Selected:</span> {selectedTikTokJob.item_key}</p>
                      <p>{cleanString(selectedTikTokJob.payload?.mediaFilename) || "No media filename"}</p>
                      <p>{selectedTikTokJob.connection_id ? "TikTok account linked" : "TikTok connection pending / revalidate after connect"} · {selectedTikTokJob.ready_to_publish ? "Ready" : "Draft"}</p>
                      {selectedTikTokJob.scheduled_for ? <p className="text-amber-300/80">Clear the Studio schedule before direct posting.</p> : null}
                      {selectedTikTokJob.external_post_id ? <p className="text-cyan-200/80">Publish ID saved: {selectedTikTokJob.external_post_id}</p> : null}
                    </div>
                  ) : (
                    <p className="text-[10px] leading-4 text-slate-600">Select exactly one TikTok row below.</p>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void loadTikTokCreatorInfo()}
                      disabled={tiktokLoadingCreator || tiktokPublishing || saving || !selectedTikTokJob || !selectedTikTokJob.media_asset_id || Boolean(selectedTikTokJob.external_post_id)}
                      className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-[10px] font-semibold text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {tiktokLoadingCreator ? "Loading TikTok settings…" : "Load current TikTok settings"}
                    </button>
                    {selectedTikTokJob?.external_post_id ? (
                      <button
                        type="button"
                        onClick={() => void checkSelectedTikTokStatus()}
                        disabled={tiktokCheckingStatus || tiktokPublishing || saving}
                        className="rounded-lg border border-slate-700 px-3 py-2 text-[10px] font-semibold text-slate-300 disabled:opacity-40"
                      >
                        {tiktokCheckingStatus ? "Checking…" : "Check TikTok Status"}
                      </button>
                    ) : null}
                  </div>

                  {tiktokCreator && selectedTikTokJob ? (
                    <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
                      <div className="flex items-center gap-3">
                        {tiktokCreator.creatorAvatarUrl ? (
                          <img src={tiktokCreator.creatorAvatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : null}
                        <div>
                          <p className="text-xs font-semibold text-white">{tiktokCreator.creatorNickname || tiktokCreator.creatorUsername || "TikTok creator"}</p>
                          {tiktokCreator.creatorUsername ? <p className="text-[10px] text-slate-500">@{tiktokCreator.creatorUsername}</p> : null}
                        </div>
                        <div className="ml-auto text-right text-[10px] text-slate-500">
                          <p>{tiktokDurationSeconds ? `${tiktokDurationSeconds.toFixed(1)}s video` : "Checking duration…"}</p>
                          <p>Creator max: {tiktokCreator.maxVideoPostDurationSec || "—"}s</p>
                        </div>
                      </div>

                      <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        TikTok caption / title
                        <textarea
                          value={tiktokTitle}
                          onChange={(event) => setTikTokTitle(event.target.value)}
                          rows={4}
                          maxLength={2200}
                          className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0a1421] px-3 py-2 text-xs normal-case tracking-normal text-slate-200 outline-none"
                        />
                        <span className="mt-1 block text-right text-[9px] font-normal normal-case tracking-normal text-slate-600">{tiktokTitle.length}/2200</span>
                      </label>

                      <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                        Privacy · choose manually
                        <select
                          value={tiktokPrivacy}
                          onChange={(event) => {
                            const value = event.target.value;
                            setTikTokPrivacy(value);
                            if (value === "SELF_ONLY" && tiktokBrandedContent) setTikTokBrandedContent(false);
                          }}
                          className="mt-1 block w-full rounded-lg border border-slate-700 bg-[#0a1421] px-3 py-2 text-xs normal-case tracking-normal text-slate-200 outline-none"
                        >
                          <option value="">Choose privacy…</option>
                          {tiktokCreator.privacyLevelOptions.map((option) => (
                            <option key={option} value={option}>{tikTokPrivacyLabel(option)}</option>
                          ))}
                        </select>
                      </label>

                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Interactions · all off until you choose</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          <label className={`flex items-center gap-2 text-[10px] ${tiktokCreator.commentDisabled ? "text-slate-700" : "text-slate-400"}`}>
                            <input type="checkbox" checked={tiktokAllowComment} disabled={tiktokCreator.commentDisabled} onChange={(event) => setTikTokAllowComment(event.target.checked)} />
                            Allow comments
                          </label>
                          <label className={`flex items-center gap-2 text-[10px] ${tiktokCreator.duetDisabled ? "text-slate-700" : "text-slate-400"}`}>
                            <input type="checkbox" checked={tiktokAllowDuet} disabled={tiktokCreator.duetDisabled} onChange={(event) => setTikTokAllowDuet(event.target.checked)} />
                            Allow Duet
                          </label>
                          <label className={`flex items-center gap-2 text-[10px] ${tiktokCreator.stitchDisabled ? "text-slate-700" : "text-slate-400"}`}>
                            <input type="checkbox" checked={tiktokAllowStitch} disabled={tiktokCreator.stitchDisabled} onChange={(event) => setTikTokAllowStitch(event.target.checked)} />
                            Allow Stitch
                          </label>
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-[#0a1421] p-3">
                        <label className="flex items-center gap-2 text-[10px] text-slate-300">
                          <input
                            type="checkbox"
                            checked={tiktokCommercialContent}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setTikTokCommercialContent(checked);
                              if (!checked) {
                                setTikTokOwnBrand(false);
                                setTikTokBrandedContent(false);
                              }
                            }}
                          />
                          This content promotes a brand, product or service
                        </label>
                        {tiktokCommercialContent ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <label className="flex items-center gap-2 text-[10px] text-slate-400">
                              <input type="checkbox" checked={tiktokOwnBrand} onChange={(event) => setTikTokOwnBrand(event.target.checked)} />
                              Your brand / own business
                            </label>
                            <label className={`flex items-center gap-2 text-[10px] ${tiktokPrivacy === "SELF_ONLY" ? "text-slate-700" : "text-slate-400"}`}>
                              <input type="checkbox" checked={tiktokBrandedContent} disabled={tiktokPrivacy === "SELF_ONLY"} onChange={(event) => setTikTokBrandedContent(event.target.checked)} />
                              Branded content / paid partnership
                            </label>
                          </div>
                        ) : null}
                      </div>

                      <label className="flex items-center gap-2 text-[10px] text-slate-400">
                        <input type="checkbox" checked={tiktokAigc} onChange={(event) => setTikTokAigc(event.target.checked)} />
                        Mark this video as AI-generated content
                      </label>

                      <label className="flex items-start gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] p-3 text-[10px] leading-4 text-amber-100/80">
                        <input className="mt-0.5" type="checkbox" checked={tiktokMusicConsent} onChange={(event) => setTikTokMusicConsent(event.target.checked)} />
                        <span>By posting, you agree to TikTok&apos;s Music Usage Confirmation</span>
                      </label>

                      <button
                        type="button"
                        onClick={() => void publishSelectedTikTok()}
                        disabled={
                          tiktokPublishing ||
                          saving ||
                          !selectedTikTokJob.ready_to_publish ||
                          blockingIssues(selectedTikTokJob).length > 0 ||
                          Boolean(selectedTikTokJob.scheduled_for) ||
                          !selectedTikTokJob.media_asset_id ||
                          Boolean(selectedTikTokJob.external_post_id) ||
                          !tiktokPrivacy ||
                          !tiktokMusicConsent ||
                          !(typeof tiktokDurationSeconds === "number" && Number.isFinite(tiktokDurationSeconds)) ||
                          (tiktokCommercialContent && !tiktokOwnBrand && !tiktokBrandedContent) ||
                          (tiktokBrandedContent && tiktokPrivacy === "SELF_ONLY")
                        }
                        className="w-full rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2.5 text-xs font-bold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {tiktokPublishing ? "Sending video to TikTok…" : "Publish Selected to TikTok"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {platforms.map((platform) => {
              const platformJobs = filteredJobs.filter((job) => job.platform === platform);
              if (platformJobs.length === 0) return null;
              const isCollapsed = collapsed[platform];

              return (
                <div key={platform} className="overflow-hidden rounded-2xl border border-slate-800 bg-[#08121d]">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsed((current) => ({ ...current, [platform]: !current[platform] }))
                    }
                    className="flex w-full items-center justify-between border-b border-slate-800 bg-[#0d1825] px-4 py-3 text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] ${platformStyles[platform]}`}>
                        {platformLabels[platform]}
                      </span>
                      <span className="text-xs font-semibold text-slate-300">{platformJobs.length} visible item{platformJobs.length === 1 ? "" : "s"}</span>
                    </span>
                    <span className="text-xs text-slate-500">{isCollapsed ? "Show" : "Hide"}</span>
                  </button>

                  {!isCollapsed && (
                    <div className="overflow-x-auto">
                      <table className="min-w-[1320px] w-full text-left">
                        <thead className="border-b border-slate-800 bg-[#0b1622] text-[9px] font-bold uppercase tracking-[0.16em] text-slate-600">
                          <tr>
                            <th className="px-4 py-3">
                              <input
                                type="checkbox"
                                aria-label={`Select visible ${platformLabels[platform]} rows`}
                                checked={platformJobs.every((job) => selectedIds.has(job.id))}
                                onChange={() => {
                                  const ids = platformJobs.map((job) => job.id);
                                  const all = ids.every((id) => selectedIds.has(id));
                                  setSelectedIds((previous) => {
                                    const next = new Set(previous);
                                    ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
                                    return next;
                                  });
                                }}
                              />
                            </th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Media</th>
                            <th className="px-4 py-3">Saved copy</th>
                            <th className="px-4 py-3">Schedule</th>
                            <th className="px-4 py-3">Validation</th>
                            <th className="px-4 py-3">Ready</th>
                            <th className="px-4 py-3">Platform status</th>
                            <th className="px-4 py-3">Edit</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80">
                          {platformJobs.map((job) => {
                            const mediaFilename = cleanString(job.payload?.mediaFilename);
                            const errors = blockingIssues(job);
                            const warnings = warningIssues(job);
                            const isEditing = editingId === job.id && editDraft;

                            return (
                              <tr key={job.id} className="align-top text-xs text-slate-300">
                                <td className="px-4 py-4">
                                  <input
                                    type="checkbox"
                                    aria-label={`Select ${job.item_key}`}
                                    checked={selectedIds.has(job.id)}
                                    onChange={() => toggleJobSelection(job.id)}
                                  />
                                </td>
                                <td className="px-4 py-4">
                                  <p className="font-semibold text-slate-200">{prettyContentType(job.content_type)}</p>
                                  <p className="mt-1 font-mono text-[9px] text-slate-600">{job.item_key}</p>
                                </td>
                                <td className="max-w-[180px] px-4 py-4">
                                  {mediaFilename ? (
                                    <>
                                      <p className="truncate font-medium text-slate-200" title={mediaFilename}>{mediaFilename}</p>
                                      <p className="mt-1 text-[10px] text-emerald-400">Linked</p>
                                    </>
                                  ) : (
                                    <span className="text-slate-600">No media assigned</span>
                                  )}
                                </td>
                                <td className="max-w-[360px] px-4 py-4">
                                  <p className="line-clamp-3 leading-5 text-slate-400">{compactCopy(job)}</p>
                                </td>
                                <td className="max-w-[190px] px-4 py-4">
                                  {job.scheduled_for ? (
                                    <>
                                      <p className="text-sky-200">{new Date(job.scheduled_for).toLocaleString()}</p>
                                      <p className="mt-1 text-[9px] text-slate-600">{job.schedule_timezone || "Timezone not saved"}</p>
                                    </>
                                  ) : (
                                    <span className="text-slate-600">Not scheduled</span>
                                  )}
                                </td>
                                <td className="px-4 py-4">
                                  {errors.length === 0 && warnings.length === 0 ? (
                                    <span className="text-emerald-300">Clear</span>
                                  ) : (
                                    <div className="space-y-1.5">
                                      <p className={errors.length ? "text-red-300" : "text-amber-300"}>
                                        {errors.length ? `${errors.length} error${errors.length === 1 ? "" : "s"}` : ""}
                                        {errors.length && warnings.length ? " · " : ""}
                                        {warnings.length ? `${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}
                                      </p>
                                      <p className="max-w-[230px] text-[10px] leading-4 text-slate-600">
                                        {issueMessage((errors[0] || warnings[0]) as ValidationIssue | string)}
                                      </p>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-4">
                                  <button
                                    type="button"
                                    disabled={saving || Boolean(job.external_post_id) || (errors.length > 0 && !job.ready_to_publish)}
                                    onClick={() =>
                                      void patchCampaign(
                                        {
                                          updates: [
                                            { id: job.id, ready_to_publish: !job.ready_to_publish },
                                          ],
                                        },
                                        `${job.item_key} marked ${job.ready_to_publish ? "Draft" : "Ready"}.`
                                      )
                                    }
                                    title={errors.length ? "Fix blocking errors before marking this row Ready." : "Toggle Ready approval"}
                                    className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] disabled:cursor-not-allowed disabled:opacity-40 ${job.ready_to_publish ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-slate-700 bg-slate-900 text-slate-500"}`}
                                  >
                                    {job.ready_to_publish ? "Ready" : "Draft"}
                                  </button>
                                </td>
                                <td className="max-w-[220px] px-4 py-4">
                                  <p className={`text-[10px] font-bold uppercase tracking-[0.08em] ${job.status === "published" ? "text-emerald-300" : job.status === "scheduled" ? "text-sky-300" : job.status === "failed" ? "text-red-300" : job.status === "uploading" ? "text-amber-300" : "text-slate-500"}`}>
                                    {job.status === "published" && cleanString(job.payload?.youtubePrivacyStatus) === "private" ? "Uploaded · private" : job.status}
                                  </p>
                                  {cleanString(job.payload?.youtubePrivacyStatus) && (
                                    <p className="mt-1 text-[9px] text-slate-600">YouTube visibility: {cleanString(job.payload?.youtubePrivacyStatus)}</p>
                                  )}
                                  {job.external_url && (
                                    <a
                                      href={job.external_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-1 inline-block text-[10px] font-semibold text-sky-300 hover:text-sky-200"
                                    >
                                      {job.platform === "youtube"
                                        ? "Open on YouTube ↗"
                                        : job.platform === "facebook"
                                          ? "Open on Facebook ↗"
                                          : job.platform === "instagram"
                                            ? "Open on Instagram ↗"
                                            : "Open published post ↗"}
                                    </a>
                                  )}
                                  {job.error_message && (
                                    <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-amber-300/75" title={job.error_message}>{job.error_message}</p>
                                  )}
                                </td>
                                <td className="px-4 py-4">
                                  <button
                                    type="button"
                                    disabled={Boolean(job.external_post_id) || ["uploading", "published"].includes(job.status)}
                                    onClick={() => (isEditing ? (setEditingId(null), setEditDraft(null)) : openEditor(job))}
                                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-[10px] font-semibold text-slate-300 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {isEditing ? "Close" : "Edit"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {platformJobs.some((job) => job.id === editingId) && editDraft && (
                        <div className="border-t border-indigo-400/15 bg-indigo-400/[0.025] p-5">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-300/70">Edit campaign row</p>
                              <p className="mt-1 font-mono text-[10px] text-slate-500">{jobs.find((job) => job.id === editingId)?.item_key}</p>
                            </div>
                            <button type="button" onClick={() => (setEditingId(null), setEditDraft(null))} className="text-xs text-slate-500 hover:text-white">Close</button>
                          </div>

                          <div className="mt-4 grid gap-4 xl:grid-cols-2">
                            <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Title
                              <input
                                value={editDraft.title}
                                onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })}
                                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-[#08121d] px-3 py-2.5 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-indigo-400/40"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Hashtags — comma separated
                              <input
                                value={editDraft.hashtags}
                                onChange={(event) => setEditDraft({ ...editDraft, hashtags: event.target.value })}
                                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-[#08121d] px-3 py-2.5 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-indigo-400/40"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 xl:col-span-2">
                              Caption
                              <textarea
                                rows={4}
                                value={editDraft.caption}
                                onChange={(event) => setEditDraft({ ...editDraft, caption: event.target.value })}
                                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-[#08121d] px-3 py-2.5 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-indigo-400/40"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 xl:col-span-2">
                              Description
                              <textarea
                                rows={6}
                                value={editDraft.description}
                                onChange={(event) => setEditDraft({ ...editDraft, description: event.target.value })}
                                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-[#08121d] px-3 py-2.5 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-indigo-400/40"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Tags — comma separated
                              <input
                                value={editDraft.tags}
                                onChange={(event) => setEditDraft({ ...editDraft, tags: event.target.value })}
                                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-[#08121d] px-3 py-2.5 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-indigo-400/40"
                              />
                            </label>
                            <label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Schedule
                              <input
                                type="datetime-local"
                                value={editDraft.scheduled_for}
                                onChange={(event) => setEditDraft({ ...editDraft, scheduled_for: event.target.value })}
                                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-[#08121d] px-3 py-2.5 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-indigo-400/40"
                              />
                            </label>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <label className="flex items-center gap-2 text-xs text-slate-300">
                              <input
                                type="checkbox"
                                checked={editDraft.ready_to_publish}
                                onChange={(event) => setEditDraft({ ...editDraft, ready_to_publish: event.target.checked })}
                              />
                              Ready to Publish
                            </label>
                            <button
                              type="button"
                              onClick={() => void saveEditor()}
                              disabled={saving}
                              className="rounded-xl border border-indigo-400/30 bg-indigo-400/15 px-5 py-2.5 text-xs font-bold text-indigo-100 disabled:opacity-50"
                            >
                              {saving ? "Saving…" : "Save Row"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {filteredJobs.length === 0 && (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
              No campaign rows match the current filters.
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <span>{campaign.name}</span>
            <span>Single-row YouTube proven · Meta single-row publishers prepared · bulk cross-platform publish remains locked</span>
          </div>
        </>
      ) : null}
    </section>
  );
}
