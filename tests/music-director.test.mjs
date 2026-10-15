import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const native = createRequire(import.meta.url), cache = new Map();
function load(file) {
  file = path.resolve(file); if (cache.has(file)) return cache.get(file);
  const ctx = { exports: {}, structuredClone, Buffer, URL, Request, Response, TextDecoder, console, require(name) {
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts');
    return native(name);
  } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  cache.set(file, ctx.exports); return ctx.exports;
}
const model = load('utils/music-director/model.ts'), dna = load('utils/channel-dna/model.ts');
const { compileInput } = load('utils/music-director/input.ts');
const { evaluateRules, approvalReadiness } = load('utils/music-director/rules.ts');
const { validateCandidates, createRecipe, approveRecipe } = load('utils/music-director/recipe.ts');
const { adaptSuno, attachSuno } = load('utils/music-director/suno.ts');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', S = '33333333-3333-4333-8333-333333333333';
function source(extra = {}) { return { song: { id: S, channel_id: A, title: 'Window', language: 'Bengali', lyrics: '  [Verse]\nআমার গান\nगीत\nHello 👩🏽‍🎤\n  ' }, channelId: A, revision: null, document: null, intelligence: { emotionalCore: 'Hope through loss', arc: 'Quiet verse to hopeful chorus' }, intelligenceUpdatedAt: '2026-10-03T12:00:00Z', ...extra }; }
function rows() { return model.KINDS.map((kind, i) => ({ kind, direction: Object.fromEntries(model.FIELDS.map(f => [f, `${['Acoustic folk', 'Rock band', 'Electronic chamber'][i]} ${f}`])), explanation: `Window: hopeful chorus ${i}; intimate lyrics, loss-to-hope intelligence, distinct musical approach.`, creatorTreatment: 'No additional creator instruction.', preferredOverrides: {} })); }
function withRules(rules) { const d = dna.emptyDna(); d.sections.musical.rules = rules; return compileInput(source({ document: d, revision: 5 })); }
const rule = (extra = {}) => ({ id: 'guitar', text: 'instrumentation includes: acoustic guitar', strength: 'required', locked: false, stages: ['music'], ...extra });
test('canonical input is deterministic and preserves exact lyrics without modifying source', () => {
  const original = source(), before = JSON.stringify(original), input = compileInput(original);
  assert.equal(input.fingerprint, compileInput(source()).fingerprint); assert.equal(input.lyrics.text, original.song.lyrics); assert.equal(JSON.stringify(original), before); assert.equal(input.lyrics.approvalId, null); assert.equal(input.lyrics.source, 'songs.lyrics');
});
for (const [language, lyrics] of [['Bengali', '  আমার গান\nকলকাতা  '], ['Hindi', ' मेरा गीत\nआशा '], ['English', ' My song\nHope 👩🏽‍🎤 ']]) test(`${language} lyrics remain exact through recipe and Suno adapter`, () => {
  const s = source(); Object.assign(s.song, { language, lyrics }); const input = compileInput(s), recipe = createRecipe(input, validateCandidates(input, rows())[0]);
  const attached = attachSuno(recipe); assert.equal(attached.recipe.input.lyrics.text, lyrics); assert.ok(attached.adaptation.prompt.startsWith(language)); assert.equal(attached.recipe.providerAdaptation.prompt, attached.adaptation.prompt);
});
for (const note of ['faster', 'unplugged', 'Indian Bengali pronunciation', 'more rock']) test(`creator instruction ${note} affects provenance, never lyrics`, () => {
  const normal = compileInput(source()), input = compileInput(source({ creatorInstruction: note }));
  assert.equal(input.lyrics.hash, normal.lyrics.hash); assert.equal(input.lyrics.text, normal.lyrics.text); assert.notEqual(input.fingerprint, normal.fingerprint); assert.equal(input.creatorInstruction, note);
});
test('legacy projects without DNA or creator note inject no fabricated defaults', () => { const input = compileInput(source()); assert.equal(input.dna.context, null); assert.equal(input.dna.revision, null); assert.equal(input.creatorInstruction, ''); assert.equal(input.dna.rules.length, 0); });
test('missing lyrics and absent/backfilled intelligence block without manufacturing intelligence', () => {
  for (const change of [{ intelligence: null }, { intelligence: { migrationSource: 'existing-prepared-assets' } }, { intelligenceUpdatedAt: null }, { creatorInstruction: 'x'.repeat(2001) }]) assert.throws(() => compileInput(source(change)));
  const s = source(); s.song.lyrics = ' '; assert.throws(() => compileInput(s));
});
test('channel mismatch and malformed song IDs are rejected', () => { assert.throws(() => compileInput(source({ channelId: B }))); const s = source(); s.song.id = 'bad'; assert.throws(() => compileInput(s)); });
test('DNA revision, lyrics and intelligence changes invalidate fingerprints', () => {
  const a = compileInput(source());
  for (const mutate of [s => s.song.lyrics += '!', s => s.intelligence.emotionalCore = 'Joy', s => s.intelligenceUpdatedAt = 'later', s => { s.document = dna.emptyDna(); s.revision = 1; }]) { const s = source(); mutate(s); assert.notEqual(compileInput(s).fingerprint, a.fingerprint); }
});
test('music stage rules use stable IDs and include rules from other DNA sections', () => {
  const d = dna.emptyDna(); d.sections.visual.rules = [rule({ id: 'visual-music', stages: ['music'] }), rule({ id: 'visual-only', stages: ['visual'] })];
  const input = compileInput(source({ document: d, revision: 5 })); assert.deepEqual(Array.from(input.dna.rules, r => r.id), ['visual-music']);
});
test('required literal match passes and conflict rejects candidate batch', () => {
  const input = withRules([rule()]), r = rows(); r.forEach(c => c.direction.instrumentation += ' acoustic guitar');
  assert.equal(validateCandidates(input, r)[0].ruleEvidence[0].status, 'satisfied'); r[0].direction.instrumentation = 'piano'; assert.throws(() => validateCandidates(input, r), /contradicts/);
});
test('avoid is checked explicitly and hard conflicts cannot be bypassed by explanation', () => {
  const input = withRules([rule({ strength: 'avoid' })]), r = rows(); assert.equal(validateCandidates(input, r)[0].ruleEvidence[0].status, 'satisfied');
  r[0].direction.instrumentation = 'acoustic guitar'; r[0].explanation = 'Trust me; fully compliant'; assert.throws(() => validateCandidates(input, r));
});
test('locked preferred rules cannot be overridden', () => { const input = withRules([rule({ strength: 'preferred', locked: true })]); assert.throws(() => validateCandidates(input, rows()), /contradicts/); });
test('preferred override requires a creator instruction and explicit stable-ID reason', () => {
  const base = withRules([rule({ strength: 'preferred' })]), r = rows(); r.forEach(c => c.preferredOverrides = { guitar: 'Creator requested electronic texture instead of guitar.' });
  assert.throws(() => validateCandidates(base, r), /override/);
  const input = { ...base, creatorInstruction: 'electronic' }; const c = validateCandidates(input, r)[0]; assert.equal(c.ruleEvidence[0].status, 'override'); assert.match(c.ruleEvidence[0].detail, /Creator/);
});
test('freeform required/avoid/locked rules stay review-blocked regardless of model claims', () => {
  for (const extra of [{}, { strength: 'avoid' }, { strength: 'preferred', locked: true }]) {
    const input = withRules([rule({ text: 'Respect traditional musical expression', ...extra })]); const c = validateCandidates(input, rows())[0]; assert.equal(c.ruleEvidence[0].status, 'review'); assert.equal(approvalReadiness(input, c.ruleEvidence).rulesReady, false);
  }
});
test('prose preferred rules are visible for review and cannot imply persistence readiness', () => {
  const input = withRules([rule({ strength: 'preferred', text: 'Warm and intimate' })]), evidence = evaluateRules(input, rows()[0].direction); assert.equal(evidence[0].status, 'review'); assert.equal(approvalReadiness(input, evidence).persistenceReady, false);
});
test('exactly one of each kind with all structured fields is enforced', () => {
  const input = compileInput(source());
  for (const mutate of [r => r.pop(), r => r[1].kind = 'signature', r => delete r[0].direction.bridge, r => r[0].direction.extra = 'x', r => r[0].direction.tempo = '', r => r[0].explanation = '', r => r[0].creatorTreatment = '']) { const r = rows(); mutate(r); assert.throws(() => validateCandidates(input, r)); }
});
test('superficial clones changing labels and explanation are rejected', () => { const input = compileInput(source()), r = rows(); r[1].direction = { ...r[0].direction }; r[1].direction.genre = 'Another label'; assert.throws(() => validateCandidates(input, r), /distinct/); });
test('recipes are independent immutable snapshots with explicit non-persistence', () => {
  const input = compileInput(source()), c = validateCandidates(input, rows())[0], recipe = createRecipe(input, c);
  input.intelligence.snapshot.emotionalCore = 'Changed'; c.direction.genre = 'Changed'; assert.equal(recipe.input.intelligence.snapshot.emotionalCore, 'Hope through loss'); assert.notEqual(recipe.candidate.direction.genre, 'Changed'); assert.throws(() => recipe.candidate.direction.genre = 'Mutate'); assert.equal(recipe.persisted, false); assert.equal(recipe.approval, null); assert.throws(approveRecipe, /verification gates/);
});
test('new DNA only raises stale notice; keep snapshot and regenerate are separate choices', () => {
  const input = withRules([]), recipe = createRecipe(input, validateCandidates(input, rows())[0]), before = JSON.stringify(recipe);
  assert.equal(model.staleDna(recipe, A, 6).newerDnaAvailable, true); assert.equal(model.staleDna(recipe, A, 5).newerDnaAvailable, false); assert.throws(() => model.staleDna(recipe, B, 5)); assert.equal(JSON.stringify(recipe), before);
});
test('Suno compression stays within limit and preserves every hard rule and ID', () => {
  const input = withRules([rule({ text: 'Keep faithful Bengali pronunciation', locked: true }), rule({ id: 'no-autotune', strength: 'avoid', text: 'Artificial vocal tuning' })]);
  const r = rows(); r.forEach(c => model.FIELDS.forEach(f => c.direction[f] = `${c.direction[f]} ${'বাংলা🎵'.repeat(100)}`));
  const result = adaptSuno(createRecipe(input, validateCandidates(input, r)[0])); assert.ok(result.prompt.length <= 1000); assert.equal(result.compressed, true); for (const rule of input.dna.rules) { assert.ok(result.prompt.includes(rule.id)); assert.ok(result.prompt.includes(rule.text)); }
  assert.equal(result.prompt.includes('\uFFFD'), false);
});
test('Suno rejects oversized hard constraints instead of truncating them', () => { const input = withRules([rule({ text: 'x'.repeat(1500) })]), c = validateCandidates(input, rows())[0]; assert.throws(() => adaptSuno(createRecipe(input, c)), /space/); });
