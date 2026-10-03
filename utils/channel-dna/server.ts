import type { SupabaseClient } from '@supabase/supabase-js';
import { DnaError, UUID, validateLockChanges, validateSave, validateRevision } from './validation';
import type { ChannelDna, DnaVersion } from './model';
export function databaseError(error: { code?: string } | null): never {
  if (error?.code === '54000') throw new DnaError('Channel DNA has reached its final revision; no further revisions can be saved.', 409);
  if (error?.code === '40P01') throw new DnaError('Concurrent channel operation. Reload and retry saving.', 409);
  if (error?.code === '40001') throw new DnaError('DNA changed or a locked rule was edited. Reload the latest revision before saving.', 409);
  if (error?.code === '42501') throw new DnaError('Channel or asset not available.', 404);
  if (['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error?.code ?? '')) throw new DnaError('Channel DNA is not installed yet. The reviewed migration must be applied before using this editor.', 503);
  if (error?.code === '22P02') throw new DnaError('Malformed UUID or database input value.');
  if (error?.code === '22003') throw new DnaError('Revision is outside the PostgreSQL integer range.');
  if (['22023', '23514'].includes(error?.code ?? '')) throw new DnaError('Invalid DNA document or lock changes.');
  throw new DnaError('Could not access Channel DNA. Please retry.', 500);
}
export async function ownedChannel(db: SupabaseClient, userId: string, channelId: string) {
  if (!UUID.test(channelId)) throw new DnaError('Invalid channel ID.');
  const { data: channel, error } = await db.from('channels').select('id, name, workspace_id, active_dna_revision').eq('id', channelId).eq('is_archived', false).maybeSingle();
  if (error) databaseError(error);
  if (!channel) throw new DnaError('Channel not found.', 404);
  const { data: workspace, error: ownerError } = await db.from('workspaces').select('id').eq('id', channel.workspace_id).eq('owner_user_id', userId).maybeSingle();
  if (ownerError) databaseError(ownerError);
  if (!workspace) throw new DnaError('Channel not found.', 404);
  return channel as { id: string; name: string; workspace_id: string; active_dna_revision: number | null };
}
export async function loadVersion(db: SupabaseClient, channelId: string, revision: number | null): Promise<DnaVersion | null> {
  if (revision === null) return null;
  validateRevision(revision);
  const { data, error } = await db.from('channel_dna_versions').select('*').eq('channel_id', channelId).eq('revision', revision).maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new DnaError('DNA revision not found.', 404);
  return data as DnaVersion;
}
export async function saveDna(db: SupabaseClient, admin: () => SupabaseClient, userId: string, channelId: string, body: unknown) {
  const channel = await ownedChannel(db, userId, channelId);
  const input = validateSave(body);
  if (channel.active_dna_revision !== input.expectedRevision) throw new DnaError('DNA changed. Reload the latest revision before saving.', 409);
  const previous = await loadVersion(db, channelId, input.expectedRevision);
  validateLockChanges(previous?.document ?? null, input.document, input.lockChanges);
  await validateAssets(db, userId, channelId, input.document);
  const { data: revision, error } = await admin().rpc('save_channel_dna', {
    p_channel_id: channelId, p_actor_id: userId, p_expected_revision: input.expectedRevision,
    p_document: input.document, p_lock_changes: input.lockChanges, p_change_note: input.changeNote,
  });
  if (error) databaseError(error);
  return { revision: revision as number };
}
export async function validateAssets(db: SupabaseClient, userId: string, channelId: string, document: ChannelDna) {
  if (!document.assets.length) return;
  const ids = [...new Set(document.assets.map(a => a.mediaAssetId))];
  const { data, error } = await db.from('song_media_assets').select('id, songs!inner(channel_id, user_id)').in('id', ids).eq('user_id', userId).eq('songs.channel_id', channelId).eq('songs.user_id', userId);
  if (error) databaseError(error);
  if (data?.length !== ids.length) throw new DnaError('Asset not available in this channel.', 404);
}
