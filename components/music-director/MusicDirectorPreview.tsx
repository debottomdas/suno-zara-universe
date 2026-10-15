'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FIELDS, type Input, type Recipe } from '@/utils/music-director/model';
import { approvalReadiness } from '@/utils/music-director/rules';
import type { adaptSuno } from '@/utils/music-director/suno';
import styles from './MusicDirectorPreview.module.css';

type Result = { recipe: Recipe; adaptation: ReturnType<typeof adaptSuno> | null; adaptationError: string | null };
export default function MusicDirectorPreview({ projectId, channelId }: { projectId: string; channelId: string }) {
  return <ScopedPreview key={`${channelId}:${projectId}`} projectId={projectId} channelId={channelId} />;
}
function ScopedPreview({ projectId, channelId }: { projectId: string; channelId: string }) {
  const [input, setInput] = useState<Input | null>(null);
  const [note, setNote] = useState(''), [reviewed, setReviewed] = useState(false);
  const [results, setResults] = useState<Result[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const sequence = useRef(0), generation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); const request = ++sequence.current;
    fetch(`/api/music-director/preview?projectId=${encodeURIComponent(projectId)}&channelId=${encodeURIComponent(channelId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok) throw Error(data.error); return data; })
      .then(data => { if (!controller.signal.aborted && sequence.current === request) setInput(data.input); })
      .catch(e => { if (!controller.signal.aborted && sequence.current === request) setError(e.message); });
    return () => { controller.abort(); generation.current?.abort(); };
  }, [projectId, channelId]);
  async function generate() {
    if (!input || !reviewed || busy) return;
    const controller = new AbortController(); generation.current?.abort(); generation.current = controller;
    const request = ++sequence.current; setBusy(true); setError(''); setResults([]); setSelected(null);
    try {
      const response = await fetch('/api/music-director/preview', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, channelId, creatorInstruction: note, reviewedForPreview: true, sourceFingerprint: input.fingerprint }) });
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      if (sequence.current === request) setResults(data.recipes);
    } catch (e) {
      if (!controller.signal.aborted && sequence.current === request) setError(e instanceof Error ? e.message : 'Preview failed.');
    } finally { if (sequence.current === request) setBusy(false); }
  }
  return <main className={styles.page}>
    <Link href={`/music?channelId=${encodeURIComponent(channelId)}`}>Back to Music</Link>
    <h1>Music Director</h1>
    <p className={styles.notice}>Development preview · nothing is approved or saved. Database verification remains on hold.</p>
    {error && <p role="alert">{error}</p>}
    {!input && !error && <p>Loading this channel’s song inputs…</p>}
    {input && <>
      <h2>{input.project.title}</h2>
      <p>{input.project.language} · Channel DNA {input.dna.revision === null ? 'not configured; legacy song' : `revision ${input.dna.revision}`}</p>
      <details><summary>Inspect exact saved lyrics</summary><pre>{input.lyrics.text}</pre><p>Source: songs.lyrics. No separate approval snapshot exists yet.</p></details>
      <details><summary>Inspect existing Song Intelligence and Channel DNA</summary><pre>{JSON.stringify({ intelligence: input.intelligence, dna: input.dna.context }, null, 2)}</pre></details>
      <label className={styles.label}>Your music direction (optional)
        <textarea value={note} maxLength={2000} disabled={busy} onChange={e => { setNote(e.target.value); setResults([]); setSelected(null); }} placeholder="Faster, unplugged, Indian Bengali pronunciation, more rock…" />
      </label>
      <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} /> I reviewed these saved lyrics and inputs for this temporary preview.</label>
      <p><button disabled={!reviewed || busy} onClick={generate}>{busy ? 'Generating…' : results.length ? 'Regenerate three directions' : 'Generate three directions'}</button></p>
      <p>Generation uses the configured AI provider. Lyrics stay unchanged. Modify the music note and regenerate to explore another direction.</p>
      <div className={styles.grid}>{results.map(({ recipe, adaptation, adaptationError }) => {
        const ready = approvalReadiness(recipe.input, recipe.candidate.ruleEvidence);
        return <article className={styles.card} key={recipe.candidate.kind}>
          <h2>{recipe.candidate.kind}</h2>
          <dl>{FIELDS.map(field => <div key={field}><dt>{field}</dt><dd>{recipe.candidate.direction[field]}</dd></div>)}</dl>
          <h3>Why this works</h3><p>{recipe.candidate.explanation}</p>
          <h3>Your direction</h3><p>{recipe.candidate.creatorTreatment}</p>
          <h3>Channel rule checks</h3>
          {recipe.candidate.ruleEvidence.length ? <ul>{recipe.candidate.ruleEvidence.map(e => <li key={e.ruleId}>{e.ruleId}: {e.status} — {e.detail}</li>)}</ul> : <p>No music-stage rules configured.</p>}
          {!ready.rulesReady && <p>Required, locked or avoid rules need resolution/review before future approval.</p>}
          <details><summary>Inspect Suno adaptation</summary>{adaptation ? <><pre>{adaptation.prompt}</pre><p>{Array.from(adaptation.prompt).length}/1000 characters. {adaptation.compressed ? 'Compressed; review musical meaning.' : 'Review before using.'}</p></> : <p>{adaptationError}</p>}</details>
          <button onClick={() => setSelected(recipe.candidate.kind)}>{selected === recipe.candidate.kind ? 'Selected for comparison' : 'Choose for comparison'}</button>
          <Link href={`/music-release?projectId=${encodeURIComponent(projectId)}&channelId=${encodeURIComponent(channelId)}`} onClick={() => sessionStorage.setItem(`music-recipe:${channelId}:${projectId}`, JSON.stringify(recipe))}>Use in local Music release</Link>
          <button disabled title="Both database verification gates must pass before durable approval.">Approve recipe (database gated)</button>
          <details><summary>Inspect recipe provenance</summary><pre>{JSON.stringify(recipe, null, 2)}</pre></details>
        </article>;
      })}</div>
    </>}
  </main>;
}
