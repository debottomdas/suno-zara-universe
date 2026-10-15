import { createHash } from 'node:crypto';
import { SECTIONS, STAGES, type ChannelDna, type Section, type Stage } from './model';
import { DnaError, UUID, validateDna, validateRevision } from './validation';
export const COMPILER_VERSION = 'channel-brand-context/1';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const relevant: Record<Stage, Section[]> = { music: ['core', 'musical'], visual: ['core', 'visual'], video: ['core', 'visual'], social: ['core', 'publishing'], publishing: ['core', 'publishing'] };
export function compileBrandContext(channelId: string, revision: number | null, document: ChannelDna | null, stage: Stage) {
  if (!UUID.test(channelId) || !STAGES.includes(stage)) throw new DnaError('Invalid compiler channel or stage.');
  if (document === null) {
    if (revision !== null) throw new DnaError('Missing document for revision.');
    return null; // Legacy means no injected context, including no fabricated defaults.
  }
  validateRevision(revision);
  const dna = validateDna(document);
  const structured = {
    channelId, revision, dnaHash: createHash('sha256').update(canonical(dna)).digest('hex'), compilerVersion: COMPILER_VERSION, stage,
    semantics: { required: 'Must satisfy.', preferred: 'Preference, not a hard constraint.', avoid: 'Must not include.', locked: 'Creator-controlled; conflicts must be surfaced, never overridden.' },
    sections: Object.fromEntries(relevant[stage].map(s => [s, Object.fromEntries(Object.entries(dna.sections[s].fields).filter(([, v]) => v !== ''))])),
    // Scope is explicit, independent of section. Never drop applicable locked rules.
    rules: SECTIONS.flatMap(section => dna.sections[section].rules.filter(r => r.stages.includes(stage)).map(r => ({ ...r, section, stages: [...r.stages].sort() }))).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    assets: ['visual', 'video'].includes(stage) ? [...dna.assets].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : [],
  };
  const prompt = canonical(structured);
  if (prompt.length > 100000) throw new DnaError('Compiled context exceeds its limit. Reduce the document; locked rules cannot be truncated.');
  return { structured, prompt };
}
