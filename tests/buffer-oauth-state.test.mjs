import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

const AUTHORITY =
  "https:" + "//suno-zara-universe.vercel.app";

const LOCAL_3000 =
  "http:" + "//localhost:3000";

const LOCAL_3002 =
  "http:" + "//localhost:3002";

const source = ts.transpileModule(
  fs.readFileSync(
    new URL("../utils/buffer-oauth-state.ts", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText;

const ctx = {
  exports: {},
  require: () => crypto,
  Buffer,
  URL,
  Date,
  process: {
    env: {
      BUFFER_CLIENT_SECRET: "test-secret",
    },
  },
};

vm.runInNewContext(source, ctx);

const {
  bufferAuthorityOrigin,
  bufferReturnOrigin,
  bufferReturnPath,
  createBufferState,
  validateBufferState,
} = ctx.exports;

test("uses the stable Vercel Buffer OAuth authority", () => {
  assert.equal(bufferAuthorityOrigin(), AUTHORITY);
});

for (const returnOrigin of [
  LOCAL_3000,
  LOCAL_3002,
  AUTHORITY,
]) {
  test(
    `preserves return origin, page, query, fragment and channel for ${returnOrigin}`,
    () => {
      const path = bufferReturnPath(
        "/music-next?projectId=song&channelId=wrong#publish",
        returnOrigin,
        "channel-a"
      );

      const state = createBufferState(
        returnOrigin,
        path,
        "channel-a",
        "user-a"
      );

      const data = validateBufferState(
        state,
        AUTHORITY + "/api/publishing/buffer/callback"
      );

      assert.equal(
        data.redirectUri,
        AUTHORITY + "/api/publishing/buffer/callback"
      );

      assert.equal(data.returnOrigin, returnOrigin);

      assert.equal(
        data.returnTo,
        "/music-next?projectId=song&channelId=channel-a#publish"
      );

      assert.equal(data.channelId, "channel-a");
      assert.equal(data.userId, "user-a");
    }
  );
}

test("callback validation only accepts the hosted authority", () => {
  const state = createBufferState(
    LOCAL_3000,
    "/music-next",
    "channel-a",
    "user-a"
  );

  assert.doesNotThrow(() =>
    validateBufferState(
      state,
      AUTHORITY + "/api/publishing/buffer/callback"
    )
  );

  assert.throws(() =>
    validateBufferState(
      state,
      LOCAL_3000 + "/api/publishing/buffer/callback"
    )
  );

  assert.throws(() =>
    validateBufferState(
      state,
      LOCAL_3002 + "/api/publishing/buffer/callback"
    )
  );
});

test("allows localhost on any port and HTTPS return origins", () => {
  for (const origin of [
    "http:" + "//localhost:3000",
    "http:" + "//localhost:3001",
    "http:" + "//localhost:3002",
    "http:" + "//127.0.0.1:47123",
    AUTHORITY,
    "https:" + "//example.test",
  ]) {
    assert.equal(bufferReturnOrigin(origin), origin);
  }
});

test("rejects unsafe return origins and open redirect paths", () => {
  for (const origin of [
    "http:" + "//evil.test",
    "ftp:" + "//example.test",
    "http:" + "//localhost.evil.test:3000",
  ]) {
    assert.throws(() => bufferReturnOrigin(origin));
  }

  for (const path of [
    "https:" + "//evil.test",
    "//evil.test",
    "/api/publishing/buffer/connect",
    "/\n/evil.test",
  ]) {
    assert.throws(() =>
      bufferReturnPath(path, LOCAL_3000, "channel-a")
    );
  }
});

test("rejects tampered signed state", () => {
  const state = createBufferState(
    LOCAL_3000,
    "/music-next",
    "channel-a",
    "user-a"
  );

  assert.throws(() =>
    validateBufferState(
      state + "x",
      AUTHORITY + "/api/publishing/buffer/callback"
    )
  );

  const [payload, mac] = state.split(".");
  const changed = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  );

  changed.channelId = "other";

  const tampered =
    Buffer.from(JSON.stringify(changed)).toString("base64url") +
    "." +
    mac;

  assert.throws(() =>
    validateBufferState(
      tampered,
      AUTHORITY + "/api/publishing/buffer/callback"
    )
  );
});

test("rejects expired signed state", () => {
  const state = createBufferState(
    LOCAL_3000,
    "/music-next",
    "channel-a",
    "user-a"
  );

  const realDate = ctx.Date;

  ctx.Date = {
    now: () => Date.now() + 601000,
  };

  assert.throws(() =>
    validateBufferState(
      state,
      AUTHORITY + "/api/publishing/buffer/callback"
    )
  );

  ctx.Date = realDate;
});
