import "server-only";

import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";

const ROOT = process.env.SZU_WORKER_ROOT || path.join(os.homedir(), "Suno Zara Universe");
const STATE_DIR = path.join(ROOT, "local-state");
const STATE_FILE = path.join(STATE_DIR, "workspace.json");

type LocalWorkspaceState = { schemaVersion: 1; syncedAt: string | null; workspace: any | null; channels: any[]; songsByChannel: Record<string, any[]>; };
const EMPTY: LocalWorkspaceState = { schemaVersion: 1, syncedAt: null, workspace: null, channels: [], songsByChannel: {} };

function localRuntimeAllowed() { return process.env.VERCEL !== "1" && process.env.SZU_DISABLE_LOCAL_MODE !== "1"; }
export function localModeAvailable() { return localRuntimeAllowed(); }

export async function readLocalWorkspace(): Promise<LocalWorkspaceState> {
  if (!localRuntimeAllowed()) return { ...EMPTY };
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return { ...EMPTY, ...parsed, channels: Array.isArray(parsed?.channels) ? parsed.channels : [], songsByChannel: parsed?.songsByChannel && typeof parsed.songsByChannel === "object" ? parsed.songsByChannel : {} };
  } catch { return { ...EMPTY }; }
}

async function writeState(state: LocalWorkspaceState) {
  if (!localRuntimeAllowed()) return;
  await mkdir(STATE_DIR, { recursive: true });
  const temp = STATE_FILE + ".tmp";
  await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await rename(temp, STATE_FILE);
}

export async function ensureLocalWorkspace() {
  const current = await readLocalWorkspace();
  if (current.workspace) return current;
  const now = new Date().toISOString();
  const next = { ...current, workspace: { id: "local-workspace", name: "Suno Zara Universe · Mac", entitlements: { channel_limit: null }, localOnly: true }, syncedAt: current.syncedAt || now };
  await writeState(next); return next;
}

export async function createLocalChannel(input: { name: string; description?: string; language?: string; channelType?: string; profile?: any }) {
  const current = await ensureLocalWorkspace(); const now = new Date().toISOString(); const id = randomUUID();
  const channel = { id, workspace_id: current.workspace.id, name: input.name, description: input.description || null, language: input.language || null, channel_type: input.channelType || "music", profile: input.profile && typeof input.profile === "object" ? input.profile : {}, is_archived: false, created_at: now, updated_at: now, localOnly: true };
  await writeState({ ...current, channels: [...current.channels, channel] }); return channel;
}

export async function updateLocalChannel(channelId: string, patch: { name?: string; archive?: boolean }) {
  const current = await readLocalWorkspace(); let updated:any=null;
  const channels=current.channels.map((c:any)=>{if(c.id!==channelId)return c;updated={...c,...(patch.name?{name:patch.name}:{}),...(patch.archive?{is_archived:true}:{}),updated_at:new Date().toISOString(),localDirty:true};return updated;});
  if(!updated)return null; await writeState({...current,channels}); return updated;
}

export async function createLocalSong(channelId:string,input:any) {
  const current=await readLocalWorkspace(); if(!current.channels.some((c:any)=>c.id===channelId&&!c.is_archived))return null;
  const now=new Date().toISOString(), id=input.projectId||randomUUID();
  const project={id,projectId:id,title:input.title,englishTitle:input.englishTitle||"",idea:input.idea||"",language:input.language,script:"Native",mood:"",genre:"",freedom:"50",hooks:[],selectedHook:null,lyrics:null,status:"creating",createdAt:now,updatedAt:now,localOnly:true,localDirty:true};
  await writeState({...current,songsByChannel:{...current.songsByChannel,[channelId]:[project,...(current.songsByChannel[channelId]||[])]}}); return project;
}

export async function cacheChannels(workspace:any,channels:any[]){if(!localRuntimeAllowed())return;const current=await readLocalWorkspace();await writeState({...current,schemaVersion:1,syncedAt:new Date().toISOString(),workspace,channels:Array.isArray(channels)?channels:[]});}
export async function cacheSongs(channelId:string,projects:any[]){if(!localRuntimeAllowed()||!channelId)return;const current=await readLocalWorkspace();await writeState({...current,schemaVersion:1,syncedAt:new Date().toISOString(),songsByChannel:{...current.songsByChannel,[channelId]:Array.isArray(projects)?projects:[]}});}
export async function localChannels(){const state=await ensureLocalWorkspace();return{workspace:state.workspace,channels:state.channels.filter((c:any)=>!c.is_archived),localMode:true,syncedAt:state.syncedAt};}
export async function localSongs(channelId:string){const state=await readLocalWorkspace();return{projects:state.songsByChannel[channelId]||[],localMode:true,syncedAt:state.syncedAt};}
export async function localSong(projectId:string){const state=await readLocalWorkspace();for(const [channelId,projects] of Object.entries(state.songsByChannel)){const project=(projects as any[]).find((item:any)=>item?.id===projectId||item?.projectId===projectId);if(project)return{...project,channelId};}return null;}
export async function updateLocalSong(projectId:string,patch:Record<string,unknown>){if(!localRuntimeAllowed())return null;const current=await readLocalWorkspace();let updated:any=null;const songsByChannel:Record<string,any[]>={};for(const [channelId,projects] of Object.entries(current.songsByChannel)){songsByChannel[channelId]=(projects as any[]).map((item:any)=>{if(item?.id!==projectId&&item?.projectId!==projectId)return item;updated={...item,...patch,id:item.id||projectId,projectId,updatedAt:new Date().toISOString(),localDirty:true};return updated;});}if(!updated)return null;await writeState({...current,songsByChannel});return updated;}
export async function replaceLocalWorkspace(input:{workspace:any;channels:any[];songsByChannel:Record<string,any[]>}){if(!localRuntimeAllowed())throw new Error("Local mode is unavailable.");const current=await readLocalWorkspace();if(Object.values(current.songsByChannel).flat().some((p:any)=>p?.localDirty))throw new Error("Local changes exist; cloud sync will not overwrite them.");const channels=Array.isArray(input.channels)?input.channels:[],songsByChannel=input.songsByChannel&&typeof input.songsByChannel==="object"?input.songsByChannel:{};const allowed=new Set(channels.map((c:any)=>String(c?.id||"")).filter(Boolean)),filtered:Record<string,any[]>={};for(const [channelId,projects] of Object.entries(songsByChannel)){if(allowed.has(channelId))filtered[channelId]=Array.isArray(projects)?projects:[];}const next:LocalWorkspaceState={schemaVersion:1,syncedAt:new Date().toISOString(),workspace:input.workspace||null,channels,songsByChannel:filtered};await writeState(next);return next;}
