'use client';
import {useEffect,useState} from 'react';
import s from './MusicNext.module.css';
type Connection={platform:string;status:string;display_name?:string};
type Destination={service:string;name?:string};
type LocalConnection={universeChannelId:string;youtubeChannelId:string;youtubeChannelTitle:string;connectedAt:string};
type Snapshot={channelId:string;connections:Connection[]|null;destinations:Destination[]|null;localConnections:LocalConnection[]|null;localRuntime:boolean;needsReauth:boolean;unverifiable:boolean};
export default function ChannelConnections({channelId,name}:{channelId:string;name:string}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 const [notice,setNotice]=useState('');
 const [bufferKey,setBufferKey]=useState('');
 const [bufferSaving,setBufferSaving]=useState(false);
 const [bufferSaved,setBufferSaved]=useState(false);
 const [bufferError,setBufferError]=useState('');
 const [bufferVerifying,setBufferVerifying]=useState(false);
 const [bufferVerified,setBufferVerified]=useState<{status:string;account?:{email:string};organizations?:{name:string}[];channels?:{id:string;name:string;displayName?:string|null;service:string}[]}|null>(null);
 useEffect(()=>{if(!channelId)return;const controller=new AbortController();
 async function read(url:string){try{const r=await fetch(url,{cache:'no-store',signal:controller.signal});if(!r.ok)return null;return await r.json();}catch{return null;}}
 const localRuntime=typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname)&&window.location.port==='3000';
 setBufferVerified(null);setBufferError('');setBufferSaved(false);setBufferKey('');
 if(localRuntime){void read(`/api/local-buffer/verify?channelId=${encodeURIComponent(channelId)}`).then(data=>{if(!controller.signal.aborted&&data?.status==='verified')setBufferVerified(data);});}
 const params=new URLSearchParams(window.location.search);
 const status=params.get('localYouTube');
 setNotice(status?status==='connected'?'YouTube connection saved locally.':`YouTube connection: ${status.replaceAll('_',' ')}`:'');
 void Promise.all([read(`/api/publishing/connections?channelId=${encodeURIComponent(channelId)}`),read(`/api/publishing/buffer/status?channelId=${encodeURIComponent(channelId)}`),localRuntime?read('/api/local-youtube/status'):Promise.resolve(null)]).then(([direct,buffer,local])=>{if(!controller.signal.aborted)setSnapshot({channelId,connections:direct?.connections||null,destinations:buffer?.error?null:buffer?.knownChannels||buffer?.channels||null,localConnections:Array.isArray(local?.connections)?local.connections:null,localRuntime,unverifiable:!buffer||Boolean(buffer.error)||Boolean(buffer.accounts?.some((a:{verification?:string})=>a.verification==='unavailable')),needsReauth:Boolean(buffer?.accounts?.some((a:{status:string})=>a.status==='needs_reauth'))});});
 return()=>controller.abort();
 },[channelId]);
 async function verifyBuffer(){
  setBufferVerifying(true);setBufferError('');setBufferVerified(null);
  try{const r=await fetch(`/api/local-buffer/verify?channelId=${encodeURIComponent(channelId)}`,{cache:'no-store'});const data=await r.json();if(!r.ok)throw new Error(data.error||'Verification failed');setBufferVerified(data);}catch(e){setBufferError(e instanceof Error?e.message:'Verification failed');}finally{setBufferVerifying(false);}
 }
 async function saveLocalBuffer(){
  setBufferSaving(true);setBufferError('');
  try{const r=await fetch('/api/local-buffer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({channelId,apiKey:bufferKey})});const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not save key');setBufferKey('');setBufferSaved(true);setBufferVerified(null);}catch(e){setBufferError(e instanceof Error?e.message:'Could not save key');}finally{setBufferSaving(false);}
 }
 const current=snapshot?.channelId===channelId?snapshot:null;
 const localYouTube=current?.localConnections?.find(x=>x.universeChannelId===channelId);
 return <section className={s.channelConnections} aria-label="Selected channel connections"><h4>{name||'Selected channel'} connections</h4><p>Connections belong to this channel, independently of your login.</p>{['youtube','instagram','facebook','tiktok'].map(platform=>{const direct=current?.connections?.find(c=>c.platform===platform&&c.status==='connected');const destination=current?.destinations?.find(c=>c.service.toLowerCase()===platform);const localDestination=current?.localRuntime&&bufferVerified?.status==='verified'?bufferVerified.channels?.find(c=>c.service.toLowerCase()===platform):undefined;const label=!current?'Checking…':platform==='youtube'&&localYouTube?'Connected locally':platform!=='youtube'&&localDestination?'Connected via local Buffer':platform==='youtube'?current.localRuntime&&current.localConnections!==null?'Not connected locally':current.connections===null?'Status unavailable':direct?'Connection saved':'Not connected':current.destinations===null?'Status unavailable':current.needsReauth?'Needs reconnection':current.unverifiable?'Status unavailable':destination?'Connection saved via Buffer':'Not connected';return <div key={platform}><b>{platform==='youtube'?'YouTube':platform==='tiktok'?'TikTok':platform[0].toUpperCase()+platform.slice(1)}</b><span>{label}</span>{platform==='youtube'&&localYouTube?<small>{localYouTube.youtubeChannelTitle} ({localYouTube.youtubeChannelId})</small> :localDestination?<small>{localDestination.displayName||localDestination.name} ({localDestination.id})</small>:(destination?.name||direct?.display_name)&&<small>{destination?.name||direct?.display_name}</small>}{platform==='youtube'&&current?.localRuntime&&<a href={`/api/local-youtube/connect?channelId=${encodeURIComponent(channelId)}`} style={{marginLeft:8}}>{localYouTube?'Reconnect local YouTube':'Connect local YouTube'}</a>}</div>})}{current?.localRuntime&&<div style={{marginTop:12}}><b>Local Buffer account</b><p>Generate a personal API key in the Buffer account for this channel, then save it here. The key is encrypted on this Mac; saving it does not yet verify Buffer access or enable publishing.</p><a href="https://publish.buffer.com/settings/api" target="_blank" rel="noopener noreferrer">Open Buffer API settings</a><div style={{display:'flex',gap:8,marginTop:8}}><input aria-label="Buffer API key" type="password" autoComplete="off" placeholder="Paste Buffer API key" value={bufferKey} onChange={e=>setBufferKey(e.target.value)} style={{minWidth:0,flex:1}}/><button type="button" disabled={!bufferKey.trim()||bufferSaving} onClick={()=>void saveLocalBuffer()}>{bufferSaving?'Saving…':'Save local Buffer key'}</button></div><div style={{marginTop:8}}><button type="button" disabled={bufferVerifying||bufferSaving} onClick={()=>void verifyBuffer()}>{bufferVerifying?'Verifying…':'Verify Buffer account & social channels'}</button></div>{bufferVerified?.status==='not_connected'&&<p role="status">No Buffer API key saved for this channel.</p>}{bufferVerified?.status==='verified'&&<div role="status"><p>Buffer verified: {bufferVerified.account?.email}</p><p>{bufferVerified.channels?.length||0} social channels found:</p><ul>{bufferVerified.channels?.map(c=><li key={c.id}>{c.service}: {c.displayName||c.name} ({c.id})</li>)}</ul><p>Publishing is not yet enabled.</p></div>}{bufferSaved&&<p role="status">Buffer key saved locally for {name}. Verify the account before publishing.</p>}{bufferError&&<p role="alert">{bufferError}</p>}</div>}{notice&&<p role="status">{notice}</p>}<p>Local YouTube credentials stay encrypted on this Mac. Hosted publishing connections remain separate.</p></section>;
}
