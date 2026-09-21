"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AccountMenu from "@/components/AccountMenu";
import PublicFooter from "@/components/PublicFooter";
import VerticalVideoManager from "@/components/VerticalVideoManager";
import FinalArtworkManager from "@/components/FinalArtworkManager";
import StudioSidebar from "@/components/StudioSidebar";
import StudioWorkspaceTabs from "@/components/StudioWorkspaceTabs";
import PublishingHub from "@/components/PublishingHub";
import { createClient } from "@/utils/supabase/client";
import * as tus from "tus-js-client";
import { uploadLocalMedia } from "@/utils/local-media-client";

type SongVersion = {
  index: number;
  savedAt?: string;
  type?: string;
  title?: string | null;
  lyrics: string;
  rewrittenSection?: string;
  instruction?: string;
  restoredFromVersion?: number;
};

type CriticIssue = {
  section?: string;
  line?: string;
  severity?: string;
  problem?: string;
  why?: string;
  suggestion?: string;
};

type StrongLine = {
  line?: string;
  why?: string;
};

type Critique = {
  createdAt?: string;
  songUpdatedAt?: string | null;
  score: number;
  verdict: string;
  strengths: string[];
  issues: CriticIssue[];
  strongLines: StrongLine[];
  priority: string[];
};

type LineAnalysis = {
  createdAt?: string;
  songUpdatedAt?: string | null;
  selectedText: string;
  line?: string;
  meaning: string;
  emotionalPurpose: string;
  flow: string;
  context: string;
  originality: string;
  singability: string;
  wordChoice: string;
  strongestLine: string;
  weakestLine: string;
  verdict: string;
  reason: string;
  alternatives: string[];
};

type SongProject = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  idea: string;
  language: string;
  script: string;
  mood: string;
  genre: string;
  freedom: number;
  hooks: string[];
  selectedHook: string | null;
  title?: string | null;
  lyrics: string | null;
  latestCritique?: Critique | null;
  latestLineAnalysis?: LineAnalysis | null;
};

type ParsedSection = {
  label: string;
  lines: string[];
};

type WorkspaceView =
  | "home"
  | "library"
  | "start"
  | "song"
  | "production"
  | "visuals"
  | "media"
  | "social"
  | "publish"
  | "analytics";

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  open,
  onToggle,
  badge,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="group flex w-full items-center justify-between gap-5 text-left"
    >
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-rose-300/75">
            {eyebrow}
          </p>

          {badge && (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-zinc-400">
              {badge}
            </span>
          )}
        </div>

        <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em] text-white sm:text-2xl">
          {title}
        </h2>

        {subtitle && (
          <p className="mt-2 text-zinc-400">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <span className="hidden text-sm text-zinc-500 sm:inline">
          {open ? "Collapse" : "Expand"}
        </span>

        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-lg text-zinc-300 transition group-hover:border-white/20 group-hover:bg-white/[0.06]">
          {open ? "⌄" : "›"}
        </span>
      </div>
    </button>
  );
}

