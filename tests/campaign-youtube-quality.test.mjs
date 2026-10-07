import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('app/api/campaign-plan/route.ts','utf8');

test('first social generation with lyrics uses coordinated quality path',()=>{
  assert.match(source,/if\(!body\.force && \(existing \|\| !song\.lyrics\?\.trim\(\)\)\)/);
  assert.match(source,/120–220 words/);
  assert.match(source,/song-specific discovery hashtags/);
  assert.match(source,/15–25 useful non-repetitive YouTube search tags/);
});

test('coordinated YouTube Full refuses weak metadata before saving',()=>{
  assert.match(source,/hasNativeTitleScript\(youtubeFull\.recommendedTitle,song\.language\)/);
  assert.match(source,/wordCount\(youtubeFull\.fullDescription\)<100/);
  assert.match(source,/youtubeFull\.hashtags\.length<5/);
  assert.match(source,/youtubeFull\.tags\.length<15/);
});

test('creative description is cleaned before Channel DNA publishing assembly',()=>{
  assert.match(source,/cleanCreativeDescription\(str\(yf\.fullDescription\)/);
  assert.match(source,/applyChannelPublishing\(channelContext,song,'youtube_full',youtubeFull\)/);
});
