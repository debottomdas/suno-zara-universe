"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "@/app/studio/actions";

type AccountMenuProps = {
  email: string;
};

export default function AccountMenu({
  email,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);

  const initial =
    email.trim().charAt(0).toUpperCase() || "U";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Account menu"
        className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-sm font-bold transition hover:border-zinc-500 hover:bg-zinc-800"
      >
        {initial}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-3 w-72 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          <div className="border-b border-zinc-800 px-5 py-4">
            <p className="text-xs uppercase tracking-wider text-zinc-600">
              Signed in as
            </p>

            <p className="mt-1 truncate text-sm text-zinc-200">
              {email}
            </p>
          </div>

          <div className="p-2">
            <Link
              href="/music"
              onClick={() => setOpen(false)}
              className="block rounded-xl px-4 py-3 text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-white"
            >
              Music Studio
            </Link>

            <div className="rounded-xl px-4 py-3 text-sm text-zinc-600">
              My Songs
              <span className="ml-2 text-xs">
                Coming next
              </span>
            </div>

            <div className="rounded-xl px-4 py-3 text-sm text-zinc-600">
              Account
              <span className="ml-2 text-xs">
                Coming soon
              </span>
            </div>

            <form action={signOut}>
              <button
                type="submit"
                className="w-full rounded-xl px-4 py-3 text-left text-sm text-red-400 transition hover:bg-zinc-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
