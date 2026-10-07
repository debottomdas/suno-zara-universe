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
