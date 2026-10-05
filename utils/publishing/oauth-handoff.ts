import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export type OAuthHandoff = {
  v: 1;
  userId: string;
  channelId: string;
  returnOrigin: string;
  returnTo: string;
  exp: number;
  nonce: string;
};

function secret() {
  const value = process.env.OAUTH_HANDOFF_SECRET?.trim();

  if (!value) {
    throw new Error("OAUTH_HANDOFF_SECRET is not configured.");
  }

  return value;
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signature(payload: string) {
  return createHmac("sha256", secret())
    .update(payload)
    .digest("base64url");
}

export function createOAuthHandoff(
  input: Omit<OAuthHandoff, "v" | "exp" | "nonce">,
  ttlMs = 2 * 60 * 1000
) {
  const handoff: OAuthHandoff = {
    v: 1,
    ...input,
    exp: Date.now() + ttlMs,
    nonce: randomBytes(16).toString("base64url"),
  };

  const payload = encode(JSON.stringify(handoff));
  return `${payload}.${signature(payload)}`;
}

export function verifyOAuthHandoff(token: string): OAuthHandoff | null {
  try {
    const [payload, suppliedSignature, extra] = token.split(".");

    if (!payload || !suppliedSignature || extra) return null;

    const expectedSignature = signature(payload);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);

    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return null;
    }

    const parsed = JSON.parse(decode(payload)) as Partial<OAuthHandoff>;

    if (
      parsed.v !== 1 ||
      typeof parsed.userId !== "string" ||
      !parsed.userId ||
      typeof parsed.channelId !== "string" ||
      !parsed.channelId ||
      typeof parsed.returnOrigin !== "string" ||
      !parsed.returnOrigin ||
      typeof parsed.returnTo !== "string" ||
      !parsed.returnTo.startsWith("/") ||
      parsed.returnTo.startsWith("//") ||
      typeof parsed.exp !== "number" ||
      parsed.exp < Date.now() ||
      typeof parsed.nonce !== "string" ||
      !parsed.nonce
    ) {
      return null;
    }

    const origin = new URL(parsed.returnOrigin);

    const allowedReturnOrigin =
      origin.protocol === "https:" ||
      ((origin.hostname === "localhost" ||
        origin.hostname === "127.0.0.1") &&
        origin.protocol === "http:");

    if (!allowedReturnOrigin || origin.origin !== parsed.returnOrigin) {
      return null;
    }

    return parsed as OAuthHandoff;
  } catch {
    return null;
  }
}
