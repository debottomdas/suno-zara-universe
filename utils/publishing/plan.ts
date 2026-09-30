export type Destination={id:string;platform:string;name:string;channelId:string;accountId?:string|null;available?:boolean};
export type Asset={key:string;slot:number;label:string;version:string;url?:string;ready:boolean;reason?:string};
export type PlanRow={key:string;assetKey:string;destinationId:string;localTime:string};
export type Plan={projectId:string;channelId:string;timezone:string;revision:string;rows:PlanRow[]};
export function localDateTime(iso:string,timezone:string){
 const p=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(iso));
 const v=(k:string)=>p.find(p=>p.type===k)?.value;
 return `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
}
// Enumerate offsets around the date, then round-trip. Reject skipped AND ambiguous
// wall times so the creator never accidentally approves the wrong DST occurrence.
export function toProviderTime(local:string,timezone:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))throw Error('Choose a valid local date and time.');
 new Intl.DateTimeFormat('en',{timeZone:timezone}).format();
 const wall=Date.parse(local+'Z'),matches=new Set<number>();
 if(!Number.isFinite(wall))throw Error('Invalid date.');
 for(let h=-36;h<=36;h+=6){const probe=wall+h*3600000;const offset=Date.parse(localDateTime(new Date(probe).toISOString(),timezone)+'Z')-probe;const candidate=wall-offset;if(localDateTime(new Date(candidate).toISOString(),timezone)===local)matches.add(candidate);}
 if(matches.size!==1)throw Error(matches.size?'This time occurs twice when the clocks change. Choose another time.':'This local time does not exist when the clocks change. Choose another time.');
 return new Date([...matches][0]).toISOString();
}
export function activeAssets(assets:Asset[]){return assets.filter(a=>a.key==='full'||Number.isInteger(a.slot)&&a.slot>=1&&a.slot<=6);}
export function deriveRows(assets:Asset[],destinations:Destination[],channelId:string,timezone:string,start:string):PlanRow[]{
 if(!channelId)throw Error('Choose an individual Universe channel.');
 if(destinations.some(d=>d.available===false||d.channelId!==channelId||!['youtube','instagram','facebook','tiktok'].includes(d.platform)))throw Error('Destination belongs to another Universe channel.');
 const current=activeAssets(assets);if(current.length!==7||!['full',...Array.from({length:6},(_,i)=>`short-${i+1}`)].every((key,slot)=>current.some(a=>a.key===key&&a.slot===slot&&a.ready)))throw Error('Review the full video and all six Shorts in Music Production.');
 return destinations.flatMap(d=>current.filter(a=>d.platform==='youtube'||a.slot>0).map(a=>({key:`${d.id}:${a.key}`,assetKey:a.key,destinationId:d.id,localTime:new Date(Date.parse(localDateTime(start,timezone)+'Z')+a.slot*86400000).toISOString().slice(0,16)})));
}
export function validatePlan(plan:Plan,snapshot:any,now=Date.now()){
 if(!plan.channelId||plan.channelId!==snapshot.channelId||plan.projectId!==snapshot.projectId)throw Error('The selected release or channel changed.');
 if(!snapshot.ready)throw Error(snapshot.reasons.join(' '));
 if(plan.revision!==snapshot.revision)throw Error('Assets, copy, connections or receipts changed. Review a new plan.');
 if(!plan.rows.length||plan.rows.length>200)throw Error('Choose at least one publication.');
 const seen=new Set<string>();const youtubeAssets=new Set<string>();
 return plan.rows.map(row=>{
 const asset=snapshot.assets.find((a:Asset)=>a.key===row.assetKey&&a.ready),destination=snapshot.destinations.find((d:Destination)=>d.id===row.destinationId&&d.channelId===plan.channelId);
 if(!asset||!destination||destination.available===false||(destination.platform!=='youtube'&&asset.slot===0))throw Error('Invalid asset or destination.');
 if(destination.platform==='youtube'){if(youtubeAssets.has(asset.key))throw Error('Choose one YouTube destination per asset.');youtubeAssets.add(asset.key);}
 const key=`${destination.id}:${asset.key}`;if(seen.has(key)||row.key!==key)throw Error('Duplicate or invalid publication.');seen.add(key);
 const dueAt=toProviderTime(row.localTime,plan.timezone),time=Date.parse(dueAt);
 if(time<=now+120000)throw Error('Choose publication times at least two minutes in the future.');
 if(destination.platform!=='youtube'&&time>now+29*86400000)throw Error('Buffer posts must be scheduled within 29 days.');
 return {...row,asset,destination,dueAt};
 });
}
export function receiptStatus(r:any){if(r.status==='error'||r.status==='failed')return 'Failed';if(r.status==='sent'||r.status==='published')return 'Published';if(r.status==='scheduled')return 'Scheduled';return 'Needs Attention';}

export function deliveryCopy(social:any,platform:string,slot:number){
 const pack=social?.[platform==='youtube'?(slot?'youtube_shorts':'youtube_full'):platform]||{};
 const list=platform==='youtube'?'shorts':platform==='tiktok'?'posts':'reels';
 const item=slot?(pack[list]||[]).find((x:any,i:number)=>Number(x.shortNumber??x.reelNumber??x.postNumber??i+1)===slot)||{}:pack;
 const title=slot?item.title:pack.recommendedTitle;
 const text=platform==='youtube'?(slot?item.description:pack.finalDescription||pack.fullDescription||pack.openingDescription):[item.caption,item.fullSongCta,item.engagementPrompt||item.commentPrompt].filter(Boolean).join('\n\n');
 return {title:title||'',text:[text,(item.hashtags||pack.hashtags||[]).join(' ')].filter(Boolean).join('\n\n')};
}
export function currentReceipt(receipt:any,assets:Asset[]){return Boolean(receipt.assetVersion&&assets.some(a=>a.ready&&a.version===receipt.assetVersion&&a.slot===(receipt.kind==='full'?0:receipt.slot)));}
export function assessAsset(slot:number,item:any,versions:any,expectedKey?:string):Asset{
 const key=slot?`short-${slot}`:'full';
 const version=versions.versions?.find((v:any)=>v.id===versions.approved?.[key]);
 const outdated=version?.source==='generated'&&expectedKey!==undefined&&version.dependencyKey!==expectedKey;
 const unverified=expectedKey!==undefined&&item?.approvedSource==='generated'&&!version;
 const past=versions.versions?.filter((v:any)=>v.slot===slot&&v.source==='generated').at(-1);
 const changed=outdated||(!item?.approvedVideo&&past&&expectedKey!==undefined&&past.dependencyKey!==expectedKey);
 const label=slot?`Short ${slot}`:'Full video';
 return {key,slot,label,version:version?.id||item?.approvedVideo?.filename||'',url:item?.approvedVideo?.fileUrl,ready:Boolean(item?.approvedVideo)&&!outdated&&!unverified,reason:changed?`${label} needs updating because its visual or source changed.`:`${label} needs review in Music Production.`};
}
