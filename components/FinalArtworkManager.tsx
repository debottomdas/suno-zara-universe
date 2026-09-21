"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { uploadLocalMedia } from "@/utils/local-media-client";

type ArtworkKind = "thumbnail" | "cover-art";

type ArtworkAsset = {
  id: string;
  songId: string;
  mediaKind: ArtworkKind;
  slot: number;
  originalFilename: string;
  storageProvider?: "local" | "supabase";
  storagePath?: string | null;
  localPath?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
  metadata?: {
    width?: number | null;
    height?: number | null;
  };
  createdAt?: string;
  updatedAt?: string;
  url: string;
  downloadUrl?: string;
};

type ImageDimensions = {
  width: number;
  height: number;
};

const artworkConfigs: Array<{
  kind: ArtworkKind;
  title: string;
  subtitle: string;
  recommendation: string;
  aspectClass: string;
}> = [
  {
    kind: "thumbnail",
    title: "YouTube Thumbnail",
    subtitle: "Final 16:9 thumbnail used when publishing the full song video.",
    recommendation: "Recommended: 1280×720 or larger, 16:9.",
    aspectClass: "aspect-video",
  },
  {
    kind: "cover-art",
    title: "Streaming Cover Artwork",
    subtitle: "Final square artwork for the song release and distribution workflow.",
    recommendation: "Recommended: 3000×3000 square artwork.",
    aspectClass: "aspect-square",
  },
];

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

function inferImageMimeType(file: File) {
  if (
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.type === "image/webp"
  ) {
    return file.type;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "";

  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";

  return "";
}

function getImageDimensions(file: File) {
  return new Promise<ImageDimensions>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      const dimensions = {
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
      URL.revokeObjectURL(objectUrl);
      resolve(dimensions);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read image dimensions."));
    };

    image.src = objectUrl;
  });
}

