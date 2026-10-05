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
  if(f.subtitles){
    if(f.reviewed!==true)throw Error('Listen and approve subtitle timings before rendering.');
    if(!f.cues.length||f.cues.map(c=>c.text).join('\n')!==cleanPhrases(f.lyrics).join('\n'))throw Error('Subtitles must use exact saved lyric phrases.');
    f.cues.forEach((c,i)=>{if(typeof c.text!=='string'||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end>duration+.01||(i&&c.start<f.cues[i-1].end-.01))throw Error('Invalid subtitle timing.');});
  }
}
export function assDocument(f,duration,slot=0,offset=0) {
  const vertical=slot>0,width=vertical?1080:1920,height=vertical?1920:1080;
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Lyrics,${f.font},${vertical?62:46},${colour(f.colour)},${colour(f.accent)},&H00101010&,&H88000000&,0,0,0,0,100,100,0,0,1,3,1,2,${vertical?100:160},${vertical?200:160},${vertical?410:110},1\nStyle: Brand,${f.font},${f.brandFontSize||(vertical?30:32)},${colour(f.accent)},&H00FFFFFF&,&H00101010&,&H88000000&,0,0,0,0,100,100,0,0,1,2,0,${f.brandAlignment||8},100,${vertical?200:100},${vertical?180:60},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events=[];
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
  if(f.brandText){const text=`{\\alpha&H${Math.round((1-(f.brandOpacity??1))*255).toString(16).padStart(2,'0')}&}`+escape(f.brandText);if(f.watermarkEnabled!==false)events.push(`Dialogue: 1,${stamp(0)},${stamp(duration)},Brand,,0,0,0,,${text}`);
    if(!vertical&&f.intro)events.push(`Dialogue: 2,${stamp(0)},${stamp(f.intro)},Brand,,0,0,0,,{\\an5\\fs52\\fad(250,250)}${text}`);
    if(!vertical&&f.outro)events.push(`Dialogue: 2,${stamp(Math.max(0,duration-f.outro))},${stamp(duration)},Brand,,0,0,0,,{\\an5\\fs52\\fad(250,250)}${text}`);
  }
  return header+events.join('\n')+'\n';
}
export function fadeFilter(duration){const fade=Math.min(.3,duration/4);return `fade=t=in:st=0:d=${fade},fade=t=out:st=${Math.max(0,duration-fade)}:d=${fade}`;}

// All inputs are downloaded and SHA-256 checked before this specification is used.
export function brandingRenderSpec(f,duration,slot,assets,assFile,fontDirectory){
 const width=slot?1080:1920,height=slot?1920:1080,inputs=[],filters=[`[0:v]ass=${assFile}${fontDirectory?`:fontsdir=${fontDirectory}`:''}[brand0]`];
 let previous='brand0',index=2,n=0;
 for(const asset of assets.filter(a=>a.role!=='font')){
  if(['logo','watermark'].includes(asset.role)&&f.watermarkEnabled===false)continue;
  const image=asset.mimeType.startsWith('image/');if(!image&&!asset.mimeType.startsWith('video/'))throw Error('Unsupported channel branding asset type.');
  const intro=asset.role==='intro',outro=asset.role==='outro';if(intro&&!f.intro||outro&&!f.outro)continue;
  inputs.push(...(image?['-loop','1']:['-stream_loop','-1']),'-i',asset.file);
  const start=outro?Math.max(0,duration-f.outro):0,end=intro?f.intro:duration;
  const full=intro||outro,alignment=f.brandAlignment||8;
  const x=full?'(W-w)/2':[1,7].includes(alignment)?'60':[3,9].includes(alignment)?'W-w-60':'(W-w)/2';
  const y=full?'(H-h)/2':[1,2,3].includes(alignment)?'H-h-60':'60';
  const overlay=`overlay${++n}`,next=`brand${n}`;
  filters.push(`[${index++}:v]scale=${full?width:Math.round(width*.12)}:${full?height:-1}:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${f.brandOpacity??1},setpts=PTS-STARTPTS+${start}/TB[${overlay}]`);
  filters.push(`[${previous}][${overlay}]overlay=x=${x}:y=${y}:enable='between(t,${start},${end})':eof_action=pass[${next}]`);previous=next;
 }
 return {inputs,filter:filters.join(';'),output:`[${previous}]`};
}
