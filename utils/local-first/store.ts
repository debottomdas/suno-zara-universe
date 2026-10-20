import "server-only";

import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";

const ROOT = process.env.SZU_WORKER_ROOT || path.join(os.homedir(), "Suno Zara Universe");
const STATE_DIR = path.join(ROOT, "local-state");
const STATE_FILE = path.join(STATE_DIR, "workspace.json");

export type LocalWorkspaceState = {
  tables?: Record<string, any[]>;
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
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.channels) || !parsed.songsByChannel || typeof parsed.songsByChannel !== 'object' || Array.isArray(parsed.songsByChannel) || Object.values(parsed.songsByChannel).some(projects=>!Array.isArray(projects))) throw new Error('Invalid local workspace schema.');
    return {
      ...EMPTY,
      ...parsed,
      channels: Array.isArray(parsed?.channels) ? parsed.channels : [],
      songsByChannel: parsed?.songsByChannel && typeof parsed.songsByChannel === "object" ? parsed.songsByChannel : {},
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return structuredClone(EMPTY);
    throw new Error("Local workspace could not be read; existing data was left untouched.", { cause: error });
  }
}

async function writeState(state: LocalWorkspaceState) {
  if (!localRuntimeAllowed()) return;
  await mkdir(STATE_DIR, { recursive: true });
  const temporary = `${STATE_FILE}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, STATE_FILE);
  } finally { await rm(temporary, { force: true }); }
}

export async function cacheChannels(workspace: any, channels: any[]) {
  if (!localRuntimeAllowed()) return;
  return mutateLocalWorkspace(async current => {
  Object.assign(current, {
    ...current,
    schemaVersion: 1,
    syncedAt: new Date().toISOString(),
    workspace,
    channels: [...(Array.isArray(channels) ? channels : []), ...current.channels.filter(c => !channels.some(n => n.id === c.id))],
  });  });
}

export async function cacheSongs(channelId: string, projects: any[]) {
  if (!localRuntimeAllowed() || !channelId) return;
  return mutateLocalWorkspace(async current => {
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

  for (const song of existing) {
    if (!incomingIds.has(String(song.id || song.projectId))) merged.push(song);
  }

  Object.assign(current, {
    ...current,
    schemaVersion: 1,
    syncedAt: new Date().toISOString(),
    songsByChannel: {
      ...current.songsByChannel,
      [channelId]: merged,
    },
  });  });
}

export async function localChannels() {
  const state = await readLocalWorkspace();
  return { workspace: state.workspace, channels: state.channels.filter(c => !c.is_archived), localMode: true, syncedAt: state.syncedAt };
}

export async function localSongs(channelId: string) {
  const state = await readLocalWorkspace();
  return { projects: (state.songsByChannel[channelId] || []).filter((song: any) => !song.localArchived), localMode: true, syncedAt: state.syncedAt };
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
  return mutateLocalWorkspace(current => {
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
  current.songsByChannel = songsByChannel;
  return updated;
  });
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
  return mutateLocalWorkspace(async current => {

  for (const [channelId, existingSongs] of Object.entries(current.songsByChannel)) {
    const dirtySongs = existingSongs;
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

      if (index >= 0 && dirtySong.localDirty) merged[index] = dirtySong;
      else if (index < 0) merged.push(dirtySong);
    }

    filtered[channelId] = merged;
  }

  for (const channel of current.channels) if (!channels.some(c => c.id === channel.id)) channels.push(channel);
  const next: LocalWorkspaceState = {
    ...current,
    schemaVersion: 1,
    syncedAt: new Date().toISOString(),
    workspace: input.workspace || current.workspace,
    channels,
    songsByChannel: filtered,
  };
  Object.assign(current, next);
  return next;  });
}

/** Create an offline project only inside an existing locally owned channel. */
export async function createLocalSong(input: {
  projectId: string; channelId: string; title: string; language: string; idea: string; englishTitle?: string;
}) {
  if (!localRuntimeAllowed()) return null;
  return mutateLocalWorkspace(async state => {
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
  Object.assign(state, {
    ...state,
    songsByChannel: { ...state.songsByChannel, [input.channelId]: [project, ...projects] },
  });
  return project;  });
}

/** Hide a local project without deleting its media, receipts or history. */
export async function archiveLocalSong(projectId: string, channelId: string, confirmation: string) {
  if (!localRuntimeAllowed()) return null;
  return mutateLocalWorkspace(async state => {
  if (!state.channels.some((channel: any) => channel?.id === channelId)) return null;
  const projects = state.songsByChannel[channelId] || [];
  const song = projects.find((item: any) => (item.id === projectId || item.projectId === projectId) && !item.localArchived);
  if (!song || song.title !== confirmation) return null;
  const archived = { ...song, localArchived: true, localDirty: true, archivedAt: new Date().toISOString() };
  Object.assign(state, { ...state, songsByChannel: {
    ...state.songsByChannel,
    [channelId]: projects.map((item: any) => item === song ? archived : item),
  } });
  return archived;  });
}

/** Serialize changes across web workers; a busy/stale lock fails closed. */
export async function mutateLocalWorkspace<T>(change: (state: LocalWorkspaceState) => T | Promise<T>): Promise<T> {
  if (!localRuntimeAllowed()) throw new Error("Local mode is unavailable.");
  await mkdir(STATE_DIR, { recursive: true });
  const lock = path.join(STATE_DIR, "workspace.lock");
  let locked = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await mkdir(lock); locked = true; break; }
    catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  if (!locked) throw new Error("Local workspace is busy. Retry after the current save finishes.");
  try {
    const state = await readLocalWorkspace();
    const result = await change(state);
    await writeState(state);
    return result;
  } finally { await rm(lock, { recursive: true, force: true }); }
}
