-- Suno Zara Universe: multi-workspace / multi-channel foundation
-- Safe additive migration. Existing user_id ownership remains in place during migration.

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text,
  settings jsonb not null default '{}'::jsonb,
  entitlements jsonb not null default '{"channel_limit":null}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists workspaces_owner_user_id_idx on public.workspaces(owner_user_id);

-- Each user currently owns one workspace.
-- UNIQUE prevents parallel initialization requests from creating duplicates.
create unique index if not exists workspaces_owner_user_id_unique_idx
on public.workspaces(owner_user_id);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text,
  description text,
  language text,
  channel_type text not null default 'music',
  profile jsonb not null default '{}'::jsonb,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists channels_workspace_id_idx on public.channels(workspace_id);

-- Prevent simultaneous initialization requests from creating
-- duplicate channel names inside the same workspace.
create unique index if not exists channels_workspace_name_unique_idx
on public.channels(workspace_id, name);

-- Add channel scope to the current domain without removing user_id yet.
alter table if exists public.songs add column if not exists channel_id uuid references public.channels(id) on delete set null;
alter table if exists public.song_media_assets add column if not exists channel_id uuid references public.channels(id) on delete set null;
alter table if exists public.publishing_connections add column if not exists channel_id uuid references public.channels(id) on delete cascade;
alter table if exists public.publishing_oauth_credentials add column if not exists channel_id uuid references public.channels(id) on delete cascade;
alter table if exists public.publishing_campaigns add column if not exists channel_id uuid references public.channels(id) on delete set null;
alter table if exists public.publishing_jobs add column if not exists channel_id uuid references public.channels(id) on delete set null;

create index if not exists songs_channel_id_idx on public.songs(channel_id);
create index if not exists publishing_connections_channel_id_idx on public.publishing_connections(channel_id);
create index if not exists publishing_campaigns_channel_id_idx on public.publishing_campaigns(channel_id);
create index if not exists publishing_jobs_channel_id_idx on public.publishing_jobs(channel_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.channels enable row level security;

drop policy if exists "workspace owners can manage workspaces" on public.workspaces;
create policy "workspace owners can manage workspaces" on public.workspaces
for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

drop policy if exists "members can view own memberships" on public.workspace_members;
create policy "members can view own memberships" on public.workspace_members
for select using (user_id = auth.uid());
drop policy if exists "owners can manage memberships" on public.workspace_members;
create policy "owners can manage memberships" on public.workspace_members
for all using (exists (select 1 from public.workspaces w where w.id=workspace_id and w.owner_user_id=auth.uid()))
with check (exists (select 1 from public.workspaces w where w.id=workspace_id and w.owner_user_id=auth.uid()));

drop policy if exists "workspace members can view channels" on public.channels;
create policy "workspace members can view channels" on public.channels
for select using (
  exists (select 1 from public.workspaces w where w.id=workspace_id and w.owner_user_id=auth.uid())
  or exists (select 1 from public.workspace_members m where m.workspace_id=channels.workspace_id and m.user_id=auth.uid())
);
drop policy if exists "workspace owners can manage channels" on public.channels;
create policy "workspace owners can manage channels" on public.channels
for all using (exists (select 1 from public.workspaces w where w.id=workspace_id and w.owner_user_id=auth.uid()))
with check (exists (select 1 from public.workspaces w where w.id=workspace_id and w.owner_user_id=auth.uid()));
