"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AccountMenu from "@/components/AccountMenu";
import { createClient } from "@/utils/supabase/client";

type SongProject = {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  status?: string;
  idea?: string;
  language?: string;
  script?: string;
  mood?: string;
  genre?: string;
  title?: string | null;
  lyrics?: string | null;
};

type ViewMode = "all" | "creating" | "ready" | "published";

type AssetState = "ready" | "pending";

type MediaAsset = {
  id?: string;
  mediaKind?: string;
  originalFilename?: string;
  storageProvider?: string;
  sizeBytes?: number | null;
  url?: string | null;
  downloadUrl?: string | null;
};

type PublishingConnection = {
  id: string;
  platform: string;
  status?: string;
  is_primary?: boolean;
};

const NAV_ITEMS = [
  { label: "Home", icon: "⌂", href: "/" },
  { label: "Music", icon: "♫", href: "/music", active: true },
  { label: "Script", icon: "▤", href: "/script", note: "Coming Soon" },
  { label: "Podcast", icon: "◉", href: "/podcast", note: "Coming Soon" },
];

const LOWER_NAV = [
  { label: "Library", icon: "▱" },
  { label: "Publishing", icon: "⇧" },
  { label: "Analytics", icon: "▥" },
  { label: "Settings", icon: "⚙" },
];

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function projectLabel(project: SongProject) {
  return (
    project.title?.trim() ||
    project.idea?.trim() ||
    "Untitled Song"
  );
}

function projectStage(project: SongProject) {
  const raw = (project.status || "").toLowerCase();
  if (raw.includes("publish")) return "Published";
  if (raw.includes("release")) return "Release Ready";
  if (raw.includes("song-generated") || raw.includes("lyrics-imported")) {
    return "Ready for Suno";
  }
  return "Creating";
}

function stageClass(stage: string) {
  if (stage === "Published") return "text-emerald-300";
  if (stage === "Release Ready") return "text-cyan-300";
  if (stage === "Ready for Suno") return "text-emerald-300";
  return "text-amber-200";
}

function StatusDot({ state }: { state: AssetState }) {
  return (
    <span
      className={classNames(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black",
        state === "ready"
          ? "bg-emerald-400 text-emerald-950"
          : "border border-white/15 bg-white/[0.04] text-zinc-500"
      )}
    >
      {state === "ready" ? "✓" : "·"}
    </span>
  );
}

function SectionTitle({
  number,
  title,
  subtitle,
  tone,
}: {
  number: string;
  title: string;
  subtitle: string;
  tone: "create" | "release";
}) {
  return (
    <div className="flex items-center gap-4">
      <div
        className={classNames(
          "flex h-12 w-12 items-center justify-center rounded-full text-lg font-black shadow-lg",
          tone === "create"
            ? "bg-gradient-to-br from-[#ffd89a] to-[#ff8f87] text-[#3a1c1a] shadow-orange-400/10"
            : "bg-gradient-to-br from-cyan-300 to-sky-500 text-[#04131b] shadow-cyan-400/10"
        )}
      >
        {number}
      </div>
      <div>
        <h2 className="text-[28px] font-black tracking-[-0.04em] text-white">
          {title}
        </h2>
        <p className="mt-0.5 text-sm text-zinc-400">{subtitle}</p>
      </div>
    </div>
  );
}

