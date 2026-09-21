import UniverseModulePlaceholder from "@/components/UniverseModulePlaceholder";

export default function PodcastStudioPage() {
  return (
    <UniverseModulePlaceholder
      title="Podcast Studio"
      eyebrow="Suno Zara Universe · Voice"
      description="A future production system for planning, scripting, packaging and publishing podcast episodes while reusing the Universe media, social and analytics engines."
      accent="from-sky-400/20 to-cyan-500/10"
      phases={[
        "Series concept, audience and episode planning",
        "Research workspace and source notes",
        "Host script, questions, segments and transitions",
        "Audio preparation, chapters and show notes",
        "Artwork, audiograms, clips and social captions",
        "Publishing, scheduling and performance analytics",
      ]}
    />
  );
}
