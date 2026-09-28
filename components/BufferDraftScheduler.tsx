"use client";
import {useRef,useState} from 'react';
import {singleDraftItem,ukInput,ukTimeLabel,ukTimeToIso} from '@/utils/buffer-scheduling';
type Receipt={itemKey:string;postId:string;slot:number;channelId:string;channelName?:string;service:string;status?:string;mediaUrl?:string};
export default function BufferDraftScheduler({songTitle,receipt,disabled,onSchedule}:{songTitle:string;receipt:Receipt;disabled:boolean;onSchedule:(dueAt:string)=>Promise<void>}) {
  const [open,setOpen]=useState(false),[value,setValue]=useState(''),[confirmedTime,setConfirmedTime]=useState(''),[error,setError]=useState(''),[attempted,setAttempted]=useState(false);
  const submitting=useRef(false);
  const button='rounded-lg border border-cyan-200/30 px-3 py-2 text-xs font-bold text-cyan-100 disabled:opacity-40';
  function review(){try{const iso=ukTimeToIso(value);singleDraftItem(receipt,iso);setConfirmedTime(iso);setError('');}catch(e){setError(e instanceof Error?e.message:'Check the publication time.');}}
  async function submit(){
    if(disabled||submitting.current||attempted||!confirmedTime)return;
    try{singleDraftItem(receipt,confirmedTime);}catch(e){setError(e instanceof Error?e.message:'Review the time again.');setConfirmedTime('');return;}
    submitting.current=true;setAttempted(true);
    try{await onSchedule(confirmedTime);setOpen(false);}catch(e){setError((e instanceof Error?e.message:'The result is uncertain.')+' Stop and verify Buffer status before another attempt.');}finally{submitting.current=false;}
  }
  return <div className="mt-3" data-buffer-post-id={receipt.postId}>
    {!open?<button type="button" className={button} disabled={disabled||attempted} onClick={()=>{setValue(ukInput(new Date(Date.now()+15*60000)));setOpen(true);}}>Schedule this draft</button>:
      <section aria-label={`Schedule ${receipt.service} Short ${receipt.slot}`} className="space-y-3 rounded-lg border border-cyan-200/20 bg-[#0d2029] p-3 text-xs text-zinc-100">
        <h4 className="font-bold">{confirmedTime?'Confirm one draft schedule':'Schedule this draft'}</h4>
        <dl className="space-y-2"><div><dt>Song</dt><dd>{songTitle}</dd></div><div><dt>Short</dt><dd>{receipt.slot}</dd></div><div><dt>Destination</dt><dd>{receipt.channelName || receipt.channelId} · {receipt.service}</dd></div><div><dt>Existing Buffer post ID</dt><dd className="break-all">{receipt.postId}</dd></div></dl>
        {confirmedTime?<><p><b>Publication:</b> {ukTimeLabel(confirmedTime)}</p><p>UK timezone: Europe/London (BST/GMT). UTC: {confirmedTime}</p><p>Only this existing draft will be scheduled. Buffer will publish it at this time; platform processing may delay delivery.</p><button type="button" className={button} disabled={disabled||attempted} onClick={()=>void submit()}>{attempted?'Request submitted — verify status':'Confirm and schedule 1 draft'}</button>{!attempted&&<button type="button" className={button} onClick={()=>setConfirmedTime('')}>Edit time</button>}</>:
          <><label className="block">Publication date and time — UK (Europe/London)<input autoFocus type="datetime-local" className="mt-2 block w-full rounded border border-white/20 bg-[#0d2029] p-2" value={value} disabled={attempted} onChange={e=>setValue(e.target.value)}/></label><button type="button" className={button} disabled={disabled||attempted} onClick={review}>Review schedule</button></>}
        {error&&<p role="alert" className="text-red-200">{error}</p>}
        {!attempted&&<button type="button" className={button} onClick={()=>{setOpen(false);setConfirmedTime('');setError('');}}>Cancel</button>}
      </section>}
  </div>;
}
