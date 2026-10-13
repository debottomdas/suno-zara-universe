import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('cloud refresh and bootstrap preserve local edits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'szu-sync-test-'));

  try {
    const stateDir = path.join(root, 'local-state');
    await mkdir(stateDir);

    const initial = {
      schemaVersion: 1,
      syncedAt: null,
      workspace: { id: 'workspace-test' },
      channels: [{ id: 'channel-test', name: 'Test Channel' }],
      songsByChannel: {
        'channel-test': [
          {
            id: 'song-dirty',
            projectId: 'song-dirty',
            title: 'Locally Edited',
            projectState: 'completed',
            localDirty: true
          },
          {
            id: 'song-clean',
            projectId: 'song-clean',
            title: 'Old Cloud Title',
            projectState: 'current'
          }
        ]
      }
    };

    await writeFile(
      path.join(stateDir, 'workspace.json'),
      JSON.stringify(initial)
    );

    // Copy the store into the isolated test directory.
    // Remove only the Next.js server-only guard for Node execution.
    const source = await readFile(
      path.join(process.cwd(), 'utils/local-first/store.ts'),
      'utf8'
    );

    assert.match(source, /^import "server-only";/);

    await writeFile(
      path.join(root, 'store.ts'),
      source.replace(/^import "server-only";\\s*/, '')
        .replace(/^import "server-only";\s*/, '')
    );

    const script = `
      import { cacheSongs, replaceLocalWorkspace } from '${root}/store.ts';

      const cloudSongs = [
        { id: 'song-dirty', title: 'Cloud Version', projectState: 'current' },
        { id: 'song-clean', title: 'Updated Cloud Title', projectState: 'later' }
      ];

      await cacheSongs('channel-test', cloudSongs);

      await replaceLocalWorkspace({
        workspace: { id: 'workspace-test' },
        channels: [{ id: 'channel-test', name: 'Test Channel' }],
        songsByChannel: {
          'channel-test': [
            { id: 'song-clean', title: 'Bootstrap Title', projectState: 'later' }
          ]
        }
      });
    `;

    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        script
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SZU_WORKER_ROOT: root,
          SZU_DISABLE_LOCAL_MODE: '0',
          VERCEL: '0'
        },
        encoding: 'utf8'
      }
    );

    assert.equal(
      result.status,
      0,
      `Child process failed:\n${result.stderr}`
    );

    const saved = JSON.parse(
      await readFile(path.join(stateDir, 'workspace.json'), 'utf8')
    );

    const songs = saved.songsByChannel['channel-test'];
    const dirty = songs.find(song => song.id === 'song-dirty');
    const clean = songs.find(song => song.id === 'song-clean');

    assert.equal(dirty.projectState, 'completed');
    assert.equal(dirty.title, 'Locally Edited');
    assert.equal(dirty.localDirty, true);

    assert.equal(clean.title, 'Bootstrap Title');
    assert.equal(clean.projectState, 'later');

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bootstrap preserves a missing channel containing local edits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'szu-missing-channel-'));

  try {
    await mkdir(path.join(root, 'local-state'));

    const initial = {
      schemaVersion: 1,
      syncedAt: null,
      workspace: { id: 'workspace-test' },
      channels: [{ id: 'channel-local', name: 'Local Channel' }],
      songsByChannel: {
        'channel-local': [{
          id: 'song-local',
          projectId: 'song-local',
          title: 'Protected Song',
          projectState: 'completed',
          localDirty: true
        }]
      }
    };

    await writeFile(
      path.join(root, 'local-state/workspace.json'),
      JSON.stringify(initial)
    );

    const source = await readFile(
      path.join(process.cwd(), 'utils/local-first/store.ts'),
      'utf8'
    );

    await writeFile(
      path.join(root, 'store.ts'),
      source.replace(/^import "server-only";\s*/, '')
    );

    const script = `
      import { replaceLocalWorkspace } from '${root}/store.ts';

      await replaceLocalWorkspace({
        workspace: { id: 'workspace-test' },
        channels: [{ id: 'channel-cloud', name: 'Cloud Channel' }],
        songsByChannel: {
          'channel-cloud': []
        }
      });
    `;

    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SZU_WORKER_ROOT: root,
          SZU_DISABLE_LOCAL_MODE: '0',
          VERCEL: '0'
        },
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const saved = JSON.parse(
      await readFile(path.join(root, 'local-state/workspace.json'), 'utf8')
    );

    assert.ok(saved.channels.some(c => c.id === 'channel-local'));
    assert.ok(saved.channels.some(c => c.id === 'channel-cloud'));

    const protectedSong = saved.songsByChannel['channel-local'][0];
    assert.equal(protectedSong.title, 'Protected Song');
    assert.equal(protectedSong.projectState, 'completed');
    assert.equal(protectedSong.localDirty, true);

  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
