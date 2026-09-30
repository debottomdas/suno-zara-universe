export const platforms=['youtube_full','youtube_shorts','instagram','facebook','tiktok'] as const;
export type Platform=typeof platforms[number];
export type CopyValue=Record<string,any>;
export type CopyVersion={id:string;createdAt:string;source:'existing'|'edited'|'generated';approved:boolean;value:CopyValue};
export type CopyEntry={currentVersionId?:string;versions:CopyVersion[]};
export const collection=(platform:Platform)=>platform==='youtube_shorts'?'shorts':platform==='tiktok'?'posts':['instagram','facebook'].includes(platform)?'reels':null;
const excluded=new Set(['_copyReview','generatorGuidance','shortNumber','reelNumber','postNumber','shorts','reels','posts']);
export function copyFields(value:CopyValue):CopyValue{return Object.fromEntries(Object.entries(value||{}).filter(([k,v])=>!excluded.has(k)&&!k.startsWith('_')&&(typeof v==='string'||Array.isArray(v)||v&&typeof v==='object')));}
export function target(pack:CopyValue,key:string):CopyValue{
 if(key==='root')return copyFields(pack);
 const match=/^(shorts|reels|posts):(\d+)$/.exec(key);
 if(!match||!Array.isArray(pack[match[1]])||!pack[match[1]][Number(match[2])])throw Error('This saved post is not available.');
 return copyFields(pack[match[1]][Number(match[2])]);
}
export function putTarget(pack:CopyValue,key:string,value:CopyValue):CopyValue{
 const next=structuredClone(pack);
 if(key==='root')Object.assign(next,value);
 else{target(pack,key);const [list,index]=key.split(':');next[list][Number(index)]={...next[list][Number(index)],...value};}
 return next;
}
export function entry(pack:CopyValue,key:string):CopyEntry|undefined{return pack._copyReview?.[key];}
export function saveVersion(pack:CopyValue,key:string,value:CopyValue,source:CopyVersion['source'],approve:boolean,id:string,now:string){
 const original=target(pack,key),previous=entry(pack,key);
 const versions=previous?.versions||[{id:`${id}-original`,createdAt:now,source:'existing' as const,approved:false,value:original}];
 const version={id,createdAt:now,source,approved:approve,value};
 const next=approve?putTarget(pack,key,value):structuredClone(pack);
 next._copyReview={...pack._copyReview,[key]:{...previous,versions:[...versions,version],...(approve?{currentVersionId:id}:{})}};
 return next;
}
// Older whole-pack writers may update untouched copy, but never replace reviewed copy or history.
export function preserveReviewed(current:CopyValue,incoming:CopyValue):CopyValue{
 let next={...incoming};delete next._copyReview;delete next._legacyShortPosts;delete next._releaseShortSlots;
 if(current?._legacyShortPosts)next._legacyShortPosts=structuredClone(current._legacyShortPosts);
 if(current?._releaseShortSlots)next._releaseShortSlots=structuredClone(current._releaseShortSlots);
 if(!current?._copyReview)return next;
 for(const [key,record] of Object.entries(current._copyReview) as [string,CopyEntry][]){
  if(!record.currentVersionId)continue;
  if(key!=='root'){const [list,index]=key.split(':');if(!next[list]?.[Number(index)]){next[list]=[...(next[list]||[])];for(let i=0;i<=Number(index);i++)if(!next[list][i])next[list][i]=structuredClone(current[list][i]);}}
  next=putTarget(next,key,target(current,key));
 }
 next._copyReview=structuredClone(current._copyReview);return next;
}
// Editable shape comes from the saved post, never from untrusted object keys.
export function validateCopy(original:any,input:any):any{
 if(typeof original==='string'){if(typeof input!=='string'||input.length>30000)throw Error('Text must be at most 30,000 characters.');return input;}
 if(Array.isArray(original)){if(!Array.isArray(input)||input.length>100)throw Error('Invalid list.');if(original.every(v=>typeof v==='string')){if(input.some(v=>typeof v!=='string'||v.length>30000))throw Error('Invalid text list.');return input;}if(input.length!==original.length)throw Error('Keep the saved list structure.');return original.map((v,i)=>validateCopy(v,input[i]));}
 if(original&&typeof original==='object')return Object.fromEntries(Object.keys(original).map(k=>[k,validateCopy(original[k],input?.[k])]));
 return original;
}

export function sameSocialValue(a:any,b:any){const stable=(value:any)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);return stable(a)===stable(b);}
