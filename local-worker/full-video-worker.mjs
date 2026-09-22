import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, rm, stat, unlink, rename } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import ffmpegPath from "ffmpeg-static";

const HOST = "127.0.0.1";
const PORT = 47123;
const ROOT = path.join(os.homedir(), "Suno Zara Universe");
const MANIFEST_PATH = path.join(ROOT, "worker-manifest.json");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}
function json(res, status, body) {
  cors(res);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function safeName(value, fallback = "song") {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}
function safeFilename(value, fallback = "media") {
  const ext = path.extname(String(value || ""));
  const base = path.basename(String(value || ""), ext);
  return `${safeName(base, fallback)}${ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 12)}`;
}
async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 3_000_000) throw new Error("Request is too large.");
  }
  return raw ? JSON.parse(raw) : {};
}
async function loadManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch {
    return { projects: {} };
  }
}
async function saveManifest(manifest) {
  await mkdir(ROOT, { recursive: true });
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}
function extensionFor(contentType, fallback = ".bin") {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  if (type.includes("wav")) return ".wav";
  if (type.includes("mpeg")) return ".mp3";
  if (type.startsWith("video/") && type.includes("mp4")) return ".mp4";
  if (type.includes("quicktime")) return ".mov";
  if (type.startsWith("audio/") && type.includes("mp4")) return ".m4a";
  if (type.includes("aac")) return ".aac";
  return fallback;
}
async function download(url, basename, dir) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Could not fetch media (${response.status}) from ${url}`);
  const ext = extensionFor(response.headers.get("content-type"));
  const file = path.join(dir, `${basename}${ext}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  return file;
}
function ffconcatEscape(file) {
  return file.replace(/'/g, "'\\''");
}
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 30000) stderr = stderr.slice(-30000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`FFmpeg failed (${code}). ${stderr.slice(-6000)}`))
    );
  });
}

