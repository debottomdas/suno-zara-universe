import "server-only";
import os from "node:os";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";

const ROOT = process.env.SZU_WORKER_ROOT || path.join(os.homedir(), "Suno Zara Universe");
const DIR = path.join(ROOT, "local-state", "buffer");
const FILE = path.join(DIR, "credentials.enc");
const KEY = path.join(os.homedir(), ".config", "sunozara", "buffer.key");
type Entry = { apiKey: string; connectedAt: string };
type Store = Record<string, Entry>;
function guard() {
  if (process.env.VERCEL === "1" || process.env.SZU_DISABLE_LOCAL_MODE === "1") throw new Error("Local Buffer disabled");
}
async function key(): Promise<Buffer> {
  await mkdir(path.dirname(KEY), { recursive: true, mode: 0o700 });
  let bytes: Buffer;
  try { bytes = await readFile(KEY); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    try { await writeFile(KEY, randomBytes(32), { mode: 0o600, flag: "wx" }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err; }
    bytes = await readFile(KEY);
  }
  if (bytes.length !== 32) throw new Error("Invalid encryption key");
  await chmod(KEY, 0o600);
  return bytes;
}
async function read(): Promise<Store> {
  guard();
  let data: Buffer;
  try { data = await readFile(FILE); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}; throw e; }
  if (data.length < 29 || data[0] !== 1) throw new Error("Invalid Buffer credential store");
  const decipher = createDecipheriv("aes-256-gcm", await key(), data.subarray(1, 13));
  decipher.setAuthTag(data.subarray(13, 29));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString("utf8")) as Store;
}
let queue: Promise<void> = Promise.resolve();
export async function saveBufferKey(channelId: string, apiKey: string) {
  guard();
  const task = queue.then(async () => {
    const store = await read();
    store[channelId] = { apiKey, connectedAt: new Date().toISOString() };
    await mkdir(DIR, { recursive: true, mode: 0o700 });
    await chmod(DIR, 0o700);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", await key(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(store)), cipher.final()]);
    const temp = path.join(DIR, "credentials-" + randomBytes(8).toString("hex") + ".tmp");
    await writeFile(temp, Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]), { mode: 0o600, flag: "wx" });
    await rename(temp, FILE);
    await chmod(FILE, 0o600);
  });
  queue = task.then(() => undefined, () => undefined);
  await task;
}
export async function getBufferKey(channelId: string) { return (await read())[channelId]?.apiKey || null; }
export async function listBufferConnections() {
  const store = await read();
  return Object.entries(store).map(([universeChannelId, entry]) => ({ universeChannelId, connectedAt: entry.connectedAt }));
}
