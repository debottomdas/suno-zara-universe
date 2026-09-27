export type BufferService = "tiktok" | "instagram" | "facebook";

export type BufferChannel = {
  id: string;
  name: string;
  service: string;
  organizationId?: string;
  organizationName?: string;
};

export type BufferRateWindow = {
  name: string;
  remaining: number;
  resetSeconds: number;
  quota?: number;
  windowSeconds?: number;
};

export type BufferRateLimitSnapshot = {
  windows: BufferRateWindow[];
  capturedAt: string;
};

const CHANNEL_CACHE_MS = 10 * 60 * 1000;
let channelCache: { expiresAt: number; channels: BufferChannel[] } | null = null;
let lastRateLimit: BufferRateLimitSnapshot | null = null;

function apiKey() {
  return String(process.env.BUFFER_API_KEY || "").trim();
}

export function bufferConfigured() {
  return Boolean(apiKey());
}

function splitRepeatedHeader(value: string | null) {
  return String(value || "")
    .split(/,\s*(?=")/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRateLimitHeaders(headers: Headers): BufferRateLimitSnapshot | null {
  const live = splitRepeatedHeader(headers.get("ratelimit"));
  const policies = splitRepeatedHeader(headers.get("ratelimit-policy"));
  if (!live.length) return null;

  const policyByName = new Map<string, { quota?: number; windowSeconds?: number }>();
  for (const item of policies) {
    const name = item.match(/"([^"]+)"/)?.[1] || "";
    if (!name) continue;
    const quota = Number(item.match(/(?:^|;)\s*q=(\d+)/)?.[1]);
    const windowSeconds = Number(item.match(/(?:^|;)\s*w=(\d+)/)?.[1]);
    policyByName.set(name, {
      quota: Number.isFinite(quota) ? quota : undefined,
      windowSeconds: Number.isFinite(windowSeconds) ? windowSeconds : undefined,
    });
  }

  const windows = live
    .map((item, index) => {
      const name = item.match(/"([^"]+)"/)?.[1] || `window-${index + 1}`;
      const remaining = Number(item.match(/(?:^|;)\s*r=(\d+)/)?.[1]);
      const resetSeconds = Number(item.match(/(?:^|;)\s*t=(\d+)/)?.[1]);
      const policy = policyByName.get(name) || {};
      const fallbackPolicy = policies[index] || "";
      const fallbackQuota = Number(fallbackPolicy.match(/(?:^|;)\s*q=(\d+)/)?.[1]);
      const fallbackWindow = Number(fallbackPolicy.match(/(?:^|;)\s*w=(\d+)/)?.[1]);
      return {
        name,
        remaining: Number.isFinite(remaining) ? remaining : 0,
        resetSeconds: Number.isFinite(resetSeconds) ? resetSeconds : 0,
        quota: policy.quota ?? (Number.isFinite(fallbackQuota) ? fallbackQuota : undefined),
        windowSeconds: policy.windowSeconds ?? (Number.isFinite(fallbackWindow) ? fallbackWindow : undefined),
      } satisfies BufferRateWindow;
    })
    .sort((a, b) => (a.windowSeconds || Number.MAX_SAFE_INTEGER) - (b.windowSeconds || Number.MAX_SAFE_INTEGER));

  return { windows, capturedAt: new Date().toISOString() };
}

function rememberRateLimit(headers: Headers) {
  const parsed = parseRateLimitHeaders(headers);
  if (parsed) lastRateLimit = parsed;
  return parsed;
}

export function getBufferRateLimit() {
  return lastRateLimit;
}

export function bufferRateLimitIsLow(threshold = 0.1) {
  const snapshot = lastRateLimit;
  if (!snapshot) return false;
  return snapshot.windows.some((window) => {
    if (!window.quota || window.quota <= 0) return window.remaining <= 5;
    return window.remaining <= Math.max(1, Math.floor(window.quota * threshold));
  });
}

export function assertBufferBudget() {
  const snapshot = lastRateLimit;
  if (!snapshot || !bufferRateLimitIsLow()) return;
  const tightest = [...snapshot.windows]
    .filter((window) => window.quota)
    .sort((a, b) => a.remaining / Math.max(1, a.quota || 1) - b.remaining / Math.max(1, b.quota || 1))[0];
  if (!tightest) return;
  const minutes = Math.max(1, Math.ceil(tightest.resetSeconds / 60));
  throw new Error(`Buffer API quota is running low (${tightest.remaining}/${tightest.quota} left). Universe paused this request. Try again after about ${minutes} minute${minutes === 1 ? "" : "s"}.`);
}

export async function bufferGraphqlDetailed<T>(query: string, variables: Record<string, unknown> = {}, accessToken?: string) {
  const key = String(accessToken || apiKey()).trim();
  if (!key) throw new Error("BUFFER_API_KEY is not configured.");

  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const rateLimit = rememberRateLimit(response.headers);
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    errors?: Array<{ message?: string; extensions?: { code?: string; window?: string } }>;
  };

  if (response.status === 429) {
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60;
    const minutes = Math.max(1, Math.ceil(wait / 60));
    throw new Error(`Buffer API rate limit reached. Universe stopped automatically. Retry after about ${minutes} minute${minutes === 1 ? "" : "s"}.`);
  }
  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.message || `Buffer API request failed (HTTP ${response.status}).`);
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((item) => item.message).filter(Boolean).join("; ") || "Buffer API request failed.");
  }
  if (!payload.data) throw new Error("Buffer API returned no data.");
  return { data: payload.data, rateLimit };
}

export async function bufferGraphql<T>(query: string, variables: Record<string, unknown> = {}, accessToken?: string) {
  return (await bufferGraphqlDetailed<T>(query, variables, accessToken)).data;
}

export async function loadBufferChannels(options: { force?: boolean; accessToken?: string; cacheKey?: string } = {}): Promise<BufferChannel[]> {
  if (!options.accessToken && !options.force && channelCache && channelCache.expiresAt > Date.now()) {
    return channelCache.channels;
  }

  assertBufferBudget();
  const account = await bufferGraphql<{
    account: { organizations: Array<{ id: string; name: string }> };
  }>(`query BufferOrganizations { account { organizations { id name } } }`, {}, options.accessToken);

  const rows: BufferChannel[] = [];
  for (const org of account.account?.organizations || []) {
    assertBufferBudget();
    const data = await bufferGraphql<{
      channels: Array<{ id: string; name: string; service: string }>;
    }>(
      `query BufferChannels($organizationId: OrganizationId!) {
        channels(input: { organizationId: $organizationId }) { id name service }
      }`,
      { organizationId: org.id },
      options.accessToken
    );
    for (const channel of data.channels || []) {
      rows.push({
        ...channel,
        organizationId: org.id,
        organizationName: org.name,
      });
    }
  }

  if (!options.accessToken) channelCache = { expiresAt: Date.now() + CHANNEL_CACHE_MS, channels: rows };
  return rows;
}

export function clearBufferChannelCache() {
  channelCache = null;
}
