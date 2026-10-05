import { createHash } from 'node:crypto';
import { canonical, compileBrandContext, COMPILER_VERSION } from '../channel-dna/compile';
import { UUID } from '../channel-dna/validation';
import type { ChannelDna } from '../channel-dna/model';
import { DirectorError, type Input } from './model';

export const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
export function compileInput(source: {
  song: { id: string; channel_id: string; title: string; language: string; lyrics: string };
  channelId: string; revision: number | null; document: ChannelDna | null;
  intelligence: Record<string, unknown> | null; intelligenceUpdatedAt: string | null;
  creatorInstruction?: string; reviewedForPreview?: boolean; intelligenceSource?: 'song_production_plans'|'local-music-project';
}): Input {
  const { song } = source;
  if (!UUID.test(song.id) || !UUID.test(source.channelId) || song.channel_id !== source.channelId) throw new DirectorError('Song not available in this channel.', 404);
  if (typeof song.lyrics !== 'string' || !song.lyrics.trim()) throw new DirectorError('Save lyrics in the existing Lyrics workspace first.');
  if (song.lyrics.length > 100000) throw new DirectorError('Lyrics exceed the preview limit.');
  const intelligence = source.intelligence;
  if (!intelligence || !['emotionalCore', 'arc', 'hookStrategy', 'audiencePromise', 'visualMotifs'].some(k => typeof intelligence[k] === 'string' && String(intelligence[k]).trim() || Array.isArray(intelligence[k]) && (intelligence[k] as unknown[]).length)) throw new DirectorError('This project has no substantive saved Song Intelligence. Prepare it using the existing workflow first.');
  if (!source.intelligenceUpdatedAt) throw new DirectorError('Song Intelligence provenance is missing.');
  const note = source.creatorInstruction ?? '';
  if (typeof note !== 'string' || note.length > 2000) throw new DirectorError('Music direction must be at most 2000 characters.');
  const context = compileBrandContext(source.channelId, source.revision, source.document, 'music');
  const snapshot = {
    schemaVersion: 1 as const,
    project: { songId: song.id, channelId: source.channelId, title: song.title, language: song.language },
    lyrics: { text: song.lyrics, hash: hash(song.lyrics), source: (source.intelligenceSource==='local-music-project'?'local-music-project':'songs.lyrics') as Input['lyrics']['source'], approvalId: null, reviewedForPreview: source.reviewedForPreview === true },
    intelligence: { source: { table: source.intelligenceSource ?? 'song_production_plans', songId: song.id, updatedAt: source.intelligenceUpdatedAt }, snapshot: structuredClone(intelligence) },
    dna: { revision: source.revision, hash: context?.structured.dnaHash ?? null, compilerVersion: COMPILER_VERSION, context: context?.structured ?? null, rules: context?.structured.rules ?? [] },
    creatorInstruction: note,
  };
  return { ...snapshot, fingerprint: hash(canonical(snapshot)) };
}
