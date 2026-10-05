import sharp,{type OverlayOptions} from 'sharp';
import {existsSync,mkdtempSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {channelBranding,type ChannelContext} from '../channel-dna/context';
import {resolveLocalPath} from '../media-source';
export type VisualBranding=ReturnType<typeof channelBranding>&{enabled:boolean;required:boolean;text:string;ruleIds:string[];fieldsUsed:string[]};
export type VisualBrandAsset={role:'logo'|'watermark'|'font';bytes:Buffer;expectedSha256:string};
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function visualBranding(c:ChannelContext):VisualBranding{
 const normal=channelBranding(c),f=c.dna?.sections.visual.fields;
 const rules=c.dna?Object.values(c.dna.sections).flatMap(s=>s.rules).filter(r=>r.stages.includes('visual')):[];
 const isBrand=(text:string)=>/channel\s*(?:name|branding)|brand(?:ing)?|watermark|logo|চ্যানেল/iu.test(text)||text.includes(c.channelName);
 const required=rules.some(r=>(r.strength==='required'||r.locked)&&r.strength!=='avoid'&&isBrand(r.text))||(/\b(?:mandatory|required|must|every|always)\b/iu.test(f?.watermark||'')&&isBrand(f?.watermark||''));
 const avoided=rules.some(r=>r.strength==='avoid'&&/(?:no|omit|without|avoid|never).*?(?:branding|watermark|channel name)/iu.test(r.text));
 if(required&&(!normal.watermarkEnabled||normal.brandOpacity===0||avoided))throw Error('Active visual DNA has conflicting required and prohibited branding. Resolve it before generating.');
 const enabled=!!c.dna&&!avoided&&normal.watermarkEnabled&&(required||!!f?.watermark.trim()||!!f?.brandText.trim());
 const label=normal.brandText===c.channelName?'':normal.brandText;
 return {...normal,rules,brandAlignment:/top|bottom|left|right/iu.test(f?.watermark||'')?normal.brandAlignment:3,enabled,required,text:enabled?[c.channelName,label].filter(Boolean).join('\n'):'',ruleIds:rules.filter(r=>isBrand(r.text)).map(r=>r.id),fieldsUsed:['channels.name','channels.active_dna_revision','visual.brandText','visual.watermark','visual.typography','visual.colours','visual.rules[stages=visual]']};
}
// Query only referenced visual assets, scoped to both owner and the already-resolved channel.
export async function visualBrandAssets(db:any,userId:string,c:ChannelContext):Promise<VisualBrandAsset[]>{
 const refs=c.dna?.assets.filter(a=>['logo','watermark','font'].includes(a.role))||[];if(!refs.length)return [];
 const {data,error}=await db.from('song_media_assets').select('*,songs!inner(channel_id,user_id)').in('id',refs.map(a=>a.mediaAssetId)).eq('user_id',userId).eq('songs.user_id',userId).eq('songs.channel_id',c.channelId);
 if(error||data?.length!==new Set(refs.map(a=>a.mediaAssetId)).size)throw Error('Visual branding asset is unavailable in the active channel.');
 const output:VisualBrandAsset[]=[];
 for(const ref of refs){const asset=data.find((a:any)=>a.id===ref.mediaAssetId);let bytes:Buffer;
  if(asset.storage_provider==='local')bytes=await readFile(resolveLocalPath(asset.local_path));
  else{const {data:blob,error:downloadError}=await db.storage.from('song-media').download(asset.storage_path);if(downloadError||!blob)throw Error('Visual branding asset could not be read.');bytes=Buffer.from(await blob.arrayBuffer());}
  if(createHash('sha256').update(bytes).digest('hex')!==ref.expectedSha256.toLowerCase())throw Error('Visual branding asset hash no longer matches active DNA.');
  output.push({role:ref.role as VisualBrandAsset['role'],bytes,expectedSha256:ref.expectedSha256});
 }
 return output;
}
let fontConfigReady=false;
function ensureVisualFontConfig(){
 if(fontConfigReady)return;fontConfigReady=true;
 // Bundled macOS libvips can lack its compiled-in Fontconfig directory.
 // Keep the fallback and its cache in a writable temporary directory.
 if(process.platform==='darwin'&&!process.env.FONTCONFIG_FILE){
  const directory=mkdtempSync(join(tmpdir(),'visual-fontconfig-'));
  const config=join(directory,'fonts.conf');
  writeFileSync(config,`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>/System/Library/Fonts</dir><dir>/Library/Fonts</dir><cachedir>${escape(directory)}</cachedir></fontconfig>`);
  process.env.FONTCONFIG_FILE=config;
 }
}
export type VisualFinishingMode = 'clean-source' | 'branded-artwork';
export async function finishVisual(bytes:Buffer,width:number,height:number,c:ChannelContext,assets:VisualBrandAsset[]=[],mode:VisualFinishingMode='branded-artwork'){
 const base=await sharp(bytes,{limitInputPixels:80_000_000}).rotate().resize(width,height,{fit:'cover'}).png().toBuffer();
 if(mode==='clean-source')return {image:base,branding:{channelId:c.channelId,dnaRevision:c.dnaRevision,applied:false,required:false,text:'',fieldsUsed:[]}};
 const brand=visualBranding(c);
 if(!brand.enabled)return {image:base,branding:{channelId:c.channelId,dnaRevision:c.dnaRevision,applied:false,required:brand.required,text:'',fieldsUsed:brand.fieldsUsed}};
 const margin=Math.round(Math.min(width,height)*.035),fontSize=Math.round(brand.brandFontSize*Math.min(width,height)/1080);
 let fontDirectory:string|undefined,fontfile:string|undefined;
 try{
  const font=assets.find(a=>a.role==='font');if(font){fontDirectory=await mkdtemp(join(tmpdir(),'visual-brand-font-'));fontfile=join(fontDirectory,'brand.ttf');await writeFile(fontfile,font.bytes);}
  else if(/bengali|বাংলা/iu.test(c.language||'')&&existsSync('/System/Library/Fonts/KohinoorBangla.ttc'))fontfile='/System/Library/Fonts/KohinoorBangla.ttc';
  ensureVisualFontConfig();
  const text=await sharp({text:{text:`<span foreground="${brand.colour}">${escape(brand.text)}</span>`,font:`${brand.font} ${Math.max(16,fontSize)}`,...(fontfile?{fontfile}:{}),rgba:true,align:'centre',width:Math.round(width*.65),wrap:'word-char'}}).png().toBuffer();
  const meta=await sharp(text).metadata(),labelWidth=meta.width!,labelHeight=meta.height!,padding=Math.max(8,Math.round(fontSize*.45));
  const tileWidth=labelWidth+padding*2,tileHeight=labelHeight+padding*2;
  const tile=await sharp({create:{width:tileWidth,height:tileHeight,channels:4,background:{r:0,g:0,b:0,alpha:.38}}}).composite([{input:text,left:padding,top:padding}]).png().toBuffer();
  const alpha=await sharp(tile).ensureAlpha().extractChannel(3).linear(brand.brandOpacity).raw().toBuffer();
  const faded=await sharp(tile).removeAlpha().joinChannel(alpha,{raw:{width:tileWidth,height:tileHeight,channels:1}}).png().toBuffer();
  const left=[1,7].includes(brand.brandAlignment)?margin:[3,9].includes(brand.brandAlignment)?width-tileWidth-margin:Math.round((width-tileWidth)/2);
  const top=[1,2,3].includes(brand.brandAlignment)?height-tileHeight-margin:margin;
  const overlays:OverlayOptions[]=[{input:faded,left:Math.max(0,left),top:Math.max(0,top)}];
  for(const asset of assets.filter(a=>a.role!=='font')){const logo=await sharp(asset.bytes).resize({width:Math.round(width*.1),height:Math.round(height*.12),fit:'inside'}).png().toBuffer();const m=await sharp(logo).metadata();overlays.push({input:logo,left:width-m.width!-margin,top:Math.max(margin,top-m.height!-padding)});}
  const image=await sharp(base).composite(overlays).png().toBuffer();
  return {image,branding:{channelId:c.channelId,dnaRevision:c.dnaRevision,applied:true,required:brand.required,text:brand.text,font:brand.font,alignment:brand.brandAlignment,opacity:brand.brandOpacity,ruleIds:brand.ruleIds,assetHashes:assets.map(a=>a.expectedSha256),fieldsUsed:brand.fieldsUsed}};
 }finally{if(fontDirectory)await rm(fontDirectory,{recursive:true,force:true});}
}
