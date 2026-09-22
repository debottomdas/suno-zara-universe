export type BufferService = "tiktok" | "instagram" | "facebook";

export type BufferChannel = {
  id: string;
  name: string;
  service: string;
  organizationId?: string;
  organizationName?: string;
};

function apiKey() {
  return String(process.env.BUFFER_API_KEY || "").trim();
}

export function bufferConfigured() {
  return Boolean(apiKey());
}

export async function bufferGraphql<T>(query: string, variables: Record<string, unknown> = {}) {
  const key = apiKey();
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

  const payload = (await response.json().catch(() => ({}))) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };

  if (!response.ok) {
    throw new Error(payload.errors?.[0]?.message || `Buffer API request failed (HTTP ${response.status}).`);
  }
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((item) => item.message).filter(Boolean).join("; ") || "Buffer API request failed.");
  }
  if (!payload.data) throw new Error("Buffer API returned no data.");
  return payload.data;
}

export async function loadBufferChannels(): Promise<BufferChannel[]> {
  const account = await bufferGraphql<{
    account: { organizations: Array<{ id: string; name: string }> };
  }>(`query BufferOrganizations { account { organizations { id name } } }`);

  const rows: BufferChannel[] = [];
  for (const org of account.account?.organizations || []) {
    const data = await bufferGraphql<{
      channels: Array<{ id: string; name: string; service: string }>;
    }>(
      `query BufferChannels($organizationId: OrganizationId!) {
        channels(input: { organizationId: $organizationId }) { id name service }
      }`,
      { organizationId: org.id }
    );
    for (const channel of data.channels || []) {
      rows.push({
        ...channel,
        organizationId: org.id,
        organizationName: org.name,
      });
    }
  }
  return rows;
}
