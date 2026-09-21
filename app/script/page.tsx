import UniverseModulePlaceholder from "@/components/UniverseModulePlaceholder";

export default function ScriptStudioPage() {
  return (
    <UniverseModulePlaceholder
      title="Script Studio"
      eyebrow="Suno Zara Universe · Stories"
      description="A future end-to-end workspace for short films, OTT concepts, feature scripts and episodic storytelling — from the first idea through a production-ready screenplay package."
      accent="from-amber-400/20 to-orange-500/10"
      phases={[
        "Idea, theme, genre and character generation",
        "Logline, synopsis and story-world development",
        "Beat sheet, acts, sequences and scene planning",
        "Screenplay drafting with dialogue and rewrites",
        "Character arcs, continuity and script critique",
        "Pitch deck, poster concepts, trailer copy and release assets",
      ]}
    />
  );
}
