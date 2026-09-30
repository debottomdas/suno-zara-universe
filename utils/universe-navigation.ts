export type UniverseChannel = {id:string; name:string; language?:string|null};
export type UniverseContext = 'home'|'music'|'library'|'publishing';

// One account-scoped source for all main Universe navigation. No cross-user cache.
export async function loadUniverseChannels():Promise<UniverseChannel[]> {
 const response=await fetch('/api/channels',{cache:'no-store'});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'Could not load channels.');
 return Array.isArray(data)?data:data.channels||[];
}

// Drop project IDs and planner handoffs when changing channel; preserve only page context.
export function channelHref(context:UniverseContext|undefined,channelId:string,stage?:string,view?:string) {
 const path=context==='publishing'?'/publishing':context==='library'?'/library-next':'/music-next';
 const query=new URLSearchParams();
 if(channelId)query.set('channelId',channelId);
 if(context==='music'&&stage)query.set('stage',stage);
 if(context==='library'&&view)query.set('view',view);
 return `${path}${query.size?'?'+query:''}`;
}
