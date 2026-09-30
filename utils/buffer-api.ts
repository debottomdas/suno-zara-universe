import { createHash } from "node:crypto";

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
type Discovery = { expiresAt: number; refreshedAt: number; channels: BufferChannel[] };
type Budget = { snapshot: BufferRateLimitSnapshot | null; blockedUntil: number };
// Shared by route modules within this server process; never store raw credentials as keys.
const globalState = globalThis as typeof globalThis & { __bufferQuota?: {
  channels: Map<string, Discovery>; pending: Map<string, Promise<BufferChannel[]>>;
  budgets: Map<string, Budget>; queues: Map<string, Promise<unknown>>;
} };
const state: NonNullable<typeof globalState.__bufferQuota> = globalState.__bufferQuota ??= { channels: new Map(), pending: new Map(), budgets: new Map(), queues: new Map() };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
// Buffer quotas belong to an API key or OAuth app client, not an individual account.
function budgetKey(accessToken?: string) { return hash(accessToken ? `oauth:${process.env.BUFFER_CLIENT_ID || "app"}` : `key:${apiKey()}`); }
function budget(accessToken?: string) {
  const key = budgetKey(accessToken);
  if (!state.budgets.has(key)) state.budgets.set(key, { snapshot: null, blockedUntil: 0 });
  return state.budgets.get(key)!;
}

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

function rememberRateLimit(headers: Headers, accessToken?: string) {
  const parsed = parseRateLimitHeaders(headers);
  if (parsed) budget(accessToken).snapshot = parsed;
  return parsed;
}

export function getBufferRateLimit(accessToken?: string) {
  const saved = budget(accessToken).snapshot;
  if (!saved) return null;
  const elapsed = (Date.now() - Date.parse(saved.capturedAt)) / 1000;
  return { ...saved, capturedAt: new Date().toISOString(), windows: saved.windows
    .filter(w => w.resetSeconds > elapsed)
    .map(w => ({ ...w, resetSeconds: Math.max(0, Math.ceil(w.resetSeconds - elapsed)) })) };
}

export function bufferRateLimitIsLow(threshold = 0.1, accessToken?: string) {
  return getBufferRateLimit(accessToken)?.windows.some(w => w.remaining <= (w.quota ? Math.max(1, Math.floor(w.quota * threshold)) : 5)) || false;
}

export class BufferQuotaError extends Error {
  readonly status = 429;
  constructor(message: string, public retryAfter: number) { super(message); }
}

export function assertBufferBudget(accessToken?: string) {
  const cooldown = Math.ceil((budget(accessToken).blockedUntil - Date.now()) / 1000);
  const low = getBufferRateLimit(accessToken)?.windows.filter(w => w.remaining <= (w.quota ? Math.max(1, Math.floor(w.quota * 0.1)) : 5)) || [];
  const wait = Math.max(cooldown, ...low.map(w => w.resetSeconds));
  if (wait > 0) throw new BufferQuotaError(`Buffer API quota is low or temporarily limited. Universe paused this request. Try again in ${Math.ceil(wait / 60)} minute(s).`, wait);
}

async function sendGraphql<T>(query: string, variables: Record<string, unknown> = {}, accessToken?: string) {
  const key = String(accessToken || apiKey()).trim();
  if (!key) throw new Error("BUFFER_API_KEY is not configured.");

  assertBufferBudget(accessToken);
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });

  const rateLimit = rememberRateLimit(response.headers, accessToken);
  const retryHeader = response.headers.get("retry-after");
  const retryAfter = retryHeader && /^\d+(?:\.\d+)?$/.test(retryHeader) ? Number(retryHeader) : retryHeader ? (Date.parse(retryHeader) - Date.now()) / 1000 : NaN;
  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    errors?: Array<{ message?: string; extensions?: { code?: string; window?: string } }>;
  };

  if (response.status === 429) {
    const wait = Math.max(1, Math.ceil(Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : Math.max(60, ...(rateLimit?.windows.filter(w => w.remaining === 0).map(w => w.resetSeconds) || []))));
    budget(accessToken).blockedUntil = Date.now() + wait * 1000;
    const minutes = Math.max(1, Math.ceil(wait / 60));
    throw new BufferQuotaError(`Buffer API rate limit reached. Universe stopped automatically. Retry after about ${minutes} minute${minutes === 1 ? "" : "s"}.`, wait);
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

export async function bufferGraphqlDetailed<T>(query: string, variables: Record<string, unknown> = {}, accessToken?: string) {
  // Serialize per client so a burst observes the preceding response's budget/429.
  // Never retry mutations or uncertain requests automatically.
  const key = budgetKey(accessToken);
  const prior = state.queues.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(() => sendGraphql<T>(query, variables, accessToken));
  state.queues.set(key, next);
  try { return await next; } finally { if (state.queues.get(key) === next) state.queues.delete(key); }
}

export async function bufferGraphql<T>(query: string, variables: Record<string, unknown> = {}, accessToken?: string) {
  return (await bufferGraphqlDetailed<T>(query, variables, accessToken)).data;
}

export async function loadBufferChannels(options: { force?: boolean; accessToken?: string; cacheKey?: string } = {}): Promise<BufferChannel[]> {
  const key = hash(String(options.accessToken || apiKey()).trim());
  const cached = state.channels.get(key);
  // Manual refresh bypasses the normal TTL, but not a 30-second click/burst guard.
  if (cached && cached.expiresAt > Date.now() && (!options.force || Date.now() - cached.refreshedAt < 30_000)) return cached.channels;
  const pending = state.pending.get(key);
  if (pending) return pending;
  const load = async () => {
  assertBufferBudget(options.accessToken);
  const account = await bufferGraphql<{
    account: { organizations: Array<{ id: string; name: string }> };
  }>(`query BufferOrganizations { account { organizations { id name } } }`, {}, options.accessToken);

  const rows: BufferChannel[] = [];
  for (const org of account.account?.organizations || []) {
    assertBufferBudget(options.accessToken);
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

  // Bound retained credential hashes without evicting in-flight work.
  for (const [id, value] of state.channels) if (value.expiresAt <= Date.now()) state.channels.delete(id);
  if (state.channels.size >= 256) state.channels.delete(state.channels.keys().next().value!);
  state.channels.set(key, { expiresAt: Date.now() + CHANNEL_CACHE_MS, refreshedAt: Date.now(), channels: rows });
  return rows;
  };
  const task = load();
  state.pending.set(key, task);
  try { return await task; } finally { if (state.pending.get(key) === task) state.pending.delete(key); }
}

export function clearBufferChannelCache() {
  state.channels.clear();
}
