"use client";
import { useState } from "react";

type ShortSlot = { slot: number; approvedVideo?: { filename?: string; originalFilename?: string } | null };
type Receipt = { slot: number; videoUrl: string; publicId?: string };

export default function LocalMediaPreparation({ projectId, channelId, releaseReady, shortSlots }: {
  projectId: string | null; channelId: string | null; releaseReady: boolean; shortSlots: ShortSlot[];
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const approved = shortSlots.filter(s => s.approvedVideo && Number.isInteger(s.slot) && s.slot >= 1 && s.slot <= 6).sort((a,b) => a.slot - b.slot);
  async function prepare() {
    if (!projectId || !channelId || !releaseReady || !approved.length || busy) return;
    if (!window.confirm(`Upload ${approved.length} approved Short(s) to Cloudinary? This will not schedule or publish anything.`)) return;
    setBusy(true); setError(""); setProgress(""); setReceipts([]);
    try {
      const results: Receipt[] = [];
      for (const item of approved) {
        setProgress(`Uploading approved Short ${item.slot} of ${approved.length}…`);
        const response = await fetch("/api/local-cloudinary/approved-short", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, channelId, slot: item.slot })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`Short ${item.slot}: ${data.error || "Upload failed"}`);
        results.push({ slot: item.slot, videoUrl: data.videoUrl, publicId: data.publicId });
        setReceipts([...results]);
      }
      setProgress(`${results.length} approved Short(s) uploaded. No posts scheduled or published.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Media preparation failed"); }
    finally { setBusy(false); }
  }
  return <section className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.04] p-4">
    <h3 className="text-sm font-bold text-cyan-100">Local publishing · Cloudinary media preparation</h3>
    <p className="mt-1 text-xs text-zinc-300">Prepare the approved Shorts directly from your Mac. No file picker, no manual URLs, no Buffer or YouTube publishing.</p>
    <p className="mt-2 text-xs text-zinc-400">{approved.length} approved Short(s) available in this release.</p>
    <button type="button" className="mt-2 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
      disabled={busy || !releaseReady || !projectId || !channelId || !approved.length}
      onClick={() => void prepare()}>{busy ? "Preparing media…" : "Prepare approved Shorts in Cloudinary"}</button>
    {!releaseReady && <p className="mt-1 text-xs text-amber-200">Finish release approval before preparing media.</p>}
    {progress && <p role="status" className="mt-2 text-xs text-cyan-200">{progress}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    {receipts.length > 0 && <div className="mt-2 text-xs text-zinc-300">
      {receipts.map(r => <p key={r.slot} className="mt-1 break-all">Short {r.slot} uploaded ✓ · <a href={r.videoUrl} target="_blank" rel="noreferrer" className="text-cyan-200 underline">View Cloudinary video</a></p>)}
    </div>}
    <p className="mt-2 text-[10px] text-zinc-500">Preparation only. Scheduling and publishing are not enabled by this action.</p>
  </section>;
}
