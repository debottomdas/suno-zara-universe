import { DirectorError, DIRECTOR_VERSION, FIELDS, KINDS, type Candidate, type Input, type Recipe } from './model';
import { evaluateRules } from './rules';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DirectorError('Invalid Music Director response.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new DirectorError('Missing or oversized Music Director field.');
  return value;
}
export function validateCandidates(input: Input, raw: unknown): Candidate[] {
  if (!Array.isArray(raw) || raw.length !== 3) throw new DirectorError('Music Director must return exactly three directions.');
  const seen = new Set<string>();
  const candidates = raw.map(value => {
    const row = object(value), kind = text(row.kind, 20);
    if (!KINDS.includes(kind as Candidate['kind']) || seen.has(kind)) throw new DirectorError('Signature, Alternative and Experimental must each appear once.');
    seen.add(kind);
    const source = object(row.direction);
    if (Object.keys(source).length !== FIELDS.length || Object.keys(source).some(k => !FIELDS.includes(k as typeof FIELDS[number]))) throw new DirectorError('Invalid structured direction fields.');
    const direction = Object.fromEntries(FIELDS.map(f => [f, text(source[f], 1000)])) as Candidate['direction'];
    const overrides = row.preferredOverrides === undefined ? {} : object(row.preferredOverrides);
    for (const [id, reason] of Object.entries(overrides)) {
      const rule = input.dna.rules.find(r => r.id === id);
      if (!rule || rule.locked || rule.strength !== 'preferred' || !input.creatorInstruction.trim()) throw new DirectorError('Invalid preferred-rule override.');
      text(reason, 1000);
    }
    const ruleEvidence = evaluateRules(input, direction, overrides as Record<string, string>);
    if (ruleEvidence.some(e => e.status === 'conflict' && input.dna.rules.some(r => r.id === e.ruleId && (r.locked || r.strength !== 'preferred')))) throw new DirectorError('Generated direction contradicts a required, avoid or locked rule.');
    return { kind: kind as Candidate['kind'], direction, explanation: text(row.explanation, 4000), creatorTreatment: text(row.creatorTreatment, 2000), ruleEvidence };
  });
  // Require changes across at least three independent musical axes, beyond labels/prose.
  const axes = ['genre', 'tempo', 'groove', 'instrumentation', 'arrangementArc', 'productionTexture'] as const;
  const normalize = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
  for (let a = 0; a < candidates.length; a++) for (let b = a + 1; b < candidates.length; b++) {
    if (axes.filter(f => normalize(candidates[a].direction[f]) !== normalize(candidates[b].direction[f])).length < 3) throw new DirectorError('Directions are insufficiently distinct across musical axes.');
  }
  return KINDS.map(kind => candidates.find(c => c.kind === kind)!);
}
export function freezeSnapshot<T>(snapshot: T): T {
  const copy = structuredClone(snapshot);
  function freeze(value: unknown) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  }
  freeze(copy);
  return copy;
}
export function createRecipe(input: Input, candidate: Candidate, generator = { provider: 'fixture', model: 'local-test' }): Recipe {
  return freezeSnapshot({ schemaVersion: 1 as const, state: 'development-preview' as const, persisted: false as const, input, candidate, directorVersion: DIRECTOR_VERSION, generator, approval: null, providerAdaptation: null });
}
export function approveRecipe(): never {
  throw new DirectorError('Durable approval is unavailable until the frozen database migration passes both verification gates.', 503);
}
