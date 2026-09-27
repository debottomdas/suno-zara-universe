#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const CONFIRM_TEXT = "DELETE-TEST-DATA";
const args = new Set(process.argv.slice(2));
const confirmed = args.has("--confirm") && process.argv.includes(CONFIRM_TEXT);
const dryRun = !confirmed;
const root = process.cwd();
const envPath = path.join(root, ".env.local");
const universeRoot = path.join(os.homedir(), "Suno Zara Universe");
const manifestPath = path.join(universeRoot, "worker-manifest.json");
const musicRoot = path.join(universeRoot, "Music");

function log(...parts) { console.log(...parts); }
function warn(...parts) { console.warn(...parts); }
function clean(v) { return typeof v === "string" ? v.trim() : ""; }

async function loadEnv(file) {
  const text = await fs.readFile(file, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function readManifest() {
  try { return JSON.parse(await fs.readFile(manifestPath, "utf8")); }
  catch { return { projects: {} }; }
}

function receiptsFromManifest(manifest) {
  const projects = manifest.projects && typeof manifest.projects === "object" ? manifest.projects : {};
  const projectIds = Object.keys(projects);
  const youtube = [];
  const buffer = [];
  for (const [projectId, project] of Object.entries(projects)) {
    const receipts = project?.publishingReceipts || {};
    for (const item of Object.values(receipts.youtube || {})) {
      if (item?.videoId) youtube.push({ projectId, itemKey: item.itemKey, videoId: String(item.videoId) });
    }
    for (const item of Object.values(receipts.buffer || {})) {
      if (item?.postId) buffer.push({ projectId, itemKey: item.itemKey, postId: String(item.postId), status: String(item.status || "") });
    }
  }
  return { projectIds, youtube, buffer };
}

async function bufferDelete(postId) {
  const key = clean(process.env.BUFFER_API_KEY);
  if (!key) return { ok: false, skipped: true, reason: "BUFFER_API_KEY is missing" };
  const query = `mutation DeletePost($input: DeletePostInput!) {\n  deletePost(input: $input) {\n    ... on DeletePostSuccess { id }\n    ... on MutationError { message }\n  }\n}`;
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables: { input: { id: postId } } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
  if (Array.isArray(payload.errors) && payload.errors.length) return { ok: false, reason: payload.errors[0]?.message || "Buffer GraphQL error" };
  const result = payload?.data?.deletePost;
  if (result?.id) return { ok: true };
  return { ok: false, reason: result?.message || "Buffer did not delete the post" };
}

async function refreshGoogleToken(admin, userId, credential) {
  const clientId = clean(process.env.GOOGLE_YOUTUBE_CLIENT_ID);
  const clientSecret = clean(process.env.GOOGLE_YOUTUBE_CLIENT_SECRET);
  const refreshToken = clean(credential?.refresh_token);
  if (!clientId || !clientSecret || !refreshToken) return clean(credential?.access_token);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) return clean(credential?.access_token);
  if (credential?.connection_id) {
    await admin.from("publishing_oauth_credentials").update({
      access_token: data.access_token,
      expires_at: data.expires_in ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : credential.expires_at,
      updated_at: new Date().toISOString(),
    }).eq("connection_id", credential.connection_id).eq("user_id", userId).eq("platform", "youtube");
  }
  return String(data.access_token);
}

async function deleteYouTubeVideos(admin, userId, videos) {
  if (!videos.length) return { deleted: [], manual: [] };
  const { data: connection } = await admin.from("publishing_connections")
    .select("id,scopes,status")
    .eq("user_id", userId).eq("platform", "youtube")
    .order("is_primary", { ascending: false }).limit(1).maybeSingle();
  if (!connection?.id) return { deleted: [], manual: videos.map(v => ({ ...v, reason: "No YouTube connection found" })) };
  const { data: credential } = await admin.from("publishing_oauth_credentials")
    .select("connection_id,access_token,refresh_token,scope,expires_at")
    .eq("connection_id", connection.id).eq("user_id", userId).eq("platform", "youtube").maybeSingle();
  const scopeText = `${Array.isArray(connection.scopes) ? connection.scopes.join(" ") : ""} ${clean(credential?.scope)}`;
  const canDelete = scopeText.includes("https://www.googleapis.com/auth/youtube.force-ssl") || /(^|\s)https:\/\/www\.googleapis\.com\/auth\/youtube(\s|$)/.test(scopeText);
  if (!canDelete) {
    return { deleted: [], manual: videos.map(v => ({ ...v, reason: "Current OAuth connection has upload-only permission" })) };
  }
  const token = await refreshGoogleToken(admin, userId, credential || {});
  if (!token) return { deleted: [], manual: videos.map(v => ({ ...v, reason: "No usable YouTube access token" })) };
  const deleted = [];
  const manual = [];
  for (const video of videos) {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(video.videoId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 204 || response.status === 404) deleted.push(video);
    else {
      const text = await response.text().catch(() => "");
      manual.push({ ...video, reason: `YouTube HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}` });
    }
  }
  return { deleted, manual };
}

async function listAllFiles(admin, bucket, prefix) {
  const out = [];
  async function walk(folder) {
    let offset = 0;
    while (true) {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`${bucket}: could not list ${folder}: ${error.message}`);
      const items = data || [];
      for (const item of items) {
        const child = folder ? `${folder}/${item.name}` : item.name;
        const isFolder = !item.id && !item.metadata;
        if (isFolder) await walk(child);
        else out.push(child);
      }
      if (items.length < 1000) break;
      offset += items.length;
    }
  }
  await walk(prefix);
  return out;
}

