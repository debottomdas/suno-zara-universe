import type {ChannelDna} from './model';
export type ChannelContext={channelId:string;channelName:string;dnaRevision:number|null;dna:ChannelDna|null;language?:string};
export function channelBranding(c:ChannelContext){
 const f=c.dna?.sections.visual.fields;
 const expand=(s:string)=>s.replace(/\{channelName\}|\bChannel Name\b/giu,c.channelName);
 const watermark=expand(f?.watermark||'');
 const enabled=!/^(?:none|off|disabled|no watermark|no branding|do not (?:add|use|show)(?: a)? watermark)$/iu.test(watermark.trim());
 const opacityMatch=watermark.match(/(?:opacity|transparency)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(%)?/iu);
 const opacity=opacityMatch?Math.max(0,Math.min(1,Number(opacityMatch[1])/(opacityMatch[2]||Number(opacityMatch[1])>1?100:1))):1;
 const sizeMatch=watermark.match(/(?:font\s*size|text\s*size|size)\s*[:=]?\s*(\d+)\s*(?:px|pt)?/iu);
 const duration=(value:string|undefined)=>{if(!value||/^(?:none|off|disabled)$/iu.test(value.trim()))return 0;const n=value.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|seconds)\b/iu);return n?Math.min(5,Number(n[1])):2;};
 const position=/bottom.*right/iu.test(watermark)?3:/bottom.*left/iu.test(watermark)?1:/bottom/iu.test(watermark)?2:/top.*right/iu.test(watermark)?9:/top.*left/iu.test(watermark)?7:8;
 return {channelId:c.channelId,dnaRevision:c.dnaRevision,channelName:c.channelName,brandText:expand(f?.brandText||c.channelName),watermark,watermarkEnabled:enabled,brandAlignment:position,brandOpacity:opacity,brandFontSize:sizeMatch?Math.max(12,Math.min(120,Number(sizeMatch[1]))):32,font:f?.typography&&/^[\p{L}\p{N} .-]{1,100}$/u.test(f.typography)?f.typography:/bengali|বাংলা/iu.test(c.language||'')?'Kohinoor Bangla':/hindi|हिन्दी/iu.test(c.language||'')?'Kohinoor Devanagari':'Arial',colour:f?.colours?.match(/#[0-9a-f]{6}/giu)?.[0]||'#FFFFFF',accent:f?.colours?.match(/#[0-9a-f]{6}/giu)?.[1]||'#F4CF70',intro:duration(f?.intro),outro:duration(f?.outro),rules:c.dna?Object.values(c.dna.sections).flatMap(s=>s.rules).filter(r=>r.stages.includes('video')):[],assets:c.dna?.assets||[]};
}
export function brandingFinishing(c:ChannelContext,layout:'landscape'|'portrait'='landscape'){
 const legacy=channelBranding(c);
 const identity=c.dna?.sections.visual.identity;
 const branding=identity?{...identity.branding,...identity[layout]?.branding}:null;
 const size=branding?{small:{font:26,width:.08},medium:{font:32,width:.12},large:{font:42,width:.16}}[branding.size]:null;
 return {...legacy,...(branding&&size?{structuredBranding:true,watermarkEnabled:branding.enabled,brandAlignment:{'top-left':7,'top-right':9,'bottom-left':1,'bottom-centre':2,'bottom-right':3}[branding.position],brandOpacity:branding.opacity,brandFontSize:size.font,brandLogoWidth:size.width,brandHorizontalMargin:branding.horizontalMargin,brandVerticalMargin:branding.verticalMargin,introBrandOpacity:legacy.brandOpacity,introBrandFontSize:legacy.brandFontSize,introBrandAlignment:legacy.brandAlignment}:{}),subtitles:false,cues:[],lyrics:'',language:'',reviewed:true,transition:'fade' as const};
}
