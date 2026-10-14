'use client';
import { useEffect, useState } from 'react';

type Destination = { id: string; name: string; displayName?: string | null; service: string };
export default function LocalBufferDrafts({ channelId }: { channelId: string }) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [destinationId, setDestinationId] = useState('');
  const [text, setText] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setDestinations([]); setDestinationId(''); setText(''); setVideoUrl(''); setResult(''); setError('');
    fetch(`/api/local-buffer/verify?channelId=${encodeURIComponent(channelId)}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (active && data?.status === 'verified') setDestinations(data.channels || []); })
      .catch(() => {});
    return () => { active = false; };
  }, [channelId]);
  async function saveDraft() {
    if (!destinationId || !text.trim() || busy) return;
    const target = destinations.find(d => d.id === destinationId);
    if ((target?.service === 'instagram' || target?.service === 'tiktok') && !videoUrl.trim()) { setError('Instagram and TikTok require a public HTTPS video URL.'); return; }
    if (!target || !window.confirm(`Save a PRIVATE Buffer draft for ${target.displayName || target.name} (${target.service})? Nothing will be scheduled or published.`)) return;
    setBusy(true); setError(''); setResult('');
    try {
      const response = await fetch('/api/local-buffer/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, bufferChannelId: destinationId, text, videoUrl: videoUrl.trim() || undefined })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Draft creation failed');
      setResult(`Draft saved in Buffer for ${data.destination.name}. Draft ID: ${data.draftId}. Nothing published.`);
      setText(''); setVideoUrl('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Draft creation failed'); }
    finally { setBusy(false); }
  }
  if (!destinations.length) return null;
  return <section style={{ marginTop: 16, borderTop: '1px solid #64748b', paddingTop: 12 }}>
    <b>Buffer draft test — private only</b>
    <p>Choose one verified social destination. This creates a draft inside Buffer; it does not schedule or publish.</p>
    <select aria-label="Buffer social destination" value={destinationId} onChange={e => setDestinationId(e.target.value)} style={{ width: '100%', padding: 8 }}>
      <option value="">Select a destination</option>
      {destinations.map(d => <option key={d.id} value={d.id}>{d.service}: {d.displayName || d.name}</option>)}
    </select>
    <textarea aria-label="Buffer draft text" placeholder="Enter test draft text (not published)" rows={3} value={text} onChange={e => setText(e.target.value)} style={{ width: '100%', marginTop: 8, padding: 8 }} />
    <input aria-label="Public HTTPS video URL" placeholder="Public HTTPS video URL (required for Instagram/TikTok)" value={videoUrl} onChange={e => setVideoUrl(e.target.value)} style={{ width: "100%", padding: 8, marginBottom: 8 }} />
    <button type="button" disabled={busy || !destinationId || !text.trim()} onClick={() => void saveDraft()}>{busy ? 'Saving draft…' : 'Review & save private Buffer draft'}</button>
    {result && <p role="status">{result}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