export default function MusicUniversePage() {
  const [projects, setProjects] = useState<SongProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState("");
  const [filter, setFilter] = useState<ViewMode>("all");
  const [search, setSearch] = useState("");
  const [additionalDirection, setAdditionalDirection] = useState("");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [showNewSong, setShowNewSong] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [artworkByProject, setArtworkByProject] = useState<Record<string, string>>({});
  const [finalAudioAsset, setFinalAudioAsset] = useState<MediaAsset | null>(null);
  const [finalAudioLoading, setFinalAudioLoading] = useState(false);
  const [connections, setConnections] = useState<PublishingConnection[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setAccountEmail(data.user?.email ?? "");
    });
  }, []);

  useEffect(() => {
    async function loadProjects() {
      try {
        setLoading(true);
        const response = await fetch("/api/songs", { cache: "no-store" });
        const data = await response.json();
        const nextProjects = Array.isArray(data.projects) ? data.projects : [];
        setProjects(nextProjects);
        setActiveProjectId((current) => current || nextProjects[0]?.id || null);
      } catch (error) {
        console.error("Could not load songs", error);
      } finally {
        setLoading(false);
      }
    }

    void loadProjects();
  }, []);

  useEffect(() => {
    if (!projects.length) return;
    let cancelled = false;
    async function loadArtwork() {
      const pairs = await Promise.all(
        projects.slice(0, 12).map(async (project) => {
          try {
            const response = await fetch(`/api/media/artwork?projectId=${encodeURIComponent(project.id)}`, { cache: "no-store" });
            if (!response.ok) return [project.id, ""] as const;
            const data = await response.json();
            const assets = Array.isArray(data.assets) ? data.assets : [];
            const cover = assets.find((asset: MediaAsset) => asset.mediaKind === "cover-art") || assets[0];
            return [project.id, typeof cover?.url === "string" ? cover.url : ""] as const;
          } catch {
            return [project.id, ""] as const;
          }
        })
      );
      if (!cancelled) setArtworkByProject(Object.fromEntries(pairs.filter(([, url]) => Boolean(url))));
    }
    void loadArtwork();
    return () => { cancelled = true; };
  }, [projects]);

  useEffect(() => {
    let cancelled = false;
    async function loadConnections() {
      try {
        const response = await fetch("/api/publishing/connections", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setConnections(Array.isArray(data.connections) ? data.connections : []);
      } catch {}
    }
    void loadConnections();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadFinalAudio() {
      if (!activeProjectId) {
        setFinalAudioAsset(null);
        return;
      }
      try {
        setFinalAudioLoading(true);
        const response = await fetch(`/api/media/final-audio?projectId=${encodeURIComponent(activeProjectId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load final audio");
        const data = await response.json();
        if (!cancelled) setFinalAudioAsset(data.asset || null);
      } catch {
        if (!cancelled) setFinalAudioAsset(null);
      } finally {
        if (!cancelled) setFinalAudioLoading(false);
      }
    }
    void loadFinalAudio();
    return () => { cancelled = true; };
  }, [activeProjectId]);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      const stage = projectStage(project);
      const matchesFilter =
        filter === "all" ||
        (filter === "creating" && stage === "Creating") ||
        (filter === "ready" && (stage === "Ready for Suno" || stage === "Release Ready")) ||
        (filter === "published" && stage === "Published");
      const matchesSearch =
        !query ||
        [projectLabel(project), project.idea, project.language, project.genre, project.mood]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      return matchesFilter && matchesSearch;
    });
  }, [projects, filter, search]);

  const activeProject =
    projects.find((project) => project.id === activeProjectId) || projects[0] || null;
  const activeStage = activeProject ? projectStage(activeProject) : "Creating";
  const hasLyrics = Boolean(activeProject?.lyrics?.trim());
  const activeArtwork = activeProject ? artworkByProject[activeProject.id] : "";
  const connectedPlatforms = useMemo(() => {
    const connected = new Set(
      connections.filter((item) => item.status === "connected").map((item) => item.platform.toLowerCase())
    );
    return connected;
  }, [connections]);

  const creationAssets: Array<{ label: string; detail: string; state: AssetState }> = [
    { label: "Lyrics", detail: hasLyrics ? "Lyrics available" : "Generate or upload lyrics", state: hasLyrics ? "ready" : "pending" },
    { label: "Suno Style", detail: "Lyrics + optional creative direction", state: "pending" },
    { label: "Artwork & Thumbnails", detail: "Main • YouTube • Vertical", state: "pending" },
    { label: "Visual Clips", detail: "Short cinematic scene clips", state: "pending" },
    { label: "Social Media Pack", detail: "YouTube • Instagram • Facebook • TikTok", state: "pending" },
  ];

  return (
    <div className="min-h-screen bg-[#06101a] text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_76%_4%,rgba(255,133,132,.10),transparent_30rem),radial-gradient(circle_at_11%_74%,rgba(19,180,184,.10),transparent_34rem),linear-gradient(180deg,#06101a_0%,#07131f_52%,#08121b_100%)]" />

      <div className="relative mx-auto flex min-h-screen max-w-[1920px]">
        <aside className="sticky top-0 hidden h-screen w-[226px] shrink-0 border-r border-white/[0.07] bg-[#07111c]/95 px-4 py-6 backdrop-blur-2xl lg:flex lg:flex-col">
          <Link href="/" className="px-3">
            <div className="flex items-center gap-3">
              <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 via-violet-300 to-orange-300 shadow-[0_12px_35px_-20px_rgba(103,232,249,.9)]">
                <div className="absolute inset-[3px] rounded-[13px] bg-[#08131f]" />
                <span className="relative text-lg">〜</span>
              </div>
              <div>
                <p className="text-[15px] font-black tracking-[0.16em] text-white">SUNO ZARA</p>
                <p className="mt-0.5 text-[10px] font-semibold tracking-[0.34em] text-orange-200">UNIVERSE</p>
              </div>
            </div>
            <p className="mt-4 text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
              Create • Produce • Share • Inspire
            </p>
          </Link>

          <nav className="mt-10 space-y-1.5">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={classNames(
                  "group flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm transition",
                  item.active
                    ? "border border-cyan-300/10 bg-gradient-to-r from-cyan-400/15 to-sky-500/[0.04] text-cyan-200 shadow-[inset_3px_0_0_#25d5d8]"
                    : "text-zinc-400 hover:bg-white/[0.04] hover:text-white"
                )}
              >
                <span className="w-6 text-center text-lg">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.note && <span className="text-[9px] text-zinc-600">{item.note}</span>}
              </Link>
            ))}
          </nav>

          <div className="my-7 h-px bg-white/[0.07]" />

          <nav className="space-y-1.5">
            {LOWER_NAV.map((item) => (
              <button
                key={item.label}
                type="button"
                className="flex w-full items-center gap-3 rounded-2xl px-3.5 py-3 text-left text-sm text-zinc-400 transition hover:bg-white/[0.04] hover:text-white"
              >
                <span className="w-6 text-center text-lg">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto">
            <div className="mb-5 rounded-[22px] border border-white/[0.07] bg-[linear-gradient(145deg,rgba(255,180,121,.07),rgba(8,19,31,.15))] px-4 py-5">
              <p className="font-serif text-lg italic leading-7 text-orange-100/90">
                Songs<br />Stories<br />Ideas<br />A kinder world ♡
              </p>
              <div className="mt-4 h-px w-7 bg-orange-200/50" />
              <p className="mt-3 text-[10px] text-zinc-500">— Suno Zara</p>
            </div>
            {accountEmail ? (
              <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2.5">
                <AccountMenu email={accountEmail} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">Deb</p>
                  <p className="text-[10px] text-zinc-500">Creator • Keep creating ♡</p>
                </div>
              </div>
            ) : (
              <Link href="/login" className="block rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-center text-sm text-zinc-300">
                Sign in
              </Link>
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <section className="relative overflow-hidden border-b border-white/[0.06]">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,16,26,.92),rgba(6,16,26,.28)_46%,rgba(6,16,26,.58)),url('/universe-music-hero.svg')] bg-cover bg-center" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_35%,rgba(255,190,142,.18),transparent_23rem),linear-gradient(180deg,transparent,rgba(5,13,22,.78))]" />
            <div className="relative flex min-h-[250px] items-end justify-between gap-6 px-5 pb-8 pt-6 sm:px-8 xl:px-10">
              <div className="max-w-xl">
                <div className="inline-flex rounded-full border border-orange-200/20 bg-black/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-orange-100/80 backdrop-blur-lg">Suno Zara Music</div>
                <p className="mt-4 font-serif text-4xl italic leading-[1.05] text-orange-50 sm:text-5xl">
                  Music for the moments<br />that matter ♡
                </p>
                <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-200/80">
                  Bring the lyrics. Bring the final Suno song. Universe prepares the visuals, videos, shorts and release around it.
                </p>
              </div>
              <div className="hidden items-center gap-3 sm:flex">
                <div className="rounded-full border border-white/10 bg-black/20 px-4 py-2 text-xs text-zinc-300 backdrop-blur-xl">
                  Create • Release • Learn
                </div>
              </div>
            </div>
          </section>

          <div className="px-4 py-5 sm:px-7 xl:px-9">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h1 className="text-3xl font-black tracking-[-0.04em]">Good Evening, Deb</h1>
                <p className="mt-1 text-sm text-zinc-400">Let&apos;s create something beautiful today.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex min-w-[280px] items-center gap-2 rounded-full border border-white/10 bg-[#091522]/80 px-4 py-2.5 shadow-inner shadow-black/20">
                  <span className="text-zinc-500">⌕</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search songs, ideas, or anything..."
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewSong(true)}
                  className="rounded-2xl bg-gradient-to-r from-[#ffd591] via-[#ff958b] to-[#f767ac] px-5 py-3 text-sm font-black text-[#261517] shadow-[0_16px_40px_-22px_rgba(255,145,135,.9)] transition hover:-translate-y-0.5"
                >
                  ＋ New Song
                </button>
              </div>
            </div>

            <section className="mt-6">
              <div className="flex flex-wrap items-center gap-2">
                {([
                  ["all", "All"],
                  ["creating", "Creating"],
                  ["ready", "Ready"],
                  ["published", "Published"],
                ] as Array<[ViewMode, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={classNames(
                      "rounded-full border px-4 py-1.5 text-xs font-bold transition",
                      filter === value
                        ? "border-orange-200/40 bg-orange-200/10 text-orange-100"
                        : "border-white/[0.08] bg-white/[0.02] text-zinc-500 hover:text-zinc-200"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                {loading && (
                  <div className="col-span-full rounded-[24px] border border-white/[0.07] bg-white/[0.025] p-6 text-sm text-zinc-500">Loading your songs…</div>
                )}
                {!loading && filteredProjects.slice(0, 4).map((project, index) => {
                  const stage = projectStage(project);
                  const active = activeProject?.id === project.id;
                  const cardGradients = [
                    "from-[#f19a6b]/35 via-[#212c31] to-[#0a1722]",
                    "from-[#276f81]/40 via-[#162f3b] to-[#0a1722]",
                    "from-[#d8aa6c]/30 via-[#30312d] to-[#0a1722]",
                    "from-[#8e4b73]/30 via-[#23313a] to-[#0a1722]",
                  ];
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => setActiveProjectId(project.id)}
                      className={classNames(
                        "group relative min-h-[132px] overflow-hidden rounded-[22px] border text-left transition duration-300",
                        active
                          ? "border-orange-200/65 shadow-[0_0_0_2px_rgba(255,121,167,.55),0_18px_45px_-26px_rgba(255,119,170,.85)]"
                          : "border-white/[0.08] hover:-translate-y-0.5 hover:border-white/20"
                      )}
                    >
                      {artworkByProject[project.id] ? (
                        <div
                          className="absolute inset-0 bg-cover bg-center transition duration-500 group-hover:scale-[1.03]"
                          style={{ backgroundImage: `url(${artworkByProject[project.id]})` }}
                        />
                      ) : (
                        <div className={classNames("absolute inset-0 bg-gradient-to-br", cardGradients[index % cardGradients.length])} />
                      )}
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,9,14,.02),rgba(3,9,14,.12)_42%,rgba(3,9,14,.92))]" />
                      <div className="relative flex h-full min-h-[132px] flex-col justify-end bg-gradient-to-t from-black/70 via-black/5 to-transparent p-4">
                        <p className="line-clamp-1 text-sm font-bold text-white">{projectLabel(project)}</p>
                        <p className={classNames("mt-1 text-xs font-bold", stageClass(stage))}>{stage}</p>
                      </div>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowNewSong(true)}
                  className="flex min-h-[132px] flex-col items-center justify-center rounded-[22px] border border-dashed border-white/15 bg-white/[0.018] text-center transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.03]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 text-2xl text-white">＋</span>
                  <span className="mt-3 text-sm font-bold">Create New Song</span>
                  <span className="mt-1 text-[10px] text-zinc-600">Start a new musical journey</span>
                </button>
              </div>
            </section>

            <section className="mt-5 overflow-hidden rounded-[30px] border border-cyan-300/15 bg-[#0a1824]/88 shadow-[0_25px_90px_-55px_rgba(0,215,220,.55)] backdrop-blur-xl">
              <div className="flex flex-col gap-4 border-b border-white/[0.07] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-orange-200/30 bg-gradient-to-br from-orange-200/20 via-rose-300/10 to-cyan-300/10 text-2xl">
                    {activeArtwork ? <img src={activeArtwork} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <span>♪</span>}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-2xl font-black tracking-[-0.035em]">{activeProject ? projectLabel(activeProject) : "Your first song"}</h2>
                      <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-[10px] font-bold text-emerald-200">{activeStage}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {[activeProject?.mood, activeProject?.language, activeProject?.genre].filter(Boolean).join(" • ") || "Create • Shape • Release"}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold text-zinc-300 hover:bg-white/[0.06]">Preview Concept</button>
                  <button onClick={() => setShowLegacy((value) => !value)} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold text-zinc-300 hover:bg-white/[0.06]">•••</button>
                </div>
              </div>

              {showLegacy && (
                <div className="border-b border-white/[0.07] bg-amber-200/[0.04] px-5 py-3 text-xs text-zinc-400">
                  Existing Studio tools remain available while we wire the new workflow. <Link href="/music/legacy" className="ml-2 font-bold text-amber-200 underline underline-offset-4">Open legacy workspace →</Link>
                </div>
              )}

              <div className="grid gap-0 xl:grid-cols-[1fr_1.08fr_350px]">
                <div className="border-b border-white/[0.07] bg-[linear-gradient(180deg,#efe6da_0%,#e8ddd0_100%)] p-4 text-[#16202a] xl:border-b-0 xl:border-r xl:border-white/[0.07] sm:p-5">
                  <SectionTitle number="1" title="CREATE" subtitle="Lyrics • Style • Artwork • Visuals • Social Pack" tone="create" />

                  <div className="mt-5 space-y-3">
                    <div className="rounded-[20px] border border-black/10 bg-white/70 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-black">Lyrics</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">Generate with AI or upload/paste your working lyrics.</p>
                        </div>
                        <StatusDot state={hasLyrics ? "ready" : "pending"} />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Link href="/music/legacy" className="rounded-xl bg-[#14283a] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0d1c29]">Generate Lyrics</Link>
                        <Link href="/music/legacy" className="rounded-xl border border-black/10 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50">Upload / Paste Lyrics</Link>
                      </div>
                    </div>

                    <div className="rounded-[20px] border border-black/10 bg-white/70 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-black">Music Direction</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">Suno style is generated from the lyrics, plus anything extra you want.</p>
                        </div>
                        <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-bold text-orange-700">Optional</span>
                      </div>
                      <textarea
                        value={additionalDirection}
                        onChange={(event) => setAdditionalDirection(event.target.value)}
                        placeholder="e.g. intimate 90s Bengali romantic song, warm strings, soft male vocals..."
                        rows={3}
                        className="mt-3 w-full resize-none rounded-2xl border border-black/10 bg-[#fffdf9] px-3 py-3 text-xs text-slate-700 outline-none placeholder:text-slate-400"
                      />
                      <p className="mt-1 text-right text-[10px] text-slate-400">{additionalDirection.length}/300</p>
                    </div>

                    <div className="rounded-[20px] border border-black/10 bg-white/70 p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-black">Prepare Everything</p>
                          <p className="mt-1 text-xs text-slate-500">One click to prepare the complete creative pack.</p>
                        </div>
                        <span className="text-xl">✦</span>
                      </div>
                      <div className="mt-4 space-y-2.5">
                        {creationAssets.map((asset) => (
                          <div key={asset.label} className="flex items-center gap-3 rounded-xl bg-black/[0.025] px-3 py-2.5">
                            <StatusDot state={asset.state} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold">{asset.label}</p>
                              <p className="truncate text-[10px] text-slate-500">{asset.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button className="mt-4 w-full rounded-2xl bg-gradient-to-r from-[#ffd68f] via-[#ff8e87] to-[#7e75ff] px-4 py-3 text-sm font-black text-[#2b1c24] shadow-[0_14px_32px_-18px_rgba(255,122,151,.7)]">✦ Prepare Everything</button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[20px] border border-emerald-600/15 bg-emerald-600/[0.06] p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400 font-black text-emerald-950">✓</span>
                      <div>
                        <p className="text-sm font-black text-emerald-900">READY FOR SUNO</p>
                        <p className="text-[10px] text-emerald-800/70">Copy your lyrics and style below and create the song in Suno.</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button className="rounded-xl bg-[#183147] px-3 py-2.5 text-xs font-bold text-white">Copy Lyrics</button>
                      <button className="rounded-xl bg-[#183147] px-3 py-2.5 text-xs font-bold text-white">Copy Suno Style</button>
                    </div>
                  </div>
                </div>

                <div className="border-b border-white/[0.07] bg-[linear-gradient(180deg,#0b2635,#0a1e2c)] p-4 xl:border-b-0 xl:border-r sm:p-5">
                  <SectionTitle number="2" title="RELEASE" subtitle="Audio • Videos • Review • Publish" tone="release" />

                  <div className="mt-5 rounded-[22px] border border-cyan-300/10 bg-white/[0.035] p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-black">Final Song</p>
                        <p className="mt-1 text-xs leading-5 text-zinc-400">Your finished Suno WAV/MP3 is the only thing Universe needs before video production.</p>
                      </div>
                      <span className="text-xl">♫</span>
                    </div>

                    {finalAudioLoading ? (
                      <div className="mt-4 rounded-2xl border border-white/[0.07] bg-black/10 px-4 py-6 text-center text-xs text-zinc-500">Checking this project for a finished song…</div>
                    ) : finalAudioAsset ? (
                      <div className="mt-4 overflow-hidden rounded-2xl border border-emerald-300/20 bg-emerald-300/[0.055]">
                        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-300/15 text-lg text-emerald-200">♪</div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="rounded-full bg-emerald-300 px-2 py-1 text-[9px] font-black text-emerald-950">FINAL SONG DETECTED</span>
                              </div>
                              <p className="mt-2 truncate text-sm font-bold">{finalAudioAsset.originalFilename || "Finished Suno song"}</p>
                              <p className="mt-1 text-[10px] text-zinc-500">{finalAudioAsset.storageProvider === "local" ? "Saved on this Mac" : "Saved in Universe"}</p>
                            </div>
                          </div>
                          <Link href="/music/legacy" className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-[10px] font-bold text-zinc-300">Replace</Link>
                        </div>
                        {finalAudioAsset.url && <audio controls className="w-full border-t border-white/[0.06] bg-black/10 px-3 py-2" src={finalAudioAsset.url} />}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-dashed border-cyan-200/25 bg-[radial-gradient(circle_at_50%_0%,rgba(95,226,224,.09),transparent_22rem),rgba(0,0,0,.08)] px-5 py-8 text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-cyan-100/20 bg-cyan-200/[0.05] text-lg">⇧</div>
                        <p className="mt-4 text-base font-black">Waiting for your finished Suno song</p>
                        <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-zinc-500">Upload it now, or later let the Universe Mac worker detect the file automatically from your project folder.</p>
                        <Link href="/music/legacy" className="mt-5 inline-flex rounded-xl bg-white px-4 py-2.5 text-xs font-black text-[#102332]">Choose Finished Song</Link>
                        <p className="mt-3 text-[10px] text-zinc-600">MP3 • WAV • M4A • AAC</p>
                      </div>
                    )}
                  </div>

                  {finalAudioAsset ? (
                    <>
                      <div className="mt-3 rounded-[22px] border border-fuchsia-300/15 bg-[linear-gradient(135deg,rgba(255,210,139,.08),rgba(218,84,216,.06))] p-4 sm:p-5">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-black">Create Release Videos</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-400">Universe will create 1 full 16:9 video and 6 different vertical shorts from your song and prepared visual assets.</p>
                          </div>
                          <span className="rounded-full border border-fuchsia-200/15 bg-fuchsia-200/[0.06] px-2.5 py-1 text-[9px] font-bold text-fuchsia-100">1 + 6</span>
                        </div>
                        <button className="mt-4 w-full rounded-2xl bg-gradient-to-r from-[#ffd68f] via-[#ff8d8d] to-[#d357db] px-4 py-4 text-sm font-black text-[#26171f] shadow-[0_14px_36px_-18px_rgba(239,88,183,.8)]">✦ Generate Full Video + 6 Shorts</button>
                      </div>

                      <div className="mt-3 rounded-[22px] border border-cyan-300/10 bg-white/[0.035] p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-black">Review • Edit • Approve</p>
                            <p className="mt-1 text-xs text-zinc-500">Preview everything. Change only what you want. Nothing publishes until you approve it.</p>
                          </div>
                          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10">▶</span>
                        </div>
                        <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
                          {["Full", "S1", "S2", "S3", "S4", "S5", "S6"].map((item, index) => (
                            <button key={item} className="group overflow-hidden rounded-xl border border-white/[0.08] bg-black/15 text-left">
                              <div className="relative aspect-[9/10] overflow-hidden bg-gradient-to-br from-[#1a3341] to-[#08141f]">
                                {activeArtwork ? <img src={activeArtwork} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55 transition group-hover:scale-105" /> : null}
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                <span className="absolute inset-0 flex items-center justify-center text-sm text-white/90">▶</span>
                              </div>
                              <div className="px-2 py-2">
                                <p className="text-[10px] font-bold">{item === "Full" ? "Full Video" : `Short ${index}`}</p>
                                <p className="mt-0.5 text-[9px] text-zinc-600">Ready after generation</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="mt-3 rounded-[22px] border border-cyan-300/10 bg-white/[0.035] p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-black">Publish</p>
                            <p className="mt-1 text-xs text-zinc-500">Approved videos will use the social pack already prepared in Create.</p>
                          </div>
                          <button className="rounded-xl bg-gradient-to-r from-[#ff9a84] to-[#e95ccf] px-4 py-2.5 text-xs font-black text-[#281321]">Publish Now</button>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          {[
                            ["YouTube", "youtube", "#ff3333"],
                            ["Instagram", "instagram", "#ff7aa7"],
                            ["Facebook", "facebook", "#4f8cff"],
                            ["TikTok", "tiktok", "#58e4df"],
                          ].map(([platform, key, color]) => {
                            const connected = connectedPlatforms.has(key);
                            return (
                              <div key={platform} className="rounded-xl border border-white/[0.07] bg-black/10 px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                                  <span className="text-[10px] font-bold">{platform}</span>
                                </div>
                                <p className={classNames("mt-1 text-[9px]", connected ? "text-emerald-300" : "text-zinc-600")}>{connected ? "Connected" : "Not connected"}</p>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3 rounded-[22px] border border-white/[0.06] bg-black/[0.09] p-5">
                      <div className="flex items-center gap-3 text-zinc-500">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08]">2</span>
                        <div>
                          <p className="text-sm font-bold text-zinc-400">Video creation will appear here</p>
                          <p className="mt-1 text-xs">Once your final song is available, Universe opens the video, shorts, review and publishing workflow automatically.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <aside className="bg-[#081522] p-4 sm:p-5">
                  <div className="rounded-[22px] border border-white/[0.08] bg-white/[0.035] p-4">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cyan-300/30 via-violet-400/30 to-orange-300/30">✦</span>
                      <div>
                        <p className="text-sm font-black">Universe Assistant</p>
                        <p className="text-[10px] text-zinc-500">Ask. Create. Refine.</p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {["Make a more nostalgic thumbnail", "Generate a different visual clip", "Change Short 2 to use the chorus", "Prepare for YouTube release"].map((text) => (
                        <button key={text} onClick={() => setAssistantPrompt(text)} className="block w-full rounded-xl bg-white/[0.045] px-3 py-2 text-left text-[10px] text-zinc-300 transition hover:bg-white/[0.08]">“{text}”</button>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input value={assistantPrompt} onChange={(event) => setAssistantPrompt(event.target.value)} placeholder="Type your request…" className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-xs outline-none placeholder:text-zinc-600" />
                      <button className="h-10 w-10 rounded-xl bg-cyan-300/20 text-cyan-200">➤</button>
                    </div>
                  </div>

                  <div className="mt-3 rounded-[22px] border border-white/[0.08] bg-white/[0.035] p-4">
                    <p className="text-sm font-black">Project Status</p>
                    <div className="mt-4 flex items-center gap-4">
                      <div className={classNames(
                        "relative flex h-20 w-20 items-center justify-center rounded-full",
                        finalAudioAsset
                          ? "bg-[conic-gradient(#6ee7df_0_72%,#ffd28a_72%_88%,rgba(255,255,255,.08)_88%_100%)]"
                          : "bg-[conic-gradient(#6ee7df_0_54%,#ffd28a_54%_70%,rgba(255,255,255,.08)_70%_100%)]"
                      )}>
                        <div className="flex h-[62px] w-[62px] items-center justify-center rounded-full bg-[#0b1824] text-lg font-black">{finalAudioAsset ? "88%" : "70%"}</div>
                      </div>
                      <div className="space-y-2 text-[10px]">
                        <p><span className="mr-2 text-emerald-300">●</span>Create</p>
                        <p><span className="mr-2 text-orange-200">●</span>Release</p>
                        <p><span className="mr-2 text-zinc-600">○</span>Publish</p>
                      </div>
                    </div>
                    <p className="mt-4 text-xs font-bold">Almost there!</p>
                    <p className="mt-1 text-[10px] leading-4 text-zinc-500">{finalAudioAsset ? "Final song detected. You can now generate the release videos." : "Add your final song to unlock video generation."}</p>
                  </div>

                  <div className="mt-3 rounded-[22px] border border-white/[0.08] bg-white/[0.035] p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-black">Connected Platforms</p>
                      <span className="text-[10px] text-cyan-300">Manage</span>
                    </div>
                    <div className="mt-3 space-y-2.5">
                      {[
                        ["YouTube", "youtube"],
                        ["Instagram", "instagram"],
                        ["Facebook", "facebook"],
                        ["TikTok", "tiktok"],
                      ].map(([label, key]) => {
                        const connected = connectedPlatforms.has(key);
                        return (
                          <div key={key} className="flex items-center justify-between text-xs">
                            <span>{label}</span>
                            <span className={classNames(
                              "rounded-full px-2 py-1 text-[9px] font-bold",
                              connected ? "bg-emerald-300/10 text-emerald-300" : "bg-white/[0.05] text-zinc-500"
                            )}>{connected ? "Connected" : "Not connected"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-3 rounded-[22px] border border-orange-200/20 bg-[#f6eee2] p-5 text-[#30231d]">
                    <p className="font-serif text-2xl italic leading-8">Better Music<br />Happier People ♡</p>
                  </div>
                </aside>
              </div>
            </section>
          </div>
        </main>
      </div>

      {showNewSong && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#02070d]/75 p-4 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-[30px] border border-white/[0.10] bg-[#0a1723] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">New Song</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">How do you want to begin?</h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">Universe supports both workflows: create lyrics here or bring lyrics you already love.</p>
              </div>
              <button onClick={() => setShowNewSong(false)} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-zinc-400">×</button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Link href="/music/legacy" className="rounded-[22px] border border-orange-200/20 bg-gradient-to-br from-orange-200/[0.10] to-transparent p-5 transition hover:border-orange-200/40">
                <span className="text-2xl">✦</span>
                <p className="mt-4 text-lg font-black">Generate Lyrics</p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">Start with an idea, language, mood and genre.</p>
              </Link>
              <Link href="/music/legacy" className="rounded-[22px] border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.08] to-transparent p-5 transition hover:border-cyan-200/40">
                <span className="text-2xl">▤</span>
                <p className="mt-4 text-lg font-black">Upload / Paste Lyrics</p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">Bring your working lyrics and let Universe build everything around them.</p>
              </Link>
            </div>
            <p className="mt-5 text-center text-[10px] text-zinc-600">Frontend shell only for now — existing Studio tools remain unchanged underneath.</p>
          </div>
        </div>
      )}
    </div>
  );
}
