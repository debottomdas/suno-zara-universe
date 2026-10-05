import {compileBrandContext} from './compile';
import type {Stage} from './model';
import type {ChannelContext} from './context';
export function channelInstructions(c:ChannelContext,stage:Stage){
 const compiled=compileBrandContext(c.channelId,c.dnaRevision,c.dna,stage);
 return `ACTIVE CHANNEL: ${c.channelName}\nChannel Name means exactly ${c.channelName}. Channel DNA takes precedence over generic branding/publishing defaults and creator guidance.\n${compiled?.prompt||'No active Channel DNA configured.'}\n${stage==='social'?compileBrandContext(c.channelId,c.dnaRevision,c.dna,'publishing')?.prompt||'':''}`;
}
