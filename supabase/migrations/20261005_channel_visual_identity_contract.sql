-- V5.29B1.1: optional visual identity and existing publishing contract alignment.
-- Unreleased forward migration; apply separately after review.
-- No data updates; existing RPC, constraints, ownership and revisions are retained.
begin;
create or replace function public.channel_dna_structure(d jsonb, changes jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  section_name text;
  section_value jsonb;
  fields text[];
  allowed_fields text[];
  item jsonb;
  ids text[] := '{}';
  asset_ids text[] := '{}';
  change_ids text[] := '{}';
  stage jsonb;
  identity_value jsonb;
  layout_value jsonb;
  group_value jsonb;
  layout_name text;
  group_name text;
  key_name text;
  allowed_keys text[];
  required_keys text[];
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
    if not (section_value ?& array['fields','rules']) or section_value - (case when section_name = 'visual' then array['fields','rules','identity'] else array['fields','rules'] end) <> '{}'::jsonb
      or jsonb_typeof(section_value->'fields') is distinct from 'object'
      or jsonb_typeof(section_value->'rules') is distinct from 'array' then return false; end if;
    -- The original eight publishing keys remain required. Existing application
    -- extensions are optional strings; every other section keeps its exact keys.
    allowed_fields := fields;
    if section_name = 'publishing' then
      allowed_fields := fields || array['shortTitleTemplate','shortDescriptionTemplate','footer','defaultPlaylistIds','shortPlaylistIds','privacyStatus','defaultLanguage','destinationIds','relatedVideoPolicy'];
    end if;
    if not (section_value->'fields' ?& fields) or (section_value->'fields') - allowed_fields <> '{}'::jsonb then return false; end if;
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
  -- Identity is opt-in: never insert defaults or rewrite historical documents.
  if (d->'sections'->'visual') ? 'identity' then
    identity_value := d->'sections'->'visual'->'identity';
    if jsonb_typeof(identity_value) is distinct from 'object' then return false; end if;
    if not (identity_value ?& array['branding','title','subtitles'])
      or identity_value - array['branding','title','subtitles','landscape','portrait'] <> '{}'::jsonb then return false; end if;
    foreach layout_name in array array['base','landscape','portrait'] loop
      if layout_name = 'base' then layout_value := identity_value;
      elsif identity_value ? layout_name then layout_value := identity_value->layout_name;
      else continue;
      end if;
      if jsonb_typeof(layout_value) is distinct from 'object' then return false; end if;
      if layout_name <> 'base' and layout_value - array['branding','title','subtitles'] <> '{}'::jsonb then return false; end if;
      foreach group_name in array array['branding','title','subtitles'] loop
        if not (layout_value ? group_name) then continue; end if;
        group_value := layout_value->group_name;
        if jsonb_typeof(group_value) is distinct from 'object' then return false; end if;
        allowed_keys := case group_name
          when 'branding' then array['enabled','position','opacity','size','horizontalMargin','verticalMargin']
          when 'title' then array['enabled','showRomanTitle','position','style','durationSeconds']
          else array['enabled','position','style','size','highlight'] end;
        if layout_name = 'base' then
          required_keys := allowed_keys;
        else
          allowed_keys := case when group_name = 'branding' then array['position','horizontalMargin','verticalMargin'] else array['position'] end;
          required_keys := array[]::text[];
        end if;
        if not (group_value ?& required_keys) or group_value - allowed_keys <> '{}'::jsonb then return false; end if;
        for key_name in select jsonb_object_keys(group_value) loop
          if key_name in ('enabled','showRomanTitle') then
            if jsonb_typeof(group_value->key_name) is distinct from 'boolean' then return false; end if;
          elsif key_name in ('opacity','horizontalMargin','verticalMargin','durationSeconds') then
            if jsonb_typeof(group_value->key_name) is distinct from 'number' then return false; end if;
            if key_name = 'opacity' and ((group_value->>key_name)::numeric < 0 or (group_value->>key_name)::numeric > 1) then return false; end if;
            if key_name in ('horizontalMargin','verticalMargin') and ((group_value->>key_name)::numeric < 0 or (group_value->>key_name)::numeric > 500) then return false; end if;
            if key_name = 'durationSeconds' and ((group_value->>key_name)::numeric <= 0 or (group_value->>key_name)::numeric > 30) then return false; end if;
          else
            if jsonb_typeof(group_value->key_name) is distinct from 'string' then return false; end if;
            if key_name = 'position' then
              if group_name = 'branding' and (group_value->>key_name) not in ('top-left','top-right','bottom-left','bottom-centre','bottom-right') then return false; end if;
              if group_name = 'title' and (group_value->>key_name) not in ('upper-centre','centre','lower-centre') then return false; end if;
              if group_name = 'subtitles' and (group_value->>key_name) not in ('centre','lower-middle','lower') then return false; end if;
            elsif key_name = 'size' then
              if (group_value->>key_name) not in ('small','medium','large') then return false; end if;
            elsif key_name = 'style' then
              if group_name = 'title' and (group_value->>key_name) not in ('clean','cinematic','minimal') then return false; end if;
              if group_name = 'subtitles' and (group_value->>key_name) not in ('clean','backed','cinematic') then return false; end if;
            elsif key_name = 'highlight' then
              if (group_value->>key_name) not in ('none','current-phrase') then return false; end if;
            end if;
          end if;
        end loop;
      end loop;
    end loop;
  end if;
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
commit;
