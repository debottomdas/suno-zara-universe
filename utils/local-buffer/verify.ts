import "server-only";
import { getBufferKey } from "@/utils/local-buffer/credentials";

type Organization = { id: string; name: string; ownerEmail?: string | null };
type BufferChannel = { id: string; name: string; displayName?: string | null; service: string };
type GraphQLResponse<T> = { data?: T; errors?: Array<{ message?: string }> };

async function queryBuffer<T>(apiKey: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Buffer rejected this API key." : `Buffer returned HTTP ${response.status}.`);
  const result = await response.json() as GraphQLResponse<T>;
  if (result.errors?.length) throw new Error(result.errors.map(e => e.message || "Buffer query failed").join("; ").slice(0, 350));
  if (!result.data) throw new Error("Buffer returned no account data.");
  return result.data;
}

export async function verifyLocalBuffer(channelId: string) {
  const key = await getBufferKey(channelId);
  if (!key) return { status: "not_connected" as const, organizations: [], channels: [] };
  const account = await queryBuffer<{ account: { id: string; email: string; organizations: Organization[] } }>(
    key, "query LocalBufferAccount { account { id email organizations { id name ownerEmail } } }"
  );
  const organizations = account.account.organizations;
  const channels: Array<BufferChannel & { organizationId: string }> = [];
  for (const org of organizations) {
    const data = await queryBuffer<{ channels: BufferChannel[] }>(
      key, "query LocalBufferChannels($input: ChannelsInput!) { channels(input: $input) { id name displayName service } }",
      { input: { organizationId: org.id } }
    );
    channels.push(...data.channels.map(c => ({ ...c, organizationId: org.id })));
  }
  return { status: "verified" as const, account: { id: account.account.id, email: account.account.email }, organizations, channels };
}
