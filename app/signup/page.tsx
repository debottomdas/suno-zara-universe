"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import PublicFooter from "@/components/PublicFooter";

export default function SignupPage() {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] =
    useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function createAccount(
    event: React.FormEvent
  ) {
    event.preventDefault();

    setError("");
    setMessage("");

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    if (password.length < 8) {
      setError(
        "Please choose a password with at least 8 characters."
      );
      return;
    }

    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    try {
      setLoading(true);

      const { data, error } =
        await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo:
              `${window.location.origin}/auth/callback`,
          },
        });

      if (error) {
        throw error;
      }

      if (data.session) {
        window.location.href = "/";
        return;
      }

      setMessage(
        "Account created. Please check your email to confirm your account, then sign in."
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not create your account."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
    <main className="flex min-h-[calc(100vh-105px)] items-center justify-center bg-black px-6 py-12 text-white">
      <div className="w-full max-w-md">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            Suno Zara Universe
          </h1>

          <p className="mt-3 text-lg text-zinc-400">
            Create your connected creative workspace
          </p>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-7 shadow-2xl">
          <h2 className="text-2xl font-semibold">
            Create Account
          </h2>

          <p className="mt-2 text-sm text-zinc-500">
            Your creative projects will belong to your private Universe account.
          </p>

          <form
            onSubmit={createAccount}
            className="mt-7 space-y-4"
          >
            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="Email address"
              autoComplete="email"
              className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 outline-none transition focus:border-zinc-600"
            />

            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              placeholder="Password"
              autoComplete="new-password"
              className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 outline-none transition focus:border-zinc-600"
            />

            <input
              type="password"
              value={confirmPassword}
              onChange={(event) =>
                setConfirmPassword(event.target.value)
              }
              placeholder="Confirm password"
              autoComplete="new-password"
              className="w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 outline-none transition focus:border-zinc-600"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-white px-5 py-3 font-semibold text-black transition hover:bg-zinc-200 disabled:opacity-50"
            >
              {loading
                ? "Creating account..."
                : "Create Account"}
            </button>
          </form>

          {message && (
            <div className="mt-5 rounded-xl border border-green-900 bg-green-950/30 px-4 py-3 text-sm text-green-300">
              {message}
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-xl border border-red-900 bg-red-950/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="mt-7 border-t border-zinc-800 pt-6 text-center">
            <p className="text-sm text-zinc-500">
              Already have an account?
            </p>

            <Link
              href="/login"
              className="mt-2 inline-block font-semibold text-white hover:text-zinc-300"
            >
              Sign in
            </Link>
          </div>
        </div>

        <p className="mt-8 text-center text-sm text-zinc-600">
          Write. Refine. Remember.
        </p>
      </div>
    </main>
      <PublicFooter />
    </div>
  );
}
