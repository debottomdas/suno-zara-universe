import OpenAI from "openai";
import {channelInstructions} from '@/utils/channel-dna/instructions';
import type {ChannelContext} from '@/utils/channel-dna/context';

const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});

export type YouTubeFullPack = {
  generatorGuidance: string;
  releaseDetails: {
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
  finalDescription: string;
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
};

export function buildYouTubeCredits(releaseDetails: {
  artistBrand: string;
  lyricsCredit: string;
  compositionCredit: string;
  producerCredit: string;
}) {
  return [
    releaseDetails.artistBrand
      ? `Artist / Brand: ${releaseDetails.artistBrand}`
      : "",
    releaseDetails.lyricsCredit,
    releaseDetails.compositionCredit,
    releaseDetails.producerCredit,
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

export function buildFinalYouTubeDescription({
  creativeDescription,
  credits,
  aiDisclosure,
  descriptionLinks,
  cta = "",
}: {
  creativeDescription: string;
  credits: string;
  aiDisclosure: string;
  descriptionLinks: string;
  cta?: string;
}) {
  const cleanCreative = creativeDescription.trim();
  const cleanCta = cta.trim();
  const includeCta = cleanCta && !cleanCreative.toLocaleLowerCase().includes(cleanCta.toLocaleLowerCase());
  const sections = [
    cleanCreative,

    credits.trim(),

    aiDisclosure.trim()
      ? `AI / Production Disclosure\n${aiDisclosure.trim()}`
      : "",

    descriptionLinks.trim()
      ? `Listen / Follow\n${descriptionLinks.trim()}`
      : "",

    includeCta ? cleanCta : "",
  ].filter(Boolean);

  return sections.join("\n\n");
}

function cleanStringArray(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function uniqueCaseInsensitive(values: string[], maxItems: number) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxItems);
}

function hashtagFrom(value: string) {
  const compact = value.normalize('NFKC').replace(/^#+/u, '').replace(/[^\p{L}\p{N}]+/gu, '');
  return compact ? `#${compact}` : '';
}

export function normalizeYouTubeDiscovery(parsed: Partial<YouTubeFullPack>, songTitle: string) {
  const seo = cleanStringArray(parsed.seoKeywords, 20);
  const tags = uniqueCaseInsensitive([
    ...cleanStringArray(parsed.tags, 30),
    ...seo,
    songTitle,
  ], 30);
  const hashtags = uniqueCaseInsensitive([
    ...cleanStringArray(parsed.hashtags, 15).map((value) => value.startsWith('#') ? value : hashtagFrom(value)),
    ...seo.map(hashtagFrom),
    ...tags.map(hashtagFrom),
  ].filter(Boolean), 10);
  return { hashtags: hashtags.slice(0, 10), tags: tags.slice(0, 30), seoKeywords: seo };
}


function wordCount(value: string) {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function hasNativeTitleScript(value: string, language: string) {
  const first = value.split('|')[0]?.trim() || value.trim();
  const lang = language.toLocaleLowerCase();
  if (lang.includes('hindi') || lang === 'hi') return /[\u0900-\u097F]/u.test(first);
  if (lang.includes('bengali') || lang.includes('bangla') || lang === 'bn') return /[\u0980-\u09FF]/u.test(first);
  return true;
}

function cleanCreativeDescription(value: string, removableLines: string[]) {
  const remove = new Set(removableLines.map(v => v.trim().toLocaleLowerCase()).filter(Boolean));
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return true;
      const lower = line.toLocaleLowerCase();
      if (remove.has(lower)) return false;
      if (/^#[\p{L}\p{N}_]+(?:\s+#[\p{L}\p{N}_]+)*$/u.test(line)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type YouTubeFullSong = {
  id: string;
  title: string;
  english_title?: string | null;
  idea?: string | null;
  language: string;
  script?: string | null;
  mood?: string | null;
  genre?: string | null;
  freedom?: number | string | null;
  selected_hook?: string | null;
  lyrics?: string | null;
};

export type YouTubeReleaseDetails = YouTubeFullPack["releaseDetails"];

export async function generateYouTubeFullPack({
  song,
  channelContext,
  generatorGuidance = "",
  releaseDetails,
}: {
  song: YouTubeFullSong;
  channelContext: ChannelContext;
  generatorGuidance?: string;
  releaseDetails: YouTubeReleaseDetails;
}) {
  if (!song.lyrics?.trim()) throw new Error("Generate the full song before creating the YouTube pack.");

  const normalizedReleaseDetails = {...releaseDetails};
  normalizedReleaseDetails.artistBrand = channelContext.channelName;
  if (channelContext.dna?.sections.publishing.fields.links) {
    normalizedReleaseDetails.descriptionLinks = channelContext.dna.sections.publishing.fields.links;
  }
  releaseDetails = normalizedReleaseDetails;
  const dnaInstructions = channelInstructions(channelContext, 'social');
  const started = Date.now();

  const systemPrompt = `
  You are a senior YouTube music release strategist, metadata writer,
  copywriter and audience-development specialist.
  
  Create a COMPLETE YouTube Full Song release package for one original song.
  
  Everything must be specific to the supplied song.
  
  Analyse:
  - title
  - full lyrics
  - selected hook
  - language
  - mood
  - genre
  - cultural context
  - listener emotion
  - likely search behaviour
  
  RULES:
  
  1. Recommended title must balance emotional appeal,
     readability, song identity and discoverability. The FIRST title segment must
     be the song title in its native script. For Hindi use Devanagari; for Bengali
     use Bengali script. If a Roman/English title is useful, place it after the
     native title, separated by " | ". Never replace the native-script title with
     a Roman transliteration.
  
  2. Never keyword-stuff.
  
  3. Every YouTube title must stay below 100 characters.
  
  4. Alternative titles must genuinely differ.
  
  5. Thumbnail text should normally be 2 to 6 words.
  
  6. The opening description must be strong because it appears
     before "Show more".
  
  7. Before writing metadata, understand the song from the supplied full lyrics.
     Determine the central theme or story, emotional arc, relationship or situation
     where supported, mood, listener connection, language and cultural context,
     likely target listener, distinctive lyrical concepts, strongest hooks, and
     relevant search/discovery concepts. Ground the release package in that
     understanding rather than generic music-marketing language.
  
  8. Full description must be genuinely specific to this song and sound human,
     not like SEO spam. Write naturally for the song's language, script and
     intended audience. Normally aim for roughly 120 to 220 words when the song
     provides enough meaningful material. Open with a strong emotional hook,
     then describe the song's story, theme and emotional experience. Mention
     musical mood or style only when supported by the supplied song information.
     Include a natural listener invitation or CTA where appropriate. Avoid
     generic filler and unnecessary repetition of the title. Do NOT put credits,
     links, fixed channel branding or hashtags inside fullDescription because
     the application assembles those separately.
  
  9. Generate 5 to 10 useful SONG-SPECIFIC discovery hashtags when enough
     relevant concepts exist. Derive them from the actual song theme, mood,
     genre, language and likely audience. Avoid generic stuffing, near-duplicates
     and permanent channel hashtags already supplied through Channel DNA.
  
  10. Generate approximately 15 to 25 useful YouTube search tags when enough
  relevant concepts exist. Use sensible combinations of song/title concepts,
  theme and emotion, genre/style, language/audience and likely listener
  searches. Do not keyword-stuff or create repetitive variants.
  
  11. SEO keyword ideas must reflect genuine likely listener search intent.
  Prioritise relevance over speculative search-volume claims. Never invent
  trends, popularity, artist associations or unsupported facts.
  
  12. Tags must NOT contain # symbols.
  
  13. Strongest lyric lines must be copied from the supplied lyrics.
  Never invent lyric lines.
  
  14. Pinned comments should invite genuine conversation.
  
  15. Never invent singers, collaborators or record labels.
  
  16. AI disclosure is optional suggested wording only.
  Keep it neutral and concise.
  
  17. Filename must be filesystem-friendly.
  
  18. Adapt the writing style to the song language and audience.
  
  Return ONLY valid JSON in exactly this structure:
  
  {
    "recommendedTitle": "",
    "whyRecommended": "",
    "alternativeTitles": ["", "", "", ""],
    "thumbnailTextOptions": ["", "", ""],
    "openingDescription": "",
    "fullDescription": "",
    "credits": "",
    "aiDisclosure": "",
    "hashtags": [],
    "tags": [],
    "seoKeywords": [],
    "pinnedComment": "",
    "alternativePinnedComment": "",
    "communityPost": "",
    "informalCommunityPost": "",
    "releasePost": "",
    "playlistSuggestion": "",
    "strongestLyricLines": [],
    "ctaOptions": [],
    "shortsBridgeCopy": "",
    "filenameSuggestion": "",
    "uploadChecklist": []
  }
  `.trim();
  
  const userPrompt = `
  ${dnaInstructions}
  
  Create the complete YouTube Full Song release package for this song.
  
  TITLE:
  ${song.title || "Untitled"}
  
  IDEA:
  ${song.idea || "Not specified"}
  
  LANGUAGE:
  ${song.language || "Not specified"}
  
  SCRIPT:
  ${song.script || "Not specified"}
  
  MOOD:
  ${song.mood || "Not specified"}
  
  GENRE:
  ${song.genre || "Not specified"}
  
  CREATIVE FREEDOM:
  ${song.freedom ?? "Not specified"}
  
  SELECTED HOOK:
  ${song.selected_hook || "Not specified"}
  
  FULL LYRICS:
  ${song.lyrics}
  
  OPTIONAL CREATOR DIRECTION FOR THIS YOUTUBE RELEASE:
  
  ${
    generatorGuidance ||
    "No additional direction supplied. Use your best judgement."
  }
  
  FACTUAL RELEASE DETAILS:
  
  Release type:
  ${releaseDetails.releaseType || "Not specified"}
  
  Artist / Brand:
  ${releaseDetails.artistBrand || "Not specified"}
  
  Lyrics credit:
  ${releaseDetails.lyricsCredit || "Not specified"}
  
  Music / Composition credit:
  ${releaseDetails.compositionCredit || "Not specified"}
  
  Producer credit:
  ${releaseDetails.producerCredit || "Not specified"}
  
  Preferred playlist:
  ${releaseDetails.preferredPlaylist || "Not specified"}
  
  AI / synthetic-media disclosure requested:
  ${releaseDetails.includeAiDisclosure ? "Yes" : "No"}
  
  AI usage details supplied by creator:
  ${releaseDetails.aiDisclosureDetails || "Not specified"}
  
  Description / streaming / social links:
  ${releaseDetails.descriptionLinks || "Not specified"}
  
  IMPORTANT FACTUAL RULES:
  
  - These release details are creator-supplied facts.
  - Never invent or replace credits.
  - Never invent collaborators.
  - Never invent links.
  - Never claim a playlist exists if none was supplied.
  - If a preferred playlist is supplied, use that exact playlist name.
  - If no preferred playlist is supplied, you may suggest a playlist
    CATEGORY, but clearly describe it as a suggestion.
  - If AI disclosure is set to No, aiDisclosure MUST be an empty string.
  - If AI disclosure is set to Yes, base the disclosure ONLY on the
    supplied AI usage details.
  - Omit unspecified credit lines rather than writing "Not specified".
  - Do NOT put credits, AI disclosure, playlist information or
    description links inside fullDescription.
  - fullDescription should contain only the creative/promotional
    song description.
  - The application will add factual release information separately.
  - Release type may be used in title/description where natural,
    but do not force it unnecessarily.
  
  Treat creator direction as important release-specific guidance,
  while still keeping all metadata truthful and relevant to the song.
  
  Generate:
  
  - 1 recommended title
  - explanation of why it is recommended
  - 4 alternative titles
  - 3 thumbnail text options
  - strong opening description
  - complete YouTube description
  - clean credits block
  - optional AI / synthetic-production disclosure
  - relevant hashtags
  - searchable YouTube tags
  - SEO keyword ideas
  - primary pinned comment
  - alternative pinned comment
  - Community post
  - informal Community post
  - short release announcement
  - playlist suggestion
  - 5 to 10 strongest exact lyric lines
  - natural CTA options
  - Shorts-to-full-song bridge copy
  - clean MP4 filename suggestion
  - practical upload checklist
  
  Do not invent lyric lines.
  Do not invent collaborators.
  Do not use generic filler.
  `.trim();
  
  const response = await openai.responses.create({
    model: "gpt-5.6-luna",
    input: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ],
    text: {
      format: {
        type: "json_object",
      },
    },
  });
  
  const raw = response.output_text?.trim();
  
  if (!raw) {
    throw new Error("No response received from AI.");
  }
  
  let parsed: Partial<YouTubeFullPack>;
  
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI returned invalid JSON.");
  }
  
  const deterministicCredits =
    channelContext.dna?.sections.publishing.fields.credits || buildYouTubeCredits(releaseDetails);
  
  const deterministicAiDisclosure =
    releaseDetails.includeAiDisclosure
      ? releaseDetails.aiDisclosureDetails
      : "";
  
  const creativeDescription = cleanCreativeDescription(
    typeof parsed.fullDescription === "string" ? parsed.fullDescription : "",
    [
      song.title,
      song.english_title || "",
      channelContext.channelName,
      `${channelContext.channelName} Original.`,
      deterministicCredits,
      ...(channelContext.dna?.sections.publishing.fields.credits || "").split("\n"),
    ]
  );
  
  const finalDescription =
    buildFinalYouTubeDescription({
      creativeDescription,
      credits: deterministicCredits,
      aiDisclosure: deterministicAiDisclosure,
      descriptionLinks:
        releaseDetails.descriptionLinks,
      cta: channelContext.dna?.sections.publishing.fields.youtubeFullCta ||
        "❤️ Enjoyed the song? Subscribe for more Suno Zara originals.",
    });
  
  const discovery = normalizeYouTubeDiscovery(parsed, song.title);

  const youtubeFull: YouTubeFullPack = {
    generatorGuidance,
    releaseDetails,
  
    recommendedTitle:
      typeof parsed.recommendedTitle === "string"
        ? parsed.recommendedTitle.trim().slice(0, 100)
        : "",
  
    whyRecommended:
      typeof parsed.whyRecommended === "string"
        ? parsed.whyRecommended.trim()
        : "",
  
    alternativeTitles: cleanStringArray(
      parsed.alternativeTitles,
      4
    ).map((title) => title.slice(0, 100)),
  
    thumbnailTextOptions: cleanStringArray(
      parsed.thumbnailTextOptions,
      3
    ),
  
    openingDescription:
      typeof parsed.openingDescription === "string"
        ? parsed.openingDescription.trim()
        : "",
  
    fullDescription: creativeDescription,
  
    finalDescription,
  
    credits: deterministicCredits,
  
    aiDisclosure: deterministicAiDisclosure,
  
    hashtags: discovery.hashtags,
  
    tags: discovery.tags,
  
    seoKeywords: discovery.seoKeywords,
  
    pinnedComment:
      typeof parsed.pinnedComment === "string"
        ? parsed.pinnedComment.trim()
        : "",
  
    alternativePinnedComment:
      typeof parsed.alternativePinnedComment === "string"
        ? parsed.alternativePinnedComment.trim()
        : "",
  
    communityPost:
      typeof parsed.communityPost === "string"
        ? parsed.communityPost.trim()
        : "",
  
    informalCommunityPost:
      typeof parsed.informalCommunityPost === "string"
        ? parsed.informalCommunityPost.trim()
        : "",
  
    releasePost:
      typeof parsed.releasePost === "string"
        ? parsed.releasePost.trim()
        : "",
  
    playlistSuggestion:
      releaseDetails.preferredPlaylist ||
      (typeof parsed.playlistSuggestion === "string"
        ? parsed.playlistSuggestion.trim()
        : ""),
  
    strongestLyricLines: cleanStringArray(
      parsed.strongestLyricLines,
      10
    ),
  
    ctaOptions: cleanStringArray(
      parsed.ctaOptions,
      6
    ),
  
    shortsBridgeCopy:
      typeof parsed.shortsBridgeCopy === "string"
        ? parsed.shortsBridgeCopy.trim()
        : "",
  
    filenameSuggestion:
      typeof parsed.filenameSuggestion === "string"
        ? parsed.filenameSuggestion.trim()
        : "",
  
    uploadChecklist: cleanStringArray(
      parsed.uploadChecklist,
      20
    ),
  };
  
  if (!youtubeFull.recommendedTitle) {
    throw new Error(
      "AI did not return a recommended title."
    );
  }
  
  if (!youtubeFull.fullDescription) {
    throw new Error(
      "AI did not return a full description."
    );
  }
  
  if (!hasNativeTitleScript(youtubeFull.recommendedTitle, song.language)) {
    throw new Error("AI did not return the song title in the native script.");
  }

  if (wordCount(youtubeFull.fullDescription) < 100) {
    throw new Error("AI returned a description that is too short for YouTube Full.");
  }

  if (youtubeFull.hashtags.length < 5) {
    throw new Error("AI did not return enough song-specific discovery hashtags.");
  }

  if (youtubeFull.tags.length < 15) {
    throw new Error("AI did not return enough useful YouTube search tags.");
  }

  if (youtubeFull.alternativeTitles.length < 3) {
    throw new Error(
      "AI did not return enough alternative titles."
    );
  }

  return {youtubeFull, usage: response.usage, durationMs: Date.now() - started};
}
