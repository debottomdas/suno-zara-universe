-- Focused contract assertions. Run ONLY in a disposable local database after migration.
-- Calls the validator only; no tables or data are changed.
begin;
do $$
declare
  legacy jsonb := '{"schemaVersion":1,"sections":{"core":{"fields":{"purpose":"","tone":"","audience":"","languagePhilosophy":"","culturalDirection":""},"rules":[]},"musical":{"fields":{"genres":"","vocals":"","instrumentation":"","arrangement":"","production":"","pronunciation":"","experimentation":""},"rules":[]},"visual":{"fields":{"brandText":"","typography":"","colours":"","direction":"","thumbnail":"","watermark":"","subtitles":"","intro":"","outro":""},"rules":[]},"publishing":{"fields":{"titleTemplate":"","descriptionTemplate":"","credits":"","fixedHashtags":"","userFixedHashtags":"","tags":"","category":"","links":""},"rules":[]}},"assets":[]}'::jsonb;
  identity_value jsonb := '{"branding":{"enabled":true,"position":"bottom-right","opacity":0.65,"size":"medium","horizontalMargin":60,"verticalMargin":60},"title":{"enabled":true,"showRomanTitle":true,"position":"centre","style":"cinematic","durationSeconds":5},"subtitles":{"enabled":true,"position":"lower-middle","style":"clean","size":"medium","highlight":"none"}}'::jsonb;
  current_document jsonb := '{"schemaVersion":1,"sections":{"core":{"fields":{"purpose":"","tone":"","audience":"","languagePhilosophy":"","culturalDirection":""},"rules":[]},"musical":{"fields":{"genres":"","vocals":"","instrumentation":"","arrangement":"","production":"","pronunciation":"","experimentation":""},"rules":[]},"visual":{"fields":{"brandText":"","typography":"","colours":"","direction":"","thumbnail":"","watermark":"","subtitles":"","intro":"","outro":""},"rules":[]},"publishing":{"fields":{"titleTemplate":"","descriptionTemplate":"","credits":"","fixedHashtags":"","userFixedHashtags":"","tags":"","category":"","links":"","shortTitleTemplate":"","shortDescriptionTemplate":"","footer":"","defaultPlaylistIds":"","shortPlaylistIds":"","privacyStatus":"","defaultLanguage":"","destinationIds":"","relatedVideoPolicy":""},"rules":[]}},"assets":[]}'::jsonb;
  field_name text;
  wrong_value jsonb;
  valid jsonb;
  candidate jsonb;
  bad record;