function normalizeVisuals(body) {
  const supplied = Array.isArray(body.visuals)
    ? body.visuals
        .map((item, index) => ({
          url: String(item?.url || "").trim(),
          format: String(item?.format || "landscape").toLowerCase() === "vertical" ? "vertical" : "landscape",
          mediaType: String(item?.mediaType || item?.type || "image").toLowerCase() === "video" ? "video" : "image",
          imageNumber: Number(item?.imageNumber) || index + 1,
          label: String(item?.label || "").trim(),
        }))
        .filter((item) => item.url)
    : [];

  if (!supplied.length && Array.isArray(body.imageUrls)) {
    return body.imageUrls
      .map((url, index) => ({ url: String(url || "").trim(), format: "landscape", mediaType: "image", imageNumber: index + 1, label: "" }))
      .filter((item) => item.url);
  }

  const seen = new Set();
  return supplied.filter((item) => {
    const key = `${item.mediaType}:${item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
}

function landscapeImageFilter(sceneDuration, motionIndex) {
  const d = Math.max(1, sceneDuration).toFixed(4);
  const motions = [
    `x='(iw-ow)*t/${d}':y='(ih-oh)/2'`,
    `x='(iw-ow)*(1-t/${d})':y='(ih-oh)/2'`,
    `x='(iw-ow)/2':y='(ih-oh)*t/${d}'`,
    `x='(iw-ow)/2':y='(ih-oh)*(1-t/${d})'`,
  ];
  const fade = Math.min(0.45, Math.max(0.22, sceneDuration * 0.035));
  const fadeOutStart = Math.max(0, sceneDuration - fade);
  return `scale=2304:1296:force_original_aspect_ratio=increase,` +
    `crop=2304:1296,` +
    `crop=1920:1080:${motions[motionIndex % motions.length]},` +
    `setsar=1,fps=30,format=yuv420p,` +
    `fade=t=in:st=0:d=${fade.toFixed(3)},` +
    `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)}`;
}

function verticalImageFilter(sceneDuration) {
  const fade = Math.min(0.45, Math.max(0.22, sceneDuration * 0.035));
  const fadeOutStart = Math.max(0, sceneDuration - fade);
  return `[0:v]split=2[bg][fg];` +
    `[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=24:2[bgx];` +
    `[fg]scale=900:1080:force_original_aspect_ratio=decrease[fgx];` +
    `[bgx][fgx]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p,` +
    `fade=t=in:st=0:d=${fade.toFixed(3)},` +
    `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)}[v]`;
}

function landscapeVideoFilter(sceneDuration) {
  const fade = Math.min(0.45, Math.max(0.22, sceneDuration * 0.035));
  const fadeOutStart = Math.max(0, sceneDuration - fade);
  return `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,` +
    `setsar=1,fps=30,format=yuv420p,fade=t=in:st=0:d=${fade.toFixed(3)},` +
    `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)}`;
}

function verticalVideoFilter(sceneDuration) {
  const fade = Math.min(0.45, Math.max(0.22, sceneDuration * 0.035));
  const fadeOutStart = Math.max(0, sceneDuration - fade);
  return `[0:v]split=2[bg][fg];` +
    `[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=24:2[bgx];` +
    `[fg]scale=900:1080:force_original_aspect_ratio=decrease[fgx];` +
    `[bgx][fgx]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p,` +
    `fade=t=in:st=0:d=${fade.toFixed(3)},` +
    `fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)}[v]`;
}

async function renderScene(scene, index, sceneDuration, tempDir) {
  const output = path.join(tempDir, `scene-${String(index + 1).padStart(2, "0")}.mp4`);

  if (scene.mediaType === "video") {
    const base = ["-y", "-stream_loop", "-1", "-i", scene.file, "-t", sceneDuration.toFixed(4)];
    if (scene.format === "vertical") {
      await run(ffmpegPath, [
        ...base,
        "-filter_complex", verticalVideoFilter(sceneDuration),
        "-map", "[v]",
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "21",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-t", sceneDuration.toFixed(4),
        output,
      ]);
    } else {
      await run(ffmpegPath, [
        ...base,
        "-vf", landscapeVideoFilter(sceneDuration),
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "21",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        "-t", sceneDuration.toFixed(4),
        output,
      ]);
    }
    return output;
  }

  const base = ["-y", "-loop", "1", "-framerate", "30", "-t", sceneDuration.toFixed(4), "-i", scene.file];
  if (scene.format === "vertical") {
    await run(ffmpegPath, [
      ...base,
      "-filter_complex", verticalImageFilter(sceneDuration),
      "-map", "[v]",
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "21",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-t", sceneDuration.toFixed(4),
      output,
    ]);
  } else {
    await run(ffmpegPath, [
      ...base,
      "-vf", landscapeImageFilter(sceneDuration, index),
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "21",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-t", sceneDuration.toFixed(4),
      output,
    ]);
  }
  return output;
}

async function renderFullVideo(body) {
  if (!ffmpegPath) throw new Error("FFmpeg is unavailable. Run npm install ffmpeg-static first.");

  const projectId = String(body.projectId || "").trim();
  const title = String(body.title || "Suno Zara Song").trim();
  const audioUrl = String(body.audioUrl || "").trim();
  const durationSeconds = Number(body.durationSeconds);
  const visuals = normalizeVisuals(body);

  if (!projectId || !audioUrl || !Number.isFinite(durationSeconds) || durationSeconds < 5 || !visuals.length) {
    throw new Error("projectId, audioUrl, durationSeconds and at least one visual are required.");
  }

  const jobId = randomUUID();
  const tempDir = path.join(os.tmpdir(), "szu-video-worker", jobId);
  await mkdir(tempDir, { recursive: true });

  try {
    const audioFile = await download(audioUrl, "audio", tempDir);
    const downloadedVisuals = [];
    for (let i = 0; i < visuals.length; i += 1) {
      downloadedVisuals.push({
        ...visuals[i],
        file: await download(visuals[i].url, `visual-${i + 1}`, tempDir),
      });
    }

    // Real clips and stills are mixed together. Every supplied asset is used before
    // any repeats, then the sequence cycles to cover the full song.
    const targetSceneSeconds = downloadedVisuals.some((item) => item.mediaType === "video") ? 9 : 12;
    const sceneCount = Math.max(downloadedVisuals.length, Math.min(28, Math.ceil(durationSeconds / targetSceneSeconds)));
    const sceneDuration = durationSeconds / sceneCount;
    const sequence = Array.from({ length: sceneCount }, (_, index) => downloadedVisuals[index % downloadedVisuals.length]);

    console.log(`[${title}] Rendering ${sceneCount} scenes from ${downloadedVisuals.length} distinct visual assets.`);

    const sceneFiles = [];
    for (let index = 0; index < sequence.length; index += 1) {
      console.log(`[${title}] Scene ${index + 1}/${sequence.length} (${sequence[index].mediaType})`);
      sceneFiles.push(await renderScene(sequence[index], index, sceneDuration, tempDir));
    }

    const concatFile = path.join(tempDir, "scenes.ffconcat");
    await writeFile(concatFile, ["ffconcat version 1.0", ...sceneFiles.map((file) => `file '${ffconcatEscape(file)}'`)].join("\n") + "\n");

    const silentVideo = path.join(tempDir, "silent-video.mp4");
    await run(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", silentVideo]);

    const songFolder = path.join(ROOT, "Music", safeName(title), "Videos");
    await mkdir(songFolder, { recursive: true });
    const filename = `${safeName(title)}-Full-Video.mp4`;
    const output = path.join(songFolder, filename);

    await run(ffmpegPath, [
      "-y", "-i", silentVideo, "-i", audioFile,
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
      "-t", String(durationSeconds), "-shortest", "-movflags", "+faststart", output,
    ]);

    const generatedFullVideo = {
      projectId,
      title,
      filename,
      filePath: output,
      source: "generated",
      generatedAt: new Date().toISOString(),
      durationSeconds,
      imageCount: downloadedVisuals.filter((item) => item.mediaType === "image").length,
      sourceVisualCount: downloadedVisuals.length,
      sourceClipCount: downloadedVisuals.filter((item) => item.mediaType === "video").length,
      sceneCount,
    };
    const manifest = await loadManifest();
    manifest.projects ||= {};
    const existing = manifest.projects[projectId] || {};
    manifest.projects[projectId] = {
      ...existing,
      ...generatedFullVideo,
      generatedFullVideo,
      projectId,
      title,
    };
    await saveManifest(manifest);
    return generatedFullVideo;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function legacyGeneratedItem(project) {
  if (!project) return null;
  if (project.generatedFullVideo?.filePath) return project.generatedFullVideo;
  if (project.filePath) {
    return {
      projectId: project.projectId,
      title: project.title,
      filename: project.filename,
      filePath: project.filePath,
      source: "generated",
      generatedAt: project.generatedAt,
      durationSeconds: project.durationSeconds,
      imageCount: project.imageCount,
      sourceVisualCount: project.sourceVisualCount,
      sourceClipCount: project.sourceClipCount,
      sceneCount: project.sceneCount,
    };
  }
  return null;
}

async function publicFullVideo(projectId, item, source) {
  if (!item?.filePath) return null;
  try { await stat(item.filePath); } catch { return null; }
  return {
    ...item,
    source,
    fileUrl: `http://${HOST}:${PORT}/full-video/file?projectId=${encodeURIComponent(projectId)}&source=${encodeURIComponent(source)}`,
    downloadUrl: `http://${HOST}:${PORT}/full-video/file?projectId=${encodeURIComponent(projectId)}&source=${encodeURIComponent(source)}&download=1`,
  };
}

