import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const native = createRequire(import.meta.url);
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', S = '33333333-3333-4333-8333-333333333333';
function harness(options = {}) {
  const reads = [], calls = [], cache = new Map(); let user = options.user === undefined ? 'owner' : options.user;
  const tables = {
    channels: [{ id: A, name: 'Bangla', workspace_id: 'wa', active_dna_revision: null, is_archived: false }, { id: B, name: 'Bhakti', workspace_id: 'wb', active_dna_revision: null, is_archived: false }],
    workspaces: [{ id: 'wa', owner_user_id: 'owner' }, { id: 'wb', owner_user_id: options.ownsBoth ? 'owner' : 'other' }],
    songs: [{ id: S, channel_id: A, user_id: 'owner', title: 'Hope', language: 'Bengali', lyrics: '  আমার গান\n  ' }],
    song_production_plans: [{ song_id: S, channel_id: A, user_id: 'owner', updated_at: '2026-10-03T12:00:00Z', plan: { songDNA: { emotionalCore: 'Hope' } } }], channel_dna_versions: [],
  };
  const db = { auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }) }, from(table) {
    assert.ok(table in tables, `Forbidden new-schema table ${table}`); const filters = [];
    return { select() { reads.push(table); return this; }, eq(key, value) { filters.push([key, value]); return this; }, async maybeSingle() { return { data: tables[table].find(row => filters.every(([k, v]) => row[k] === v)) ?? null, error: options.databaseError ? { code: 'unknown' } : null }; } };
  } };
  function load(file) {
    file = path.resolve(file); if (cache.has(file)) return cache.get(file);
    const ctx = { exports: {}, structuredClone, Buffer, URL, Request, Response, TextDecoder, console, process: { env: { NODE_ENV: options.mode ?? 'development', OPENAI_API_KEY: 'mock-key' } }, require(name) {
      if (name === '@/utils/supabase/server') return { createClient: async () => db };
      if (name === 'openai') return { default: class { responses = { create: async request => {
        calls.push(request); if (options.providerFail) throw Error('provider secret must stay hidden');
        if (options.changeDuringGeneration) tables.songs[0].lyrics = 'New lyrics';
        const fields = load('utils/music-director/model.ts').FIELDS;
        const candidates = ['signature', 'alternative', 'experimental'].map((kind, i) => ({ kind, direction: Object.fromEntries(fields.map(f => [f, `${['Folk', 'Rock', 'Electronic'][i]} ${f}`])), explanation: `Hope in Bengali: ${kind} musical expression.`, creatorTreatment: 'Unplugged instruction informs instrumentation.', preferredOverrides: {} }));
        return { output_text: options.malformedProvider ? 'not JSON' : JSON.stringify({ candidates }) };
      } }; } };
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts');
      return native(name);
    } };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
    cache.set(file, ctx.exports); return ctx.exports;
  }
  const route = load('app/api/music-director/preview/route.ts');
  return { tables, reads, calls, load, async get(channel = A, song = S) { const response = await route.GET(new Request(`http://localhost/api/music-director/preview?channelId=${channel}&projectId=${song}`)); return { status: response.status, body: await response.json() }; }, async post(change = {}) {
    const initial = await this.get(); const body = { projectId: S, channelId: A, creatorInstruction: 'unplugged', reviewedForPreview: true, sourceFingerprint: initial.body.input?.fingerprint, ...change };
    const response = await route.POST(new Request('http://localhost/api/music-director/preview', { method: 'POST', body: JSON.stringify(body) })); return { status: response.status, body: await response.json() };
  }, async raw(body) { const response = await route.POST(new Request('http://localhost/api/music-director/preview', { method: 'POST', body })); return { status: response.status, body: await response.json() }; } };
}
test('read-only source adapter uses canonical owned tables and no persistence', async () => { const h = harness(), result = await h.get(); assert.equal(result.status, 200); assert.equal(result.body.input.lyrics.text, h.tables.songs[0].lyrics); assert.equal(result.body.persistenceAvailable, false); assert.deepEqual(h.calls, []); });
test('production and test environments disable both methods before database/provider access', async () => { for (const mode of ['production', 'test']) { const h = harness({ mode }); assert.equal((await h.get()).status, 404); assert.equal((await h.post()).status, 404); assert.deepEqual(h.reads, []); assert.deepEqual(h.calls, []); } });
test('unauthenticated requests cannot read song or invoke provider', async () => { const h = harness({ user: null }); assert.equal((await h.get()).status, 401); assert.equal((await h.post()).status, 401); assert.equal(h.reads.length, 0); assert.equal(h.calls.length, 0); });
test('foreign workspace channel is denied before lyrics or intelligence reads', async () => { const h = harness(); assert.equal((await h.get(B)).status, 404); assert.equal(h.reads.includes('songs'), false); assert.equal(h.reads.includes('song_production_plans'), false); });
test('even owned channel switching cannot expose another channel song', async () => { const h = harness({ ownsBoth: true }); assert.equal((await h.get(B)).status, 404); assert.equal(h.reads.includes('song_production_plans'), false); });
test('malformed or absent project cannot leak inputs', async () => { const h = harness(); assert.equal((await h.get(A, 'wrong')).status, 400); assert.equal((await h.get(A, B)).status, 404); });
test('missing existing intelligence gives a graceful blocker without generating new intelligence', async () => { const h = harness(); h.tables.song_production_plans.length = 0; const result = await h.get(); assert.equal(result.status, 400); assert.match(result.body.error, /existing workflow/); assert.equal(h.calls.length, 0); });
test('valid explicit generation returns three immutable preview recipes and connected adaptation', async () => {
  const h = harness(), before = JSON.stringify(h.tables), result = await h.post(); assert.equal(result.status, 200); assert.equal(result.body.recipes.length, 3); assert.equal(result.body.recipes[0].recipe.input.creatorInstruction, 'unplugged'); assert.equal(result.body.recipes[0].recipe.generator.model, 'gpt-5.6-luna'); assert.equal(result.body.recipes[0].recipe.providerAdaptation.prompt, result.body.recipes[0].adaptation.prompt); assert.equal(result.body.recipes[0].recipe.approval, null); assert.equal(result.body.recipes[0].recipe.persisted, false); assert.equal(JSON.stringify(h.tables), before); assert.equal(h.calls.length, 1); assert.match(h.calls[0].instructions, /NEVER rewrite/); assert.ok(h.calls[0].input.includes('আমার গান')); assert.match(h.calls[0].input,/JSON/); assert.match(h.calls[0].instructions,/MUST contain kind/);
});
test('review confirmation is required and unknown client-provided sources are rejected', async () => { for (const change of [{ reviewedForPreview: false }, { lyrics: 'Forged lyrics' }, { dna: {} }, { creatorInstruction: 'x'.repeat(2001) }]) { const h = harness(); assert.equal((await h.post(change)).status, 400); assert.equal(h.calls.length, 0); } });
test('stale reviewed fingerprint blocks generation before provider call', async () => { const h = harness(); assert.equal((await h.post({ sourceFingerprint: 'stale' })).status, 409); assert.equal(h.calls.length, 0); });
test('source changes during generation reject old output without any saved recipe', async () => { const h = harness({ changeDuringGeneration: true }), result = await h.post(); assert.equal(result.status, 409); assert.match(result.body.error, /during generation/); assert.equal(result.body.recipes, undefined); });
test('provider failures and malformed output return safe errors without secrets', async () => { for (const options of [{ providerFail: true }, { malformedProvider: true }]) { const h = harness(options), result = await h.post(); assert.ok([400, 503].includes(result.status)); assert.equal(JSON.stringify(result).includes('secret'), false); assert.equal(result.body.recipes, undefined); } });
test('bounded request stream rejects oversized payload independently of headers', async () => { const h = harness(); assert.equal((await h.raw(JSON.stringify({ extra: 'x'.repeat(12001) }))).status, 413); assert.equal(h.calls.length, 0); });
test('malformed JSON and invalid UTF8 are rejected without provider access', async () => { const h = harness(); assert.equal((await h.raw('{')).status, 400); assert.equal((await h.raw(new Uint8Array([255]))).status, 400); assert.equal(h.calls.length, 0); });
test('database failures remain failures; no fallback to other channels', async () => { const h = harness({ databaseError: true }); assert.equal((await h.get()).status, 500); assert.equal(h.calls.length, 0); });
