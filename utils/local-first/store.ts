import "server-only";

import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const ROOT = process.env.SZU_WORKER_ROOT || path.join(os.homedir(), "Suno Zara Universe");
const STATE_DIR = path.join(ROOT, "local-state");
const STATE_FILE = path.join(STATE_DIR, "workspace.json");

type LocalWorkspaceState = {
  schemaVersion: 1;
  syncedAt: string | null;
  workspace: any | null;
  channels: any[];
  songsByChannel: Record<string, any[]>;
};

const EMPTY: LocalWorkspaceState = {
  schemaVersion: 1,
  syncedAt: null,
  workspace: null,
  channels: [],
  songsByChannel: {},
};

function localRuntimeAllowed() {
  return process.env.VERCEL !== "1" && process.env.SZU_DISABLE_LOCAL_MODE !== "1";
}

export function localModeAvailable() {
  return localRuntimeAllowed();
}

export async function readLocalWorkspace(): Promise<LocalWorkspaceState> {
  if (!localRuntimeAllowed()) return { ...EMPTY };
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return {
      ...EMPTY,
      ...parsed,
      channels: Array.isArray(parsed?.channels) ? parsed.channels : [],
      songsByChannel: parsed?.songsByChannel && typeof parsed.songsByChannel === "object" ? parsed.songsByChannel : {},
    };
  } catch {
    return { ...EMPTY };
  }
}

async function writeState(state: LocalWorkspaceState) {
  if (!localRuntimeAllowed()) return;
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export async function cacheChannels(workspace: any, channels: any[]) {
  if (!localRuntimeAllowed()) return;
  const current = await readLocalWorkspace();
  await writeState({
    ...current,
    schemaVersion: 1,
    syncedAt: new Date().toISOString(),
    workspace,
    channels: Array.isArray(channels) ? channels : [],
  });
}

export async function cacheSongs(channelId: string, projects: any[]) {
  if (!localRuntimeAllowed() || !channelId) return;
  const current = await readLocalWorkspace();
  await writeState({
    ...current,
    schemaVersion: 1,
    syncedAt: new Date().toISOString(),
    songsByChannel: {
      ...current.songsByChannel,
      [channelId]: Array.isArray(projects) ? projects : [],
    },
  });
}

export async function localChannels() {
  const state = await readLocalWorkspace();
  return { workspace: state.workspace, channels: state.channels, localMode: true, syncedAt: state.syncedAt };
}

export async function localSongs(channelId: string) {
  const state = await readLocalWorkspace();
  return { projects: state.songsByChannel[channelId] || [], localMode: true, syncedAt: state.syncedAt };
}
