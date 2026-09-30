import {collection,platforms,target,type Platform} from './copy';
export function blankPlatform(platform:Platform,count=6):any{
 if(platform==='youtube_full')return {recommendedTitle:'',finalDescription:'',hashtags:[],tags:[]};
 const list=collection(platform)!;const numberKey=platform==='youtube_shorts'?'shortNumber':platform==='tiktok'?'postNumber':'reelNumber';
 const root=platform==='instagram'?{feedCaption:'',hashtags:[]}:platform==='facebook'?{mainReleasePost:'',hashtags:[]}:{};
 return {...root,[list]:Array.from({length:count},(_,i)=>({[numberKey]:i+1,...(platform==='youtube_shorts'?{title:'',description:'',hashtags:[],tags:[],fullSongCta:''}:{caption:'',hashtags:[],fullSongCta:''})}))};
}
// Fill only absent/empty fields. Existing copy, including unreviewed copy, wins.
export function fillMissing(current:any,incoming:any):any{
 if(current===undefined||current===null||typeof current==='string'&&!current.trim())return structuredClone(incoming);
 if(Array.isArray(current)&&Array.isArray(incoming)){if(!current.length)return structuredClone(incoming);if(current.every(value=>typeof value==='string'))return current;return Array.from({length:Math.max(current.length,incoming.length)},(_,i)=>incoming[i]===undefined?structuredClone(current[i]):fillMissing(current[i],incoming[i]));}
 if(typeof current==='object'&&!Array.isArray(current)&&incoming&&typeof incoming==='object'&&!Array.isArray(incoming)){const result={...current};for(const key of Object.keys(incoming))if(!key.startsWith('_'))result[key]=fillMissing(current[key],incoming[key]);return result;}
 return current;
}
export function editablePlatform(data:any,platform:Platform,count=6){
 const template=blankPlatform(platform,count);if(!data)return template;
 const result={...template,...structuredClone(data)};const list=collection(platform);
 if(list){
  const numberKey=platform==='youtube_shorts'?'shortNumber':platform==='tiktok'?'postNumber':'reelNumber';
  const original=Array.isArray(data[list])?data[list]:[],used=new Set<number>(),review={...data._copyReview};
  for(const key of Object.keys(review))if(key.startsWith(`${list}:`))delete review[key];
  const append=(post:any,index:number)=>{const nextIndex=result[list].length;if(data._copyReview?.[`${list}:${index}`])review[`${list}:${nextIndex}`]=data._copyReview[`${list}:${index}`];result[list].push(platform==='youtube_shorts'?{title:'',description:'',...post}:{caption:'',...post});};
  result[list]=[];
  for(let n=1;n<=count;n++){const index=original.findIndex((post:any,i:number)=>!used.has(i)&&Number(post[numberKey]??i+1)===n);if(index>=0){used.add(index);append(original[index],index);}else result[list].push(template[list][n-1]);}
  original.forEach((post:any,index:number)=>{if(!used.has(index))append(post,index);});
  if(data._copyReview)result._copyReview=review;
 }

 if(platform==='youtube_full'&&!result.finalDescription&&result.fullDescription)result.finalDescription=result.fullDescription;
 return result;
}
export function missingCopy(row:any,count=6){
 return platforms.flatMap(platform=>{const data=editablePlatform(row?.[platform],platform,count);const list=collection(platform);const keys=[...(['youtube_full','instagram','facebook'].includes(platform)?['root']:[]),...(list?Array.from({length:count},(_,i)=>`${list}:${i}`):[])];return keys.flatMap(key=>{const value=target(data,key);const required=platform==='youtube_full'?['recommendedTitle','finalDescription']:key==='root'?[platform==='instagram'?'feedCaption':'mainReleasePost']:platform==='youtube_shorts'?['title','description']:['caption'];return required.some(field=>!String(value[field]||'').trim())?[{platform,key,value}]:[];});});
}
