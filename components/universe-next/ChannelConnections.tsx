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
 useEffect(()=>{if(!channelId)return;const controller=new AbortController();
 async function read(url:string){try{const r=await fetch(url,{cache:'no-store',signal:controller.signal});if(!r.ok)return null;return await r.json();}catch{return null;}}
 const localRuntime=typeof window!=='undefined'&&['localhost','127.0.0.1'].includes(window.location.hostname)&&window.location.port==='3000';
 const params=new URLSearchParams(window.location.search);
 const status=params.get('localYouTube');
 setNotice(status?status==='connected'?'YouTube connection saved locally.':`YouTube connection: ${status.replaceAll('_',' ')}`:'');
 void Promise.all([read(`/api/publishing/connections?channelId=${encodeURIComponent(channelId)}`),read(`/api/publishing/buffer/status?channelId=${encodeURIComponent(channelId)}`),localRuntime?read('/api/local-youtube/status'):Promise.resolve(null)]).then(([direct,buffer,local])=>{if(!controller.signal.aborted)setSnapshot({channelId,connections:direct?.connections||null,destinations:buffer?.error?null:buffer?.knownChannels||buffer?.channels||null,localConnections:Array.isArray(local?.connections)?local.connections:null,localRuntime,unverifiable:!buffer||Boolean(buffer.error)||Boolean(buffer.accounts?.some((a:{verification?:string})=>a.verification==='unavailable')),needsReauth:Boolean(buffer?.accounts?.some((a:{status:string})=>a.status==='needs_reauth'))});});
 return()=>controller.abort();
 },[channelId]);
 const current=snapshot?.channelId===channelId?snapshot:null;
 const localYouTube=current?.localConnections?.find(x=>x.universeChannelId===channelId);
 return <section className={s.channelConnections} aria-label="Selected channel connections"><h4>{name||'Selected channel'} connections</h4><p>Connections belong to this channel, independently of your login.</p>{['youtube','instagram','facebook','tiktok'].map(platform=>{const direct=current?.connections?.find(c=>c.platform===platform&&c.status==='connected');const destination=current?.destinations?.find(c=>c.service.toLowerCase()===platform);const label=!current?'Checking…':platform==='youtube'&&localYouTube?'Connected locally':platform==='youtube'?current.localRuntime&&current.localConnections!==null?'Not connected locally':current.connections===null?'Status unavailable':direct?'Connection saved':'Not connected':current.destinations===null?'Status unavailable':current.needsReauth?'Needs reconnection':current.unverifiable?'Status unavailable':destination?'Connection saved via Buffer':'Not connected';return <div key={platform}><b>{platform==='youtube'?'YouTube':platform==='tiktok'?'TikTok':platform[0].toUpperCase()+platform.slice(1)}</b><span>{label}</span>{platform==='youtube'&&localYouTube?<small>{localYouTube.youtubeChannelTitle} ({localYouTube.youtubeChannelId})</small>:(destination?.name||direct?.display_name)&&<small>{destination?.name||direct?.display_name}</small>}{platform==='youtube'&&current?.localRuntime&&<a href={`/api/local-youtube/connect?channelId=${encodeURIComponent(channelId)}`} style={{marginLeft:8}}>{localYouTube?'Reconnect local YouTube':'Connect local YouTube'}</a>}</div>})}{notice&&<p role="status">{notice}</p>}<p>Local YouTube credentials stay encrypted on this Mac. Hosted publishing connections remain separate.</p></section>;
}
