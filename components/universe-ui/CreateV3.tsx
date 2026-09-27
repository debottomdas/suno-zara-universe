"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import AccountMenu from "@/components/AccountMenu";
import { createClient } from "@/utils/supabase/client";

type Channel = { id:string; name:string; language?:string|null };
type Song = { id:string; title?:string|null; lyrics?:string|null; idea?:string; language?:string; mood?:string; genre?:string; status?:string };
type Style = { name:string; category:string; recommended:boolean; whyItFits:string; prompt:string };
type AudioAsset = { originalFilename?:string; sizeBytes?:number|null };

const steps = [
  ["01","Create","/music-new/create"],
  ["02","Release","/music-new/release"],
  ["03","Publish","/music-new/publish"],
] as const;

function Pill({children, tone="neutral"}:{children:ReactNode;tone?:"neutral"|"good"|"warm"}) {
  const cls = tone === "good" ? "border-emerald-300/15 bg-emerald-300/[0.06] text-emerald-200" : tone === "warm" ? "border-orange-200/15 bg-orange-200/[0.06] text-orange-100" : "border-white/10 bg-white/[0.035] text-zinc-400";
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[.13em] ${cls}`}>{children}</span>;
}

export default function CreateV3(){
  const [email,setEmail]=useState("");
  const [channels,setChannels]=useState<Channel[]>([]);
  const [channelId,setChannelId]=useState("");
  const [songs,setSongs]=useState<Song[]>([]);
  const [songId,setSongId]=useState("");
  const [styles,setStyles]=useState<Style[]>([]);
  const [audio,setAudio]=useState<AudioAsset|null>(null);
  const [loading,setLoading]=useState(true);
  const [detailLoading,setDetailLoading]=useState(false);
  const [prepareBusy,setPrepareBusy]=useState(false);
  const [notice,setNotice]=useState("");

  const song=useMemo(()=>songs.find(x=>x.id===songId)||null,[songs,songId]);
  const channel=useMemo(()=>channels.find(x=>x.id===channelId)||null,[channels,channelId]);

  useEffect(()=>{
    const supabase=createClient();
    supabase.auth.getUser().then(({data})=>setEmail(data.user?.email||""));
    (async()=>{
      try{
        const r=await fetch("/api/channels",{cache:"no-store"});
        const d=await r.json();
        const list:Array<Channel>=Array.isArray(d.channels)?d.channels:[];
        setChannels(list);
        let saved=""; try{saved=localStorage.getItem("szu:music:active-channel")||"";}catch{}
        setChannelId(list.some(x=>x.id===saved)?saved:(list[0]?.id||""));
      } finally { setLoading(false); }
    })();
  },[]);

  useEffect(()=>{
    if(!channelId){setSongs([]);setSongId("");return;}
    (async()=>{
      setLoading(true);
      try{
        const r=await fetch(`/api/songs?channelId=${encodeURIComponent(channelId)}`,{cache:"no-store"});
        const d=await r.json();
        const list:Array<Song>=Array.isArray(d.projects)?d.projects:[];
        setSongs(list);
        setSongId(current=>list.some(x=>x.id===current)?current:(list.find(x=>x.status!=="archived")?.id||list[0]?.id||""));
        try{localStorage.setItem("szu:music:active-channel",channelId);}catch{}
      } finally {setLoading(false);}
    })();
  },[channelId]);

  useEffect(()=>{
    if(!songId){setStyles([]);setAudio(null);return;}
    (async()=>{
      setDetailLoading(true);
      try{
        const [sr,ar]=await Promise.all([
          fetch(`/api/suno-styles?projectId=${encodeURIComponent(songId)}`,{cache:"no-store"}),
          fetch(`/api/media/final-audio?projectId=${encodeURIComponent(songId)}`,{cache:"no-store"}),
        ]);
        const [sd,ad]=await Promise.all([sr.json(),ar.json()]);
        setStyles(Array.isArray(sd.styles)?sd.styles:[]);
        setAudio(ad.asset||null);
      } finally {setDetailLoading(false);}
    })();
  },[songId]);

  async function prepare(){
    if(!songId||!song?.lyrics){setNotice("This song needs lyrics before Universe can prepare it.");return;}
    setPrepareBusy(true); setNotice("Understanding the song and preparing its creative direction…");
    try{
      const r=await fetch("/api/production-plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({projectId:songId})});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||"Could not prepare this song.");
      setStyles(Array.isArray(d.styles)?d.styles:[]);
      setNotice(d.cached?"Everything already prepared — reused the saved Production Plan.":"Production Plan prepared. Nothing has been published.");
    }catch(e){setNotice(e instanceof Error?e.message:"Could not prepare this song.");}
    finally{setPrepareBusy(false);}
  }

  const lyricReady=Boolean(song?.lyrics?.trim());
  const styleReady=styles.length>0;
  const dnaReady=styleReady;
  const audioReady=Boolean(audio);
  const readyCount=[lyricReady,styleReady,dnaReady,audioReady].filter(Boolean).length;

  return <div className="min-h-screen bg-[#06101a] text-white">
    <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_78%_4%,rgba(255,133,132,.10),transparent_30rem),radial-gradient(circle_at_12%_72%,rgba(19,180,184,.10),transparent_34rem),linear-gradient(180deg,#06101a_0%,#07131f_52%,#08121b_100%)]"/>
    <div className="relative mx-auto min-h-screen max-w-[1920px]">
      <header className="sticky top-0 z-20 border-b border-white/[.07] bg-[#07111c]/90 px-5 py-3 backdrop-blur-2xl sm:px-8 xl:px-10">
        <div className="flex items-center justify-between gap-5">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-300 via-violet-300 to-orange-300"><div className="absolute inset-[3px] rounded-[13px] bg-[#08131f]"/><span className="relative">〜</span></div>
            <div><p className="text-[13px] font-black tracking-[.15em]">SUNO ZARA</p><p className="text-[9px] font-semibold tracking-[.3em] text-orange-200">UNIVERSE</p></div>
          </Link>
          <nav className="hidden items-center rounded-2xl border border-white/[.08] bg-black/20 p-1 md:flex">
            {steps.map(([n,label,href],i)=><Link key={label} href={href} className={`rounded-xl px-5 py-2 text-xs font-bold transition ${i===0?"bg-cyan-300/[.11] text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,.12)]":"text-zinc-500 hover:text-zinc-200"}`}><span className="mr-2 text-[9px] opacity-60">{n}</span>{label}</Link>)}
          </nav>
          <div className="flex items-center gap-3">{email&&<AccountMenu email={email}/>}</div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-7 xl:px-9">
        <section className="flex flex-col gap-5 border-b border-white/[.07] pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div><Pill tone="warm">Create • Stage 1</Pill><h1 className="mt-4 text-4xl font-black tracking-[-.05em] sm:text-5xl">Make the song.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">Start with an idea or your own lyrics, shape the music direction, then bring back the final song. Universe keeps every decision visible and editable.</p></div>
          <div className="grid min-w-[300px] grid-cols-2 gap-2 sm:flex">
            <label className="rounded-2xl border border-white/[.08] bg-[#091522]/90 px-3 py-2"><span className="block text-[9px] font-bold uppercase tracking-[.14em] text-zinc-600">Channel</span><select value={channelId} onChange={e=>setChannelId(e.target.value)} className="mt-1 w-full bg-transparent text-xs font-bold outline-none"><option value="">No channel</option>{channels.map(c=><option className="bg-[#091522]" key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className="rounded-2xl border border-white/[.08] bg-[#091522]/90 px-3 py-2"><span className="block text-[9px] font-bold uppercase tracking-[.14em] text-zinc-600">Song</span><select value={songId} onChange={e=>setSongId(e.target.value)} className="mt-1 w-full max-w-[220px] bg-transparent text-xs font-bold outline-none"><option value="">No song</option>{songs.map(s=><option className="bg-[#091522]" key={s.id} value={s.id}>{s.title||"Untitled"}</option>)}</select></label>
          </div>
        </section>

        <section className="mt-6 overflow-hidden rounded-[28px] border border-cyan-300/15 bg-[linear-gradient(120deg,rgba(34,211,238,.10),rgba(139,92,246,.055)_52%,rgba(251,146,60,.07))] p-5 shadow-[0_30px_90px_-55px_rgba(34,211,238,.45)] sm:p-7">
          <div className="grid gap-6 xl:grid-cols-[1fr_auto] xl:items-center">
            <div><div className="flex flex-wrap items-center gap-2"><Pill tone="good">Fast lane</Pill>{song&&<Pill>{channel?.name||"Music"} • {song.title||"Untitled"}</Pill>}</div><h2 className="mt-4 text-2xl font-black tracking-[-.035em]">Prepare Everything</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">Understand the lyrics once and reuse that intelligence for styles, Song DNA and visual direction. Existing work is reused instead of regenerated.</p>
              <div className="mt-5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-zinc-400"><span className={lyricReady?"text-emerald-300":""}>Lyrics</span><span>→</span><span className={styleReady?"text-emerald-300":""}>Styles</span><span>→</span><span className={dnaReady?"text-emerald-300":""}>Song DNA</span><span>→</span><span className={dnaReady?"text-emerald-300":""}>Visual Direction</span></div>
            </div>
            <button onClick={prepare} disabled={!songId||prepareBusy||loading} className="rounded-2xl bg-white px-6 py-3.5 text-sm font-black text-[#06101a] transition hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-40">{prepareBusy?"Preparing…":styleReady?"Continue Preparation →":"Prepare Everything →"}</button>
          </div>
          {notice&&<div className="mt-5 rounded-2xl border border-white/[.08] bg-black/20 px-4 py-3 text-xs text-zinc-300">{notice}</div>}
        </section>

        <div className="mt-7 flex items-end justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-zinc-600">Manual workspace</p><h2 className="mt-2 text-2xl font-black tracking-[-.035em]">Work on any part yourself.</h2></div><p className="hidden text-xs text-zinc-500 sm:block">{detailLoading?"Checking saved work…":`${readyCount}/4 essentials ready`}</p></div>

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="rounded-[26px] border border-white/[.08] bg-[#091522]/85 p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><span className="text-xl">✎</span><h3 className="mt-4 text-xl font-black">Idea & Lyrics</h3></div><Pill tone={lyricReady?"good":"neutral"}>{lyricReady?"Lyrics ready":"Needs lyrics"}</Pill></div><p className="mt-3 line-clamp-3 min-h-[60px] text-sm leading-6 text-zinc-400">{song?.lyrics?.trim()?song.lyrics.trim().slice(0,240):song?.idea||"Start from an idea, generate a song, or bring your own finished lyrics."}</p><div className="mt-6 flex flex-wrap gap-2"><Link href="/music" className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-2 text-xs font-bold hover:bg-white/[.08]">Edit lyrics</Link><Link href="/music" className="rounded-xl px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white">Start a new song</Link></div></article>

          <article className="rounded-[26px] border border-white/[.08] bg-[#091522]/85 p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><span className="text-xl">♫</span><h3 className="mt-4 text-xl font-black">Style</h3></div><Pill tone={styleReady?"good":"neutral"}>{styleReady?`${styles.length} styles prepared`:"Not prepared"}</Pill></div><p className="mt-3 min-h-[60px] text-sm leading-6 text-zinc-400">{styles.find(s=>s.recommended)?.name?<>Recommended: <span className="font-bold text-zinc-200">{styles.find(s=>s.recommended)?.name}</span><br/>{styles.find(s=>s.recommended)?.whyItFits?.slice(0,150)}</>:"Generate several genuinely different music directions, with one clear recommendation."}</p><div className="mt-6 flex flex-wrap gap-2"><Link href="/music" className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-2 text-xs font-bold hover:bg-white/[.08]">Review styles</Link><button onClick={prepare} disabled={!songId||prepareBusy} className="rounded-xl px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white disabled:opacity-40">{styleReady?"Regenerate manually":"Generate styles"}</button></div></article>

          <article className="rounded-[26px] border border-white/[.08] bg-[#091522]/85 p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><span className="text-xl">◉</span><h3 className="mt-4 text-xl font-black">Final Audio</h3></div><Pill tone={audioReady?"good":"warm"}>{audioReady?"Audio ready":"Waiting for audio"}</Pill></div><p className="mt-3 min-h-[60px] text-sm leading-6 text-zinc-400">{audioReady?<>Final song: <span className="font-bold text-zinc-200">{audio?.originalFilename||"Uploaded audio"}</span><br/>Universe can use this for the release package.</>:"Create the final song in Suno, then upload the MP3/WAV here. This remains a deliberate human checkpoint."}</p><div className="mt-6"><Link href="/music" className="inline-flex rounded-xl border border-orange-200/15 bg-orange-200/[.06] px-4 py-2 text-xs font-bold text-orange-100 hover:bg-orange-200/[.10]">{audioReady?"Replace / review audio":"Upload song"}</Link></div></article>

          <article className="rounded-[26px] border border-white/[.08] bg-[#091522]/85 p-5 sm:p-6"><div className="flex items-start justify-between gap-4"><div><span className="text-xl">✦</span><h3 className="mt-4 text-xl font-black">Song DNA & Direction</h3></div><Pill tone={dnaReady?"good":"neutral"}>{dnaReady?"Draft ready":"Not prepared"}</Pill></div><p className="mt-3 min-h-[60px] text-sm leading-6 text-zinc-400">{dnaReady?"Emotional core, hook strategy, audience promise and visual motifs are saved in the reusable Production Plan.":"Universe reads the song once, then carries the same creative understanding into artwork, video and social content."}</p><div className="mt-6 flex gap-2"><Link href="/music" className="rounded-xl border border-white/10 bg-white/[.04] px-4 py-2 text-xs font-bold hover:bg-white/[.08]">Review direction</Link></div></article>
        </section>

        <section className="mt-7 flex flex-col gap-4 rounded-[24px] border border-white/[.08] bg-black/15 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-black">Ready for the next stage?</p><p className="mt-1 text-xs text-zinc-500">Release will build artwork, thumbnails, full video, six Shorts and social content.</p></div><Link href="/music-new/release" aria-disabled={!lyricReady} className={`rounded-2xl px-5 py-3 text-xs font-black ${lyricReady?"bg-cyan-300 text-[#06101a]":"pointer-events-none border border-white/10 text-zinc-600"}`}>Continue to Release →</Link></section>
      </main>
    </div>
  </div>;
}
