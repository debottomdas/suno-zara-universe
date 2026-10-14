import "server-only";
import { getBufferKey } from "@/utils/local-buffer/credentials";
import { verifyLocalBuffer } from "@/utils/local-buffer/verify";

type Result = { data?: { createPost?: { post?: { id: string; text?: string }; message?: string } }; errors?: Array<{ message: string }> };

export async function createLocalBufferDraft(universeChannelId: string, bufferChannelId: string, text: string) {
  const verification = await verifyLocalBuffer(universeChannelId);
  if (verification.status !== "verified") throw new Error("Buffer account could not be verified.");
  const destination = verification.channels.find(channel => channel.id === bufferChannelId);
  if (!destination) throw new Error("Selected social destination does not belong to this Universe channel's Buffer account.");
  const apiKey = await getBufferKey(universeChannelId);
  if (!apiKey) throw new Error("No Buffer key saved.");
  const query = `mutation CreateUniverseDraft($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess { post { id text } }
      ... on MutationError { message }
    }
  }`;
  const response = await fetch("https://api.buffer.com", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables: { input: {
      channelId: destination.id,
      text,
      schedulingType: "automatic",
      mode: "addToQueue",
      saveToDraft: true
    } } }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Buffer returned HTTP ${response.status}.`);
  const result = await response.json() as Result;
  if (result.errors?.length) throw new Error(result.errors.map(e => e.message).join("; ").slice(0, 300));
  if (!result.data?.createPost?.post?.id) throw new Error(result.data?.createPost?.message || "Buffer did not confirm draft creation.");
  return { draftId: result.data.createPost.post.id, destination: { id: destination.id, name: destination.displayName || destination.name, service: destination.service }, status: "draft" as const };
}
