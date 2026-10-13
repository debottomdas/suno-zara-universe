import "server-only";

import os from "node:os";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  chmod,
} from "node:fs/promises";

const KEY_FILE = path.join(
  os.homedir(),
  ".config/sunozara/youtube.key"
);

const STORE_DIR = path.join(
  process.env.SZU_WORKER_ROOT ||
    path.join(os.homedir(), "Suno Zara Universe"),
  "local-state/youtube"
);

const STORE_FILE = path.join(STORE_DIR, "credentials.enc");

export type LocalYouTubeCredential = {
  universeChannelId: string;
  youtubeChannelId: string;
  youtubeChannelTitle: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
  connectedAt: string;
};

type CredentialStore = Record<string, LocalYouTubeCredential>;

function assertLocalRuntime() {
  if (
    process.env.VERCEL === "1" ||
    process.env.SZU_DISABLE_LOCAL_MODE === "1"
  ) {
    throw new Error("Local YouTube storage is unavailable.");
  }
}

async function encryptionKey(): Promise<Buffer> {
  const key = await readFile(KEY_FILE);
  if (key.length !== 32) {
    throw new Error("Invalid local YouTube encryption key.");
  }
  return key;
}

async function readStore(): Promise<CredentialStore> {
  assertLocalRuntime();

  let data: Buffer;
  try {
    data = await readFile(STORE_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  if (data.length < 29 || data[0] !== 1) {
    throw new Error("Invalid encrypted YouTube credential file.");
  }

  const iv = data.subarray(1, 13);
  const tag = data.subarray(13, 29);
  const encrypted = data.subarray(29);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    await encryptionKey(),
    iv
  );

  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString("utf8"));
}

async function writeStore(store: CredentialStore) {
  assertLocalRuntime();

  await mkdir(STORE_DIR, { recursive: true, mode: 0o700 });
  await chmod(STORE_DIR, 0o700);

  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    await encryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(store), "utf8"),
    cipher.final(),
  ]);

  const data = Buffer.concat([
    Buffer.from([1]),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]);

  const temporary = path.join(
    STORE_DIR,
    `credentials-${randomBytes(8).toString("hex")}.tmp`
  );

  await writeFile(temporary, data, { mode: 0o600, flag: "wx" });
  await rename(temporary, STORE_FILE);
  await chmod(STORE_FILE, 0o600);
}

let pendingWrite: Promise<void> = Promise.resolve();

export async function saveLocalYouTubeCredential(
  credential: LocalYouTubeCredential
) {
  if (
    !credential.universeChannelId ||
    !credential.youtubeChannelId ||
    !credential.refreshToken
  ) {
    throw new Error("Incomplete YouTube credential.");
  }

  const operation = pendingWrite.then(async () => {
    const store = await readStore();
    store[credential.universeChannelId] = credential;
    await writeStore(store);
  });

  pendingWrite = operation.then(
    () => undefined,
    () => undefined
  );

  return operation;
}

export async function getLocalYouTubeCredential(
  universeChannelId: string
): Promise<LocalYouTubeCredential | null> {
  const store = await readStore();
  return store[universeChannelId] || null;
}

export async function listLocalYouTubeConnections() {
  const store = await readStore();

  return Object.values(store).map((credential) => ({
    universeChannelId: credential.universeChannelId,
    youtubeChannelId: credential.youtubeChannelId,
    youtubeChannelTitle: credential.youtubeChannelTitle,
    connectedAt: credential.connectedAt,
  }));
}
