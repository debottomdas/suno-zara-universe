import {collection,platforms,sameSocialValue,type Platform,type CopyValue} from './copy';
export function releaseShortSlots(workspace:any):number[]|null{
 if(!workspace?.slots?.length)return null;
 const visuals=workspace.slots.filter((s:any)=>s.kind==='short').map((s:any)=>Number(s.number));
 const slots=workspace.plan?.shorts?.length?workspace.plan.shorts.map((s:any)=>Number(/^short-(\d+)$/.exec(s.slotId)?.[1])):visuals;
 const sorted=[...new Set<number>(slots)].sort((a,b)=>a-b);
 // Publishing/rendering use slot identity, not the number of rows in a Social array.
 if(!sorted.length||sorted.length!==slots.length||sorted.some((n,i)=>n!==i+1||!visuals.includes(n)))throw Error('The release Short slots need review before Social copy can be aligned.');
 return sorted;
}
export async function loadReleaseShortSlots(db:any,userId:string,projectId:string){const {data,error}=await db.from('song_creative_workspaces').select('workspace').eq('song_id',projectId).eq('user_id',userId).maybeSingle();if(error)throw Error('Could not verify the release Short slots.');return releaseShortSlots(data?.workspace);}
export function alignSocialPlatform(pack:CopyValue,platform:Platform,slots:number[],now:string):CopyValue{
 const list=collection(platform);if(!list||!Array.isArray(pack?.[list]))return pack;
 const numberKey=platform==='youtube_shorts'?'shortNumber':platform==='tiktok'?'postNumber':'reelNumber';
 const wanted=new Set(slots),chosen=new Map<number,{value:any;review:any}>();
 const archive=structuredClone(pack._legacyShortPosts||[]);const reviews:Record<string,any>={};
 if(pack._copyReview?.root)reviews.root=structuredClone(pack._copyReview.root);
 pack[list].forEach((value:any,index:number)=>{
  const slot=value[numberKey]===undefined?index+1:Number(value[numberKey]);const review=pack._copyReview?.[`${list}:${index}`];
  if(wanted.has(slot)&&!chosen.has(slot))chosen.set(slot,{value,review});
  else{
   const preserved={slot,value:structuredClone(value),...(review?{review:structuredClone(review)}:{})};
   if(!archive.some((a:any)=>sameSocialValue([a.slot,a.value,a.review],[preserved.slot,preserved.value,(preserved as any).review])))archive.push({...preserved,archivedAt:now,reason:wanted.has(slot)?'Duplicate legacy slot':'Outside current release slots'});
  }
 });
 const missing=slots.filter(slot=>!chosen.has(slot));if(missing.length)throw Error(`Social copy is missing release Short ${missing.join(', ')}. No entries were fabricated or discarded.`);
 const active=slots.map((slot,index)=>{const item=chosen.get(slot)!;if(item.review)reviews[`${list}:${index}`]=structuredClone(item.review);return structuredClone(item.value);});
 const next={...pack,[list]:active,_releaseShortSlots:[...slots]};
 if(archive.length)next._legacyShortPosts=archive;
 if(pack._copyReview)next._copyReview=reviews;
 return next;
}
export function alignSocialRow(row:any,slots:number[],now:string){return Object.fromEntries(platforms.filter(p=>row[p]).map(p=>[p,alignSocialPlatform(row[p],p,slots,now)]));}
