"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Channel = { id: string; name: string; language?: string | null };
type Song = { id: string; projectId?: string; title?: string | null };
type Connection = { id: string; platform: string; display_name?: string | null; handle?: string | null; status?: string; is_primary?: boolean };
type Job = { id: string; platform: string; content_type?: string; title?: string | null; caption?: string | null; status?: string; ready_to_publish?: boolean; scheduled_for?: string | null; validation_errors?: unknown[] };
type CampaignData = { campaign?: { id?: string; status?: string } | null; jobs?: Job[]; summary?: { total?: number; errorCount?: number; byPlatform?: Record<string, number> } };

const platforms = [
  { key: "youtube", name: "YouTube", mark: "▶", purpose: "Full video + Shorts", detail: "Titles, descriptions, thumbnails and video metadata" },
  { key: "instagram", name: "Instagram", mark: "◎", purpose: "Reels", detail: "Vertical clips, captions and hashtags" },
  { key: "tiktok", name: "TikTok", mark: "♪", purpose: "Vertical posts", detail: "Clips, native copy and posting settings" },
  { key: "facebook", name: "Facebook", mark: "f", purpose: "Video + Reels", detail: "Release copy, reels and Page publishing" },
] as const;

const shell: React.CSSProperties = { minHeight: "100vh", background: "radial-gradient(circle at 78% 0%,rgba(90,51,88,.16),transparent 28%),radial-gradient(circle at 20% 68%,rgba(0,198,224,.07),transparent 28%),#06111d", color: "#f5f7fb", fontFamily: "Arial, Helvetica, sans-serif" };
const wrap: React.CSSProperties = { width: "min(1080px,calc(100% - 48px))", margin: "0 auto" };
const card: React.CSSProperties = { border: "1px solid rgba(151,170,194,.14)", borderRadius: 18, background: "rgba(7,20,34,.72)" };
const tiny: React.CSSProperties = { fontSize: 10, letterSpacing: "1.8px", textTransform: "uppercase", color: "#657389", fontWeight: 800 };
const button: React.CSSProperties = { border: "1px solid rgba(151,170,194,.18)", borderRadius: 10, padding: "10px 14px", background: "rgba(255,255,255,.035)", color: "#e9eef6", fontWeight: 750, fontSize: 12, cursor: "pointer" };

function labelFor(connection?: Connection) {
  if (!connection) return "Not connected";
  if (connection.status === "connected") return "Connected";
  if (connection.status === "needs_reauth") return "Reconnect";
  return "Connection issue";
}

