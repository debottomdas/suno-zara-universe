-- Additive, server-only ledger. Existing staging files are deliberately protected
-- when no ledger row exists; never infer that untracked media is unused.
create table if not exists public.buffer_staged_media (
 storage_path text primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 song_id uuid not null references public.songs(id) on delete cascade,
 state text not null default 'staged' check (state in ('staged','submitting','submitted','uncertain','deleting','deleted')),
 buffer_account_id uuid references public.buffer_accounts(id),
 attempts jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now()
);
alter table public.buffer_staged_media enable row level security;
-- No client write policies: only the server's service role can certify dependencies.
revoke all on public.buffer_staged_media from anon, authenticated;
grant all on public.buffer_staged_media to service_role;
