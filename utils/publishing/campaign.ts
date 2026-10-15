import {deriveRows,localDateTime,toProviderTime,type Plan,type PlanRow,type Destination,type Asset} from './plan';
export const platformNames:Record<string,string>={youtube:'YouTube',instagram:'Instagram',facebook:'Facebook',tiktok:'TikTok'};
export type Timing={main:string;shortsStart:string;cadence:number;custom:string[]};
function addDays(local:string,days:number){return new Date(Date.parse(local+'Z')+days*86400000).toISOString().slice(0,16)}
export function defaultTiming(timezone:string,now=Date.now()):Timing{
 const tomorrow=addDays(localDateTime(new Date(now).toISOString(),timezone).slice(0,10)+'T18:00',1);
 return {main:tomorrow,shortsStart:addDays(tomorrow,1),cadence:1,custom:Array.from({length:6},(_,i)=>addDays(tomorrow,i+1))};
}
export function shortTimes(t:Timing){if(![0,1,2,3,7].includes(t.cadence))throw Error('Choose a supported cadence.');return t.cadence===0?t.custom:Array.from({length:6},(_,i)=>addDays(t.shortsStart,i*t.cadence));}
export function campaignRows(assets:Asset[],destinations:Destination[],channelId:string,timezone:string,t:Timing):PlanRow[]{
 const times=shortTimes(t);if(times.length!==6)throw Error('Choose a time for each of the six Shorts.');
 for(const local of [t.main,...times])toProviderTime(local,timezone);
 return deriveRows(assets,destinations,channelId,timezone,toProviderTime(t.main,timezone)).map(row=>({...row,localTime:row.assetKey==='full'?t.main:times[Number(row.assetKey.split('-')[1])-1]}));
}
export function campaignSummary(rows:PlanRow[],destinations:Destination[]){return Object.entries(platformNames).map(([platform,name])=>({platform,name,count:rows.filter(r=>destinations.some(d=>d.id===r.destinationId&&d.platform===platform)).length})).filter(x=>x.count);}
export function receiptKey(row:PlanRow,d:Destination){return d.platform==='youtube'?(row.assetKey==='full'?'youtube-full':`youtube-short-${row.assetKey.split('-')[1].padStart(2,'0')}`):`buffer-${d.id}-short-${row.assetKey.split('-')[1].padStart(2,'0')}`;}
export function campaignProgress(plan:Plan,assets:Asset[],destinations:Destination[],receipts:any[],running:boolean){return plan.rows.map(row=>{
 const d=destinations.find(d=>d.id===row.destinationId),a=assets.find(a=>a.key===row.assetKey);
 const receipt=d&&receipts.find(r=>r.itemKey===receiptKey(row,d)&&r.assetVersion===a?.version);
 const matches=receipt&&Date.parse(receipt.dueAt||receipt.scheduledAt)===Date.parse(toProviderTime(row.localTime,plan.timezone));
 let status='Waiting';
 if(receipt){if(['error','failed'].includes(receipt.status))status='Failed';else if(matches&&['scheduled','sent','published'].includes(receipt.status))status=receipt.status==='scheduled'?'Scheduled':'Published';else if(receipt.status==='submitting')status=running?'Uploading / scheduling':'Needs reconciliation';else status='Needs reconciliation';}
 else if(!running)status='Not started';
 return {...row,platform:d?.platform||'',label:a?.label||row.assetKey,destination:d?.name||'',status};
});}

export function timingFromRows(rows:PlanRow[],timezone:string):Timing {
 const fallback=defaultTiming(timezone),custom=Array.from({length:6},(_,i)=>rows.find(r=>r.assetKey===`short-${i+1}`)?.localTime||fallback.custom[i]);
 return {main:rows.find(r=>r.assetKey==='full')?.localTime||fallback.main,shortsStart:custom[0],cadence:0,custom};
}