export default function Home() {
  const [idea, setIdea] = useState("");
  const [language, setLanguage] = useState("Hindi");
  const [script, setScript] = useState("Native");
  const [mood, setMood] = useState("Emotional");
  const [genre, setGenre] = useState("Modern Bollywood");
  const [freedom, setFreedom] = useState(50);

  const [built, setBuilt] = useState(false);
  const [hooks, setHooks] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [projects, setProjects] = useState<SongProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  const [activeProjectId, setActiveProjectId] =
    useState<string | null>(null);

  const [selectedHook, setSelectedHook] =
    useState<string | null>(null);

  const [savingHook, setSavingHook] = useState(false);

  const [songTitle, setSongTitle] = useState("");
  const [lyrics, setLyrics] = useState("");

  const [generatingSong, setGeneratingSong] = useState(false);

  const [creationMode, setCreationMode] = useState<
    "generate" | "import"
  >("generate");

  const [importTitle, setImportTitle] = useState("");
  const [importLyrics, setImportLyrics] = useState("");
  const [importMood, setImportMood] = useState("");
  const [importGenre, setImportGenre] = useState("");

  const [importLoading, setImportLoading] = useState(false);
  const [activeProjectStatus, setActiveProjectStatus] =
    useState("");

  const [workspaceView, setWorkspaceView] =
    useState<WorkspaceView>("home");

  const [sunoStyles, setSunoStyles] = useState<
    {
      name: string;
      category: string;
      recommended: boolean;
      whyItFits: string;
      prompt: string;
    }[]
  >([]);
  const [sunoStylesLoading, setSunoStylesLoading] = useState(false);
  const [sunoStylesOpen, setSunoStylesOpen] = useState(false);
  const [sunoStylesError, setSunoStylesError] = useState("");
  const [copiedSunoStyleIndex, setCopiedSunoStyleIndex] =
    useState<number | null>(null);

  const [visualIdeas, setVisualIdeas] = useState("");

  const [imageCustomText, setImageCustomText] = useState("");
  const [imageUseSongTitle, setImageUseSongTitle] = useState(true);
  const [imageIncludeBranding, setImageIncludeBranding] =
    useState(true);
  const [imageFontStyle, setImageFontStyle] = useState<
    "minimal" | "elegant" | "cinematic" | "retro" | "handwritten"
  >("cinematic");

  const [imageFontSize, setImageFontSize] = useState<
    "small" | "medium" | "large" | "xlarge"
  >("medium");

  const [imageTextPosition, setImageTextPosition] = useState<
    "top" | "center" | "bottom"
  >("bottom");
  const [visualConcepts, setVisualConcepts] = useState<
    {
      id: string;
      conceptNumber: number;
      title: string;
      description: string;
      imagePrompt: string;
      selected: boolean;
    }[]
  >([]);
  const [visualConceptsLoading, setVisualConceptsLoading] =
    useState(false);
  const [imageStudioOpen, setImageStudioOpen] = useState(false);
  const [imageStudioError, setImageStudioError] = useState("");
  const [selectedVisualConceptId, setSelectedVisualConceptId] =
    useState<string | null>(null);

  const [generatedImages, setGeneratedImages] = useState<
    {
      id: string;
      songId?: string;
      conceptId: string;
      imageSetId?: string | null;
      imageSetNumber?: number | null;
      imageSetIsCurrent?: boolean;
      format: string;
      imageNumber: number;
      storagePath: string;
      createdAt?: string;
      url: string;
    }[]
  >([]);

  const [generatingImage, setGeneratingImage] = useState(false);
  const [generatingImageProgress, setGeneratingImageProgress] =
    useState("");


  const [mediaUploadOpen, setMediaUploadOpen] =
    useState(false);

  const [mediaStorageMode, setMediaStorageMode] =
    useState<"local" | "supabase">("local");

  const [finalAudioFile, setFinalAudioFile] =
    useState<File | null>(null);

  const [finalAudioAsset, setFinalAudioAsset] =
    useState<{
      id: string;
      songId: string;
      mediaKind: string;
      slot: number;
      originalFilename: string;
      storageProvider?: "local" | "supabase";
      storagePath?: string | null;
      localPath?: string | null;
      mimeType?: string | null;
      sizeBytes?: number | null;
      createdAt?: string;
      updatedAt?: string;
      url: string;
      downloadUrl?: string;
    } | null>(null);

  const [finalAudioLoading, setFinalAudioLoading] =
    useState(false);

  const [finalAudioUploading, setFinalAudioUploading] =
    useState(false);

  const [finalAudioError, setFinalAudioError] =
    useState("");

  const [finalAudioStatus, setFinalAudioStatus] =
    useState("");


  const [youtubeVideoFile, setYoutubeVideoFile] =
    useState<File | null>(null);

  const [youtubeVideoAsset, setYoutubeVideoAsset] =
    useState<{
      id: string;
      songId: string;
      mediaKind: string;
      slot: number;
      originalFilename: string;
      storageProvider?: "local" | "supabase";
      storagePath?: string | null;
      localPath?: string | null;
      mimeType?: string | null;
      sizeBytes?: number | null;
      createdAt?: string;
      updatedAt?: string;
      url: string;
      downloadUrl?: string;
    } | null>(null);

  const [youtubeVideoLoading, setYoutubeVideoLoading] =
    useState(false);

  const [youtubeVideoUploading, setYoutubeVideoUploading] =
    useState(false);

  const [youtubeVideoProgress, setYoutubeVideoProgress] =
    useState(0);

  const [youtubeVideoError, setYoutubeVideoError] =
    useState("");

  const [youtubeVideoStatus, setYoutubeVideoStatus] =
    useState("");

  const [socialMediaOpen, setSocialMediaOpen] = useState(false);
  const [youtubeFullLoading, setYoutubeFullLoading] = useState(false);
  const [youtubeFullError, setYoutubeFullError] = useState("");
  const [youtubeGeneratorGuidance, setYoutubeGeneratorGuidance] =
    useState("");

  const [youtubeReleaseType, setYoutubeReleaseType] =
    useState("Official Music Video");

  const [youtubeArtistBrand, setYoutubeArtistBrand] =
    useState("Suno Zara");

  const [youtubeLyricsCredit, setYoutubeLyricsCredit] =
    useState("");

  const [
    youtubeCompositionCredit,
    setYoutubeCompositionCredit,
  ] = useState("");

  const [youtubeProducerCredit, setYoutubeProducerCredit] =
    useState("");

  const [
    youtubePreferredPlaylist,
    setYoutubePreferredPlaylist,
  ] = useState("");

  const [
    youtubeIncludeAiDisclosure,
    setYoutubeIncludeAiDisclosure,
  ] = useState(false);

  const [
    youtubeAiDisclosureDetails,
    setYoutubeAiDisclosureDetails,
  ] = useState("");

  const [
    youtubeDescriptionLinks,
    setYoutubeDescriptionLinks,
  ] = useState("");

  const [copiedYouTubeField, setCopiedYouTubeField] =
    useState<string | null>(null);

  const [youtubePackSaving, setYoutubePackSaving] =
    useState(false);
  const [youtubePackDirty, setYoutubePackDirty] =
    useState(false);
  const [youtubePackSaveMessage, setYoutubePackSaveMessage] =
    useState("");

  const [youtubeFullPack, setYoutubeFullPack] = useState<{
    generatorGuidance?: string;
    releaseDetails?: {
      releaseType: string;
      artistBrand: string;
      lyricsCredit: string;
      compositionCredit: string;
      producerCredit: string;
      preferredPlaylist: string;
      includeAiDisclosure: boolean;
      aiDisclosureDetails: string;
      descriptionLinks: string;
    };
    recommendedTitle: string;
    whyRecommended: string;
    alternativeTitles: string[];
    thumbnailTextOptions: string[];
    openingDescription: string;
    fullDescription: string;
    finalDescription?: string;
    credits: string;
    aiDisclosure: string;
    hashtags: string[];
    tags: string[];
    seoKeywords: string[];
    pinnedComment: string;
    alternativePinnedComment: string;
    communityPost: string;
    informalCommunityPost: string;
    releasePost: string;
    playlistSuggestion: string;
    strongestLyricLines: string[];
    ctaOptions: string[];
    shortsBridgeCopy: string;
    filenameSuggestion: string;
    uploadChecklist: string[];
  } | null>(null);

  const [socialMediaTab, setSocialMediaTab] = useState<
    | "youtube-full"
    | "youtube-shorts"
    | "facebook"
    | "instagram"
    | "tiktok"
  >("youtube-full");

  const [
    youtubeShortsGeneratorGuidance,
    setYoutubeShortsGeneratorGuidance,
  ] = useState("");

  const [youtubeShortsLoading, setYoutubeShortsLoading] =
    useState(false);

  const [youtubeShortsError, setYoutubeShortsError] =
    useState("");

  const [youtubeShortsSaving, setYoutubeShortsSaving] =
    useState(false);

  const [youtubeShortsDirty, setYoutubeShortsDirty] =
    useState(false);

  const [youtubeShortsSaveMessage, setYoutubeShortsSaveMessage] =
    useState("");

  const [
    copiedYouTubeShortField,
    setCopiedYouTubeShortField,
  ] = useState<string | null>(null);

  const [
    youtubeShortsLoadedProjectId,
    setYoutubeShortsLoadedProjectId,
  ] = useState<string | null>(null);

  const [youtubeShortsPack, setYoutubeShortsPack] = useState<{
    generatorGuidance: string;
    shorts: {
      shortNumber: number;
      creativeAngle: string;
      lyricMoment: string;
      openingHook: string;
      title: string;
      description: string;
      hashtags: string[];
      tags: string[];
      pinnedComment: string;
      fullSongCta: string;
      visualDirection: string;
    }[];
  } | null>(null);

  const [platformGeneratorGuidance, setPlatformGeneratorGuidance] =
    useState("");

  const [platformPackLoading, setPlatformPackLoading] =
    useState(false);

  const [platformPackError, setPlatformPackError] =
    useState("");

  const [
    platformPacksLoadedProjectId,
    setPlatformPacksLoadedProjectId,
  ] = useState<string | null>(null);

  const [platformSaving, setPlatformSaving] = useState<
    "facebook" | "instagram" | "tiktok" | null
  >(null);

  const [platformDirty, setPlatformDirty] = useState({
    facebook: false,
    instagram: false,
    tiktok: false,
  });

  const [platformSaveMessage, setPlatformSaveMessage] = useState({
    facebook: "",
    instagram: "",
    tiktok: "",
  });

  const [copiedSocialField, setCopiedSocialField] =
    useState<string | null>(null);

  const [facebookPack, setFacebookPack] = useState<{
    generatorGuidance: string;
    mainReleasePost: string;
    shortReleasePost: string;
    emotionalStoryPost: string;
    engagementQuestions: string[];
    ctaOptions: string[];
    hashtags: string[];
    reels: {
      reelNumber: number;
      creativeAngle: string;
      openingHook: string;
      caption: string;
      hashtags: string[];
      engagementPrompt: string;
      fullSongCta: string;
    }[];
  } | null>(null);

  const [instagramPack, setInstagramPack] = useState<{
    generatorGuidance: string;
    feedCaption: string;
    shortCaption: string;
    storyTextIdeas: string[];
    ctaOptions: string[];
    hashtags: string[];
    reels: {
      reelNumber: number;
      creativeAngle: string;
      openingHook: string;
      caption: string;
      hashtags: string[];
      fullSongCta: string;
      visualDirection: string;
    }[];
  } | null>(null);

  const [tiktokPack, setTiktokPack] = useState<{
    generatorGuidance: string;
    posts: {
      postNumber: number;
      creativeAngle: string;
      lyricMoment: string;
      openingHook: string;
      caption: string;
      hashtags: string[];
      commentPrompt: string;
      fullSongCta: string;
      visualDirection: string;
    }[];
  } | null>(null);

  const [libraryFilter, setLibraryFilter] = useState("all");
  const [librarySearch, setLibrarySearch] = useState("");
  const [libraryProjectId, setLibraryProjectId] = useState("");

  const [rewriteSectionName, setRewriteSectionName] = useState("");
  const [rewriteInstruction, setRewriteInstruction] = useState("");
  const [rewritingSection, setRewritingSection] = useState(false);
  const [rewriteMessage, setRewriteMessage] = useState("");

  const [versions, setVersions] = useState<SongVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const [openVersionIndex, setOpenVersionIndex] =
    useState<number | null>(null);

  const [currentVersionOpen, setCurrentVersionOpen] =
    useState(false);

  const [restoringVersion, setRestoringVersion] =
    useState<number | null>(null);

  const [versionMessage, setVersionMessage] = useState("");

  const [critique, setCritique] =
    useState<Critique | null>(null);

  const [criticLoading, setCriticLoading] = useState(false);

  const [lineToAnalyse, setLineToAnalyse] = useState("");

  const [lineAnalysis, setLineAnalysis] =
    useState<LineAnalysis | null>(null);

  const [lineAnalysisLoading, setLineAnalysisLoading] =
    useState(false);

  const [selectedLyricSource, setSelectedLyricSource] =
    useState<{
      originalText: string;
      occurrenceIndex: number;
    } | null>(null);

  const [applyingAlternative, setApplyingAlternative] =
    useState(false);

  const [alternativeMessage, setAlternativeMessage] =
    useState("");

  const [hooksOpen, setHooksOpen] = useState(false);
  const [fullSongOpen, setFullSongOpen] = useState(false);
  const [criticOpen, setCriticOpen] = useState(false);
  const [whyLineOpen, setWhyLineOpen] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [libraryOpen, setLibraryOpen] = useState(true);

  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("workspace") === "publish") {
      setWorkspaceView("publish");
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();

    async function loadAccount() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      setAccountEmail(user?.email ?? "");
    }

    loadAccount();
  }, []);


  async function loadProjects() {
    try {
      setProjectsLoading(true);

      const response = await fetch("/api/songs", {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load songs."
        );
      }

      setProjects(
        Array.isArray(data.projects)
          ? data.projects
          : []
      );
    } catch (err) {
      console.error("Failed to load saved songs:", err);
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadVersionHistory(
    projectId?: string | null
  ) {
    const id = projectId || activeProjectId;

    if (!id) {
      setVersions([]);
      return;
    }

    try {
      setVersionsLoading(true);

      const response = await fetch(
        `/api/version-history?projectId=${encodeURIComponent(id)}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load version history."
        );
      }

      setVersions(
        Array.isArray(data.versions)
          ? data.versions
          : []
      );
    } catch (err) {
      console.error("Version history error:", err);
    } finally {
      setVersionsLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);


  useEffect(() => {
    setFinalAudioFile(null);
    setFinalAudioAsset(null);
    setFinalAudioError("");
    setFinalAudioStatus("");

    setYoutubeVideoFile(null);
    setYoutubeVideoAsset(null);
    setYoutubeVideoError("");
    setYoutubeVideoStatus("");
    setYoutubeVideoProgress(0);

    if (activeProjectId) {
      void loadFinalAudio(activeProjectId);
      void loadYoutubeVideo(activeProjectId);
    }
  }, [activeProjectId]);

  const filteredProjects = useMemo(() => {
    const hasFullLyrics = (project: SongProject) =>
      project.status === "song-generated" ||
      project.status === "lyrics-imported";

    let result = projects;

    if (libraryFilter === "full") {
      result = result.filter(hasFullLyrics);
    } else if (libraryFilter === "progress") {
      result = result.filter(
        (project) => !hasFullLyrics(project)
      );
    }

    const query = librarySearch.trim().toLowerCase();
    if (query) {
      result = result.filter((project) =>
        [
          project.title,
          project.idea,
          project.language,
          project.status,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query))
      );
    }

    return result;
  }, [projects, libraryFilter, librarySearch]);

  const sectionOptions = useMemo(() => {
    if (!lyrics) {
      return [];
    }

    const matches =
      lyrics.match(/^\[[^\]]+\]$/gm) || [];

    return Array.from(
      new Set(
        matches.map((section) =>
          section
            .replace(/^\[/, "")
            .replace(/\]$/, "")
            .trim()
        )
      )
    );
  }, [lyrics]);

  const parsedSong = useMemo<ParsedSection[]>(() => {
    if (!lyrics.trim()) {
      return [];
    }

    const rawLines = lyrics.split("\n");

    const sections: ParsedSection[] = [];

    let current: ParsedSection = {
      label: "Opening",
      lines: [],
    };

    for (const rawLine of rawLines) {
      const line = rawLine.trim();

      if (!line) {
        continue;
      }

      const sectionMatch =
        line.match(/^\[([^\]]+)\]$/);

      if (sectionMatch) {
        if (current.lines.length > 0) {
          sections.push(current);
        }

        current = {
          label: sectionMatch[1].trim(),
          lines: [],
        };

        continue;
      }

      current.lines.push(line);
    }

    if (current.lines.length > 0) {
      sections.push(current);
    }

    return sections;
  }, [lyrics]);

  useEffect(() => {
    if (
      rewriteSectionName &&
      !sectionOptions.includes(rewriteSectionName)
    ) {
      setRewriteSectionName("");
    }
  }, [sectionOptions, rewriteSectionName]);

  useEffect(() => {
    if (
      libraryProjectId &&
      !filteredProjects.some(
        (project) =>
          project.id === libraryProjectId
      )
    ) {
      setLibraryProjectId("");
    }
  }, [filteredProjects, libraryProjectId]);

  function navigateWorkspace(view: WorkspaceView) {
    setWorkspaceView(view);

    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });
    });
  }

  function closeWorkingSections() {
    setHooksOpen(false);
    setFullSongOpen(false);
    setCriticOpen(false);
    setWhyLineOpen(false);
    setRewriteOpen(false);
    setHistoryOpen(false);
  }

  function clearSongAnalysis() {
    setCritique(null);
    setCriticOpen(false);

    setLineAnalysis(null);
    setLineToAnalyse("");
    setSelectedLyricSource(null);
    setAlternativeMessage("");
    setWhyLineOpen(false);
  }

  function selectLyricsForAnalysis(
    text: string,
    occurrenceIndex: number
  ) {
    setLineToAnalyse(text);
    setSelectedLyricSource({
      originalText: text,
      occurrenceIndex,
    });
    setLineAnalysis(null);
    setAlternativeMessage("");
    setWhyLineOpen(true);
    setError("");

    setTimeout(() => {
      document
        .getElementById("why-line-section")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 100);
  }

  async function loadSavedSunoStyles(projectId: string) {
    try {
      setSunoStylesError("");
      setCopiedSunoStyleIndex(null);

      const response = await fetch(
        `/api/suno-styles?projectId=${encodeURIComponent(projectId)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load saved Suno styles."
        );
      }

      setSunoStyles(
        Array.isArray(data.styles) ? data.styles : []
      );
    } catch (err) {
      setSunoStyles([]);
      setSunoStylesError(
        err instanceof Error
          ? err.message
          : "Could not load saved Suno styles."
      );
    }
  }

  async function loadSavedGeneratedImages(projectId: string) {
    try {
      const response = await fetch(
        `/api/generate-image?projectId=${encodeURIComponent(projectId)}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load saved images."
        );
      }

      setGeneratedImages(
        Array.isArray(data.images) ? data.images : []
      );
    } catch (err) {
      setGeneratedImages([]);

      setImageStudioError(
        err instanceof Error
          ? err.message
          : "Could not load saved images."
      );
    }
  }

  async function loadSavedYouTubePack(projectId: string) {
    try {
      setYoutubeFullError("");

      const response = await fetch(
        `/api/social-media/youtube-full?projectId=${encodeURIComponent(
          projectId
        )}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load saved YouTube pack."
        );
      }

      if (data.youtubeFull?.recommendedTitle) {
        setYoutubeFullPack(data.youtubeFull);
        setYoutubePackDirty(false);
        setYoutubePackSaveMessage("");
        setYoutubeGeneratorGuidance(
          data.youtubeFull.generatorGuidance || ""
        );

        const savedReleaseDetails =
          data.youtubeFull.releaseDetails || {};

        setYoutubeReleaseType(
          savedReleaseDetails.releaseType ||
            "Official Music Video"
        );

        setYoutubeArtistBrand(
          savedReleaseDetails.artistBrand || "Suno Zara"
        );

        setYoutubeLyricsCredit(
          savedReleaseDetails.lyricsCredit || ""
        );

        setYoutubeCompositionCredit(
          savedReleaseDetails.compositionCredit || ""
        );

        setYoutubeProducerCredit(
          savedReleaseDetails.producerCredit || ""
        );

        setYoutubePreferredPlaylist(
          savedReleaseDetails.preferredPlaylist || ""
        );

        setYoutubeIncludeAiDisclosure(
          Boolean(
            savedReleaseDetails.includeAiDisclosure
          )
        );

        setYoutubeAiDisclosureDetails(
          savedReleaseDetails.aiDisclosureDetails || ""
        );

        setYoutubeDescriptionLinks(
          savedReleaseDetails.descriptionLinks || ""
        );
      } else {
        setYoutubeFullPack(null);
        setYoutubeGeneratorGuidance("");
      }
    } catch (err) {
      setYoutubeFullPack(null);

      setYoutubeFullError(
        err instanceof Error
          ? err.message
          : "Could not load saved YouTube pack."
      );
    }
  }

  async function copySocialText(
    field: string,
    value: string
  ) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);

      setCopiedSocialField(field);

      window.setTimeout(() => {
        setCopiedSocialField((current) =>
          current === field ? null : current
        );
      }, 1500);
    } catch {
      setPlatformPackError(
        "Could not copy text to clipboard."
      );
    }
  }

  function markPlatformDirty(
    platform: "facebook" | "instagram" | "tiktok"
  ) {
    setPlatformDirty((current) => ({
      ...current,
      [platform]: true,
    }));

    setPlatformSaveMessage((current) => ({
      ...current,
      [platform]: "",
    }));
  }

  function splitPlatformLines(value: string) {
    return value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  async function loadSavedPlatformPacks(
    projectId: string
  ) {
    try {
      setPlatformPackLoading(true);
      setPlatformPackError("");

      const response = await fetch(
        `/api/social-media/platform-pack?projectId=${encodeURIComponent(
          projectId
        )}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to load social platform packs."
        );
      }

      setFacebookPack(data.facebook || null);
      setInstagramPack(data.instagram || null);
      setTiktokPack(data.tiktok || null);

      const savedGuidance =
        data.facebook?.generatorGuidance ||
        data.instagram?.generatorGuidance ||
        data.tiktok?.generatorGuidance ||
        "";

      setPlatformGeneratorGuidance(savedGuidance);

      setPlatformPacksLoadedProjectId(projectId);

      setPlatformDirty({
        facebook: false,
        instagram: false,
        tiktok: false,
      });

      setPlatformSaveMessage({
        facebook: "",
        instagram: "",
        tiktok: "",
      });
    } catch (err) {
      setPlatformPackError(
        err instanceof Error
          ? err.message
          : "Could not load social platform packs."
      );
    } finally {
      setPlatformPackLoading(false);
    }
  }

  function openSocialPlatformTab(
    tab: "facebook" | "instagram" | "tiktok"
  ) {
    setSocialMediaTab(tab);

    if (
      activeProjectId &&
      platformPacksLoadedProjectId !== activeProjectId
    ) {
      loadSavedPlatformPacks(activeProjectId);
    }
  }

  async function generateSocialPlatformPacks() {
    if (!activeProjectId) {
      setPlatformPackError(
        "Open or save a song first."
      );
      return;
    }

    try {
      setPlatformPackLoading(true);
      setPlatformPackError("");

      const response = await fetch(
        "/api/social-media/platform-pack",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: activeProjectId,
            generatorGuidance:
              platformGeneratorGuidance,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to generate social platform packs."
        );
      }

      setFacebookPack(data.facebook);
      setInstagramPack(data.instagram);
      setTiktokPack(data.tiktok);

      setPlatformPacksLoadedProjectId(
        activeProjectId
      );

      setPlatformDirty({
        facebook: false,
        instagram: false,
        tiktok: false,
      });

      setPlatformSaveMessage({
        facebook: "Saved ✓",
        instagram: "Saved ✓",
        tiktok: "Saved ✓",
      });
    } catch (err) {
      setPlatformPackError(
        err instanceof Error
          ? err.message
          : "Could not generate social platform packs."
      );
    } finally {
      setPlatformPackLoading(false);
    }
  }

  async function saveSocialPlatformPack(
    platform: "facebook" | "instagram" | "tiktok"
  ) {
    const pack =
      platform === "facebook"
        ? facebookPack
        : platform === "instagram"
          ? instagramPack
          : tiktokPack;

    if (!activeProjectId || !pack) {
      return;
    }

    try {
      setPlatformSaving(platform);
      setPlatformPackError("");

      const packToSave = {
        ...pack,
        generatorGuidance:
          platformGeneratorGuidance,
      };

      const response = await fetch(
        "/api/social-media/platform-pack",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: activeProjectId,
            platform,
            pack: packToSave,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            `Failed to save ${platform} pack.`
        );
      }

      if (platform === "facebook") {
        setFacebookPack(data.pack);
      } else if (platform === "instagram") {
        setInstagramPack(data.pack);
      } else {
        setTiktokPack(data.pack);
      }

      setPlatformDirty((current) => ({
        ...current,
        [platform]: false,
      }));

      setPlatformSaveMessage((current) => ({
        ...current,
        [platform]: "Saved ✓",
      }));
    } catch (err) {
      setPlatformPackError(
        err instanceof Error
          ? err.message
          : `Could not save ${platform} pack.`
      );
    } finally {
      setPlatformSaving(null);
    }
  }

  function updateFacebookField(
    field:
      | "mainReleasePost"
      | "shortReleasePost"
      | "emotionalStoryPost",
    value: string
  ) {
    setFacebookPack((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current
    );

    markPlatformDirty("facebook");
  }

  function updateFacebookArray(
    field:
      | "engagementQuestions"
      | "ctaOptions"
      | "hashtags",
    value: string
  ) {
    setFacebookPack((current) =>
      current
        ? {
            ...current,
            [field]: splitPlatformLines(value),
          }
        : current
    );

    markPlatformDirty("facebook");
  }

  function updateFacebookReelField(
    index: number,
    field:
      | "creativeAngle"
      | "openingHook"
      | "caption"
      | "engagementPrompt"
      | "fullSongCta",
    value: string
  ) {
    setFacebookPack((current) => {
      if (!current) return current;

      const reels = [...current.reels];

      reels[index] = {
        ...reels[index],
        [field]: value,
      };

      return {
        ...current,
        reels,
      };
    });

    markPlatformDirty("facebook");
  }

  function updateFacebookReelHashtags(
    index: number,
    value: string
  ) {
    setFacebookPack((current) => {
      if (!current) return current;

      const reels = [...current.reels];

      reels[index] = {
        ...reels[index],
        hashtags: splitPlatformLines(value),
      };

      return {
        ...current,
        reels,
      };
    });

    markPlatformDirty("facebook");
  }

  function updateInstagramField(
    field: "feedCaption" | "shortCaption",
    value: string
  ) {
    setInstagramPack((current) =>
      current
        ? {
            ...current,
            [field]: value,
          }
        : current
    );

    markPlatformDirty("instagram");
  }

  function updateInstagramArray(
    field:
      | "storyTextIdeas"
      | "ctaOptions"
      | "hashtags",
    value: string
  ) {
    setInstagramPack((current) =>
      current
        ? {
            ...current,
            [field]: splitPlatformLines(value),
          }
        : current
    );

    markPlatformDirty("instagram");
  }

  function updateInstagramReelField(
    index: number,
    field:
      | "creativeAngle"
      | "openingHook"
      | "caption"
      | "fullSongCta"
      | "visualDirection",
    value: string
  ) {
    setInstagramPack((current) => {
      if (!current) return current;

      const reels = [...current.reels];

      reels[index] = {
        ...reels[index],
        [field]: value,
      };

      return {
        ...current,
        reels,
      };
    });

    markPlatformDirty("instagram");
  }

  function updateInstagramReelHashtags(
    index: number,
    value: string
  ) {
    setInstagramPack((current) => {
      if (!current) return current;

      const reels = [...current.reels];

      reels[index] = {
        ...reels[index],
        hashtags: splitPlatformLines(value),
      };

      return {
        ...current,
        reels,
      };
    });

    markPlatformDirty("instagram");
  }

  function updateTikTokPostField(
    index: number,
    field:
      | "creativeAngle"
      | "lyricMoment"
      | "openingHook"
      | "caption"
      | "commentPrompt"
      | "fullSongCta"
      | "visualDirection",
    value: string
  ) {
    setTiktokPack((current) => {
      if (!current) return current;

      const posts = [...current.posts];

      posts[index] = {
        ...posts[index],
        [field]: value,
      };

      return {
        ...current,
        posts,
      };
    });

    markPlatformDirty("tiktok");
  }

  function updateTikTokPostHashtags(
    index: number,
    value: string
  ) {
    setTiktokPack((current) => {
      if (!current) return current;

      const posts = [...current.posts];

      posts[index] = {
        ...posts[index],
        hashtags: splitPlatformLines(value),
      };

      return {
        ...current,
        posts,
      };
    });

    markPlatformDirty("tiktok");
  }

  async function loadSavedYouTubeShorts(
    projectId: string
  ) {
    try {
      setYoutubeShortsLoading(true);
      setYoutubeShortsError("");

      if (youtubeShortsLoadedProjectId !== projectId) {
        setYoutubeShortsPack(null);
      }

      const response = await fetch(
        `/api/social-media/youtube-shorts?projectId=${encodeURIComponent(
          projectId
        )}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to load saved YouTube Shorts."
        );
      }

      if (
        data.youtubeShorts &&
        Array.isArray(data.youtubeShorts.shorts)
      ) {
        setYoutubeShortsPack(data.youtubeShorts);

        setYoutubeShortsGeneratorGuidance(
          data.youtubeShorts.generatorGuidance || ""
        );
      } else {
        setYoutubeShortsPack(null);
        setYoutubeShortsGeneratorGuidance("");
      }

      setYoutubeShortsLoadedProjectId(projectId);
      setYoutubeShortsDirty(false);
      setYoutubeShortsSaveMessage("");
    } catch (err) {
      setYoutubeShortsError(
        err instanceof Error
          ? err.message
          : "Could not load saved YouTube Shorts."
      );
    } finally {
      setYoutubeShortsLoading(false);
    }
  }

  async function generateYouTubeShortsPack() {
    if (!activeProjectId) {
      setYoutubeShortsError(
        "Open or save a song first."
      );
      return;
    }

    try {
      setYoutubeShortsLoading(true);
      setYoutubeShortsError("");

      const response = await fetch(
        "/api/social-media/youtube-shorts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: activeProjectId,
            generatorGuidance:
              youtubeShortsGeneratorGuidance,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to generate YouTube Shorts."
        );
      }

      setYoutubeShortsPack(data.youtubeShorts);

      setYoutubeShortsLoadedProjectId(
        activeProjectId
      );

      setYoutubeShortsDirty(false);
      setYoutubeShortsSaveMessage("Saved ✓");
    } catch (err) {
      setYoutubeShortsError(
        err instanceof Error
          ? err.message
          : "Could not generate YouTube Shorts."
      );
    } finally {
      setYoutubeShortsLoading(false);
    }
  }

  function updateYouTubeShortField(
    index: number,
    field:
      | "creativeAngle"
      | "lyricMoment"
      | "openingHook"
      | "title"
      | "description"
      | "pinnedComment"
      | "fullSongCta"
      | "visualDirection",
    value: string
  ) {
    setYoutubeShortsPack((current) => {
      if (!current) return current;

      const shorts = [...current.shorts];

      shorts[index] = {
        ...shorts[index],
        [field]: value,
      };

      return {
        ...current,
        shorts,
      };
    });

    setYoutubeShortsDirty(true);
    setYoutubeShortsSaveMessage("");
  }

  function updateYouTubeShortArray(
    index: number,
    field: "hashtags" | "tags",
    value: string
  ) {
    const values = value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    setYoutubeShortsPack((current) => {
      if (!current) return current;

      const shorts = [...current.shorts];

      shorts[index] = {
        ...shorts[index],
        [field]: values,
      };

      return {
        ...current,
        shorts,
      };
    });

    setYoutubeShortsDirty(true);
    setYoutubeShortsSaveMessage("");
  }

  async function copyYouTubeShortText(
    field: string,
    value: string
  ) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);

      setCopiedYouTubeShortField(field);

      window.setTimeout(() => {
        setCopiedYouTubeShortField((current) =>
          current === field ? null : current
        );
      }, 1500);
    } catch {
      setYoutubeShortsError(
        "Could not copy text to clipboard."
      );
    }
  }

  async function saveYouTubeShortsPack() {
    if (!activeProjectId || !youtubeShortsPack) {
      return;
    }

    try {
      setYoutubeShortsSaving(true);
      setYoutubeShortsError("");
      setYoutubeShortsSaveMessage("");

      const response = await fetch(
        "/api/social-media/youtube-shorts",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: activeProjectId,
            youtubeShorts: {
              ...youtubeShortsPack,
              generatorGuidance:
                youtubeShortsGeneratorGuidance,
            },
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to save YouTube Shorts."
        );
      }

      setYoutubeShortsPack(data.youtubeShorts);
      setYoutubeShortsDirty(false);
      setYoutubeShortsSaveMessage("Saved ✓");
    } catch (err) {
      setYoutubeShortsError(
        err instanceof Error
          ? err.message
          : "Could not save YouTube Shorts."
      );
    } finally {
      setYoutubeShortsSaving(false);
    }
  }

  async function generateYouTubeFullPack() {
    if (!activeProjectId) {
      setYoutubeFullError("Open or save a song first.");
      return;
    }

    try {
      setYoutubeFullLoading(true);
      setYoutubeFullError("");

      const response = await fetch(
        "/api/social-media/youtube-full",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: activeProjectId,
            generatorGuidance: youtubeGeneratorGuidance,
            releaseDetails: {
              releaseType: youtubeReleaseType,
              artistBrand: youtubeArtistBrand,
              lyricsCredit: youtubeLyricsCredit,
              compositionCredit:
                youtubeCompositionCredit,
              producerCredit: youtubeProducerCredit,
              preferredPlaylist:
                youtubePreferredPlaylist,
              includeAiDisclosure:
                youtubeIncludeAiDisclosure,
              aiDisclosureDetails:
                youtubeAiDisclosureDetails,
              descriptionLinks:
                youtubeDescriptionLinks,
            },
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to generate YouTube Full Song pack."
        );
      }

      setYoutubeFullPack(data.youtubeFull);
      setYoutubePackDirty(false);
      setYoutubePackSaveMessage("Saved ✓");
    } catch (err) {
      setYoutubeFullError(
        err instanceof Error
          ? err.message
          : "Could not generate YouTube Full Song pack."
      );
    } finally {
      setYoutubeFullLoading(false);
    }
  }

  function updateYouTubePackField(
    field: string,
    value: string
  ) {
    setYoutubeFullPack((current) => {
      if (!current) return current;

      return {
        ...current,
        [field]: value,
      };
    });

    setYoutubePackDirty(true);
    setYoutubePackSaveMessage("");
  }

  function updateYouTubePackArray(
    field: string,
    value: string
  ) {
    const values = value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    setYoutubeFullPack((current) => {
      if (!current) return current;

      return {
        ...current,
        [field]: values,
      };
    });

    setYoutubePackDirty(true);
    setYoutubePackSaveMessage("");
  }

  function updateYouTubePackArrayItem(
    field: string,
    index: number,
    value: string
  ) {
    setYoutubeFullPack((current) => {
      if (!current) return current;

      const existing = (current as any)[field];

      if (!Array.isArray(existing)) {
        return current;
      }

      const updated = [...existing];
      updated[index] = value;

      return {
        ...current,
        [field]: updated,
      };
    });

    setYoutubePackDirty(true);
    setYoutubePackSaveMessage("");
  }

  async function saveYouTubeFullPack() {
    if (!activeProjectId || !youtubeFullPack) {
      return;
    }

    try {
      setYoutubePackSaving(true);
      setYoutubeFullError("");
      setYoutubePackSaveMessage("");

      const response = await fetch(
        "/api/social-media/youtube-full",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: activeProjectId,
            youtubeFull: {
              ...youtubeFullPack,
              generatorGuidance:
                youtubeGeneratorGuidance,
              releaseDetails: {
                releaseType: youtubeReleaseType,
                artistBrand: youtubeArtistBrand,
                lyricsCredit: youtubeLyricsCredit,
                compositionCredit:
                  youtubeCompositionCredit,
                producerCredit:
                  youtubeProducerCredit,
                preferredPlaylist:
                  youtubePreferredPlaylist,
                includeAiDisclosure:
                  youtubeIncludeAiDisclosure,
                aiDisclosureDetails:
                  youtubeAiDisclosureDetails,
                descriptionLinks:
                  youtubeDescriptionLinks,
              },
            },
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to save YouTube pack."
        );
      }

      setYoutubeFullPack(data.youtubeFull);
      setYoutubePackDirty(false);
      setYoutubePackSaveMessage("Saved ✓");
    } catch (err) {
      setYoutubeFullError(
        err instanceof Error
          ? err.message
          : "Could not save YouTube pack."
      );
    } finally {
      setYoutubePackSaving(false);
    }
  }

  async function copyYouTubeText(
    field: string,
    value: string
  ) {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);

      setCopiedYouTubeField(field);

      window.setTimeout(() => {
        setCopiedYouTubeField((current) =>
          current === field ? null : current
        );
      }, 1600);
    } catch {
      setYoutubeFullError("Could not copy text.");
    }
  }

  async function loadSavedVisualConcepts(projectId: string) {
    try {
      setImageStudioError("");

      const response = await fetch(
        `/api/image-concepts?projectId=${encodeURIComponent(projectId)}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to load saved visual concepts."
        );
      }

      const concepts = Array.isArray(data.concepts)
        ? data.concepts
        : [];

      setVisualConcepts(concepts);
      setSelectedVisualConceptId(
        data.selectedConceptId || null
      );
      setVisualIdeas(data.userIdeas || "");

      if (concepts.length > 0) {
        setImageStudioOpen(true);
      }
    } catch (err) {
      setVisualConcepts([]);
      setSelectedVisualConceptId(null);
      setVisualIdeas("");

      setImageStudioError(
        err instanceof Error
          ? err.message
          : "Could not load saved visual concepts."
      );
    }
  }

  function openProject(project: SongProject) {
    setActiveProjectStatus(project.status || "");

    setIdea(project.idea || "");
    setLanguage(project.language || "Hindi");
    setScript(project.script || "Native");
    setMood(
      project.mood ||
        (project.status === "lyrics-imported"
          ? ""
          : "Emotional")
    );
    setGenre(
      project.genre ||
        (project.status === "lyrics-imported"
          ? ""
          : "Modern Bollywood")
    );
    setFreedom(project.freedom ?? 50);

    setHooks(
      Array.isArray(project.hooks)
        ? project.hooks
        : []
    );

    setSelectedHook(
      project.selectedHook || null
    );

    setSongTitle(project.title || "");
    setLyrics(project.lyrics || "");

    setCritique(
      project.latestCritique || null
    );

    setLineAnalysis(
      project.latestLineAnalysis || null
    );

    const savedAnalysis =
      project.latestLineAnalysis;

    setLineToAnalyse(
      savedAnalysis?.selectedText ||
        savedAnalysis?.line ||
        ""
    );

    setRewriteSectionName("");
    setRewriteInstruction("");
    setRewriteMessage("");

    setVersions([]);
    setOpenVersionIndex(null);
    setCurrentVersionOpen(false);
    setVersionMessage("");

    setBuilt(true);
    setError("");

    setActiveProjectId(project.id);
    setWorkspaceView("song");

    setVisualConcepts([]);
    setVisualIdeas("");
    setImageCustomText("");
    setImageUseSongTitle(true);
    setImageIncludeBranding(true);
    setImageTextPosition("bottom");
    setImageFontStyle("cinematic");
    setImageFontSize("medium");
    setImageStudioError("");
    setImageStudioOpen(false);
    setSelectedVisualConceptId(null);

    setSunoStyles([]);
    setSunoStylesError("");
    setSunoStylesOpen(false);
    setCopiedSunoStyleIndex(null);
    setGeneratedImages([]);
    setFinalAudioFile(null);
    setFinalAudioAsset(null);
    setFinalAudioError("");
    setFinalAudioStatus("");
    setMediaUploadOpen(false);
    setYoutubeVideoFile(null);
    setYoutubeVideoAsset(null);
    setYoutubeVideoError("");
    setYoutubeVideoStatus("");
    setYoutubeVideoProgress(0);
    setYoutubeGeneratorGuidance("");
    setYoutubeReleaseType("Official Music Video");
    setYoutubeArtistBrand("Suno Zara");
    setYoutubeLyricsCredit("");
    setYoutubeCompositionCredit("");
    setYoutubeProducerCredit("");
    setYoutubePreferredPlaylist("");
    setYoutubeIncludeAiDisclosure(false);
    setYoutubeAiDisclosureDetails("");
    setYoutubeDescriptionLinks("");



    loadSavedSunoStyles(project.id);
    loadSavedVisualConcepts(project.id);
    loadSavedGeneratedImages(project.id);
    loadSavedYouTubePack(project.id);

    closeWorkingSections();

    if (project.lyrics) {
      setFullSongOpen(true);
    } else {
      setHooksOpen(true);
    }

    loadVersionHistory(project.id);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  function openSelectedLibraryProject() {
    const project = projects.find(
      (item) =>
        item.id === libraryProjectId
    );

    if (!project) {
      return;
    }

    openProject(project);
  }

  async function importExistingLyrics() {
    if (!importTitle.trim()) {
      setError("Please enter the song title.");
      return;
    }

    if (!importLyrics.trim()) {
      setError("Please paste the complete song lyrics.");
      return;
    }

    try {
      setImportLoading(true);
      setError("");

      const response = await fetch("/api/import-lyrics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: importTitle.trim(),
          lyrics: importLyrics.trim(),
          language,
          script,
          mood: importMood,
          genre: importGenre,
          freedom,
          idea: "",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not import the lyrics."
        );
      }

      if (!data.project) {
        throw new Error(
          "Imported song project was not returned."
        );
      }

      openProject(data.project);

      setImportTitle("");
      setImportLyrics("");
      setImportMood("");
      setImportGenre("");

      await loadProjects();

    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not import the lyrics."
      );
    } finally {
      setImportLoading(false);
    }
  }

  async function buildSong() {
    if (!idea.trim()) {
      setError(
        "Please tell me what your song is about first."
      );

      setBuilt(true);
      setHooksOpen(true);

      return;
    }

    try {
      setLoading(true);
      setError("");
      setBuilt(true);

      setHooks([]);
      setSelectedHook(null);
      setSongTitle("");
      setLyrics("");

      clearSongAnalysis();

      setVersions([]);
      setOpenVersionIndex(null);
      setCurrentVersionOpen(false);
      setVersionMessage("");

      setRewriteSectionName("");
      setRewriteInstruction("");
      setRewriteMessage("");

      closeWorkingSections();
      setHooksOpen(true);

      const response = await fetch(
        "/api/generate",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            idea,
            language,
            script,
            mood,
            genre,
            freedom,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Something went wrong."
        );
      }

      if (
        !Array.isArray(data.hooks) ||
        data.hooks.length < 3
      ) {
        throw new Error(
          "The Song Builder did not return three hooks."
        );
      }

      setHooks(data.hooks);
      setWorkspaceView("song");

      setActiveProjectStatus("hooks-generated");

      if (data.projectId) {
        setActiveProjectId(
          data.projectId
        );
      }

      await loadProjects();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while building the song."
      );
    } finally {
      setLoading(false);
    }
  }

  async function chooseHook(hook: string) {
    if (!activeProjectId) {
      setError("No active project found.");
      return;
    }

    try {
      setSavingHook(true);
      setError("");

      const response = await fetch(
        "/api/select-hook",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            projectId:
              activeProjectId,

            selectedHook:
              hook,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to save selected hook."
        );
      }

      if (hook !== selectedHook) {
        setSongTitle("");
        setLyrics("");

        clearSongAnalysis();

        setRewriteSectionName("");
        setRewriteInstruction("");
        setRewriteMessage("");

        setVersions([]);
        setOpenVersionIndex(null);
        setCurrentVersionOpen(false);

        setFullSongOpen(false);
        setRewriteOpen(false);
        setHistoryOpen(false);
      }

      setSelectedHook(hook);

      await loadProjects();
      await loadVersionHistory();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while saving the hook."
      );
    } finally {
      setSavingHook(false);
    }
  }

    async function generateVisualConcepts() {
    if (!activeProjectId) {
      setImageStudioError("No active song found.");
      return;
    }

    if (!lyrics.trim()) {
      setImageStudioError(
        "Generate the full song before creating visual concepts."
      );
      return;
    }

    try {
      setVisualConceptsLoading(true);
      setImageStudioError("");
      setSelectedVisualConceptId(null);
      setImageStudioOpen(true);

      const response = await fetch("/api/image-concepts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: activeProjectId,
          userIdeas: visualIdeas,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to generate visual concepts."
        );
      }

      setVisualConcepts(
        Array.isArray(data.concepts) ? data.concepts : []
      );

      setTimeout(() => {
        document
          .getElementById("image-studio-section")
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 100);
    } catch (err) {
      setImageStudioError(
        err instanceof Error
          ? err.message
          : "Something went wrong while creating visual concepts."
      );
    } finally {
      setVisualConceptsLoading(false);
    }
  }

  async function chooseVisualConcept(conceptId: string) {
    if (!activeProjectId) {
      setImageStudioError("No active song found.");
      return;
    }

    try {
      setImageStudioError("");

      const response = await fetch("/api/image-concepts", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: activeProjectId,
          conceptId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to save visual selection."
        );
      }

      setSelectedVisualConceptId(conceptId);

      setVisualConcepts((current) =>
        current.map((concept) => ({
          ...concept,
          selected: concept.id === conceptId,
        }))
      );
    } catch (err) {
      setImageStudioError(
        err instanceof Error
          ? err.message
          : "Could not save visual selection."
      );
    }
  }

  async function generateArtworkBatch(
    format: "youtube" | "shorts",
    count: number
  ) {
    if (!activeProjectId) {
      setImageStudioError("No active song found.");
      return;
    }

    if (!selectedVisualConceptId) {
      setImageStudioError("Choose a visual concept first.");
      return;
    }

    try {
      setGeneratingImage(true);
      setImageStudioError("");

      const formatLabel =
        format === "youtube"
          ? "YouTube"
          : "Vertical";

      setGeneratingImageProgress(
        "Preparing image generation set..."
      );

      const imageSetResponse = await fetch("/api/image-sets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: activeProjectId,
          conceptId: selectedVisualConceptId,
          format,
        }),
      });

      const imageSetData = await imageSetResponse.json();

      if (!imageSetResponse.ok) {
        throw new Error(
          imageSetData.error ||
            "Failed to prepare image generation set."
        );
      }

      const imageSetId = String(
        imageSetData.imageSet?.id || ""
      );

      const imageSetNumber = Number(
        imageSetData.imageSet?.setNumber
      );

      if (!imageSetId || !Number.isInteger(imageSetNumber)) {
        throw new Error(
          "Image generation set was not created correctly."
        );
      }

      const shotBriefsByNumber = new Map<number, string>();

      setGeneratingImageProgress(
        format === "youtube"
          ? "Designing 3 radically different YouTube compositions..."
          : "Designing 6 radically different vertical compositions..."
      );

      const briefsResponse = await fetch(
        "/api/image-shot-briefs",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: activeProjectId,
            conceptId: selectedVisualConceptId,
            format,
          }),
        }
      );

      const briefsData = await briefsResponse.json();

      if (!briefsResponse.ok) {
        throw new Error(
          briefsData.error ||
            "Failed to create distinct image compositions."
        );
      }

      if (
        !Array.isArray(briefsData.briefs) ||
        briefsData.briefs.length !== count
      ) {
        throw new Error(
          `Expected exactly ${count} coordinated image briefs.`
        );
      }

      for (const brief of briefsData.briefs) {
        shotBriefsByNumber.set(
          Number(brief.imageNumber),
          String(brief.brief || "")
        );
      }

      for (let imageNumber = 1; imageNumber <= count; imageNumber++) {
        setGeneratingImageProgress(
          `Generating ${formatLabel} image ${imageNumber} of ${count}...`
        );

        const response = await fetch("/api/generate-image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId: activeProjectId,
            conceptId: selectedVisualConceptId,
            format,
            imageNumber,
            imageSetId,
            imageSetNumber,
            imageCustomText,
            imageUseSongTitle,
            imageIncludeBranding,
            imageTextPosition,
            imageFontStyle,
            imageFontSize,
            shotBrief:
              shotBriefsByNumber.get(imageNumber) || "",
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error ||
              `Failed to generate ${formatLabel} image ${imageNumber}.`
          );
        }

        if (!data.image?.url) {
          throw new Error(
            `${formatLabel} image ${imageNumber} generated but no preview URL was returned.`
          );
        }

        setGeneratedImages((current) => {
          const remaining = current.filter(
            (image) =>
              !(
                image.format === data.image.format &&
                image.imageNumber === data.image.imageNumber &&
                (image.imageSetId || null) ===
                  (data.image.imageSetId || null)
              )
          );

          return [...remaining, data.image].sort((a, b) => {
            if (a.format === b.format) {
              return a.imageNumber - b.imageNumber;
            }

            return a.format.localeCompare(b.format);
          });
        });
      }

      setGeneratingImageProgress(
        format === "youtube"
          ? "3 YouTube images generated and saved."
          : "6 vertical images generated and saved."
      );
    } catch (err) {
      setImageStudioError(
        err instanceof Error
          ? err.message
          : "Something went wrong while generating artwork."
      );

      setGeneratingImageProgress("");
    } finally {
      setGeneratingImage(false);
    }
  }

  async function downloadGeneratedImage(image: {
    url: string;
    format: string;
    imageNumber: number;
  }) {
    try {
      setImageStudioError("");

      const response = await fetch(image.url);

      if (!response.ok) {
        throw new Error("Could not download the image.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      const safeTitle =
        (songTitle || "suno-zara")
          .trim()
          .replace(/[^a-zA-Z0-9-_]+/g, "-")
          .replace(/^-+|-+$/g, "") || "suno-zara";

      const link = document.createElement("a");

      link.href = objectUrl;
      link.download =
        `${safeTitle}-${image.format}-image-${image.imageNumber}.png`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setImageStudioError(
        err instanceof Error
          ? err.message
          : "Could not download the image."
      );
    }
  }

  function formatMediaBytes(
    bytes?: number | null
  ) {
    if (
      typeof bytes !== "number" ||
      !Number.isFinite(bytes) ||
      bytes <= 0
    ) {
      return "";
    }

    if (bytes < 1024) {
      return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(
      bytes /
      (1024 * 1024)
    ).toFixed(1)} MB`;
  }

  function inferAudioMimeType(file: File) {
    if (file.type) {
      return file.type;
    }

    const extension =
      file.name
        .split(".")
        .pop()
        ?.toLowerCase() || "";

    if (extension === "mp3") {
      return "audio/mpeg";
    }

    if (extension === "wav") {
      return "audio/wav";
    }

    if (extension === "m4a") {
      return "audio/mp4";
    }

    if (extension === "aac") {
      return "audio/aac";
    }

    return "";
  }

  async function loadFinalAudio(
    projectId: string
  ) {
    try {
      setFinalAudioLoading(true);
      setFinalAudioError("");

      const response = await fetch(
        `/api/media/final-audio?projectId=${encodeURIComponent(
          projectId
        )}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Could not load Final Audio."
        );
      }

      setFinalAudioAsset(
        data.asset || null
      );

      if (data.asset) {
        setMediaUploadOpen(true);
      }
    } catch (err) {
      setFinalAudioAsset(null);

      setFinalAudioError(
        err instanceof Error
          ? err.message
          : "Could not load Final Audio."
      );
    } finally {
      setFinalAudioLoading(false);
    }
  }

  async function uploadFinalAudio() {
    if (!activeProjectId) {
      setFinalAudioError(
        "No active song found."
      );
      return;
    }

    if (!finalAudioFile) {
      setFinalAudioError(
        "Please choose an audio file first."
      );
      return;
    }

    const mimeType =
      inferAudioMimeType(finalAudioFile);

    if (!mimeType) {
      setFinalAudioError(
        "Please choose an MP3, WAV, M4A or AAC audio file."
      );
      return;
    }

    if (mediaStorageMode === "local") {
      try {
        setFinalAudioUploading(true);
        setFinalAudioError("");
        setFinalAudioStatus("Saving Final Audio to this Mac...");
        await uploadLocalMedia({
          projectId: activeProjectId,
          mediaKind: "final-audio",
          file: finalAudioFile,
          mimeType,
        });
        await loadFinalAudio(activeProjectId);
        setFinalAudioFile(null);
        setFinalAudioStatus("✓ Final Audio saved locally");
        setMediaUploadOpen(true);
        window.setTimeout(() => setFinalAudioStatus(""), 2500);
      } catch (err) {
        setFinalAudioStatus("");
        setFinalAudioError(err instanceof Error ? err.message : "Could not save Final Audio locally.");
      } finally {
        setFinalAudioUploading(false);
      }
      return;
    }

    let uploadedStoragePath = "";
    let uploadedBucket = "song-media";

    try {
      setFinalAudioUploading(true);
      setFinalAudioError("");
      setFinalAudioStatus(
        "Preparing secure upload..."
      );

      const prepareResponse = await fetch(
        "/api/media/final-audio",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            action: "prepare",
            projectId: activeProjectId,
            originalFilename:
              finalAudioFile.name,
            mimeType,
            sizeBytes:
              finalAudioFile.size,
          }),
        }
      );

      const prepareData =
        await prepareResponse.json();

      if (!prepareResponse.ok) {
        throw new Error(
          prepareData.error ||
            "Could not prepare audio upload."
        );
      }

      const upload =
        prepareData.upload;

      if (
        !upload?.storagePath ||
        !upload?.token
      ) {
        throw new Error(
          "Secure upload details were not returned."
        );
      }

      uploadedStoragePath =
        upload.storagePath;

      uploadedBucket =
        upload.bucket ||
        "song-media";

      setFinalAudioStatus(
        "Uploading Final Audio..."
      );

      const supabase = createClient();

      const {
        error: storageError,
      } = await supabase.storage
        .from(uploadedBucket)
        .uploadToSignedUrl(
          uploadedStoragePath,
          upload.token,
          finalAudioFile,
          {
            contentType: mimeType,
          }
        );

      if (storageError) {
        throw new Error(
          `Audio upload failed: ${storageError.message}`
        );
      }

      setFinalAudioStatus(
        "Saving Final Audio..."
      );

      const registerResponse =
        await fetch(
          "/api/media/final-audio",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              action: "register",
              projectId:
                activeProjectId,
              storagePath:
                uploadedStoragePath,
              originalFilename:
                finalAudioFile.name,
              mimeType,
              sizeBytes:
                finalAudioFile.size,
            }),
          }
        );

      const registerData =
        await registerResponse.json();

      if (!registerResponse.ok) {
        // Remove an uploaded orphan if
        // database registration fails.
        await supabase.storage
          .from(uploadedBucket)
          .remove([
            uploadedStoragePath,
          ]);

        throw new Error(
          registerData.error ||
            "Audio uploaded but could not be saved."
        );
      }

      // Reload the saved asset so we immediately get
      // fresh playback and download signed URLs.
      await loadFinalAudio(activeProjectId);

      setFinalAudioFile(null);

      setFinalAudioStatus(
        "✓ Final Audio saved"
      );

      setMediaUploadOpen(true);

      window.setTimeout(() => {
        setFinalAudioStatus("");
      }, 2500);
    } catch (err) {
      setFinalAudioStatus("");

      setFinalAudioError(
        err instanceof Error
          ? err.message
          : "Could not upload Final Audio."
      );
    } finally {
      setFinalAudioUploading(false);
    }
  }

  function inferVideoMimeType(file: File) {
    if (
      file.type === "video/mp4" ||
      file.type === "video/quicktime"
    ) {
      return file.type;
    }

    const extension =
      file.name
        .split(".")
        .pop()
        ?.toLowerCase() || "";

    if (extension === "mp4") {
      return "video/mp4";
    }

    if (extension === "mov") {
      return "video/quicktime";
    }

    return "";
  }

  async function loadYoutubeVideo(
    projectId: string
  ) {
    try {
      setYoutubeVideoLoading(true);
      setYoutubeVideoError("");

      const response = await fetch(
        `/api/media/youtube-video?projectId=${encodeURIComponent(
          projectId
        )}`,
        {
          cache: "no-store",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Could not load Full YouTube Video."
        );
      }

      setYoutubeVideoAsset(
        data.asset || null
      );

      if (data.asset) {
        setMediaUploadOpen(true);
      }
    } catch (err) {
      setYoutubeVideoAsset(null);

      setYoutubeVideoError(
        err instanceof Error
          ? err.message
          : "Could not load Full YouTube Video."
      );
    } finally {
      setYoutubeVideoLoading(false);
    }
  }

  async function uploadYoutubeVideo() {
    if (!activeProjectId) {
      setYoutubeVideoError(
        "No active song found."
      );
      return;
    }

    if (!youtubeVideoFile) {
      setYoutubeVideoError(
        "Please choose a video file first."
      );
      return;
    }

    const mimeType =
      inferVideoMimeType(youtubeVideoFile);

    if (!mimeType) {
      setYoutubeVideoError(
        "Please choose an MP4 or MOV video."
      );
      return;
    }

    if (mediaStorageMode === "local") {
      try {
        setYoutubeVideoUploading(true);
        setYoutubeVideoError("");
        setYoutubeVideoProgress(0);
        setYoutubeVideoStatus("Saving Full YouTube Video to this Mac...");
        await uploadLocalMedia({
          projectId: activeProjectId,
          mediaKind: "youtube-video",
          file: youtubeVideoFile,
          mimeType,
          onProgress: (percent) => {
            setYoutubeVideoProgress(percent);
            setYoutubeVideoStatus(`Saving Full YouTube Video locally... ${percent}%`);
          },
        });
        await loadYoutubeVideo(activeProjectId);
        setYoutubeVideoFile(null);
        setYoutubeVideoProgress(100);
        setYoutubeVideoStatus("✓ Full YouTube Video saved locally");
        setMediaUploadOpen(true);
        window.setTimeout(() => setYoutubeVideoStatus(""), 3000);
      } catch (err) {
        setYoutubeVideoStatus("");
        setYoutubeVideoError(err instanceof Error ? err.message : "Could not save Full YouTube Video locally.");
      } finally {
        setYoutubeVideoUploading(false);
      }
      return;
    }

    let uploadedStoragePath = "";
    let uploadedBucket = "song-media";

    try {
      setYoutubeVideoUploading(true);
      setYoutubeVideoError("");
      setYoutubeVideoProgress(0);
      setYoutubeVideoStatus(
        "Preparing secure resumable upload..."
      );

      const prepareResponse = await fetch(
        "/api/media/youtube-video",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            action: "prepare",
            projectId: activeProjectId,
            originalFilename:
              youtubeVideoFile.name,
            mimeType,
            sizeBytes:
              youtubeVideoFile.size,
          }),
        }
      );

      const prepareData =
        await prepareResponse.json();

      if (!prepareResponse.ok) {
        throw new Error(
          prepareData.error ||
            "Could not prepare video upload."
        );
      }

      const upload =
        prepareData.upload;

      if (
        !upload?.storagePath ||
        !upload?.tusEndpoint
      ) {
        throw new Error(
          "Secure resumable upload details were not returned."
        );
      }

      uploadedStoragePath =
        upload.storagePath;

      uploadedBucket =
        upload.bucket ||
        "song-media";

      setYoutubeVideoStatus(
        "Uploading Full YouTube Video..."
      );

      const supabase = createClient();

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (
        sessionError ||
        !session?.access_token
      ) {
        throw new Error(
          "Your login session could not be used for the video upload. Please sign in again."
        );
      }

      await new Promise<void>(
        (resolve, reject) => {
          const videoUpload =
            new tus.Upload(
              youtubeVideoFile,
              {
                endpoint:
                  upload.tusEndpoint,

                retryDelays: [
                  0,
                  3000,
                  5000,
                  10000,
                  20000,
                ],

                headers: {
                  authorization:
                    `Bearer ${session.access_token}`,
                },

                uploadDataDuringCreation:
                  true,

                removeFingerprintOnSuccess:
                  true,

                metadata: {
                  bucketName:
                    uploadedBucket,
                  objectName:
                    uploadedStoragePath,
                  contentType:
                    mimeType,
                  cacheControl:
                    "3600",
                },

                // Supabase currently requires
                // 6 MB TUS chunks.
                chunkSize:
                  6 * 1024 * 1024,

                onError: (error) => {
                  reject(error);
                },

                onProgress: (
                  bytesUploaded,
                  bytesTotal
                ) => {
                  const percentage =
                    bytesTotal > 0
                      ? Math.round(
                          (bytesUploaded /
                            bytesTotal) *
                            100
                        )
                      : 0;

                  setYoutubeVideoProgress(
                    percentage
                  );

                  setYoutubeVideoStatus(
                    `Uploading Full YouTube Video... ${percentage}%`
                  );
                },

                onSuccess: () => {
                  setYoutubeVideoProgress(
                    100
                  );
                  resolve();
                },
              }
            );

          videoUpload.start();
        }
      );

      setYoutubeVideoStatus(
        "Saving video to this song..."
      );

      const registerResponse =
        await fetch(
          "/api/media/youtube-video",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              action: "register",
              projectId:
                activeProjectId,
              storagePath:
                uploadedStoragePath,
              originalFilename:
                youtubeVideoFile.name,
              mimeType,
              sizeBytes:
                youtubeVideoFile.size,
            }),
          }
        );

      const registerData =
        await registerResponse.json();

      if (!registerResponse.ok) {
        const supabase =
          createClient();

        await supabase.storage
          .from(uploadedBucket)
          .remove([
            uploadedStoragePath,
          ]);

        throw new Error(
          registerData.error ||
            "Video uploaded but could not be saved."
        );
      }

      // Reload from the canonical server record
      // so preview/download URLs are fresh.
      await loadYoutubeVideo(
        activeProjectId
      );

      setYoutubeVideoFile(null);

      setYoutubeVideoProgress(100);

      setYoutubeVideoStatus(
        "✓ Full YouTube Video saved"
      );

      setMediaUploadOpen(true);

      window.setTimeout(() => {
        setYoutubeVideoStatus("");
      }, 3000);
    } catch (err) {
      setYoutubeVideoStatus("");

      setYoutubeVideoError(
        err instanceof Error
          ? err.message
          : "Could not upload Full YouTube Video."
      );
    } finally {
      setYoutubeVideoUploading(false);
    }
  }

  async function generateSunoStyles() {
    if (!activeProjectId) {
      setSunoStylesError("No active song found.");
      return;
    }

    if (!lyrics.trim()) {
      setSunoStylesError(
        "Generate the full song before creating Suno styles."
      );
      return;
    }

    try {
      setSunoStylesLoading(true);
      setSunoStylesError("");
      setCopiedSunoStyleIndex(null);

      const response = await fetch("/api/suno-styles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: activeProjectId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to generate Suno styles."
        );
      }

      setSunoStyles(
        Array.isArray(data.styles) ? data.styles : []
      );
      setSunoStylesOpen(true);

      setTimeout(() => {
        document
          .getElementById("suno-styles-section")
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 100);
    } catch (err) {
      setSunoStylesError(
        err instanceof Error
          ? err.message
          : "Something went wrong while generating Suno styles."
      );
      setSunoStylesOpen(true);
    } finally {
      setSunoStylesLoading(false);
    }
  }

  async function copySunoStyle(
    prompt: string,
    index: number
  ) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedSunoStyleIndex(index);

      setTimeout(() => {
        setCopiedSunoStyleIndex((current) =>
          current === index ? null : current
        );
      }, 1800);
    } catch {
      setSunoStylesError(
        "Could not copy the Suno prompt automatically."
      );
    }
  }

async function generateFullSong() {
    if (!activeProjectId) {
      setError("No active project found.");
      return;
    }

    if (!selectedHook) {
      setError("Please choose a hook first.");
      return;
    }

    try {
      setGeneratingSong(true);
      setError("");
      setRewriteMessage("");
      setVersionMessage("");
      setCurrentVersionOpen(false);

      const response = await fetch(
        "/api/generate-song",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            projectId:
              activeProjectId,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to generate the full song."
        );
      }

      setSongTitle(
        data.title || ""
      );

      setLyrics(
        data.lyrics || ""
      );

      clearSongAnalysis();

      setRewriteSectionName("");
      setRewriteInstruction("");

      setHooksOpen(false);
      setFullSongOpen(true);

      await loadProjects();
      await loadVersionHistory();

      setTimeout(() => {
        document
          .getElementById("full-song-section")
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 100);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while generating the song."
      );
    } finally {
      setGeneratingSong(false);
    }
  }

  async function rewriteSection() {
    if (!activeProjectId) {
      setError("No active project found.");
      return;
    }

    if (!rewriteSectionName) {
      setError(
        "Please choose a section to rewrite."
      );
      return;
    }

    if (!rewriteInstruction.trim()) {
      setError(
        "Tell me how you want this section improved."
      );
      return;
    }

    try {
      setRewritingSection(true);
      setError("");
      setRewriteMessage("");
      setVersionMessage("");
      setCurrentVersionOpen(false);

      const response = await fetch(
        "/api/rewrite-section",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            projectId:
              activeProjectId,

            sectionName:
              rewriteSectionName,

            instruction:
              rewriteInstruction,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to rewrite the section."
        );
      }

      setLyrics(data.lyrics || "");

      clearSongAnalysis();

      setRewriteMessage(
        `${rewriteSectionName} rewritten successfully. Previous version saved.`
      );

      setRewriteInstruction("");

      setRewriteOpen(true);
      setHistoryOpen(false);

      await loadProjects();
      await loadVersionHistory();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while rewriting the section."
      );
    } finally {
      setRewritingSection(false);
    }
  }

  async function runCriticMode() {
    if (!activeProjectId) {
      setError("No active project found.");
      return;
    }

    if (!lyrics) {
      setError(
        "Generate the full song before using Critic Mode."
      );
      return;
    }

    try {
      setCriticLoading(true);
      setError("");

      const response = await fetch(
        "/api/critic",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            projectId:
              activeProjectId,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to critique the song."
        );
      }

      setCritique(data.critique);

      setCriticOpen(true);

      await loadProjects();

      setTimeout(() => {
        document
          .getElementById("critic-section")
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 100);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while analysing the song."
      );
    } finally {
      setCriticLoading(false);
    }
  }

  function openWhyThisLine() {
    setWhyLineOpen(true);
    setError("");

    setTimeout(() => {
      document
        .getElementById("why-line-section")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    }, 100);
  }

  async function analyseLine() {
    if (!activeProjectId) {
      setError("No active project found.");
      return;
    }

    if (!lineToAnalyse.trim()) {
      setError(
        "Choose or enter one or more lyric lines first."
      );
      return;
    }

    try {
      setLineAnalysisLoading(true);
      setError("");

      const response = await fetch(
        "/api/why-this-line",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            projectId:
              activeProjectId,

            text:
              lineToAnalyse.trim(),
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to analyse the selected lyrics."
        );
      }

      setLineAnalysis(
        data.analysis
      );

      setWhyLineOpen(true);

      await loadProjects();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while analysing the lyrics."
      );
    } finally {
      setLineAnalysisLoading(false);
    }
  }

  async function applyAlternative(
    replacementText: string
  ) {
    if (!activeProjectId) {
      setError("No active project found.");
      return;
    }

    if (!selectedLyricSource) {
      setError(
        "Please select the lyric directly from the Full Song before replacing it."
      );
      return;
    }

    const confirmed = window.confirm(
      "Use this alternative in the song? Your current song will be saved in Version History first."
    );

    if (!confirmed) {
      return;
    }

    try {
      setApplyingAlternative(true);
      setError("");
      setAlternativeMessage("");
      setVersionMessage("");

      const response = await fetch(
        "/api/apply-alternative",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            projectId: activeProjectId,
            originalText:
              selectedLyricSource.originalText,
            replacementText,
            occurrenceIndex:
              selectedLyricSource.occurrenceIndex,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to apply the alternative."
        );
      }

      setLyrics(data.lyrics || "");

      setCritique(null);
      setLineAnalysis(null);
      setLineToAnalyse("");
      setSelectedLyricSource(null);

      setAlternativeMessage(
        "Alternative applied successfully. The previous song was saved in Version History."
      );

      setWhyLineOpen(false);
      setFullSongOpen(true);
      setCurrentVersionOpen(false);
      setOpenVersionIndex(null);

      setVersionMessage(
        "Previous song saved automatically before the lyric replacement."
      );

      await loadProjects();
      await loadVersionHistory();

      setTimeout(() => {
        document
          .getElementById("full-song-section")
          ?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 100);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while applying the alternative."
      );
    } finally {
      setApplyingAlternative(false);
    }
  }

  async function restoreVersion(
    versionIndex: number
  ) {
    if (!activeProjectId) {
      setError("No active project found.");
      return;
    }

    const confirmed =
      window.confirm(
        "Restore this version? Your current version will be saved in history first."
      );

    if (!confirmed) {
      return;
    }

    try {
      setRestoringVersion(
        versionIndex
      );

      setError("");
      setVersionMessage("");
      setCurrentVersionOpen(false);

      const response = await fetch(
        "/api/version-history",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            projectId:
              activeProjectId,

            versionIndex,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Failed to restore version."
        );
      }

      setSongTitle(
        data.title || ""
      );

      setLyrics(
        data.lyrics || ""
      );

      clearSongAnalysis();

      setOpenVersionIndex(null);

      setVersionMessage(
        "Older version restored successfully. The version you replaced was saved in history."
      );

      setHistoryOpen(true);

      await loadProjects();
      await loadVersionHistory();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong while restoring the version."
      );
    } finally {
      setRestoringVersion(null);
    }
  }

  function getVersionLabel(
    version: SongVersion
  ) {
    if (
      version.type ===
      "before-section-rewrite"
    ) {
      return version.rewrittenSection
        ? `Before ${version.rewrittenSection} rewrite`
        : "Before section rewrite";
    }

    if (
      version.type ===
      "before-version-restore"
    ) {
      return "Before version restore";
    }

    return "Previous full song";
  }

  function severityClass(
    severity?: string
  ) {
    const value =
      severity?.toLowerCase();

    if (value === "high") {
      return "border-red-900 bg-red-950/30 text-red-300";
    }

    if (value === "medium") {
      return "border-amber-900 bg-amber-950/30 text-amber-300";
    }

    return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }

  function verdictClass(
    verdict?: string
  ) {
    const value =
      verdict?.toLowerCase();

    if (value === "keep") {
      return "border-green-800 bg-green-950/30 text-green-300";
    }

    if (value === "replace") {
      return "border-red-900 bg-red-950/30 text-red-300";
    }

    return "border-amber-900 bg-amber-950/30 text-amber-300";
  }

  return (
    <main className="min-h-screen bg-[#07101a] text-white">
      <div className="min-h-screen lg:grid lg:grid-cols-[312px_minmax(0,1fr)]">
        <StudioSidebar
          projectName={songTitle || undefined}
          hasProject={Boolean(activeProjectId)}
          hasLyrics={Boolean(lyrics)}
          activeView={workspaceView}
          onNavigate={navigateWorkspace}
        />

        <div className="min-w-0">
          <div className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#08111d]/90 backdrop-blur-xl">
            <div className="mx-auto flex max-w-[2200px] items-center gap-4 px-4 py-3 sm:px-6 lg:px-10">
              <div className="relative hidden w-full max-w-xl md:block">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-500">⌕</span>
                <input
                  value={librarySearch}
                  onChange={(event) => setLibrarySearch(event.target.value)}
                  onFocus={() => {
                    setLibraryOpen(true);
                    setWorkspaceView("library");
                  }}
                  placeholder="Search your songs..."
                  className="w-full rounded-2xl border border-slate-700/70 bg-[#111c2b] py-2.5 pl-10 pr-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-blue-400/50 focus:ring-2 focus:ring-blue-500/10"
                />
              </div>

              <div className="ml-auto flex min-w-0 items-center gap-3">
                <div className="hidden min-w-0 text-right xl:block">
                  <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-slate-600">
                    {activeProjectId ? "Current project" : "Workspace"}
                  </p>
                  <p className="mt-0.5 max-w-[260px] truncate text-xs font-semibold text-slate-300">
                    {songTitle || (activeProjectId ? "Song in progress" : "Music Studio")}
                  </p>
                </div>

                {lyrics && (
                  <span className="hidden rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 sm:inline-flex">
                    Lyrics ready
                  </span>
                )}

                {accountEmail ? (
                  <div className="shrink-0">
                    <AccountMenu email={accountEmail} />
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <Link
                      href="/login"
                      className="rounded-xl border border-slate-600/80 bg-[#111c2b] px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-blue-400/60 hover:bg-[#162337]"
                    >
                      Sign In
                    </Link>

                    <Link
                      href="/signup"
                      className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-2.5 text-sm font-bold text-white shadow-[0_10px_28px_-14px_rgba(59,130,246,.9)] transition hover:brightness-110"
                    >
                      Create Account
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>

          {activeProjectId && (
            <StudioWorkspaceTabs
              activeView={workspaceView}
              hasLyrics={Boolean(lyrics)}
              onNavigate={navigateWorkspace}
            />
          )}

          <div className="mx-auto max-w-[2200px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
            <header hidden={workspaceView !== "home"} id="studio-hero" className="relative mb-8 scroll-mt-24 overflow-hidden rounded-[30px] border border-slate-700/60 bg-[#0b1522] shadow-[0_28px_90px_-52px_rgba(0,0,0,1)]">
              <div className="relative min-h-[330px] overflow-hidden">
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: 'url("/studio-hero.svg")' }}
                />
                <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,14,24,.97)_0%,rgba(6,14,24,.90)_34%,rgba(6,14,24,.50)_66%,rgba(6,14,24,.18)_100%)]" />
                <div className="absolute inset-0 bg-[linear-gradient(0deg,rgba(6,14,24,.72)_0%,transparent_55%)]" />

                <div className="relative flex min-h-[330px] max-w-4xl flex-col justify-center p-7 sm:p-10 lg:p-12">
                  <p className="text-[11px] font-bold uppercase tracking-[0.34em] text-sky-300/80">Welcome to</p>
                  <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] text-white sm:text-5xl lg:text-[64px] lg:leading-[1.02]">
                    Suno Zara <span className="bg-gradient-to-r from-sky-300 via-blue-300 to-rose-300 bg-clip-text text-transparent">Studio</span>
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base lg:text-[17px]">
                    Turn your ideas into beautiful songs, create release-ready media, and take your music from the first line to the world.
                  </p>

                  <div className="mt-7 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setCreationMode("generate");
                        navigateWorkspace("start");
                      }}
                      className="rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-5 py-3 text-sm font-bold text-white shadow-[0_14px_34px_-16px_rgba(59,130,246,.85)] transition hover:brightness-110"
                    >
                      + Create from Idea
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreationMode("import");
                        navigateWorkspace("start");
                      }}
                      className="rounded-xl border border-slate-500/60 bg-[#0b1522]/70 px-5 py-3 text-sm font-semibold text-slate-100 backdrop-blur-sm transition hover:border-blue-300/50 hover:bg-[#122035]"
                    >
                      Import Existing Lyrics
                    </button>
                  </div>
                </div>

                <div className="absolute bottom-7 right-8 hidden max-w-[300px] text-right xl:block">
                  <p className="font-serif text-2xl italic leading-relaxed text-white/75">More than music.</p>
                  <p className="mt-1 text-sm font-medium tracking-wide text-amber-200/75">A story. A feeling. A version of you.</p>
                </div>
              </div>

              <div className="grid border-t border-slate-700/60 bg-[#09131f]/95 sm:grid-cols-5">
                <div className="flex items-center gap-3 px-5 py-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-300/30 bg-amber-300/10 text-lg text-amber-300">✦</span>
                  <div><p className="text-sm font-semibold text-slate-100">Create</p><p className="text-[11px] text-slate-500">Idea or import</p></div>
                </div>
                <div className="flex items-center gap-3 border-t border-slate-800 px-5 py-4 sm:border-l sm:border-t-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose-300/30 bg-rose-300/10 text-lg text-rose-300">✎</span>
                  <div><p className="text-sm font-semibold text-slate-100">Prepare</p><p className="text-[11px] text-slate-500">Lyrics & song</p></div>
                </div>
                <div className="flex items-center gap-3 border-t border-slate-800 px-5 py-4 sm:border-l sm:border-t-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-sky-300/30 bg-sky-300/10 text-lg text-sky-300">▣</span>
                  <div><p className="text-sm font-semibold text-slate-100">Media</p><p className="text-[11px] text-slate-500">Visuals, audio, video</p></div>
                </div>
                <div className="flex items-center gap-3 border-t border-slate-800 px-5 py-4 sm:border-l sm:border-t-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-indigo-300/30 bg-indigo-300/10 text-lg text-indigo-300">↗</span>
                  <div><p className="text-sm font-semibold text-slate-100">Publish</p><p className="text-[11px] text-slate-500">Share to platforms</p></div>
                </div>
                <div className="flex items-center gap-3 border-t border-slate-800 px-5 py-4 sm:border-l sm:border-t-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-300/10 text-lg text-emerald-300">▥</span>
                  <div><p className="text-sm font-semibold text-slate-100">Analyse</p><p className="text-[11px] text-slate-500">Track performance</p></div>
                </div>
              </div>
            </header>

            <section hidden={workspaceView !== "home"} aria-label="Workspace overview" className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                {
                  label: "Songs",
                  value: projects.length,
                  note: "Saved projects",
                  accent: "from-blue-500/14 to-blue-500/[0.02]",
                },
                {
                  label: "Full lyrics",
                  value: projects.filter((project) =>
                    project.status === "song-generated" || project.status === "lyrics-imported"
                  ).length,
                  note: "Ready for release prep",
                  accent: "from-sky-500/14 to-sky-500/[0.02]",
                },
                {
                  label: "In progress",
                  value: projects.filter((project) =>
                    project.status !== "song-generated" && project.status !== "lyrics-imported"
                  ).length,
                  note: "Still being shaped",
                  accent: "from-amber-400/12 to-amber-400/[0.03]",
                },
                {
                  label: "Current",
                  value: activeProjectId ? "Open" : "—",
                  note: songTitle || (activeProjectId ? "Song in progress" : "No song selected"),
                  accent: "from-emerald-400/12 to-emerald-400/[0.03]",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className={`rounded-[22px] border border-white/[0.07] bg-gradient-to-br ${item.accent} p-4 shadow-[0_18px_50px_-40px_rgba(0,0,0,1)]`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">{item.label}</p>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <p className="text-2xl font-semibold tracking-[-0.03em] text-white">{item.value}</p>
                    <span className="truncate text-right text-[11px] text-zinc-500">{item.note}</span>
                  </div>
                </div>
              ))}
            </section>

            <section hidden={workspaceView !== "home"} className="mb-6 grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
              <div className="rounded-[26px] border border-slate-800 bg-[#0d1825] p-6 sm:p-7">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-sky-300/70">Current workspace</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">
                  {activeProjectId ? songTitle || "Song in progress" : "Start your next release"}
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  {activeProjectId
                    ? lyrics
                      ? "Your lyrics are ready. Move through production, visuals, media and social preparation without one long scrolling page."
                      : "Your project is open. Continue shaping the song, choose the direction and complete the lyrics."
                    : "Create from an idea or import completed lyrics. Both paths merge into the same release workflow."}
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  {activeProjectId ? (
                    <button type="button" onClick={() => navigateWorkspace("song")} className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-400">
                      Open Song Studio
                    </button>
                  ) : (
                    <button type="button" onClick={() => navigateWorkspace("start")} className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-400">
                      Start a Song
                    </button>
                  )}
                  <button type="button" onClick={() => navigateWorkspace("library")} className="rounded-xl border border-slate-700 bg-[#111c2b] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800">
                    My Songs
                  </button>
                </div>
              </div>

              <div className="rounded-[26px] border border-slate-800 bg-[#0d1825] p-6 sm:p-7">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300/70">Quick actions</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {[
                    ["Song Studio", "song", !activeProjectId],
                    ["Production", "production", !lyrics],
                    ["Visuals", "visuals", !lyrics],
                    ["Media", "media", !activeProjectId || !lyrics],
                  ].map(([label, view, disabled]) => (
                    <button
                      key={String(label)}
                      type="button"
                      disabled={Boolean(disabled)}
                      onClick={() => navigateWorkspace(view as WorkspaceView)}
                      className="rounded-2xl border border-slate-800 bg-[#111c2b] px-4 py-4 text-left text-sm font-semibold text-slate-200 transition hover:border-blue-400/30 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                      {String(label)}
                    </button>
                  ))}
                </div>
              </div>
            </section>

        <section hidden={workspaceView !== "start"} id="song-start-section" className="scroll-mt-24 rounded-[30px] border border-white/[0.09] bg-gradient-to-br from-[#0d1724] to-[#09121e] p-5 shadow-[0_28px_90px_-52px_rgba(0,0,0,1)] sm:p-8 lg:p-9">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold">
              {activeProjectId
                ? "Continue your song"
                : "Start a new song"}
            </h2>

            <p className="mt-2 text-zinc-400">
              {activeProjectId
                ? "Your saved project is open and ready to continue."
                : "Give me the emotion, memory or story. I'll help you turn it into a song."}
            </p>
          </div>

          <div className="mb-8 grid grid-cols-2 gap-2 rounded-[20px] border border-white/[0.07] bg-black/30 p-2">

            <button
              type="button"
              onClick={() => {
                setCreationMode("generate");
                setError("");
              }}
              className={
                creationMode === "generate"
                  ? "rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-3 font-semibold text-white shadow-[0_12px_28px_-16px_rgba(59,130,246,.75)]"
                  : "rounded-xl px-4 py-3 font-semibold text-zinc-500 transition hover:bg-white/[0.05] hover:text-white"
              }
            >
              Create from Idea
            </button>

            <button
              type="button"
              onClick={() => {
                setCreationMode("import");
                setError("");
              }}
              className={
                creationMode === "import"
                  ? "rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-3 font-semibold text-white shadow-[0_12px_28px_-16px_rgba(59,130,246,.75)]"
                  : "rounded-xl px-4 py-3 font-semibold text-zinc-500 transition hover:bg-white/[0.05] hover:text-white"
              }
            >
              Import Existing Lyrics
            </button>

          </div>

          {creationMode === "generate" && (
          <div className="space-y-7">
            <div>
              <label className="mb-3 block text-sm font-medium text-zinc-300">
                What&apos;s your song about?
              </label>

              <textarea
                value={idea}
                onChange={(e) =>
                  setIdea(e.target.value)
                }
                placeholder="Example: Two people meet again after many years and realize that some memories never really leave us..."
                className="min-h-36 w-full resize-none rounded-2xl border border-zinc-700 bg-zinc-950 p-5 text-white outline-none transition focus:border-zinc-400"
              />
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-zinc-400">
                  Language
                </label>

                <select
                  value={language}
                  onChange={(e) =>
                    setLanguage(e.target.value)
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"
                >
                  <option>Hindi</option>
                  <option>Bengali</option>
                  <option>English</option>
                  <option>Punjabi</option>
                  <option>Urdu</option>
                  <option>Marathi</option>
                  <option>Tamil</option>
                  <option>Telugu</option>
                  <option>Kannada</option>
                  <option>Malayalam</option>
                  <option>Gujarati</option>
                  <option>Other</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-zinc-400">
                  Script
                </label>

                <select
                  value={script}
                  onChange={(e) =>
                    setScript(e.target.value)
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"
                >
                  <option>Native</option>
                  <option>Roman</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-zinc-400">
                  Mood
                </label>

                <select
                  value={mood}
                  onChange={(e) =>
                    setMood(e.target.value)
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"
                >
                  <option>Emotional</option>
                  <option>Romantic</option>
                  <option>Nostalgic</option>
                  <option>Heartbreak</option>
                  <option>Hopeful</option>
                  <option>Philosophical</option>
                  <option>Happy</option>
                  <option>Melancholic</option>
                  <option>Motivational</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-zinc-400">
                  Musical style
                </label>

                <select
                  value={genre}
                  onChange={(e) =>
                    setGenre(e.target.value)
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"
                >
                  <option>Modern Bollywood</option>
                  <option>Soft Indie</option>
                  <option>Indie Lo-fi</option>
                  <option>Acoustic Ballad</option>
                  <option>Ghazal</option>
                  <option>Contemporary Pop</option>
                  <option>Cinematic</option>
                  <option>Folk Fusion</option>
                </select>
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-300">
                  Creative freedom
                </label>

                <span className="text-sm text-zinc-400">
                  {freedom < 34
                    ? "Safe"
                    : freedom < 67
                    ? "Creative"
                    : "Surprise me"}
                </span>
              </div>

              <input
                type="range"
                min="0"
                max="100"
                value={freedom}
                onChange={(e) =>
                  setFreedom(
                    Number(e.target.value)
                  )
                }
                className="w-full"
              />

              <div className="mt-2 flex justify-between text-xs text-zinc-500">
                <span>
                  Stay close to my idea
                </span>

                <span>
                  Challenge me
                </span>
              </div>
            </div>

            <button
              onClick={buildSong}
              disabled={loading}
              className="w-full rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-600 px-6 py-4 text-lg font-bold text-white shadow-[0_18px_40px_-18px_rgba(59,130,246,.75)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? "Building..."
                : "Build My Song"}
            </button>
          </div>

          )}

          {creationMode === "import" && (
            <div className="space-y-7">

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                <p className="font-semibold text-white">
                  Already have the complete lyrics?
                </p>

                <p className="mt-2 text-sm leading-6 text-zinc-400">
                  Paste them here. Studio will save them as a completed
                  song without generating hooks or rewriting anything.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm text-zinc-400">
                  Song Title *
                </label>

                <input
                  type="text"
                  value={importTitle}
                  onChange={(e) =>
                    setImportTitle(e.target.value)
                  }
                  placeholder="Enter song title"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-white outline-none focus:border-zinc-400"
                />
              </div>

              <div className="grid gap-5 md:grid-cols-2">

                <div>
                  <label className="mb-2 block text-sm text-zinc-400">
                    Language
                  </label>

                  <select
                    value={language}
                    onChange={(e) =>
                      setLanguage(e.target.value)
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"
                  >
                    <option>Hindi</option>
                    <option>Bengali</option>
                    <option>English</option>
                    <option>Punjabi</option>
                    <option>Urdu</option>
                    <option>Marathi</option>
                    <option>Tamil</option>
                    <option>Telugu</option>
                    <option>Kannada</option>
                    <option>Malayalam</option>
                    <option>Gujarati</option>
                    <option>Other</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-400">
                    Script
                  </label>

                  <select
                    value={script}
                    onChange={(e) =>
                      setScript(e.target.value)
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"
                  >
                    <option>Native</option>
                    <option>Roman</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-400">
                    Mood
                  </label>

                  <select
                    value={importMood}
                    onChange={(e) =>
                      setImportMood(e.target.value)
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"
                  >
                    <option value="">Not specified</option>
                    <option>Emotional</option>
                    <option>Romantic</option>
                    <option>Nostalgic</option>
                    <option>Heartbreak</option>
                    <option>Hopeful</option>
                    <option>Philosophical</option>
                    <option>Happy</option>
                    <option>Melancholic</option>
                    <option>Motivational</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-zinc-400">
                    Musical Style
                  </label>

                  <select
                    value={importGenre}
                    onChange={(e) =>
                      setImportGenre(e.target.value)
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"
                  >
                    <option value="">Not specified</option>
                    <option>Modern Bollywood</option>
                    <option>Soft Indie</option>
                    <option>Indie Lo-fi</option>
                    <option>Acoustic Ballad</option>
                    <option>Ghazal</option>
                    <option>Contemporary Pop</option>
                    <option>Cinematic</option>
                    <option>Folk Fusion</option>
                  </select>
                </div>

              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-4">
                  <label className="text-sm text-zinc-400">
                    Complete Lyrics *
                  </label>

                  <span className="text-xs text-zinc-600">
                    {importLyrics.length.toLocaleString()} characters
                  </span>
                </div>

                <textarea
                  value={importLyrics}
                  onChange={(e) =>
                    setImportLyrics(e.target.value)
                  }
                  placeholder="Paste your complete song lyrics here..."
                  className="min-h-[420px] w-full resize-y rounded-2xl border border-zinc-700 bg-zinc-950 p-5 leading-7 text-white outline-none focus:border-zinc-400"
                />
              </div>

              <button
                type="button"
                onClick={importExistingLyrics}
                disabled={
                  importLoading ||
                  !importTitle.trim() ||
                  !importLyrics.trim()
                }
                className="w-full rounded-2xl bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-600 px-6 py-4 text-lg font-bold text-white shadow-[0_18px_40px_-18px_rgba(59,130,246,.75)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importLoading
                  ? "Saving Lyrics..."
                  : "Save & Open in Studio"}
              </button>

            </div>
          )}

        </section>

        {error && (
          <div className="mt-6 rounded-2xl border border-red-900 bg-red-950/40 p-4 text-red-300">
            {error}
          </div>
        )}

        {built &&
          activeProjectStatus !== "lyrics-imported" && (

          <section hidden={workspaceView !== "song"} className="rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7">
            <SectionHeader
              eyebrow="Step 1"
              title="Song Direction"
              subtitle={
                selectedHook
                  ? "Your selected hook and creative directions."
                  : "Choose the emotional heart of the song."
              }
              open={hooksOpen}
              onToggle={() =>
                setHooksOpen(
                  (value) => !value
                )
              }
              badge={
                selectedHook
                  ? "Hook Selected"
                  : hooks.length
                  ? "3 Hooks"
                  : undefined
              }
            />

            {hooksOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">
                <div className="grid gap-4 md:grid-cols-3">
                  {[0, 1, 2].map(
                    (index) => {
                      const hook =
                        hooks[index];

                      const isSelected =
                        selectedHook === hook;

                      return (
                        <div
                          key={index}
                          className={`rounded-2xl border p-5 ${
                            isSelected
                              ? "border-white bg-zinc-800"
                              : "border-zinc-700 bg-zinc-950"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-zinc-500">
                              Hook 0
                              {index + 1}
                            </p>

                            {isSelected && (
                              <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                                Selected
                              </span>
                            )}
                          </div>

                          <p className="mt-4 whitespace-pre-line text-lg text-zinc-300">
                            {loading
                              ? "Creating..."
                              : hook ||
                                "This creative direction will appear here."}
                          </p>

                          {hook && !loading && (
                            <button
                              onClick={() =>
                                chooseHook(hook)
                              }
                              disabled={
                                savingHook
                              }
                              className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-medium transition ${
                                isSelected
                                  ? "bg-white text-black"
                                  : "border border-zinc-700 hover:bg-zinc-800"
                              } disabled:opacity-50`}
                            >
                              {isSelected
                                ? "✓ Selected Hook"
                                : savingHook
                                ? "Saving..."
                                : "Choose This Hook"}
                            </button>
                          )}
                        </div>
                      );
                    }
                  )}
                </div>

                {selectedHook && (
                  <div className="mt-7 rounded-2xl border border-zinc-700 bg-zinc-950 p-6">
                    <p className="text-sm uppercase tracking-widest text-zinc-500">
                      Selected direction
                    </p>

                    <p className="mt-3 whitespace-pre-line text-lg text-zinc-200">
                      {selectedHook}
                    </p>

                    <button
                      onClick={
                        generateFullSong
                      }
                      disabled={
                        generatingSong
                      }
                      className="mt-5 w-full rounded-xl bg-white px-5 py-4 font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {generatingSong
                        ? "Writing Your Song..."
                        : lyrics
                        ? "Generate Another Version"
                        : "Generate Full Song"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {lyrics && (
          <section
            hidden={workspaceView !== "song"}
            id="full-song-section"
            className="mt-6 scroll-mt-24 rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7"
          >
            <SectionHeader
              eyebrow="Song"
              title={
                songTitle ||
                "Untitled Song"
              }
              subtitle="Click any lyric line or analyse an entire section."
              open={fullSongOpen}
              onToggle={() =>
                setFullSongOpen(
                  (value) => !value
                )
              }
              badge="Current Version"
            />

            {fullSongOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">

                {alternativeMessage && (
                  <div className="mb-4 rounded-xl border border-green-900 bg-green-950/30 px-4 py-3 text-sm text-green-300">
                    {alternativeMessage}
                  </div>
                )}

                <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
                  💡 Click a lyric line to analyse that line, or use{" "}
                  <span className="font-semibold text-zinc-200">
                    Analyse Section
                  </span>{" "}
                  to inspect the whole stanza.
                </div>

                <div className="space-y-5">
                  {parsedSong.map(
                    (section, sectionIndex) => {
                      const sectionText =
                        section.lines.join("\n");

                      const sectionOccurrenceIndex =
                        parsedSong
                          .slice(0, sectionIndex)
                          .filter(
                            (earlierSection) =>
                              earlierSection.lines.join("\n") ===
                              sectionText
                          ).length;

                      return (
                        <div
                          key={`${section.label}-${sectionIndex}`}
                          className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900 px-5 py-4">
                            <h3 className="font-semibold text-zinc-200">
                              [{section.label}]
                            </h3>

                            <button
                              type="button"
                              onClick={() =>
                                selectLyricsForAnalysis(
                                  sectionText,
                                  sectionOccurrenceIndex
                                )
                              }
                              className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-800"
                            >
                              Analyse Section
                            </button>
                          </div>

                          <div className="p-3">
                            {section.lines.map(
                              (line, lineIndex) => {
                                let lineOccurrenceIndex = 0;

                                for (
                                  let earlierSectionIndex = 0;
                                  earlierSectionIndex <= sectionIndex;
                                  earlierSectionIndex++
                                ) {
                                  const earlierLines =
                                    parsedSong[
                                      earlierSectionIndex
                                    ].lines;

                                  const lineLimit =
                                    earlierSectionIndex ===
                                    sectionIndex
                                      ? lineIndex
                                      : earlierLines.length;

                                  for (
                                    let earlierLineIndex = 0;
                                    earlierLineIndex <
                                    lineLimit;
                                    earlierLineIndex++
                                  ) {
                                    if (
                                      earlierLines[
                                        earlierLineIndex
                                      ] === line
                                    ) {
                                      lineOccurrenceIndex++;
                                    }
                                  }
                                }

                                return (
                                <button
                                  key={`${sectionIndex}-${lineIndex}`}
                                  type="button"
                                  onClick={() =>
                                    selectLyricsForAnalysis(
                                      line,
                                      lineOccurrenceIndex
                                    )
                                  }
                                  className="group flex w-full items-center justify-between gap-5 rounded-xl px-4 py-2 text-left transition hover:bg-zinc-900"
                                >
                                  <span className="text-lg leading-8 text-zinc-200">
                                    {line}
                                  </span>

                                  <span className="shrink-0 text-xs text-zinc-600 opacity-0 transition group-hover:opacity-100">
                                    Analyse →
                                  </span>
                                </button>
                                );
                              }
                            )}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <button
                    onClick={runCriticMode}
                    disabled={criticLoading}
                    className="rounded-xl bg-white px-5 py-4 font-semibold text-black transition hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {criticLoading
                      ? "Analysing Song..."
                      : critique
                      ? "Run Critic Again"
                      : "Critic Mode"}
                  </button>

                  <button
                    onClick={openWhyThisLine}
                    className="rounded-xl border border-zinc-700 px-5 py-4 font-semibold hover:bg-zinc-800"
                  >
                    Why This Line?
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {lyrics && (
          <section
            hidden={workspaceView !== "production"}
            id="suno-styles-section"
            className="mt-6 scroll-mt-24 rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7"
          >
            <SectionHeader
              eyebrow="Production"
              title="Suno Styles"
              subtitle="Generate different musical directions for this song, ready to copy into Suno."
              open={sunoStylesOpen}
              onToggle={() =>
                setSunoStylesOpen((value) => !value)
              }
              badge={
                sunoStyles.length
                  ? `${sunoStyles.length} Styles`
                  : undefined
              }
            />

            {sunoStylesOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">
                {sunoStylesError && (
                  <div className="mb-5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                    {sunoStylesError}
                  </div>
                )}

                {sunoStyles.length === 0 ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                    <p className="text-zinc-300">
                      Let the Studio analyse the complete song and create
                      5–8 genuinely different production directions for Suno.
                    </p>

                    <p className="mt-2 text-sm leading-6 text-zinc-500">
                      Each prompt can use up to 1,000 characters and may
                      describe vocal character, melody, tempo, instrumentation,
                      arrangement, chorus treatment, production texture and
                      elements to avoid.
                    </p>

                    <button
                      type="button"
                      onClick={generateSunoStyles}
                      disabled={sunoStylesLoading}
                      className="mt-5 rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sunoStylesLoading
                        ? "Creating Suno Styles..."
                        : "Generate Suno Styles"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-zinc-400">
                        Choose a musical direction and copy the prompt directly
                        into Suno.
                      </p>

                      <button
                        type="button"
                        onClick={generateSunoStyles}
                        disabled={sunoStylesLoading}
                        className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                      >
                        {sunoStylesLoading
                          ? "Generating..."
                          : "Generate New Styles"}
                      </button>
                    </div>

                    {sunoStyles.map((style, index) => (
                      <div
                        key={`${style.name}-${index}`}
                        className={`rounded-2xl border p-6 ${
                          style.recommended
                            ? "border-zinc-500 bg-zinc-950"
                            : "border-zinc-800 bg-zinc-950"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-semibold text-white">
                                {style.name}
                              </h3>

                              {style.recommended && (
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black">
                                  ★ Recommended
                                </span>
                              )}

                              <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-400">
                                {style.category}
                              </span>
                            </div>

                            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                              {style.whyItFits}
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
                          <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">
                            {style.prompt}
                          </p>

                          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                            <span className="text-xs text-zinc-600">
                              {style.prompt.length} / 1000 characters
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                copySunoStyle(style.prompt, index)
                              }
                              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200"
                            >
                              {copiedSunoStyleIndex === index
                                ? "✓ Copied"
                                : "Copy for Suno"}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {lyrics && (
          <section
            hidden={workspaceView !== "visuals"}
            id="image-studio-section"
            className="mt-6 scroll-mt-24 rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7"
          >
            <SectionHeader
              eyebrow="Release Kit"
              title="Image Studio"
              subtitle="Create visual directions from the song title, complete lyrics and your own creative ideas."
              open={imageStudioOpen}
              onToggle={() =>
                setImageStudioOpen((value) => !value)
              }
              badge={
                visualConcepts.length
                  ? `${visualConcepts.length} Concepts`
                  : undefined
              }
            />

            {imageStudioOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">
                {imageStudioError && (
                  <div className="mb-5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                    {imageStudioError}
                  </div>
                )}

                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-zinc-600">
                        Song
                      </p>
                      <p className="mt-2 text-sm font-semibold text-zinc-200">
                        {songTitle || "Untitled Song"}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-widest text-zinc-600">
                        Language
                      </p>
                      <p className="mt-2 text-sm text-zinc-300">
                        {language}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-widest text-zinc-600">
                        Mood
                      </p>
                      <p className="mt-2 text-sm text-zinc-300">
                        {mood}
                      </p>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-widest text-zinc-600">
                        Genre
                      </p>
                      <p className="mt-2 text-sm text-zinc-300">
                        {genre}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6">
                    <label className="text-sm font-semibold text-zinc-200">
                      Your Visual Ideas{" "}
                      <span className="font-normal text-zinc-500">
                        (Optional)
                      </span>
                    </label>

                    <textarea
                      value={visualIdeas}
                      onChange={(event) =>
                        setVisualIdeas(event.target.value)
                      }
                      rows={4}
                      placeholder="Example: I want an 80s/90s Bengali nostalgic feel, warm daylight, no dark poster, couple seen from behind..."
                      className="mt-3 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                    />

                    <p className="mt-2 text-xs leading-5 text-zinc-600">
                      Studio will always analyse the song title and complete
                      lyrics. Your notes are additional creative direction,
                      not a replacement for the song analysis.
                    </p>
                  </div>

                  <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                    <div>
                      <h3 className="text-sm font-semibold text-zinc-200">
                        Text on Image{" "}
                        <span className="font-normal text-zinc-500">
                          (Optional)
                        </span>
                      </h3>

                      <p className="mt-2 text-xs leading-5 text-zinc-600">
                        Typography will be added separately after the clean
                        artwork is generated, so titles and Bengali/Hindi text
                        remain accurate.
                      </p>
                    </div>

                    <div className="mt-5 space-y-4">
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={imageUseSongTitle}
                          onChange={(event) =>
                            setImageUseSongTitle(event.target.checked)
                          }
                          className="h-4 w-4"
                        />

                        <span className="text-sm text-zinc-300">
                          Use Song Title
                        </span>
                      </label>

                      <div>
                        <label className="text-sm font-medium text-zinc-300">
                          Custom Text
                        </label>

                        <input
                          type="text"
                          value={imageCustomText}
                          onChange={(event) =>
                            setImageCustomText(event.target.value)
                          }
                          placeholder="Example: তুই আছিস বলেই..."
                          className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                        />

                        <p className="mt-2 text-xs text-zinc-600">
                          Leave blank if you only want the song title.
                        </p>
                      </div>

                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={imageIncludeBranding}
                          onChange={(event) =>
                            setImageIncludeBranding(event.target.checked)
                          }
                          className="h-4 w-4"
                        />

                        <span className="text-sm text-zinc-300">
                          Add “Suno Zara Original”
                        </span>
                      </label>

                      <div>
                        <label className="text-sm font-medium text-zinc-300">
                          Main Text Position
                        </label>

                        <select
                          value={imageTextPosition}
                          onChange={(event) =>
                            setImageTextPosition(
                              event.target.value as
                                | "top"
                                | "center"
                                | "bottom"
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 outline-none transition focus:border-zinc-600"
                        >
                          <option value="top">Top</option>
                          <option value="center">Centre</option>
                          <option value="bottom">Bottom</option>
                        </select>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="text-sm font-medium text-zinc-300">
                            Font Style
                          </label>

                          <select
                            value={imageFontStyle}
                            onChange={(event) =>
                              setImageFontStyle(
                                event.target.value as
                                  | "minimal"
                                  | "elegant"
                                  | "cinematic"
                                  | "retro"
                                  | "handwritten"
                              )
                            }
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 outline-none transition focus:border-zinc-600"
                          >
                            <option value="cinematic">Cinematic</option>
                            <option value="elegant">Elegant</option>
                            <option value="retro">Retro</option>
                            <option value="handwritten">Handwritten</option>
                            <option value="minimal">Minimal</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-sm font-medium text-zinc-300">
                            Font Size
                          </label>

                          <select
                            value={imageFontSize}
                            onChange={(event) =>
                              setImageFontSize(
                                event.target.value as
                                  | "small"
                                  | "medium"
                                  | "large"
                                  | "xlarge"
                              )
                            }
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 outline-none transition focus:border-zinc-600"
                          >
                            <option value="small">Small</option>
                            <option value="medium">Medium</option>
                            <option value="large">Large</option>
                            <option value="xlarge">Extra Large</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={generateVisualConcepts}
                    disabled={visualConceptsLoading}
                    className="mt-5 rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {visualConceptsLoading
                      ? "Creating Visual Concepts..."
                      : visualConcepts.length
                      ? "Generate 3 New Concepts"
                      : "Generate 3 Visual Concepts"}
                  </button>
                </div>

                {visualConcepts.length > 0 && (
                  <div className="mt-6">
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-white">
                        Choose a Visual Direction
                      </h3>
                      <p className="mt-1 text-sm text-zinc-500">
                        These concepts were created from the complete song.
                        Choose one before generating the final artwork.
                      </p>
                    </div>

                    <div className="grid gap-5 lg:grid-cols-3">
                      {visualConcepts.map((concept) => {
                        const isSelected =
                          selectedVisualConceptId === concept.id;

                        return (
                          <div
                            key={concept.id}
                            className={`flex flex-col rounded-2xl border p-5 transition ${
                              isSelected
                                ? "border-white bg-zinc-900"
                                : "border-zinc-800 bg-zinc-950"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="rounded-full border border-zinc-700 px-3 py-1 text-xs text-zinc-500">
                                Concept {concept.conceptNumber}
                              </span>

                              {isSelected && (
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black">
                                  ✓ Selected
                                </span>
                              )}
                            </div>

                            <h4 className="mt-5 text-lg font-semibold text-white">
                              {concept.title}
                            </h4>

                            <p className="mt-3 flex-1 text-sm leading-6 text-zinc-400">
                              {concept.description}
                            </p>

                            <details className="mt-5 rounded-xl border border-zinc-800 bg-zinc-900/60">
                              <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-zinc-400">
                                View Image Direction
                              </summary>
                              <p className="border-t border-zinc-800 px-4 py-4 text-xs leading-6 text-zinc-500">
                                {concept.imagePrompt}
                              </p>
                            </details>

                            <button
                              type="button"
                              onClick={() =>
                                chooseVisualConcept(concept.id)
                              }
                              className={`mt-5 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                                isSelected
                                  ? "bg-white text-black"
                                  : "border border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                              }`}
                            >
                              {isSelected
                                ? "✓ Visual Direction Selected"
                                : "Choose This Concept"}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {selectedVisualConceptId && (
                      <div className="mt-6 rounded-2xl border border-zinc-700 bg-zinc-950 p-6">
                        <p className="text-sm font-semibold text-white">
                          Visual direction selected.
                        </p>
                        <p className="mt-2 text-sm leading-6 text-zinc-400">
                          Next we will generate 3 separate 16:9 YouTube
                          images and 6 separate 9:16 images for
                          YouTube Shorts, Instagram Reels and TikTok.
                        </p>

                        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                          <button
                            type="button"
                            onClick={() =>
                              generateArtworkBatch("youtube", 3)
                            }
                            disabled={generatingImage}
                            className="rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {generatingImage
                              ? "Generating Artwork..."
                              : "Generate 3 YouTube Images"}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              generateArtworkBatch("shorts", 6)
                            }
                            disabled={generatingImage}
                            className="rounded-xl border border-zinc-700 px-5 py-3 font-semibold text-zinc-200 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {generatingImage
                              ? "Generating Artwork..."
                              : "Generate 6 Vertical Images"}
                          </button>
                        </div>

                        {generatingImageProgress && (
                          <p className="mt-3 text-sm text-zinc-400">
                            {generatingImageProgress}
                          </p>
                        )}

                        {generatedImages.length > 0 && (() => {
                          const setNumbers = Array.from(
                            new Set(
                              generatedImages
                                .map((image) => image.imageSetNumber)
                                .filter(
                                  (value): value is number =>
                                    typeof value === "number"
                                )
                            )
                          ).sort((a, b) => b - a);

                          const currentSetNumber =
                            setNumbers.length > 0
                              ? setNumbers[0]
                              : null;

                          const previousSetNumbers =
                            currentSetNumber === null
                              ? []
                              : setNumbers.filter(
                                  (number) =>
                                    number !== currentSetNumber
                                );

                          const legacyImages =
                            generatedImages.filter(
                              (image) =>
                                typeof image.imageSetNumber !==
                                "number"
                            );

                          const renderImageCollection = (
                            images: typeof generatedImages
                          ) => (
                            <div className="space-y-8">
                              {images.some(
                                (image) =>
                                  image.format === "youtube"
                              ) && (
                                <div>
                                  <div className="mb-4">
                                    <h5 className="text-sm font-semibold text-white">
                                      YouTube Artwork — 16:9
                                    </h5>
                                  </div>

                                  <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                                    {images
                                      .filter(
                                        (image) =>
                                          image.format === "youtube"
                                      )
                                      .sort(
                                        (a, b) =>
                                          a.imageNumber -
                                          b.imageNumber
                                      )
                                      .map((image) => (
                                        <div
                                          key={image.id}
                                          className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
                                        >
                                          <img
                                            src={image.url}
                                            alt={`YouTube artwork ${image.imageNumber}`}
                                            className="block aspect-video w-full object-cover"
                                          />

                                          <div className="p-4">
                                            <p className="text-sm font-semibold text-white">
                                              YouTube Image{" "}
                                              {image.imageNumber}
                                            </p>

                                            <button
                                              type="button"
                                              onClick={() =>
                                                downloadGeneratedImage(
                                                  image
                                                )
                                              }
                                              className="mt-4 w-full rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
                                            >
                                              Download Image
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}

                              {images.some(
                                (image) =>
                                  image.format === "shorts"
                              ) && (
                                <div>
                                  <div className="mb-4">
                                    <h5 className="text-sm font-semibold text-white">
                                      Shorts / Reels / TikTok — 9:16
                                    </h5>
                                  </div>

                                  <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                                    {images
                                      .filter(
                                        (image) =>
                                          image.format === "shorts"
                                      )
                                      .sort(
                                        (a, b) =>
                                          a.imageNumber -
                                          b.imageNumber
                                      )
                                      .map((image) => (
                                        <div
                                          key={image.id}
                                          className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900"
                                        >
                                          <img
                                            src={image.url}
                                            alt={`Vertical artwork ${image.imageNumber}`}
                                            className="block aspect-[9/16] w-full object-cover"
                                          />

                                          <div className="p-4">
                                            <p className="text-sm font-semibold text-white">
                                              Vertical Image{" "}
                                              {image.imageNumber}
                                            </p>

                                            <p className="mt-1 text-xs text-zinc-500">
                                              YouTube Shorts ·
                                              Instagram Reels · TikTok
                                            </p>

                                            <button
                                              type="button"
                                              onClick={() =>
                                                downloadGeneratedImage(
                                                  image
                                                )
                                              }
                                              className="mt-4 w-full rounded-xl border border-zinc-700 px-4 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
                                            >
                                              Download Image
                                            </button>
                                          </div>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          );

                          return (
                            <div className="mt-8 space-y-8">
                              {currentSetNumber !== null && (
                                <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-5">
                                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <h4 className="text-base font-semibold text-white">
                                        Current Generation
                                      </h4>

                                      <p className="mt-1 text-xs text-zinc-500">
                                        Image Set{" "}
                                        {currentSetNumber}
                                      </p>
                                    </div>

                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black">
                                      Current
                                    </span>
                                  </div>

                                  {renderImageCollection(
                                    generatedImages.filter(
                                      (image) =>
                                        image.imageSetNumber ===
                                        currentSetNumber
                                    )
                                  )}
                                </div>
                              )}

                              {previousSetNumbers.length > 0 && (
                                <div>
                                  <div className="mb-4">
                                    <h4 className="text-base font-semibold text-white">
                                      Previous Generations
                                    </h4>

                                    <p className="mt-1 text-xs text-zinc-500">
                                      Older image sets are preserved
                                      and remain downloadable.
                                    </p>
                                  </div>

                                  <div className="space-y-3">
                                    {previousSetNumbers.map(
                                      (setNumber) => {
                                        const setImages =
                                          generatedImages.filter(
                                            (image) =>
                                              image.imageSetNumber ===
                                              setNumber
                                          );

                                        return (
                                          <details
                                            key={setNumber}
                                            className="rounded-2xl border border-zinc-800 bg-zinc-950"
                                          >
                                            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-zinc-200">
                                              Image Set{" "}
                                              {setNumber} ·{" "}
                                              {setImages.length}{" "}
                                              {setImages.length === 1
                                                ? "image"
                                                : "images"}
                                            </summary>

                                            <div className="border-t border-zinc-800 p-5">
                                              {renderImageCollection(
                                                setImages
                                              )}
                                            </div>
                                          </details>
                                        );
                                      }
                                    )}
                                  </div>
                                </div>
                              )}

                              {legacyImages.length > 0 && (
                                <details className="rounded-2xl border border-zinc-800 bg-zinc-950">
                                  <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-zinc-300">
                                    Legacy Images ·{" "}
                                    {legacyImages.length}{" "}
                                    {legacyImages.length === 1
                                      ? "image"
                                      : "images"}
                                  </summary>

                                  <div className="border-t border-zinc-800 p-5">
                                    <p className="mb-5 text-xs leading-5 text-zinc-500">
                                      These images were generated
                                      before generation history was
                                      introduced. They are still saved
                                      and downloadable.
                                    </p>

                                    {renderImageCollection(
                                      legacyImages
                                    )}
                                  </div>
                                </details>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {lyrics && activeProjectId && (

          <section
            hidden={workspaceView !== "media"}
            id="media-upload-section"
            className="mt-6 scroll-mt-24 rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7"
          >
            <SectionHeader
              eyebrow="Release Kit"
              title="Media Upload"
              subtitle="Add the finished media files that will eventually be used for publishing."
              open={mediaUploadOpen}
              onToggle={() =>
                setMediaUploadOpen(
                  (value) => !value
                )
              }
              badge={
                finalAudioAsset &&
                youtubeVideoAsset
                  ? "Audio + Video Ready"
                  : finalAudioAsset
                  ? "Audio Ready"
                  : youtubeVideoAsset
                  ? "Video Ready"
                  : undefined
              }
            />

            {mediaUploadOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">

                <div className="mb-5 rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">Media storage</p>
                      <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-400">
                        Local Mac is the default and stores large files under <span className="font-mono text-cyan-200">sunozara-studio/local-media/</span>. Supabase remains available as an optional cloud fallback.
                      </p>
                    </div>
                    <div className="flex shrink-0 rounded-xl border border-zinc-800 bg-zinc-950 p-1">
                      <button type="button" onClick={() => setMediaStorageMode("local")} className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${mediaStorageMode === "local" ? "bg-cyan-400/15 text-cyan-200" : "text-zinc-500 hover:text-zinc-300"}`}>
                        This Mac · Default
                      </button>
                      <button type="button" onClick={() => setMediaStorageMode("supabase")} className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${mediaStorageMode === "supabase" ? "bg-indigo-400/15 text-indigo-200" : "text-zinc-500 hover:text-zinc-300"}`}>
                        Supabase Cloud
                      </button>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">

                  <div className="flex flex-wrap items-start justify-between gap-4">

                    <div>
                      <p className="text-lg font-semibold text-white">
                        Final Audio
                      </p>

                      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                        Upload the finished master for this song.
                        MP3, WAV, M4A and AAC are supported.
                        This file is stored privately and tied to
                        the current song.
                      </p>
                    </div>

                    {finalAudioAsset && (
                      <span className="rounded-full bg-emerald-950 px-3 py-1 text-xs font-semibold text-emerald-300">
                        ✓ Saved
                      </span>
                    )}

                  </div>

                  {finalAudioError && (
                    <div className="mt-5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                      {finalAudioError}
                    </div>
                  )}

                  {finalAudioStatus && (
                    <div className="mt-5 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">
                      {finalAudioStatus}
                    </div>
                  )}

                  {finalAudioLoading ? (
                    <p className="mt-6 text-sm text-zinc-500">
                      Loading saved Final Audio...
                    </p>
                  ) : finalAudioAsset ? (
                    <div className="mt-6 space-y-5">

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">

                        <div className="flex flex-wrap items-center justify-between gap-4">

                          <div className="min-w-0">
                            <p className="text-xs uppercase tracking-widest text-zinc-500">
                              Saved master
                            </p>

                            <p className="mt-2 break-all font-medium text-zinc-100">
                              {finalAudioAsset.originalFilename}
                            </p>

                            <p className="mt-1 text-[11px] font-semibold text-cyan-300/80">
                              {finalAudioAsset.storageProvider === "local" ? "This Mac · local-media" : "Supabase Cloud"}
                            </p>

                            {finalAudioAsset.sizeBytes ? (
                              <p className="mt-1 text-xs text-zinc-500">
                                {formatMediaBytes(
                                  finalAudioAsset.sizeBytes
                                )}
                              </p>
                            ) : null}
                          </div>

                          {finalAudioAsset.downloadUrl && (
                            <a
                              href={
                                finalAudioAsset.downloadUrl
                              }
                              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
                            >
                              Download
                            </a>
                          )}

                        </div>

                        <audio
                          key={finalAudioAsset.url}
                          controls
                          preload="metadata"
                          src={finalAudioAsset.url}
                          className="mt-5 w-full"
                        >
                          Your browser does not support audio playback.
                        </audio>

                      </div>

                      <div className="border-t border-zinc-800 pt-5">

                        <p className="mb-3 text-sm font-medium text-zinc-300">
                          Replace Final Audio
                        </p>

                        <input
                          type="file"
                          accept=".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac"
                          disabled={finalAudioUploading}
                          onChange={(e) => {
                            setFinalAudioFile(
                              e.target.files?.[0] ||
                                null
                            );
                            setFinalAudioError("");
                            setFinalAudioStatus("");
                          }}
                          className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-xl file:border-0 file:bg-zinc-800 file:px-4 file:py-3 file:font-semibold file:text-white hover:file:bg-zinc-700"
                        />

                        {finalAudioFile && (
                          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                            Selected:{" "}
                            <span className="font-medium text-white">
                              {finalAudioFile.name}
                            </span>
                            {" · "}
                            {formatMediaBytes(
                              finalAudioFile.size
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={uploadFinalAudio}
                          disabled={
                            finalAudioUploading ||
                            !finalAudioFile
                          }
                          className="mt-4 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {finalAudioUploading
                            ? "Uploading..."
                            : "Replace Final Audio"}
                        </button>

                      </div>

                    </div>
                  ) : (

                    <div className="mt-6">

                      <input
                        type="file"
                        accept=".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac"
                        disabled={finalAudioUploading}
                        onChange={(e) => {
                          setFinalAudioFile(
                            e.target.files?.[0] ||
                              null
                          );
                          setFinalAudioError("");
                          setFinalAudioStatus("");
                        }}
                        className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-xl file:border-0 file:bg-zinc-800 file:px-4 file:py-3 file:font-semibold file:text-white hover:file:bg-zinc-700"
                      />

                      {finalAudioFile && (
                        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                          Selected:{" "}
                          <span className="font-medium text-white">
                            {finalAudioFile.name}
                          </span>
                          {" · "}
                          {formatMediaBytes(
                            finalAudioFile.size
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={uploadFinalAudio}
                        disabled={
                          finalAudioUploading ||
                          !finalAudioFile
                        }
                        className="mt-4 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {finalAudioUploading
                          ? "Uploading..."
                          : "Upload Final Audio"}
                      </button>

                    </div>

                  )}

                </div>

                <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">

                  <div className="flex flex-wrap items-start justify-between gap-4">

                    <div>
                      <p className="text-lg font-semibold text-white">
                        Full YouTube Video
                      </p>

                      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                        Upload the finished landscape music video.
                        MP4 and MOV files are supported. Large
                        uploads use a resumable transfer with
                        automatic retries.
                      </p>
                    </div>

                    {youtubeVideoAsset && (
                      <span className="rounded-full bg-emerald-950 px-3 py-1 text-xs font-semibold text-emerald-300">
                        ✓ Saved
                      </span>
                    )}

                  </div>

                  {youtubeVideoError && (
                    <div className="mt-5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                      {youtubeVideoError}
                    </div>
                  )}

                  {youtubeVideoStatus && (
                    <div className="mt-5 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-200">
                      {youtubeVideoStatus}
                    </div>
                  )}

                  {youtubeVideoUploading && (
                    <div className="mt-5">
                      <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
                        <span>
                          Upload progress
                        </span>
                        <span>
                          {youtubeVideoProgress}%
                        </span>
                      </div>

                      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full bg-white transition-all duration-300"
                          style={{
                            width: `${youtubeVideoProgress}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {youtubeVideoLoading ? (
                    <p className="mt-6 text-sm text-zinc-500">
                      Loading saved YouTube video...
                    </p>
                  ) : youtubeVideoAsset ? (

                    <div className="mt-6 space-y-5">

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">

                        <div className="flex flex-wrap items-center justify-between gap-4">

                          <div className="min-w-0">
                            <p className="text-xs uppercase tracking-widest text-zinc-500">
                              Saved full video
                            </p>

                            <p className="mt-2 break-all font-medium text-zinc-100">
                              {youtubeVideoAsset.originalFilename}
                            </p>

                            <p className="mt-1 text-[11px] font-semibold text-cyan-300/80">
                              {youtubeVideoAsset.storageProvider === "local" ? "This Mac · local-media" : "Supabase Cloud"}
                            </p>

                            {youtubeVideoAsset.sizeBytes ? (
                              <p className="mt-1 text-xs text-zinc-500">
                                {formatMediaBytes(
                                  youtubeVideoAsset.sizeBytes
                                )}
                              </p>
                            ) : null}
                          </div>

                          {youtubeVideoAsset.downloadUrl && (
                            <a
                              href={
                                youtubeVideoAsset.downloadUrl
                              }
                              className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
                            >
                              Download
                            </a>
                          )}

                        </div>

                        <video
                          key={youtubeVideoAsset.url}
                          controls
                          preload="metadata"
                          src={youtubeVideoAsset.url}
                          className="mt-5 aspect-video w-full rounded-xl bg-black"
                        >
                          Your browser does not support video playback.
                        </video>

                      </div>

                      <div className="border-t border-zinc-800 pt-5">

                        <p className="mb-3 text-sm font-medium text-zinc-300">
                          Replace Full YouTube Video
                        </p>

                        <input
                          type="file"
                          accept=".mp4,.mov,video/mp4,video/quicktime"
                          disabled={youtubeVideoUploading}
                          onChange={(e) => {
                            setYoutubeVideoFile(
                              e.target.files?.[0] ||
                                null
                            );
                            setYoutubeVideoError("");
                            setYoutubeVideoStatus("");
                            setYoutubeVideoProgress(0);
                          }}
                          className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-xl file:border-0 file:bg-zinc-800 file:px-4 file:py-3 file:font-semibold file:text-white hover:file:bg-zinc-700"
                        />

                        {youtubeVideoFile && (
                          <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                            Selected:{" "}
                            <span className="font-medium text-white">
                              {youtubeVideoFile.name}
                            </span>
                            {" · "}
                            {formatMediaBytes(
                              youtubeVideoFile.size
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={uploadYoutubeVideo}
                          disabled={
                            youtubeVideoUploading ||
                            !youtubeVideoFile
                          }
                          className="mt-4 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {youtubeVideoUploading
                            ? `Uploading ${youtubeVideoProgress}%`
                            : "Replace Full YouTube Video"}
                        </button>

                      </div>

                    </div>

                  ) : (

                    <div className="mt-6">

                      <input
                        type="file"
                        accept=".mp4,.mov,video/mp4,video/quicktime"
                        disabled={youtubeVideoUploading}
                        onChange={(e) => {
                          setYoutubeVideoFile(
                            e.target.files?.[0] ||
                              null
                          );
                          setYoutubeVideoError("");
                          setYoutubeVideoStatus("");
                          setYoutubeVideoProgress(0);
                        }}
                        className="block w-full text-sm text-zinc-400 file:mr-4 file:rounded-xl file:border-0 file:bg-zinc-800 file:px-4 file:py-3 file:font-semibold file:text-white hover:file:bg-zinc-700"
                      />

                      {youtubeVideoFile && (
                        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
                          Selected:{" "}
                          <span className="font-medium text-white">
                            {youtubeVideoFile.name}
                          </span>
                          {" · "}
                          {formatMediaBytes(
                            youtubeVideoFile.size
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={uploadYoutubeVideo}
                        disabled={
                          youtubeVideoUploading ||
                          !youtubeVideoFile
                        }
                        className="mt-4 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {youtubeVideoUploading
                          ? `Uploading ${youtubeVideoProgress}%`
                          : "Upload Full YouTube Video"}
                      </button>

                    </div>

                  )}

                </div>

                <VerticalVideoManager projectId={activeProjectId!} storageMode={mediaStorageMode} />

                <FinalArtworkManager projectId={activeProjectId!} storageMode={mediaStorageMode} />

                <div className="mt-5 rounded-2xl border border-dashed border-zinc-800 px-5 py-4">
                  <p className="text-xs leading-5 text-zinc-500">
                    Local-first Media Hub: one shared Final Audio, Full Video,
                    up to 10 Vertical Shorts/Reels/TikTok clips and Final Artwork.
                    YouTube, Facebook, Instagram, TikTok and the DistroKid Release Pack all reference these same asset records; Supabase Storage is optional.
                  </p>
                </div>

              </div>
            )}

          </section>

        )}

        {lyrics && (
          <section
            hidden={workspaceView !== "social"}
            id="social-media-pack-section"
            className="mt-6 scroll-mt-24 rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7"
          >
            <SectionHeader
              eyebrow="Release Kit"
              title="Social Media Pack"
              subtitle="Generate platform-specific release copy and metadata from the complete song."
              open={socialMediaOpen}
              onToggle={() =>
                setSocialMediaOpen((value) => !value)
              }
              badge={
                youtubeFullPack
                  ? "YouTube Ready"
                  : undefined
              }
            />

            {socialMediaOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">

                {youtubeFullError && (
                  <div className="mb-5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                    {youtubeFullError}
                  </div>
                )}

                {/* Platform navigation foundation */}

                <div className="mb-6 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSocialMediaTab("youtube-full")
                    }
                    className={
                      socialMediaTab === "youtube-full"
                        ? "rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
                        : "rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                    }
                  >
                    YouTube Full Song
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSocialMediaTab("youtube-shorts");

                      if (
                        activeProjectId &&
                        youtubeShortsLoadedProjectId !==
                          activeProjectId
                      ) {
                        loadSavedYouTubeShorts(
                          activeProjectId
                        );
                      }
                    }}
                    className={
                      socialMediaTab === "youtube-shorts"
                        ? "rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
                        : "rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                    }
                  >
                    YouTube Shorts
                    {youtubeShortsPack?.shorts?.length
                      ? ` (${youtubeShortsPack.shorts.length})`
                      : ""}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      openSocialPlatformTab("facebook")
                    }
                    className={
                      socialMediaTab === "facebook"
                        ? "rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
                        : "rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                    }
                  >
                    Facebook
                    {facebookPack?.reels?.length
                      ? ` (${facebookPack.reels.length})`
                      : ""}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      openSocialPlatformTab("instagram")
                    }
                    className={
                      socialMediaTab === "instagram"
                        ? "rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
                        : "rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                    }
                  >
                    Instagram
                    {instagramPack?.reels?.length
                      ? ` (${instagramPack.reels.length})`
                      : ""}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      openSocialPlatformTab("tiktok")
                    }
                    className={
                      socialMediaTab === "tiktok"
                        ? "rounded-full bg-white px-4 py-2 text-xs font-bold text-black"
                        : "rounded-full border border-zinc-700 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                    }
                  >
                    TikTok
                    {tiktokPack?.posts?.length
                      ? ` (${tiktokPack.posts.length})`
                      : ""}
                  </button>
                </div>

                {(
                  socialMediaTab === "facebook" ||
                  socialMediaTab === "instagram" ||
                  socialMediaTab === "tiktok"
                ) && (
                  <div
                    id="social-three-platform-pack"
                    className="space-y-6"
                  >
                    {platformPackError && (
                      <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                        {platformPackError}
                      </div>
                    )}

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                        Social Campaign
                      </p>

                      <h3 className="mt-2 text-xl font-semibold text-white">
                        Facebook + Instagram + TikTok
                      </h3>

                      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                        One coordinated generation creates all three
                        platform packs while adapting the copy and
                        short-form ideas specifically for each platform.
                      </p>

                      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-white">
                              Social Platforms Direction
                              <span className="ml-2 font-normal text-zinc-500">
                                Optional
                              </span>
                            </h4>

                            <p className="mt-1 text-xs leading-5 text-zinc-500">
                              Give one campaign-level direction for
                              Facebook, Instagram and TikTok.
                            </p>
                          </div>

                          <span className="text-xs text-zinc-600">
                            {platformGeneratorGuidance.length}/1200
                          </span>
                        </div>

                        <textarea
                          value={platformGeneratorGuidance}
                          onChange={(event) =>
                            setPlatformGeneratorGuidance(
                              event.target.value.slice(0, 1200)
                            )
                          }
                          rows={5}
                          placeholder="Example: Keep the campaign emotional, informal and natural. Use Roman Hindi for captions but preserve original Hindi lyric lines where useful. Avoid generic marketing language. Make every Reel/TikTok concept genuinely different."
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={generateSocialPlatformPacks}
                        disabled={platformPackLoading}
                        className="mt-5 rounded-xl bg-white px-5 py-3 text-sm font-bold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {platformPackLoading
                          ? "Working..."
                          : facebookPack ||
                              instagramPack ||
                              tiktokPack
                            ? "Regenerate Social Platforms"
                            : "Generate Social Platforms"}
                      </button>

                      <p className="mt-3 text-xs text-zinc-500">
                        This generates Facebook, Instagram and TikTok
                        together in one AI request.
                      </p>
                    </div>

                    {platformPackLoading &&
                      !facebookPack &&
                      !instagramPack &&
                      !tiktokPack && (
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
                          Building the coordinated social campaign...
                        </div>
                      )}

                    {socialMediaTab === "facebook" &&
                      facebookPack &&
                      !platformPackLoading && (
                        <div className="space-y-5">
                          <div className="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-700 bg-zinc-950/95 px-5 py-4 shadow-xl backdrop-blur">
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {platformDirty.facebook
                                  ? "Unsaved changes"
                                  : platformSaveMessage.facebook ||
                                    "Saved ✓"}
                              </p>

                              <p className="mt-1 text-xs text-zinc-500">
                                Facebook release copy +{" "}
                                {facebookPack.reels.length} Reels
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                saveSocialPlatformPack("facebook")
                              }
                              disabled={
                                platformSaving === "facebook" ||
                                !platformDirty.facebook
                              }
                              className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {platformSaving === "facebook"
                                ? "Saving..."
                                : platformDirty.facebook
                                  ? "Save Changes"
                                  : "Saved ✓"}
                            </button>
                          </div>

                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                            <h3 className="text-lg font-semibold text-white">
                              Facebook Release Posts
                            </h3>

                            <div className="mt-5 flex items-center justify-between gap-3">
                              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                Main Release Post
                              </label>

                              <button
                                type="button"
                                onClick={() =>
                                  copySocialText(
                                    "facebook-main-release",
                                    facebookPack.mainReleasePost
                                  )
                                }
                                className="text-xs font-semibold text-zinc-500 hover:text-white"
                              >
                                {copiedSocialField ===
                                "facebook-main-release"
                                  ? "✓ Copied"
                                  : "Copy"}
                              </button>
                            </div>
                            <textarea
                              value={facebookPack.mainReleasePost}
                              onChange={(event) =>
                                updateFacebookField(
                                  "mainReleasePost",
                                  event.target.value
                                )
                              }
                              rows={8}
                              className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                            />

                            <div className="mt-5 flex items-center justify-between gap-3">
                              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                Short Release Post
                              </label>

                              <button
                                type="button"
                                onClick={() =>
                                  copySocialText(
                                    "facebook-short-release",
                                    facebookPack.shortReleasePost
                                  )
                                }
                                className="text-xs font-semibold text-zinc-500 hover:text-white"
                              >
                                {copiedSocialField ===
                                "facebook-short-release"
                                  ? "✓ Copied"
                                  : "Copy"}
                              </button>
                            </div>
                            <textarea
                              value={facebookPack.shortReleasePost}
                              onChange={(event) =>
                                updateFacebookField(
                                  "shortReleasePost",
                                  event.target.value
                                )
                              }
                              rows={5}
                              className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                            />

                            <div className="mt-5 flex items-center justify-between gap-3">
                              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                Emotional / Story Post
                              </label>

                              <button
                                type="button"
                                onClick={() =>
                                  copySocialText(
                                    "facebook-story-post",
                                    facebookPack.emotionalStoryPost
                                  )
                                }
                                className="text-xs font-semibold text-zinc-500 hover:text-white"
                              >
                                {copiedSocialField ===
                                "facebook-story-post"
                                  ? "✓ Copied"
                                  : "Copy"}
                              </button>
                            </div>
                            <textarea
                              value={facebookPack.emotionalStoryPost}
                              onChange={(event) =>
                                updateFacebookField(
                                  "emotionalStoryPost",
                                  event.target.value
                                )
                              }
                              rows={7}
                              className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                            />

                            <div className="mt-5 grid gap-5 lg:grid-cols-3">
                              <div>
                                <div className="flex items-center justify-between gap-3">
                                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    Engagement Questions
                                  </label>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      copySocialText(
                                        "facebook-questions",
                                        facebookPack.engagementQuestions.join("\n")
                                      )
                                    }
                                    className="text-xs font-semibold text-zinc-500 hover:text-white"
                                  >
                                    {copiedSocialField ===
                                    "facebook-questions"
                                      ? "✓ Copied"
                                      : "Copy all"}
                                  </button>
                                </div>
                                <textarea
                                  value={facebookPack.engagementQuestions.join("\n")}
                                  onChange={(event) =>
                                    updateFacebookArray(
                                      "engagementQuestions",
                                      event.target.value
                                    )
                                  }
                                  rows={7}
                                  className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                />
                              </div>

                              <div>
                                <div className="flex items-center justify-between gap-3">
                                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    CTA Options
                                  </label>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      copySocialText(
                                        "facebook-cta",
                                        facebookPack.ctaOptions.join("\n")
                                      )
                                    }
                                    className="text-xs font-semibold text-zinc-500 hover:text-white"
                                  >
                                    {copiedSocialField ===
                                    "facebook-cta"
                                      ? "✓ Copied"
                                      : "Copy all"}
                                  </button>
                                </div>
                                <textarea
                                  value={facebookPack.ctaOptions.join("\n")}
                                  onChange={(event) =>
                                    updateFacebookArray(
                                      "ctaOptions",
                                      event.target.value
                                    )
                                  }
                                  rows={7}
                                  className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                />
                              </div>

                              <div>
                                <div className="flex items-center justify-between gap-3">
                                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    Hashtags
                                  </label>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      copySocialText(
                                        "facebook-hashtags",
                                        facebookPack.hashtags.join(" ")
                                      )
                                    }
                                    className="text-xs font-semibold text-zinc-500 hover:text-white"
                                  >
                                    {copiedSocialField ===
                                    "facebook-hashtags"
                                      ? "✓ Copied"
                                      : "Copy all"}
                                  </button>
                                </div>
                                <textarea
                                  value={facebookPack.hashtags.join("\n")}
                                  onChange={(event) =>
                                    updateFacebookArray(
                                      "hashtags",
                                      event.target.value
                                    )
                                  }
                                  rows={7}
                                  className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                />
                              </div>
                            </div>
                          </div>

                          {facebookPack.reels.map(
                            (reel, index) => (
                              <details
                                key={`facebook-reel-${index}`}
                                open={index === 0}
                                className="rounded-2xl border border-zinc-800 bg-zinc-950"
                              >
                                <summary className="cursor-pointer px-5 py-4">
                                  <span className="font-semibold text-white">
                                    Facebook Reel {reel.reelNumber}
                                  </span>
                                  <span className="ml-3 text-sm text-zinc-500">
                                    {reel.creativeAngle}
                                  </span>
                                </summary>

                                <div className="grid gap-4 border-t border-zinc-800 p-5 lg:grid-cols-2">
                                  {[
                                    ["creativeAngle", "Creative Angle"],
                                    ["openingHook", "Opening Hook"],
                                    ["caption", "Caption"],
                                    ["engagementPrompt", "Engagement Prompt"],
                                    ["fullSongCta", "Full Song CTA"],
                                  ].map(([field, label]) => (
                                    <div key={field}>
                                      <div className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                          {label}
                                        </label>

                                        {field !== "creativeAngle" && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              copySocialText(
                                                `facebook-reel-${index}-${field}`,
                                                reel[
                                                  field as keyof typeof reel
                                                ] as string
                                              )
                                            }
                                            className="text-xs font-semibold text-zinc-500 hover:text-white"
                                          >
                                            {copiedSocialField ===
                                            `facebook-reel-${index}-${field}`
                                              ? "✓ Copied"
                                              : "Copy"}
                                          </button>
                                        )}
                                      </div>

                                      <textarea
                                        value={
                                          reel[
                                            field as keyof typeof reel
                                          ] as string
                                        }
                                        onChange={(event) =>
                                          updateFacebookReelField(
                                            index,
                                            field as
                                              | "creativeAngle"
                                              | "openingHook"
                                              | "caption"
                                              | "engagementPrompt"
                                              | "fullSongCta",
                                            event.target.value
                                          )
                                        }
                                        rows={4}
                                        className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                      />
                                    </div>
                                  ))}

                                  <div>
                                    <div className="flex items-center justify-between gap-3">
                                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                        Hashtags
                                      </label>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          copySocialText(
                                            `facebook-reel-${index}-hashtags`,
                                            reel.hashtags.join(" ")
                                          )
                                        }
                                        className="text-xs font-semibold text-zinc-500 hover:text-white"
                                      >
                                        {copiedSocialField ===
                                        `facebook-reel-${index}-hashtags`
                                          ? "✓ Copied"
                                          : "Copy all"}
                                      </button>
                                    </div>

                                    <textarea
                                      value={reel.hashtags.join("\n")}
                                      onChange={(event) =>
                                        updateFacebookReelHashtags(
                                          index,
                                          event.target.value
                                        )
                                      }
                                      rows={4}
                                      className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                    />
                                  </div>
                                </div>
                              </details>
                            )
                          )}
                        </div>
                      )}

                    {socialMediaTab === "instagram" &&
                      instagramPack &&
                      !platformPackLoading && (
                        <div className="space-y-5">
                          <div className="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-700 bg-zinc-950/95 px-5 py-4 shadow-xl backdrop-blur">
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {platformDirty.instagram
                                  ? "Unsaved changes"
                                  : platformSaveMessage.instagram ||
                                    "Saved ✓"}
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">
                                Instagram feed +{" "}
                                {instagramPack.reels.length} Reels
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                saveSocialPlatformPack("instagram")
                              }
                              disabled={
                                platformSaving === "instagram" ||
                                !platformDirty.instagram
                              }
                              className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {platformSaving === "instagram"
                                ? "Saving..."
                                : platformDirty.instagram
                                  ? "Save Changes"
                                  : "Saved ✓"}
                            </button>
                          </div>

                          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                            <h3 className="text-lg font-semibold text-white">
                              Instagram Release Pack
                            </h3>

                            <div className="mt-5 flex items-center justify-between gap-3">
                              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                Feed Caption
                              </label>

                              <button
                                type="button"
                                onClick={() =>
                                  copySocialText(
                                    "instagram-feed-caption",
                                    instagramPack.feedCaption
                                  )
                                }
                                className="text-xs font-semibold text-zinc-500 hover:text-white"
                              >
                                {copiedSocialField ===
                                "instagram-feed-caption"
                                  ? "✓ Copied"
                                  : "Copy"}
                              </button>
                            </div>
                            <textarea
                              value={instagramPack.feedCaption}
                              onChange={(event) =>
                                updateInstagramField(
                                  "feedCaption",
                                  event.target.value
                                )
                              }
                              rows={8}
                              className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                            />

                            <div className="mt-5 flex items-center justify-between gap-3">
                              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                Short Caption
                              </label>

                              <button
                                type="button"
                                onClick={() =>
                                  copySocialText(
                                    "instagram-short-caption",
                                    instagramPack.shortCaption
                                  )
                                }
                                className="text-xs font-semibold text-zinc-500 hover:text-white"
                              >
                                {copiedSocialField ===
                                "instagram-short-caption"
                                  ? "✓ Copied"
                                  : "Copy"}
                              </button>
                            </div>
                            <textarea
                              value={instagramPack.shortCaption}
                              onChange={(event) =>
                                updateInstagramField(
                                  "shortCaption",
                                  event.target.value
                                )
                              }
                              rows={4}
                              className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                            />

                            <div className="mt-5 grid gap-5 lg:grid-cols-3">
                              <div>
                                <div className="flex items-center justify-between gap-3">
                                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    Story Text Ideas
                                  </label>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      copySocialText(
                                        "instagram-story-ideas",
                                        instagramPack.storyTextIdeas.join("\n")
                                      )
                                    }
                                    className="text-xs font-semibold text-zinc-500 hover:text-white"
                                  >
                                    {copiedSocialField ===
                                    "instagram-story-ideas"
                                      ? "✓ Copied"
                                      : "Copy all"}
                                  </button>
                                </div>
                                <textarea
                                  value={instagramPack.storyTextIdeas.join("\n")}
                                  onChange={(event) =>
                                    updateInstagramArray(
                                      "storyTextIdeas",
                                      event.target.value
                                    )
                                  }
                                  rows={8}
                                  className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                />
                              </div>

                              <div>
                                <div className="flex items-center justify-between gap-3">
                                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    CTA Options
                                  </label>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      copySocialText(
                                        "instagram-cta",
                                        instagramPack.ctaOptions.join("\n")
                                      )
                                    }
                                    className="text-xs font-semibold text-zinc-500 hover:text-white"
                                  >
                                    {copiedSocialField ===
                                    "instagram-cta"
                                      ? "✓ Copied"
                                      : "Copy all"}
                                  </button>
                                </div>
                                <textarea
                                  value={instagramPack.ctaOptions.join("\n")}
                                  onChange={(event) =>
                                    updateInstagramArray(
                                      "ctaOptions",
                                      event.target.value
                                    )
                                  }
                                  rows={8}
                                  className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                />
                              </div>

                              <div>
                                <div className="flex items-center justify-between gap-3">
                                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                    Hashtags
                                  </label>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      copySocialText(
                                        "instagram-hashtags",
                                        instagramPack.hashtags.join(" ")
                                      )
                                    }
                                    className="text-xs font-semibold text-zinc-500 hover:text-white"
                                  >
                                    {copiedSocialField ===
                                    "instagram-hashtags"
                                      ? "✓ Copied"
                                      : "Copy all"}
                                  </button>
                                </div>
                                <textarea
                                  value={instagramPack.hashtags.join("\n")}
                                  onChange={(event) =>
                                    updateInstagramArray(
                                      "hashtags",
                                      event.target.value
                                    )
                                  }
                                  rows={8}
                                  className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                />
                              </div>
                            </div>
                          </div>

                          {instagramPack.reels.map(
                            (reel, index) => (
                              <details
                                key={`instagram-reel-${index}`}
                                open={index === 0}
                                className="rounded-2xl border border-zinc-800 bg-zinc-950"
                              >
                                <summary className="cursor-pointer px-5 py-4">
                                  <span className="font-semibold text-white">
                                    Instagram Reel {reel.reelNumber}
                                  </span>
                                  <span className="ml-3 text-sm text-zinc-500">
                                    {reel.creativeAngle}
                                  </span>
                                </summary>

                                <div className="grid gap-4 border-t border-zinc-800 p-5 lg:grid-cols-2">
                                  {[
                                    ["creativeAngle", "Creative Angle"],
                                    ["openingHook", "Opening Hook"],
                                    ["caption", "Caption"],
                                    ["fullSongCta", "Full Song CTA"],
                                    ["visualDirection", "Visual Direction"],
                                  ].map(([field, label]) => (
                                    <div key={field}>
                                      <div className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                          {label}
                                        </label>

                                        {![
                                          "creativeAngle",
                                          "visualDirection",
                                        ].includes(field) && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              copySocialText(
                                                `instagram-reel-${index}-${field}`,
                                                reel[
                                                  field as keyof typeof reel
                                                ] as string
                                              )
                                            }
                                            className="text-xs font-semibold text-zinc-500 hover:text-white"
                                          >
                                            {copiedSocialField ===
                                            `instagram-reel-${index}-${field}`
                                              ? "✓ Copied"
                                              : "Copy"}
                                          </button>
                                        )}
                                      </div>

                                      <textarea
                                        value={
                                          reel[
                                            field as keyof typeof reel
                                          ] as string
                                        }
                                        onChange={(event) =>
                                          updateInstagramReelField(
                                            index,
                                            field as
                                              | "creativeAngle"
                                              | "openingHook"
                                              | "caption"
                                              | "fullSongCta"
                                              | "visualDirection",
                                            event.target.value
                                          )
                                        }
                                        rows={4}
                                        className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                      />
                                    </div>
                                  ))}

                                  <div>
                                    <div className="flex items-center justify-between gap-3">
                                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                        Hashtags
                                      </label>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          copySocialText(
                                            `instagram-reel-${index}-hashtags`,
                                            reel.hashtags.join(" ")
                                          )
                                        }
                                        className="text-xs font-semibold text-zinc-500 hover:text-white"
                                      >
                                        {copiedSocialField ===
                                        `instagram-reel-${index}-hashtags`
                                          ? "✓ Copied"
                                          : "Copy all"}
                                      </button>
                                    </div>

                                    <textarea
                                      value={reel.hashtags.join("\n")}
                                      onChange={(event) =>
                                        updateInstagramReelHashtags(
                                          index,
                                          event.target.value
                                        )
                                      }
                                      rows={4}
                                      className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                    />
                                  </div>
                                </div>
                              </details>
                            )
                          )}
                        </div>
                      )}

                    {socialMediaTab === "tiktok" &&
                      tiktokPack &&
                      !platformPackLoading && (
                        <div className="space-y-5">
                          <div className="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-700 bg-zinc-950/95 px-5 py-4 shadow-xl backdrop-blur">
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {platformDirty.tiktok
                                  ? "Unsaved changes"
                                  : platformSaveMessage.tiktok ||
                                    "Saved ✓"}
                              </p>
                              <p className="mt-1 text-xs text-zinc-500">
                                {tiktokPack.posts.length} TikTok concepts
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                saveSocialPlatformPack("tiktok")
                              }
                              disabled={
                                platformSaving === "tiktok" ||
                                !platformDirty.tiktok
                              }
                              className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {platformSaving === "tiktok"
                                ? "Saving..."
                                : platformDirty.tiktok
                                  ? "Save Changes"
                                  : "Saved ✓"}
                            </button>
                          </div>

                          {tiktokPack.posts.map(
                            (post, index) => (
                              <details
                                key={`tiktok-post-${index}`}
                                open={index === 0}
                                className="rounded-2xl border border-zinc-800 bg-zinc-950"
                              >
                                <summary className="cursor-pointer px-5 py-4">
                                  <span className="font-semibold text-white">
                                    TikTok {post.postNumber}
                                  </span>
                                  <span className="ml-3 text-sm text-zinc-500">
                                    {post.creativeAngle}
                                  </span>
                                </summary>

                                <div className="grid gap-4 border-t border-zinc-800 p-5 lg:grid-cols-2">
                                  {[
                                    ["creativeAngle", "Creative Angle"],
                                    ["lyricMoment", "Exact Lyric Moment"],
                                    ["openingHook", "Opening / On-screen Hook"],
                                    ["caption", "Caption"],
                                    ["commentPrompt", "Comment Prompt"],
                                    ["fullSongCta", "Full Song CTA"],
                                    ["visualDirection", "Visual Direction"],
                                  ].map(([field, label]) => (
                                    <div key={field}>
                                      <div className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                          {label}
                                        </label>

                                        {![
                                          "creativeAngle",
                                          "lyricMoment",
                                          "visualDirection",
                                        ].includes(field) && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              copySocialText(
                                                `tiktok-${index}-${field}`,
                                                post[
                                                  field as keyof typeof post
                                                ] as string
                                              )
                                            }
                                            className="text-xs font-semibold text-zinc-500 hover:text-white"
                                          >
                                            {copiedSocialField ===
                                            `tiktok-${index}-${field}`
                                              ? "✓ Copied"
                                              : "Copy"}
                                          </button>
                                        )}
                                      </div>

                                      <textarea
                                        value={
                                          post[
                                            field as keyof typeof post
                                          ] as string
                                        }
                                        onChange={(event) =>
                                          updateTikTokPostField(
                                            index,
                                            field as
                                              | "creativeAngle"
                                              | "lyricMoment"
                                              | "openingHook"
                                              | "caption"
                                              | "commentPrompt"
                                              | "fullSongCta"
                                              | "visualDirection",
                                            event.target.value
                                          )
                                        }
                                        rows={4}
                                        className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                      />
                                    </div>
                                  ))}

                                  <div>
                                    <div className="flex items-center justify-between gap-3">
                                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                        Hashtags
                                      </label>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          copySocialText(
                                            `tiktok-${index}-hashtags`,
                                            post.hashtags.join(" ")
                                          )
                                        }
                                        className="text-xs font-semibold text-zinc-500 hover:text-white"
                                      >
                                        {copiedSocialField ===
                                        `tiktok-${index}-hashtags`
                                          ? "✓ Copied"
                                          : "Copy all"}
                                      </button>
                                    </div>

                                    <textarea
                                      value={post.hashtags.join("\n")}
                                      onChange={(event) =>
                                        updateTikTokPostHashtags(
                                          index,
                                          event.target.value
                                        )
                                      }
                                      rows={4}
                                      className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                    />
                                  </div>
                                </div>
                              </details>
                            )
                          )}
                        </div>
                      )}
                  </div>
                )}

                {socialMediaTab === "youtube-shorts" && (
                  <div
                    id="youtube-shorts-pack"
                    className="space-y-6"
                  >
                    {youtubeShortsError && (
                      <div className="rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                        {youtubeShortsError}
                      </div>
                    )}

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                        YouTube
                      </p>

                      <h3 className="mt-2 text-xl font-semibold text-white">
                        Shorts Release Pack
                      </h3>

                      <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
                        Generate 10 different Shorts from the strongest
                        moments in the complete song. Each Short gets
                        its own hook, lyric moment, title, description,
                        metadata, CTA and visual direction.
                      </p>

                      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h4 className="text-sm font-semibold text-white">
                              YouTube Shorts Direction
                              <span className="ml-2 font-normal text-zinc-500">
                                Optional
                              </span>
                            </h4>

                            <p className="mt-1 text-xs text-zinc-500">
                              Guide Studio on language, hooks, tone,
                              audience and what to avoid.
                            </p>
                          </div>

                          <span className="text-xs text-zinc-600">
                            {youtubeShortsGeneratorGuidance.length}/1200
                          </span>
                        </div>

                        <textarea
                          value={
                            youtubeShortsGeneratorGuidance
                          }
                          onChange={(event) => {
                            setYoutubeShortsGeneratorGuidance(
                              event.target.value.slice(
                                0,
                                1200
                              )
                            );

                            if (youtubeShortsPack) {
                              setYoutubeShortsDirty(true);
                              setYoutubeShortsSaveMessage("");
                            }
                          }}
                          rows={5}
                          placeholder="Example: Keep every Short genuinely different. Strong first 1–2 seconds. Roman Hindi titles, original Hindi lyrics where useful. Avoid repeating the same lyric, question or visual idea."
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={generateYouTubeShortsPack}
                        disabled={youtubeShortsLoading}
                        className="mt-5 rounded-xl bg-white px-5 py-3 text-sm font-bold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {youtubeShortsLoading
                          ? "Working..."
                          : youtubeShortsPack
                            ? "Regenerate 10 Shorts"
                            : "Generate 10 Shorts"}
                      </button>
                    </div>

                    {youtubeShortsLoading &&
                      !youtubeShortsPack && (
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
                          Loading or generating your YouTube Shorts...
                        </div>
                      )}

                    {youtubeShortsPack &&
                      !youtubeShortsLoading && (
                        <>
                          <div className="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-700 bg-zinc-950/95 px-5 py-4 shadow-xl backdrop-blur">
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {youtubeShortsDirty
                                  ? "Unsaved changes"
                                  : youtubeShortsSaveMessage ||
                                    "Saved ✓"}
                              </p>

                              <p className="mt-1 text-xs text-zinc-500">
                                {youtubeShortsPack.shorts.length} individual
                                YouTube Shorts packages
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={saveYouTubeShortsPack}
                              disabled={
                                youtubeShortsSaving ||
                                !youtubeShortsDirty
                              }
                              className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {youtubeShortsSaving
                                ? "Saving..."
                                : youtubeShortsDirty
                                  ? "Save Changes"
                                  : "Saved ✓"}
                            </button>
                          </div>

                          <div className="space-y-5">
                            {youtubeShortsPack.shorts.map(
                              (short, index) => (
                                <div
                                  key={`youtube-short-${short.shortNumber}-${index}`}
                                  className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
                                >
                                  <div className="flex flex-wrap items-center gap-3">
                                    <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black">
                                      Short {short.shortNumber}
                                    </span>

                                    <span className="text-sm font-semibold text-zinc-200">
                                      {short.creativeAngle}
                                    </span>
                                  </div>

                                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                                    <div>
                                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                        Creative Angle
                                      </label>

                                      <textarea
                                        value={short.creativeAngle}
                                        onChange={(event) =>
                                          updateYouTubeShortField(
                                            index,
                                            "creativeAngle",
                                            event.target.value
                                          )
                                        }
                                        rows={3}
                                        className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                      />
                                    </div>

                                    <div>
                                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                        Exact Lyric Moment
                                      </label>

                                      <textarea
                                        value={short.lyricMoment}
                                        onChange={(event) =>
                                          updateYouTubeShortField(
                                            index,
                                            "lyricMoment",
                                            event.target.value
                                          )
                                        }
                                        rows={3}
                                        className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                      />
                                    </div>
                                  </div>

                                  <div className="mt-5">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                      Opening Hook / First Screen
                                    </label>

                                    <textarea
                                      value={short.openingHook}
                                      onChange={(event) =>
                                        updateYouTubeShortField(
                                          index,
                                          "openingHook",
                                          event.target.value
                                        )
                                      }
                                      rows={2}
                                      className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                    />
                                  </div>

                                  <div className="mt-5">
                                    <div className="flex items-center justify-between gap-3">
                                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                        Shorts Title
                                      </label>

                                      <div className="flex items-center gap-3">
                                        <span className="text-xs text-zinc-600">
                                          {short.title.length}/100
                                        </span>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            copyYouTubeShortText(
                                              `short-${index}-title`,
                                              short.title
                                            )
                                          }
                                          className="text-xs font-semibold text-zinc-500 hover:text-white"
                                        >
                                          {copiedYouTubeShortField ===
                                          `short-${index}-title`
                                            ? "✓ Copied"
                                            : "Copy"}
                                        </button>
                                      </div>
                                    </div>

                                    <input
                                      value={short.title}
                                      maxLength={100}
                                      onChange={(event) =>
                                        updateYouTubeShortField(
                                          index,
                                          "title",
                                          event.target.value
                                        )
                                      }
                                      className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-200 outline-none focus:border-zinc-600"
                                    />
                                  </div>

                                  <div className="mt-5">
                                    <div className="flex items-center justify-between gap-3">
                                      <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                        Description
                                      </label>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          copyYouTubeShortText(
                                            `short-${index}-description`,
                                            short.description
                                          )
                                        }
                                        className="text-xs font-semibold text-zinc-500 hover:text-white"
                                      >
                                        {copiedYouTubeShortField ===
                                        `short-${index}-description`
                                          ? "✓ Copied"
                                          : "Copy"}
                                      </button>
                                    </div>

                                    <textarea
                                      value={short.description}
                                      onChange={(event) =>
                                        updateYouTubeShortField(
                                          index,
                                          "description",
                                          event.target.value
                                        )
                                      }
                                      rows={4}
                                      className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                    />
                                  </div>

                                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                                    <div>
                                      <div className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                          Hashtags
                                        </label>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            copyYouTubeShortText(
                                              `short-${index}-hashtags`,
                                              short.hashtags.join(" ")
                                            )
                                          }
                                          className="text-xs font-semibold text-zinc-500 hover:text-white"
                                        >
                                          {copiedYouTubeShortField ===
                                          `short-${index}-hashtags`
                                            ? "✓ Copied"
                                            : "Copy all"}
                                        </button>
                                      </div>

                                      <textarea
                                        value={short.hashtags.join(
                                          "\n"
                                        )}
                                        onChange={(event) =>
                                          updateYouTubeShortArray(
                                            index,
                                            "hashtags",
                                            event.target.value
                                          )
                                        }
                                        rows={5}
                                        className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                      />

                                      <p className="mt-1 text-xs text-zinc-600">
                                        One hashtag per line
                                      </p>
                                    </div>

                                    <div>
                                      <div className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                          Search Tags
                                        </label>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            copyYouTubeShortText(
                                              `short-${index}-tags`,
                                              short.tags.join(", ")
                                            )
                                          }
                                          className="text-xs font-semibold text-zinc-500 hover:text-white"
                                        >
                                          {copiedYouTubeShortField ===
                                          `short-${index}-tags`
                                            ? "✓ Copied"
                                            : "Copy all"}
                                        </button>
                                      </div>

                                      <textarea
                                        value={short.tags.join("\n")}
                                        onChange={(event) =>
                                          updateYouTubeShortArray(
                                            index,
                                            "tags",
                                            event.target.value
                                          )
                                        }
                                        rows={5}
                                        className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                      />

                                      <p className="mt-1 text-xs text-zinc-600">
                                        One tag per line
                                      </p>
                                    </div>
                                  </div>

                                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                                    <div>
                                      <div className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                          Pinned Comment
                                        </label>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            copyYouTubeShortText(
                                              `short-${index}-comment`,
                                              short.pinnedComment
                                            )
                                          }
                                          className="text-xs font-semibold text-zinc-500 hover:text-white"
                                        >
                                          {copiedYouTubeShortField ===
                                          `short-${index}-comment`
                                            ? "✓ Copied"
                                            : "Copy"}
                                        </button>
                                      </div>

                                      <textarea
                                        value={short.pinnedComment}
                                        onChange={(event) =>
                                          updateYouTubeShortField(
                                            index,
                                            "pinnedComment",
                                            event.target.value
                                          )
                                        }
                                        rows={4}
                                        className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                      />
                                    </div>

                                    <div>
                                      <div className="flex items-center justify-between gap-3">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                          Full Song CTA
                                        </label>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            copyYouTubeShortText(
                                              `short-${index}-cta`,
                                              short.fullSongCta
                                            )
                                          }
                                          className="text-xs font-semibold text-zinc-500 hover:text-white"
                                        >
                                          {copiedYouTubeShortField ===
                                          `short-${index}-cta`
                                            ? "✓ Copied"
                                            : "Copy"}
                                        </button>
                                      </div>

                                      <textarea
                                        value={short.fullSongCta}
                                        onChange={(event) =>
                                          updateYouTubeShortField(
                                            index,
                                            "fullSongCta",
                                            event.target.value
                                          )
                                        }
                                        rows={4}
                                        className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                      />
                                    </div>
                                  </div>

                                  <div className="mt-5">
                                    <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                                      Suggested 9:16 Visual Direction
                                    </label>

                                    <textarea
                                      value={short.visualDirection}
                                      onChange={(event) =>
                                        updateYouTubeShortField(
                                          index,
                                          "visualDirection",
                                          event.target.value
                                        )
                                      }
                                      rows={4}
                                      className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                                    />
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </>
                      )}
                  </div>
                )}

                {/* YouTube Full Song header */}
                <div
                  className={
                    socialMediaTab === "youtube-full"
                      ? "rounded-2xl border border-zinc-800 bg-zinc-950 p-6"
                      : "hidden"
                  }
                >
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div className="max-w-2xl">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                        YouTube
                      </p>

                      <h3 className="mt-2 text-xl font-semibold text-white">
                        Full Song Release Pack
                      </h3>

                      <p className="mt-2 text-sm leading-6 text-zinc-400">
                        Complete upload metadata for the finished
                        full-length song: titles, description, tags,
                        hashtags, comments, Community posts, credits,
                        promotional lines and upload guidance.
                      </p>
                    </div>

                    <div
                      id="youtube-generator-guidance"
                      className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-white">
                            YouTube Direction
                            <span className="ml-2 font-normal text-zinc-500">
                              Optional
                            </span>
                          </h4>

                          <p className="mt-1 text-xs leading-5 text-zinc-500">
                            Guide Studio on how you want this particular
                            release positioned.
                          </p>
                        </div>

                        <span className="text-xs text-zinc-600">
                          {youtubeGeneratorGuidance.length}/1200
                        </span>
                      </div>

                      <textarea
                        value={youtubeGeneratorGuidance}
                        onChange={(event) =>
                          setYoutubeGeneratorGuidance(
                            event.target.value.slice(0, 1200)
                          )
                        }
                        rows={5}
                        placeholder="Example: Keep the title emotional rather than SEO-heavy. Use English letters but Hindi language. Target Indian listeners. Keep the description informal and personal. Focus on nostalgia and separation. Avoid excessive hashtags and generic marketing language."
                        className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-zinc-600"
                      />

                      <p className="mt-3 text-xs leading-5 text-zinc-600">
                        You can guide title style, description tone,
                        target audience, language/script, SEO emphasis,
                        important themes, keywords or anything you want
                        Studio to avoid.
                      </p>
                    </div>

                    <div
                      id="youtube-release-details"
                      className="w-full rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5"
                    >
                      <div>
                        <h4 className="text-sm font-semibold text-white">
                          YouTube Release Details
                        </h4>

                        <p className="mt-1 text-xs leading-5 text-zinc-500">
                          Factual release information. Studio will use
                          these details exactly and will not invent
                          credits, links or AI usage.
                        </p>
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-2">

                        <div>
                          <label className="text-xs font-semibold text-zinc-400">
                            Release Type
                          </label>

                          <select
                            value={youtubeReleaseType}
                            onChange={(event) => {
                              setYoutubeReleaseType(
                                event.target.value
                              );

                              if (youtubeFullPack) {
                                setYoutubePackDirty(true);
                                setYoutubePackSaveMessage("");
                              }
                            }}
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                          >
                            <option>
                              Official Music Video
                            </option>
                            <option>
                              Official Audio
                            </option>
                            <option>
                              Lyric Video
                            </option>
                            <option>
                              Visualizer
                            </option>
                            <option>
                              Live Performance
                            </option>
                          </select>
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-zinc-400">
                            Artist / Brand
                          </label>

                          <input
                            value={youtubeArtistBrand}
                            onChange={(event) => {
                              setYoutubeArtistBrand(
                                event.target.value
                              );

                              if (youtubeFullPack) {
                                setYoutubePackDirty(true);
                                setYoutubePackSaveMessage("");
                              }
                            }}
                            placeholder="Suno Zara"
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-zinc-400">
                            Lyrics Credit
                          </label>

                          <input
                            value={youtubeLyricsCredit}
                            onChange={(event) => {
                              setYoutubeLyricsCredit(
                                event.target.value
                              );

                              if (youtubeFullPack) {
                                setYoutubePackDirty(true);
                                setYoutubePackSaveMessage("");
                              }
                            }}
                            placeholder="e.g. Lyrics: ..."
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-zinc-400">
                            Music / Composition Credit
                          </label>

                          <input
                            value={youtubeCompositionCredit}
                            onChange={(event) => {
                              setYoutubeCompositionCredit(
                                event.target.value
                              );

                              if (youtubeFullPack) {
                                setYoutubePackDirty(true);
                                setYoutubePackSaveMessage("");
                              }
                            }}
                            placeholder="e.g. Music & Composition: ..."
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-zinc-400">
                            Producer Credit
                          </label>

                          <input
                            value={youtubeProducerCredit}
                            onChange={(event) => {
                              setYoutubeProducerCredit(
                                event.target.value
                              );

                              if (youtubeFullPack) {
                                setYoutubePackDirty(true);
                                setYoutubePackSaveMessage("");
                              }
                            }}
                            placeholder="e.g. Producer: ..."
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-zinc-400">
                            Preferred YouTube Playlist
                          </label>

                          <input
                            value={youtubePreferredPlaylist}
                            onChange={(event) => {
                              setYoutubePreferredPlaylist(
                                event.target.value
                              );

                              if (youtubeFullPack) {
                                setYoutubePackDirty(true);
                                setYoutubePackSaveMessage("");
                              }
                            }}
                            placeholder="Optional existing playlist"
                            className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                          />
                        </div>
                      </div>

                      <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            checked={
                              youtubeIncludeAiDisclosure
                            }
                            onChange={(event) => {
                              setYoutubeIncludeAiDisclosure(
                                event.target.checked
                              );

                              if (youtubeFullPack) {
                                setYoutubePackDirty(true);
                                setYoutubePackSaveMessage("");
                              }
                            }}
                            className="mt-1"
                          />

                          <span>
                            <span className="block text-sm font-semibold text-zinc-200">
                              Include AI / Synthetic Media Disclosure
                            </span>

                            <span className="mt-1 block text-xs leading-5 text-zinc-500">
                              Turn this on only when you want Studio
                              to prepare disclosure wording for this
                              release.
                            </span>
                          </span>
                        </label>

                        {youtubeIncludeAiDisclosure && (
                          <textarea
                            value={youtubeAiDisclosureDetails}
                            onChange={(event) => {
                              setYoutubeAiDisclosureDetails(
                                event.target.value
                              );

                              if (youtubeFullPack) {
                                setYoutubePackDirty(true);
                                setYoutubePackSaveMessage("");
                              }
                            }}
                            rows={3}
                            placeholder="Describe only what was actually AI-assisted, for example: vocals generated with AI assistance; lyrics and composition created by..."
                            className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                          />
                        )}
                      </div>

                      <div className="mt-5">
                        <label className="text-xs font-semibold text-zinc-400">
                          Description / Streaming / Social Links
                        </label>

                        <textarea
                          value={youtubeDescriptionLinks}
                          onChange={(event) => {
                            setYoutubeDescriptionLinks(
                              event.target.value
                            );

                            if (youtubeFullPack) {
                              setYoutubePackDirty(true);
                              setYoutubePackSaveMessage("");
                            }
                          }}
                          rows={5}
                          placeholder={"Optional. Add the exact links or lines you want included in the description.\nExample:\nSpotify: ...\nInstagram: ...\nFacebook: ..."}
                          className="mt-2 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm leading-6 text-zinc-200 outline-none focus:border-zinc-600"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={generateYouTubeFullPack}
                      disabled={youtubeFullLoading}
                      className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {youtubeFullLoading
                        ? "Generating..."
                        : youtubeFullPack
                          ? "Regenerate YouTube Pack"
                          : "Generate YouTube Pack"}
                    </button>
                  </div>
                </div>

                {socialMediaTab === "youtube-full" &&
                  youtubeFullLoading && (
                  <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
                    Analysing the complete lyrics, hook, mood,
                    language and genre...
                  </div>
                )}

                {socialMediaTab === "youtube-full" &&
                  youtubeFullPack &&
                  !youtubeFullLoading && (
                  <div className="mt-6 space-y-6">

                    <div className="sticky top-4 z-20 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-700 bg-zinc-950/95 px-5 py-4 shadow-xl backdrop-blur">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {youtubePackDirty
                            ? "Unsaved changes"
                            : youtubePackSaveMessage || "Saved"}
                        </p>

                        <p className="mt-1 text-xs text-zinc-500">
                          The saved version will be used later for publishing.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={saveYouTubeFullPack}
                        disabled={
                          youtubePackSaving ||
                          !youtubePackDirty
                        }
                        className="rounded-xl bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {youtubePackSaving
                          ? "Saving..."
                          : youtubePackDirty
                            ? "Save Changes"
                            : "Saved ✓"}
                      </button>
                    </div>

                    {/* Recommended title */}
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                            Recommended
                          </p>

                          <h4 className="mt-1 text-base font-semibold text-white">
                            YouTube Title
                          </h4>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            copyYouTubeText(
                              "recommended-title",
                              youtubeFullPack.recommendedTitle
                            )
                          }
                          className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                        >
                          {copiedYouTubeField ===
                          "recommended-title"
                            ? "✓ Copied"
                            : "Copy"}
                        </button>
                      </div>

                      <input
                        value={youtubeFullPack.recommendedTitle}
                        onChange={(event) =>
                          updateYouTubePackField(
                            "recommendedTitle",
                            event.target.value.slice(0, 100)
                          )
                        }
                        maxLength={100}
                        className="mt-4 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-lg font-semibold text-white outline-none transition focus:border-zinc-600"
                      />

                      <p className="mt-2 text-right text-xs text-zinc-600">
                        {youtubeFullPack.recommendedTitle.length}/100
                      </p>

                      {youtubeFullPack.whyRecommended && (
                        <div className="mt-4 rounded-xl bg-zinc-900 p-4">
                          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-600">
                            Why this title
                          </p>

                          <p className="mt-2 text-sm leading-6 text-zinc-400">
                            {youtubeFullPack.whyRecommended}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Alternative titles */}
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                      <h4 className="text-base font-semibold text-white">
                        Alternative Titles
                      </h4>

                      <div className="mt-4 space-y-3">
                        {youtubeFullPack.alternativeTitles.map(
                          (title, index) => (
                            <div
                              key={`alt-title-${index}`}
                              className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
                            >
                              <span className="pt-2 text-xs text-zinc-600">
                                {index + 1}.
                              </span>

                              <input
                                value={title}
                                onChange={(event) =>
                                  updateYouTubePackArrayItem(
                                    "alternativeTitles",
                                    index,
                                    event.target.value.slice(0, 100)
                                  )
                                }
                                maxLength={100}
                                className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                              />

                              <button
                                type="button"
                                onClick={() =>
                                  copyYouTubeText(
                                    `alt-title-${index}`,
                                    title
                                  )
                                }
                                className="shrink-0 text-xs font-semibold text-zinc-500 hover:text-white"
                              >
                                {copiedYouTubeField ===
                                `alt-title-${index}`
                                  ? "✓ Copied"
                                  : "Copy"}
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    {/* Thumbnail copy */}
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                      <h4 className="text-base font-semibold text-white">
                        Thumbnail Text Options
                      </h4>

                      <div className="mt-4 flex flex-wrap gap-3">
                        {youtubeFullPack.thumbnailTextOptions.map(
                          (item, index) => (
                            <div
                              key={`thumbnail-${index}`}
                              className="flex min-w-[260px] flex-1 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-2"
                            >
                              <input
                                value={item}
                                onChange={(event) =>
                                  updateYouTubePackArrayItem(
                                    "thumbnailTextOptions",
                                    index,
                                    event.target.value
                                  )
                                }
                                className="min-w-0 flex-1 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-zinc-200 outline-none"
                              />

                              <button
                                type="button"
                                onClick={() =>
                                  copyYouTubeText(
                                    `thumbnail-${index}`,
                                    item
                                  )
                                }
                                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
                              >
                                {copiedYouTubeField ===
                                `thumbnail-${index}`
                                  ? "✓"
                                  : "Copy"}
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    {/* Description */}
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                      <div className="flex items-center justify-between gap-4">
                        <h4 className="text-base font-semibold text-white">
                          Opening Description
                        </h4>

                        <button
                          type="button"
                          onClick={() =>
                            copyYouTubeText(
                              "opening-description",
                              youtubeFullPack.openingDescription
                            )
                          }
                          className="text-xs font-semibold text-zinc-400 hover:text-white"
                        >
                          {copiedYouTubeField ===
                          "opening-description"
                            ? "✓ Copied"
                            : "Copy"}
                        </button>
                      </div>

                      <textarea
                        value={youtubeFullPack.openingDescription}
                        onChange={(event) =>
                          updateYouTubePackField(
                            "openingDescription",
                            event.target.value
                          )
                        }
                        rows={4}
                        className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                      />

                      <div className="mt-6 border-t border-zinc-800 pt-6">
                        <div className="flex items-center justify-between gap-4">
                          <h4 className="text-base font-semibold text-white">
                            Creative Description
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "full-description",
                                youtubeFullPack.fullDescription
                              )
                            }
                            className="text-xs font-semibold text-zinc-400 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "full-description"
                              ? "✓ Copied"
                              : "Copy"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.fullDescription}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "fullDescription",
                              event.target.value
                            )
                          }
                          rows={14}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-zinc-700 bg-zinc-950 p-6">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                            Publishing Version
                          </p>

                          <h4 className="mt-1 text-base font-semibold text-white">
                            Final YouTube Description
                          </h4>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            copyYouTubeText(
                              "final-description",
                              youtubeFullPack.finalDescription ||
                                youtubeFullPack.fullDescription
                            )
                          }
                          className="rounded-lg border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800"
                        >
                          {copiedYouTubeField ===
                          "final-description"
                            ? "✓ Copied"
                            : "Copy Final Description"}
                        </button>
                      </div>

                      <p className="mt-3 text-xs leading-5 text-zinc-500">
                        Built automatically when you save from the
                        Creative Description + Release Details +
                        optional disclosure + your links. This is the
                        description Studio will later send to YouTube.
                      </p>

                      <textarea
                        readOnly
                        value={
                          youtubeFullPack.finalDescription ||
                          youtubeFullPack.fullDescription
                        }
                        rows={18}
                        className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none"
                      />
                    </div>

                    {/* Metadata */}
                    <div className="grid gap-5 lg:grid-cols-3">

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            Hashtags
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "hashtags",
                                youtubeFullPack.hashtags.join(" ")
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField === "hashtags"
                              ? "✓ Copied"
                              : "Copy all"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.hashtags.join("\n")}
                          onChange={(event) =>
                            updateYouTubePackArray(
                              "hashtags",
                              event.target.value
                            )
                          }
                          rows={7}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm leading-6 text-zinc-300 outline-none focus:border-zinc-600"
                        />

                        <p className="mt-2 text-xs text-zinc-600">
                          One hashtag per line
                        </p>
                      </div>

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            YouTube Tags
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "youtube-tags",
                                youtubeFullPack.tags.join(", ")
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "youtube-tags"
                              ? "✓ Copied"
                              : "Copy all"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.tags.join("\n")}
                          onChange={(event) =>
                            updateYouTubePackArray(
                              "tags",
                              event.target.value
                            )
                          }
                          rows={9}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm leading-6 text-zinc-300 outline-none focus:border-zinc-600"
                        />

                        <p className="mt-2 text-xs text-zinc-600">
                          One searchable tag per line
                        </p>
                      </div>

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            SEO Keywords
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "seo-keywords",
                                youtubeFullPack.seoKeywords.join(
                                  ", "
                                )
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "seo-keywords"
                              ? "✓ Copied"
                              : "Copy all"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.seoKeywords.join("\n")}
                          onChange={(event) =>
                            updateYouTubePackArray(
                              "seoKeywords",
                              event.target.value
                            )
                          }
                          rows={9}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm leading-6 text-zinc-300 outline-none focus:border-zinc-600"
                        />

                        <p className="mt-2 text-xs text-zinc-600">
                          One keyword phrase per line
                        </p>
                      </div>
                    </div>

                    {/* Pinned comments */}
                    <div className="grid gap-5 lg:grid-cols-2">

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            Pinned Comment
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "pinned-comment",
                                youtubeFullPack.pinnedComment
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "pinned-comment"
                              ? "✓ Copied"
                              : "Copy"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.pinnedComment}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "pinnedComment",
                              event.target.value
                            )
                          }
                          rows={7}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            Alternative Pinned Comment
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "alt-pinned-comment",
                                youtubeFullPack.alternativePinnedComment
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "alt-pinned-comment"
                              ? "✓ Copied"
                              : "Copy"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.alternativePinnedComment}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "alternativePinnedComment",
                              event.target.value
                            )
                          }
                          rows={7}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>
                    </div>

                    {/* Community */}
                    <div className="grid gap-5 lg:grid-cols-2">

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            Community Post
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "community-post",
                                youtubeFullPack.communityPost
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "community-post"
                              ? "✓ Copied"
                              : "Copy"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.communityPost}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "communityPost",
                              event.target.value
                            )
                          }
                          rows={8}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            Informal Community Post
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "informal-community",
                                youtubeFullPack.informalCommunityPost
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "informal-community"
                              ? "✓ Copied"
                              : "Copy"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.informalCommunityPost}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "informalCommunityPost",
                              event.target.value
                            )
                          }
                          rows={8}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>
                    </div>

                    {/* Release + playlist */}
                    <div className="grid gap-5 lg:grid-cols-2">
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            Release Announcement
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "release-post",
                                youtubeFullPack.releasePost
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "release-post"
                              ? "✓ Copied"
                              : "Copy"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.releasePost}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "releasePost",
                              event.target.value
                            )
                          }
                          rows={7}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <h4 className="font-semibold text-white">
                          Playlist Suggestion
                        </h4>

                        <textarea
                          value={youtubeFullPack.playlistSuggestion}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "playlistSuggestion",
                              event.target.value
                            )
                          }
                          rows={5}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>
                    </div>

                    {/* Credits / disclosure */}
                    <div className="grid gap-5 lg:grid-cols-2">

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            Credits
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "credits",
                                youtubeFullPack.credits
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField === "credits"
                              ? "✓ Copied"
                              : "Copy"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.credits}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "credits",
                              event.target.value
                            )
                          }
                          rows={8}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            Optional AI Disclosure
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "ai-disclosure",
                                youtubeFullPack.aiDisclosure
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "ai-disclosure"
                              ? "✓ Copied"
                              : "Copy"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.aiDisclosure}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "aiDisclosure",
                              event.target.value
                            )
                          }
                          rows={6}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>
                    </div>

                    {/* Strong lyric lines */}
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                      <h4 className="text-base font-semibold text-white">
                        Strongest Promotional Lyric Lines
                      </h4>

                      <div className="mt-4 space-y-2">
                        {youtubeFullPack.strongestLyricLines.map(
                          (line, index) => (
                            <div
                              key={`lyric-${index}`}
                              className="flex items-start gap-3 rounded-xl bg-zinc-900 px-4 py-3"
                            >
                              <textarea
                                value={line}
                                onChange={(event) =>
                                  updateYouTubePackArrayItem(
                                    "strongestLyricLines",
                                    index,
                                    event.target.value
                                  )
                                }
                                rows={2}
                                className="min-w-0 flex-1 resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-6 text-zinc-300 outline-none focus:border-zinc-600"
                              />

                              <button
                                type="button"
                                onClick={() =>
                                  copyYouTubeText(
                                    `lyric-${index}`,
                                    line
                                  )
                                }
                                className="shrink-0 text-xs text-zinc-500 hover:text-white"
                              >
                                {copiedYouTubeField ===
                                `lyric-${index}`
                                  ? "✓"
                                  : "Copy"}
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    {/* CTA + Shorts bridge */}
                    <div className="grid gap-5 lg:grid-cols-2">

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <h4 className="font-semibold text-white">
                          CTA Options
                        </h4>

                        <div className="mt-4 space-y-2">
                          {youtubeFullPack.ctaOptions.map(
                            (item, index) => (
                              <div
                                key={`cta-${index}`}
                                className="flex items-center gap-2"
                              >
                                <span className="text-zinc-600">
                                  •
                                </span>

                                <input
                                  value={item}
                                  onChange={(event) =>
                                    updateYouTubePackArrayItem(
                                      "ctaOptions",
                                      index,
                                      event.target.value
                                    )
                                  }
                                  className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-300 outline-none focus:border-zinc-600"
                                />
                              </div>
                            )
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                        <div className="flex justify-between gap-3">
                          <h4 className="font-semibold text-white">
                            Shorts → Full Song Bridge
                          </h4>

                          <button
                            type="button"
                            onClick={() =>
                              copyYouTubeText(
                                "shorts-bridge",
                                youtubeFullPack.shortsBridgeCopy
                              )
                            }
                            className="text-xs text-zinc-500 hover:text-white"
                          >
                            {copiedYouTubeField ===
                            "shorts-bridge"
                              ? "✓ Copied"
                              : "Copy"}
                          </button>
                        </div>

                        <textarea
                          value={youtubeFullPack.shortsBridgeCopy}
                          onChange={(event) =>
                            updateYouTubePackField(
                              "shortsBridgeCopy",
                              event.target.value
                            )
                          }
                          rows={6}
                          className="mt-4 w-full resize-y rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-7 text-zinc-300 outline-none focus:border-zinc-600"
                        />
                      </div>
                    </div>

                    {/* Filename */}
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                      <div className="flex justify-between gap-3">
                        <h4 className="font-semibold text-white">
                          Suggested Video Filename
                        </h4>

                        <button
                          type="button"
                          onClick={() =>
                            copyYouTubeText(
                              "filename",
                              youtubeFullPack.filenameSuggestion
                            )
                          }
                          className="text-xs text-zinc-500 hover:text-white"
                        >
                          {copiedYouTubeField === "filename"
                            ? "✓ Copied"
                            : "Copy"}
                        </button>
                      </div>

                      <input
                        value={youtubeFullPack.filenameSuggestion}
                        onChange={(event) =>
                          updateYouTubePackField(
                            "filenameSuggestion",
                            event.target.value
                          )
                        }
                        className="mt-4 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 font-mono text-sm text-zinc-300 outline-none focus:border-zinc-600"
                      />
                    </div>

                    {/* Upload checklist */}
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                      <h4 className="text-base font-semibold text-white">
                        YouTube Upload Checklist
                      </h4>

                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {youtubeFullPack.uploadChecklist.map(
                          (item, index) => (
                            <div
                              key={`checklist-${index}`}
                              className="flex items-start gap-3 rounded-xl bg-zinc-900 px-4 py-3"
                            >
                              <span className="pt-2 text-zinc-500">
                                ✓
                              </span>

                              <textarea
                                value={item}
                                onChange={(event) =>
                                  updateYouTubePackArrayItem(
                                    "uploadChecklist",
                                    index,
                                    event.target.value
                                  )
                                }
                                rows={2}
                                className="min-w-0 flex-1 resize-y rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-6 text-zinc-300 outline-none focus:border-zinc-600"
                              />
                            </div>
                          )
                        )}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {lyrics && (
          <section
            hidden={workspaceView !== "song"}
            id="critic-section"
            className="mt-6 scroll-mt-24 rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7"
          >
            <SectionHeader
              eyebrow="Analysis"
              title="Critic Mode"
              subtitle="Professional review of the complete song."
              open={criticOpen}
              onToggle={() =>
                setCriticOpen(
                  (value) => !value
                )
              }
              badge={
                critique
                  ? `${critique.score}/10`
                  : undefined
              }
            />

            {criticOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">
                {!critique ? (
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
                    <p className="text-zinc-400">
                      Run Critic Mode from the Full Song section to generate a professional review.
                    </p>

                    <button
                      onClick={runCriticMode}
                      disabled={criticLoading}
                      className="mt-5 rounded-xl bg-white px-5 py-3 font-semibold text-black hover:bg-zinc-200 disabled:opacity-50"
                    >
                      {criticLoading
                        ? "Analysing..."
                        : "Run Critic Mode"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-7">
                    <div className="flex flex-wrap items-start justify-between gap-5">
                      <div>
                        <p className="text-sm uppercase tracking-widest text-zinc-500">
                          Verdict
                        </p>

                        <p className="mt-3 max-w-3xl text-lg leading-7 text-zinc-200">
                          {critique.verdict}
                        </p>
                      </div>

                      <div className="rounded-2xl bg-white px-5 py-3 text-center text-black">
                        <p className="text-xs font-semibold uppercase tracking-wider">
                          Score
                        </p>

                        <p className="text-3xl font-bold">
                          {critique.score}
                          <span className="text-lg text-zinc-500">
                            /10
                          </span>
                        </p>
                      </div>
                    </div>

                    {critique.priority?.length > 0 && (
                      <div>
                        <h4 className="text-lg font-semibold">
                          Top Priorities
                        </h4>

                        <div className="mt-3 space-y-3">
                          {critique.priority.map(
                            (item, index) => (
                              <div
                                key={index}
                                className="flex gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                              >
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-black">
                                  {index + 1}
                                </span>

                                <p className="text-zinc-300">
                                  {item}
                                </p>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {critique.strengths?.length > 0 && (
                      <div>
                        <h4 className="text-lg font-semibold">
                          What Works
                        </h4>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {critique.strengths.map(
                            (item, index) => (
                              <div
                                key={index}
                                className="rounded-xl border border-green-900/60 bg-green-950/20 p-4 text-zinc-300"
                              >
                                {item}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {critique.issues?.length > 0 && (
                      <div>
                        <h4 className="text-lg font-semibold">
                          Lines To Look At
                        </h4>

                        <div className="mt-4 space-y-4">
                          {critique.issues.map(
                            (issue, index) => (
                              <div
                                key={index}
                                className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
                              >
                                <div className="flex flex-wrap items-center gap-3">
                                  {issue.section && (
                                    <span className="text-sm font-semibold text-zinc-300">
                                      {issue.section}
                                    </span>
                                  )}

                                  {issue.severity && (
                                    <span
                                      className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${severityClass(
                                        issue.severity
                                      )}`}
                                    >
                                      {issue.severity}
                                    </span>
                                  )}
                                </div>

                                {issue.line && (
                                  <div className="mt-4 rounded-xl border-l-4 border-zinc-600 bg-zinc-900 p-4 text-lg text-white">
                                    “{issue.line}”
                                  </div>
                                )}

                                {issue.problem && (
                                  <div className="mt-4">
                                    <p className="text-xs uppercase tracking-wider text-zinc-500">
                                      Problem
                                    </p>

                                    <p className="mt-1 text-zinc-300">
                                      {issue.problem}
                                    </p>
                                  </div>
                                )}

                                {issue.why && (
                                  <div className="mt-4">
                                    <p className="text-xs uppercase tracking-wider text-zinc-500">
                                      Why
                                    </p>

                                    <p className="mt-1 text-zinc-300">
                                      {issue.why}
                                    </p>
                                  </div>
                                )}

                                {issue.suggestion && (
                                  <div className="mt-4">
                                    <p className="text-xs uppercase tracking-wider text-zinc-500">
                                      Direction
                                    </p>

                                    <p className="mt-1 text-zinc-300">
                                      {issue.suggestion}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {critique.strongLines?.length > 0 && (
                      <div>
                        <h4 className="text-lg font-semibold">
                          Strongest Lines
                        </h4>

                        <div className="mt-4 space-y-3">
                          {critique.strongLines.map(
                            (item, index) => (
                              <div
                                key={index}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 p-5"
                              >
                                {item.line && (
                                  <p className="text-lg text-white">
                                    “{item.line}”
                                  </p>
                                )}

                                {item.why && (
                                  <p className="mt-3 text-sm leading-6 text-zinc-400">
                                    {item.why}
                                  </p>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {lyrics && (
          <section
            hidden={workspaceView !== "song"}
            id="why-line-section"
            className="mt-6 scroll-mt-24 rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7"
          >
            <SectionHeader
              eyebrow="Lyric Inspector"
              title="Why This Line?"
              subtitle="Analyse one line, several connected lines or a whole stanza."
              open={whyLineOpen}
              onToggle={() =>
                setWhyLineOpen(
                  (value) => !value
                )
              }
              badge={
                lineAnalysis
                  ? lineAnalysis.verdict.toUpperCase()
                  : undefined
              }
            />

            {whyLineOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">

                {lineToAnalyse && (
                  <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-400">
                    Selected directly from your song. You can still edit the text below before analysing.
                  </div>
                )}

                <textarea
                  value={lineToAnalyse}
                  onChange={(e) => {
                    setLineToAnalyse(
                      e.target.value
                    );

                    setSelectedLyricSource(null);
                    setAlternativeMessage("");
                  }}
                  placeholder="Click a line or section in the Full Song above, or paste lyrics here..."
                  className="min-h-40 w-full resize-y rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-lg leading-8 text-white outline-none focus:border-zinc-400"
                />

                <button
                  onClick={analyseLine}
                  disabled={
                    lineAnalysisLoading ||
                    !lineToAnalyse.trim()
                  }
                  className="mt-4 w-full rounded-xl bg-white px-5 py-4 font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {lineAnalysisLoading
                    ? "Analysing Lyrics..."
                    : "Analyse Selected Lyrics"}
                </button>

                {lineAnalysis && (
                  <div className="mt-7 border-t border-zinc-800 pt-7">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="max-w-3xl">
                        <p className="text-sm uppercase tracking-widest text-zinc-500">
                          Selected Lyrics
                        </p>

                        <div className="mt-3 whitespace-pre-wrap rounded-xl border-l-4 border-zinc-600 bg-zinc-950 p-4 text-lg leading-8 text-white">
                          {lineAnalysis.selectedText ||
                            lineAnalysis.line}
                        </div>
                      </div>

                      <span
                        className={`rounded-full border px-4 py-2 text-sm font-semibold uppercase ${verdictClass(
                          lineAnalysis.verdict
                        )}`}
                      >
                        {lineAnalysis.verdict}
                      </span>
                    </div>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {[
                        [
                          "Meaning",
                          lineAnalysis.meaning,
                        ],
                        [
                          "Emotional Purpose",
                          lineAnalysis.emotionalPurpose,
                        ],
                        [
                          "Context",
                          lineAnalysis.context,
                        ],
                        [
                          "Originality",
                          lineAnalysis.originality,
                        ],
                        [
                          "Singability",
                          lineAnalysis.singability,
                        ],
                        [
                          "Word Choice",
                          lineAnalysis.wordChoice,
                        ],
                      ].map(
                        ([label, text]) => (
                          <div
                            key={label}
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
                          >
                            <p className="text-xs uppercase tracking-widest text-zinc-500">
                              {label}
                            </p>

                            <p className="mt-3 leading-7 text-zinc-300">
                              {text}
                            </p>
                          </div>
                        )
                      )}

                      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5 md:col-span-2">
                        <p className="text-xs uppercase tracking-widest text-zinc-500">
                          Flow
                        </p>

                        <p className="mt-3 leading-7 text-zinc-300">
                          {lineAnalysis.flow}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                      <p className="text-xs uppercase tracking-widest text-zinc-500">
                        Verdict
                      </p>

                      <p className="mt-3 leading-7 text-zinc-300">
                        {lineAnalysis.reason}
                      </p>
                    </div>

                    {(lineAnalysis.strongestLine ||
                      lineAnalysis.weakestLine) && (
                      <div className="mt-5 grid gap-4 md:grid-cols-2">
                        {lineAnalysis.strongestLine && (
                          <div className="rounded-2xl border border-green-900/60 bg-green-950/20 p-5">
                            <p className="text-xs uppercase tracking-widest text-green-400">
                              Strongest Line
                            </p>

                            <p className="mt-3 text-lg leading-7 text-zinc-100">
                              “
                              {lineAnalysis.strongestLine}
                              ”
                            </p>
                          </div>
                        )}

                        {lineAnalysis.weakestLine && (
                          <div className="rounded-2xl border border-amber-900/60 bg-amber-950/20 p-5">
                            <p className="text-xs uppercase tracking-widest text-amber-400">
                              Weakest Line
                            </p>

                            <p className="mt-3 text-lg leading-7 text-zinc-100">
                              “
                              {lineAnalysis.weakestLine}
                              ”
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {lineAnalysis.alternatives?.length > 0 && (
                      <div className="mt-6">
                        <h4 className="text-lg font-semibold">
                          Possible Alternatives
                        </h4>

                        <p className="mt-1 text-sm text-zinc-500">
                          Analyse an alternative first, or place it directly into the song.
                        </p>

                        <div className="mt-4 space-y-3">
                          {lineAnalysis.alternatives.map(
                            (alternative, index) => (
                              <div
                                key={index}
                                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                              >
                                <p className="whitespace-pre-wrap text-lg leading-8 text-zinc-200">
                                  {alternative}
                                </p>

                                <div className="mt-4 flex flex-wrap gap-2">
                                  <button
                                    onClick={() => {
                                      setLineToAnalyse(
                                        alternative
                                      );

                                      setSelectedLyricSource(
                                        null
                                      );

                                      setLineAnalysis(null);
                                    }}
                                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800"
                                  >
                                    Analyse Alternative
                                  </button>

                                  <button
                                    onClick={() =>
                                      applyAlternative(
                                        alternative
                                      )
                                    }
                                    disabled={
                                      applyingAlternative ||
                                      !selectedLyricSource
                                    }
                                    className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {applyingAlternative
                                      ? "Applying..."
                                      : "Use This Alternative"}
                                  </button>
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {lyrics && (
          <section hidden={workspaceView !== "song"} className="mt-6 rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7">
            <SectionHeader
              eyebrow="Song Editor"
              title="Rewrite a Section"
              subtitle="Improve one part without rewriting the rest of the song."
              open={rewriteOpen}
              onToggle={() =>
                setRewriteOpen(
                  (value) => !value
                )
              }
            />

            {rewriteOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">
                {rewriteMessage && (
                  <div className="mb-5 rounded-xl border border-green-900 bg-green-950/30 p-4 text-sm text-green-300">
                    {rewriteMessage}
                  </div>
                )}

                <div className="grid gap-5 md:grid-cols-[260px_1fr]">
                  <div>
                    <label className="mb-2 block text-sm text-zinc-400">
                      Section
                    </label>

                    <select
                      value={
                        rewriteSectionName
                      }
                      onChange={(e) => {
                        setRewriteSectionName(
                          e.target.value
                        );

                        setRewriteMessage("");
                      }}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white"
                    >
                      <option value="">
                        Choose section...
                      </option>

                      {sectionOptions.map(
                        (section) => (
                          <option
                            key={section}
                            value={section}
                          >
                            {section}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-zinc-400">
                      What should change?
                    </label>

                    <textarea
                      value={
                        rewriteInstruction
                      }
                      onChange={(e) => {
                        setRewriteInstruction(
                          e.target.value
                        );

                        setRewriteMessage("");
                      }}
                      placeholder="Example: Make this more nostalgic, less obvious and use stronger imagery."
                      className="min-h-28 w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-white outline-none focus:border-zinc-400"
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    [
                      "More emotional",
                      "Make this more emotional and memorable without becoming melodramatic.",
                    ],
                    [
                      "More nostalgic",
                      "Make this more nostalgic, subtle and full of lived memories.",
                    ],
                    [
                      "Less cliché",
                      "Remove clichés and make the writing fresher, more original and natural.",
                    ],
                    [
                      "More singable",
                      "Make the lines shorter, tighter and more singable while keeping the meaning.",
                    ],
                    [
                      "Surprise me",
                      "Take a completely different creative approach to this section while keeping it connected to the rest of the song.",
                    ],
                  ].map(
                    ([label, instruction]) => (
                      <button
                        key={label}
                        onClick={() =>
                          setRewriteInstruction(
                            instruction
                          )
                        }
                        className="rounded-full border border-zinc-700 px-4 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
                      >
                        {label}
                      </button>
                    )
                  )}
                </div>

                <button
                  onClick={rewriteSection}
                  disabled={
                    rewritingSection ||
                    !rewriteSectionName ||
                    !rewriteInstruction.trim()
                  }
                  className="mt-6 w-full rounded-xl bg-white px-5 py-4 font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {rewritingSection
                    ? `Rewriting ${rewriteSectionName}...`
                    : rewriteSectionName
                    ? `Rewrite ${rewriteSectionName}`
                    : "Rewrite Section"}
                </button>
              </div>
            )}
          </section>
        )}

        {lyrics && (
          <section hidden={workspaceView !== "song"} className="mt-6 rounded-[28px] border border-white/10 bg-zinc-900/55 p-5 shadow-[0_24px_80px_-48px_rgba(0,0,0,0.95)] backdrop-blur-sm sm:p-7">
            <SectionHeader
              eyebrow="History"
              title="Version History"
              subtitle="View or restore your previous work."
              open={historyOpen}
              onToggle={() =>
                setHistoryOpen(
                  (value) => !value
                )
              }
              badge={
                versions.length
                  ? `${versions.length} saved`
                  : "No earlier versions"
              }
            />

            {historyOpen && (
              <div className="mt-7 border-t border-zinc-800 pt-7">
                <div className="flex justify-end">
                  <button
                    onClick={() =>
                      loadVersionHistory()
                    }
                    className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
                  >
                    Refresh History
                  </button>
                </div>

                {versionMessage && (
                  <div className="mt-5 rounded-xl border border-green-900 bg-green-950/30 p-4 text-sm text-green-300">
                    {versionMessage}
                  </div>
                )}

                <div className="mt-5 rounded-2xl border border-zinc-700 bg-zinc-950 p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Current Version
                      </p>

                      <p className="mt-1 text-sm text-zinc-500">
                        This is the version currently shown above.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          setCurrentVersionOpen(
                            (value) => !value
                          )
                        }
                        className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
                      >
                        {currentVersionOpen
                          ? "Hide"
                          : "View"}
                      </button>

                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                        Current
                      </span>
                    </div>
                  </div>

                  {currentVersionOpen && (
                    <div className="mt-5 border-t border-zinc-800 pt-5">
                      {songTitle && (
                        <h4 className="mb-4 text-xl font-semibold">
                          {songTitle}
                        </h4>
                      )}

                      <div className="max-h-[600px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-zinc-900 p-5 text-lg leading-8 text-zinc-300">
                        {lyrics}
                      </div>
                    </div>
                  )}
                </div>

                {versionsLoading ? (
                  <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-400">
                    Loading previous versions...
                  </div>
                ) : versions.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-400">
                    No previous versions yet.
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    {[...versions]
                      .reverse()
                      .map((version, displayIndex) => {
                        const isOpen =
                          openVersionIndex ===
                          version.index;

                        return (
                          <div
                            key={`${version.index}-${displayIndex}`}
                            className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
                          >
                            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                              <div>
                                <p className="font-semibold text-zinc-200">
                                  {getVersionLabel(
                                    version
                                  )}
                                </p>

                                {version.savedAt && (
                                  <p className="mt-1 text-sm text-zinc-500">
                                    {new Date(
                                      version.savedAt
                                    ).toLocaleString()}
                                  </p>
                                )}

                                {version.instruction && (
                                  <p className="mt-3 text-sm text-zinc-400">
                                    Request: “
                                    {
                                      version.instruction
                                    }
                                    ”
                                  </p>
                                )}
                              </div>

                              <div className="flex gap-2">
                                <button
                                  onClick={() =>
                                    setOpenVersionIndex(
                                      isOpen
                                        ? null
                                        : version.index
                                    )
                                  }
                                  className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800"
                                >
                                  {isOpen
                                    ? "Hide"
                                    : "View"}
                                </button>

                                <button
                                  onClick={() =>
                                    restoreVersion(
                                      version.index
                                    )
                                  }
                                  disabled={
                                    restoringVersion !==
                                    null
                                  }
                                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200 disabled:opacity-40"
                                >
                                  {restoringVersion ===
                                  version.index
                                    ? "Restoring..."
                                    : "Restore"}
                                </button>
                              </div>
                            </div>

                            {isOpen && (
                              <div className="mt-5 border-t border-zinc-800 pt-5">
                                {version.title && (
                                  <h4 className="mb-4 text-xl font-semibold">
                                    {version.title}
                                  </h4>
                                )}

                                <div className="max-h-[600px] overflow-y-auto whitespace-pre-wrap rounded-xl bg-zinc-900 p-5 text-lg leading-8 text-zinc-300">
                                  {version.lyrics}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </section>
        )}


        <div hidden={workspaceView !== "publish"}>
          <PublishingHub projectId={activeProjectId} songTitle={songTitle} />
        </div>

        <section
          hidden={workspaceView !== "analytics"}
          className="rounded-[30px] border border-slate-800 bg-gradient-to-br from-[#0d1825] to-[#09131f] p-6 shadow-[0_28px_90px_-52px_rgba(0,0,0,1)] sm:p-8 lg:p-10"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-emerald-300/75">Performance & Analytics</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white">Create → Publish → Measure → Improve</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            After publishing is connected, Studio will bring back the performance metrics each platform officially exposes and tie them to the song, post and release.
          </p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {["Views & reach", "Watch performance", "Engagement", "Cross-platform insights"].map((metric) => (
              <div key={metric} className="rounded-2xl border border-slate-800 bg-[#111c2b] p-5 text-sm font-semibold text-slate-200">
                {metric}
              </div>
            ))}
          </div>
        </section>

        <section hidden={workspaceView !== "library"} id="library-section" className="scroll-mt-24 rounded-[30px] border border-white/[0.09] bg-gradient-to-br from-[#0d1724] to-[#09121e] p-5 shadow-[0_28px_90px_-52px_rgba(0,0,0,1)] sm:p-7 lg:p-8">
          <SectionHeader
            eyebrow="Library"
            title="My Songs"
            subtitle="Your creative catalogue — reopen any song and continue exactly where you left off."
            open={libraryOpen}
            onToggle={() =>
              setLibraryOpen(
                (value) => !value
              )
            }
            badge={`${projects.length} projects`}
          />

          {libraryOpen && (
            <div className="mt-7 border-t border-white/[0.07] pt-7">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative md:hidden">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">⌕</span>
                    <input
                      value={librarySearch}
                      onChange={(event) => setLibrarySearch(event.target.value)}
                      placeholder="Search songs..."
                      className="w-full rounded-xl border border-slate-700 bg-[#111c2b] py-2 pl-9 pr-3 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-blue-400/50"
                    />
                  </div>
                  <div className="inline-flex w-fit rounded-2xl border border-white/[0.07] bg-black/25 p-1.5">
                  {[
                    ["all", `All ${projects.length}`],
                    [
                      "full",
                      `Full ${
                        projects.filter(
                          (project) =>
                            project.status === "song-generated" ||
                            project.status === "lyrics-imported"
                        ).length
                      }`,
                    ],
                    [
                      "progress",
                      `In progress ${
                        projects.filter(
                          (project) =>
                            project.status !== "song-generated" &&
                            project.status !== "lyrics-imported"
                        ).length
                      }`,
                    ],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setLibraryFilter(value);
                        setLibraryProjectId("");
                      }}
                      className={
                        libraryFilter === value
                          ? "rounded-xl bg-gradient-to-r from-blue-500/90 to-indigo-500/90 px-4 py-2 text-xs font-bold text-white shadow-[0_10px_24px_-14px_rgba(59,130,246,.75)]"
                          : "rounded-xl px-4 py-2 text-xs font-semibold text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-200"
                      }
                    >
                      {label}
                    </button>
                  ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={loadProjects}
                  className="w-fit rounded-xl border border-white/[0.09] bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-300 transition hover:border-blue-300/25 hover:bg-white/[0.06] hover:text-white"
                >
                  Refresh library
                </button>
              </div>

              {projectsLoading ? (
                <div className="rounded-[24px] border border-white/[0.07] bg-black/20 p-7 text-sm text-zinc-500">
                  Loading saved songs...
                </div>
              ) : projects.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-white/[0.10] bg-black/20 p-10 text-center">
                  <p className="text-lg font-semibold text-zinc-200">Your song library is waiting.</p>
                  <p className="mt-2 text-sm text-zinc-500">Create from an idea or import finished lyrics and your projects will appear here.</p>
                </div>
              ) : filteredProjects.length === 0 ? (
                <div className="rounded-[24px] border border-white/[0.07] bg-black/20 p-7 text-sm text-zinc-500">
                  No songs match this filter yet.
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {filteredProjects.map((project, index) => {
                    const name =
                      project.title?.trim() ||
                      project.idea?.trim() ||
                      "Untitled project";

                    const isImported = project.status === "lyrics-imported";
                    const isFull =
                      project.status === "song-generated" || isImported;
                    const isCurrent = activeProjectId === project.id;

                    const statusLabel = isImported
                      ? "Imported · Full Song"
                      : project.status === "song-generated"
                        ? "Full Song"
                        : project.status === "hook-selected"
                          ? "Hook Selected"
                          : "Hooks Only";

                    const updated = project.updatedAt || project.createdAt;
                    const updatedLabel = updated
                      ? new Date(updated).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "Saved project";

                    const gradients = [
                      "linear-gradient(135deg, rgba(245,158,11,.34), rgba(15,23,42,.72) 56%, rgba(14,165,233,.18))",
                      "linear-gradient(135deg, rgba(14,165,233,.30), rgba(15,23,42,.78) 56%, rgba(16,185,129,.15))",
                      "linear-gradient(135deg, rgba(244,63,94,.22), rgba(15,23,42,.78) 56%, rgba(59,130,246,.18))",
                      "linear-gradient(135deg, rgba(56,189,248,.24), rgba(15,23,42,.82) 54%, rgba(245,158,11,.16))",
                    ];

                    return (
                      <article
                        key={project.id}
                        className={`group overflow-hidden rounded-[26px] border bg-[#0d0d13] transition duration-200 hover:-translate-y-0.5 hover:border-blue-300/25 hover:shadow-[0_24px_70px_-42px_rgba(59,130,246,.60)] ${
                          isCurrent
                            ? "border-blue-300/30 ring-1 ring-blue-300/10"
                            : "border-white/[0.07]"
                        }`}
                      >
                        <div
                          className="relative h-32 overflow-hidden border-b border-white/[0.06] p-5"
                          style={{ background: gradients[index % gradients.length] }}
                        >
                          <div className="absolute inset-0 opacity-[0.22] [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:28px_28px]" />
                          <div className="relative flex h-full items-start justify-between gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-black/25 text-xl font-black text-white shadow-xl backdrop-blur-sm">
                              {name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex flex-wrap justify-end gap-2">
                              {isCurrent && (
                                <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-200">
                                  Current
                                </span>
                              )}
                              <span className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/75 backdrop-blur-sm">
                                {project.language || "Song"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h3 className="truncate text-lg font-semibold tracking-[-0.02em] text-zinc-100">
                                {name}
                              </h3>
                              <p className="mt-1 truncate text-xs text-zinc-600">
                                {[project.mood, project.genre].filter(Boolean).join(" · ") || "Song project"}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                                isFull
                                  ? "border-violet-300/15 bg-violet-300/[0.08] text-violet-200"
                                  : "border-amber-300/15 bg-amber-300/[0.07] text-amber-200"
                              }`}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
                            <p className="text-[11px] text-zinc-600">Updated {updatedLabel}</p>
                            <button
                              type="button"
                              onClick={() => openProject(project)}
                              className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-black transition hover:bg-fuchsia-100"
                            >
                              {isCurrent ? "Reopen" : "Continue"}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

          </div>
        </div>
      </div>

      <PublicFooter />
    </main>
  );
}
