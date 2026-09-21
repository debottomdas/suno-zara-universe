"use client";

import Link from "next/link";

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

type StudioSidebarProps = {
  projectName?: string;
  hasProject: boolean;
  hasLyrics: boolean;
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
};

type NavItem = {
  label: string;
  view: WorkspaceView;
  glyph: string;
  disabled?: boolean;
  badge?: string;
};

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: (view: WorkspaceView) => void;
}) {
  return (
    <button
      type="button"
      disabled={item.disabled}
      onClick={() => onNavigate(item.view)}
      className={
        item.disabled
          ? "flex w-full cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700"
          : active
            ? "group flex w-full items-center gap-3 rounded-xl border border-blue-400/15 bg-gradient-to-r from-blue-600/85 to-indigo-600/55 px-3 py-2.5 text-left text-sm font-semibold text-white shadow-[0_12px_28px_-18px_rgba(59,130,246,.9)]"
            : "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-400 transition duration-200 hover:bg-slate-800/65 hover:text-white"
      }
    >
      <span
        className={
          item.disabled
            ? "flex h-9 w-9 items-center justify-center rounded-lg border border-slate-900 bg-slate-950/30 text-sm text-slate-800"
            : active
              ? "flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-sm text-white"
              : "flex h-9 w-9 items-center justify-center rounded-lg border border-slate-800 bg-[#0d1825] text-sm text-slate-500 transition group-hover:border-slate-700 group-hover:text-sky-300"
        }
      >
        {item.glyph}
      </span>
      <span className="flex-1">{item.label}</span>
      {item.badge && (
        <span className="rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">
          {item.badge}
        </span>
      )}
    </button>
  );
}

export default function StudioSidebar({
  projectName,
  hasProject,
  hasLyrics,
  activeView,
  onNavigate,
}: StudioSidebarProps) {
  const dashboardItems: NavItem[] = [
    { label: "Home", view: "home", glyph: "⌂" },
    { label: "My Songs", view: "library", glyph: "♪" },
    { label: "Start / Import", view: "start", glyph: "+" },
  ];

  const studioItems: NavItem[] = [
    { label: "Song Studio", view: "song", glyph: "✎", disabled: !hasProject },
    { label: "Production", view: "production", glyph: "≈", disabled: !hasLyrics },
    { label: "Visuals", view: "visuals", glyph: "▧", disabled: !hasLyrics },
    { label: "Media", view: "media", glyph: "▶", disabled: !hasProject || !hasLyrics },
    { label: "Social", view: "social", glyph: "⌘", disabled: !hasLyrics },
  ];

  const growthItems: NavItem[] = [
    { label: "Publishing", view: "publish", glyph: "↗", disabled: !hasLyrics, badge: "Next" },
    { label: "Analytics", view: "analytics", glyph: "▥", disabled: !hasLyrics, badge: "Later" },
  ];

  const renderItem = (item: NavItem) => (
    <SidebarLink
      key={item.label}
      item={item}
      active={activeView === item.view}
      onNavigate={onNavigate}
    />
  );

  return (
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-slate-800/80 bg-[#09131f] shadow-[24px_0_80px_-58px_rgba(0,0,0,1)] lg:flex">
      <div className="flex h-[86px] items-center gap-3 border-b border-slate-800/80 px-6">
        <div className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-rose-300/20 bg-[#142235] text-base font-black text-white shadow-[0_10px_30px_-16px_rgba(244,63,94,.6)]">
          <span className="text-rose-300">♪</span>
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#09131f] bg-sky-400" />
        </div>
        <div className="min-w-0">
          <Link href="/" className="block truncate text-[17px] font-bold tracking-[-0.02em] text-white hover:text-fuchsia-200">Suno Zara Universe</Link>
          <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.20em] text-slate-600">Music Studio · Ideas to the world</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mb-5 overflow-hidden rounded-2xl border border-slate-800 bg-[#0d1825] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[9px] font-bold uppercase tracking-[0.20em] text-slate-600">Current project</p>
            <span className={`h-2.5 w-2.5 rounded-full ${hasProject ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.65)]" : "bg-slate-700"}`} />
          </div>
          <p className="mt-2.5 truncate text-sm font-semibold text-slate-100">
            {projectName || (hasProject ? "Song in progress" : "No project open")}
          </p>
          <p className="mt-1.5 text-xs leading-5 text-slate-500">
            {hasLyrics
              ? "Lyrics ready — continue your release workflow."
              : hasProject
                ? "Keep shaping your song."
                : "Create from an idea or import finished lyrics."}
          </p>
        </div>

        <p className="px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-slate-700">Dashboard</p>
        <nav className="mt-2 space-y-1">{dashboardItems.map(renderItem)}</nav>

        <p className="mt-6 px-3 text-[9px] font-bold uppercase tracking-[0.22em] text-slate-700">Song workspace</p>
        <nav className="mt-2 space-y-1">{studioItems.map(renderItem)}</nav>

        <div className="mt-6 border-t border-slate-800 pt-4">
          {growthItems.map(renderItem)}
        </div>
      </div>

      <div className="border-t border-slate-800/80 px-5 py-5">
        <div className="rounded-xl border border-slate-800 bg-[#0d1825] px-3.5 py-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-700">Studio loop</p>
          <p className="mt-1.5 text-[11px] leading-5 text-slate-500">Create → Publish → Measure → Improve</p>
        </div>
      </div>
    </aside>
  );
}
