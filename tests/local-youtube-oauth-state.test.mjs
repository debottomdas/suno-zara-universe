import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

test("local OAuth sessions are single-use and expire", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "szu-oauth-test-"));

  try {
    const moduleDir = path.join(root, "module");
    const workerRoot = path.join(root, "worker");
    await mkdir(moduleDir);

    const source = await readFile(
      "utils/local-youtube/oauth-state.ts",
      "utf8"
    );

    await writeFile(
      path.join(moduleDir, "oauth-state.ts"),
      source.replace(/^import "server-only";\s*/m, "")
    );

    await writeFile(
      path.join(moduleDir, "test.mjs"),
      `
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createLocalOAuthSession,
  takeLocalOAuthSession
} from "./oauth-state.ts";

const channelId = "test-channel";
const verifier = "dummy-pkce-verifier";

const state = await createLocalOAuthSession(channelId, verifier);
const session = await takeLocalOAuthSession(state);

assert.equal(session.universeChannelId, channelId);
assert.equal(session.verifier, verifier);
assert.equal(await takeLocalOAuthSession(state), null);

const expiredState = await createLocalOAuthSession(channelId, verifier);
const hash = createHash("sha256").update(expiredState).digest("hex");
const file = path.join(
  process.env.SZU_WORKER_ROOT,
  "local-state/youtube/oauth-sessions",
  hash + ".json"
);

const expired = JSON.parse(await readFile(file, "utf8"));
expired.createdAt = Date.now() - 11 * 60 * 1000;
await writeFile(file, JSON.stringify(expired));

assert.equal(await takeLocalOAuthSession(expiredState), null);

console.log("Session creation: PASS");
console.log("Single-use protection: PASS");
console.log("Expiration: PASS");
`
    );

    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "test.mjs"],
      {
        cwd: moduleDir,
        env: {
          ...process.env,
          SZU_WORKER_ROOT: workerRoot,
          VERCEL: "",
        },
        encoding: "utf8",
      }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Expiration: PASS/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
