type Attempt = {postId?:string;channelId?:string};
export function canCleanBufferMedia(state:string,attempts:Attempt[],posts:Array<{id?:string;channelId?:string;status?:string}>) {
  return state === 'submitted' && attempts.length > 0 && attempts.every(a => Boolean(a.postId && a.channelId) && posts.some(p => p.id===a.postId && p.channelId===a.channelId && p.status==='sent'));
}
