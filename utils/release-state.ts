export type ReleaseReceipt = { itemKey: string; channelId?: string; slot?: number; postId?: string; videoId?: string; status?: string; dueAt?: string | null; scheduledAt?: string | null };
export function releaseState(youtube: ReleaseReceipt[], buffer: ReleaseReceipt[], channelIds: string[], ready = true) {
  const channels = [...new Set([...channelIds, ...buffer.filter(r=>r.channelId && r.itemKey === `buffer-${r.channelId}-short-${String(r.slot).padStart(2,'0')}`).map(r=>r.channelId!)])];
  const keys = channels.flatMap(id => Array.from({length: 6}, (_, i) => `buffer-${id}-short-${String(i + 1).padStart(2, '0')}`));
  const current = new Map(buffer.map(r => [r.itemKey, r]));
  const required = keys.map(key => current.get(key));
  const prepared = required.filter(r => r?.postId && ['draft','pending','scheduled','sending','sent'].includes(r.status || '')).length;
  const failed = required.filter(r => r?.status === 'error').length;
  const sent = required.filter(r => r?.postId && r.status === 'sent').length;
  const scheduled = required.filter(r => r?.postId && ['scheduled','sending','sent'].includes(r.status || '')).length;
  const ytKeys = ['youtube-full', ...Array.from({length:6},(_,i)=>`youtube-short-${String(i+1).padStart(2,'0')}`)];
  const yt = new Map(youtube.map(r=>[r.itemKey,r]));
  // Preserve the existing YouTube upload receipt contract; a future schedule is not a final delivery.
  const youtubeComplete = ytKeys.every(key => { const r=yt.get(key); return Boolean(r?.videoId) && r?.status !== 'error' && !r?.scheduledAt; });
  const complete = ready && youtubeComplete && keys.length > 0 && sent === keys.length;
  const state = complete ? 'published' : ready && keys.length > 0 && scheduled === keys.length ? 'scheduled' : ready && keys.length > 0 && prepared === keys.length ? 'prepared' : 'incomplete';
  return {complete, state, prepared, failed, sent, scheduled, expected:keys.length};
}

export async function loadReleaseState(projectId:string,channelId:string) {
  if(!projectId||!channelId)return releaseState([],[],[],false);
  try {
    const [workerResponse,channelsResponse]=await Promise.all([
      fetch(`http://127.0.0.1:47123/publishing/status?projectId=${encodeURIComponent(projectId)}`,{cache:'no-store'}),
      fetch(`/api/publishing/buffer/status?channelId=${encodeURIComponent(channelId)}`,{cache:'no-store'}),
    ]);
    if(!workerResponse.ok||!channelsResponse.ok)return releaseState([],[],[],false);
    const worker=await workerResponse.json(), channels=await channelsResponse.json();
    return releaseState(worker.youtube||[],worker.buffer||[],(channels.channels||[]).map((c:{id:string})=>c.id));
  } catch { return releaseState([],[],[],false); }
}
