"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AccountMenu from "@/components/AccountMenu";
import PublicFooter from "@/components/PublicFooter";
import { createClient } from "@/utils/supabase/client";

const modules = [
  {
    name: "Music Studio",
    description: "Write lyrics, shape Suno styles, create artwork, prepare videos, publish releases and measure performance.",
    href: "/music",
    status: "Ready",
    symbol: "♪",
    accent: "from-rose-500/20 via-fuchsia-500/10 to-transparent",
    border: "hover:border-rose-400/35",
  },
  {
    name: "Script Studio",
    description: "Develop film, OTT and short-form stories from idea to synopsis, beat sheet, scenes, dialogue and production draft.",
    href: "/script",
    status: "Foundation",
    symbol: "✦",
    accent: "from-amber-400/20 via-orange-500/10 to-transparent",
    border: "hover:border-amber-300/35",
  },
  {
    name: "Podcast Studio",
    description: "Plan episodes, research topics, write host scripts, create show notes, clips, captions and publishing packages.",
    href: "/podcast",
    status: "Foundation",
    symbol: "◉",
    accent: "from-sky-400/20 via-cyan-500/10 to-transparent",
    border: "hover:border-sky-300/35",
  },
];

const sharedServices = [
  "Creative AI workspace",
  "Artwork & visual generation",
  "Media library",
  "Publishing automation",
  "Cross-platform analytics",
  "Reusable brand & prompt library",
];

export default function UniverseHome() {
  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setAccountEmail(data.user?.email ?? "");
    });
  }, []);

  return (
    <div className="min-h-screen bg-[#05070b] text-white">
      <header className="border-b border-white/[0.07] bg-[#070a10]/90 px-6 py-4 backdrop-blur-xl sm:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-fuchsia-300/20 bg-gradient-to-br from-fuchsia-500/20 to-sky-500/10 text-lg font-black shadow-[0_12px_35px_-20px_rgba(217,70,239,.8)]">
              SZ
            </div>
            <div>
              <p className="text-lg font-bold tracking-[-0.03em]">Suno Zara Universe</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">One creative world</p>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            {!accountEmail && (
              <Link href="/login" className="rounded-xl border border-white/10 px-4 py-2 text-sm font-semibold text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.05] hover:text-white">
                Sign in
              </Link>
            )}
            {accountEmail && <AccountMenu email={accountEmail} />}
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-white/[0.06] px-6 py-20 sm:px-10 lg:py-28">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_22%_20%,rgba(217,70,239,.13),transparent_28rem),radial-gradient(circle_at_82%_8%,rgba(56,189,248,.10),transparent_25rem)]" />
          <div className="relative mx-auto max-w-7xl">
            <div className="max-w-4xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300/15 bg-fuchsia-300/[0.05] px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-fuchsia-200/80">
                Suno Zara Creative Platform
              </div>
              <h1 className="mt-7 text-5xl font-black leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-8xl">
                One universe for every story you want to create.
              </h1>
              <p className="mt-7 max-w-3xl text-lg leading-8 text-zinc-400 sm:text-xl">
                Music is the first complete world. Scripts, podcasts and future creative tools live beside it as separate modules, while sharing media, publishing, analytics and your Suno Zara identity.
              </p>
            </div>

            <div className="mt-12 flex flex-wrap gap-3">
              <Link href="/music" className="rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-black transition hover:bg-zinc-200">
                Open Music Studio →
              </Link>
              <a href="#worlds" className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-3.5 text-sm font-semibold text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white">
                Explore the Universe
              </a>
            </div>
          </div>
        </section>

        <section id="worlds" className="px-6 py-16 sm:px-10 lg:py-20">
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-600">Creative worlds</p>
                <h2 className="mt-3 text-3xl font-bold tracking-[-0.035em] sm:text-4xl">Choose what you want to make.</h2>
              </div>
              <p className="max-w-lg text-sm leading-6 text-zinc-500">Each module is isolated enough to grow properly, but all of them can later use the same asset library, automation engine and analytics layer.</p>
            </div>

            <div className="mt-9 grid gap-5 lg:grid-cols-3">
              {modules.map((module) => (
                <Link key={module.name} href={module.href} className={`group relative min-h-[310px] overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#0a0e15] p-7 transition duration-300 ${module.border} hover:-translate-y-1`}>
                  <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${module.accent}`} />
                  <div className="relative flex h-full flex-col">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-xl">{module.symbol}</div>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">{module.status}</span>
                    </div>
                    <h3 className="mt-8 text-2xl font-bold tracking-[-0.03em]">{module.name}</h3>
                    <p className="mt-3 text-sm leading-6 text-zinc-400">{module.description}</p>
                    <div className="mt-auto pt-8 text-sm font-bold text-zinc-200 transition group-hover:text-white">Enter world <span className="ml-1 transition group-hover:ml-2">→</span></div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-white/[0.06] bg-white/[0.018] px-6 py-16 sm:px-10">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-600">Shared engine</p>
              <h2 className="mt-3 text-3xl font-bold tracking-[-0.035em]">Build once. Reuse across every creative world.</h2>
              <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">Universe is intentionally larger than a song app. Common capabilities become platform services, so a podcast episode or film script can eventually generate artwork, trailers, social copy and analytics through the same engine.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {sharedServices.map((service) => (
                <div key={service} className="rounded-2xl border border-white/[0.07] bg-[#090d13] px-4 py-4 text-sm font-medium text-zinc-300">
                  <span className="mr-2 text-emerald-400">✓</span>{service}
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
