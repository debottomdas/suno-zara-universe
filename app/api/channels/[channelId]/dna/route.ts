import { createClient } from '@/utils/supabase/server';
import { createAdminClient } from '@/utils/supabase/admin';
import { databaseError, loadVersion, ownedChannel, saveDna, validateAssets } from '@/utils/channel-dna/server';
import { DnaError, validateDna, validateRevision, nextRevision } from '@/utils/channel-dna/validation';
import { compileBrandContext } from '@/utils/channel-dna/compile';
import { STAGES, type Stage } from '@/utils/channel-dna/model';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ channelId: string }> };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
function failure(error: unknown) {
  return json({ error: error instanceof DnaError ? error.message : 'Could not access Channel DNA.' }, error instanceof DnaError ? error.status : 500);
}
async function authenticate(context: Context) {
  const db = await createClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new DnaError('Please sign in.', 401);
  return { db, user, channelId: (await context.params).channelId };
}
export async function GET(request: Request, context: Context) {
  try {
    const { db, user, channelId } = await authenticate(context);
    const channel = await ownedChannel(db, user.id, channelId);
    const url = new URL(request.url);
    const rawRevision = url.searchParams.get('revision');
    const revision = rawRevision === null ? channel.active_dna_revision : Number(rawRevision);
    if (rawRevision !== null && (!/^[1-9][0-9]*$/.test(rawRevision) || !Number.isSafeInteger(revision))) throw new DnaError('Invalid revision.');
    if (revision !== null) validateRevision(revision);
    const version = await loadVersion(db, channelId, revision);
    const { data: history, error } = await db.from('channel_dna_versions').select('revision, created_at, created_by, change_note, lock_changes').eq('channel_id', channelId).order('revision', { ascending: false }).limit(50);
    if (error) databaseError(error);
    return json({ channel, version, history });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const { db, user, channelId } = await authenticate(context);
    return json(await saveDna(db, createAdminClient, user.id, channelId, await readBody(request)));
  } catch (error) { return failure(error); }
}
// Read-only draft preview; never saves, activates, fetches assets, or calls AI.
export async function POST(request: Request, context: Context) {
  try {
    const { db, user, channelId } = await authenticate(context);
    const channel = await ownedChannel(db, user.id, channelId);
    const body = await readBody(request) as { document?: unknown; stage?: Stage };
    if (!body || !body.stage || !STAGES.includes(body.stage)) throw new DnaError('Invalid preview stage.');
    const document = validateDna(body.document);
    await validateAssets(db, user.id, channelId, document);
    return json({ draft: true, context: compileBrandContext(channelId, nextRevision(channel.active_dna_revision), document, body.stage) });
  } catch (error) { return failure(error); }
}
async function readBody(request: Request): Promise<unknown> {
  // Bound actual streamed bytes, not just an untrusted Content-Length header.
  if (!request.body) throw new DnaError('JSON body required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 450000) { await reader.cancel(); throw new DnaError('Request too large.', 413); }
    chunks.push(value);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new DnaError('Invalid JSON body.'); }
}
