export const SECTIONS = ['core', 'musical', 'visual', 'publishing'] as const;
export type Section = typeof SECTIONS[number];
export const STAGES = ['music', 'visual', 'video', 'social', 'publishing'] as const;
export type Stage = typeof STAGES[number];
export type Strength = 'required' | 'preferred' | 'avoid';
export type Rule = { id: string; text: string; strength: Strength; locked: boolean; stages: Stage[] };
export const FIELDS = {
  core: ['purpose', 'tone', 'audience', 'languagePhilosophy', 'culturalDirection'],
  musical: ['genres', 'vocals', 'instrumentation', 'arrangement', 'production', 'pronunciation', 'experimentation'],
  visual: ['brandText', 'typography', 'colours', 'direction', 'thumbnail', 'watermark', 'subtitles', 'intro', 'outro'],
  publishing: ['titleTemplate', 'descriptionTemplate', 'credits', 'fixedHashtags', 'userFixedHashtags', 'tags', 'category', 'links'],
} as const;
export const LABELS: Record<Section, string> = { core: 'Core Identity', musical: 'Musical Identity', visual: 'Visual Identity / Brand Kit', publishing: 'Publishing Identity' };
export type IdentitySection<S extends Section> = { fields: Record<typeof FIELDS[S][number], string>; rules: Rule[] };
// References only: never URLs, filesystem paths or signed tokens. Future consumers must
// reauthorize the media row and verify expectedSha256 before using its bytes.
export type AssetReference = { id: string; mediaAssetId: string; role: 'logo' | 'font' | 'watermark' | 'intro' | 'outro' | 'reference'; expectedSha256: string };
export type ChannelDna = { schemaVersion: 1; sections: { [S in Section]: IdentitySection<S> }; assets: AssetReference[] };
export type LockChange = { id: string; locked: boolean };
export type DnaVersion = { channel_id: string; revision: number; schema_version: number; document: ChannelDna; created_by: string | null; created_at: string; change_note: string; lock_changes: LockChange[] };
export function emptyDna(): ChannelDna {
  return { schemaVersion: 1, sections: Object.fromEntries(SECTIONS.map(s => [s, { fields: Object.fromEntries(FIELDS[s].map(f => [f, ''])), rules: [] }])) as unknown as ChannelDna['sections'], assets: [] };
}
