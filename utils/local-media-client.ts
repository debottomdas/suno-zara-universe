"use client";

type LocalUploadOptions = {
  projectId: string;
  mediaKind: "final-audio" | "youtube-video" | "vertical-video" | "thumbnail" | "cover-art";
  slot?: number;
  file: File;
  mimeType: string;
  metadata?: Record<string, unknown>;
  onProgress?: (percent: number) => void;
};

const LOCAL_CHUNK_SIZE = 5 * 1024 * 1024;

function uploadChunk({
  url,
  body,
  mimeType,
}: {
  url: string;
  body: Blob;
  mimeType: string;
}) {
  return new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Content-Type", mimeType || "application/octet-stream");
    xhr.withCredentials = true;

    xhr.onerror = () => reject(new Error("Local upload connection failed."));
    xhr.onload = () => {
      let data: any = {};
      try { data = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch {}
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data?.error || `Local upload failed (HTTP ${xhr.status}).`));
        return;
      }
      resolve(data);
    };

    xhr.send(body);
  });
}

export async function uploadLocalMedia({
  projectId,
  mediaKind,
  slot = 1,
  file,
  mimeType,
  metadata,
  onProgress,
}: LocalUploadOptions) {
  const uploadId = crypto.randomUUID();
  const totalChunks = Math.max(1, Math.ceil(file.size / LOCAL_CHUNK_SIZE));
  let finalResponse: any = null;

  onProgress?.(0);

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const chunkStart = chunkIndex * LOCAL_CHUNK_SIZE;
    const chunkEnd = Math.min(file.size, chunkStart + LOCAL_CHUNK_SIZE);
    const body = file.slice(chunkStart, chunkEnd, mimeType || file.type || "application/octet-stream");

    const params = new URLSearchParams({
      projectId,
      mediaKind,
      slot: String(slot),
      filename: file.name,
      mimeType,
      sizeBytes: String(file.size),
      uploadId,
      chunkIndex: String(chunkIndex),
      totalChunks: String(totalChunks),
      chunkStart: String(chunkStart),
      chunkEnd: String(chunkEnd),
    });
    if (metadata && Object.keys(metadata).length > 0) {
      params.set("metadata", JSON.stringify(metadata));
    }

    finalResponse = await uploadChunk({
      url: `/api/media/local-upload?${params.toString()}`,
      body,
      mimeType,
    });

    onProgress?.(Math.round((chunkEnd / file.size) * 100));
  }

  if (!finalResponse?.saved || !finalResponse?.asset) {
    throw new Error("Local upload finished but Studio did not save the media asset.");
  }

  onProgress?.(100);
  return finalResponse;
}
