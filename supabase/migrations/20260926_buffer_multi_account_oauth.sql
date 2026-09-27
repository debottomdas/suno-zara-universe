begin;

create table if not exists public.buffer_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  external_account_id text not null,
  email text,
  display_name text,
  access_token text not null,
  refresh_token text not null,
  token_type text not null default 'Bearer',
  scope text,
  expires_at timestamptz,
  status text not null default 'connected',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, external_account_id)
);
create index if not exists buffer_accounts_workspace_idx on public.buffer_accounts(workspace_id);

alter table public.buffer_channel_bindings add column if not exists buffer_account_id uuid references public.buffer_accounts(id) on delete cascade;
create index if not exists buffer_channel_bindings_account_idx on public.buffer_channel_bindings(buffer_account_id);

alter table public.buffer_accounts enable row level security;
drop policy if exists "buffer_accounts_own" on public.buffer_accounts;
create policy "buffer_accounts_own" on public.buffer_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
