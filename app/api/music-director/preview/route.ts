import OpenAI from 'openai';
import { createClient } from '@/utils/supabase/server';
import { loadInput, generationInstructions } from '@/utils/music-director/server';
import { DirectorError } from '@/utils/music-director/model';
import { validateCandidates, createRecipe } from '@/utils/music-director/recipe';
import { attachSuno } from '@/utils/music-director/suno';
import { DnaError } from '@/utils/channel-dna/validation';

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function session() {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new DirectorError('Sign in to inspect your song.', 401);
  return { db, user };
}
function failure(error: unknown) {
  if (error instanceof DirectorError || error instanceof DnaError) return json({ error: error.message }, error.status);
  // Do not expose provider payloads, credentials or database internals.
  return json({ error: 'Music Director preview failed. No song or recipe was saved.' }, 503);
}
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') return json({ error: 'Development preview only.' }, 404);
  try {
    const { db, user } = await session(), params = new URL(request.url).searchParams;
    const input = await loadInput(db, user.id, params.get('projectId') ?? '', params.get('channelId') ?? '');
    return json({ input, persistenceAvailable: false });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') return json({ error: 'Development preview only.' }, 404);
  try {
    const { db, user } = await session();
    // Actual stream size is bounded, independent of a client-supplied Content-Length.
    const reader = request.body?.getReader();
    if (!reader) throw new DirectorError('Missing preview request.');
    let size = 0; const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 12000) { await reader.cancel(); throw new DirectorError('Preview request too large.', 413); }
      chunks.push(value);
    }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new DirectorError('Invalid JSON or UTF-8 preview request.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['projectId', 'channelId', 'creatorInstruction', 'reviewedForPreview', 'sourceFingerprint'].includes(k))) throw new DirectorError('Invalid preview request.');
    if (typeof body.projectId !== 'string' || typeof body.channelId !== 'string' || typeof body.creatorInstruction !== 'string' || body.reviewedForPreview !== true || typeof body.sourceFingerprint !== 'string') throw new DirectorError('Review the saved lyrics and inputs before generating.');
    const current = await loadInput(db, user.id, body.projectId, body.channelId);
    if (current.fingerprint !== body.sourceFingerprint) throw new DirectorError('Inputs changed. Reload and review before generating.', 409);
    const input = await loadInput(db, user.id, body.projectId, body.channelId, body.creatorInstruction, true);
    const instructions = generationInstructions(input);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({ model: 'gpt-5.6-luna', instructions: instructions.system, input: `Return JSON only.\n${instructions.user}`, text: { format: { type: 'json_object' } }, max_output_tokens: 12000 });
    const candidates = validateCandidates(input, JSON.parse(response.output_text).candidates);
    const fresh = await loadInput(db, user.id, body.projectId, body.channelId, body.creatorInstruction, true);
    if (fresh.fingerprint !== input.fingerprint) throw new DirectorError('Inputs changed during generation. Review current inputs and regenerate.', 409);
    const recipes = candidates.map(candidate => {
      const recipe = createRecipe(input, candidate, { provider: 'openai', model: 'gpt-5.6-luna' });
      try { return { ...attachSuno(recipe), adaptationError: null }; }
      catch (error) { return { recipe, adaptation: null, adaptationError: error instanceof DirectorError ? error.message : 'Adaptation unavailable.' }; }
    });
    return json({ input, recipes, persistenceAvailable: false });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return json({ error: 'Invalid preview request or provider response.' }, 400);
    return failure(error);
  }
}
