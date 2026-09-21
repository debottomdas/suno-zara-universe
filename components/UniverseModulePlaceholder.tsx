import Link from "next/link";

type Props = {
  title: string;
  eyebrow: string;
  description: string;
  phases: string[];
  accent: string;
};

export default function UniverseModulePlaceholder({ title, eyebrow, description, phases, accent }: Props) {
  return (
    <div className="min-h-screen bg-[#05070b] px-6 py-8 text-white sm:px-10">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="text-sm font-semibold text-zinc-500 transition hover:text-white">← Suno Zara Universe</Link>
        <section className="mt-10 overflow-hidden rounded-[32px] border border-white/[0.08] bg-[#090d14] p-8 sm:p-12">
          <div className={`inline-flex rounded-full border border-white/10 bg-gradient-to-r ${accent} px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-200`}>{eyebrow}</div>
          <h1 className="mt-6 text-4xl font-black tracking-[-0.045em] sm:text-6xl">{title}</h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">{description}</p>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {phases.map((phase, index) => (
              <div key={phase} className="rounded-2xl border border-white/[0.07] bg-black/20 p-5">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">Stage {String(index + 1).padStart(2, "0")}</p>
                <p className="mt-2 font-semibold text-zinc-200">{phase}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm leading-6 text-zinc-500">
            This module has its own route and architecture now. Its production workflow can be built independently without disturbing the Music Studio.
          </div>
        </section>
      </div>
    </div>
  );
}
