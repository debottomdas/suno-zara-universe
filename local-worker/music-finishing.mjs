// Finishing for the existing renderer: no translation or audio processing.
export function cleanPhrases(lyrics) {
  return String(lyrics).split(/\r?\n/u).map(line=>/^\s*\[[^\]]+\]\s*$/u.test(line)||/^\s*\((?:mukhda|hook|antara|verse|chorus|bridge|intro|outro|final|pre[- ]?chorus|instrumental|मुखड़ा|मुखड़ा|अंतरा|कोरस|ब्रिज)[^)]*\)\s*$/iu.test(line)||/^\s*[⸻—_-]+\s*$/u.test(line)?'':line.replace(/\[(?:verse|chorus|bridge|intro|outro|hook|pre[- ]?chorus|instrumental|solo|interlude|refrain)[^\]]*\]/giu,'').trim()).filter(line=>line&&!/^\((?:instrumental|guitar solo|music|intro|outro)\)$/iu.test(line)).flatMap(line=>{
    const words=line.split(/\s+/u),phrases=[];let phrase='';for(const word of words){if(phrase&&Array.from(phrase+' '+word).length>42){phrases.push(phrase);phrase=word;}else phrase+=(phrase?' ':'')+word;}if(phrase)phrases.push(phrase);return phrases;
  });
}
const stamp=t=>{const cs=Math.max(0,Math.round(t*100));return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;};
const escape=text=>String(text).replace(/\\/gu,'\\\\').replace(/\{/gu,'\\{').replace(/\}/gu,'\\}').replace(/[\r\n]/gu,' ').replace(/[\x00-\x1f]/gu,'');
const colour=value=>/^#[0-9a-f]{6}$/i.test(value)?`&H00${value.slice(5,7)}${value.slice(3,5)}${value.slice(1,3)}&`:'&H00FFFFFF&';
export function validateFinishing(f,duration) {
  if(!f||typeof f!=='object'||typeof f.subtitles!=='boolean'||!Array.isArray(f.cues)||f.cues.length>3000||typeof f.lyrics!=='string'||f.lyrics.length>100000)throw Error('Invalid video finishing settings.');
  if(!['cut','fade'].includes(f.transition)||!Number.isFinite(f.intro)||!Number.isFinite(f.outro)||f.intro<0||f.outro<0||f.intro>5||f.outro>5||f.intro+f.outro>duration)throw Error('Review intro/outro and transitions.');
  if(typeof f.brandText!=='string'||f.brandText.length>200||typeof f.font!=='string'||f.font.length>100||/[\n,]/u.test(f.font))throw Error('Invalid brand or subtitle font.');
  if(f.brandOpacity!==undefined&&(!Number.isFinite(f.brandOpacity)||f.brandOpacity<0||f.brandOpacity>1))throw Error('Invalid channel watermark opacity.');
  if(f.brandFontSize!==undefined&&(!Number.isFinite(f.brandFontSize)||f.brandFontSize<12||f.brandFontSize>120))throw Error('Invalid channel watermark size.');
  if(f.brandAlignment!==undefined&&![1,2,3,7,8,9].includes(f.brandAlignment))throw Error('Invalid channel watermark position.');
  if(f.structuredBranding!==undefined&&typeof f.structuredBranding!=='boolean')throw Error('Invalid structured branding flag.');
  if(f.structuredBranding){
    if(typeof f.watermarkEnabled!=='boolean')throw Error('Invalid persistent branding flag.');
    for(const key of ['brandHorizontalMargin','brandVerticalMargin'])if(!Number.isFinite(f[key])||f[key]<0||f[key]>500)throw Error('Invalid branding margin.');
    if(![.08,.12,.16].includes(f.brandLogoWidth))throw Error('Invalid branding size preset.');
    if(!Number.isFinite(f.introBrandOpacity)||f.introBrandOpacity<0||f.introBrandOpacity>1||!Number.isFinite(f.introBrandFontSize)||f.introBrandFontSize<12||f.introBrandFontSize>120||![1,2,3,7,8,9].includes(f.introBrandAlignment))throw Error('Invalid preserved intro/outro branding.');
  }
  if(f.openingTitle!==undefined){
    const t=f.openingTitle;
    if(!t||typeof t!=='object'||typeof t.enabled!=='boolean'||typeof t.showRomanTitle!=='boolean'||!['upper-centre','centre','lower-centre'].includes(t.position)||!['clean','cinematic','minimal'].includes(t.style)||!Number.isFinite(t.durationSeconds)||t.durationSeconds<=0||t.durationSeconds>30)throw Error('Invalid opening title settings.');
    for(const key of ['nativeTitle','secondaryTitle'])if(typeof t[key]!=='string'||t[key].length>1000)throw Error('Invalid opening title content.');
    if(typeof f.channelName!=='string'||f.channelName.length>200||typeof f.language!=='string'||f.language.length>100)throw Error('Invalid opening channel or language.');
  }
  if(f.subtitles){
    if(f.reviewed!==true)throw Error('Listen and approve subtitle timings before rendering.');
    if(!f.cues.length||f.cues.map(c=>c.text).join('\n')!==cleanPhrases(f.lyrics).join('\n'))throw Error('Subtitles must use exact saved lyric phrases.');
    f.cues.forEach((c,i)=>{if(typeof c.text!=='string'||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end>duration+.01||(i&&c.start<f.cues[i-1].end-.01))throw Error('Invalid subtitle timing.');});
  }
}
function activeOpening(f){return f.openingTitle?.enabled===true&&Boolean(f.openingTitle.nativeTitle?.trim());}
function openingEvent(f,duration,width,height){
 const t=f.openingTitle,end=Math.min(t.durationSeconds,duration),fade=Math.round(Math.min(300,end*1000/4));
 const [native,secondary,channel,outline,bold,spacing]={clean:[64,40,26,2,0,0],cinematic:[72,44,28,2,1,1],minimal:[52,34,24,1,0,0]}[t.style];
 const normalized=value=>value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase();
 // Letter spacing splits Bengali vowel clusters in the local ASS shaper.
 const nativeSpacing=/\p{Script=Bengali}/u.test(t.nativeTitle)?0:spacing;
 const lines=[`{\\fs${native}\\b${bold}\\fsp${nativeSpacing}}${escape(t.nativeTitle)}`];
 if(t.showRomanTitle&&t.secondaryTitle.trim()&&normalized(t.secondaryTitle)!==normalized(t.nativeTitle))lines.push(`{\\fs${secondary}\\b0\\fsp0}${escape(t.secondaryTitle)}`);
 if(f.channelName.trim())lines.push(`{\\fs${channel}\\b0\\fsp0}${escape(f.channelName)}`);
 const y=Math.round(height*{'upper-centre':.25,centre:.5,'lower-centre':.7}[t.position]);
 return `Dialogue: 3,${stamp(0)},${stamp(Math.max(.01,end))},Opening,,0,0,0,,{\\an5\\pos(${width/2},${y})\\bord${outline}\\fad(${fade},${fade})}${lines.join('\\N')}`;
}
function persistentLockup(f,slot,assets){
 const count=assets.filter(a=>['logo','watermark'].includes(a.role)).length;
 if(!f.structuredBranding||f.watermarkEnabled===false||!f.brandText||!count)return null;
 const gap={26:12,32:16,42:20}[f.brandFontSize];
 const logoWidth=Math.round((slot?1080:1920)*f.brandLogoWidth);
 return {gap,logoWidth,count,assetWidth:count*logoWidth+(count-1)*gap,textHeight:Math.ceil(f.brandFontSize*1.5)};
}
export function assDocument(f,duration,slot=0,offset=0,assets=f.renderAssets||[]) {
  const vertical=slot>0,width=vertical?1080:1920,height=vertical?1920:1080;
  let header=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Lyrics,${f.font},${vertical?62:46},${colour(f.colour)},${colour(f.accent)},&H00101010&,&H88000000&,0,0,0,0,100,100,0,0,1,3,1,2,${vertical?100:160},${vertical?200:160},${vertical?410:110},1\nStyle: Brand,${f.font},${f.brandFontSize||(vertical?30:32)},${colour(f.accent)},&H00FFFFFF&,&H00101010&,&H88000000&,0,0,0,0,100,100,0,0,1,2,0,${f.brandAlignment||8},${f.structuredBranding?f.brandHorizontalMargin:100},${f.structuredBranding?f.brandHorizontalMargin:vertical?200:100},${f.structuredBranding?f.brandVerticalMargin:vertical?180:60},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  if(f.structuredBranding){
    const style=header.match(/^Style: Brand,.*$/m)[0].split(',');
    style[0]='Style: IntroBrand';style[2]=String(f.introBrandFontSize);style[18]=String(f.introBrandAlignment);style[19]='100';style[20]=String(vertical?200:100);style[21]=String(vertical?180:60);
    header=header.replace('[Events]',style.join(',')+'\n\n[Events]');
  }
  const opening=activeOpening(f);
  if(opening){
    const style=header.match(/^Style: Brand,.*$/m)[0].split(',');
    style[0]='Style: Opening';style[2]='64';style[3]=colour(f.colour);style[18]='5';style[19]='60';style[20]='60';style[21]='0';
    header=header.replace('[Events]',style.join(',')+'\n\n[Events]');
  }
  const lockup=persistentLockup(f,slot,assets);
  if(lockup&&[1,3,7,9].includes(f.brandAlignment)){
    const style=header.match(/^Style: Brand,.*$/m)[0].split(',');
    // IntroBrand was copied before changing persistent text margins.
    style[[1,7].includes(f.brandAlignment)?19:20]=String(f.brandHorizontalMargin+lockup.assetWidth+lockup.gap);
    header=header.replace(/^Style: Brand,.*$/m,style.join(','));
  }
  const events=opening?[openingEvent(f,duration,width,height)]:[];
  if(f.subtitles)for(const cue of f.cues){
    const start=Math.max(0,cue.start-offset),end=Math.min(duration,cue.end-offset);if(end<=start)continue;
    let text=escape(cue.text);
    if(vertical){const words=cue.text.split(/\s+/u),total=words.reduce((n,w)=>n+Array.from(w).length,0),cs=Math.round((cue.end-cue.start)*100);let consumed=0;
      const tags=words.map((word,i)=>{const count=i===words.length-1?cs-consumed:Math.round(cs*Array.from(word).length/total);consumed+=count;return `{\\kf${Math.max(1,count)}}${escape(word)}`;}).join(' ');
      const elapsed=Math.max(0,offset-cue.start)*1000;text=`{\\kt0}${elapsed?`{\\t(0,1,\\1c${colour(f.colour)})}`:''}${tags}`;
      // Clip boundary phrases to this Short; highlight duration follows the visible phrase.
      if(elapsed)text=words.map(word=>`{\\kf${Math.max(1,Math.round((end-start)*100/words.length))}}${escape(word)}`).join(' ');
    }
    events.push(`Dialogue: 0,${stamp(start)},${stamp(end)},Lyrics,,0,0,0,,${text}`);
  }
  if(f.brandText){const text=`{\\alpha&H${Math.round((1-(f.brandOpacity??1))*255).toString(16).padStart(2,'0')}&}`+escape(f.brandText);if(f.watermarkEnabled!==false)events.push(`Dialogue: 1,${stamp(0)},${stamp(duration)},Brand,,0,0,0,,${lockup?'{\\q2}':''}${text}`);
    const introText=f.structuredBranding?`{\\alpha&H${Math.round((1-f.introBrandOpacity)*255).toString(16).padStart(2,'0')}&}`+escape(f.brandText):text;
    const introStyle=f.structuredBranding?'IntroBrand':'Brand';
    if(!vertical&&f.intro&&!opening)events.push(`Dialogue: 2,${stamp(0)},${stamp(f.intro)},${introStyle},,0,0,0,,{\\an5\\fs52\\fad(250,250)}${introText}`);
    if(!vertical&&f.outro)events.push(`Dialogue: 2,${stamp(Math.max(0,duration-f.outro))},${stamp(duration)},${introStyle},,0,0,0,,{\\an5\\fs52\\fad(250,250)}${introText}`);
  }
  return header+events.join('\n')+'\n';
}
export function fadeFilter(duration){const fade=Math.min(.3,duration/4);return `fade=t=in:st=0:d=${fade},fade=t=out:st=${Math.max(0,duration-fade)}:d=${fade}`;}

