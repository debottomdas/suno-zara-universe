import {applyChannelPublishing} from '../channel-dna/social';
import {publishingMetadata,canonicalSocial,publishingIssues} from './publishing';
import { bufferDestinations } from '../publishing/destinations';
import { preserveReviewed } from '../social/copy';
import { approvedCandidate, outputKey, type CreativeWorkspace } from '../creative/model';
import { assertScope, relevantRules, sourceKey, subtitlePhrases, type MusicContext, type ProductRecord } from './product';

export function socialPack(c:MusicContext,p:ProductRecord,previous:Record<string,unknown>={},workspace?:CreativeWorkspace) {
  assertScope(c,p);
  if(!p.bibleReviewed||!p.recipeReviewed||!p.bible||!p.recipe)throw Error('Review Music Direction and Visual Bible before preparing the release copy.');
  const hook=subtitlePhrases(c.lyrics)[0]||c.title;
  const fixed=c.dna?.sections.publishing.fields.fixedHashtags||'',userFixed=c.dna?.sections.publishing.fields.userFixedHashtags||'';
  const direction=(c.intelligence.socialDirection&&typeof c.intelligence.socialDirection==='object'?c.intelligence.socialDirection:{}) as Record<string,unknown>;
  const strings=(v:unknown)=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'&&!!s.trim()):[];
  const songHashtags=strings(direction.hashtag_direction||direction.hashtags),songTags=strings(direction.tags),captions=strings(direction.caption_direction);
  const engagement=typeof direction.engagement_prompt==='string'?direction.engagement_prompt:'';
  const emotion=typeof c.intelligence.emotionalCore==='string'?c.intelligence.emotionalCore:typeof c.intelligence.emotionalCore==='object'&&c.intelligence.emotionalCore?(c.intelligence.emotionalCore as {essence?:string}).essence||'':'';
  const tag=c.channelName.replace(/[^\p{L}\p{N}_]/gu,''),hashtags=[...(tag?[`#${tag}`]:[]),...songHashtags,...`${fixed} ${userFixed}`.split(/\s+/u).filter(Boolean)];
  const description=[c.title,hook,emotion,p.recipe.candidate.direction.genre,p.bible.world,c.dna?.sections.publishing.fields.credits,c.dna?.sections.publishing.fields.links].filter(Boolean).join('\n\n');
  const oldFull=preserveReviewed(previous.youtube_full||{},{title:c.title,description,tags:[c.channelName,c.language,p.recipe.candidate.direction.genre,...songTags],generatorGuidance:'Review before publishing; no external delivery has occurred.'});
  const shorts=Array.from({length:6},(_,i)=>{const timing=workspace?.plan?.shorts.find(t=>t.slotId===`short-${i+1}`),cue=timing?p.finishing?.cues.find(q=>q.end>timing.start&&q.start<timing.end):undefined,shortHook=cue?.text||subtitlePhrases(c.lyrics)[i%Math.max(1,subtitlePhrases(c.lyrics).length)]||hook;return{shortNumber:i+1,title:Array.from(`${shortHook} | ${c.title}`).slice(0,100).join(''),description:`${shortHook}\n\n${description}`,hashtags,onScreenHook:shortHook};});
  const canonical=publishingMetadata({...c,dna:null},{title:String(oldFull.title||c.title),description:String(oldFull.description||description),hashtags,tags:[c.channelName,c.language,p.recipe.candidate.direction.genre,...songTags]},shorts.map(s=>({...s,tags:[c.language,p.recipe!.candidate.direction.genre,...songTags]})));
  const pack={youtube_full:preserveReviewed(previous.youtube_full||{},canonical.youtube_full),youtube_shorts:preserveReviewed(previous.youtube_shorts||{},canonical.youtube_shorts),instagram:preserveReviewed(previous.instagram||{},{reels:shorts.map((s,i)=>({reelNumber:i+1,caption:[captions[i%Math.max(1,captions.length)],s.onScreenHook,c.title].filter(Boolean).join('\n'),hashtags,hook:s.onScreenHook,engagementPrompt:engagement}))}),facebook:preserveReviewed(previous.facebook||{},{reels:shorts.map((s,i)=>({reelNumber:i+1,title:s.title,caption:[c.title,captions[i%Math.max(1,captions.length)],s.onScreenHook,p.bible!.world].filter(Boolean).join('\n'),hashtags,engagementPrompt:engagement}))}),tiktok:preserveReviewed(previous.tiktok||{},{posts:shorts.map((s,i)=>({postNumber:i+1,caption:[captions[i%Math.max(1,captions.length)],s.onScreenHook].filter(Boolean).join('\n'),hashtags,onScreenHook:s.onScreenHook,engagementPrompt:engagement}))}),_campaign:{songId:c.songId,channelId:c.channelId,dnaRevision:c.dnaRevision,recipe:p.recipe.candidate.kind,visualWorld:p.bible.world,externalPublishing:false}};
  for(const platform of ['youtube_full','youtube_shorts','instagram','facebook','tiktok'] as const)pack[platform]=applyChannelPublishing(c,{id:c.songId,title:c.title,language:c.language},platform,pack[platform]) as typeof pack[typeof platform];
  return pack;
}
export function destinationReadiness(connections:{platform:string;status:string}[],buffer:Parameters<typeof bufferDestinations>[0],channelId:string) {
  const youtube=connections.some(c=>c.platform==='youtube'&&c.status==='connected');
  const bound=bufferDestinations(buffer,channelId).filter(d=>d.available),missing=['instagram','facebook','tiktok'].filter(platform=>!bound.some(d=>d.platform===platform));
  if(!youtube)missing.unshift('youtube');
  return{known:!buffer.error,ready:missing.length===0&&!buffer.error,label:buffer.error?'Buffer destinations could not be verified.':missing.length?`Unavailable destinations: ${missing.join(', ')}.`:'YouTube and saved Instagram, Facebook and TikTok destinations verified.'};
}
export type Video = {id:string;slot:number;source:string;dependencyKey:string;finishing?:{subtitles:boolean;reviewed:boolean;cueCount:number;lyrics?:string;lyricsSha256?:string}|null;fileUrl?:string};
export type QualityRow={id:string;label:string;state:'Ready'|'Needs Attention'|'Blocked';message:string;stage:'inputs'|'visuals'|'video'|'social'|'quality'};
export function qualityGate(c:MusicContext,p:ProductRecord,w:CreativeWorkspace,videos:{versions:Video[];approved:Record<string,string>},audioKey:string,destinations:{ready:boolean;known:boolean;label?:string}) {
  assertScope(c,p);const rows:QualityRow[]=[];
  const add=(id:string,label:string,ready:boolean,stage:QualityRow['stage'],message:string,blocked=false)=>rows.push({id,label,state:ready?'Ready':blocked?'Blocked':'Needs Attention',stage,message:ready?(id==='destinations'&&destinations.label?destinations.label:'Reviewed and ready.'):message});
  const fresh=p.sourceKey===sourceKey(c);
  if(c.requireActiveDna)add('activeDna','Active Channel DNA',!!c.dna&&c.dnaRevision!==null,'inputs','This fresh acceptance requires an approved active channel DNA revision.',true);
  add('source','Current song/channel inputs',fresh,'inputs','Saved lyrics, intelligence or Channel DNA changed; review the current inputs.',true);
  add('lyrics','Approved Lyrics',p.lyricsReviewed&&!!c.lyrics.trim(),'inputs','Review the exact saved lyrics.');
  add('recipe','Music Direction / Creative Recipe',p.recipeReviewed&&!!p.recipe&&p.recipe.input.lyrics.text===c.lyrics&&p.recipe.input.project.channelId===c.channelId&&p.recipe.input.project.songId===c.songId,'inputs','Choose and review this song’s Music Direction.');
  add('bible','Visual Bible',p.bibleReviewed&&!!p.bible,'visuals','Review the visual world and continuity.');
  add('visuals','Approved visuals',w.slots.some(s=>s.kind==='scene')&&w.slots.filter(s=>s.kind==='scene'||s.kind==='short').every(s=>!!approvedCandidate(s))&&w.slots.filter(s=>s.kind==='short').length===6,'visuals','Approve landscape scenes and all six Short visuals.');
  const approved=Array.from({length:7},(_,slot)=>videos.versions.find(v=>v.slot===slot&&videos.approved[slot?`short-${slot}`:'full']===v.id&&(v.source==='uploaded'||v.dependencyKey===outputKey(w,slot,audioKey))));
  add('full','Finished full video',!!approved[0],'video','Render/upload and approve the full video.');
  add('shorts','Six finished Shorts',approved.slice(1).every(Boolean),'video','Render/upload and approve each of six Shorts.');
  add('subtitles','Subtitles',!!p.finishing?.reviewed&&!!p.finishing.subtitles&&approved.every(v=>v?.finishing?.subtitles&&v.finishing.reviewed&&v.finishing.cueCount>0&&v.finishing.lyrics===c.lyrics),'video','Review lyric timing, render subtitles from the current lyrics and approve every subtitled output.');
  for(const kind of ['cover','thumbnail'] as const)add(kind,kind==='cover'?'Final cover artwork':'YouTube thumbnail',!!w.slots.find(s=>s.kind===kind&&approvedCandidate(s)),'visuals','Use the explicit upload/replace slot and approve the artwork.');
  const pack=(p.social?canonicalSocial(p.social):null) as {youtube_full?:{title?:string;description?:string};youtube_shorts?:{shorts?:{title?:string;description?:string}[]};instagram?:{reels?:{caption?:string}[]};facebook?:{reels?:{caption?:string}[]};tiktok?:{posts?:{caption?:string}[]}}|null;
  const present=(v:unknown)=>typeof v==='string'&&!!v.trim();
  const socialReady=present(pack?.youtube_full?.title)&&present(pack?.youtube_full?.description)&&pack?.youtube_shorts?.shorts?.length===6&&pack.youtube_shorts.shorts.every(s=>present(s.title)&&present(s.description))&&[pack.instagram?.reels,pack.facebook?.reels,pack.tiktok?.posts].every(xs=>xs?.length===6&&xs.every(s=>present(s.caption)));
  add('social','Social metadata',p.socialReviewed&&socialReady&&publishingIssues(c,p.social||{}).length===0,'social',publishingIssues(c,p.social||{}).join(' ')||'Prepare and review nonempty full-video metadata and six variants on each platform.');
  const hard=relevantRules(c).filter(r=>r.strength!=='preferred'||r.locked);
  add('dna','Important Channel DNA requirements',hard.every(r=>p.ruleReviews.includes(r.id)),'quality','Review each required, locked and avoid rule against the actual output.');
  add('destinations','Publishing destination readiness',destinations.known&&destinations.ready,'quality',destinations.label||(destinations.known?'Reconnect/select a publishing destination.':'Destination readiness is unknown; reconnect to read saved connections.'),true);
  const state=rows.some(r=>r.state==='Blocked')?'Blocked':rows.some(r=>r.state==='Needs Attention')?'Needs Attention':'Ready';
  return{state,rows,externalPublishing:false as const};
}
