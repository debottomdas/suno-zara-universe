"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import BulkCampaignManager from "@/components/BulkCampaignManager";

type Platform = "youtube" | "facebook" | "instagram" | "tiktok";

type PublishingConnection = {
  id: string;
  platform: Platform;
  external_account_id: string | null;
  display_name: string | null;
  handle: string | null;
  account_type: string | null;
  status: "connected" | "needs_reauth" | "error";
  is_primary: boolean;
  scopes: string[];
  metadata: Record<string, unknown>;
  connected_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};

type Props = {
  projectId?: string | null;
  songTitle?: string;
};

const platformDefinitions: Array<{
  platform: Platform;
  name: string;
  mark: string;
  description: string;
  capability: string;
  accent: string;
  chip: string;
}> = [
  {
    platform: "youtube",
    name: "YouTube",
    mark: "▶",
    description: "Full-song video publishing, metadata, thumbnail and scheduling.",
    capability: "Upload + native schedule",
    accent: "border-red-400/20 bg-red-400/[0.045]",
    chip: "border-red-400/20 bg-red-400/10 text-red-200",
  },
  {
    platform: "facebook",
    name: "Facebook",
    mark: "f",
    description: "Publish Page video/Reels using the saved Facebook release pack.",
    capability: "Page publishing + schedule",
    accent: "border-blue-400/20 bg-blue-400/[0.045]",
    chip: "border-blue-400/20 bg-blue-400/10 text-blue-200",
  },
  {
    platform: "instagram",
    name: "Instagram",
    mark: "◎",
    description: "Publish Reels to an eligible professional Instagram account.",
    capability: "Direct publish; Studio scheduling planned",
    accent: "border-pink-400/20 bg-pink-400/[0.045]",
    chip: "border-pink-400/20 bg-pink-400/10 text-pink-200",
  },
  {
    platform: "tiktok",
    name: "TikTok",
    mark: "♪",
    description: "Direct Post workflow using saved vertical clips and TikTok copy.",
    capability: "Direct post + local file upload",
    accent: "border-cyan-400/20 bg-cyan-400/[0.045]",
    chip: "border-cyan-400/20 bg-cyan-400/10 text-cyan-200",
  },
];

function connectionLabel(connection?: PublishingConnection) {
  if (!connection) return "Not connected";
  if (connection.status === "needs_reauth") return "Reconnect required";
  if (connection.status === "error") return "Connection error";
  return "Connected";
}

function connectionDot(connection?: PublishingConnection) {
  if (!connection) return "bg-slate-600";
  if (connection.status === "connected") return "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.55)]";
  if (connection.status === "needs_reauth") return "bg-amber-400";
  return "bg-red-400";
}

