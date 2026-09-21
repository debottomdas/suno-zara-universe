import Link from "next/link";

export default function PublicFooter() {
  return (
    <footer className="border-t border-white/[0.08] px-6 py-8 text-center">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-zinc-500">
        <Link
          href="/privacy"
          className="transition hover:text-white"
        >
          Privacy Policy
        </Link>

        <span className="text-zinc-700">•</span>

        <Link
          href="/terms"
          className="transition hover:text-white"
        >
          Terms of Service
        </Link>
      </div>

      <p className="mt-4 text-xs text-zinc-600">
        © 2026 Suno Zara Universe. All rights reserved.
      </p>
    </footer>
  );
}
