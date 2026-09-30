import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const BUFFER_CALLBACK_PATH = "/api/publishing/buffer/callback";
export const BUFFER_STATE_MAX_AGE = 600;
const ORIGINS = new Set(["http://localhost:3002", "https://suno-zara-universe.vercel.app"]);
export function bufferOrigin(requestUrl: string) {
  const origin = new URL(requestUrl).origin;
  if (!ORIGINS.has(origin)) throw new Error("Unsupported Buffer OAuth origin.");
  return origin;
}
export function bufferReturnPath(value: string | null, origin: string, channelId: string) {
  const path = value || "/music-next?workspace=publish";
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path)) throw new Error("Invalid Buffer return path.");
  const url = new URL(path, origin);
  if (url.origin !== origin || url.pathname.startsWith("/api/")) throw new Error("Invalid Buffer return path.");
  url.searchParams.set("channelId", channelId);
  return url.pathname + url.search + url.hash;
}
function signature(payload: string) {
  const secret = process.env.BUFFER_CLIENT_SECRET?.trim();
  if (!secret) throw new Error("BUFFER_CLIENT_SECRET is not configured.");
  return createHmac("sha256", secret).update("buffer-oauth-state:" + payload).digest();
}
export function createBufferState(origin: string, returnTo: string, channelId: string, userId: string) {
  bufferOrigin(origin);
  const payload = Buffer.from(JSON.stringify({ origin, returnTo: bufferReturnPath(returnTo, origin, channelId), channelId, userId,
    redirectUri: origin + BUFFER_CALLBACK_PATH, expires: Date.now() + BUFFER_STATE_MAX_AGE * 1000, nonce: randomBytes(32).toString("base64url") })).toString("base64url");
  return payload + "." + signature(payload).toString("base64url");
}
export function validateBufferState(state: string, requestUrl: string) {
  const [payload, mac, extra] = state.split(".");
  if (!payload || !mac || extra) throw new Error("Invalid OAuth state.");
  const actual = Buffer.from(mac, "base64url"), expected = signature(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid OAuth signature.");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const origin = bufferOrigin(requestUrl);
  if (data.origin !== origin || data.redirectUri !== origin + BUFFER_CALLBACK_PATH ||
      typeof data.expires !== "number" || data.expires <= Date.now() || !data.nonce ||
      typeof data.userId !== "string" || !data.userId || typeof data.channelId !== "string" || !data.channelId ||
      typeof data.returnTo !== "string" || bufferReturnPath(data.returnTo, origin, data.channelId) !== data.returnTo) throw new Error("Invalid OAuth context.");
  return data as { origin: string; redirectUri: string; returnTo: string; channelId: string; userId: string };
}
