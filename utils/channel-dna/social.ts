import type {ChannelContext} from './context';
import {publishingMetadata} from '../music-release/publishing';
import type {MusicContext} from '../music-release/product';
// Existing publishing normalizer is the only template/hashtag/policy interpreter.
export function applyChannelPublishing(context:ChannelContext,song:{id:string;title:string;english_title?:string|null;language:string;lyrics?:string|null},platform:string,value:Record<string,any>){
 if(value.channelId&&value.channelId!==context.channelId)throw Error('Social metadata belongs to another channel.');
 if(!context.dna)return value;
 const c={...context,songId:song.id,title:song.title,englishTitle:song.english_title||'',language:song.language,lyrics:song.lyrics||''} as MusicContext;
 const metadata=(row:Record<string,any>,n?:number)=>{
  let item={title:String(row.title||row.recommendedTitle||song.title),description:String(row.fullDescription||row.description||row.finalDescription||row.caption||''),hashtags:Array.isArray(row.hashtags)?row.hashtags:[],tags:Array.isArray(row.tags)?row.tags:[]};
  if(context.dna?.sections.publishing.fields.credits&&row.credits&&row.credits!==context.dna.sections.publishing.fields.credits)item.description=item.description.split(String(row.credits)).join('').trim();
  const previous=row._channelPublishing;
  if(previous&&!row.tags)item.tags=previous.applied.tags;
  if(previous&&!row.hashtags)item.hashtags=previous.applied.hashtags;
  if(previous&&!row.title&&!row.recommendedTitle)item.title=previous.applied.title;
  if(previous?.channelId&&previous.channelId!==context.channelId)throw Error('Social metadata belongs to another channel.');
  if(previous?.base)item={...previous.base};
  // Recover the creative source from older cached Shorts whose DNA wrapper
 // and credits were accidentally folded back into _channelPublishing.base.
 if(n){
  const fields=context.dna!.sections.publishing.fields;
  const shortTemplate=String(fields.shortDescriptionTemplate||'');
  const renderedWrapper=shortTemplate.replace(/\{title\}/g,song.title).trim();
  let clean=String(item.description||'');

  if(renderedWrapper){
   clean=clean.split(renderedWrapper).join('').replace(/\n{3,}/g,'\n\n').trim();
  }

  for(const line of String(fields.credits||'').split('\n').map(x=>x.trim()).filter(Boolean)){
   clean=clean.split('\n').filter(x=>x.trim()!==line).join('\n');
  }

  item.description=clean.replace(/\n{3,}/g,'\n\n').trim();
 }
 const result=publishingMetadata(c,item,n?[{...item,shortNumber:n}]:[],false);
  const normalized=n?result.youtube_shorts.shorts[0]:result.youtube_full;
  return {...normalized,_channelPublishing:{channelId:context.channelId,base:item,applied:{title:normalized.title,description:normalized.description,hashtags:normalized.hashtags,tags:normalized.tags}}};
 };
 const next=structuredClone(value);
 if(platform==='youtube_full')return {...next,...metadata(next),credits:context.dna.sections.publishing.fields.credits||next.credits,channelId:context.channelId,dnaRevision:context.dnaRevision};
 if(platform==='youtube_shorts')return {...next,shorts:(next.shorts||[]).map((row:Record<string,any>,i:number)=>({...row,...metadata(row,Number(row.shortNumber)||i+1)})),channelId:context.channelId,dnaRevision:context.dnaRevision};
 const rows=platform==='tiktok'?'posts':'reels';
 next[rows]=(next[rows]||[]).map((row:Record<string,any>,i:number)=>{const m=metadata(row,i+1);return {...row,caption:m.description,hashtags:m.hashtags,tags:m.tags,_channelPublishing:m._channelPublishing,...(platform==='facebook'?{title:m.title}:{})};});
 for(const key of ['feedCaption','mainReleasePost','shortReleasePost','emotionalStoryPost'])if(typeof next[key]==='string'){const m=metadata({caption:next[key],_channelPublishing:next._channelPublishingFields?.[key]});next[key]=m.description;next._channelPublishingFields={...next._channelPublishingFields,[key]:m._channelPublishing};}
 next.hashtags=metadata(next).hashtags;
 return {...next,channelId:context.channelId,dnaRevision:context.dnaRevision};
}
