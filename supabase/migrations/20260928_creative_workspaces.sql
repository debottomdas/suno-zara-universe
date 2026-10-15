begin;
-- Additive V5.25 workspace. Existing production plans, assets and publishing are unchanged.
create table if not exists public.song_creative_workspaces (
 song_id uuid primary key references public.songs(id) on delete cascade,
 user_id uuid not null references auth.users(id),
 revision integer not null default 0,
 workspace jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
alter table public.song_creative_workspaces enable row level security;
create policy "Own creative workspace" on public.song_creative_workspaces for all to authenticated
 using (user_id = auth.uid() and exists(select 1 from public.songs s where s.id=song_id and s.user_id=auth.uid()))
 with check (user_id = auth.uid() and exists(select 1 from public.songs s where s.id=song_id and s.user_id=auth.uid()));

commit;
