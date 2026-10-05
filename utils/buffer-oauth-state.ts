import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const BUFFER_CALLBACK_PATH = "/api/publishing/buffer/callback";
export const BUFFER_STATE_MAX_AGE = 600;

export const BUFFER_OAUTH_AUTHORITY_ORIGIN =
  process.env.BUFFER_OAUTH_AUTHORITY_ORIGIN ||
  "https://suno-zara-universe.vercel.app";

export function bufferAuthorityOrigin() {
  return new URL(BUFFER_OAUTH_AUTHORITY_ORIGIN).origin;
}

export function bufferReturnOrigin(value: string) {
  const origin = new URL(value);

  const allowed =
    origin.protocol === "https:" ||
    ((origin.hostname === "localhost" ||
      origin.hostname === "127.0.0.1") &&
      origin.protocol === "http:");

  if (!allowed || origin.origin !== value) {
    throw new Error("Unsupported Buffer OAuth return origin.");
  }

  return origin.origin;
}

export function bufferReturnPath(
  value: string | null,
  origin: string,
  channelId: string
) {
  const safeOrigin = bufferReturnOrigin(origin);
  const path = value || "/music-next?workspace=publish";

  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\\\r\n]/.test(path)
  ) {
    throw new Error("Invalid Buffer return path.");
  }

  const url = new URL(path, safeOrigin);

  if (
    url.origin !== safeOrigin ||
    url.pathname.startsWith("/api/")
  ) {
    throw new Error("Invalid Buffer return path.");
  }

  url.searchParams.set("channelId", channelId);

  return url.pathname + url.search + url.hash;
}

function signature(payload: string) {
  const secret = process.env.BUFFER_CLIENT_SECRET?.trim();

  if (!secret) {
    throw new Error("BUFFER_CLIENT_SECRET is not configured.");
  }

  return createHmac("sha256", secret)
    .update("buffer-oauth-state:" + payload)
    .digest();
}

export function createBufferState(
  returnOrigin: string,
  returnTo: string,
  channelId: string,
  userId: string
) {
  const authorityOrigin = bufferAuthorityOrigin();
  const safeReturnOrigin = bufferReturnOrigin(returnOrigin);
  const safeReturnTo = bufferReturnPath(
    returnTo,
    safeReturnOrigin,
    channelId
  );

  const payload = Buffer.from(
    JSON.stringify({
      authorityOrigin,
      returnOrigin: safeReturnOrigin,
      returnTo: safeReturnTo,
      channelId,
      userId,
      redirectUri: authorityOrigin + BUFFER_CALLBACK_PATH,
      expires: Date.now() + BUFFER_STATE_MAX_AGE * 1000,
      nonce: randomBytes(32).toString("base64url"),
    })
  ).toString("base64url");

  return payload + "." + signature(payload).toString("base64url");
}

export function validateBufferState(
  state: string,
  requestUrl: string
) {
  const [payload, mac, extra] = state.split(".");

  if (!payload || !mac || extra) {
    throw new Error("Invalid OAuth state.");
  }

  const actual = Buffer.from(mac, "base64url");
  const expected = signature(payload);

  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new Error("Invalid OAuth signature.");
  }

  const data = JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8")
  );

  const authorityOrigin = bufferAuthorityOrigin();
  const callbackOrigin = new URL(requestUrl).origin;

  if (
    callbackOrigin !== authorityOrigin ||
    data.authorityOrigin !== authorityOrigin ||
    data.redirectUri !== authorityOrigin + BUFFER_CALLBACK_PATH ||
    typeof data.expires !== "number" ||
    data.expires <= Date.now() ||
    !data.nonce ||
    typeof data.userId !== "string" ||
    !data.userId ||
    typeof data.channelId !== "string" ||
    !data.channelId ||
    typeof data.returnOrigin !== "string" ||
    bufferReturnOrigin(data.returnOrigin) !== data.returnOrigin ||
    typeof data.returnTo !== "string" ||
    bufferReturnPath(
      data.returnTo,
      data.returnOrigin,
      data.channelId
    ) !== data.returnTo
  ) {
    throw new Error("Invalid OAuth context.");
  }

  return data as {
    authorityOrigin: string;
    returnOrigin: string;
    redirectUri: string;
    returnTo: string;
    channelId: string;
    userId: string;
  };
}
