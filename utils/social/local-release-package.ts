export type VideoMetadata={title:string;description:string;tags:string[];hashtags:string[];pinnedComment:string;credits:string;categoryId:'10';language:string;thumbnailAssetId:string|null};
export type ShortRelease={slot:number;video:VideoMetadata;instagram:string;facebook:string;tiktok:string;sourceVideoId:string|null};
export type ReleasePackage={schemaVersion:1;projectId:string;channelId:string;full:VideoMetadata;shorts:ShortRelease[];approved:false;generatedBy:'instant'|'ollama'|'gpt';createdAt:string};
export const shortSlots=[1,2,3,4,5,6] as const;
export function validateReleasePackage(value:any,projectId:string,channelId:string):ReleasePackage{
 if(!value||value.schemaVersion!==1||value.projectId!==projectId||value.channelId!==channelId)throw Error('Release package identity mismatch.');
 if(!Array.isArray(value.shorts)||value.shorts.length!==6||value.shorts.some((s:any,i:number)=>s.slot!==i+1))throw Error('Six individually numbered Shorts are required.');
 const check=(v:any,label:string)=>{if(!v||typeof v.title!=='string'||!v.title.trim()||v.title.length>100||typeof v.description!=='string'||!v.description.trim()||v.description.length>5000||!Array.isArray(v.tags)||v.tags.some((x:any)=>typeof x!=='string')||!Array.isArray(v.hashtags)||v.hashtags.some((x:any)=>typeof x!=='string')||typeof v.pinnedComment!=='string'||typeof v.credits!=='string'||v.categoryId!=='10'||typeof v.language!=='string')throw Error('Invalid metadata for '+label);};
 check(value.full,'full video');for(const item of value.shorts){check(item.video,'Short '+item.slot);for(const platform of ['instagram','facebook','tiktok'])if(typeof item[platform]!=='string')throw Error('Invalid '+platform+' for Short '+item.slot);}
 return value as ReleasePackage;
}
