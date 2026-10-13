import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

test('local YouTube credentials encrypt, isolate channels and detect tampering', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'szu-youtube-test-'));

  try {
    const home = path.join(root, 'home');
    const worker = path.join(root, 'worker');
    const config = path.join(home, '.config', 'sunozara');
    const moduleDir = path.join(root, 'module');

    await mkdir(config, { recursive: true });
    await mkdir(moduleDir, { recursive: true });
    await writeFile(path.join(config, 'youtube.key'), randomBytes(32), { mode: 0o600 });

    const source = await readFile('utils/local-youtube/credentials.ts', 'utf8');
    const testSource = source
      .replace(/^import "server-only";\s*/m, '')
      .replaceAll('import os from "node:os";', 'import os from "node:os";')
      .replaceAll('import path from "node:path";', 'import path from "node:path";');

    const moduleFile = path.join(moduleDir, 'credentials.ts');
    await writeFile(moduleFile, testSource);

    const script = `
      import assert from 'node:assert/strict';
      import { readFile, writeFile } from 'node:fs/promises';
      import path from 'node:path';
      import {
        saveLocalYouTubeCredential,
        getLocalYouTubeCredential,
        listLocalYouTubeConnections
      } from './credentials.ts';

      const make = (id) => ({
        universeChannelId: id,
        youtubeChannelId: 'youtube-' + id,
        youtubeChannelTitle: 'Test ' + id,
        accessToken: 'dummy-access-' + id,
        refreshToken: 'dummy-refresh-' + id,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        scope: 'youtube.upload',
        connectedAt: new Date().toISOString()
      });

      await Promise.all([
        saveLocalYouTubeCredential(make('channel-a')),
        saveLocalYouTubeCredential(make('channel-b'))
      ]);

      assert.equal(
        (await getLocalYouTubeCredential('channel-a')).refreshToken,
        'dummy-refresh-channel-a'
      );
      assert.equal(
        (await getLocalYouTubeCredential('channel-b')).refreshToken,
        'dummy-refresh-channel-b'
      );

      const connections = await listLocalYouTubeConnections();
      assert.equal(connections.length, 2);
      assert.equal(JSON.stringify(connections).includes('dummy-refresh'), false);

      const file = path.join(
        process.env.SZU_WORKER_ROOT,
        'local-state/youtube/credentials.enc'
      );

      const encrypted = await readFile(file);
      assert.equal(encrypted.includes(Buffer.from('dummy-refresh')), false);

      encrypted[encrypted.length - 1] ^= 1;
      await writeFile(file, encrypted);

      await assert.rejects(getLocalYouTubeCredential('channel-a'));

      console.log('Encryption: PASS');
      console.log('Channel isolation: PASS');
      console.log('Concurrent saves: PASS');
      console.log('Token redaction: PASS');
      console.log('Tamper detection: PASS');
    `;

    await writeFile(path.join(moduleDir, 'test.mjs'), script);

    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'test.mjs'],
      {
        cwd: moduleDir,
        env: {
          ...process.env,
          HOME: home,
          SZU_WORKER_ROOT: worker,
          VERCEL: '',
          SZU_DISABLE_LOCAL_MODE: ''
        },
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Tamper detection: PASS/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