export default function PublishV3() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [songs, setSongs] = useState<Song[]>([]);
  const [projectId, setProjectId] = useState("");
  const [connections, setConnections] = useState<Connection[]>([]);
  const [campaign, setCampaign] = useState<CampaignData>({});
  const [loading, setLoading] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/channels", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load channels.");
        const next = Array.isArray(data.channels) ? data.channels : [];
        setChannels(next);
        let preferred = "";
        try { preferred = window.localStorage.getItem("szu:music:active-channel") || ""; } catch {}
        setChannelId(next.some((item: Channel) => item.id === preferred) ? preferred : (next[0]?.id || ""));
      } catch (e) { setError(e instanceof Error ? e.message : "Could not load channels."); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    if (!channelId) return;
    setProjectId("");
    setSongs([]);
    Promise.all([
      fetch(`/api/songs?channelId=${encodeURIComponent(channelId)}`, { cache: "no-store" }).then(async r => ({ ok:r.ok, data:await r.json() })),
      fetch(`/api/publishing/connections?channelId=${encodeURIComponent(channelId)}`, { cache: "no-store" }).then(async r => ({ ok:r.ok, data:await r.json() })),
    ]).then(([songResult, connectionResult]) => {
      if (songResult.ok) {
        const nextSongs = Array.isArray(songResult.data.projects) ? songResult.data.projects : [];
        setSongs(nextSongs);
        setProjectId(nextSongs[0]?.id || "");
      }
      if (connectionResult.ok) setConnections(Array.isArray(connectionResult.data.connections) ? connectionResult.data.connections : []);
    }).catch(() => setError("Could not load this channel's publishing state."));
    try { window.localStorage.setItem("szu:music:active-channel", channelId); } catch {}
  }, [channelId]);

  const loadCampaign = useCallback(async () => {
    if (!projectId) { setCampaign({}); return; }
    try {
      const response = await fetch(`/api/publishing/campaigns?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load publishing plan.");
      setCampaign(data);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load publishing plan."); }
  }, [projectId]);

  useEffect(() => { void loadCampaign(); }, [loadCampaign]);

  const currentSong = songs.find(s => s.id === projectId);
  const primaryConnections = useMemo(() => {
    const map = new Map<string, Connection>();
    for (const connection of connections) {
      const current = map.get(connection.platform);
      if (!current || connection.is_primary) map.set(connection.platform, connection);
    }
    return map;
  }, [connections]);
  const jobs = Array.isArray(campaign.jobs) ? campaign.jobs : [];
  const readyJobs = jobs.filter(j => j.ready_to_publish && !(j.validation_errors?.length)).length;
  const connectedCount = platforms.filter(p => primaryConnections.get(p.key)?.status === "connected").length;

  async function preparePublishing() {
    if (!projectId) return;
    setPreparing(true); setMessage(""); setError("");
    try {
      const planResponse = await fetch("/api/campaign-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
      const plan = await planResponse.json();
      if (!planResponse.ok) throw new Error(plan.error || "Could not prepare campaign content.");
      const campaignResponse = await fetch("/api/publishing/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) });
      const campaignData = await campaignResponse.json();
      if (!campaignResponse.ok) throw new Error(campaignData.error || "Could not prepare publishing jobs.");
      setCampaign(campaignData);
      setMessage(plan.cached ? "Publishing plan refreshed from saved campaign intelligence." : "Publishing plan prepared. Review everything before publishing.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare publishing."); }
    finally { setPreparing(false); }
  }

  return <main style={shell}>
    <header style={{borderBottom:"1px solid rgba(151,170,194,.12)",background:"rgba(4,13,23,.86)",position:"sticky",top:0,zIndex:10}}>
      <div style={{...wrap,height:72,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:11}}><div style={{width:32,height:32,borderRadius:11,border:"2px solid #8edcf0",display:"grid",placeItems:"center",fontSize:12}}>~</div><div><div style={{fontSize:12,fontWeight:900,letterSpacing:"2px"}}>SUNO ZARA</div><div style={{fontSize:8,letterSpacing:"3px",color:"#8d6b58"}}>UNIVERSE</div></div></div>
        <nav style={{display:"flex",padding:4,border:"1px solid rgba(151,170,194,.12)",borderRadius:14,background:"rgba(3,12,21,.6)",fontSize:11}}>
          <a href="/music-new/create" style={{padding:"8px 18px",color:"#687589",textDecoration:"none"}}>01&nbsp; Create</a>
          <a href="/music-new/release" style={{padding:"8px 18px",color:"#687589",textDecoration:"none"}}>02&nbsp; Release</a>
          <span style={{padding:"8px 18px",borderRadius:10,background:"rgba(45,202,222,.13)",color:"#c6f8ff",fontWeight:800}}>03&nbsp; Publish</span>
        </nav>
        <div style={{width:34,height:34,borderRadius:"50%",border:"1px solid rgba(151,170,194,.2)",display:"grid",placeItems:"center",fontSize:12}}>S</div>
      </div>
    </header>

    <div style={{...wrap,padding:"28px 0 70px"}}>
      <section style={{display:"flex",justifyContent:"space-between",alignItems:"end",gap:24,paddingBottom:22,borderBottom:"1px solid rgba(151,170,194,.12)"}}>
        <div><div style={{...tiny,color:"#b8957d"}}>PUBLISH · STAGE 3</div><h1 style={{fontSize:36,lineHeight:1,margin:"13px 0 10px",letterSpacing:"-1.5px"}}>Send it to the world.</h1><p style={{maxWidth:620,color:"#8995a8",fontSize:13,lineHeight:1.6,margin:0}}>Choose where the release goes, review the prepared content and decide when it should publish. Nothing goes live without your approval.</p></div>
        <div style={{display:"flex",gap:8}}>
          <label style={{...card,padding:"9px 12px",display:"block"}}><div style={tiny}>Channel</div><select value={channelId} onChange={e=>setChannelId(e.target.value)} style={{background:"transparent",border:0,color:"#eef4fa",fontWeight:700,maxWidth:150}}>{channels.map(c=><option key={c.id} value={c.id} style={{color:"#111"}}>{c.name}</option>)}</select></label>
          <label style={{...card,padding:"9px 12px",display:"block"}}><div style={tiny}>Song</div><select value={projectId} onChange={e=>setProjectId(e.target.value)} style={{background:"transparent",border:0,color:"#eef4fa",fontWeight:700,maxWidth:160}}>{songs.map(s=><option key={s.id} value={s.id} style={{color:"#111"}}>{s.title || "Untitled"}</option>)}</select></label>
        </div>
      </section>

      <section style={{...card,marginTop:18,padding:"22px 24px",background:"linear-gradient(110deg,rgba(0,189,215,.10),rgba(30,39,61,.72) 58%,rgba(111,67,76,.18))",display:"flex",justifyContent:"space-between",alignItems:"center",gap:30}}>
        <div><div style={{display:"flex",gap:8,alignItems:"center"}}><span style={{...tiny,color:"#65d8c0",border:"1px solid rgba(72,211,183,.18)",padding:"5px 9px",borderRadius:10}}>FAST LANE</span><span style={tiny}>{channels.find(c=>c.id===channelId)?.name || "CHANNEL"} · {currentSong?.title || "SONG"}</span></div><h2 style={{fontSize:20,margin:"14px 0 8px"}}>Prepare Publishing</h2><p style={{fontSize:12,color:"#9aa6b7",lineHeight:1.55,maxWidth:680,margin:0}}>Reuse the saved campaign content, match it to the release assets and prepare platform jobs. This step prepares only — it does not publish.</p><div style={{fontSize:10,color:"#63d7c1",marginTop:15,fontWeight:800}}>YouTube &nbsp;→&nbsp; Instagram &nbsp;→&nbsp; TikTok &nbsp;→&nbsp; Facebook &nbsp;→&nbsp; Review</div></div>
        <button onClick={preparePublishing} disabled={preparing || !projectId} style={{...button,background:"#f6f7f8",color:"#07111b",padding:"13px 20px",minWidth:175}}>{preparing ? "Preparing…" : jobs.length ? "Refresh Plan →" : "Prepare Publishing →"}</button>
      </section>

      {(message || error) && <div style={{marginTop:12,fontSize:12,color:error?"#ff9c9c":"#77dfc8"}}>{error || message}</div>}

      <section style={{marginTop:24}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"end",marginBottom:12}}><div><div style={tiny}>DESTINATIONS</div><h2 style={{fontSize:19,margin:"9px 0 0"}}>Where should this release go?</h2></div><div style={{fontSize:11,color:"#657389"}}>{connectedCount}/4 platforms connected</div></div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:12}}>
          {platforms.map(p=>{ const connection=primaryConnections.get(p.key); const count=jobs.filter(j=>j.platform===p.key).length; const connected=connection?.status==="connected"; return <article key={p.key} style={{...card,padding:18,minHeight:145}}><div style={{display:"flex",justifyContent:"space-between",gap:15}}><div style={{display:"flex",gap:12}}><div style={{width:34,height:34,borderRadius:11,border:"1px solid rgba(151,170,194,.16)",display:"grid",placeItems:"center",fontWeight:900}}>{p.mark}</div><div><h3 style={{margin:"1px 0 5px",fontSize:16}}>{p.name}</h3><div style={{fontSize:11,color:connected?"#65d8c0":"#8c97a8",fontWeight:750}}>{labelFor(connection)}{connection?.display_name ? ` · ${connection.display_name}` : connection?.handle ? ` · ${connection.handle}` : ""}</div></div></div><span style={{...tiny,color:count?"#65d8c0":"#667488"}}>{count ? `${count} ITEMS` : "NO ITEMS"}</span></div><div style={{marginTop:17,fontSize:12,fontWeight:800}}>{p.purpose}</div><p style={{margin:"5px 0 0",fontSize:11,color:"#7e8a9c",lineHeight:1.5}}>{p.detail}</p></article>;})}
        </div>
      </section>

      <section style={{marginTop:24}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"end",marginBottom:12}}><div><div style={tiny}>REVIEW</div><h2 style={{fontSize:19,margin:"9px 0 0"}}>What will be published?</h2></div><div style={{fontSize:11,color:"#657389"}}>{readyJobs}/{jobs.length || 0} items ready</div></div>
        <div style={{...card,overflow:"hidden"}}>
          {jobs.length === 0 ? <div style={{padding:28,textAlign:"center",color:"#728095",fontSize:12}}>No publishing jobs prepared yet. Use <b style={{color:"#b8c5d5"}}>Prepare Publishing</b> above after the release assets are ready.</div> : jobs.slice(0,12).map((job,index)=><div key={job.id || index} style={{padding:"14px 18px",display:"grid",gridTemplateColumns:"110px 1fr 120px",gap:16,alignItems:"center",borderTop:index?"1px solid rgba(151,170,194,.10)":"none"}}><div style={{fontSize:11,fontWeight:850,textTransform:"capitalize"}}>{job.platform}</div><div><div style={{fontSize:12,fontWeight:750}}>{job.title || job.caption?.slice(0,70) || job.content_type || "Prepared post"}</div><div style={{fontSize:10,color:"#657389",marginTop:4}}>{job.content_type || "content"}{job.scheduled_for ? ` · ${new Date(job.scheduled_for).toLocaleString()}` : " · Not scheduled"}</div></div><div style={{textAlign:"right",fontSize:10,fontWeight:800,color:job.ready_to_publish?"#65d8c0":"#b49a72"}}>{job.ready_to_publish ? "READY" : "NEEDS REVIEW"}</div></div>)}
          {jobs.length > 12 && <div style={{padding:"12px 18px",borderTop:"1px solid rgba(151,170,194,.10)",fontSize:10,color:"#657389"}}>+ {jobs.length-12} more prepared items</div>}
        </div>
      </section>

      <section style={{...card,marginTop:20,padding:"16px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:20}}><div><div style={{fontSize:12,fontWeight:850}}>Ready to schedule or publish?</div><div style={{fontSize:10,color:"#657389",marginTop:5}}>Final publishing actions stay behind an explicit review step. No automatic posting from this page.</div></div><div style={{display:"flex",gap:8}}><button style={button} onClick={()=>window.location.href="/music"}>Open detailed publishing controls</button><button disabled style={{...button,background:"#42d8ef",color:"#06111d",opacity:.48,cursor:"not-allowed"}}>Review & Publish →</button></div></section>
      {loading && <div style={{position:"fixed",bottom:18,right:18,fontSize:10,color:"#6c7889"}}>Loading Universe…</div>}
    </div>
  </main>;
}
