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
  const existing = current.songsByChannel[channelId] || [];
  const incoming = Array.isArray(projects) ? projects : [];

  // Preserve local edits when refreshing from Supabase.
  const dirty = new Map(
    existing
      .filter((song: any) => song?.localDirty === true)
      .map((song: any) => [String(song.id || song.projectId), song])
  );

  const merged = incoming.map((song: any) => {
    const id = String(song.id || song.projectId);
    return dirty.get(id) || song;
  });

  const incomingIds = new Set(
    incoming.map((song: any) => String(song.id || song.projectId))
  );

  for (const [id, song] of dirty) {
    if (!incomingIds.has(id)) merged.push(song);
  }

  await writeState({
    ...current,
    schemaVersion: 1,
    syncedAt: new Date().toISOString(),
    songsByChannel: {
      ...current.songsByChannel,
      [channelId]: merged,
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

export async function localSong(projectId: string) {
  const state = await readLocalWorkspace();
  for (const [channelId, projects] of Object.entries(state.songsByChannel)) {
    const project = projects.find((item: any) => item?.id === projectId || item?.projectId === projectId);
    if (project) return { ...project, channelId };
  }
  return null;
}

export async function updateLocalSong(projectId: string, patch: Record<string, unknown>) {
  if (!localRuntimeAllowed()) return null;
  const current = await readLocalWorkspace();
  let updated: any = null;
  const songsByChannel: Record<string, any[]> = {};
  for (const [channelId, projects] of Object.entries(current.songsByChannel)) {
    songsByChannel[channelId] = projects.map((item: any) => {
      if (item?.id !== projectId && item?.projectId !== projectId) return item;
      updated = { ...item, ...patch, id: item.id || projectId, projectId, updatedAt: new Date().toISOString(), localDirty: true };
      return updated;
    });
  }
  if (!updated) return null;
  await writeState({ ...current, songsByChannel });
  return updated;
}


export async function replaceLocalWorkspace(input: { workspace: any; channels: any[]; songsByChannel: Record<string, any[]> }) {
  if (!localRuntimeAllowed()) throw new Error("Local mode is unavailable.");
  const channels = Array.isArray(input.channels) ? input.channels : [];
  const songsByChannel = input.songsByChannel && typeof input.songsByChannel === "object" ? input.songsByChannel : {};
  const allowed = new Set(channels.map((channel: any) => String(channel?.id || "")).filter(Boolean));
  const filtered: Record<string, any[]> = {};
  for (const [channelId, projects] of Object.entries(songsByChannel)) {
    if (allowed.has(channelId)) filtered[channelId] = Array.isArray(projects) ? projects : [];
  }
  // Preserve unsynchronised local edits during cloud bootstrap.
  const current = await readLocalWorkspace();

  for (const [channelId, existingSongs] of Object.entries(current.songsByChannel)) {
    const dirtySongs = existingSongs.filter((song: any) => song?.localDirty === true);
    if (!dirtySongs.length) continue;

    // Never silently discard a channel containing local edits.
    if (!filtered[channelId]) {
      filtered[channelId] = [];
      const existingChannel = current.channels.find((c: any) => c.id === channelId);
      if (existingChannel && !channels.some((c: any) => c.id === channelId)) {
        channels.push(existingChannel);
      }
    }

    const merged = [...filtered[channelId]];

    for (const dirtySong of dirtySongs) {
      const id = String(dirtySong.id || dirtySong.projectId);
      const index = merged.findIndex(
        (song: any) => String(song.id || song.projectId) === id
      );

      if (index >= 0) merged[index] = dirtySong;
      else merged.push(dirtySong);
    }

    filtered[channelId] = merged;
  }

  const next: LocalWorkspaceState = {
    schemaVersion: 1,
    syncedAt: new Date().toISOString(),
    workspace: input.workspace || null,
    channels,
    songsByChannel: filtered,
  };
  await writeState(next);
  return next;
}

/** Create an offline project only inside an existing locally owned channel. */
export async function createLocalSong(input: {
  projectId: string; channelId: string; title: string; language: string; idea: string; englishTitle?: string;
}) {
  if (!localRuntimeAllowed()) return null;
  const state = await readLocalWorkspace();
  if (!state.channels.some((channel: any) => channel?.id === input.channelId)) return null;
  const projects = state.songsByChannel[input.channelId] || [];
  const existing = projects.find((song: any) => song?.id === input.projectId || song?.projectId === input.projectId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const project = {
    id: input.projectId, projectId: input.projectId, title: input.title,
    englishTitle: input.englishTitle || "", language: input.language, idea: input.idea,
    script: "Native", mood: "", genre: "", freedom: "50",
    hooks: [], selectedHook: null, lyrics: null, status: "creating",
    projectState: "current", createdAt: now, updatedAt: now, localDirty: true,
  };
  await writeState({
    ...state,
    songsByChannel: { ...state.songsByChannel, [input.channelId]: [project, ...projects] },
  });
  return project;
}
