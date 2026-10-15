import {channelBranding} from '../channel-dna/context';
import {approvedCandidate,outputKey,type CreativeWorkspace} from '../creative/model';
import {currentReceipt,type Destination,type Asset} from '../publishing/plan';
import {assertScope,type MusicContext,type ProductRecord} from './product';
import {canonicalSocial} from './publishing';
import {qualityGate,type Video} from './social-gate';
export function publishingHandoff(c:MusicContext,p:ProductRecord,w:CreativeWorkspace,inventory:{versions:Video[];approved:Record<string,string>},audioKey:string,destinations:Destination[],delivery:{youtube?:Record<string,unknown>[];buffer?:Record<string,unknown>[];bufferHistory?:Record<string,unknown>[]}={}) {
 assertScope(c,p);
 if(destinations.some(d=>d.channelId!==c.channelId||d.available===false))throw Error('Publishing destination is unavailable or belongs to another channel.');
 const configured=String(c.dna?.sections.publishing.fields.destinationIds||'').split(/[,\n]+/u).map(s=>s.trim()).filter(Boolean),missingDestinations=configured.filter(id=>!destinations.some(d=>d.id===id));
 if(configured.length)destinations=destinations.filter(d=>configured.includes(d.id));
 const videos={...inventory,versions:inventory.versions.map(v=>{const base=outputKey(w,v.slot,audioKey),expected=JSON.stringify({base,finishing:p.finishing?{...p.finishing,...channelBranding(c)}:null});return{...v,dependencyKey:v.dependencyKey===expected?base:v.dependencyKey};})};
 const readiness={known:true,ready:c.requireActiveDna?['youtube','instagram','facebook','tiktok'].every(platform=>destinations.some(d=>d.platform===platform)):destinations.length>0};const quality=qualityGate(c,p,w,videos,audioKey,readiness);
 const reasons=quality.rows.filter(r=>r.state!=='Ready').map(r=>r.message);
 if(missingDestinations.length)reasons.push('Configured channel destinations are unavailable: '+missingDestinations.join(', '));
 const assets:Asset[]=Array.from({length:7},(_,slot)=>{const name=slot?`short-${slot}`:'full',v=videos.versions.find(v=>v.slot===slot&&inventory.approved[name]===v.id);const ready=!!v&&!!v.fileUrl&&(v.source==='uploaded'||v.dependencyKey===outputKey(w,slot,audioKey));return{key:name,slot,label:slot?`Short ${slot}`:'Full video',version:v?.id||'',url:v?.fileUrl,ready,reason:ready?undefined:`Review ${name}.`};});
 if(assets.some(a=>!a.ready))reasons.push('Approved local media files are incomplete or outdated.');
 const thumbnailSlot=w.slots.find(s=>s.kind==='thumbnail'),thumbnail=thumbnailSlot?approvedCandidate(thumbnailSlot):undefined;const social=canonicalSocial(p.social||{});
 const canonicalReceipts=[...(delivery.youtube||[]).filter(r=>r.itemKey==='youtube-full'||/^youtube-short-0[1-6]$/.test(String(r.itemKey))).map(r=>({...r,platform:'youtube'})),...(delivery.buffer||[]).filter(r=>Number(r.slot)>=1&&Number(r.slot)<=6&&r.itemKey===`buffer-${r.channelId}-short-${String(r.slot).padStart(2,'0')}`).map(r=>({...r,platform:r.service}))];
 const receipts=canonicalReceipts.filter(r=>currentReceipt(r,assets)),history=[...(delivery.bufferHistory||[]),...canonicalReceipts.filter(r=>!currentReceipt(r,assets))];
 return{projectId:c.songId,channelId:c.channelId,userId:c.userId,title:c.title,assets,destinations,social,thumbnail:thumbnail?.url,ready:reasons.length===0,reasons,revision:JSON.stringify([p.sourceKey,p.updatedAt,assets.map(a=>[a.version,a.ready]),social,destinations,canonicalReceipts]),receipts,canonicalReceipts,history,connectionNotes:['Local reviewed campaign; no provider request or production record write.'],externalPublishing:false,localCampaign:true};
}
