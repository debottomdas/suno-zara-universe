import { FIELDS, type Direction, type Evidence, type Input, type MusicRule } from './model';

const normalize = (s: string) => s.normalize('NFC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
// This small literal grammar is deliberately not a semantic natural-language judge.
// Existing prose rules remain intact and require human review.
export function evaluateRule(rule: MusicRule, direction: Direction, overrideReason?: string): Evidence {
  const match = /^([a-zA-Z]+)\s+(includes|excludes|equals):\s*(.+)$/u.exec(rule.text);
  if (!match || !FIELDS.includes(match[1] as typeof FIELDS[number])) return { ruleId: rule.id, status: 'review', detail: 'Freeform rule: semantic compliance requires review; model claims are not proof.' };
  const actual = normalize(direction[match[1] as typeof FIELDS[number]]), expected = normalize(match[3]);
  const assertion = match[2] === 'equals' ? actual === expected : match[2] === 'includes' ? actual.includes(expected) : !actual.includes(expected);
  const satisfied = rule.strength === 'avoid' ? !assertion : assertion;
  if (satisfied) return { ruleId: rule.id, status: 'satisfied', detail: 'Literal field assertion passed; this does not certify wider musical semantics.' };
  if (rule.strength === 'preferred' && !rule.locked && overrideReason?.trim()) return { ruleId: rule.id, status: 'override', detail: overrideReason };
  return { ruleId: rule.id, status: 'conflict', detail: rule.locked ? 'Locked rule conflicts; cannot override.' : `${rule.strength} rule conflicts.` };
}
export function evaluateRules(input: Input, direction: Direction, overrides: Record<string, string> = {}) {
  return input.dna.rules.filter(r => r.stages.includes('music')).map(rule => evaluateRule(rule, direction, input.creatorInstruction.trim() ? overrides[rule.id] : undefined));
}
export function approvalReadiness(input: Input, evidence: Evidence[]) {
  const blockers = evidence.filter(e => {
    const rule = input.dna.rules.find(r => r.id === e.ruleId);
    return e.status === 'conflict' || e.status === 'review' && (rule?.locked || rule?.strength !== 'preferred');
  });
  return { rulesReady: blockers.length === 0, blockers, persistenceReady: false as const };
}
