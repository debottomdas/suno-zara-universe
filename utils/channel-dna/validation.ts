import { FIELDS, OPTIONAL_PUBLISHING_FIELDS, SECTIONS, STAGES, type ChannelDna, type LockChange, type Rule } from './model';
export class DnaError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_REVISION = 2147483647;
export function validateRevision(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_REVISION) throw new DnaError('Revision must be a PostgreSQL integer between 1 and 2147483647.');
}
export function nextRevision(value: number | null): number {
  if (value !== null) validateRevision(value);
  if (value === MAX_REVISION) throw new DnaError('Channel DNA has reached its final revision; no further revisions can be saved.', 409);
  return (value ?? 0) + 1;
}
export function hasUnpairedSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DnaError('Expected an object.');
  return v as Record<string, unknown>;
}
function exact(v: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new DnaError(`Expected fields: ${keys.join(', ')}.`);
}
function text(v: unknown, limit = 2000): asserts v is string {
  if (typeof v === 'string' && hasUnpairedSurrogate(v)) throw new DnaError('Text contains an unpaired Unicode surrogate.');
  if (typeof v !== 'string' || v.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new DnaError(`Text must contain at most ${limit} characters and no control characters.`);
}
export function rulesOf(doc: ChannelDna): Rule[] { return SECTIONS.flatMap(s => doc.sections[s].rules); }
export function validateDna(value: unknown): ChannelDna {
  const d = object(value); exact(d, ['schemaVersion', 'sections', 'assets']);
  if (d.schemaVersion !== 1) throw new DnaError('Unsupported DNA schema version.');
  if (JSON.stringify(d).length > 100000) throw new DnaError('DNA exceeds the 100,000 character limit.');
  const sections = object(d.sections); exact(sections, SECTIONS);
  const ids = new Set<string>();
  for (const section of SECTIONS) {
    const s = object(sections[section]); exact(s, ['fields', 'rules']);
    const fields = object(s.fields);
    if(section==='publishing'){const required=FIELDS.publishing.filter(k=>!(OPTIONAL_PUBLISHING_FIELDS as readonly string[]).includes(k));if(required.some(k=>!Object.hasOwn(fields,k))||Object.keys(fields).some(k=>!(FIELDS.publishing as readonly string[]).includes(k)))throw new DnaError('Invalid publishing fields.');}
    else exact(fields, FIELDS[section]);
    for (const value of Object.values(fields)) text(value);
    if (!Array.isArray(s.rules) || s.rules.length > 40) throw new DnaError('Each section supports up to 40 rules.');
    for (const raw of s.rules) {
      const r = object(raw); exact(r, ['id', 'text', 'strength', 'locked', 'stages']);
      if (typeof r.id !== 'string' || !ID.test(r.id) || ids.has(r.id)) throw new DnaError('Rule IDs must be valid and unique across sections.');
      ids.add(r.id); text(r.text);
      if (!r.text.trim()) throw new DnaError('Rule text is required.');
      if ((typeof r.strength !== 'string' || !['required', 'preferred', 'avoid'].includes(r.strength)) || typeof r.locked !== 'boolean') throw new DnaError('Invalid rule strength or lock.');
      if (!Array.isArray(r.stages) || !r.stages.length || new Set(r.stages).size !== r.stages.length || r.stages.some(x => !STAGES.includes(x))) throw new DnaError('Select at least one valid, unique stage for each rule.');
    }
  }
  if (!Array.isArray(d.assets) || d.assets.length > 20) throw new DnaError('Up to 20 asset references are allowed.');
  const assetIds = new Set<string>();
  for (const raw of d.assets) {
    const a = object(raw); exact(a, ['id', 'mediaAssetId', 'role', 'expectedSha256']);
    if (typeof a.id !== 'string' || !ID.test(a.id) || assetIds.has(a.id)) throw new DnaError('Asset IDs must be valid and unique.');
    assetIds.add(a.id);
    if (typeof a.mediaAssetId !== 'string' || !UUID.test(a.mediaAssetId) || typeof a.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.expectedSha256)) throw new DnaError('Asset references require a media UUID and lowercase SHA-256.');
    if ((typeof a.role !== 'string' || !['logo', 'font', 'watermark', 'intro', 'outro', 'reference'].includes(a.role))) throw new DnaError('Invalid asset role.');
  }
  const pub = object(object(sections.publishing).fields);
  for (const key of ['titleTemplate', 'descriptionTemplate', 'shortTitleTemplate', 'shortDescriptionTemplate']) {
    const template = (pub[key]||'') as string;
    if (template.replace(/\{(?:title|englishTitle|channelName|language|credits|songDescription|lyrics|hook|shortNumber)\}/g, '').match(/[{}]/)) throw new DnaError('Template tokens: {title}, {englishTitle}, {channelName}, {language}, {credits}, {songDescription}, {lyrics}, {hook}, {shortNumber}.');
  }
  if(pub.privacyStatus&&!['private','unlisted','public'].includes(String(pub.privacyStatus)))throw new DnaError('Choose private, unlisted or public visibility.');
  if(pub.relatedVideoPolicy&&!['required-studio','optional-studio','none'].includes(String(pub.relatedVideoPolicy)))throw new DnaError('Related Video policy: required-studio, optional-studio or none.');
  for(const key of ['defaultPlaylistIds','shortPlaylistIds'])for(const id of String(pub[key]||'').split(/[\s,]+/u).filter(Boolean))if(!/^[A-Za-z0-9_-]{10,100}$/.test(id))throw new DnaError('Playlist rules must contain YouTube playlist IDs.');
  for (const link of (pub.links as string).split('\n').filter(Boolean)) {
    let url: URL; try { url = new URL(link); } catch { throw new DnaError('Publishing links must be HTTPS URLs, one per line.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new DnaError('Publishing links must be HTTPS without credentials.');
  }
  return JSON.parse(JSON.stringify(d)) as ChannelDna;
}
export function validateSave(value: unknown) {
  const b = object(value); exact(b, ['document', 'expectedRevision', 'lockChanges', 'changeNote']);
  if (b.expectedRevision !== null) validateRevision(b.expectedRevision);
  nextRevision(b.expectedRevision as number | null);
  text(b.changeNote, 500);
  if (!Array.isArray(b.lockChanges) || b.lockChanges.length > 160) throw new DnaError('Invalid lock changes.');
  const ids = new Set<string>();
  for (const raw of b.lockChanges) {
    const c = object(raw); exact(c, ['id', 'locked']);
    if (typeof c.id !== 'string' || !ID.test(c.id) || ids.has(c.id) || typeof c.locked !== 'boolean') throw new DnaError('Invalid or duplicate lock change.');
    ids.add(c.id);
  }
  return { document: validateDna(b.document), expectedRevision: b.expectedRevision as number | null, lockChanges: b.lockChanges as LockChange[], changeNote: b.changeNote };
}
export function validateLockChanges(previous: ChannelDna | null, next: ChannelDna, changes: LockChange[]) {
  const before = new Map((previous ? rulesOf(previous) : []).map(r => [r.id, r]));
  const after = new Map(rulesOf(next).map(r => [r.id, r]));
  const explicit = new Map(changes.map(c => [c.id, c.locked]));
  for (const [id, old] of before) {
    const rule = after.get(id);
    // Unlock must be saved as its own revision before text/scope/strength/section edits or deletion.
    if (old.locked) {
      const oldSection = SECTIONS.find(s => previous!.sections[s].rules.some(r => r.id === id));
      const newSection = SECTIONS.find(s => next.sections[s].rules.some(r => r.id === id));
      if (!rule || oldSection !== newSection || old.text !== rule.text || old.strength !== rule.strength || old.stages.join() !== rule.stages.join()) throw new DnaError(`Save an explicit unlock of rule ${id} before editing or removing it.`, 409);
    }
  }
  for (const [id, rule] of after) {
    if ((before.get(id)?.locked ?? false) !== rule.locked && explicit.get(id) !== rule.locked) throw new DnaError(`Explicit lock change required for ${id}.`);
  }
  for (const [id, locked] of explicit) {
    if (!after.has(id) || after.get(id)!.locked !== locked || (before.get(id)?.locked ?? false) === locked) throw new DnaError(`Stale or unnecessary lock change for ${id}.`);
  }
}