async function fullVideoStatus(projectId) {
  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId];
  const generated = await publicFullVideo(projectId, legacyGeneratedItem(project), "generated");
  const uploaded = await publicFullVideo(projectId, project?.uploadedFullVideo, "uploaded");
  const approvedSource = project?.approvedFullVideoSource === "uploaded" ? "uploaded" : project?.approvedFullVideoSource === "generated" ? "generated" : null;
  const approved = approvedSource === "uploaded" ? uploaded : approvedSource === "generated" ? generated : null;
  return { generatedVideo: generated, uploadedVideo: uploaded, approvedVideo: approved, approvedSource };
}

async function videoResponse(projectId) {
  return (await fullVideoStatus(projectId)).generatedVideo;
}

async function resolveFullVideoItem(projectId, source) {
  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId];
  if (!project) return null;
  if (source === "uploaded") return project.uploadedFullVideo || null;
  return legacyGeneratedItem(project);
}

async function serveFullVideoFile(req, res, projectId, source, downloadFile) {
  const item = await resolveFullVideoItem(projectId, source);
  if (!item?.filePath) return json(res, 404, { error: "Video not found." });
  let info;
  try { info = await stat(item.filePath); } catch { return json(res, 404, { error: "Video file is missing." }); }
  cors(res);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "video/mp4");
  if (downloadFile) res.setHeader("Content-Disposition", `attachment; filename="${item.filename}"`);
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : info.size - 1;
    if (start >= info.size || end >= info.size || start > end) { res.statusCode = 416; return res.end(); }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    createReadStream(item.filePath, { start, end }).pipe(res);
  } else {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(info.size));
    createReadStream(item.filePath).pipe(res);
  }
}

async function serveFile(req, res, projectId, downloadFile) {
  return serveFullVideoFile(req, res, projectId, "generated", downloadFile);
}

async function saveUploadedFullVideo(req, url) {
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  const title = String(url.searchParams.get("title") || "Untitled Song").trim();
  const filename = String(url.searchParams.get("filename") || "full-video.mp4").trim();
  const mimeType = String(url.searchParams.get("mimeType") || "video/mp4").trim();
  const sizeBytes = Number(url.searchParams.get("sizeBytes") || "0");
  const durationSeconds = Number(url.searchParams.get("durationSeconds") || "0");
  const width = Number(url.searchParams.get("width") || "0");
  const height = Number(url.searchParams.get("height") || "0");
  if (!projectId || !filename || !Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("Invalid full video upload details.");
  if (!new Set(["video/mp4", "video/quicktime"]).has(mimeType)) throw new Error("Full video must be MP4 or MOV.");
  if (sizeBytes > 8 * 1024 * 1024 * 1024) throw new Error("Full video is limited to 8 GB.");
  const dir = path.join(ROOT, "Music", safeName(title), "Videos", "Uploaded");
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const incomingExt = path.extname(filename).toLowerCase() === ".mov" ? ".mov" : ".mp4";
  const incoming = path.join(dir, `${id}-incoming${incomingExt}`);
  await pipeline(req, createWriteStream(incoming));
  const info = await stat(incoming);
  if (info.size !== Math.round(sizeBytes)) {
    await unlink(incoming).catch(() => {});
    throw new Error(`Upload size mismatch (${info.size} received, ${Math.round(sizeBytes)} expected).`);
  }

  const outputName = `${safeName(title)}-My-Full-Video-${id.slice(0, 8)}.mp4`;
  const output = path.join(dir, outputName);
  if (incomingExt === ".mov") {
    await run(ffmpegPath, [
      "-y", "-i", incoming,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output,
    ]);
    await unlink(incoming).catch(() => {});
  } else {
    await rename(incoming, output);
  }

  const uploadedFullVideo = {
    projectId,
    title,
    filename: outputName,
    originalFilename: filename,
    filePath: output,
    source: "uploaded",
    uploadedAt: new Date().toISOString(),
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
  };
  const manifest = await loadManifest();
  manifest.projects ||= {};
  const existing = manifest.projects[projectId] || { projectId, title };
  const previous = existing.uploadedFullVideo;
  manifest.projects[projectId] = { ...existing, projectId, title, uploadedFullVideo };
  await saveManifest(manifest);
  if (previous?.filePath && previous.filePath !== output) await unlink(previous.filePath).catch(() => {});
  return await publicFullVideo(projectId, uploadedFullVideo, "uploaded");
}

async function approveFullVideo(projectId, source) {
  if (!new Set(["generated", "uploaded"]).has(source)) throw new Error("Choose generated or uploaded video.");
  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId];
  if (!project) throw new Error("Song project not found in the local worker.");
  const item = source === "uploaded" ? project.uploadedFullVideo : legacyGeneratedItem(project);
  if (!item?.filePath) throw new Error(source === "uploaded" ? "Upload your full video first." : "Generate the full video first.");
  try { await stat(item.filePath); } catch { throw new Error("The selected video file is missing from your Mac."); }
  project.approvedFullVideoSource = source;
  project.approvedFullVideoAt = new Date().toISOString();
  await saveManifest(manifest);
  return await publicFullVideo(projectId, item, source);
}

function publicMediaItem(projectId, item) {
  return {
    id: item.id,
    projectId,
    mediaType: item.mediaType,
    format: item.format,
    filename: item.filename,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    addedAt: item.addedAt,
    fileUrl: `http://${HOST}:${PORT}/media/file?projectId=${encodeURIComponent(projectId)}&assetId=${encodeURIComponent(item.id)}`,
  };
}

async function listMedia(projectId) {
  const manifest = await loadManifest();
  const items = Array.isArray(manifest.projects?.[projectId]?.customMedia) ? manifest.projects[projectId].customMedia : [];
  const existing = [];
  for (const item of items) {
    try {
      await stat(item.filePath);
      existing.push(publicMediaItem(projectId, item));
    } catch {}
  }
  return existing;
}

