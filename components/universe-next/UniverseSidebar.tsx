'use client';

import {useEffect, useState} from 'react';
import s from './MusicNext.module.css';
import {channelHref,loadUniverseChannels} from '@/utils/universe-navigation';
export {channelHref} from '@/utils/universe-navigation';
import nav from './UniverseSidebar.module.css';

type Channel = {id:string; name:string};
type Props = {channels?:Channel[]; channelId?:string; context?:'home'|'music'|'library'|'publishing'; stage?:string; libraryView?:string; onNewProject?:()=>void};
const library = [
 ['all','All Content'],['hooks','Hooks'],['lyrics','Lyrics'],['versions','Versions'],
 ['styles','Styles'],['audio','Audio'],['artwork','Artwork'],['thumbnails','Thumbnails'],
 ['visuals','Generated Visuals'],['videos','Full Videos'],['shorts','Shorts'],['social','Social Packs'],
];

export default function UniverseSidebar({channels:provided,channelId='',context='home',stage,libraryView='all',onNewProject}:Props) {
 const [loaded,setLoaded]=useState<Channel[]>([]);
 const [error,setError]=useState(false);
 const [mobileOpen,setMobileOpen]=useState(false);
 useEffect(()=>{if(provided)return;let active=true;loadUniverseChannels().then(channels=>{if(active)setLoaded(channels)}).catch(()=>{if(active)setError(true)});return()=>{active=false}},[provided]);
 const channels=provided||loaded;
 const scoped=(path:string)=>`${path}${channelId?'?channelId='+encodeURIComponent(channelId):''}`;
 return <aside className={`${s.side} ${nav.sidebar}`}>
  <a href="/" className={s.brand}>SUNO ZARA<span>UNIVERSE</span></a>
  <button className={nav.mobileToggle} aria-expanded={mobileOpen} aria-controls="universe-navigation" onClick={()=>setMobileOpen(!mobileOpen)}>☰ Navigation & channels</button>
  <div id="universe-navigation" className={nav.body} data-open={mobileOpen}>
   <nav className={s.nav} aria-label="Universe">
    <a href="/" className={context==='home'?s.active:undefined}>⌂ Universe Home</a>
    {onNewProject?<button className={s.navCreate} onClick={onNewProject}>＋ New Music Project</button>:<a className={s.navCreate} href={`${scoped('/music-next')}${channelId?'&':'?'}new=1`}>＋ New Music Project</a>}
    <a className={context==='music'?s.active:undefined} href={scoped('/music-next')}>♫ Music Production</a>
    <details className={nav.library}>
     <summary className={context==='library'?s.active:undefined}>▱ Library</summary>
     <div className={s.subNav}>{library.map(([id,label])=><a key={id} aria-current={context==='library'&&libraryView===id?'page':undefined} href={`${scoped('/library-next')}${channelId?'&':'?'}view=${id}`}>{label}</a>)}</div>
    </details>
    <a className={context==='publishing'?s.active:undefined} href={scoped('/publishing')}>⇧ Publishing</a>
    <button className={s.navFuture} aria-disabled="true" title="Release campaign workspace is coming soon">✦ Marketing <i>Soon</i></button>
    <button className={s.navFuture} aria-disabled="true" title="Cross-platform analytics is coming soon">▥ Analytics <i>Soon</i></button>
   </nav>
   <nav className={`${s.nav} ${nav.channels}`} aria-label="Channels">
    <h2>Channels</h2>
    {context==='publishing'&&<a href="/publishing" aria-current={!channelId?'page':undefined}>▦ All Channels</a>}
    {channels.map(c=><a key={c.id} href={channelHref(context,c.id,stage,libraryView)} aria-current={channelId===c.id?'page':undefined}>{c.name}</a>)}
    {!channels.length&&<p>{error?'Sign in to see your channels.':'No channels to show.'}</p>}
   </nav>
   <nav className={s.nav} aria-label="Workspace settings"><button className={s.navFuture} aria-disabled="true" title="Workspace defaults are coming soon">⚙ Settings <i>Soon</i></button></nav>
  </div>
 </aside>;
}
