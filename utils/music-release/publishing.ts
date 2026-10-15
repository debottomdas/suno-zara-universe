import type {MusicContext} from './product';
export type SongMetadata={title:string;description:string;hashtags:string[];tags:string[]};
export type ShortMetadata=SongMetadata&{shortNumber:number};
const list=(v:string|undefined,hashes=false)=>[...new Set(String(v||'').split(hashes?/\s+/u:/[,\n]+/u).map(s=>s.trim()).filter(Boolean).map(s=>hashes?(s.startsWith('#')?s:'#'+s):s))];
const merge=(a:string[],b:string[])=>[...new Set([...a,...b].map(x=>x.trim()).filter(Boolean))];
export function publishingMetadata(c:MusicContext,full:SongMetadata,shorts:ShortMetadata[],requireSix=true) {
 const publishingLyrics=String(c.lyrics||'')
   .split(/\r?\n/)
   .map(line=>line.trim().replace(/\s*(?:\[[^\]]*\]|\{[^}]*\}|\([^)]*\))\s*$/u,'').trim())
   .filter(line=>line&&line!=='⸻')
   .join('\n')
   .replace(/\n{3,}/g,'\n\n')
   .trim();
 if(requireSix&&(shorts.length!==6||new Set(shorts.map(s=>s.shortNumber)).size!==6||shorts.some(s=>s.shortNumber<1||s.shortNumber>6)))throw Error('Prepare exactly six distinct Short metadata records.');
 const f=c.dna?.sections.publishing.fields,fixedHashtags=list([f?.fixedHashtags,f?.userFixedHashtags].filter(Boolean).join(' '),true),fixedTags=list(f?.tags);

 const cleanSongDescription=(value:string)=>{
   let result=String(value||'');
   for(const line of String(f?.credits||'').split('\n').map(x=>x.trim()).filter(Boolean)){
     result=result.split('\n').filter(x=>x.trim()!==line).join('\n');
   }
   return result.replace(/\n{3,}/g,'\n\n').trim();
 };
 const apply=(template:string|undefined,item:SongMetadata,n?:number)=>String(template||'').replace(/\{(title|englishTitle|channelName|language|credits|songDescription|lyrics|hook|shortNumber)\}/g,(_,key:string)=>({title:c.title,englishTitle:c.englishTitle||'',channelName:c.channelName,language:c.language,credits:f?.credits||'',songDescription:cleanSongDescription(item.description),lyrics:publishingLyrics,hook:item.title,shortNumber:n?String(n):''}[key]||''));
 const footer=[f?.credits,f?.footer,f?.links].filter(Boolean).join('\n');
 const description=(template:string|undefined,item:SongMetadata,n?:number)=>{let result=template?apply(template,item,n):item.description;if(template&&!template.includes('{songDescription}'))result+='\n\n'+item.description;for(const line of footer.split('\n').filter(Boolean))if(!result.includes(line))result+=(result.endsWith('\n')?'':'\n')+(result.includes('\n'+(footer.split('\n').filter(Boolean)[0]||''))?'':'\n')+line;return result.trim();};
 const common={privacyStatus:f?.privacyStatus||'private',defaultLanguage:f?.defaultLanguage||'',categoryId:f?.category||'',destinationIds:list(f?.destinationIds)};
 const fullTitle=f?.titleTemplate?apply(f.titleTemplate,full):full.title,fullDescription=description(f?.descriptionTemplate,full);
 const youtube_full={recommendedTitle:fullTitle,finalDescription:fullDescription,title:fullTitle,description:fullDescription,hashtags:merge(fixedHashtags,full.hashtags),tags:merge(fixedTags,full.tags),playlistIds:list(f?.defaultPlaylistIds),playlistApplication:'youtube-studio-after-upload',...common};
 const youtube_shorts={shorts:shorts.map(s=>({...s,title:f?.shortTitleTemplate?apply(f.shortTitleTemplate,s,s.shortNumber):s.title,description:description(f?.shortDescriptionTemplate,s,s.shortNumber),hashtags:merge(fixedHashtags,s.hashtags),tags:merge(fixedTags,s.tags),playlistIds:list(f?.shortPlaylistIds||f?.defaultPlaylistIds),playlistApplication:'youtube-studio-after-upload',...common,relatedVideo:{songId:c.songId,channelId:c.channelId,assetKey:'full',youtubeVideoId:null as string|null,status:'waiting-for-long-video',method:'youtube-studio',required:f?.relatedVideoPolicy!=='none'&&f?.relatedVideoPolicy!=='optional-studio',dependency:f?.relatedVideoPolicy==='none'||f?.relatedVideoPolicy==='optional-studio'?'none':'publish-long-video-first',policy:f?.relatedVideoPolicy||'required-studio',capability:'No documented Data API setter; link manually in YouTube Studio after long video is public or unlisted.'}}))};
 return{youtube_full,youtube_shorts};
}
export function canonicalSocial(pack:Record<string,unknown>) {
 const next=structuredClone(pack),full=(next.youtube_full||{}) as Record<string,unknown>;
 full.title=typeof full.title==='string'?full.title:full.recommendedTitle;full.description=typeof full.description==='string'?full.description:full.finalDescription||full.fullDescription||full.openingDescription;
 full.recommendedTitle=typeof full.title==='string'?full.title:full.recommendedTitle;
 full.finalDescription=typeof full.description==='string'?full.description:full.finalDescription;
 next.youtube_full=full;return next;
}
export function publishingIssues(c:MusicContext,pack:Record<string,unknown>) {
 const issues:string[]=[],p=canonicalSocial(pack),full=p.youtube_full as Record<string,unknown>,rows=[full,...((p.youtube_shorts as {shorts?:Record<string,unknown>[]})?.shorts||[])];
 if(rows.length!==7)issues.push('Prepare full-video metadata and six Shorts.');
 for(const [i,row]of rows.entries()){
  const title=String(i?row.title:row.recommendedTitle||''),description=String(i?row.description:row.finalDescription||'');
  if(!title.trim()||Array.from(title).length>100||/[<>]/u.test(title))issues.push(`${i?'Short '+i:'Full video'} title must fit YouTube’s 100-character limit.`);
  if(!description.trim()||new TextEncoder().encode(description).length>5000||/[<>]/u.test(description))issues.push(`${i?'Short '+i:'Full video'} description exceeds YouTube’s limit or is empty.`);
  const tags=Array.isArray(row.tags)?row.tags.map(String):[];if(tags.reduce((n,t,j)=>n+t.length+(/\s/u.test(t)?2:0)+(j?1:0),0)>500)issues.push(`${i?'Short '+i:'Full video'} tags exceed YouTube’s 500-character limit.`);
  const fields=c.dna?.sections.publishing.fields;
  for(const fixed of list([fields?.fixedHashtags,fields?.userFixedHashtags].filter(Boolean).join(' '),true))if(!Array.isArray(row.hashtags)||!row.hashtags.includes(fixed))issues.push(`Restore channel hashtag ${fixed}.`);
  for(const fixed of list(fields?.tags))if(!tags.includes(fixed))issues.push(`Restore channel tag ${fixed}.`);
  for(const line of [fields?.credits,fields?.footer,fields?.links].filter(Boolean).join('\n').split('\n').filter(Boolean))if(!description.includes(line))issues.push('Restore the channel credits, footer and links.');
  const playlists=list(i?(fields?.shortPlaylistIds||fields?.defaultPlaylistIds):fields?.defaultPlaylistIds);
  if(playlists.some(id=>!Array.isArray(row.playlistIds)||!row.playlistIds.includes(id)))issues.push('Restore channel playlist requirements.');
  if(fields?.privacyStatus&&row.privacyStatus!==fields.privacyStatus)issues.push('Restore channel visibility setting.');
  if(fields?.defaultLanguage&&row.defaultLanguage!==fields.defaultLanguage)issues.push('Restore channel publishing language.');
  if(fields?.defaultLanguage&&!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(fields.defaultLanguage))issues.push('Use a YouTube language code such as hi for the publishing language.');
  if(fields?.category&&!/^\d+$/u.test(fields.category))issues.push('Use a numeric YouTube category ID for the publishing category.');
  if(fields?.category&&row.categoryId!==fields.category)issues.push('Restore channel publishing category.');
  if(list(fields?.destinationIds).some(id=>!Array.isArray(row.destinationIds)||!row.destinationIds.includes(id)))issues.push('Restore channel publishing destinations.');
  if(i){const r=row.relatedVideo as {songId?:string;channelId?:string;assetKey?:string;dependency?:string}|undefined;if(!r||r.songId!==c.songId||r.channelId!==c.channelId||r.assetKey!=='full'||r.dependency!==(fields?.relatedVideoPolicy==='none'||fields?.relatedVideoPolicy==='optional-studio'?'none':'publish-long-video-first'))issues.push(`Short ${i} needs its structural long-video relationship.`);}
 }
 return issues;
}
export function resolveRelatedVideo(context:MusicContext,short:Record<string,unknown>,long:{songId:string;channelId:string;videoId:string;privacyStatus:string}) {
 const relationship=short.relatedVideo as {songId:string;channelId:string}|undefined;
 if(!relationship||relationship.songId!==context.songId||relationship.channelId!==context.channelId||long.songId!==context.songId||long.channelId!==context.channelId)throw Error('Related Video belongs to another song or channel.');
 if(!/^[A-Za-z0-9_-]{11}$/.test(long.videoId)||!['public','unlisted'].includes(long.privacyStatus))throw Error('The corresponding long video must exist and be public or unlisted first.');
 return{...short,relatedVideo:{...relationship,assetKey:'full',dependency:'publish-long-video-first',youtubeVideoId:long.videoId,method:'youtube-studio',status:'needs-studio-link'}};
}