async function saveUploadedMedia(req, url) {
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  const title = String(url.searchParams.get("title") || "Untitled Song").trim();
  const mediaType = String(url.searchParams.get("mediaType") || "").trim();
  const format = String(url.searchParams.get("format") || "landscape").toLowerCase() === "vertical" ? "vertical" : "landscape";
  const filename = String(url.searchParams.get("filename") || "media").trim();
  const mimeType = String(url.searchParams.get("mimeType") || "application/octet-stream").trim();
  const sizeBytes = Number(url.searchParams.get("sizeBytes") || "0");
  const allowedType = new Set(["horizontal-image", "vertical-image", "video-clip"]);
  if (!projectId || !allowedType.has(mediaType) || !filename || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error("Invalid visual media upload details.");
  }
  const isVideo = mediaType === "video-clip";
  if (isVideo && !new Set(["video/mp4", "video/quicktime"]).has(mimeType)) throw new Error("Video clips must be MP4 or MOV.");
  if (!isVideo && !new Set(["image/png", "image/jpeg", "image/webp"]).has(mimeType)) throw new Error("Images must be PNG, JPG or WebP.");
  const max = isVideo ? 2 * 1024 * 1024 * 1024 : 200 * 1024 * 1024;
  if (sizeBytes > max) throw new Error(isVideo ? "Video clips are limited to 2 GB each." : "Images are limited to 200 MB each.");
  const folder = mediaType === "horizontal-image" ? "Horizontal Images" : mediaType === "vertical-image" ? "Vertical Images" : "Video Clips";
  const dir = path.join(ROOT, "Music", safeName(title), "Assets", folder);
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const filePath = path.join(dir, `${id}-${safeFilename(filename)}`);
  await pipeline(req, createWriteStream(filePath));
  const info = await stat(filePath);
  if (info.size !== Math.round(sizeBytes)) {
    await unlink(filePath).catch(() => {});
    throw new Error(`Upload size mismatch (${info.size} received, ${Math.round(sizeBytes)} expected).`);
  }

  const manifest = await loadManifest();
  manifest.projects ||= {};
  const existing = manifest.projects[projectId] || { projectId, title };
  const customMedia = Array.isArray(existing.customMedia) ? existing.customMedia : [];
  const item = { id, projectId, mediaType, format, filename, mimeType, sizeBytes: info.size, filePath, addedAt: new Date().toISOString() };
  manifest.projects[projectId] = { ...existing, projectId, title, customMedia: [...customMedia, item] };
  await saveManifest(manifest);
  return publicMediaItem(projectId, item);
}

async function deleteUploadedMedia(projectId, assetId) {
  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId];
  if (!project) return false;
  const customMedia = Array.isArray(project.customMedia) ? project.customMedia : [];
  const found = customMedia.find((item) => item.id === assetId);
  if (!found) return false;
  await unlink(found.filePath).catch(() => {});
  project.customMedia = customMedia.filter((item) => item.id !== assetId);
  await saveManifest(manifest);
  return true;
}

async function serveMediaFile(req, res, projectId, assetId) {
  const manifest = await loadManifest();
  const items = Array.isArray(manifest.projects?.[projectId]?.customMedia) ? manifest.projects[projectId].customMedia : [];
  const item = items.find((candidate) => candidate.id === assetId);
  if (!item?.filePath) return json(res, 404, { error: "Media file not found." });
  let info;
  try { info = await stat(item.filePath); } catch { return json(res, 404, { error: "Media file is missing." }); }
  cors(res);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", item.mimeType || "application/octet-stream");
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : info.size - 1;
    if (start >= info.size || end >= info.size || start > end) { res.statusCode = 416; return res.end(); }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    createReadStream(item.filePath, { start, end }).pipe(res);
  } else {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(info.size));
    createReadStream(item.filePath).pipe(res);
  }
}



function shortVerticalImageFilter(sceneDuration, motionIndex) {
  const d = Math.max(1, sceneDuration).toFixed(4);
  const fade = Math.min(0.35, Math.max(0.18, sceneDuration * 0.03));
  const fadeOutStart = Math.max(0, sceneDuration - fade);
  const motions = [
    `x='(iw-ow)*t/${d}':y='(ih-oh)/2'`,
    `x='(iw-ow)*(1-t/${d})':y='(ih-oh)/2'`,
    `x='(iw-ow)/2':y='(ih-oh)*t/${d}'`,
    `x='(iw-ow)/2':y='(ih-oh)*(1-t/${d})'`,
  ];
  return `scale=1296:2304:force_original_aspect_ratio=increase,crop=1296:2304,` +
    `crop=1080:1920:${motions[motionIndex % motions.length]},setsar=1,fps=30,format=yuv420p,` +
    `fade=t=in:st=0:d=${fade.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)}`;
}

function shortLandscapeImageFilter(sceneDuration) {
  const fade = Math.min(0.35, Math.max(0.18, sceneDuration * 0.03));
  const fadeOutStart = Math.max(0, sceneDuration - fade);
  return `[0:v]split=2[bg][fg];` +
    `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:2[bgx];` +
    `[fg]scale=1040:1840:force_original_aspect_ratio=decrease[fgx];` +
    `[bgx][fgx]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p,` +
    `fade=t=in:st=0:d=${fade.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)}[v]`;
}

function shortVerticalVideoFilter(sceneDuration) {
  const fade = Math.min(0.35, Math.max(0.18, sceneDuration * 0.03));
  const fadeOutStart = Math.max(0, sceneDuration - fade);
  return `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p,` +
    `fade=t=in:st=0:d=${fade.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)}`;
}

