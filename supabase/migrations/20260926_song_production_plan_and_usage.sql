begin;

create table if not exists public.song_production_plans (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete set null,
  version integer not null default 1,
  plan jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(song_id)
);
create index if not exists song_production_plans_user_channel_idx on public.song_production_plans(user_id, channel_id);
alter table public.song_production_plans enable row level security;
drop policy if exists "Users manage own production plans" on public.song_production_plans;
create policy "Users manage own production plans" on public.song_production_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete set null,
  song_id uuid references public.songs(id) on delete set null,
  feature text not null,
  provider text not null,
  model text,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  estimated_cost_usd numeric(12,6),
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_events_user_created_idx on public.ai_usage_events(user_id, created_at desc);
create index if not exists ai_usage_events_song_idx on public.ai_usage_events(song_id, created_at desc);
alter table public.ai_usage_events enable row level security;
drop policy if exists "Users read own AI usage" on public.ai_usage_events;
create policy "Users read own AI usage" on public.ai_usage_events for select using (auth.uid() = user_id);
drop policy if exists "Users insert own AI usage" on public.ai_usage_events;
create policy "Users insert own AI usage" on public.ai_usage_events for insert with check (auth.uid() = user_id);

commit;
