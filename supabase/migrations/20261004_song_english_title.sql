alter table public.songs
  add column if not exists english_title text;

comment on column public.songs.english_title is
  'Optional English/transliterated publishing title for the song; the original/native title remains in title.';
