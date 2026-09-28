import { createHash } from 'node:crypto';
// Append-only snapshots: later status changes and retries never mutate previous evidence.
export function recordBufferReceipt(publishingReceipts, receipt) {
  const buffer = { ...(publishingReceipts.buffer || {}) };
  const history = { ...(publishingReceipts.bufferAttemptHistory || {}) };
  for (const value of [buffer[receipt.itemKey], receipt]) {
    if (!value) continue;
    const snapshot = structuredClone(value);
    const id = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    if (!history[id]) history[id] = { ...snapshot, historyId:id };
  }
  buffer[receipt.itemKey] = structuredClone(receipt);
  return { ...publishingReceipts, buffer, bufferAttemptHistory:history };
}
