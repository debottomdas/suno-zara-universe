import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('YouTube Full generation is centralized in the shared generator', () => {
  const generator = read('utils/social/youtube-full-generator.ts');
  const route = read('app/api/social-media/youtube-full/route.ts');

  assert.match(generator, /export async function generateYouTubeFullPack/);
  assert.match(generator, /Before writing metadata, understand the song from the supplied full lyrics/);
  assert.match(generator, /roughly 120 to 220 words/);
  assert.match(generator, /5 to 10 useful SONG-SPECIFIC discovery hashtags/);
  assert.match(generator, /15 to 25 useful YouTube search tags/);
  assert.match(route, /generateYouTubeFullPack\(\{/);
  assert.doesNotMatch(route, /const systemPrompt = `/);
});

test('Social Copy uses shared intelligence only for YouTube Full regeneration', () => {
  const route = read('app/api/social-copy/route.ts');

  assert.match(route, /if\(platform==='youtube_full'\)\{/);
  assert.match(route, /generateYouTubeFullPack\(\{song,channelContext:dna/);
  assert.match(route, /\}else\{\s*const response=await new OpenAI/);
  assert.match(route, /Suggest revised social copy for one post/);
  assert.match(route, /confirmPaid!==true/);
  assert.match(route, /saveVersion\(/);
});

test('YouTube Full regeneration preserves publishing state and maps generated release copy', () => {
  const route = read('app/api/social-copy/route.ts');

  assert.match(
    route,
    /const regenerated=\{\s*\.\.\.original,\s*\.\.\.generated\.youtubeFull,/
  );

  assert.match(
    route,
    /title:generated\.youtubeFull\.recommendedTitle\|\|original\.title/
  );

  assert.match(
    route,
    /description:generated\.youtubeFull\.finalDescription\|\|original\.description/
  );

  assert.match(
    route,
    /proposed=validateCopy\(original,regenerated\)/
  );

  assert.doesNotMatch(
    route,
    /validateCopy\(original,generated\.youtubeFull\)/
  );
});

test('Social copy editor hides publishing internals while preserving creative fields', () => {
  const copy = read('utils/social/copy.ts');
  for (const key of ['channelId','dnaRevision','categoryId','privacyStatus','defaultLanguage','destinationIds','playlistIds','playlistApplication','relatedVideo','releaseDetails']) {
    assert.match(copy, new RegExp(`['\"]${key}['\"]`));
  }
});

test('Publishing identity supports deterministic platform CTAs', () => {
  const model = read('utils/channel-dna/model.ts');
  const social = read('utils/channel-dna/social.ts');
  for (const key of ['instagramFullSongCta','tiktokFullSongCta','facebookFullSongCta','youtubeShortsCta','youtubeShortsFallbackCta','youtubeFullCta']) {
    assert.match(model, new RegExp(key));
  }
  assert.match(social, /Listen to the full song on YouTube — link in bio\./);
  assert.match(social, /Watch the full song — tap the related video\./);
  assert.match(social, /Subscribe for more Suno Zara originals\./);
  assert.match(social, /appendOnce/);
});

test('YouTube discovery metadata is deterministically normalized', () => {
  const generator = read('utils/social/youtube-full-generator.ts');
  assert.match(generator, /normalizeYouTubeDiscovery/);
  assert.match(generator, /seo\.map\(hashtagFrom\)/);
  assert.match(generator, /tags\.map\(hashtagFrom\)/);
  assert.match(generator, /hashtags: discovery\.hashtags/);
  assert.match(generator, /tags: discovery\.tags/);
});


test('YouTube Full enforces native title and release-quality metadata', () => {
  const generator = read('utils/social/youtube-full-generator.ts');
  const route = read('app/api/social-media/youtube-full/route.ts');
  const social = read('utils/channel-dna/social.ts');

  assert.match(route, /english_title,/);
  assert.match(generator, /song title in its native script/);
  assert.match(generator, /hasNativeTitleScript/);
  assert.match(generator, /wordCount\(youtubeFull\.fullDescription\) < 100/);
  assert.match(generator, /youtubeFull\.hashtags\.length < 5/);
  assert.match(generator, /youtubeFull\.tags\.length < 15/);
  assert.match(generator, /cleanCreativeDescription/);
  assert.match(social, /split\('\|'\)\[0\]/);
  assert.match(social, /englishTitle:song\.english_title\|\|song\.title/);
});
