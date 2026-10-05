'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { emptyDna, FIELDS, LABELS, SECTIONS, STAGES, type AssetReference, type ChannelDna, type DnaVersion, type LockChange, type Rule, type Section, type Stage, type VisualIdentity, type VisualIdentityOverride } from '@/utils/channel-dna/model';
import { rulesOf, validateDna, validateLockChanges } from '@/utils/channel-dna/validation';
import s from './ChannelIdentityEditor.module.css';
type History = Pick<DnaVersion, 'revision' | 'created_at' | 'created_by' | 'change_note' | 'lock_changes'>;
type Loaded = { channel: { name: string; active_dna_revision: number | null }; version: DnaVersion | null; history: History[] };
const label = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/^./, x => x.toUpperCase());
// Created only by an explicit editor action; legacy loads never receive defaults.
function newVisualIdentity(): VisualIdentity {
  return {
    branding: { enabled: true, position: 'bottom-right', opacity: 0.65, size: 'medium', horizontalMargin: 60, verticalMargin: 60 },
    title: { enabled: true, showRomanTitle: true, position: 'centre', style: 'cinematic', durationSeconds: 5 },
    subtitles: { enabled: true, position: 'lower-middle', style: 'clean', size: 'medium', highlight: 'none' },
  };
}
const brandPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-centre', 'bottom-right'] as const;
const titlePositions = ['upper-centre', 'centre', 'lower-centre'] as const;
const subtitlePositions = ['centre', 'lower-middle', 'lower'] as const;
const sizes = ['small', 'medium', 'large'] as const;
const optionLabel = (value: string) => label(value.replace(/-/g, ' '));
export default function ChannelIdentityEditor({ channelId }: { channelId: string }) {
  const endpoint = `/api/channels/${encodeURIComponent(channelId)}/dna`;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [document, setDocument] = useState<ChannelDna>(emptyDna);
  const [section, setSection] = useState<Section>('core');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState<Stage>('music');
  const [preview, setPreview] = useState('');
  const [historical, setHistorical] = useState<DnaVersion | null>(null);
  const dirty = loaded !== null && (note !== '' || JSON.stringify(document) !== JSON.stringify(loaded.version?.document ?? emptyDna()));
  const requestId = useRef({ sequence: 0 });
  useEffect(() => {
    const controller = new AbortController();
    const requests = requestId.current;
    fetch(endpoint, { cache: 'no-store', signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!controller.signal.aborted) { setLoaded(data); setDocument(data.version?.document ?? emptyDna()); }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { controller.abort(); requests.sequence++; };
  }, [endpoint]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    // Capture anchors throughout the page, including the existing outer sidebar.
    // Do not patch Next's router/history or add synthetic history entries.
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
      const target = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (target.origin !== current.origin || (target.pathname === current.pathname && target.search === current.search)) return;
      if (!window.confirm('Discard unsaved DNA edits and leave this page?')) { event.preventDefault(); event.stopPropagation(); }
    };
    // History cancellation is capability-dependent. Non-cancelable traversals are
    // left alone: bouncing history with popstate would risk trapping the user.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const traverse = (event: Event) => {
      const nav = event as Event & { navigationType?: string; hashChange?: boolean };
      if (nav.navigationType === 'traverse' && !nav.hashChange && event.cancelable && !event.defaultPrevented
        && !window.confirm('Discard unsaved DNA edits and leave this page?')) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    window.document.addEventListener('click', click, true);
    navigation?.addEventListener('navigate', traverse);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.document.removeEventListener('click', click, true);
      navigation?.removeEventListener('navigate', traverse);
    };
  }, [dirty]);
  function edit(next: ChannelDna) { requestId.current.sequence++; setDocument(next); setPreview(''); setMessage(''); }
  const identity = document.sections.visual.identity;
  function editIdentity(value: VisualIdentity) {
    edit({ ...document, sections: { ...document.sections, visual: { ...document.sections.visual, identity: value } } });
  }
  function editOverride(layout: 'landscape' | 'portrait', group: keyof VisualIdentityOverride, key: string, value: string | number | undefined) {
    if (!identity) return;
    const override = { ...identity[layout] };
    const values: Record<string, string | number> = { ...override[group] };
    if (value === undefined) delete values[key]; else values[key] = value;
    if (Object.keys(values).length) override[group] = values; else delete override[group];
    const next = { ...identity };
    if (Object.keys(override).length) next[layout] = override; else delete next[layout];
    editIdentity(next);
  }
  function selectControl<T extends string>(name: string, value: T, options: readonly T[], change: (value: T) => void) {
    return <label>{name}<select value={value} onChange={event => change(event.target.value as T)}>{options.map(option => <option key={option} value={option}>{optionLabel(option)}</option>)}</select></label>;
  }
  function numberControl(name: string, value: number, max: number, change: (value: number) => void, min = 0, step: number | 'any' = 1) {
    return <label>{name}<input type="number" min={min} max={max} step={step} value={Number.isFinite(value) ? value : ''} onChange={event => change(event.target.valueAsNumber)} /></label>;
  }
  function flagControl(name: string, value: boolean, change: (value: boolean) => void) {
    return <label>{name}<input type="checkbox" checked={value} onChange={event => change(event.target.checked)} /></label>;
  }
  const previousRules = rulesOf(loaded?.version?.document ?? emptyDna());
  const changes: LockChange[] = rulesOf(document).filter(r => (previousRules.find(p => p.id === r.id)?.locked ?? false) !== r.locked).map(r => ({ id: r.id, locked: r.locked }));
  function updateRule(id: string, patch: Partial<Rule>) {
    edit({ ...document, sections: { ...document.sections, [section]: { ...document.sections[section], rules: document.sections[section].rules.map(r => r.id === id ? { ...r, ...patch } : r) } } });
  }
  async function save() {
    if (!loaded) return;
    requestId.current.sequence++; setPreview('');
    setBusy(true); setError(''); setMessage('');
    try {
      validateDna(document); validateLockChanges(loaded.version?.document ?? null, document, changes);
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document, expectedRevision: loaded.channel.active_dna_revision, lockChanges: changes, changeNote: note }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      // A completed save must not be retried if the following history refresh fails.
      const version: DnaVersion = { channel_id: channelId, revision: result.revision, schema_version: 1, document, created_by: '', created_at: '', change_note: note, lock_changes: changes };
      setLoaded({ ...loaded, channel: { ...loaded.channel, active_dna_revision: result.revision }, version });
      requestId.current.sequence++; setNote(''); setPreview('');
      setMessage(`Revision ${result.revision} saved and activated. Existing content is unchanged.`);
      try {
        const refreshed = await fetch(endpoint, { cache: 'no-store' });
        if (refreshed.ok) {
          const latest: Loaded = await refreshed.json();
          requestId.current.sequence++; setPreview('');
          setLoaded(latest); setDocument(latest.version?.document ?? emptyDna());
        }
      } catch { /* The save succeeded; the next reload can refresh history. */ }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); }
    finally { setBusy(false); }
  }
  async function showPreview() {
    const id = ++requestId.current.sequence; setError(''); setPreview('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document, stage }) });
      const result = await response.json();
      if (id !== requestId.current.sequence) return;
      if (!response.ok) throw new Error(result.error);
      setPreview(JSON.stringify(result.context, null, 2));
    } catch (e) { if (id === requestId.current.sequence) setError(e instanceof Error ? e.message : 'Preview failed.'); }
  }
  async function showHistory(revision: number) {
    const id = ++requestId.current.sequence; setHistorical(null); setError('');
    try {
      const response = await fetch(`${endpoint}?revision=${revision}`, { cache: 'no-store' });
      const result = await response.json();
      if (id !== requestId.current.sequence) return;
      if (!response.ok) throw new Error(result.error);
      setHistorical(result.version);
    } catch (e) { if (id === requestId.current.sequence) setError(e instanceof Error ? e.message : 'History failed.'); }
  }
  return <main className={s.page}>
    <Link href={`/music-next?channelId=${encodeURIComponent(channelId)}`}>← Back to channel</Link>
    <header><p className={s.eyebrow}>CHANNEL SETTINGS · FOUNDATION PREVIEW</p><h1>Identity &amp; Brand</h1><p>{loaded?.channel.name ?? 'Loading channel…'}</p></header>
    <p className={s.notice}>Define your channel’s identity. This foundation stores and previews DNA; it does not yet influence generation or publishing, or change existing content.</p>
    {error && <p role="alert" className={s.error}>{error}</p>}
    {message && <p role="status" className={s.notice}>{message}</p>}
    {!loaded ? <button type="button" onClick={() => window.location.reload()}>Retry loading</button> : <>
      <div className={s.bar}><span>{loaded.channel.active_dna_revision === null ? 'No saved DNA — existing behavior is unchanged' : `Active revision ${loaded.channel.active_dna_revision}`} · Schema 1{dirty ? ' · Unsaved changes' : ''}</span><button type="button" disabled={busy} onClick={() => window.location.reload()}>Reload latest</button></div>
      <nav className={s.tabs} aria-label="Identity sections">{SECTIONS.map(key => <button type="button" key={key} aria-current={section === key ? 'page' : undefined} onClick={() => setSection(key)}>{LABELS[key]}</button>)}</nav>
      <fieldset disabled={busy} className={s.panel}><legend>{LABELS[section]}</legend>
        <p>These notes are editable defaults. Put requirements you want protected into locked rules below.</p>
        {section === 'publishing' && <p>Templates support {'{title}, {channelName}, {language}, {credits}'}. Lists and HTTPS links use one item per line. Templates are stored only.</p>}
        <div className={s.fields}>{FIELDS[section].map(field => <label key={`${section}-${field}`}>{label(field)}<textarea maxLength={2000} rows={3} value={(document.sections[section].fields as Record<string, string>)[field]||''} onChange={event => edit({ ...document, sections: { ...document.sections, [section]: { ...document.sections[section], fields: { ...document.sections[section].fields, [field]: event.target.value } } } })} /></label>)}</div>
        {section === 'visual' && <div className={s.rule}>
          <h2>Visual Identity</h2>
          <p><small>Visual Identity layout controls are being prepared for the V5.29 renderer.</small></p>
          {!identity ? <button type="button" onClick={() => editIdentity(newVisualIdentity())}>Configure Visual Identity</button> : <>
            <fieldset><legend>Branding</legend><div className={s.fields}>
              {flagControl('Enabled', identity.branding.enabled, enabled => editIdentity({ ...identity, branding: { ...identity.branding, enabled } }))}
              {selectControl('Branding position', identity.branding.position, brandPositions, position => editIdentity({ ...identity, branding: { ...identity.branding, position } }))}
              {numberControl('Opacity (%)', identity.branding.opacity * 100, 100, percent => editIdentity({ ...identity, branding: { ...identity.branding, opacity: percent / 100 } }), 0, 0.1)}
              {selectControl('Branding size', identity.branding.size, sizes, size => editIdentity({ ...identity, branding: { ...identity.branding, size } }))}
              {numberControl('Horizontal margin', identity.branding.horizontalMargin, 500, horizontalMargin => editIdentity({ ...identity, branding: { ...identity.branding, horizontalMargin } }), 0, 'any')}
              {numberControl('Vertical margin', identity.branding.verticalMargin, 500, verticalMargin => editIdentity({ ...identity, branding: { ...identity.branding, verticalMargin } }), 0, 'any')}
            </div></fieldset>
            <fieldset><legend>Song title</legend><div className={s.fields}>
              {flagControl('Show title', identity.title.enabled, enabled => editIdentity({ ...identity, title: { ...identity.title, enabled } }))}
              {flagControl('Show Roman title', identity.title.showRomanTitle, showRomanTitle => editIdentity({ ...identity, title: { ...identity.title, showRomanTitle } }))}
              {selectControl('Title position', identity.title.position, titlePositions, position => editIdentity({ ...identity, title: { ...identity.title, position } }))}
              {selectControl('Title style', identity.title.style, ['clean', 'cinematic', 'minimal'], style => editIdentity({ ...identity, title: { ...identity.title, style } }))}
              {numberControl('Duration (seconds)', identity.title.durationSeconds, 30, durationSeconds => editIdentity({ ...identity, title: { ...identity.title, durationSeconds } }), 0.01, 'any')}
            </div></fieldset>
            <fieldset><legend>Subtitles</legend><div className={s.fields}>
              {flagControl('Show subtitles', identity.subtitles.enabled, enabled => editIdentity({ ...identity, subtitles: { ...identity.subtitles, enabled } }))}
              {selectControl('Subtitle position', identity.subtitles.position, subtitlePositions, position => editIdentity({ ...identity, subtitles: { ...identity.subtitles, position } }))}
              {selectControl('Subtitle style', identity.subtitles.style, ['clean', 'backed', 'cinematic'], style => editIdentity({ ...identity, subtitles: { ...identity.subtitles, style } }))}
              {selectControl('Subtitle size', identity.subtitles.size, sizes, size => editIdentity({ ...identity, subtitles: { ...identity.subtitles, size } }))}
              {selectControl('Highlight', identity.subtitles.highlight, ['none', 'current-phrase'], highlight => editIdentity({ ...identity, subtitles: { ...identity.subtitles, highlight } }))}
            </div></fieldset>
            <h3>Layout overrides</h3>
            {(['landscape', 'portrait'] as const).map(layout => <details key={layout}>
              <summary>{layout === 'landscape' ? 'Landscape 16:9' : 'Portrait 9:16'}</summary>
              <div className={s.fields}>
                {(['branding', 'title', 'subtitles'] as const).map(group => {
                  const options = group === 'branding' ? brandPositions : group === 'title' ? titlePositions : subtitlePositions;
                  return <label key={group}>{group === 'branding' ? 'Brand' : group === 'title' ? 'Title' : 'Subtitle'} position<select aria-label={`${optionLabel(layout)} ${group} position`} value={identity[layout]?.[group]?.position ?? ''} onChange={event => editOverride(layout, group, 'position', event.target.value || undefined)}>
                    <option value="">Use default</option>{options.map(value => <option key={value} value={value}>{optionLabel(value)}</option>)}
                  </select></label>;
                })}
                {(['horizontalMargin', 'verticalMargin'] as const).map(key => <label key={key}>Brand {key === 'horizontalMargin' ? 'horizontal' : 'vertical'} margin<input aria-label={`${optionLabel(layout)} ${label(key)}`} type="number" min={0} max={500} step="any" placeholder="Use default" value={identity[layout]?.branding?.[key] ?? ''} onChange={event => editOverride(layout, 'branding', key, event.target.value === '' ? undefined : event.target.valueAsNumber)} />
                  <button type="button" onClick={() => editOverride(layout, 'branding', key, undefined)}>Use default</button>
                </label>)}
              </div>
            </details>)}
          </>}
        </div>}
        <h2>Creator rules</h2><p>Required = must satisfy. Preferred = a preference. Avoid = must not include. Save an unlock before editing or removing a previously locked rule.</p>
        {document.sections[section].rules.map(rule => {
          const protectedRule = rule.locked || previousRules.some(r => r.id === rule.id && r.locked);
          return <article className={s.rule} key={rule.id}>
            <div className={s.bar}><code>{rule.id}</code><button type="button" onClick={() => updateRule(rule.id, { locked: !rule.locked })}>{rule.locked ? 'Unlock rule' : 'Lock rule'}</button></div>
            {changes.some(c => c.id === rule.id) && <p role="status">{rule.locked ? 'Lock' : 'Unlock'} pending — save to apply.</p>}
            <label>Rule text<textarea rows={3} maxLength={2000} disabled={protectedRule} value={rule.text} onChange={event => updateRule(rule.id, { text: event.target.value })} /></label>
            <label>Strength<select disabled={protectedRule} value={rule.strength} onChange={event => updateRule(rule.id, { strength: event.target.value as Rule['strength'] })}><option value="required">Required</option><option value="preferred">Preferred</option><option value="avoid">Avoid</option></select></label>
            <fieldset disabled={protectedRule}><legend>Applies to stages</legend><div className={s.stages}>{STAGES.map(item => <label key={item}><input type="checkbox" checked={rule.stages.includes(item)} onChange={event => updateRule(rule.id, { stages: event.target.checked ? [...rule.stages, item] : rule.stages.filter(x => x !== item) })} />{label(item)}</label>)}</div></fieldset>
            <button type="button" disabled={protectedRule} onClick={() => edit({ ...document, sections: { ...document.sections, [section]: { ...document.sections[section], rules: document.sections[section].rules.filter(r => r.id !== rule.id) } } })}>Remove rule</button>
          </article>;
        })}
        <button type="button" disabled={document.sections[section].rules.length >= 40} onClick={() => edit({ ...document, sections: { ...document.sections, [section]: { ...document.sections[section], rules: [...document.sections[section].rules, { id: crypto.randomUUID(), text: '', strength: 'preferred', locked: false, stages: [...STAGES] }] } } })}>+ Add rule</button>
        {section === 'visual' && <div><h2>Brand asset references</h2><p>Reference existing media owned by this channel using its media ID and expected SHA-256. No uploads or asset rendering in this stage. Future consumers must verify the bytes against the hash.</p>
          {document.assets.map((asset, index) => <div className={s.rule} key={asset.id}>{(['mediaAssetId', 'expectedSha256'] as const).map(field => <label key={field}>{label(field)}<input value={asset[field]} onChange={event => edit({ ...document, assets: document.assets.map((a, i) => i === index ? { ...a, [field]: event.target.value } : a) })} /></label>)}<label>Role<select value={asset.role} onChange={event => edit({ ...document, assets: document.assets.map((a, i) => i === index ? { ...a, role: event.target.value as AssetReference['role'] } : a) })}>{['logo', 'font', 'watermark', 'intro', 'outro', 'reference'].map(role => <option key={role}>{role}</option>)}</select></label><button type="button" onClick={() => edit({ ...document, assets: document.assets.filter((_, i) => i !== index) })}>Remove reference</button></div>)}
          <button type="button" disabled={document.assets.length >= 20} onClick={() => edit({ ...document, assets: [...document.assets, { id: crypto.randomUUID(), mediaAssetId: '', role: 'logo', expectedSha256: '' }] })}>+ Add asset reference</button>
        </div>}
      </fieldset>
      <section className={s.panel}><h2>Save a new revision</h2><label>Change note<input maxLength={500} disabled={busy} value={note} onChange={event => setNote(event.target.value)} /></label><p>{changes.length} explicit lock change(s). Saving also activates the new revision.</p><button type="button" disabled={busy || (!dirty && loaded.channel.active_dna_revision !== null)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save & activate DNA'}</button></section>
      <section className={s.panel}><h2>Compiled context preview</h2><p>Draft preview for the proposed next revision. Nothing is generated or saved.</p><label>Stage<select value={stage} onChange={event => { requestId.current.sequence++; setStage(event.target.value as Stage); setPreview(''); }}>{STAGES.map(item => <option key={item}>{item}</option>)}</select></label><button type="button" disabled={busy} onClick={() => void showPreview()}>Compile draft preview</button>{preview && <pre tabIndex={0}>{preview}</pre>}</section>
      <section className={s.panel}><h2>Revision history</h2><p>Latest 50 revisions, read-only. Earlier revisions remain addressable through the API.</p><ul>{loaded.history.map(item => <li key={item.revision}><button type="button" onClick={() => void showHistory(item.revision)}>View revision {item.revision}</button> {item.created_at} — {item.change_note || 'No change note'} · {item.lock_changes.length} lock change(s)</li>)}</ul>{historical && <><h3>Revision {historical.revision} — read-only</h3><pre tabIndex={0}>{JSON.stringify(historical, null, 2)}</pre></>}</section>
    </>}
  </main>;
}
