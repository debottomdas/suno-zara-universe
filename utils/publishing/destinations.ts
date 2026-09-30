import type {Destination} from './plan';
// Both inputs are restricted by the authenticated, selected-channel binding query.
export function bufferDestinations(buffer:any,channelId:string):Destination[]{
 const live=buffer.channels||[],known=buffer.knownChannels||live;
 return known.filter((c:any)=>['instagram','facebook','tiktok'].includes(c.service)).map((c:any)=>({id:c.id,name:c.name,platform:c.service,channelId,accountId:c.bufferAccountId||null,available:live.some((x:any)=>x.id===c.id&&x.service===c.service&&(x.bufferAccountId||null)===(c.bufferAccountId||null))}));
}
