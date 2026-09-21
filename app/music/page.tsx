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
  hooks?: string[];
  selectedHook?: string | null;
};

type SunoStyle = {
  name: string;
  category: string;
  recommended: boolean;
  whyItFits: string;
  prompt: string;
};

type NewSongMode = "choose" | "generate" | "import";

type GeneratedHookState = {
  projectId: string;
  hooks: string[];
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

type VisualConcept = {
  id: string;
  conceptNumber: number;
  title: string;
  description: string;
  imagePrompt: string;
  selected?: boolean;
};

type PreparedImage = {
  id: string;
  conceptId?: string | null;
  imageSetId?: string | null;
  imageSetNumber?: number | null;
  imageSetIsCurrent?: boolean;
  format: string;
  imageNumber: number;
  url: string;
};

type SocialReadiness = {
  youtubeFull: boolean;
  youtubeShorts: boolean;
  facebook: boolean;
  instagram: boolean;
  tiktok: boolean;
};

type ShotBrief = {
  imageNumber: number;
  role: string;
  brief: string;
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

async function requestJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, init);
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status}).`);
  }
  return data as T;
}

async function optionalJson(input: RequestInfo | URL) {
  try {
    const response = await fetch(input, { cache: "no-store" });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
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
  if (raw.includes("ready-for-suno")) return "Ready for Suno";
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
  const [sunoStyles, setSunoStyles] = useState<SunoStyle[]>([]);
  const [sunoStylesLoading, setSunoStylesLoading] = useState(false);
  const [sunoStylesError, setSunoStylesError] = useState("");
  const [selectedStyleIndex, setSelectedStyleIndex] = useState(0);
  const [copyNotice, setCopyNotice] = useState("");
  const [visualConcepts, setVisualConcepts] = useState<VisualConcept[]>([]);
  const [selectedVisualConceptId, setSelectedVisualConceptId] = useState<string | null>(null);
  const [preparedImages, setPreparedImages] = useState<PreparedImage[]>([]);
  const [socialReadiness, setSocialReadiness] = useState<SocialReadiness>({
    youtubeFull: false,
    youtubeShorts: false,
    facebook: false,
    instagram: false,
    tiktok: false,
  });
  const [preparedAssetsLoading, setPreparedAssetsLoading] = useState(false);
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [prepareStep, setPrepareStep] = useState("");
  const [prepareError, setPrepareError] = useState("");

  const [newSongMode, setNewSongMode] = useState<NewSongMode>("choose");
  const [newSongBusy, setNewSongBusy] = useState(false);
  const [newSongError, setNewSongError] = useState("");
  const [generatedHookState, setGeneratedHookState] = useState<GeneratedHookState | null>(null);
  const [selectedGeneratedHook, setSelectedGeneratedHook] = useState("");

  const [generateIdea, setGenerateIdea] = useState("");
  const [generateLanguage, setGenerateLanguage] = useState("Bengali");
  const [generateScript, setGenerateScript] = useState("Native");
  const [generateMood, setGenerateMood] = useState("Romantic");
  const [generateGenre, setGenerateGenre] = useState("Modern melodic song");

  const [importTitle, setImportTitle] = useState("");
  const [importLyrics, setImportLyrics] = useState("");
  const [importLanguage, setImportLanguage] = useState("Bengali");
  const [importMood, setImportMood] = useState("");
  const [importGenre, setImportGenre] = useState("");

  async function loadProjects(preferredProjectId?: string) {
    try {
      setLoading(true);
      const response = await fetch("/api/songs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Could not load songs.");
      }
      const nextProjects = Array.isArray(data.projects) ? data.projects : [];
      setProjects(nextProjects);
      setActiveProjectId((current) => {
        if (preferredProjectId && nextProjects.some((project: SongProject) => project.id === preferredProjectId)) {
          return preferredProjectId;
        }
        if (current && nextProjects.some((project: SongProject) => project.id === current)) {
          return current;
        }
        return nextProjects[0]?.id || null;
      });
    } catch (error) {
      console.error("Could not load songs", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setAccountEmail(data.user?.email ?? "");
    });
  }, []);

  useEffect(() => {
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

  useEffect(() => {
    if (!activeProjectId) {
      setAdditionalDirection("");
      return;
    }
    try {
      setAdditionalDirection(localStorage.getItem(`szu:music-direction:${activeProjectId}`) || "");
    } catch {
      setAdditionalDirection("");
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setSunoStyles([]);
      setSelectedStyleIndex(0);
      return;
    }

    let cancelled = false;
    async function loadSunoStyles() {
      try {
        setSunoStylesLoading(true);
        setSunoStylesError("");
        const response = await fetch(`/api/suno-styles?projectId=${encodeURIComponent(activeProjectId!)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load Suno styles.");
        if (!cancelled) {
          const nextStyles = Array.isArray(data.styles) ? data.styles : [];
          setSunoStyles(nextStyles);
          const recommendedIndex = nextStyles.findIndex((style: SunoStyle) => style.recommended);
          setSelectedStyleIndex(recommendedIndex >= 0 ? recommendedIndex : 0);
        }
      } catch (error) {
        if (!cancelled) {
          setSunoStyles([]);
          setSunoStylesError(error instanceof Error ? error.message : "Could not load Suno styles.");
        }
      } finally {
        if (!cancelled) setSunoStylesLoading(false);
      }
    }

    void loadSunoStyles();
    return () => { cancelled = true; };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setVisualConcepts([]);
      setSelectedVisualConceptId(null);
      setPreparedImages([]);
      setSocialReadiness({
        youtubeFull: false,
        youtubeShorts: false,
        facebook: false,
        instagram: false,
        tiktok: false,
      });
      return;
    }

    let cancelled = false;

    async function loadPreparedAssets() {
      try {
        setPreparedAssetsLoading(true);

        const [conceptData, imageData, youtubeFullData, youtubeShortsData, platformData] =
          await Promise.all([
            optionalJson(`/api/image-concepts?projectId=${encodeURIComponent(activeProjectId!)}`),
            optionalJson(`/api/generate-image?projectId=${encodeURIComponent(activeProjectId!)}`),
            optionalJson(`/api/social-media/youtube-full?projectId=${encodeURIComponent(activeProjectId!)}`),
            optionalJson(`/api/social-media/youtube-shorts?projectId=${encodeURIComponent(activeProjectId!)}`),
            optionalJson(`/api/social-media/platform-pack?projectId=${encodeURIComponent(activeProjectId!)}`),
          ]);

        if (cancelled) return;

        const concepts = Array.isArray(conceptData?.concepts)
          ? conceptData.concepts
          : [];
        const images = Array.isArray(imageData?.images)
          ? imageData.images
          : [];

        setVisualConcepts(concepts);
        setSelectedVisualConceptId(
          conceptData?.selectedConceptId ||
            concepts.find((concept: VisualConcept) => concept.selected)?.id ||
            null
        );
        setPreparedImages(images);
        setSocialReadiness({
          youtubeFull: Boolean(youtubeFullData?.youtubeFull),
          youtubeShorts: Boolean(youtubeShortsData?.youtubeShorts),
          facebook: Boolean(platformData?.facebook),
          instagram: Boolean(platformData?.instagram),
          tiktok: Boolean(platformData?.tiktok),
        });

        const preferredArtwork =
          images.find((image: PreparedImage) => image.format === "youtube" && image.imageNumber === 1)?.url ||
          images.find((image: PreparedImage) => image.format === "youtube")?.url ||
          images.find((image: PreparedImage) => image.format === "shorts")?.url ||
          "";

        if (preferredArtwork) {
          setArtworkByProject((current) => ({
            ...current,
            [activeProjectId!]: preferredArtwork,
          }));
        }
      } finally {
        if (!cancelled) setPreparedAssetsLoading(false);
      }
    }

    void loadPreparedAssets();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId]);

  function openNewSong(mode: NewSongMode = "choose") {
    setNewSongMode(mode);
    setNewSongError("");
    setGeneratedHookState(null);
    setSelectedGeneratedHook("");
    setShowNewSong(true);
  }

  function closeNewSong() {
    setShowNewSong(false);
    setNewSongMode("choose");
    setNewSongError("");
    setGeneratedHookState(null);
    setSelectedGeneratedHook("");
  }

  async function handleGenerateHooks() {
    if (!generateIdea.trim()) {
      setNewSongError("Tell Universe what the song should be about.");
      return;
    }
    try {
      setNewSongBusy(true);
      setNewSongError("");
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: generateIdea.trim(),
          language: generateLanguage,
          script: generateScript,
          mood: generateMood.trim(),
          genre: generateGenre.trim(),
          freedom: 55,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate lyric hooks.");
      const hooks = Array.isArray(data.hooks) ? data.hooks : [];
      if (!data.projectId || hooks.length !== 3) throw new Error("Universe did not return three usable hooks.");
      setGeneratedHookState({ projectId: data.projectId, hooks });
      setSelectedGeneratedHook(hooks[0] || "");
      await loadProjects(data.projectId);
    } catch (error) {
      setNewSongError(error instanceof Error ? error.message : "Could not generate lyric hooks.");
    } finally {
      setNewSongBusy(false);
    }
  }

  async function handleGenerateFullLyrics() {
    if (!generatedHookState || !selectedGeneratedHook.trim()) return;
    try {
      setNewSongBusy(true);
      setNewSongError("");

      const selectResponse = await fetch("/api/select-hook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: generatedHookState.projectId,
          selectedHook: selectedGeneratedHook,
        }),
      });
      const selectData = await selectResponse.json();
      if (!selectResponse.ok) throw new Error(selectData.error || "Could not save the selected hook.");

      const songResponse = await fetch("/api/generate-song", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: generatedHookState.projectId }),
      });
      const songData = await songResponse.json();
      if (!songResponse.ok) throw new Error(songData.error || "Could not generate the full lyrics.");

      await loadProjects(generatedHookState.projectId);
      setActiveProjectId(generatedHookState.projectId);
      closeNewSong();
    } catch (error) {
      setNewSongError(error instanceof Error ? error.message : "Could not generate the full lyrics.");
    } finally {
      setNewSongBusy(false);
    }
  }

  async function handleImportLyrics() {
    if (!importTitle.trim() || !importLyrics.trim()) {
      setNewSongError("Add a song title and the complete lyrics.");
      return;
    }
    try {
      setNewSongBusy(true);
      setNewSongError("");
      const response = await fetch("/api/import-lyrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: importTitle.trim(),
          lyrics: importLyrics.trim(),
          language: importLanguage,
          script: "Native",
          mood: importMood.trim(),
          genre: importGenre.trim(),
          idea: "",
          freedom: 50,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not import the lyrics.");
      const projectId = String(data.projectId || data.project?.id || "");
      await loadProjects(projectId || undefined);
      if (projectId) setActiveProjectId(projectId);
      setImportTitle("");
      setImportLyrics("");
      setImportMood("");
      setImportGenre("");
      closeNewSong();
    } catch (error) {
      setNewSongError(error instanceof Error ? error.message : "Could not import the lyrics.");
    } finally {
      setNewSongBusy(false);
    }
  }

  async function handleGenerateSunoStyles() {
    if (!activeProjectId) {
      setSunoStylesError("Create or select a song first.");
      return;
    }
    try {
      setSunoStylesLoading(true);
      setSunoStylesError("");
      try {
        localStorage.setItem(`szu:music-direction:${activeProjectId}`, additionalDirection.trim());
      } catch {}
      const response = await fetch("/api/suno-styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          additionalDirection: additionalDirection.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate Suno styles.");
      const nextStyles = Array.isArray(data.styles) ? data.styles : [];
      setSunoStyles(nextStyles);
      const recommendedIndex = nextStyles.findIndex((style: SunoStyle) => style.recommended);
      setSelectedStyleIndex(recommendedIndex >= 0 ? recommendedIndex : 0);
      await loadProjects(activeProjectId);
    } catch (error) {
      setSunoStylesError(error instanceof Error ? error.message : "Could not generate Suno styles.");
    } finally {
      setSunoStylesLoading(false);
    }
  }

  async function handlePrepareEverything() {
    if (!activeProjectId || !hasLyrics) {
      setPrepareError("Add or generate lyrics first.");
      return;
    }

    try {
      setPrepareBusy(true);
      setPrepareError("");
      setPrepareStep("Starting your creative pack…");

      try {
        localStorage.setItem(
          `szu:music-direction:${activeProjectId}`,
          additionalDirection.trim()
        );
      } catch {}

      let workingStyles = sunoStyles;
      if (!workingStyles.length) {
        setPrepareStep("Creating the Suno music direction…");
        const styleData = await requestJson<{ styles?: SunoStyle[] }>(
          "/api/suno-styles",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: activeProjectId,
              additionalDirection: additionalDirection.trim(),
            }),
          }
        );
        workingStyles = Array.isArray(styleData.styles) ? styleData.styles : [];
        setSunoStyles(workingStyles);
        const recommendedIndex = workingStyles.findIndex((style) => style.recommended);
        setSelectedStyleIndex(recommendedIndex >= 0 ? recommendedIndex : 0);
      }

      const workingSelectedStyle =
        workingStyles[selectedStyleIndex] ||
        workingStyles.find((style) => style.recommended) ||
        workingStyles[0] ||
        null;

      let concepts = visualConcepts;
      let conceptId = selectedVisualConceptId;

      if (!conceptId) {
        if (!concepts.length) {
          setPrepareStep("Designing three visual worlds from the lyrics…");
          const conceptData = await requestJson<{ concepts?: VisualConcept[] }>(
            "/api/image-concepts",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: activeProjectId,
                userIdeas: [
                  additionalDirection.trim()
                    ? `Additional music direction: ${additionalDirection.trim()}`
                    : "",
                  workingSelectedStyle?.prompt
                    ? `Chosen Suno production direction: ${workingSelectedStyle.prompt}`
                    : "",
                  "Let the visual world complement the music while remaining faithful to the lyric meaning.",
                ]
                  .filter(Boolean)
                  .join("\n\n"),
              }),
            }
          );
          concepts = Array.isArray(conceptData.concepts) ? conceptData.concepts : [];
          setVisualConcepts(concepts);
        }

        const chosenConcept = concepts[0];
        if (!chosenConcept?.id) {
          throw new Error("Universe could not create a usable visual concept.");
        }

        conceptId = chosenConcept.id;
        setPrepareStep(`Using visual direction: ${chosenConcept.title}`);
        await requestJson("/api/image-concepts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProjectId,
            conceptId,
          }),
        });
        setSelectedVisualConceptId(conceptId);
      }

      let images = preparedImages.filter(
        (image) => image.conceptId === conceptId || !image.conceptId
      );

      let imageSetId =
        images.find(
          (image) => image.imageSetId && image.imageSetIsCurrent !== false
        )?.imageSetId || null;

      if (!imageSetId) {
        setPrepareStep("Preparing the artwork generation set…");
        const setData = await requestJson<any>("/api/image-sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProjectId,
            conceptId,
            format: "youtube",
          }),
        });
        imageSetId = setData?.imageSet?.id || null;
      }

      if (!imageSetId) {
        throw new Error("Universe could not prepare the artwork set.");
      }

      const currentLandscapeNumbers = new Set(
        images
          .filter(
            (image) =>
              image.format === "youtube" &&
              image.imageSetId === imageSetId
          )
          .map((image) => image.imageNumber)
      );

      const missingLandscape = [1, 2, 3].filter(
        (number) => !currentLandscapeNumbers.has(number)
      );

      if (missingLandscape.length) {
        setPrepareStep("Creating cinematic artwork and YouTube thumbnail…");
        const briefData = await requestJson<{ briefs?: ShotBrief[] }>(
          "/api/image-shot-briefs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: activeProjectId,
              conceptId,
              format: "youtube",
            }),
          }
        );
        const briefs = Array.isArray(briefData.briefs) ? briefData.briefs : [];

        const generated = await Promise.all(
          missingLandscape.map(async (imageNumber) => {
            const shotBrief =
              briefs.find((brief) => brief.imageNumber === imageNumber)?.brief || "";
            const data = await requestJson<any>("/api/generate-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                projectId: activeProjectId,
                conceptId,
                imageSetId,
                format: "youtube",
                imageNumber,
                shotBrief,
                imageUseSongTitle: imageNumber === 1,
                imageIncludeBranding: imageNumber === 1,
                imageTextPosition: "bottom",
                imageFontStyle: "elegant",
                imageFontSize: "large",
              }),
            });
            return data.image as PreparedImage;
          })
        );

        images = [
          ...images.filter(
            (image) =>
              !(
                image.format === "youtube" &&
                image.imageSetId === imageSetId &&
                missingLandscape.includes(image.imageNumber)
              )
          ),
          ...generated.map((image) => ({ ...image, imageSetIsCurrent: true })),
        ];
        setPreparedImages(images);
      }

      const currentVerticalNumbers = new Set(
        images
          .filter(
            (image) =>
              image.format === "shorts" &&
              image.imageSetId === imageSetId
          )
          .map((image) => image.imageNumber)
      );
      const missingVertical = [1, 2, 3, 4, 5, 6].filter(
        (number) => !currentVerticalNumbers.has(number)
      );

      if (missingVertical.length) {
        setPrepareStep("Planning six vertical scenes for Shorts, Reels and TikTok…");
        const briefData = await requestJson<{ briefs?: ShotBrief[] }>(
          "/api/image-shot-briefs",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: activeProjectId,
              conceptId,
              format: "shorts",
            }),
          }
        );
        const briefs = Array.isArray(briefData.briefs) ? briefData.briefs : [];

        for (let start = 0; start < missingVertical.length; start += 2) {
          const batch = missingVertical.slice(start, start + 2);
          setPrepareStep(
            `Creating vertical visual scenes ${start + 1}–${Math.min(
              start + batch.length,
              missingVertical.length
            )} of ${missingVertical.length}…`
          );
          const generated = await Promise.all(
            batch.map(async (imageNumber) => {
              const shotBrief =
                briefs.find((brief) => brief.imageNumber === imageNumber)?.brief || "";
              const data = await requestJson<any>("/api/generate-image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  projectId: activeProjectId,
                  conceptId,
                  imageSetId,
                  format: "shorts",
                  imageNumber,
                  shotBrief,
                  imageUseSongTitle: false,
                  imageIncludeBranding: false,
                }),
              });
              return data.image as PreparedImage;
            })
          );
          images = [
            ...images.filter(
              (image) =>
                !(
                  image.format === "shorts" &&
                  image.imageSetId === imageSetId &&
                  batch.includes(image.imageNumber)
                )
            ),
            ...generated.map((image) => ({ ...image, imageSetIsCurrent: true })),
          ];
          setPreparedImages([...images]);
        }
      }

      const guidance = [
        additionalDirection.trim(),
        workingSelectedStyle?.name
          ? `Chosen music direction: ${workingSelectedStyle.name}. ${workingSelectedStyle.whyItFits}`
          : "",
        "Keep the social copy natural, emotionally specific and true to the lyrics. Avoid generic AI wording.",
      ]
        .filter(Boolean)
        .join("\n\n");

      let nextSocial = { ...socialReadiness };

      if (!nextSocial.youtubeFull) {
        setPrepareStep("Writing the YouTube full-release pack…");
        await requestJson("/api/social-media/youtube-full", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProjectId,
            generatorGuidance: guidance,
            releaseDetails: {
              releaseType: "Official Music Video",
              artistBrand: "Suno Zara",
              lyricsCredit: "Music & Lyrics – Debottom Das",
              producerCredit: "Producer – Suno Zara",
              preferredPlaylist: "",
              includeAiDisclosure: false,
              aiDisclosureDetails: "",
              descriptionLinks: "",
            },
          }),
        });
        nextSocial.youtubeFull = true;
        setSocialReadiness({ ...nextSocial });
      }

      if (!nextSocial.youtubeShorts) {
        setPrepareStep("Writing the YouTube Shorts pack and hook plans…");
        await requestJson("/api/social-media/youtube-shorts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProjectId,
            generatorGuidance: guidance,
          }),
        });
        nextSocial.youtubeShorts = true;
        setSocialReadiness({ ...nextSocial });
      }

      if (!nextSocial.facebook || !nextSocial.instagram || !nextSocial.tiktok) {
        setPrepareStep("Writing Facebook, Instagram and TikTok packs…");
        await requestJson("/api/social-media/platform-pack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: activeProjectId,
            generatorGuidance: guidance,
          }),
        });
        nextSocial = {
          ...nextSocial,
          facebook: true,
          instagram: true,
          tiktok: true,
        };
        setSocialReadiness(nextSocial);
      }

      await requestJson("/api/songs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProjectId,
          status: "ready-for-suno",
        }),
      });

      const heroArtwork =
        images.find(
          (image) =>
            image.format === "youtube" &&
            image.imageNumber === 1 &&
            image.imageSetId === imageSetId
        )?.url || "";
      if (heroArtwork) {
        setArtworkByProject((current) => ({
          ...current,
          [activeProjectId]: heroArtwork,
        }));
      }

      await loadProjects(activeProjectId);
      setPrepareStep("Everything is prepared ✓");
    } catch (error) {
      setPrepareError(
        error instanceof Error
          ? error.message
          : "Universe could not finish the creative pack."
      );
    } finally {
      setPrepareBusy(false);
    }
  }

  async function copyText(text: string, notice: string) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(notice);
      window.setTimeout(() => setCopyNotice(""), 1800);
    } catch {
      setCopyNotice("Copy failed — select the text manually.");
    }
  }

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
  const selectedSunoStyle = sunoStyles[selectedStyleIndex] || sunoStyles[0] || null;
  const hasSunoStyle = Boolean(sunoStyles.length);
  const currentPreparedImages = preparedImages.filter(
    (image) => image.imageSetIsCurrent !== false
  );
  const landscapeImages = currentPreparedImages.filter(
    (image) => image.format === "youtube"
  );
  const verticalImages = currentPreparedImages.filter(
    (image) => image.format === "shorts"
  );
  const artworkReady = landscapeImages.length >= 3 && verticalImages.length >= 1;
  const visualPackReady = verticalImages.length >= 6;
  const socialPackReady =
    socialReadiness.youtubeFull &&
    socialReadiness.youtubeShorts &&
    socialReadiness.facebook &&
    socialReadiness.instagram &&
    socialReadiness.tiktok;
  const readyForSuno =
    hasLyrics &&
    hasSunoStyle &&
    artworkReady &&
    visualPackReady &&
    socialPackReady;
  const connectedPlatforms = useMemo(() => {
    const connected = new Set(
      connections.filter((item) => item.status === "connected").map((item) => item.platform.toLowerCase())
    );
    return connected;
  }, [connections]);

  const creationAssets: Array<{ label: string; detail: string; state: AssetState }> = [
    { label: "Lyrics", detail: hasLyrics ? "Lyrics available" : "Generate or upload lyrics", state: hasLyrics ? "ready" : "pending" },
    { label: "Suno Style", detail: hasSunoStyle ? `${sunoStyles.length} styles ready` : "Lyrics + optional creative direction", state: hasSunoStyle ? "ready" : "pending" },
    {
      label: "Artwork & Thumbnails",
      detail: artworkReady
        ? `${landscapeImages.length} landscape • ${verticalImages.length} vertical`
        : preparedAssetsLoading
        ? "Checking saved visual assets…"
        : "Cinematic artwork • YouTube thumbnail • vertical visuals",
      state: artworkReady ? "ready" : "pending",
    },
    {
      label: "Clip-ready Visuals",
      detail: visualPackReady
        ? "6 vertical scenes + motion directions ready"
        : "6 short-form scenes prepared for the Release video engine",
      state: visualPackReady ? "ready" : "pending",
    },
    {
      label: "Social Media Pack",
      detail: socialPackReady
        ? "YouTube • Shorts • Instagram • Facebook • TikTok"
        : "Titles • descriptions • captions • hashtags • short hooks",
      state: socialPackReady ? "ready" : "pending",
    },
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
                  onClick={() => openNewSong("choose")}
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
                  onClick={() => openNewSong("choose")}
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
                        <button onClick={() => openNewSong("generate")} className="rounded-xl bg-[#14283a] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#0d1c29]">Generate Lyrics</button>
                        <button onClick={() => openNewSong("import")} className="rounded-xl border border-black/10 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50">Upload / Paste Lyrics</button>
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
                        onChange={(event) => {
                          const nextValue = event.target.value.slice(0, 300);
                          setAdditionalDirection(nextValue);
                          if (activeProjectId) {
                            try { localStorage.setItem(`szu:music-direction:${activeProjectId}`, nextValue); } catch {}
                          }
                        }}
                        placeholder="e.g. intimate 90s Bengali romantic song, warm strings, soft male vocals..."
                        rows={3}
                        maxLength={300}
                        className="mt-3 w-full resize-none rounded-2xl border border-black/10 bg-[#fffdf9] px-3 py-3 text-xs text-slate-700 outline-none placeholder:text-slate-400"
                      />
                      <p className="mt-1 text-right text-[10px] text-slate-400">{additionalDirection.length}/300</p>
                      <button
                        type="button"
                        disabled={!hasLyrics || sunoStylesLoading}
                        onClick={() => void handleGenerateSunoStyles()}
                        className="mt-3 w-full rounded-xl bg-[#14283a] px-4 py-2.5 text-xs font-black text-white transition hover:bg-[#0d1c29] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {sunoStylesLoading ? "Generating Suno styles…" : hasSunoStyle ? "Regenerate Suno Styles" : "Generate Suno Styles"}
                      </button>
                      {sunoStylesError && <p className="mt-2 text-[10px] font-semibold text-rose-700">{sunoStylesError}</p>}
                    </div>

                    {hasSunoStyle && (
                      <div className="rounded-[20px] border border-black/10 bg-white/70 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-black">Suno Styles</p>
                            <p className="mt-1 text-xs text-slate-500">Choose the direction you want to take into Suno.</p>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{sunoStyles.length} ready</span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {sunoStyles.map((style, index) => (
                            <button
                              key={`${style.name}-${index}`}
                              type="button"
                              onClick={() => setSelectedStyleIndex(index)}
                              className={classNames(
                                "w-full rounded-2xl border p-3 text-left transition",
                                selectedStyleIndex === index
                                  ? "border-[#1b5164]/35 bg-[#e8f3f4] shadow-sm"
                                  : "border-black/[0.07] bg-[#fffdf9] hover:border-black/15"
                              )}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-xs font-black text-slate-800">{style.name}</p>
                                <div className="flex items-center gap-1.5">
                                  {style.recommended && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[9px] font-black text-orange-700">Recommended</span>}
                                  <span className="text-[9px] font-bold text-slate-400">{style.category}</span>
                                </div>
                              </div>
                              <p className="mt-1.5 text-[10px] leading-4 text-slate-500">{style.whyItFits}</p>
                              {selectedStyleIndex === index && (
                                <p className="mt-2 line-clamp-3 rounded-xl bg-white/80 px-3 py-2 text-[10px] leading-4 text-slate-600">{style.prompt}</p>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

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
                      <button
                        type="button"
                        disabled={!hasLyrics || prepareBusy || readyForSuno}
                        onClick={() => void handlePrepareEverything()}
                        className="mt-4 w-full rounded-2xl bg-gradient-to-r from-[#ffd68f] via-[#ff8e87] to-[#7e75ff] px-4 py-3 text-sm font-black text-[#2b1c24] shadow-[0_14px_32px_-18px_rgba(255,122,151,.7)] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {prepareBusy
                          ? "✦ Universe is preparing everything…"
                          : readyForSuno
                          ? "✓ Everything Prepared"
                          : "✦ Prepare Everything"}
                      </button>
                      {prepareStep && (
                        <div className="mt-3 rounded-xl border border-[#ef9b8a]/20 bg-[#fff7ee] px-3 py-2.5 text-center text-[10px] font-bold text-[#8a4a42]">
                          {prepareBusy && <span className="mr-2 inline-block animate-pulse">●</span>}
                          {prepareStep}
                        </div>
                      )}
                      {prepareError && (
                        <div className="mt-3 rounded-xl border border-rose-300/50 bg-rose-50 px-3 py-2.5 text-[10px] font-semibold leading-4 text-rose-700">
                          {prepareError}
                          <span className="ml-1 font-normal">Anything already completed has been saved. Press Prepare Everything again to continue.</span>
                        </div>
                      )}
                      {preparedImages.length > 0 && (
                        <div className="mt-4">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Prepared visuals</p>
                            <span className="text-[9px] font-bold text-slate-400">{landscapeImages.length + verticalImages.length} images</span>
                          </div>
                          <div className="mt-2 grid grid-cols-4 gap-2">
                            {[...landscapeImages.slice(0, 2), ...verticalImages.slice(0, 2)].map((image) => (
                              <div key={image.id} className={classNames(
                                "relative overflow-hidden rounded-xl border border-black/10 bg-slate-100",
                                image.format === "shorts" ? "aspect-[3/4]" : "aspect-video"
                              )}>
                                <img src={image.url} alt="Prepared song visual" className="absolute inset-0 h-full w-full object-cover" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <p className="mt-3 text-center text-[9px] leading-4 text-slate-400">Creates the visual world, YouTube thumbnail, 6 clip-ready vertical scenes and the full social media pack. The finished moving videos are created in RELEASE after you add the final Suno song.</p>
                    </div>
                  </div>

                  <div className={classNames(
                    "mt-4 rounded-[20px] border p-4",
                    readyForSuno ? "border-emerald-600/15 bg-emerald-600/[0.06]" : "border-black/10 bg-black/[0.025]"
                  )}>
                    <div className="flex items-center gap-3">
                      <span className={classNames(
                        "flex h-8 w-8 items-center justify-center rounded-full font-black",
                        readyForSuno ? "bg-emerald-400 text-emerald-950" : "border border-black/10 bg-white text-slate-400"
                      )}>{readyForSuno ? "✓" : "·"}</span>
                      <div>
                        <p className={classNames("text-sm font-black", readyForSuno ? "text-emerald-900" : "text-slate-700")}>{readyForSuno ? "READY FOR SUNO" : "FINISH CREATE FIRST"}</p>
                        <p className={classNames("text-[10px]", readyForSuno ? "text-emerald-800/70" : "text-slate-500")}>{readyForSuno ? "Lyrics, style, visuals and social copy are saved. Copy the lyrics and chosen style below and create the final song in Suno." : "Add lyrics, then press Prepare Everything to complete the full Part 1 creative pack."}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button disabled={!hasLyrics} onClick={() => void copyText(activeProject?.lyrics || "", "Lyrics copied ✓")} className="rounded-xl bg-[#183147] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-35">Copy Lyrics</button>
                      <button disabled={!selectedSunoStyle} onClick={() => void copyText(selectedSunoStyle?.prompt || "", "Suno style copied ✓")} className="rounded-xl bg-[#183147] px-3 py-2.5 text-xs font-bold text-white disabled:opacity-35">Copy Suno Style</button>
                    </div>
                    {copyNotice && <p className="mt-2 text-center text-[10px] font-bold text-emerald-700">{copyNotice}</p>}
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
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-[30px] border border-white/[0.10] bg-[#0a1723] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">New Song</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.04em]">
                  {newSongMode === "choose" ? "How do you want to begin?" : newSongMode === "generate" ? "Generate Lyrics" : "Bring Your Lyrics"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  {newSongMode === "choose"
                    ? "Universe supports both workflows: create lyrics here or bring lyrics you already love."
                    : newSongMode === "generate"
                      ? "Start with the idea. Universe creates three hooks first, then builds the full song around the hook you choose."
                      : "Paste your working lyrics. Universe will build the Suno style and the rest of the creative pack around them."}
                </p>
              </div>
              <button disabled={newSongBusy} onClick={closeNewSong} className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-zinc-400 disabled:opacity-40">×</button>
            </div>

            {newSongMode === "choose" && (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button onClick={() => setNewSongMode("generate")} className="rounded-[22px] border border-orange-200/20 bg-gradient-to-br from-orange-200/[0.10] to-transparent p-5 text-left transition hover:border-orange-200/40">
                  <span className="text-2xl">✦</span>
                  <p className="mt-4 text-lg font-black">Generate Lyrics</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">Start with an idea, language, mood and genre.</p>
                </button>
                <button onClick={() => setNewSongMode("import")} className="rounded-[22px] border border-cyan-200/20 bg-gradient-to-br from-cyan-200/[0.08] to-transparent p-5 text-left transition hover:border-cyan-200/40">
                  <span className="text-2xl">▤</span>
                  <p className="mt-4 text-lg font-black">Upload / Paste Lyrics</p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">Bring your working lyrics and let Universe build everything around them.</p>
                </button>
              </div>
            )}

            {newSongMode === "generate" && (
              <div className="mt-6 space-y-4">
                {!generatedHookState ? (
                  <>
                    <label className="block">
                      <span className="text-xs font-bold text-zinc-300">Song idea</span>
                      <textarea value={generateIdea} onChange={(event) => setGenerateIdea(event.target.value)} rows={4} placeholder="e.g. A nostalgic Bengali romantic song about asking someone to return home…" className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none placeholder:text-zinc-600" />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-xs font-bold text-zinc-300">Language</span>
                        <select value={generateLanguage} onChange={(event) => setGenerateLanguage(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d1c29] px-3 py-3 text-sm outline-none">
                          {['Bengali','Hindi','English','Hinglish'].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold text-zinc-300">Script</span>
                        <select value={generateScript} onChange={(event) => setGenerateScript(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d1c29] px-3 py-3 text-sm outline-none">
                          <option value="Native">Native script</option>
                          <option value="Latin transliteration">Latin transliteration</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold text-zinc-300">Mood</span>
                        <input value={generateMood} onChange={(event) => setGenerateMood(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm outline-none" />
                      </label>
                      <label className="block">
                        <span className="text-xs font-bold text-zinc-300">Genre / starting direction</span>
                        <input value={generateGenre} onChange={(event) => setGenerateGenre(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm outline-none" />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={newSongBusy} onClick={() => setNewSongMode("choose")} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-zinc-300 disabled:opacity-40">Back</button>
                      <button disabled={newSongBusy} onClick={() => void handleGenerateHooks()} className="flex-1 rounded-xl bg-gradient-to-r from-[#ffd68f] via-[#ff8e87] to-[#e95ccf] px-4 py-2.5 text-xs font-black text-[#281321] disabled:opacity-45">{newSongBusy ? "Creating hooks…" : "Generate 3 Hooks"}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                      <p className="text-xs font-black text-orange-100">Choose the hook that feels right</p>
                      <div className="mt-3 space-y-2">
                        {generatedHookState.hooks.map((hook, index) => (
                          <button key={hook} onClick={() => setSelectedGeneratedHook(hook)} className={classNames("w-full rounded-2xl border p-3 text-left text-sm leading-6 transition", selectedGeneratedHook === hook ? "border-orange-200/45 bg-orange-200/[0.08] text-white" : "border-white/[0.08] bg-black/10 text-zinc-300 hover:border-white/20")}>
                            <span className="mr-2 text-[10px] font-black text-zinc-600">0{index + 1}</span>{hook}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={newSongBusy} onClick={() => setGeneratedHookState(null)} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-zinc-300 disabled:opacity-40">Try again</button>
                      <button disabled={newSongBusy || !selectedGeneratedHook} onClick={() => void handleGenerateFullLyrics()} className="flex-1 rounded-xl bg-gradient-to-r from-[#ffd68f] via-[#ff8e87] to-[#e95ccf] px-4 py-2.5 text-xs font-black text-[#281321] disabled:opacity-45">{newSongBusy ? "Writing the full song…" : "Use Hook & Write Full Song"}</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {newSongMode === "import" && (
              <div className="mt-6 space-y-4">
                <div className="grid gap-3 sm:grid-cols-[1.35fr_.65fr]">
                  <label className="block">
                    <span className="text-xs font-bold text-zinc-300">Song title</span>
                    <input value={importTitle} onChange={(event) => setImportTitle(event.target.value)} placeholder="Song title" className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm outline-none placeholder:text-zinc-600" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-zinc-300">Language</span>
                    <select value={importLanguage} onChange={(event) => setImportLanguage(event.target.value)} className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0d1c29] px-3 py-3 text-sm outline-none">
                      {['Bengali','Hindi','English','Hinglish'].map((value) => <option key={value} value={value}>{value}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs font-bold text-zinc-300">Complete lyrics</span>
                  <textarea value={importLyrics} onChange={(event) => setImportLyrics(event.target.value)} rows={12} placeholder="Paste the complete lyrics here…" className="mt-2 w-full resize-y rounded-2xl border border-white/10 bg-black/20 px-4 py-3 font-mono text-xs leading-6 outline-none placeholder:text-zinc-600" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-bold text-zinc-300">Mood <span className="font-normal text-zinc-600">optional</span></span>
                    <input value={importMood} onChange={(event) => setImportMood(event.target.value)} placeholder="Romantic, nostalgic…" className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm outline-none placeholder:text-zinc-600" />
                  </label>
                  <label className="block">
                    <span className="text-xs font-bold text-zinc-300">Genre / direction <span className="font-normal text-zinc-600">optional</span></span>
                    <input value={importGenre} onChange={(event) => setImportGenre(event.target.value)} placeholder="Acoustic, cinematic…" className="mt-2 w-full rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm outline-none placeholder:text-zinc-600" />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button disabled={newSongBusy} onClick={() => setNewSongMode("choose")} className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-zinc-300 disabled:opacity-40">Back</button>
                  <button disabled={newSongBusy} onClick={() => void handleImportLyrics()} className="flex-1 rounded-xl bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-300 px-4 py-2.5 text-xs font-black text-[#07111c] disabled:opacity-45">{newSongBusy ? "Saving lyrics…" : "Save Lyrics & Start Project"}</button>
                </div>
              </div>
            )}

            {newSongError && <div className="mt-4 rounded-2xl border border-rose-300/15 bg-rose-300/[0.06] px-4 py-3 text-xs font-semibold text-rose-200">{newSongError}</div>}
            <div className="mt-5 flex items-center justify-between gap-3 text-[10px] text-zinc-600">
              <span>Existing Studio remains available at /music/legacy.</span>
              {newSongMode !== "choose" && <button disabled={newSongBusy} onClick={() => setNewSongMode("choose")} className="font-bold text-zinc-400 hover:text-white disabled:opacity-40">Change method</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
