import type { ChannelDna } from '../channel-dna/model';

export const DIRECTOR_VERSION = 'music-director/2-dev';
export const KINDS = ['signature', 'alternative', 'experimental'] as const;
export const FIELDS = ['genre', 'fusion', 'tempo', 'energy', 'groove', 'instrumentation', 'vocalCharacter', 'pronunciation', 'melodicBehaviour', 'arrangementArc', 'productionTexture', 'emotionalTrajectory', 'intro', 'verse', 'chorus', 'bridge', 'outro', 'avoid'] as const;
export type Kind = typeof KINDS[number];
export type Field = typeof FIELDS[number];
export type Direction = Record<Field, string>;
export type MusicRule = ChannelDna['sections']['core']['rules'][number];
export type Evidence = { ruleId: string; status: 'satisfied' | 'conflict' | 'review' | 'override'; detail: string };
export type Candidate = { kind: Kind; direction: Direction; explanation: string; ruleEvidence: Evidence[]; creatorTreatment: string };
export type Input = {
  schemaVersion: 1;
  project: { songId: string; channelId: string; title: string; language: string };
  lyrics: { text: string; hash: string; source: 'songs.lyrics' | 'local-music-project'; approvalId: null; reviewedForPreview: boolean };
  intelligence: { source: { table: 'song_production_plans' | 'local-music-project'; songId: string; updatedAt: string }; snapshot: Record<string, unknown> };
  dna: { revision: number | null; hash: string | null; compilerVersion: string; context: Record<string, unknown> | null; rules: MusicRule[] };
  creatorInstruction: string;
  fingerprint: string;
};
export type Recipe = {
  schemaVersion: 1; state: 'development-preview'; persisted: false;
  input: Input; candidate: Candidate; directorVersion: string; generator: { provider: string; model: string };
  approval: null; providerAdaptation: { provider: 'suno'; adapterVersion: string; prompt: string } | null;
};
export class DirectorError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function staleDna(recipe: Recipe, channelId: string, activeRevision: number | null) {
  if (channelId !== recipe.input.project.channelId) throw new DirectorError('Recipe belongs to a different channel.', 404);
  return { newerDnaAvailable: activeRevision !== recipe.input.dna.revision, actions: ['keep-snapshot', 'regenerate-current-dna'] as const };
}