export default function FinalArtworkManager({
  projectId,
  storageMode,
}: {
  projectId: string;
  storageMode: "local" | "supabase";
}) {
  const [assets, setAssets] = useState<ArtworkAsset[]>([]);
  const [files, setFiles] = useState<Record<ArtworkKind, File | null>>({
    thumbnail: null,
    "cover-art": null,
  });
  const [loading, setLoading] = useState(true);
  const [busyKind, setBusyKind] = useState<ArtworkKind | null>(null);
  const [errors, setErrors] = useState<Record<ArtworkKind, string>>({
    thumbnail: "",
    "cover-art": "",
  });
  const [statuses, setStatuses] = useState<Record<ArtworkKind, string>>({
    thumbnail: "",
    "cover-art": "",
  });

  function setKindError(kind: ArtworkKind, message: string) {
    setErrors((current) => ({ ...current, [kind]: message }));
  }

  function setKindStatus(kind: ArtworkKind, message: string) {
    setStatuses((current) => ({ ...current, [kind]: message }));
  }

  async function loadAssets() {
    try {
      setLoading(true);

      const response = await fetch(
        `/api/media/artwork?projectId=${encodeURIComponent(projectId)}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not load final artwork.");
      }

      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch (error) {
      console.error("Load final artwork error:", error);
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setFiles({ thumbnail: null, "cover-art": null });
    setAssets([]);
    setErrors({ thumbnail: "", "cover-art": "" });
    setStatuses({ thumbnail: "", "cover-art": "" });
    setBusyKind(null);
    void loadAssets();
  }, [projectId]);

  async function uploadArtwork(kind: ArtworkKind) {
    const file = files[kind];

    if (!file) {
      setKindError(kind, "Please choose an image first.");
      return;
    }

    const mimeType = inferImageMimeType(file);

    if (!mimeType) {
      setKindError(kind, "Please choose a PNG, JPG or WEBP image.");
      return;
    }

    let uploadedStoragePath = "";
    let uploadedBucket = "song-media";

    try {
      setBusyKind(kind);
      setKindError(kind, "");
      setKindStatus(kind, "Checking artwork...");

      const dimensions = await getImageDimensions(file);

      if (kind === "thumbnail") {
        const ratio = dimensions.width / dimensions.height;
        const target = 16 / 9;
        if (Math.abs(ratio - target) > 0.03) {
          throw new Error(
            `YouTube Thumbnail should be 16:9. This image is ${dimensions.width}×${dimensions.height}.`
          );
        }
      }

      if (kind === "cover-art" && dimensions.width !== dimensions.height) {
        throw new Error(
          `Streaming Cover Artwork should be square. This image is ${dimensions.width}×${dimensions.height}.`
        );
      }

      if (storageMode === "local") {
        setKindStatus(kind, "Saving artwork to this Mac...");
        await uploadLocalMedia({
          projectId,
          mediaKind: kind,
          file,
          mimeType,
          metadata: { width: dimensions.width, height: dimensions.height },
        });
        await loadAssets();
        setFiles((current) => ({ ...current, [kind]: null }));
        setKindStatus(kind, "✓ Artwork saved locally");
        window.setTimeout(() => setKindStatus(kind, ""), 2500);
        return;
      }

      setKindStatus(kind, "Preparing secure upload...");

      const prepareResponse = await fetch("/api/media/artwork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "prepare",
          projectId,
          mediaKind: kind,
          originalFilename: file.name,
          mimeType,
          sizeBytes: file.size,
        }),
      });

      const prepareData = await prepareResponse.json();

      if (!prepareResponse.ok) {
        throw new Error(
          prepareData.error || "Could not prepare artwork upload."
        );
      }

      const upload = prepareData.upload;

      if (!upload?.storagePath || !upload?.token) {
        throw new Error("Secure artwork upload details were not returned.");
      }

      uploadedStoragePath = upload.storagePath;
      uploadedBucket = upload.bucket || "song-media";

      setKindStatus(kind, "Uploading artwork...");

      const supabase = createClient();
      const { error: storageError } = await supabase.storage
        .from(uploadedBucket)
        .uploadToSignedUrl(uploadedStoragePath, upload.token, file, {
          contentType: mimeType,
        });

      if (storageError) {
        throw new Error(`Artwork upload failed: ${storageError.message}`);
      }

      setKindStatus(kind, "Saving artwork to this song...");

      const registerResponse = await fetch("/api/media/artwork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          projectId,
          mediaKind: kind,
          storagePath: uploadedStoragePath,
          originalFilename: file.name,
          mimeType,
          sizeBytes: file.size,
          width: dimensions.width,
          height: dimensions.height,
        }),
      });

      const registerData = await registerResponse.json();

      if (!registerResponse.ok) {
        await supabase.storage
          .from(uploadedBucket)
          .remove([uploadedStoragePath]);

        throw new Error(
          registerData.error || "Artwork uploaded but could not be saved."
        );
      }

      await loadAssets();
      setFiles((current) => ({ ...current, [kind]: null }));
      setKindStatus(kind, "✓ Artwork saved");

      window.setTimeout(() => setKindStatus(kind, ""), 2500);
    } catch (error) {
      setKindStatus(kind, "");
      setKindError(
        kind,
        error instanceof Error ? error.message : "Could not upload artwork."
      );
    } finally {
      setBusyKind(null);
    }
  }

  async function deleteArtwork(kind: ArtworkKind) {
    const asset = assets.find((item) => item.mediaKind === kind);

    if (!asset) return;

    const confirmed = window.confirm(
      `Delete ${kind === "thumbnail" ? "YouTube Thumbnail" : "Streaming Cover Artwork"}: ${asset.originalFilename}?`
    );

    if (!confirmed) return;

    try {
      setBusyKind(kind);
      setKindError(kind, "");
      setKindStatus(kind, "Deleting...");

      const response = await fetch("/api/media/artwork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          projectId,
          mediaKind: kind,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not delete artwork.");
      }

      setAssets((current) =>
        current.filter((item) => item.mediaKind !== kind)
      );
      setFiles((current) => ({ ...current, [kind]: null }));
      setKindStatus(kind, "");
    } catch (error) {
      setKindError(
        kind,
        error instanceof Error ? error.message : "Could not delete artwork."
      );
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <div className="mt-5 rounded-2xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-lg font-semibold text-white">Final Artwork</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Save the final publishing artwork separately from Image Studio drafts.
            These files will later feed directly into the Publishing Hub.
          </p>
        </div>

        {assets.length > 0 && (
          <span className="rounded-full bg-emerald-950 px-3 py-1 text-xs font-semibold text-emerald-300">
            {assets.length}/2 Saved
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-zinc-500">Loading saved artwork...</p>
      ) : (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {artworkConfigs.map((config) => {
            const asset = assets.find(
              (item) => item.mediaKind === config.kind
            );
            const selectedFile = files[config.kind];
            const error = errors[config.kind];
            const status = statuses[config.kind];
            const isBusy = busyKind === config.kind;
            const otherBusy = busyKind !== null && !isBusy;
            const width = asset?.metadata?.width;
            const height = asset?.metadata?.height;

            return (
              <div
                key={config.kind}
                className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-white">{config.title}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      {config.subtitle}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {config.recommendation}
                    </p>
                  </div>

                  {asset && (
                    <span className="shrink-0 rounded-full bg-emerald-950 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
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

                {asset && (
                  <div className="mt-4">
                    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
                      <img
                        key={asset.url}
                        src={asset.url}
                        alt={config.title}
                        className={`${config.aspectClass} w-full object-contain`}
                      />
                    </div>

                    <p className="mt-3 break-all text-sm font-medium text-zinc-200">
                      {asset.originalFilename}
                    </p>

                    <p className="mt-1 text-[11px] font-semibold text-cyan-300/80">
                      {asset.storageProvider === "local" ? "This Mac · local-media" : "Supabase Cloud"}
                    </p>

                    <p className="mt-1 text-xs text-zinc-500">
                      {width && height ? `${width}×${height}` : "Dimensions unavailable"}
                      {asset.sizeBytes ? ` · ${formatBytes(asset.sizeBytes)}` : ""}
                    </p>

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
                        onClick={() => deleteArtwork(config.kind)}
                        disabled={busyKind !== null}
                        className="rounded-xl border border-red-900/70 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-950/40 disabled:opacity-50"
                      >
                        {isBusy ? "Working..." : "Delete"}
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
                    {asset ? "Replace artwork" : "Upload artwork"}
                  </p>

                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    disabled={busyKind !== null}
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setFiles((current) => ({
                        ...current,
                        [config.kind]: file,
                      }));
                      setKindError(config.kind, "");
                      setKindStatus(config.kind, "");
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
                    onClick={() => uploadArtwork(config.kind)}
                    disabled={!selectedFile || isBusy || otherBusy}
                    className="mt-3 w-full rounded-xl bg-white px-4 py-2.5 text-xs font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy
                      ? "Saving..."
                      : asset
                        ? "Replace Artwork"
                        : "Upload Artwork"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
