import {channelBranding} from '../channel-dna/context';
import type { ChannelDna, Rule } from '../channel-dna/model';
import type { Recipe } from '../music-director/model';
import type { CreativeWorkspace } from '../creative/model';

export type MusicContext = { userId: string; channelId: string; channelName: string; songId: string; title: string; englishTitle?: string; language: string; lyrics: string; intelligence: Record<string, unknown>; dnaRevision: number | null; dna: ChannelDna | null; requireActiveDna?:boolean };
export type VisualBible = { world: string; mood: string; subjects: string; locations: string; lighting: string; colourTexture: string; cinematography: string; continuity: string; branding: string; avoid: string; rules: Rule[] };
export type Cue = { start: number; end: number; text: string };
export type Finishing = { subtitles: boolean; cues: Cue[]; reviewed: boolean; lyrics: string; language: string; font: string; colour: string; accent: string; brandText: string; intro: number; outro: number; transition: 'cut' | 'fade' };
export type ProductRecord = { version: 1; userId: string; channelId: string; songId: string; sourceKey: string; lyricsReviewed: boolean; recipe: Recipe | null; recipeReviewed: boolean; bible: VisualBible | null; bibleReviewed: boolean; ruleReviews: string[]; finishing: Finishing | null; social: Record<string, unknown> | null; socialReviewed: boolean; updatedAt: string };
export function sourceKey(c: MusicContext) { return JSON.stringify([c.songId,c.channelId,c.title,c.englishTitle||'',c.lyrics,c.intelligence,c.dnaRevision,c.dna]); }
export function newProduct(c: MusicContext): ProductRecord { return { version:1,userId:c.userId,channelId:c.channelId,songId:c.songId,sourceKey:sourceKey(c),lyricsReviewed:false,recipe:null,recipeReviewed:false,bible:null,bibleReviewed:false,ruleReviews:[],finishing:null,social:null,socialReviewed:false,updatedAt:new Date().toISOString() }; }
export function assertScope(c: MusicContext, p: ProductRecord) { if (p.userId!==c.userId||p.channelId!==c.channelId||p.songId!==c.songId) throw Error('This campaign belongs to another account or channel.'); }
export function relevantRules(c: MusicContext) { return c.dna ? Object.values(c.dna.sections).flatMap(s=>s.rules).filter(r=>r.stages.some(s=>['music','visual','video','social','publishing'].includes(s))) : []; }
const value=(x:unknown,fallback:string):string=>typeof x==='string'&&x.trim()?x:Array.isArray(x)?x.map(v=>value(v,'')).filter(Boolean).join('; ')||fallback:x&&typeof x==='object'?Object.entries(x).map(([key,v])=>`${key}: ${value(v,'')}`).join('; ')||fallback:fallback;
export function buildVisualBible(c: MusicContext, recipe: Recipe | null): VisualBible {
  if(recipe&&(recipe.input.project.channelId!==c.channelId||recipe.input.project.songId!==c.songId||recipe.input.lyrics.text!==c.lyrics))throw Error('Music recipe does not match this channel/song and saved lyrics.');
  const generated=(c.intelligence.visualDirection&&typeof c.intelligence.visualDirection==='object'?c.intelligence.visualDirection:{}) as Record<string,unknown>;
  const social=(c.intelligence.socialDirection&&typeof c.intelligence.socialDirection==='object'?c.intelligence.socialDirection:{}) as Record<string,unknown>;
  const visual=c.dna?.sections.visual.fields, rules=relevantRules(c).filter(r=>r.stages.includes('visual'));
  return {
    world:value(c.intelligence.visualMotifs,`${c.title}: a grounded visual journey through ${value(c.intelligence.emotionalCore,'the song’s changing emotion')}`),
    mood:value(c.intelligence.arc,'Intimate opening, growing emotional tension, a resolved final image'),
    subjects:value(generated.subjects||generated.characters,'One recurring viewpoint character where the lyrics suggest a person; keep face, age and wardrobe consistent. Use environmental storytelling where no character is needed.'),
    locations:value(generated.locations||generated.setting||c.intelligence.visualMotifs,'Use the environments identified by the approved song intelligence; preserve geography and cultural context. Avoid unrelated location jumps.'),
    lighting:value(generated.lighting||[generated.present_timeline,generated.memory_timeline].filter(Boolean),'Use motivated light appropriate to the lyric setting and emotional arc.'),
    colourTexture:visual?.colours||value(generated.palette||[generated.present_timeline,generated.memory_timeline].filter(Boolean),'Natural skin tones and consistent film texture appropriate to the song'),
    cinematography:[visual?.direction,value(generated.camera_language||generated.overall_style,'Intimate medium shots and environmental wides; deliberate slow movement, stable eyelines and restrained depth of field')].filter(Boolean).join('; '),
    continuity:`Repeat the same wardrobe, props, palette and locations across the full video and all six Shorts. Musical arc: ${recipe?.candidate.direction.arrangementArc||value(c.intelligence.arc,'follow the saved emotional arc')}.`,
    branding:[visual?.brandText,visual?.watermark,visual?.thumbnail,visual?.typography].filter(Boolean).join('; ')||`${c.channelName}: restrained consistent identity; keep image masters free of generated lettering`,
    avoid:[...rules.filter(r=>r.strength==='avoid').map(r=>`[${r.id}] ${r.text}`),value(social.avoid,''),'No invented collaborators, unrelated cultural clichés, distorted anatomy, inconsistent faces, baked-in fake logos or text'].filter(Boolean).join('; '),
    rules,
  };
}
export function bibleText(b: VisualBible) { return Object.entries(b).filter(([key])=>key!=='rules').map(([key,v])=>`${key}: ${v}`).join('\n')+'\nChannel rules:\n'+b.rules.map(r=>`[${r.id}] ${r.strength.toUpperCase()}${r.locked?' LOCKED':''}: ${r.text}`).join('\n'); }
export function biblePrompts(b: VisualBible, w: CreativeWorkspace, c: MusicContext) {
  const sections=[...c.lyrics.matchAll(/^\s*\[([^\]]+)\]/gm)].map(m=>m[1]);
  return w.slots.map((s,i)=>({slotId:s.id,prompt:`${bibleText(b)}\n${s.label}: ${s.kind==='scene'?(sections[s.number-1]||`Narrative beat ${s.number}`):s.kind==='short'?`Independent emotional hook ${s.number}`:s.kind==='cover'?'A single iconic release-cover image':'A clear compelling landscape thumbnail composition'}. ${s.kind==='short'?'9:16; main subject in central safe zone':s.kind==='cover'?'1:1 square cover composition':'16:9 with readable visual hierarchy'}. Beat ${i+1}: ${b.mood}. Preserve continuity. No lettering; final cover and thumbnail have explicit upload/replace slots.`}));
}
export function applyVisualBible(workspace:CreativeWorkspace,b:VisualBible,c:MusicContext,approved=false) {
  const w=structuredClone(workspace),text=bibleText(b);
  if(w.approvedBible!==text)w.slots.forEach(slot=>{delete slot.approvedId;});
  w.bible=text;if(approved)w.approvedBible=text;else delete w.approvedBible;
  const prompts=biblePrompts(b,w,c);w.slots.forEach(slot=>{slot.prompt=prompts.find(p=>p.slotId===slot.id)!.prompt;});
  return w;
}
export function subtitlePhrases(lyrics:string) {
  return lyrics.split(/\r?\n/u).map(line=>/^\s*\[[^\]]+\]\s*$/u.test(line)||/^\s*\((?:mukhda|hook|antara|verse|chorus|bridge|intro|outro|final|pre[- ]?chorus|instrumental|मुखड़ा|मुखड़ा|अंतरा|कोरस|ब्रिज)[^)]*\)\s*$/iu.test(line)||/^\s*[⸻—_-]+\s*$/u.test(line)?'':line.replace(/\[(?:verse|chorus|bridge|intro|outro|hook|pre[- ]?chorus|instrumental|solo|interlude|refrain)[^\]]*\]/giu,'').trim()).filter(line=>line&&!/^\((?:instrumental|guitar solo|music|intro|outro)\)$/iu.test(line)).flatMap(line=>{
    const words=line.split(/\s+/u);const phrases:string[]=[];let phrase='';for(const word of words){if(phrase&&Array.from(phrase+' '+word).length>42){phrases.push(phrase);phrase=word;}else phrase+=(phrase?' ':'')+word;}if(phrase)phrases.push(phrase);return phrases;
  });
}
export function suggestCues(lyrics:string,duration:number):Cue[] {
  if(!Number.isFinite(duration)||duration<=0)throw Error('Readable master audio is required.');
  const phrases=subtitlePhrases(lyrics), weights=phrases.map(p=>Array.from(p).length),total=weights.reduce((a,b)=>a+b,0);let at=0;
  return phrases.map((text,i)=>{const start=at;at+=duration*weights[i]/total;return{start:Number(start.toFixed(3)),end:i===phrases.length-1?duration:Number(at.toFixed(3)),text};});
}
export function validateCues(cues:Cue[],duration:number,lyrics:string) {
  if(!cues.length||cues.length>3000)throw Error('Add subtitle phrases from the saved lyrics.');
  if(cues.map(c=>c.text).join('\n')!==subtitlePhrases(lyrics).join('\n'))throw Error('Subtitle words must match the saved lyrics; edit timing only.');
  cues.forEach((c,i)=>{if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end>duration+.01||(i&&c.start<cues[i-1].end-.01))throw Error('Subtitle timing must be ordered, non-overlapping and inside the master audio.');});
}
export function defaultFinishing(c:MusicContext,duration:number):Finishing {
  return{...channelBranding(c),subtitles:true,cues:suggestCues(c.lyrics,duration),reviewed:false,lyrics:c.lyrics,language:c.language,transition:'fade'};
}