begin
  if not public.channel_dna_structure(legacy, '[]'::jsonb) then raise exception 'Legacy document rejected'; end if;
  if not public.channel_dna_structure(current_document, '[]'::jsonb) then raise exception 'Current 17-key application document rejected'; end if;
  foreach field_name in array array['shortTitleTemplate','shortDescriptionTemplate','footer','defaultPlaylistIds','shortPlaylistIds','privacyStatus','defaultLanguage','destinationIds','relatedVideoPolicy'] loop
    candidate := jsonb_set(current_document, '{sections,publishing,fields}', (current_document->'sections'->'publishing'->'fields') - field_name);
    if not public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Optional publishing field required: %', field_name; end if;
    candidate := jsonb_set(legacy, array['sections','publishing','fields',field_name], '"configured"'::jsonb);
    if not public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Individual optional publishing string rejected: %', field_name; end if;
    for wrong_value in select value from jsonb_array_elements('[null,true,1,{},[]]'::jsonb) loop
      candidate := jsonb_set(current_document, array['sections','publishing','fields',field_name], wrong_value);
      if public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Wrong publishing type accepted: %, %', field_name, wrong_value; end if;
    end loop;
  end loop;
  foreach field_name in array array['titleTemplate','descriptionTemplate','credits','fixedHashtags','userFixedHashtags','tags','category','links'] loop
    candidate := jsonb_set(current_document, '{sections,publishing,fields}', (current_document->'sections'->'publishing'->'fields') - field_name);
    if public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Required publishing field omitted: %', field_name; end if;
  end loop;
  candidate := jsonb_set(current_document, '{sections,publishing,fields,unknownField}', '""'::jsonb);
  if public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Unknown 18th publishing key accepted'; end if;
  valid := jsonb_set(current_document, '{sections,visual,identity}', identity_value);
  if not public.channel_dna_structure(valid, '[]'::jsonb) then raise exception 'Valid identity with current 17-key publishing rejected'; end if;
  candidate := jsonb_set(valid, '{sections,visual,identity}', identity_value || '{"landscape":{"branding":{"position":"top-left","horizontalMargin":0,"verticalMargin":500},"title":{"position":"upper-centre"}},"portrait":{"subtitles":{"position":"lower"}}}'::jsonb);
  if not public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Valid partial overrides rejected'; end if;
  -- All mutations merge at the group level so absent nested parents cannot hide a test.
  for bad in select * from (values
    ('{"branding":{"enabled":true,"position":"centre","opacity":0.65,"size":"medium","horizontalMargin":60,"verticalMargin":60}}'::jsonb),
    ('{"branding":{"enabled":true,"position":"bottom-right","opacity":-0.1,"size":"medium","horizontalMargin":60,"verticalMargin":60}}'::jsonb),
    ('{"branding":{"enabled":true,"position":"bottom-right","opacity":1.1,"size":"medium","horizontalMargin":60,"verticalMargin":60}}'::jsonb),
    ('{"branding":{"enabled":true,"position":"bottom-right","opacity":0.65,"size":"medium","horizontalMargin":-1,"verticalMargin":60}}'::jsonb),
    ('{"branding":{"enabled":true,"position":"bottom-right","opacity":0.65,"size":"medium","horizontalMargin":60,"verticalMargin":501}}'::jsonb),
    ('{"branding":{"enabled":true,"position":"bottom-right","opacity":0.65,"size":"medium","horizontalMargin":"60","verticalMargin":60}}'::jsonb),
    ('{"title":{"enabled":true,"showRomanTitle":true,"position":"centre","style":"cinematic","durationSeconds":0}}'::jsonb),
    ('{"title":{"enabled":true,"showRomanTitle":true,"position":"centre","style":"cinematic","durationSeconds":31}}'::jsonb),
    ('{"title":{"enabled":true,"showRomanTitle":true,"position":"centre","style":"backed","durationSeconds":5}}'::jsonb),
    ('{"title":{"enabled":"true","showRomanTitle":true,"position":"centre","style":"cinematic","durationSeconds":5}}'::jsonb),
    ('{"subtitles":{"enabled":true,"position":"bottom-right","style":"clean","size":"medium","highlight":"none"}}'::jsonb),
    ('{"subtitles":{"enabled":true,"position":"lower-middle","style":"minimal","size":"medium","highlight":"none"}}'::jsonb),
    ('{"subtitles":{"enabled":true,"position":"lower-middle","style":"clean","size":"medium","highlight":"word"}}'::jsonb),
    ('{"subtitles":{"enabled":true,"position":"lower-middle","style":"clean","size":"huge","highlight":"none"}}'::jsonb),
    ('{"branding":{"enabled":true,"position":"bottom-right","opacity":0.65,"size":"medium","horizontalMargin":60,"verticalMargin":60,"extra":true}}'::jsonb),
    ('{"extra":{}}'::jsonb),
    ('{"landscape":{"branding":{"opacity":0.5}}}'::jsonb),
    ('{"portrait":{"title":{"style":"clean"}}}'::jsonb)
  ) as cases(patch) loop
    candidate := jsonb_set(valid, '{sections,visual,identity}', identity_value || bad.patch);
    if public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Invalid identity accepted: %', bad.patch; end if;
  end loop;
  candidate := jsonb_set(valid, '{sections,visual,identity,branding}', (identity_value->'branding') - 'enabled');
  if public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Missing base setting accepted'; end if;
  candidate := jsonb_set(valid, '{sections,visual,identity}', 'null'::jsonb);
  if public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Null identity accepted'; end if;
  candidate := jsonb_set(valid, '{sections,core,identity}', identity_value);
  if public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Unrelated section loosened'; end if;
  candidate := jsonb_set(valid, '{sections,visual,fields,watermark}', 'true'::jsonb);
  if public.channel_dna_structure(candidate, '[]'::jsonb) then raise exception 'Existing field type loosened'; end if;
  raise notice 'Visual identity contract assertions passed';
end $$;
rollback;
