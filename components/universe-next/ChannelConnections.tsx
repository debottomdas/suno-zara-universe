'use client';
import {useEffect,useState} from 'react';
import s from './MusicNext.module.css';
type Connection={platform:string;status:string;display_name?:string};
type Destination={service:string;name?:string};
type Snapshot={channelId:string;connections:Connection[]|null;destinations:Destination[]|null;needsReauth:boolean;unverifiable:boolean};
export default function ChannelConnections({channelId,name}:{channelId:string;name:string}){
 const [snapshot,setSnapshot]=useState<Snapshot|null>(null);
 useEffect(()=>{if(!channelId)return;const controller=new AbortController();
 async function read(url:string){try{const r=await fetch(url,{cache:'no-store',signal:controller.signal});if(!r.ok)return null;return await r.json();}catch{return null;}}
 void Promise.all([read(`/api/publishing/connections?channelId=${encodeURIComponent(channelId)}`),read(`/api/publishing/buffer/status?channelId=${encodeURIComponent(channelId)}`)]).then(([direct,buffer])=>{if(!controller.signal.aborted)setSnapshot({channelId,connections:direct?.connections||null,destinations:buffer?.error?null:buffer?.knownChannels||buffer?.channels||null,unverifiable:!buffer||Boolean(buffer.error)||Boolean(buffer.accounts?.some((a:{verification?:string})=>a.verification==='unavailable')),needsReauth:Boolean(buffer?.accounts?.some((a:{status:string})=>a.status==='needs_reauth'))});});
 return()=>controller.abort();
 },[channelId]);
 const current=snapshot?.channelId===channelId?snapshot:null;
 return <section className={s.channelConnections} aria-label="Selected channel connections"><h4>{name||'Selected channel'} connections</h4><p>Connections belong to this channel, independently of your login.</p>{['youtube','instagram','facebook','tiktok'].map(platform=>{const direct=current?.connections?.find(c=>c.platform===platform&&c.status==='connected');const destination=current?.destinations?.find(c=>c.service.toLowerCase()===platform);const label=!current?'Checking…':platform==='youtube'?current.connections===null?'Status unavailable':direct?'Connection saved':'Not connected':current.destinations===null?'Status unavailable':current.needsReauth?'Needs reconnection':current.unverifiable?'Status unavailable':destination?'Connection saved via Buffer':'Not connected';return <div key={platform}><b>{platform==='youtube'?'YouTube':platform==='tiktok'?'TikTok':platform[0].toUpperCase()+platform.slice(1)}</b><span>{label}</span>{(destination?.name||direct?.display_name)&&<small>{destination?.name||direct?.display_name}</small>}</div>})}<p>Connections use saved Universe records. Refresh Buffer connections in Publishing to check destinations; access is checked before publishing.</p></section>;
}
