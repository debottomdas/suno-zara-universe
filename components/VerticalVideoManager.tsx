"use client";

import { useEffect, useState } from "react";
import * as tus from "tus-js-client";
import { createClient } from "@/utils/supabase/client";
import { uploadLocalMedia } from "@/utils/local-media-client";

type VerticalVideoAsset = {
  id: string;
  songId: string;
  mediaKind: string;
  slot: number;
  originalFilename: string;
  storageProvider?: "local" | "supabase";
  storagePath?: string | null;
  localPath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  createdAt?: string;
  updatedAt?: string;
  url: string;
  downloadUrl?: string;
};

function formatBytes(bytes?: number | null) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function inferVideoMimeType(file: File) {
  if (
    file.type === "video/mp4" ||
    file.type === "video/quicktime"
  ) {
    return file.type;
  }

  const extension =
    file.name.split(".").pop()?.toLowerCase() || "";

  if (extension === "mp4") {
    return "video/mp4";
  }

  if (extension === "mov") {
    return "video/quicktime";
  }

  return "";
}

export default function VerticalVideoManager({
  projectId,
  storageMode,
}: {
  projectId: string;
  storageMode: "local" | "supabase";
}) {
  const [assets, setAssets] = useState<VerticalVideoAsset[]>([]);
  const [files, setFiles] = useState<Record<number, File | null>>({});
  const [loading, setLoading] = useState(true);
  const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
  const [deletingSlot, setDeletingSlot] = useState<number | null>(null);
  const [progress, setProgress] = useState<Record<number, number>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [statuses, setStatuses] = useState<Record<number, string>>({});

  function setSlotError(slot: number, message: string) {
    setErrors((current) => ({
      ...current,
      [slot]: message,
    }));
  }

  function setSlotStatus(slot: number, message: string) {
    setStatuses((current) => ({
      ...current,
      [slot]: message,
    }));
  }

  async function loadAssets() {
    try {
      setLoading(true);

      const response = await fetch(
        `/api/media/vertical-video?projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not load Vertical Videos."
        );
      }

      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch (error) {
      console.error("Load Vertical Videos error:", error);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setFiles({});
    setAssets([]);
    setErrors({});
    setStatuses({});
    setProgress({});
    setUploadingSlot(null);
    setDeletingSlot(null);
    void loadAssets();
  }, [projectId]);

  async function uploadSlot(slot: number) {
    const file = files[slot];

    if (!file) {
      setSlotError(slot, "Please choose a video file first.");
      return;
    }

    const mimeType = inferVideoMimeType(file);

    if (!mimeType) {
      setSlotError(slot, "Please choose an MP4 or MOV video.");
      return;
    }

    if (storageMode === "local") {
      try {
        setUploadingSlot(slot);
        setSlotError(slot, "");
        setProgress((current) => ({ ...current, [slot]: 0 }));
        setSlotStatus(slot, `Saving Vertical Video ${slot} to this Mac...`);
        await uploadLocalMedia({
          projectId,
          mediaKind: "vertical-video",
          slot,
          file,
          mimeType,
          onProgress: (percent) => {
            setProgress((current) => ({ ...current, [slot]: percent }));
            setSlotStatus(slot, `Saving Vertical Video ${slot} locally... ${percent}%`);
          },
        });
        await loadAssets();
        setFiles((current) => ({ ...current, [slot]: null }));
        setSlotStatus(slot, "✓ Vertical Video saved locally");
        window.setTimeout(() => setSlotStatus(slot, ""), 3000);
      } catch (error) {
        setSlotStatus(slot, "");
        setSlotError(slot, error instanceof Error ? error.message : "Could not save Vertical Video locally.");
      } finally {
        setUploadingSlot(null);
      }
      return;
    }

    let uploadedStoragePath = "";
    let uploadedBucket = "song-media";

    try {
      setUploadingSlot(slot);
      setSlotError(slot, "");
      setProgress((current) => ({ ...current, [slot]: 0 }));
      setSlotStatus(slot, "Preparing secure resumable upload...");

      const prepareResponse = await fetch(
        "/api/media/vertical-video",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "prepare",
            projectId,
            slot,
            originalFilename: file.name,
            mimeType,
            sizeBytes: file.size,
          }),
        }
      );

      const prepareData = await prepareResponse.json();

      if (!prepareResponse.ok) {
        throw new Error(
          prepareData.error ||
            "Could not prepare vertical video upload."
        );
      }

      const upload = prepareData.upload;

      if (!upload?.storagePath || !upload?.tusEndpoint) {
        throw new Error(
          "Secure resumable upload details were not returned."
        );
      }

      uploadedStoragePath = upload.storagePath;
      uploadedBucket = upload.bucket || "song-media";

      const supabase = createClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error(
          "Your login session could not be used for the video upload. Please sign in again."
        );
      }

      setSlotStatus(slot, `Uploading Vertical Video ${slot}...`);

      await new Promise<void>((resolve, reject) => {
        const videoUpload = new tus.Upload(file, {
          endpoint: upload.tusEndpoint,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          headers: {
            authorization: `Bearer ${session.access_token}`,
          },
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          metadata: {
            bucketName: uploadedBucket,
            objectName: uploadedStoragePath,
            contentType: mimeType,
            cacheControl: "3600",
          },
          chunkSize: 6 * 1024 * 1024,
          onError: reject,
          onProgress: (bytesUploaded, bytesTotal) => {
            const percentage =
              bytesTotal > 0
                ? Math.round((bytesUploaded / bytesTotal) * 100)
                : 0;

            setProgress((current) => ({
              ...current,
              [slot]: percentage,
            }));

            setSlotStatus(
              slot,
              `Uploading Vertical Video ${slot}... ${percentage}%`
            );
          },
          onSuccess: () => {
            setProgress((current) => ({
              ...current,
              [slot]: 100,
            }));
            resolve();
          },
        });

        videoUpload.start();
      });

      setSlotStatus(slot, "Saving video to this song...");

      const registerResponse = await fetch(
        "/api/media/vertical-video",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "register",
            projectId,
            slot,
            storagePath: uploadedStoragePath,
            originalFilename: file.name,
            mimeType,
            sizeBytes: file.size,
          }),
        }
      );

      const registerData = await registerResponse.json();

      if (!registerResponse.ok) {
        await supabase.storage
          .from(uploadedBucket)
          .remove([uploadedStoragePath]);

        throw new Error(
          registerData.error ||
            "Vertical video uploaded but could not be saved."
        );
      }

      await loadAssets();

      setFiles((current) => ({
        ...current,
        [slot]: null,
      }));

      setSlotStatus(slot, "✓ Vertical Video saved");

      window.setTimeout(() => {
        setSlotStatus(slot, "");
      }, 3000);
    } catch (error) {
      setSlotStatus(slot, "");
      setSlotError(
        slot,
        error instanceof Error
          ? error.message
          : "Could not upload Vertical Video."
      );
    } finally {
      setUploadingSlot(null);
    }
  }

  async function deleteSlot(slot: number) {
    const asset = assets.find((item) => item.slot === slot);

    if (!asset) {
      return;
    }

    const confirmed = window.confirm(
      `Delete Vertical Video ${slot}: ${asset.originalFilename}?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingSlot(slot);
      setSlotError(slot, "");
      setSlotStatus(slot, "Deleting...");

      const response = await fetch("/api/media/vertical-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          projectId,
          slot,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Could not delete Vertical Video."
        );
      }

      setAssets((current) =>
        current.filter((item) => item.slot !== slot)
      );
      setFiles((current) => ({ ...current, [slot]: null }));
      setSlotStatus(slot, "");
    } catch (error) {
      setSlotError(
        slot,
        error instanceof Error
          ? error.message
          : "Could not delete Vertical Video."
      );
    } finally {
      setDeletingSlot(null);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-white">
            Vertical Shorts / Reels / TikTok
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Save up to 10 finished vertical clips for this song. Each
            slot is independent and can be uploaded, replaced,
            downloaded or deleted.
          </p>
        </div>

        {assets.length > 0 && (
          <span className="rounded-full bg-emerald-950 px-3 py-1 text-xs font-semibold text-emerald-300">
            {assets.length}/10 Saved
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-zinc-500">
          Loading saved vertical videos...
        </p>
      ) : (
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {Array.from({ length: 10 }, (_, index) => index + 1).map(
            (slot) => {
              const asset = assets.find((item) => item.slot === slot);
              const selectedFile = files[slot] || null;
              const isUploading = uploadingSlot === slot;
              const isDeleting = deletingSlot === slot;
              const slotProgress = progress[slot] || 0;
              const error = errors[slot] || "";
              const status = statuses[slot] || "";
              const anotherUploadRunning =
                uploadingSlot !== null && !isUploading;

              return (
                <div
                  key={slot}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">
                        Vertical Clip {String(slot).padStart(2, "0")}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        9:16 · Shorts · Reels · TikTok
                      </p>
                    </div>

                    {asset && (
                      <span className="rounded-full bg-emerald-950 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                        ✓ Saved
                      </span>
                    )}
                  </div>

                  {error && (
                    <div className="mt-4 rounded-xl border border-red-900 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                      {error}
                    </div>
                  )}

                  {status && (
                    <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
                      {status}
                    </div>
                  )}

                  {isUploading && (
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
                        <span>Upload progress</span>
                        <span>{slotProgress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full bg-white transition-all duration-300"
                          style={{ width: `${slotProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {asset && (
                    <div className="mt-4">
                      <video
                        key={asset.url}
                        controls
                        preload="metadata"
                        src={asset.url}
                        className="aspect-[9/16] max-h-[420px] w-full rounded-xl bg-black object-contain"
                      >
                        Your browser does not support video playback.
                      </video>

                      <p className="mt-3 break-all text-sm font-medium text-zinc-200">
                        {asset.originalFilename}
                      </p>

                      <p className="mt-1 text-[11px] font-semibold text-cyan-300/80">
                        {asset.storageProvider === "local" ? "This Mac · local-media" : "Supabase Cloud"}
                      </p>

                      {asset.sizeBytes ? (
                        <p className="mt-1 text-xs text-zinc-500">
                          {formatBytes(asset.sizeBytes)}
                        </p>
                      ) : null}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {asset.downloadUrl && (
                          <a
                            href={asset.downloadUrl}
                            className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
                          >
                            Download
                          </a>
                        )}

                        <button
                          type="button"
                          onClick={() => deleteSlot(slot)}
                          disabled={isUploading || isDeleting}
                          className="rounded-xl border border-red-900/70 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-950/40 disabled:opacity-50"
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </div>
                  )}

                  <div
                    className={
                      asset
                        ? "mt-5 border-t border-zinc-800 pt-5"
                        : "mt-5"
                    }
                  >
                    <p className="mb-3 text-xs font-medium text-zinc-400">
                      {asset ? "Replace this clip" : "Upload clip"}
                    </p>

                    <input
                      type="file"
                      accept=".mp4,.mov,video/mp4,video/quicktime"
                      disabled={
                        isUploading || isDeleting || anotherUploadRunning
                      }
                      onChange={(event) => {
                        const file = event.target.files?.[0] || null;
                        setFiles((current) => ({
                          ...current,
                          [slot]: file,
                        }));
                        setSlotError(slot, "");
                        setSlotStatus(slot, "");
                        setProgress((current) => ({
                          ...current,
                          [slot]: 0,
                        }));
                      }}
                      className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2.5 file:font-semibold file:text-white hover:file:bg-zinc-700"
                    />

                    {selectedFile && (
                      <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
                        <span className="break-all font-medium text-white">
                          {selectedFile.name}
                        </span>
                        {" · "}
                        {formatBytes(selectedFile.size)}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => uploadSlot(slot)}
                      disabled={
                        !selectedFile ||
                        isUploading ||
                        isDeleting ||
                        anotherUploadRunning
                      }
                      className="mt-3 w-full rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isUploading
                        ? `Uploading ${slotProgress}%`
                        : asset
                          ? "Replace Vertical Clip"
                          : "Upload Vertical Clip"}
                    </button>
                  </div>
                </div>
              );
            }
          )}
        </div>
      )}
    </div>
  );
}
