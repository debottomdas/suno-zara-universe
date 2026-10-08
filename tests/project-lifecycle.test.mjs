import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20261007_song_project_lifecycle.sql','utf8');
const songs=fs.readFileSync('app/api/songs/route.ts','utf8');
const lifecycle=fs.readFileSync('app/api/songs/lifecycle/route.ts','utf8');

test('project lifecycle is independent and constrained',()=>{
 assert.match(migration,/project_state text not null default 'current'/);
 assert.match(migration,/project_state in \('current', 'later', 'completed'\)/);
 assert.match(migration,/Independent of production status/);
});

test('new and loaded projects expose lifecycle without replacing production status',()=>{
 assert.match(songs,/status: song\.status/);
 assert.match(songs,/projectState: song\.project_state \|\| "current"/);
 assert.match(songs,/status:'creating', project_state:'current'/);
});

test('lifecycle mutation is channel and owner isolated',()=>{
 assert.match(lifecycle,/\.eq\('id',channelId\)\.eq\('workspaces\.owner_user_id',user\.id\)/);
 assert.match(lifecycle,/\.eq\('id',projectId\)\.eq\('user_id',user\.id\)\.eq\('channel_id',channel\.id\)/);
 assert.match(lifecycle,/update\(\{project_state:projectState,updated_at:updatedAt\}\)/);
 assert.doesNotMatch(lifecycle,/status\s*:/);
});

const music=fs.readFileSync('components/universe-next/MusicNext.tsx','utf8');

test('music UI exposes all lifecycle views and moves through isolated API',()=>{
 assert.match(music,/Current/);
 assert.match(music,/Future \/ Later/);
 assert.match(music,/Completed/);
 assert.match(music,/\/api\/songs\/lifecycle/);
 assert.match(music,/projectState:next/);
 assert.match(music,/visibleSongs/);
});

const deletion=fs.readFileSync('app/api/songs/delete/route.ts','utf8');

test('permanent delete requires exact channel ownership and title confirmation',()=>{
 assert.match(deletion,/channelId = String\(body\.channelId/);
 assert.match(deletion,/confirmation = String\(body\.confirmation/);
 assert.match(deletion,/\.eq\("channel_id", channelId\)/);
 assert.match(deletion,/confirmation !== ownedSong\.title/);
});

test('delete is project scoped and does not delete shared channel identity or connections',()=>{
 assert.doesNotMatch(deletion,/deleteRows\(admin, "channels"/);
 assert.doesNotMatch(deletion,/deleteRows\(admin, "channel_dna_versions"/);
 assert.doesNotMatch(deletion,/deleteRows\(admin, "publishing_connections"/);
 assert.doesNotMatch(deletion,/deleteRows\(admin, "publishing_oauth_credentials"/);
 assert.match(deletion,/\.from\("songs"\)\s*\.delete\(\)/);
});

test('delete UI warns that provider publications remain and requires exact title',()=>{
 assert.match(music,/Anything already published on YouTube or social platforms is NOT deleted there/);
 assert.match(music,/confirmation!==title/);
 assert.match(music,/Delete Project/);
});
