import { DirectorError, FIELDS, type Recipe } from './model';
import { freezeSnapshot } from './recipe';
export const SUNO_ADAPTER_VERSION = 'suno-style/2';
export function adaptSuno(recipe: Recipe) {
  const mandatory = recipe.input.dna.rules.filter(r => r.stages.includes('music') && (r.locked || r.strength === 'required' || r.strength === 'avoid'));
  const protectedText = mandatory.map(r => `${r.strength.toUpperCase()}${r.locked ? ' LOCKED' : ''} [${r.id}]: ${r.text}`).join('; ');
  // Never truncate rule IDs or hard constraints; compress soft fields by whole Unicode code points.
  if (protectedText.length > 900) throw new DirectorError('Required/locked/avoid constraints leave insufficient Suno space. Resolve constraints before adaptation.');
  const head = `${recipe.input.project.language} vocals. ${protectedText}${protectedText ? '. ' : ''}`;
  const full = FIELDS.map(f => `${f}: ${recipe.candidate.direction[f]}`);
  let prompt = head + full.join('; ');
  if (prompt.length > 1000) {
    const budget = 1000 - head.length - FIELDS.reduce((n, f) => n + f.length + 4, 0);
    const perField = Math.floor(budget / FIELDS.length);
    if (perField < 8) throw new DirectorError('Suno adaptation cannot preserve the musical fields within 1000 characters.');
    const clip = (text: string) => {
      let result = '';
      for (const point of text) { if (result.length + point.length > perField) break; result += point; }
      return result;
    };
    prompt = head + FIELDS.map(f => `${f}: ${clip(recipe.candidate.direction[f])}`).join('; ');
  }
  if (prompt.length > 1000) throw new DirectorError('Suno prompt exceeds 1000 characters.');
  return { provider: 'suno' as const, adapterVersion: SUNO_ADAPTER_VERSION, prompt, compressed: prompt !== head + full.join('; '), requiresMusicalReview: true as const };
}
export function attachSuno(recipe: Recipe) {
  const adaptation = adaptSuno(recipe);
  return { recipe: freezeSnapshot({ ...recipe, providerAdaptation: { provider: adaptation.provider, adapterVersion: adaptation.adapterVersion, prompt: adaptation.prompt } }), adaptation };
}
