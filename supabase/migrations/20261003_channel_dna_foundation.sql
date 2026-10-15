-- V5.28A1 foundation only. REVIEW AND APPLY MANUALLY; no backfill or output changes.
begin;
-- Retention: archive/unarchive preserves all revisions and the active pointer.
-- Existing hard deletion of a channel (including workspace/owner cascades) removes
-- its DNA. Deleting a former creator only clears created_by on surviving history.
-- No new deletion endpoint/UI, TTL, or independent history-deletion capability.
-- SQL guarantees exact reader-safe structure, unique IDs, typed locks/stages/assets,
-- lock transition semantics, authorization, atomic revisioning, and a 400KB ceiling.
-- API-only policy: 100K JS-character document/compiled limits, per-field text limits,
-- rule/asset/change counts, nonempty prose, control characters, template tokens,
-- HTTPS URL semantics, and a 450KB request limit. SQL also caps change_note at 500.
-- PostgreSQL JSONB rejects invalid Unicode; API rejects it earlier without rewriting.
-- This helper backs both RPC prevalidation and the table constraint.
create function public.channel_dna_structure(d jsonb, changes jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  section_name text;
  section_value jsonb;
  fields text[];
  item jsonb;
  ids text[] := '{}';
  asset_ids text[] := '{}';
  change_ids text[] := '{}';
  stage jsonb;
begin
  if jsonb_typeof(d) is distinct from 'object' then return false; end if;
  if not (d ?& array['schemaVersion','sections','assets']) or d - array['schemaVersion','sections','assets'] <> '{}'::jsonb
    or d->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(d->'sections') is distinct from 'object'
    or jsonb_typeof(d->'assets') is distinct from 'array'
    or jsonb_typeof(changes) is distinct from 'array' then return false; end if;
  if not (d->'sections' ?& array['core','musical','visual','publishing'])
    or (d->'sections') - array['core','musical','visual','publishing'] <> '{}'::jsonb then return false; end if;
  foreach section_name in array array['core','musical','visual','publishing'] loop
    section_value := d->'sections'->section_name;
    fields := case section_name
      when 'core' then array['purpose','tone','audience','languagePhilosophy','culturalDirection']
      when 'musical' then array['genres','vocals','instrumentation','arrangement','production','pronunciation','experimentation']
      when 'visual' then array['brandText','typography','colours','direction','thumbnail','watermark','subtitles','intro','outro']
      else array['titleTemplate','descriptionTemplate','credits','fixedHashtags','userFixedHashtags','tags','category','links'] end;
    if jsonb_typeof(section_value) is distinct from 'object' then return false; end if;
    if not (section_value ?& array['fields','rules']) or section_value - array['fields','rules'] <> '{}'::jsonb
      or jsonb_typeof(section_value->'fields') is distinct from 'object'
      or jsonb_typeof(section_value->'rules') is distinct from 'array' then return false; end if;
    if not (section_value->'fields' ?& fields) or (section_value->'fields') - fields <> '{}'::jsonb then return false; end if;
    if exists (select 1 from jsonb_each(section_value->'fields') f where jsonb_typeof(f.value) <> 'string') then return false; end if;
    for item in select value from jsonb_array_elements(section_value->'rules') loop
      if jsonb_typeof(item) is distinct from 'object' then return false; end if;
      if not (item ?& array['id','text','strength','locked','stages']) or item - array['id','text','strength','locked','stages'] <> '{}'::jsonb
        or jsonb_typeof(item->'id') is distinct from 'string'
        or coalesce(item->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$'
        or item->>'id' = any(ids)
        or jsonb_typeof(item->'text') is distinct from 'string'
        or jsonb_typeof(item->'locked') is distinct from 'boolean'
        or jsonb_typeof(item->'strength') is distinct from 'string'
        or (item->>'strength') not in ('required','preferred','avoid')
        or jsonb_typeof(item->'stages') is distinct from 'array' then return false; end if;
      ids := array_append(ids,item->>'id');
      if jsonb_array_length(item->'stages') = 0 or
        (select count(*) <> count(distinct value) from jsonb_array_elements(item->'stages')) then return false; end if;
      for stage in select value from jsonb_array_elements(item->'stages') loop
        if stage not in ('"music"'::jsonb,'"visual"'::jsonb,'"video"'::jsonb,'"social"'::jsonb,'"publishing"'::jsonb) then return false; end if;
      end loop;
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(d->'assets') loop
    if jsonb_typeof(item) is distinct from 'object' then return false; end if;
    if not (item ?& array['id','mediaAssetId','role','expectedSha256']) or item - array['id','mediaAssetId','role','expectedSha256'] <> '{}'::jsonb
      or jsonb_typeof(item->'id') is distinct from 'string'
      or coalesce(item->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' or item->>'id' = any(asset_ids)
      or jsonb_typeof(item->'mediaAssetId') is distinct from 'string'
      or coalesce(item->>'mediaAssetId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(item->'expectedSha256') is distinct from 'string'
      or coalesce(item->>'expectedSha256','') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(item->'role') is distinct from 'string'
      or (item->>'role') not in ('logo','font','watermark','intro','outro','reference') then return false; end if;
    asset_ids := array_append(asset_ids,item->>'id');
  end loop;
  for item in select value from jsonb_array_elements(changes) loop
    if jsonb_typeof(item) is distinct from 'object' then return false; end if;
    if not (item ?& array['id','locked']) or item - array['id','locked'] <> '{}'::jsonb
      or jsonb_typeof(item->'id') is distinct from 'string'
      or coalesce(item->>'id','') !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$'
      or item->>'id' = any(change_ids)
      or jsonb_typeof(item->'locked') is distinct from 'boolean' then return false; end if;
    change_ids := array_append(change_ids,item->>'id');
  end loop;
  return true;
end $$;
revoke all on function public.channel_dna_structure(jsonb,jsonb) from public, anon, authenticated, service_role;

create table public.channel_dna_versions (
  channel_id uuid not null references public.channels(id) on delete cascade,
  revision integer not null check (revision > 0),
  schema_version integer not null check (schema_version = 1),
  document jsonb not null check (jsonb_typeof(document) = 'object' and document->>'schemaVersion' = '1' and octet_length(document::text) <= 400000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  change_note text not null default '' check (length(change_note) <= 500),
  lock_changes jsonb not null default '[]'::jsonb check (jsonb_typeof(lock_changes) = 'array'),
  constraint channel_dna_structure_check check (public.channel_dna_structure(document, lock_changes)),
  primary key (channel_id, revision)
);
alter table public.channels add column active_dna_revision integer;
alter table public.channels add constraint channels_active_dna_revision_fk
  foreign key (id, active_dna_revision) references public.channel_dna_versions(channel_id, revision);
alter table public.channel_dna_versions enable row level security;
create policy channel_dna_owner_read on public.channel_dna_versions for select to authenticated
using (exists (select 1 from public.channels c join public.workspaces w on w.id=c.workspace_id
  where c.id=channel_id and w.owner_user_id=auth.uid()));
revoke all on public.channel_dna_versions from public, anon, authenticated, service_role;
grant select on public.channel_dna_versions to authenticated, service_role;

create function public.channel_dna_immutable() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Archive retains everything. Only actual parent deletion permits history cleanup.
  -- SECURITY DEFINER ensures RLS cannot make an existing parent look absent.
  if TG_OP = 'DELETE' then
    if not exists (select 1 from public.channels where id=old.channel_id) then return old; end if;
  elsif TG_OP = 'UPDATE' then
    if old.created_by is not null and new.created_by is null
      and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by')
      and not exists (select 1 from auth.users where id=old.created_by) then return new; end if;
  end if;
  raise exception 'Channel DNA history is immutable' using errcode='23514';
end $$;
alter function public.channel_dna_immutable() owner to postgres;
revoke all on function public.channel_dna_immutable() from public, anon, authenticated, service_role;
create trigger channel_dna_immutable before update or delete on public.channel_dna_versions
  for each row execute function public.channel_dna_immutable();

-- Existing table-wide channel UPDATE grants must not allow bypassing activation.
-- Save function is explicitly owned by postgres; request roles cannot set this identity.
create function public.channel_dna_guard_activation() returns trigger language plpgsql set search_path = '' as $$
begin
  if (TG_OP = 'INSERT' and new.active_dna_revision is not null)
    or (TG_OP = 'UPDATE' and new.active_dna_revision is distinct from old.active_dna_revision) then
    if current_user <> 'postgres' then
      raise exception 'Use the Channel DNA save operation' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger channel_dna_guard_activation before insert or update on public.channels
  for each row execute function public.channel_dna_guard_activation();

-- Only the authenticated server API may call this RPC with its verified user ID.
-- Full schema validation is performed by that API, never trusted to the browser.
create function public.save_channel_dna(
  p_channel_id uuid, p_actor_id uuid, p_expected_revision integer,
  p_document jsonb, p_lock_changes jsonb, p_change_note text
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  locked_workspace uuid;
  current_revision integer;
  next_revision integer;
  previous_doc jsonb;
  old_rule record;
  new_rule jsonb;
  new_section text;
  new_entry record;
  change_entry jsonb;
  was_locked boolean;
begin
  if p_actor_id is null then raise exception 'Channel not found' using errcode='42501'; end if;
  -- Workspace SHARE first (compatible between saves), then channel UPDATE.
  -- SHARE blocks workspace ownership changes/deletion, unlike KEY SHARE.
  select w.id into locked_workspace from public.workspaces w
    where w.id=(select c.workspace_id from public.channels c where c.id=p_channel_id)
      and w.owner_user_id=p_actor_id for share of w;
  if not found then raise exception 'Channel not found' using errcode='42501'; end if;
  select c.active_dna_revision into current_revision from public.channels c
    where c.id=p_channel_id and c.workspace_id=locked_workspace and not c.is_archived
    for update of c;
  if not found then raise exception 'Channel not found' using errcode='42501'; end if;
  if p_expected_revision is not null and p_expected_revision < 1 then
    raise exception 'Invalid expected revision' using errcode='22023';
  end if;
  if current_revision is distinct from p_expected_revision then
    raise exception 'DNA revision conflict' using errcode='40001';
  end if;
  if current_revision = 2147483647 then
    raise exception 'Terminal DNA revision reached' using errcode='54000';
  end if;
  if not public.channel_dna_structure(p_document,p_lock_changes)
    or p_change_note is null or length(p_change_note) > 500 then
    raise exception 'Invalid DNA document or lock changes' using errcode='22023';
  end if;
  select document into previous_doc from public.channel_dna_versions
    where channel_id=p_channel_id and revision=current_revision;
  for old_rule in
    select s.key as section, r.value as rule from jsonb_each(previous_doc->'sections') s
      cross join lateral jsonb_array_elements(s.value->'rules') r
  loop
    if (old_rule.rule->>'locked')::boolean then
      select r.value, s.key into new_rule, new_section from jsonb_each(p_document->'sections') s
        cross join lateral jsonb_array_elements(s.value->'rules') r
        where r.value->>'id'=old_rule.rule->>'id';
      if new_rule is null or new_section <> old_rule.section
        or (new_rule - 'locked') <> (old_rule.rule - 'locked') then
        raise exception 'Save an unlock before editing a locked rule' using errcode='40001';
      end if;
    end if;
  end loop;
  for new_entry in
    select r.value as rule from jsonb_each(p_document->'sections') s
      cross join lateral jsonb_array_elements(s.value->'rules') r
  loop
    select coalesce((r.value->>'locked')::boolean, false) into was_locked
      from jsonb_each(previous_doc->'sections') s cross join lateral jsonb_array_elements(s.value->'rules') r
      where r.value->>'id'=new_entry.rule->>'id';
    if coalesce(was_locked,false) is distinct from (new_entry.rule->>'locked')::boolean then
      if not exists (select 1 from jsonb_array_elements(p_lock_changes) x
        where x->>'id'=new_entry.rule->>'id' and x->'locked'=new_entry.rule->'locked') then
        raise exception 'Explicit lock change required' using errcode='22023';
      end if;
    end if;
  end loop;
  for change_entry in select value from jsonb_array_elements(p_lock_changes) loop
    select r.value into new_rule from jsonb_each(p_document->'sections') s
      cross join lateral jsonb_array_elements(s.value->'rules') r where r.value->>'id'=change_entry->>'id';
    select (r.value->>'locked')::boolean into was_locked from jsonb_each(previous_doc->'sections') s
      cross join lateral jsonb_array_elements(s.value->'rules') r where r.value->>'id'=change_entry->>'id';
    if new_rule is null or new_rule->'locked' is distinct from change_entry->'locked'
      or coalesce(was_locked,false) = (change_entry->>'locked')::boolean then
      raise exception 'Invalid lock change' using errcode='22023';
    end if;
  end loop;
  -- Recheck media ownership within the transaction. No storage reads or media writes.
  if exists (select 1 from jsonb_array_elements(p_document->'assets') a where not exists (
    select 1 from public.song_media_assets m join public.songs s on s.id=m.song_id
    where m.id=(a->>'mediaAssetId')::uuid and m.user_id=p_actor_id
      and s.user_id=p_actor_id and s.channel_id=p_channel_id
  )) then raise exception 'Asset not available in this channel' using errcode='42501'; end if;
  next_revision := coalesce(current_revision,0)+1;
  insert into public.channel_dna_versions(channel_id,revision,schema_version,document,created_by,change_note,lock_changes)
    values(p_channel_id,next_revision,1,p_document,p_actor_id,p_change_note,p_lock_changes);
  update public.channels set active_dna_revision=next_revision where id=p_channel_id;
  return next_revision;
end $$;
alter function public.save_channel_dna(uuid,uuid,integer,jsonb,jsonb,text) owner to postgres;
revoke all on function public.save_channel_dna(uuid,uuid,integer,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.save_channel_dna(uuid,uuid,integer,jsonb,jsonb,text) to service_role;
commit;
