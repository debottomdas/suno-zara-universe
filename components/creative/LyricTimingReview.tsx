'use client';
import {useEffect,useState} from 'react';
import {lyricCueState,type LyricCueContext,type LyricCueReview} from '@/utils/creative/lyric-cues';
type Row={lineIndex:number;text:string;start:string;end:string};
export default function LyricTimingReview({context,review,audioUrl,audioKey,busy,onSave}:{context:LyricCueContext|null;review?:LyricCueReview;audioUrl?:string;audioKey:string;busy:boolean;onSave:(body:Record<string,unknown>)=>Promise<void>}){
 const [rows,setRows]=useState<Row[]>([]),[listened,setListened]=useState(false),[edited,setEdited]=useState(false);
 useEffect(()=>{setRows(review?.cues.map(c=>({...c,start:String(c.start),end:String(c.end)}))||[]);setListened(false);setEdited(false);},[review,context]);
 const source=context?.source?.audioKey===audioKey?context.source:null;
 const state=lyricCueState(review,source,context?.phrases||[]);
 const update=(index:number,key:'start'|'end',value:string)=>{setRows(rows.map((r,i)=>i===index?{...r,[key]:value}:r));setListened(false);setEdited(true);};
 const ready=rows.length>0&&rows.every(r=>r.start.trim()!==''&&r.end.trim()!=='');
 async function save(reviewed:boolean){if(!source)return;await onSave({cues:rows.map(r=>({...r,start:Number(r.start),end:Number(r.end)})),source,reviewed,listened});}
 return <section aria-label="Lyric timing review"><h3>Optional lyric timing review</h3>
  <p>Time phrases by listening to your final audio. No automatic synchronization is supplied. Choose whether to burn in these timings using Add subtitles to video.</p>
  <p role="status">{state==='none'?'No saved lyric timings':state==='stale'?'Timings are stale: saved lyrics or final audio changed. Keep them for reference, then retime the current phrases.':edited?'Unsaved edits — review required':state==='current'?'Reviewed timings match the saved lyrics and final audio':'Draft timings — listen and review before use'}</p>
  {!source&&<p>Load or analyse the selected final audio to save timings.</p>}
  {audioUrl&&<audio aria-label="Final audio for lyric timing review" controls preload="metadata" src={audioUrl}/>}
  <fieldset disabled={busy||!source}>
   <legend>Source audio times in seconds · partial timing is allowed</legend>
   {(context?.phrases||[]).map((text,lineIndex)=>{const row=rows.find(r=>r.lineIndex===lineIndex&&r.text===text);return <label key={lineIndex} style={{display:'block'}}><input type="checkbox" checked={!!row} onChange={e=>{setRows(e.target.checked?[...rows.filter(r=>r.lineIndex!==lineIndex),{lineIndex,text,start:'',end:''}].sort((a,b)=>a.lineIndex-b.lineIndex):rows.filter(r=>r.lineIndex!==lineIndex));setListened(false);setEdited(true);}}/>{text} · {row?'Timed phrase selected':'Untimed'}</label>;})}
   {rows.map((row,index)=><div key={row.lineIndex}><p>{row.text}</p><button onClick={()=>{setRows(rows.filter((_,i)=>i!==index));setListened(false);setEdited(true);}}>Remove timed phrase</button><label>Start (seconds)<input aria-label={`Lyric ${row.lineIndex+1} start`} type="number" min="0" step="0.01" value={row.start} onChange={e=>update(index,'start',e.target.value)}/></label><label>End (seconds)<input aria-label={`Lyric ${row.lineIndex+1} end`} type="number" min="0" step="0.01" value={row.end} onChange={e=>update(index,'end',e.target.value)}/></label></div>)}
   <label><input type="checkbox" checked={listened} onChange={e=>setListened(e.target.checked)}/>I listened and verified every selected phrase against this final audio.</label>
   <button disabled={!ready} onClick={()=>void save(false)}>Save draft timings</button>
   <button disabled={!ready||!listened||state==='stale'&&!edited} onClick={()=>void save(true)}>Save reviewed timings</button>
  </fieldset>
 </section>;
}
