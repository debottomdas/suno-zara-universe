import "server-only";

import { createHash } from "node:crypto";
import { mkdir, open, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ROOT =
  process.env.SZU_WORKER_ROOT ||
  path.join(os.homedir(), "Suno Zara Universe");

const USED_DIR = path.join(
  ROOT,
  "local-state",
  "youtube",
  "oauth-used"
);

export async function consumeLocalOAuthState(
  state: string
): Promise<boolean> {
  if (
    process.env.VERCEL === "1" ||
    !/^[A-Za-z0-9_-]{32,128}$/.test(state)
  ) {
    return false;
  }

  await mkdir(USED_DIR, {
    recursive: true,
    mode: 0o700,
  });

  await chmod(USED_DIR, 0o700);

  const hash = createHash("sha256")
    .update(state)
    .digest("hex");

  const filename = path.join(USED_DIR, hash);

  try {
    const file = await open(filename, "wx", 0o600);

    try {
      await file.writeFile(
        JSON.stringify({
          consumedAt: new Date().toISOString(),
        })
      );
    } finally {
      await file.close();
    }

    return true;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      return false;
    }

    throw error;
  }
}

import { randomBytes } from "node:crypto";
import { readFile, writeFile, unlink, stat } from "node:fs/promises";

const SESSION_DIR = path.join(
  ROOT,
  "local-state",
  "youtube",
  "oauth-sessions"
);

const SESSION_LIFETIME_MS = 10 * 60 * 1000;

type LocalOAuthSession = {
  universeChannelId: string;
  verifier: string;
  createdAt: number;
};

function sessionFile(state: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
    throw new Error("Invalid OAuth state format.");
  }

  const hash = createHash("sha256")
    .update(state)
    .digest("hex");

  return path.join(SESSION_DIR, hash + ".json");
}

export async function createLocalOAuthSession(
  universeChannelId: string,
  verifier: string
): Promise<string> {
  if (process.env.VERCEL === "1") {
    throw new Error("Local OAuth is disabled on Vercel.");
  }

  await mkdir(SESSION_DIR, { recursive: true, mode: 0o700 });
  await chmod(SESSION_DIR, 0o700);

  const state = randomBytes(32).toString("base64url");

  const session: LocalOAuthSession = {
    universeChannelId,
    verifier,
    createdAt: Date.now(),
  };

  await writeFile(
    sessionFile(state),
    JSON.stringify(session),
    { flag: "wx", mode: 0o600 }
  );

  return state;
}

export async function takeLocalOAuthSession(
  state: string
): Promise<LocalOAuthSession | null> {
  if (process.env.VERCEL === "1") return null;

  let filename: string;

  try {
    filename = sessionFile(state);
  } catch {
    return null;
  }

  // Reject missing sessions before attempting an exclusive claim.
  try {
    await stat(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const claimed = filename + ".claimed";

  try {
    const handle = await open(claimed, "wx", 0o600);
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return null;
    }
    throw error;
  }

  try {
    const session = JSON.parse(
      await readFile(filename, "utf8")
    ) as LocalOAuthSession;

    const age = Date.now() - session.createdAt;

    if (
      !session.universeChannelId ||
      !session.verifier ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > SESSION_LIFETIME_MS
    ) {
      return null;
    }

    return session;
  } finally {
    await unlink(filename).catch(() => {});
    // Keep the claim record so this state cannot be replayed.
  }
}
