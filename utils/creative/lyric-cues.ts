import type {CreativeWorkspace} from './model';
export type LyricCue={start:number;end:number;text:string;lineIndex:number};
export type LyricCueSource={lyricsHash:string;audioKey:string;duration:number};
export type LyricCueReview={version:1;cues:LyricCue[];source:LyricCueSource;reviewed:boolean};
export type LyricCueContext={phrases:string[];language:string;source:LyricCueSource|null};
// Presentation only: the saved lyric document is never rewritten.
export function authoringPhrases(lyrics:string){return lyrics.split(/\r?\n/u).map(line=>line.trim()).filter(line=>line&&!/^\[[^\]]+\]$/u.test(line));}
export async function lyricCueSource(lyrics:string,audioKey:string,duration:number):Promise<LyricCueSource>{
 if(!audioKey||!Number.isFinite(duration)||duration<=0)throw Error('Current final audio is required for lyric timing.');
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(lyrics));
 return {lyricsHash:Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join(''),audioKey,duration};
}
function sameSource(a:LyricCueSource,b:LyricCueSource){return a.lyricsHash===b.lyricsHash&&a.audioKey===b.audioKey&&a.duration===b.duration;}
export function validateLyricCues(value:unknown,phrases:string[],source:LyricCueSource):LyricCue[]{
 if(!Array.isArray(value)||!value.length||value.length>3000)throw Error('Time at least one lyric phrase before saving.');
 let previousEnd=0,previousLine=-1;
 return value.map((row:any)=>{
  if(!row||typeof row!=='object'||!Number.isInteger(row.lineIndex)||row.lineIndex<=previousLine||row.lineIndex>=phrases.length||typeof row.text!=='string'||!row.text.trim()||row.text!==phrases[row.lineIndex])throw Error('Cue phrases must match the current saved lyrics in order.');
  if(!Number.isFinite(row.start)||!Number.isFinite(row.end)||row.start<0||row.end<=row.start||row.start<previousEnd||row.end>source.duration)throw Error('Cue times must be ordered, non-overlapping and inside the final audio.');
  previousEnd=row.end;previousLine=row.lineIndex;
  return {start:row.start,end:row.end,text:row.text,lineIndex:row.lineIndex};
 });
}
export function lyricCueState(review:LyricCueReview|undefined,source:LyricCueSource|null,phrases:string[]):'none'|'draft'|'current'|'stale'{
 if(!review)return 'none';
 if(review.version!==1||!source||!review.source||!sameSource(review.source,source))return 'stale';
 try{validateLyricCues(review.cues,phrases,source);}catch{return 'stale';}
 return review.reviewed===true?'current':'draft';
}
export function saveLyricCueReview(cues:unknown,phrases:string[],source:LyricCueSource,expectedSource:unknown,reviewed:unknown,listened:unknown):LyricCueReview{
 if(!expectedSource||!sameSource(expectedSource as LyricCueSource,source))throw Error('Lyrics or final audio changed. Reload before reviewing timings.');
 if(typeof reviewed!=='boolean'||reviewed&&listened!==true)throw Error('Listen to every timed phrase before marking it reviewed.');
 return {version:1,cues:validateLyricCues(cues,phrases,source),source:{...source},reviewed};
}
// B5B can include this ONLY when cues are actually burned in. B5A clean keys stay unchanged.
export function lyricSubtitleDependency(w:CreativeWorkspace,context:LyricCueContext,used:boolean){
 if(!used)return undefined;
 if(lyricCueState(w.lyricCueReview,context.source,context.phrases)!=='current')throw Error('Reviewed current lyric timings are required.');
 return JSON.stringify({source:w.lyricCueReview!.source,cues:w.lyricCueReview!.cues,subtitlesEnabled:w.subtitlesEnabled});
}