async function removeStoragePrefix(admin, bucket, prefix) {
  const files = await listAllFiles(admin, bucket, prefix);
  if (!files.length) return 0;
  for (let i = 0; i < files.length; i += 100) {
    const chunk = files.slice(i, i + 100);
    const { error } = await admin.storage.from(bucket).remove(chunk);
    if (error) throw new Error(`${bucket}: could not remove ${chunk.length} objects: ${error.message}`);
  }
  return files.length;
}

async function deleteRows(admin, table, column, ids) {
  if (!ids.length) return 0;
  const { data, error } = await admin.from(table).delete().in(column, ids).select(column);
  if (error) throw new Error(`${table}: ${error.message}`);
  return Array.isArray(data) ? data.length : 0;
}

async function main() {
  try { await loadEnv(envPath); }
  catch { throw new Error(`Could not read ${envPath}. Run this from ~/Downloads/sunozara-universe.`); }

  const manifest = await readManifest();
  const { projectIds, youtube, buffer } = receiptsFromManifest(manifest);
  if (!projectIds.length) {
    log("No Universe worker projects found. Nothing to clean.");
    return;
  }

  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const secret = clean(process.env.SUPABASE_SECRET_KEY);
  if (!url || !secret) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY is missing from .env.local.");
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: songs, error: songsError } = await admin.from("songs").select("id,title,user_id").in("id", projectIds);
  if (songsError) throw new Error(`Could not inspect songs: ${songsError.message}`);
  const matched = songs || [];
  const userIds = [...new Set(matched.map(s => s.user_id).filter(Boolean))];
  if (userIds.length > 1) throw new Error("Safety stop: worker manifest contains projects owned by more than one user.");
  const userId = userIds[0] || "";

  log("\nSuno Zara Universe CLEAN SLATE");
  log("--------------------------------");
  log(`Worker projects: ${projectIds.length}`);
  for (const id of projectIds) {
    const song = matched.find(s => s.id === id);
    log(`  - ${song?.title || "(project not found in songs table)"}  ${id}`);
  }
  log(`YouTube test receipts: ${youtube.length}`);
  log(`Buffer test receipts: ${buffer.length}`);
  log("Keeps: publishing connections/OAuth, Buffer API key, app code, environment settings.");
  log("Deletes: matching Universe project rows, project storage, Buffer test posts, local Music folder + worker manifest.");

  if (dryRun) {
    log("\nDRY RUN ONLY — nothing was deleted.");
    log(`To execute: node scripts/clean-test-data.mjs --confirm ${CONFIRM_TEXT}`);
    return;
  }

  log("\n1) Deleting Buffer test posts...");
  let bufferDeleted = 0;
  const bufferFailed = [];
  for (const receipt of buffer) {
    const result = await bufferDelete(receipt.postId);
    if (result.ok) { bufferDeleted += 1; log(`  ✓ ${receipt.postId}`); }
    else { bufferFailed.push({ ...receipt, reason: result.reason || "unknown error" }); warn(`  ! ${receipt.postId}: ${result.reason}`); }
  }

  log("\n2) Deleting YouTube test uploads when OAuth permission allows...");
  const youtubeResult = userId ? await deleteYouTubeVideos(admin, userId, youtube) : { deleted: [], manual: youtube.map(v => ({ ...v, reason: "Could not resolve project owner" })) };
  for (const item of youtubeResult.deleted) log(`  ✓ ${item.videoId}`);
  for (const item of youtubeResult.manual) warn(`  ! manual delete needed: https://www.youtube.com/watch?v=${item.videoId} (${item.reason})`);

  log("\n3) Removing Supabase project storage...");
  let storageCount = 0;
  if (userId) {
    for (const projectId of projectIds) {
      for (const bucket of ["song-media", "song-images"]) {
        try {
          const count = await removeStoragePrefix(admin, bucket, `${userId}/${projectId}`);
          storageCount += count;
          if (count) log(`  ✓ ${bucket}: ${count} object(s) for ${projectId}`);
        } catch (error) {
          warn(`  ! ${error instanceof Error ? error.message : error}`);
        }
      }
    }
  }

  log("\n4) Removing Supabase project rows...");
  const deletions = [
    ["publishing_jobs", "song_id"],
    ["publishing_campaigns", "song_id"],
    ["social_media_packs", "song_id"],
    ["song_images", "song_id"],
    ["song_image_sets", "song_id"],
    ["song_visual_concepts", "song_id"],
    ["suno_styles", "song_id"],
    ["song_versions", "song_id"],
    ["song_media_assets", "song_id"],
  ];
  for (const [table, column] of deletions) {
    try {
      const count = await deleteRows(admin, table, column, projectIds);
      if (count) log(`  ✓ ${table}: ${count}`);
    } catch (error) {
      // Some older installs may not have every optional table/column. Report and continue.
      warn(`  ! ${error instanceof Error ? error.message : error}`);
    }
  }
  try {
    const count = await deleteRows(admin, "songs", "id", projectIds);
    log(`  ✓ songs: ${count}`);
  } catch (error) {
    throw new Error(`Could not delete songs: ${error instanceof Error ? error.message : error}`);
  }

  log("\n5) Removing local Universe test media...");
  await fs.rm(musicRoot, { recursive: true, force: true });
  await fs.mkdir(musicRoot, { recursive: true });
  for (const projectId of projectIds) {
    await fs.rm(path.join(root, "local-media", "songs", projectId), { recursive: true, force: true });
  }
  await fs.mkdir(universeRoot, { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({ projects: {} }, null, 2));
  log("  ✓ local Music folder reset");
  log("  ✓ worker-manifest.json reset");

  log("\nCLEAN SLATE COMPLETE");
  log(`Supabase storage objects removed: ${storageCount}`);
  log(`Buffer posts deleted: ${bufferDeleted}/${buffer.length}`);
  log(`YouTube videos deleted automatically: ${youtubeResult.deleted.length}/${youtube.length}`);
  if (bufferFailed.length) {
    warn("\nBuffer items that could not be deleted (often already-sent posts):");
    for (const item of bufferFailed) warn(`  ${item.postId} — ${item.reason}`);
  }
  if (youtubeResult.manual.length) {
    warn("\nYouTube uploads still needing manual deletion in YouTube Studio:");
    for (const item of youtubeResult.manual) warn(`  https://www.youtube.com/watch?v=${item.videoId}`);
    warn("Current Universe YouTube OAuth normally requests upload-only permission, which Google does not allow to delete videos.");
  }
  log("\nRestart npm run dev + npm run universe-worker, refresh /music, and you should have a clean project list.");
}

main().catch((error) => {
  console.error("\nCleanup stopped:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
