import { UUID } from '../channel-dna/validation';
import { DirectorError, DIRECTOR_VERSION, type Candidate, type Input } from './model';
import { approvalReadiness } from './rules';

// Pure handoff contracts only. No database client, RPC invocation or feature flag
// can enable writes in this development checkpoint.
export const DATABASE_GATE = { nativeConcurrencyVerified: false, isolatedSupabaseVerified: false, writesEnabled: false } as const;
function revision(value: number) {
  if (!Number.isInteger(value) || value < 0 || value >= 2147483647) throw new DirectorError('Invalid expected revision.');
  return value;
}
export function lyricsApprovalContract(input: Input, expectedRevision: number) {
  if (!input.lyrics.reviewedForPreview) throw new DirectorError('Review the existing saved lyrics first.');
  return { function: 'approve_song_lyrics' as const, arguments: { p_song: input.project.songId, p_channel: input.project.channelId, p_expected_revision: revision(expectedRevision), p_lyrics: input.lyrics.text } };
}
export function batchContract(input: Input, candidates: Candidate[], lyricsApprovalId: string, expectedRevision: number, modelVersion: string) {
  if (!UUID.test(lyricsApprovalId)) throw new DirectorError('An authenticated immutable lyrics approval is required.');
  if (!modelVersion.trim() || modelVersion.length > 200) throw new DirectorError('Generator provenance is required.');
  if (candidates.length !== 3 || candidates.some(c => !approvalReadiness(input, c.ruleEvidence).rulesReady)) throw new DirectorError('Resolve all hard rule checks before preparing persistence.');
  return { function: 'save_music_direction_batch' as const, arguments: {
    p_song: input.project.songId, p_channel: input.project.channelId, p_expected_revision: revision(expectedRevision),
    p_lyrics_id: lyricsApprovalId, p_dna_revision: input.dna.revision,
    p_intelligence_source: structuredClone(input.intelligence.source), p_intelligence_snapshot: structuredClone(input.intelligence.snapshot),
    p_creator_direction: input.creatorInstruction, p_model_version: modelVersion,
    p_compiler_version: `${DIRECTOR_VERSION};${input.dna.compilerVersion}`,
    p_candidates: structuredClone(candidates),
  } };
}
export function executePersistence(): never {
  throw new DirectorError('Production database migration remains on HOLD. Both verification gates must pass before persistence integration.', 503);
}
