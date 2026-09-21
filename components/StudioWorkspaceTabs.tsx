"use client";

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

type Props = {
  activeView: WorkspaceView;
  hasLyrics: boolean;
  onNavigate: (view: WorkspaceView) => void;
};

const tabs = [
  { label: "Song Studio", view: "song" as const, glyph: "✎" },
  { label: "Production", view: "production" as const, glyph: "≈", needsLyrics: true },
  { label: "Visuals", view: "visuals" as const, glyph: "▧", needsLyrics: true },
  { label: "Media", view: "media" as const, glyph: "▶", needsLyrics: true },
  { label: "Social", view: "social" as const, glyph: "⌘", needsLyrics: true },
  { label: "Publish", view: "publish" as const, glyph: "↗", needsLyrics: true },
  { label: "Analytics", view: "analytics" as const, glyph: "▥", needsLyrics: true },
];

export default function StudioWorkspaceTabs({ activeView, hasLyrics, onNavigate }: Props) {
  return (
    <div className="border-b border-slate-800/80 bg-[#08111d]/92 backdrop-blur-xl">
      <div className="mx-auto max-w-[2200px] overflow-x-auto px-4 sm:px-6 lg:px-10">
        <div className="flex min-w-max gap-1 py-2.5">
          {tabs.map((tab) => {
            const disabled = Boolean(tab.needsLyrics && !hasLyrics);
            const active = activeView === tab.view;

            return (
              <button
                key={tab.view}
                type="button"
                disabled={disabled}
                onClick={() => onNavigate(tab.view)}
                className={
                  disabled
                    ? "flex cursor-not-allowed items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-700"
                    : active
                      ? "flex items-center gap-2 rounded-xl border border-blue-400/20 bg-blue-500/12 px-3.5 py-2 text-xs font-bold text-blue-200"
                      : "flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-400 transition hover:bg-slate-800/65 hover:text-white"
                }
              >
                <span>{tab.glyph}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