export default function PublishingHub({ projectId, songTitle }: Props) {
  const [connections, setConnections] = useState<PublishingConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/publishing/connections", {
        method: "GET",
        cache: "no-store",
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Could not load connected accounts.");
      }

      setConnections(Array.isArray(data?.connections) ? data.connections : []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load connected accounts."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const youtubeResult = params.get("youtube");
    const metaResult = params.get("meta");
    const tiktokResult = params.get("tiktok");
    const reason = params.get("reason");

    if (tiktokResult === "connected") {
      setNotice({
        tone: "success",
        text: "TikTok connected successfully. Studio saved the creator identity and refreshable OAuth authorization for Content Posting API access.",
      });
      void loadConnections();
      return;
    }

    if (tiktokResult === "error") {
      const tiktokReasonMessages: Record<string, string> = {
        tiktok_denied: "TikTok authorization was cancelled or denied.",
        state: "The TikTok OAuth security check failed. Please try Connect TikTok again.",
        pkce: "The TikTok PKCE verification session expired. Please try Connect TikTok again.",
        session: "Your Suno Zara Universe Music Studio session was not available after returning from TikTok. Please sign in and retry.",
        configuration: "TikTok OAuth is not configured in .env.local yet.",
        token: "TikTok did not return a valid OAuth access token.",
        scope: "TikTok did not grant the required video.publish permission. Check Content Posting API access and reconnect.",
        profile: "Studio could not read the authorized TikTok creator profile.",
        refresh_token: "TikTok did not provide a refresh token. Reconnect TikTok and approve access again.",
        unexpected: "The TikTok connection failed unexpectedly. Check the development terminal for the server error.",
      };
      setNotice({
        tone: "error",
        text: tiktokReasonMessages[reason || ""] || "TikTok could not be connected.",
      });
      return;
    }

    if (metaResult === "connected") {
      const fbCount = Number(params.get("fb") || 0);
      const igCount = Number(params.get("ig") || 0);
      const needsSelection = params.get("selection") === "1";
      setNotice({
        tone: "success",
        text: `Meta connected successfully. Found ${fbCount} Facebook Page${fbCount === 1 ? "" : "s"}${igCount ? ` and ${igCount} linked Instagram professional account${igCount === 1 ? "" : "s"}` : ""}.${needsSelection ? " Choose the primary account below before publishing." : ""}`,
      });
      void loadConnections();
      return;
    }

    if (metaResult === "error") {
      const metaReasonMessages: Record<string, string> = {
        meta_denied: "Meta authorization was cancelled or denied.",
        state: "The Meta OAuth security check failed. Please try Connect Meta again.",
        session: "Your Suno Zara Universe Music Studio session was not available after returning from Meta. Please sign in and retry.",
        configuration: "Meta OAuth is not configured in .env.local yet.",
        token: "Meta did not return a valid access token.",
        long_token: "Studio could not exchange the Meta login for a long-lived access token.",
        no_pages: "Meta did not return any Facebook Pages with an access token. Check Page access and granted permissions.",
        unexpected: "The Meta connection failed unexpectedly. Check the development terminal for the server error.",
      };
      setNotice({
        tone: "error",
        text: metaReasonMessages[reason || ""] || "Facebook / Instagram could not be connected.",
      });
      return;
    }

    if (youtubeResult === "connected") {
      setNotice({
        tone: "success",
        text: "YouTube connected successfully. Studio can now identify this channel and securely refresh its OAuth access when publishing is enabled.",
      });
    } else if (youtubeResult === "error") {
      const reasonMessages: Record<string, string> = {
        google_denied: "Google authorization was cancelled or denied.",
        state: "The OAuth security check failed. Please try Connect YouTube again.",
        pkce: "The OAuth verification session expired. Please try again.",
        session: "Your Suno Zara Universe Music Studio session was not available after returning from Google. Please sign in and retry.",
        configuration: "The local Google OAuth configuration is incomplete.",
        token: "Google did not return a valid OAuth access token.",
        channel_lookup: "Studio could not read the authorized YouTube channel.",
        no_channel: "That Google account does not currently expose a YouTube channel to the API.",
        multiple_channels: "Google returned more than one YouTube channel. Studio will not guess which channel to connect; channel selection will be added before continuing.",
        refresh_token: "Google did not provide an offline refresh token. Reconnect and approve access again.",
        unexpected: "The YouTube connection failed unexpectedly. Check the development terminal for the server error.",
      };

      setNotice({
        tone: "error",
        text: reasonMessages[reason || ""] || "The YouTube connection could not be completed.",
      });
    }
  }, [loadConnections]);

  const connectionsByPlatform = useMemo(() => {
    const map = new Map<Platform, PublishingConnection[]>();
    for (const connection of connections) {
      const current = map.get(connection.platform) || [];
      current.push(connection);
      map.set(connection.platform, current);
    }
    return map;
  }, [connections]);

  const primaryByPlatform = useMemo(() => {
    const map = new Map<Platform, PublishingConnection>();
    for (const platform of ["youtube", "facebook", "instagram", "tiktok"] as Platform[]) {
      const candidates = connectionsByPlatform.get(platform) || [];
      const explicitPrimary = candidates.find((connection) => connection.is_primary);
      if (explicitPrimary) {
        map.set(platform, explicitPrimary);
      } else if (candidates.length === 1) {
        map.set(platform, candidates[0]);
      }
    }
    return map;
  }, [connectionsByPlatform]);

  async function setPrimaryConnection(platform: Platform, connectionId: string) {
    if (!connectionId) return;
    setSettingPrimary(connectionId);
    setError("");
    try {
      const response = await fetch("/api/publishing/connections/primary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, connectionId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Could not choose the primary account.");
      }
      await loadConnections();
      setNotice({
        tone: "success",
        text: `${platform === "facebook" ? "Facebook" : platform === "instagram" ? "Instagram" : platform} primary account updated.`,
      });
    } catch (primaryError) {
      setError(primaryError instanceof Error ? primaryError.message : "Could not choose the primary account.");
    } finally {
      setSettingPrimary(null);
    }
  }

  const connectedCount = useMemo(
    () =>
      platformDefinitions.filter(
        ({ platform }) => primaryByPlatform.get(platform)?.status === "connected"
      ).length,
    [primaryByPlatform]
  );

  return (
    <section className="rounded-[30px] border border-slate-800 bg-gradient-to-br from-[#0d1825] to-[#09131f] p-6 shadow-[0_28px_90px_-52px_rgba(0,0,0,1)] sm:p-8 lg:p-10">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-indigo-300/75">
            Publishing Hub
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white">
            Connected accounts
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            Connect each official platform once, then publish the saved media and final metadata for {songTitle ? `“${songTitle}”` : "the current song"} from one release workspace.
          </p>
        </div>

        <div className="flex min-w-[230px] items-center justify-between gap-5 rounded-2xl border border-slate-800 bg-[#0a1421] px-5 py-4">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-600">API accounts</p>
            <p className="mt-1 text-2xl font-semibold text-white">{connectedCount} / 4</p>
          </div>
          <button
            type="button"
            onClick={() => void loadConnections()}
            disabled={loading}
            className="rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-white disabled:opacity-50"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-sky-400/15 bg-sky-400/[0.045] px-4 py-3 text-xs leading-6 text-sky-100/75">
        <span className="font-semibold text-sky-200">Connection rule:</span> Suno Zara Universe Music Studio will use official OAuth only. It will never ask you to type a YouTube, Facebook, Instagram or TikTok password into Studio.
      </div>

      {error && (
        <div className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.055] px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {notice && (
        <div
          className={`mt-5 rounded-2xl border px-4 py-3 text-sm ${
            notice.tone === "success"
              ? "border-emerald-400/20 bg-emerald-400/[0.055] text-emerald-100"
              : "border-red-400/20 bg-red-400/[0.055] text-red-200"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="mt-7 grid gap-4 xl:grid-cols-2">
        {platformDefinitions.map((definition) => {
          const platformConnections = connectionsByPlatform.get(definition.platform) || [];
          const connection = primaryByPlatform.get(definition.platform);
          const identity = connection?.display_name || connection?.handle || connection?.external_account_id;
          const multipleWithoutPrimary =
            platformConnections.length > 1 && !platformConnections.some((item) => item.is_primary);
          const canConnect = ["youtube", "facebook", "instagram", "tiktok"].includes(definition.platform);

          return (
            <article
              key={definition.platform}
              className={`rounded-[24px] border p-5 ${definition.accent}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#0a1421] text-lg font-black text-white">
                    {definition.mark}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-white">{definition.name}</h3>
                      <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${definition.chip}`}>
                        {definition.capability}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{definition.description}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-3 border-t border-white/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        multipleWithoutPrimary ? "bg-amber-400" : connectionDot(connection)
                      }`}
                    />
                    <p className="text-sm font-semibold text-slate-200">
                      {loading
                        ? "Checking connection…"
                        : multipleWithoutPrimary
                          ? "Choose primary account"
                          : connectionLabel(connection)}
                    </p>
                  </div>
                  {identity && (
                    <p className="mt-1 truncate pl-[18px] text-xs text-slate-500">{identity}</p>
                  )}
                  {platformConnections.length > 1 && (
                    <select
                      value={connection?.id || ""}
                      disabled={Boolean(settingPrimary)}
                      onChange={(event) => void setPrimaryConnection(definition.platform, event.target.value)}
                      className="mt-2 ml-[18px] max-w-[280px] rounded-lg border border-slate-700 bg-[#08121d] px-2.5 py-2 text-[11px] text-slate-300 outline-none"
                    >
                      <option value="">Choose primary…</option>
                      {platformConnections.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.display_name || item.handle || item.external_account_id || "Connected account"}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!canConnect}
                  onClick={() => {
                    if (definition.platform === "youtube") {
                      window.location.href = "/api/publishing/youtube/connect";
                    } else if (definition.platform === "facebook" || definition.platform === "instagram") {
                      window.location.href = "/api/publishing/meta/connect";
                    } else if (definition.platform === "tiktok") {
                      window.location.href = "/api/publishing/tiktok/connect";
                    }
                  }}
                  title={
                    definition.platform === "youtube"
                      ? connection
                        ? "Reconnect or refresh YouTube authorization."
                        : "Connect YouTube with Google OAuth."
                      : definition.platform === "facebook" || definition.platform === "instagram"
                        ? "Connect Facebook Pages and linked Instagram professional accounts through Meta OAuth."
                        : "Connect TikTok with official Login Kit OAuth using the desktop localhost + PKCE flow."
                  }
                  className={`rounded-xl border px-4 py-2.5 text-xs font-bold transition ${
                    definition.platform === "youtube"
                      ? "border-red-400/25 bg-red-400/10 text-red-100 hover:border-red-300/40 hover:bg-red-400/15"
                      : definition.platform === "facebook" || definition.platform === "instagram"
                        ? "border-blue-400/25 bg-blue-400/10 text-blue-100 hover:border-blue-300/40 hover:bg-blue-400/15"
                        : definition.platform === "tiktok"
                          ? "border-cyan-400/25 bg-cyan-400/10 text-cyan-100 hover:border-cyan-300/40 hover:bg-cyan-400/15"
                          : "border-slate-700 bg-[#0a1421] text-slate-500 opacity-75"
                  }`}
                >
                  {definition.platform === "youtube"
                    ? connection
                      ? "Reconnect YouTube"
                      : "Connect YouTube"
                    : definition.platform === "facebook" || definition.platform === "instagram"
                      ? platformConnections.length > 0
                        ? "Reconnect Meta"
                        : "Connect Meta"
                      : definition.platform === "tiktok"
                        ? connection
                          ? "Reconnect TikTok"
                          : "Connect TikTok"
                        : connection
                          ? "Manage later"
                          : "Connect later"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <BulkCampaignManager projectId={projectId} songTitle={songTitle} />

      <div className="mt-5 rounded-[24px] border border-amber-300/20 bg-amber-300/[0.045] p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-300/10 text-lg font-black text-amber-200">DK</div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-white">DistroKid Release Pack</h3>
                <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-amber-200">
                  Manual upload
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                Studio will prepare every required release field and reuse the same Media Hub Final Audio and 3000×3000 cover — including Local Mac assets — so DistroKid submission becomes a fast manual upload without duplicating large media in cloud storage.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled
            title="The DistroKid Release Pack builder is scheduled after platform connections."
            className="shrink-0 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-2.5 text-xs font-bold text-amber-200/60"
          >
            Release Pack next
          </button>
        </div>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-3">
        {[
          ["1", "Connect", "Authorize official platform accounts with OAuth."],
          ["2", "Review", "Choose saved media and final platform metadata."],
          ["3", "Publish", "Publish now or schedule where the platform allows it."],
        ].map(([number, title, text]) => (
          <div key={number} className="rounded-2xl border border-slate-800 bg-[#0a1421] p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xs font-bold text-slate-300">{number}</span>
              <p className="text-sm font-semibold text-slate-100">{title}</p>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-500">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