// All inputs are downloaded and SHA-256 checked before this specification is used.
export function brandingRenderSpec(f,duration,slot,assets,assFile,fontDirectory){
 const width=slot?1080:1920,height=slot?1920:1080,inputs=[],filters=[];
 const opening=activeOpening(f),assFilter=`ass=${assFile}${fontDirectory?`:fontsdir=${fontDirectory}`:''}`;
 if(!opening)filters.push(`[0:v]${assFilter}[brand0]`);
 const lockup=persistentLockup(f,slot,assets);
 let previous=opening?'0:v':'brand0',index=2,n=0,persistentIndex=0,assApplied=!opening;
 const applyAss=()=>{filters.push(`[${previous}]${assFilter}[titleBrand]`);previous='titleBrand';assApplied=true;};
 const ordered=assets.filter(a=>a.role!=='font');
 if(opening)ordered.sort((a,b)=>Number(b.role==='intro')-Number(a.role==='intro'));
 for(const asset of ordered){
  if(opening&&asset.role!=='intro'&&!assApplied)applyAss();
  if(['logo','watermark'].includes(asset.role)&&f.watermarkEnabled===false)continue;
  const image=asset.mimeType.startsWith('image/');if(!image&&!asset.mimeType.startsWith('video/'))throw Error('Unsupported channel branding asset type.');
  const intro=asset.role==='intro',outro=asset.role==='outro';if(intro&&!f.intro||outro&&!f.outro)continue;
  inputs.push(...(image?['-loop','1']:['-stream_loop','-1']),'-i',asset.file);
  const start=outro?Math.max(0,duration-f.outro):0,end=intro?f.intro:duration;
  const full=intro||outro,alignment=f.brandAlignment||8;
  const horizontal=f.structuredBranding?f.brandHorizontalMargin:60,vertical=f.structuredBranding?f.brandVerticalMargin:60;
  let x=full?'(W-w)/2':[1,7].includes(alignment)?String(horizontal):[3,9].includes(alignment)?`W-w-${horizontal}`:'(W-w)/2';
  let y=full?'(H-h)/2':[1,2,3].includes(alignment)?`H-h-${vertical}`:String(vertical);
  if(lockup&&!full){
    const inward=persistentIndex++*(lockup.logoWidth+lockup.gap);
    if([1,7].includes(alignment))x=String(horizontal+inward);
    else if([3,9].includes(alignment))x=`W-w-${horizontal+inward}`;
    else {x=`(W-${lockup.assetWidth})/2+${inward}`;y=`H-h-${vertical+lockup.textHeight+lockup.gap}`;}
  }
  const overlay=`overlay${++n}`,next=`brand${n}`;
  filters.push(`[${index++}:v]scale=${full?width:Math.round(width*(f.structuredBranding?f.brandLogoWidth:.12))}:${full?height:-1}:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${full&&f.structuredBranding?f.introBrandOpacity:f.brandOpacity??1},setpts=PTS-STARTPTS+${start}/TB[${overlay}]`);
  filters.push(`[${previous}][${overlay}]overlay=x=${x}:y=${y}:enable='between(t,${start},${end})':eof_action=pass[${next}]`);previous=next;
 }
 if(!assApplied)applyAss();
 return {inputs,filter:filters.join(';'),output:`[${previous}]`};
}