function shortLandscapeVideoFilter(sceneDuration) {
  const fade = Math.min(0.35, Math.max(0.18, sceneDuration * 0.03));
  const fadeOutStart = Math.max(0, sceneDuration - fade);
  return `[0:v]split=2[bg][fg];` +
    `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:2[bgx];` +
    `[fg]scale=1040:1840:force_original_aspect_ratio=decrease[fgx];` +
    `[bgx][fgx]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p,` +
    `fade=t=in:st=0:d=${fade.toFixed(3)},fade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fade.toFixed(3)}[v]`;
}

async function renderShortScene(scene, index, sceneDuration, tempDir, prefix) {
  const output = path.join(tempDir, `${prefix}-scene-${String(index + 1).padStart(2, "0")}.mp4`);
  if (scene.mediaType === "video") {
    const base = ["-y", "-stream_loop", "-1", "-i", scene.file, "-t", sceneDuration.toFixed(4)];
    if (scene.format === "vertical") {
      await run(ffmpegPath, [...base, "-vf", shortVerticalVideoFilter(sceneDuration), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30", "-t", sceneDuration.toFixed(4), output]);
    } else {
      await run(ffmpegPath, [...base, "-filter_complex", shortLandscapeVideoFilter(sceneDuration), "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30", "-t", sceneDuration.toFixed(4), output]);
    }
    return output;
  }
  const base = ["-y", "-loop", "1", "-framerate", "30", "-t", sceneDuration.toFixed(4), "-i", scene.file];
  if (scene.format === "vertical") {
    await run(ffmpegPath, [...base, "-vf", shortVerticalImageFilter(sceneDuration, index), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30", "-t", sceneDuration.toFixed(4), output]);
  } else {
    await run(ffmpegPath, [...base, "-filter_complex", shortLandscapeImageFilter(sceneDuration), "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "30", "-t", sceneDuration.toFixed(4), output]);
  }
  return output;
}

function normalizeHighlights(raw, durationSeconds) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = list.map((item) => {
    const start = Math.max(0, Number(item?.startSeconds) || 0);
    const end = Math.min(durationSeconds, Number(item?.endSeconds) || start + 18);
    return { startSeconds: start, endSeconds: Math.max(start + 8, end), score: Number(item?.score) || 0 };
  }).filter((item) => item.startSeconds < durationSeconds - 3).slice(0, 6);
  if (cleaned.length >= 6) return cleaned;
  const defaultLength = durationSeconds < 100 ? 15 : durationSeconds < 200 ? 18 : 22;
  for (let i = cleaned.length; i < 6; i += 1) {
    const maxStart = Math.max(0, durationSeconds - defaultLength);
    const start = maxStart * (i / 5);
    cleaned.push({ startSeconds: start, endSeconds: Math.min(durationSeconds, start + defaultLength), score: 0 });
  }
  return cleaned.slice(0, 6);
}

async function renderShorts(body) {
  if (!ffmpegPath) throw new Error("FFmpeg is unavailable. Run npm install ffmpeg-static first.");
  const projectId = String(body.projectId || "").trim();
  const title = String(body.title || "Suno Zara Song").trim();
  const audioUrl = String(body.audioUrl || "").trim();
  const durationSeconds = Number(body.durationSeconds);
  const visuals = normalizeVisuals(body);
  if (!projectId || !audioUrl || !Number.isFinite(durationSeconds) || durationSeconds < 12 || !visuals.length) {
    throw new Error("projectId, audioUrl, durationSeconds and at least one visual are required.");
  }
  const highlights = normalizeHighlights(body.highlights, durationSeconds);
  const jobId = randomUUID();
  const tempDir = path.join(os.tmpdir(), "szu-video-worker", `shorts-${jobId}`);
  await mkdir(tempDir, { recursive: true });
  try {
    const audioFile = await download(audioUrl, "audio", tempDir);
    const downloadedVisuals = [];
    for (let i = 0; i < visuals.length; i += 1) {
      downloadedVisuals.push({ ...visuals[i], file: await download(visuals[i].url, `short-visual-${i + 1}`, tempDir) });
    }
    const shortsFolder = path.join(ROOT, "Music", safeName(title), "Shorts");
    await mkdir(shortsFolder, { recursive: true });
    const generatedShorts = [];
    for (let slot = 1; slot <= 6; slot += 1) {
      const highlight = highlights[slot - 1];
      const clipDuration = Math.max(8, Math.min(30, highlight.endSeconds - highlight.startSeconds));
      const sceneCount = clipDuration <= 16 ? 2 : 3;
      const sceneDuration = clipDuration / sceneCount;
      const sequence = Array.from({ length: sceneCount }, (_, index) => downloadedVisuals[((slot - 1) * 2 + index) % downloadedVisuals.length]);
      const sceneFiles = [];
      for (let i = 0; i < sequence.length; i += 1) {
        sceneFiles.push(await renderShortScene(sequence[i], i, sceneDuration, tempDir, `short-${slot}`));
      }
      const concatFile = path.join(tempDir, `short-${slot}.ffconcat`);
      await writeFile(concatFile, ["ffconcat version 1.0", ...sceneFiles.map((file) => `file '${ffconcatEscape(file)}'`)].join("\n") + "\n");
      const silentVideo = path.join(tempDir, `short-${slot}-silent.mp4`);
      await run(ffmpegPath, ["-y", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", silentVideo]);
      const filename = `${safeName(title)}-Short-${String(slot).padStart(2, "0")}.mp4`;
      const output = path.join(shortsFolder, filename);
      await run(ffmpegPath, [
        "-y", "-i", silentVideo, "-ss", highlight.startSeconds.toFixed(3), "-i", audioFile,
        "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-t", clipDuration.toFixed(3), "-shortest", "-movflags", "+faststart", output,
      ]);
      generatedShorts.push({
        projectId, title, slot, filename, filePath: output, source: "generated", generatedAt: new Date().toISOString(),
        startSeconds: highlight.startSeconds, endSeconds: highlight.startSeconds + clipDuration, durationSeconds: clipDuration,
        width: 1080, height: 1920, visualCount: sequence.length,
      });
      console.log(`[${title}] Short ${slot}/6 rendered (${highlight.startSeconds.toFixed(1)}s–${(highlight.startSeconds + clipDuration).toFixed(1)}s).`);
    }
    const manifest = await loadManifest();
    manifest.projects ||= {};
    const existing = manifest.projects[projectId] || {};
    const previousCaptioned = existing.captionedShorts && typeof existing.captionedShorts === "object" ? existing.captionedShorts : {};
    for (const item of Object.values(previousCaptioned)) {
      if (item?.filePath) await unlink(item.filePath).catch(() => {});
    }
    const shortCaptionSettings = existing.shortCaptionSettings && typeof existing.shortCaptionSettings === "object" ? { ...existing.shortCaptionSettings } : {};
    for (const key of Object.keys(shortCaptionSettings)) shortCaptionSettings[key] = { ...shortCaptionSettings[key], enabled: false };
    manifest.projects[projectId] = { ...existing, projectId, title, generatedShorts, captionedShorts: {}, shortCaptionSettings };
    await saveManifest(manifest);
    return generatedShorts;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(value || "").trim());
  if (!match) throw new Error("Caption overlay must be a PNG data URL.");
  return Buffer.from(match[1], "base64");
}

function activeGeneratedShort(project, slot) {
  const base = Array.isArray(project?.generatedShorts)
    ? project.generatedShorts.find((item) => Number(item.slot) === Number(slot)) || null
    : null;
  const setting = project?.shortCaptionSettings?.[String(slot)] || null;
  const captioned = project?.captionedShorts?.[String(slot)] || null;
  return setting?.enabled && captioned?.filePath ? captioned : base;
}

async function applyShortCaption(body) {
  if (!ffmpegPath) throw new Error("FFmpeg is unavailable. Run npm install ffmpeg-static first.");
  const projectId = String(body.projectId || "").trim();
  const slot = Math.max(1, Math.min(6, Number(body.slot || 0)));
  const enabled = Boolean(body.enabled);
  const text = String(body.text || "").trim().slice(0, 500);
  const style = new Set(["cinematic", "bold", "minimal"]).has(String(body.style || "")) ? String(body.style) : "cinematic";
  if (!projectId || !slot) throw new Error("projectId and Short slot are required.");

  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId];
  if (!project) throw new Error("Song project not found in the local worker.");
  const base = Array.isArray(project.generatedShorts)
    ? project.generatedShorts.find((item) => Number(item.slot) === slot)
    : null;
  if (!base?.filePath) throw new Error(`Generate Short ${slot} first.`);
  try { await stat(base.filePath); } catch { throw new Error(`The generated Short ${slot} is missing from your Mac.`); }

  project.shortCaptionSettings = project.shortCaptionSettings && typeof project.shortCaptionSettings === "object" ? project.shortCaptionSettings : {};
  project.captionedShorts = project.captionedShorts && typeof project.captionedShorts === "object" ? project.captionedShorts : {};
  const previous = project.captionedShorts[String(slot)];

  if (!enabled || !text) {
    if (previous?.filePath) await unlink(previous.filePath).catch(() => {});
    delete project.captionedShorts[String(slot)];
    const captionSettings = { enabled: false, text, style, updatedAt: new Date().toISOString() };
    project.shortCaptionSettings[String(slot)] = captionSettings;
    await saveManifest(manifest);
    return { ...(await shortsStatus(projectId)), captionSettings };
  }

  const overlayDataUrl = String(body.overlayDataUrl || "").trim();
  if (!overlayDataUrl) throw new Error("Caption overlay data was not received.");
  const tempDir = path.join(os.tmpdir(), "szu-video-worker", `caption-${projectId}-${slot}-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  try {
    const overlayFile = path.join(tempDir, "caption.png");
    await writeFile(overlayFile, decodePngDataUrl(overlayDataUrl));
    const outDir = path.join(path.dirname(base.filePath), "Captioned");
    await mkdir(outDir, { recursive: true });
    const output = path.join(outDir, `${safeName(project.title || base.title || "Suno-Zara-Song")}-Short-${String(slot).padStart(2, "0")}-Captioned.mp4`);
    await run(ffmpegPath, [
      "-y", "-i", base.filePath, "-loop", "1", "-i", overlayFile,
      "-filter_complex", "[0:v][1:v]overlay=0:0:eof_action=repeat:shortest=1[v]",
      "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-movflags", "+faststart", "-shortest", output,
    ]);
    const captionSettings = { enabled: true, text, style, updatedAt: new Date().toISOString() };
    const captioned = {
      ...base,
      filename: path.basename(output),
      filePath: output,
      source: "generated",
      captioned: true,
      captionUpdatedAt: captionSettings.updatedAt,
    };
    project.shortCaptionSettings[String(slot)] = captionSettings;
    project.captionedShorts[String(slot)] = captioned;
    await saveManifest(manifest);
    if (previous?.filePath && previous.filePath !== output) await unlink(previous.filePath).catch(() => {});
    return { ...(await shortsStatus(projectId)), captionSettings };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function unapproveFullVideo(projectId) {
  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId];
  if (!project) throw new Error("Song project not found in the local worker.");
  delete project.approvedFullVideoSource;
  delete project.approvedFullVideoAt;
  await saveManifest(manifest);
  return await fullVideoStatus(projectId);
}

async function unapproveShort(projectId, slot) {
  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId];
  if (!project) throw new Error("Song project not found in the local worker.");
  if (project.approvedShortSources && typeof project.approvedShortSources === "object") {
    delete project.approvedShortSources[String(slot)];
  }
  await saveManifest(manifest);
  return await shortsStatus(projectId);
}

async function publicShort(projectId, item, source) {
  if (!item?.filePath) return null;
  try { await stat(item.filePath); } catch { return null; }
  const slot = Number(item.slot);
  return {
    ...item,
    source,
    fileUrl: `http://${HOST}:${PORT}/short/file?projectId=${encodeURIComponent(projectId)}&slot=${slot}&source=${encodeURIComponent(source)}&v=${encodeURIComponent(item.captionUpdatedAt || item.generatedAt || item.uploadedAt || "1")}`,
    downloadUrl: `http://${HOST}:${PORT}/short/file?projectId=${encodeURIComponent(projectId)}&slot=${slot}&source=${encodeURIComponent(source)}&download=1&v=${encodeURIComponent(item.captionUpdatedAt || item.generatedAt || item.uploadedAt || "1")}`,
  };
}

async function shortsStatus(projectId) {
  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId] || {};
  const uploaded = project.uploadedShorts && typeof project.uploadedShorts === "object" ? project.uploadedShorts : {};
  const approvedSources = project.approvedShortSources && typeof project.approvedShortSources === "object" ? project.approvedShortSources : {};
  const captionSettings = project.shortCaptionSettings && typeof project.shortCaptionSettings === "object" ? project.shortCaptionSettings : {};
  const slots = [];
  for (let slot = 1; slot <= 6; slot += 1) {
    const generatedVideo = await publicShort(projectId, activeGeneratedShort(project, slot), "generated");
    const uploadedVideo = await publicShort(projectId, uploaded[String(slot)], "uploaded");
    const approvedSource = approvedSources[String(slot)] === "uploaded" ? "uploaded" : approvedSources[String(slot)] === "generated" ? "generated" : null;
    const approvedVideo = approvedSource === "uploaded" ? uploadedVideo : approvedSource === "generated" ? generatedVideo : null;
    slots.push({ slot, generatedVideo, uploadedVideo, approvedVideo, approvedSource, captionSettings: captionSettings[String(slot)] || { enabled: false, text: "", style: "cinematic" } });
  }
  return { slots };
}

async function resolveShortItem(projectId, slot, source) {
  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId] || {};
  if (source === "uploaded") return project.uploadedShorts?.[String(slot)] || null;
  return activeGeneratedShort(project, slot);
}

async function serveShortFile(req, res, projectId, slot, source, downloadFile) {
  const item = await resolveShortItem(projectId, slot, source);
  if (!item?.filePath) return json(res, 404, { error: "Short video not found." });
  let info;
  try { info = await stat(item.filePath); } catch { return json(res, 404, { error: "Short video file is missing." }); }
  cors(res);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "video/mp4");
  if (downloadFile) res.setHeader("Content-Disposition", `attachment; filename="${item.filename}"`);
  const range = req.headers.range;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : info.size - 1;
    if (start >= info.size || end >= info.size || start > end) { res.statusCode = 416; return res.end(); }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    createReadStream(item.filePath, { start, end }).pipe(res);
  } else {
    res.statusCode = 200;
    res.setHeader("Content-Length", String(info.size));
    createReadStream(item.filePath).pipe(res);
  }
}

async function saveUploadedShort(req, url) {
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  const title = String(url.searchParams.get("title") || "Untitled Song").trim();
  const slot = Math.max(1, Math.min(6, Number(url.searchParams.get("slot") || "0")));
  const filename = String(url.searchParams.get("filename") || `short-${slot}.mp4`).trim();
  const mimeType = String(url.searchParams.get("mimeType") || "video/mp4").trim();
  const sizeBytes = Number(url.searchParams.get("sizeBytes") || "0");
  const durationSeconds = Number(url.searchParams.get("durationSeconds") || "0");
  const width = Number(url.searchParams.get("width") || "0");
  const height = Number(url.searchParams.get("height") || "0");
  if (!projectId || !Number.isFinite(sizeBytes) || sizeBytes <= 0) throw new Error("Invalid Short upload details.");
  if (!new Set(["video/mp4", "video/quicktime"]).has(mimeType)) throw new Error("Short video must be MP4 or MOV.");
  if (sizeBytes > 3 * 1024 * 1024 * 1024) throw new Error("Short video is limited to 3 GB.");
  const dir = path.join(ROOT, "Music", safeName(title), "Shorts", "Uploaded");
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const incomingExt = path.extname(filename).toLowerCase() === ".mov" ? ".mov" : ".mp4";
  const incoming = path.join(dir, `${id}-incoming${incomingExt}`);
  await pipeline(req, createWriteStream(incoming));
  const info = await stat(incoming);
  if (info.size !== Math.round(sizeBytes)) {
    await unlink(incoming).catch(() => {});
    throw new Error(`Upload size mismatch (${info.size} received, ${Math.round(sizeBytes)} expected).`);
  }
  const outputName = `${safeName(title)}-My-Short-${String(slot).padStart(2, "0")}-${id.slice(0, 8)}.mp4`;
  const output = path.join(dir, outputName);
  if (incomingExt === ".mov") {
    await run(ffmpegPath, ["-y", "-i", incoming, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output]);
    await unlink(incoming).catch(() => {});
  } else {
    await rename(incoming, output);
  }
  const item = { projectId, title, slot, filename: outputName, originalFilename: filename, filePath: output, source: "uploaded", uploadedAt: new Date().toISOString(), durationSeconds, width, height };
  const manifest = await loadManifest();
  manifest.projects ||= {};
  const existing = manifest.projects[projectId] || { projectId, title };
  const uploadedShorts = existing.uploadedShorts && typeof existing.uploadedShorts === "object" ? existing.uploadedShorts : {};
  const previous = uploadedShorts[String(slot)];
  uploadedShorts[String(slot)] = item;
  manifest.projects[projectId] = { ...existing, projectId, title, uploadedShorts };
  await saveManifest(manifest);
  if (previous?.filePath && previous.filePath !== output) await unlink(previous.filePath).catch(() => {});
  return await publicShort(projectId, item, "uploaded");
}

async function approveShort(projectId, slot, source) {
  if (!new Set(["generated", "uploaded"]).has(source)) throw new Error("Choose generated or uploaded Short.");
  const manifest = await loadManifest();
  const project = manifest.projects?.[projectId];
  if (!project) throw new Error("Song project not found in the local worker.");
  const item = source === "uploaded" ? project.uploadedShorts?.[String(slot)] : activeGeneratedShort(project, slot);
  if (!item?.filePath) throw new Error(source === "uploaded" ? "Upload your Short first." : "Generate the Shorts first.");
  project.approvedShortSources = project.approvedShortSources && typeof project.approvedShortSources === "object" ? project.approvedShortSources : {};
  project.approvedShortSources[String(slot)] = source;
  await saveManifest(manifest);
  return await publicShort(projectId, item, source);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") { cors(res); res.statusCode = 204; return res.end(); }
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "Suno Zara Universe Video Worker", ffmpeg: Boolean(ffmpegPath), renderer: "review-captions-v4" });
    }
    if (req.method === "GET" && url.pathname === "/latest") {
      return json(res, 200, { video: await videoResponse(url.searchParams.get("projectId") || "") });
    }
    if (req.method === "GET" && url.pathname === "/file") {
      return serveFile(req, res, url.searchParams.get("projectId") || "", url.searchParams.get("download") === "1");
    }
    if (req.method === "GET" && url.pathname === "/full-video/status") {
      return json(res, 200, await fullVideoStatus(url.searchParams.get("projectId") || ""));
    }
    if (req.method === "GET" && url.pathname === "/full-video/file") {
      return serveFullVideoFile(req, res, url.searchParams.get("projectId") || "", url.searchParams.get("source") === "uploaded" ? "uploaded" : "generated", url.searchParams.get("download") === "1");
    }
    if (req.method === "POST" && url.pathname === "/full-video/upload") {
      return json(res, 200, { video: await saveUploadedFullVideo(req, url) });
    }
    if (req.method === "POST" && url.pathname === "/full-video/approve") {
      const body = await readJsonBody(req);
      return json(res, 200, { approvedVideo: await approveFullVideo(String(body.projectId || ""), String(body.source || "")) });
    }
    if (req.method === "POST" && url.pathname === "/full-video/unapprove") {
      const body = await readJsonBody(req);
      return json(res, 200, await unapproveFullVideo(String(body.projectId || "")));
    }
    if (req.method === "POST" && url.pathname === "/render/full-video") {
      const item = await renderFullVideo(await readJsonBody(req));
      return json(res, 200, { ok: true, video: await videoResponse(item.projectId) });
    }
    if (req.method === "GET" && url.pathname === "/shorts/status") {
      return json(res, 200, await shortsStatus(url.searchParams.get("projectId") || ""));
    }
    if (req.method === "GET" && url.pathname === "/short/file") {
      return serveShortFile(req, res, url.searchParams.get("projectId") || "", Number(url.searchParams.get("slot") || "0"), url.searchParams.get("source") === "uploaded" ? "uploaded" : "generated", url.searchParams.get("download") === "1");
    }
    if (req.method === "POST" && url.pathname === "/short/upload") {
      return json(res, 200, { video: await saveUploadedShort(req, url) });
    }
    if (req.method === "POST" && url.pathname === "/short/approve") {
      const body = await readJsonBody(req);
      return json(res, 200, { approvedVideo: await approveShort(String(body.projectId || ""), Number(body.slot || 0), String(body.source || "")) });
    }
    if (req.method === "POST" && url.pathname === "/short/unapprove") {
      const body = await readJsonBody(req);
      return json(res, 200, await unapproveShort(String(body.projectId || ""), Number(body.slot || 0)));
    }
    if (req.method === "POST" && url.pathname === "/short/caption") {
      return json(res, 200, await applyShortCaption(await readJsonBody(req)));
    }
    if (req.method === "POST" && url.pathname === "/render/shorts") {
      const items = await renderShorts(await readJsonBody(req));
      return json(res, 200, { ok: true, shorts: items, ...(await shortsStatus(items[0]?.projectId || "")) });
    }
    if (req.method === "GET" && url.pathname === "/media/list") {
      return json(res, 200, { assets: await listMedia(url.searchParams.get("projectId") || "") });
    }
    if (req.method === "POST" && url.pathname === "/media/upload") {
      return json(res, 200, { asset: await saveUploadedMedia(req, url) });
    }
    if (req.method === "POST" && url.pathname === "/media/delete") {
      const body = await readJsonBody(req);
      const deleted = await deleteUploadedMedia(String(body.projectId || ""), String(body.assetId || ""));
      return json(res, 200, { deleted });
    }
    if (req.method === "GET" && url.pathname === "/media/file") {
      return serveMediaFile(req, res, url.searchParams.get("projectId") || "", url.searchParams.get("assetId") || "");
    }
    return json(res, 404, { error: "Not found." });
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error instanceof Error ? error.message : "Worker request failed." });
  }
});

await mkdir(ROOT, { recursive: true });
server.listen(PORT, HOST, () => {
  console.log(`Suno Zara Universe video worker ready on http://${HOST}:${PORT}`);
  console.log(`Renderer: review-captions-v4 (final review + caption overlays + approvals)`);
  console.log(`Generated videos and added media will be saved under: ${path.join(ROOT, "Music")}`);
});
