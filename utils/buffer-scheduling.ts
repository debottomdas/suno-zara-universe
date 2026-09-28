export type BufferScheduleItem = { itemKey: string; postId: string; dueAt: string; slot: number; channelId: string; service: string; mediaUrl: string };
export function singleDraftItem(receipt: Omit<BufferScheduleItem, 'dueAt' | 'mediaUrl'> & {status?:string;mediaUrl?:string}, dueAt:string, now=Date.now()):BufferScheduleItem {
  if (receipt.status !== 'draft' || !receipt.postId || !receipt.mediaUrl || !receipt.channelId || !['facebook','instagram','tiktok'].includes(receipt.service) || !Number.isInteger(receipt.slot) || receipt.slot<1 || receipt.slot>6 || receipt.itemKey !== `buffer-${receipt.channelId}-short-${String(receipt.slot).padStart(2,'0')}`) throw new Error('Choose an existing prepared draft with its original media.');
  const time=Date.parse(dueAt);
  if (!Number.isFinite(time) || time<=now+120000 || time>now+29*86400000) throw new Error('Choose a time more than two minutes ahead and within 29 days.');
  return {itemKey:receipt.itemKey,postId:receipt.postId,dueAt:new Date(time).toISOString(),slot:receipt.slot,channelId:receipt.channelId,service:receipt.service,mediaUrl:receipt.mediaUrl};
}
export async function submitBufferSchedule(projectId:string,items:BufferScheduleItem[]) {
  const response=await fetch('/api/publishing/buffer/schedule-posts-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,items})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error || 'Could not schedule Buffer drafts.');
  return data;
}
export function ukInput(instant:Date) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);
  const get=(type:string)=>parts.find(p=>p.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
export function ukTimeToIso(value:string) {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('Enter the UK publication date and time.');
  const base=Date.parse(value+'Z');
  if(!Number.isFinite(base))throw new Error('Enter a valid date and time.');
  const matches=[base,base-3600000].filter(time=>ukInput(new Date(time))===value);
  if(matches.length!==1)throw new Error('This UK time is missing or ambiguous because the clocks change. Choose a different time.');
  return new Date(matches[0]).toISOString();
}
export function ukTimeLabel(iso:string) {
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',dateStyle:'full',timeStyle:'long'}).format(new Date(iso));
}
