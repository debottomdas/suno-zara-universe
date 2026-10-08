begin;

alter table public.songs
  add column if not exists project_state text not null default 'current';

alter table public.songs
  drop constraint if exists songs_project_state_check;

alter table public.songs
  add constraint songs_project_state_check
  check (project_state in ('current', 'later', 'completed'));

create index if not exists songs_user_channel_project_state_updated_idx
  on public.songs(user_id, channel_id, project_state, updated_at desc);

comment on column public.songs.project_state is
  'User-controlled catalogue lifecycle: current, later, or completed. Independent of production status.';

commit;
