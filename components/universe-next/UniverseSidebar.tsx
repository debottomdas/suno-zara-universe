'use client';

import {useEffect, useState} from 'react';
import s from './MusicNext.module.css';
import {channelHref,loadUniverseChannels} from '@/utils/universe-navigation';
export {channelHref} from '@/utils/universe-navigation';
import nav from './UniverseSidebar.module.css';
import ChannelConnections from './ChannelConnections';

type Channel = {id:string; name:string};
type Props = {
  channels?:Channel[];
  channelId?:string;
  context?:'home'|'music'|'library'|'publishing';
  stage?:string;
  libraryView?:string;
  onNewProject?:()=>void
};

const library = [
  ['all','All Content'],
  ['hooks','Hooks'],
  ['lyrics','Lyrics'],
  ['versions','Versions'],
  ['styles','Styles'],
  ['audio','Audio'],
  ['artwork','Artwork'],
  ['thumbnails','Thumbnails'],
  ['visuals','Generated Visuals'],
  ['videos','Full Videos'],
  ['shorts','Shorts'],
  ['social','Social Packs'],
];

export default function UniverseSidebar({
  channels:provided,
  channelId='',
  context='home',
  stage,
  libraryView='all',
  onNewProject
}:Props) {
  const [loaded,setLoaded]=useState<Channel[]>([]);
  const [error,setError]=useState(false);
  const [mobileOpen,setMobileOpen]=useState(false);
  const [createOpen,setCreateOpen]=useState(false);
  const [newChannelName,setNewChannelName]=useState('');
  const [newChannelLanguage,setNewChannelLanguage]=useState('');
  const [creating,setCreating]=useState(false);
  const [createError,setCreateError]=useState('');
  const [channelMenuId,setChannelMenuId]=useState<string|null>(null);
  const [renameChannel,setRenameChannel]=useState<Channel|null>(null);
  const [renameValue,setRenameValue]=useState('');
  const [renaming,setRenaming]=useState(false);
  const [renameError,setRenameError]=useState('');
  const [deleteChannel,setDeleteChannel]=useState<Channel|null>(null);
  const [deleteConfirm,setDeleteConfirm]=useState('');
  const [deleting,setDeleting]=useState(false);
  const [deleteError,setDeleteError]=useState('');
  const [connectionsChannel,setConnectionsChannel]=useState<Channel|null>(null);

  useEffect(()=>{
    if(provided)return;
    let active=true;
    loadUniverseChannels()
      .then(channels=>{if(active)setLoaded(channels)})
      .catch(()=>{if(active)setError(true)});
    return()=>{active=false};
  },[provided]);

  const channels=provided||loaded;
  const scoped=(path:string)=>
    `${path}${channelId?'?channelId='+encodeURIComponent(channelId):''}`;

  const newProjectHref =
    `${scoped('/music-next')}${channelId?'&':'?'}new=1`;

  async function createChannel() {
    const name=newChannelName.trim();
    if(!name){
      setCreateError('Channel name is required.');
      return;
    }

    setCreating(true);
    setCreateError('');

    try{
      const response=await fetch('/api/channels',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          name,
          language:newChannelLanguage.trim() || undefined
        })
      });

      const data=await response.json();

      if(!response.ok || !data?.channel?.id){
        throw new Error(data?.error || 'Could not create channel.');
      }

      const created=data.channel as Channel;

      if(!provided){
        setLoaded(current=>[...current,created]);
      }

      try{
        localStorage.setItem('szu:music:active-channel',created.id);
      }catch{}

      setCreateOpen(false);
      setNewChannelName('');
      setNewChannelLanguage('');

      window.location.href=channelHref(context,created.id,stage,libraryView);
    }catch(err){
      setCreateError(
        err instanceof Error ? err.message : 'Could not create channel.'
      );
    }finally{
      setCreating(false);
    }
  }

  async function renameSelectedChannel() {
    if(!renameChannel)return;

    const name=renameValue.trim();
    if(!name){
      setRenameError('Channel name is required.');
      return;
    }

    setRenaming(true);
    setRenameError('');

    try{
      const response=await fetch('/api/channels',{
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          channelId:renameChannel.id,
          name
        })
      });

      const data=await response.json();

      if(!response.ok || !data?.channel){
        throw new Error(data?.error || 'Could not rename channel.');
      }

      if(!provided){
        setLoaded(current=>
          current.map(channel=>
            channel.id===renameChannel.id
              ? {...channel,name:data.channel.name}
              : channel
          )
        );
      }

      setRenameChannel(null);
      setRenameValue('');
      window.location.reload();
    }catch(err){
      setRenameError(
        err instanceof Error ? err.message : 'Could not rename channel.'
      );
    }finally{
      setRenaming(false);
    }
  }

  async function archiveSelectedChannel() {
    if(!deleteChannel)return;
    if(deleteConfirm.trim()!==deleteChannel.name)return;

    setDeleting(true);
    setDeleteError('');

    try{
      const response=await fetch('/api/channels',{
        method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          channelId:deleteChannel.id,
          archive:true
        })
      });

      const data=await response.json();

      if(!response.ok || !data?.channel?.is_archived){
        throw new Error(data?.error || 'Could not delete channel.');
      }

      const remaining=channels.filter(channel=>channel.id!==deleteChannel.id);

      if(!provided){
        setLoaded(remaining);
      }

      try{
        if(localStorage.getItem('szu:music:active-channel')===deleteChannel.id){
          if(remaining[0]){
            localStorage.setItem('szu:music:active-channel',remaining[0].id);
          }else{
            localStorage.removeItem('szu:music:active-channel');
          }
        }
      }catch{}

      const wasCurrent=channelId===deleteChannel.id;

      setDeleteChannel(null);
      setDeleteConfirm('');

      if(wasCurrent){
        if(remaining[0]){
          window.location.replace(
            channelHref(context,remaining[0].id,stage,libraryView)
          );
        }else{
          window.location.replace('/');
        }
      }else{
        window.location.reload();
      }
    }catch(err){
      setDeleteError(
        err instanceof Error ? err.message : 'Could not delete channel.'
      );
    }finally{
      setDeleting(false);
    }
  }

  return (
    <aside className={`${s.side} ${nav.sidebar}`}>
      <a href="/" className={s.brand}>
        SUNO ZARA
        <span>UNIVERSE</span>
      </a>

      <button
        className={nav.mobileToggle}
        aria-expanded={mobileOpen}
        aria-controls="universe-navigation"
        onClick={()=>setMobileOpen(!mobileOpen)}
      >
        ☰ Navigation & channels
      </button>

      <div
        id="universe-navigation"
        className={nav.body}
        data-open={mobileOpen}
      >
        {/* 1 · Primary creation action */}
        <div className={nav.createSection}>
          {onNewProject ? (
            <button
              className={nav.primaryCreate}
              onClick={onNewProject}
            >
              ＋ New Music Project
            </button>
          ) : (
            <a
              className={nav.primaryCreate}
              href={newProjectHref}
            >
              ＋ New Music Project
            </a>
          )}
        </div>

        {/* 2 · Main workflow navigation */}
        <nav
          className={`${s.nav} ${nav.mainNavigation}`}
          aria-label="Universe"
        >
          <a
            className={context==='music'?s.active:undefined}
            href={scoped('/music-next')}
          >
            ♫ Music Production
          </a>

          <a
            className={context==='publishing'?s.active:undefined}
            href={scoped('/publishing')}
          >
            ⇧ Publishing
          </a>

          <button
            className={s.navFuture}
            aria-disabled="true"
            title="Cross-platform analytics is coming soon"
          >
            ▥ Analytics <i>Soon</i>
          </button>

          <button
            className={s.navFuture}
            aria-disabled="true"
            title="Release campaign workspace is coming soon"
          >
            ✦ Marketing <i>Soon</i>
          </button>

          <details className={nav.library}>
            <summary className={context==='library'?s.active:undefined}>
              ▱ Library
            </summary>
            <div className={s.subNav}>
              {library.map(([id,label])=>(
                <a
                  key={id}
                  aria-current={
                    context==='library'&&libraryView===id
                      ?'page'
                      :undefined
                  }
                  href={`${scoped('/library-next')}${channelId?'&':'?'}view=${id}`}
                >
                  {label}
                </a>
              ))}
            </div>
          </details>
        </nav>

        {/* 3 · Bottom anchored workspace */}
        <div className={nav.bottomWorkspace}>
          <nav
            className={`${s.nav} ${nav.channels}`}
            aria-label="Channels"
          >
            <div className={nav.channelHeading}>
              <h2>Channels</h2>
              <button
                type="button"
                className={nav.addChannel}
                onClick={()=>setCreateOpen(true)}
                title="Create channel"
                aria-label="Create channel"
              >
                ＋
              </button>
            </div>

            {context==='publishing'&&(
              <a
                href="/publishing"
                aria-current={!channelId?'page':undefined}
              >
                ▦ All Channels
              </a>
            )}

            {channels.map(c=>(
              <div
                key={c.id}
                className={nav.channelRow}
              >
                <a
                  className={nav.channelLink}
                  href={channelHref(context,c.id,stage,libraryView)}
                  aria-current={channelId===c.id?'page':undefined}
                >
                  {c.name}
                </a>

                <button
                  type="button"
                  className={nav.channelMenuButton}
                  aria-label={`Manage ${c.name}`}
                  aria-expanded={channelMenuId===c.id}
                  onClick={(event)=>{
                    event.preventDefault();
                    event.stopPropagation();
                    setChannelMenuId(current=>current===c.id?null:c.id);
                  }}
                >
                  ⋯
                </button>

                {channelMenuId===c.id&&(
                  <div className={nav.channelMenu}>
                    <button
                      type="button"
                      onClick={()=>{
                        setChannelMenuId(null);
                        setConnectionsChannel(c);
                      }}
                    >
                      🔗 Connections
                    </button>

                    <button
                      type="button"
                      onClick={()=>{
                        setChannelMenuId(null);
                        setRenameChannel(c);
                        setRenameValue(c.name);
                        setRenameError('');
                      }}
                    >
                      ✎ Rename
                    </button>

                    <div className={nav.channelMenuDivider}/>

                    <button
                      type="button"
                      className={nav.dangerMenuItem}
                      onClick={()=>{
                        setChannelMenuId(null);
                        setDeleteChannel(c);
                        setDeleteConfirm('');
                        setDeleteError('');
                      }}
                    >
                      🗑 Delete Channel
                    </button>
                  </div>
                )}
              </div>
            ))}

            {!channels.length&&(
              <p>
                {error
                  ?'Sign in to see your channels.'
                  :'No channels to show.'}
              </p>
            )}
          </nav>

          <nav
            className={`${s.nav} ${nav.settings}`}
            aria-label="Workspace settings"
          >
            <button
              className={s.navFuture}
              aria-disabled="true"
              title="Workspace defaults are coming soon"
            >
              ⚙ Settings <i>Soon</i>
            </button>
          </nav>
        </div>
      </div>

      {connectionsChannel&&(
        <div
          className={nav.modalBackdrop}
          role="presentation"
          onMouseDown={()=>setConnectionsChannel(null)}
        >
          <div
            className={nav.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connections-channel-title"
            onMouseDown={event=>event.stopPropagation()}
          >
            <div className={nav.modalHeader}>
              <div>
                <span className={nav.modalEyebrow}>CHANNEL SETTINGS</span>
                <h2 id="connections-channel-title">Connections</h2>
              </div>

              <button
                type="button"
                className={nav.modalClose}
                onClick={()=>setConnectionsChannel(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <ChannelConnections
              channelId={connectionsChannel.id}
              name={connectionsChannel.name}
            />

            <div className={nav.modalActions}>
              <button
                type="button"
                className={nav.secondaryButton}
                onClick={()=>{
                  const returnTo =
                    window.location.pathname +
                    window.location.search +
                    window.location.hash;

                  window.location.assign(
                    `/api/publishing/buffer/connect?channelId=${encodeURIComponent(connectionsChannel.id)}&returnTo=${encodeURIComponent(returnTo)}`
                  );
                }}
              >
                Connect / Reconnect Buffer
              </button>

              <button
                type="button"
                className={nav.createButton}
                onClick={()=>{
                  const returnTo =
                    window.location.pathname +
                    window.location.search +
                    window.location.hash;

                  const params=new URLSearchParams({
                    channelId:connectionsChannel.id,
                    returnTo
                  });

                  window.location.assign(
                    `/api/publishing/youtube/connect?${params.toString()}`
                  );
                }}
              >
                Connect / Reconnect YouTube
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteChannel&&(
        <div
          className={nav.modalBackdrop}
          role="presentation"
          onMouseDown={()=>!deleting&&setDeleteChannel(null)}
        >
          <div
            className={nav.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-channel-title"
            onMouseDown={event=>event.stopPropagation()}
          >
            <div className={nav.modalHeader}>
              <div>
                <span className={nav.modalEyebrow}>CHANNEL SETTINGS</span>
                <h2 id="delete-channel-title">Delete channel?</h2>
              </div>

              <button
                type="button"
                className={nav.modalClose}
                onClick={()=>setDeleteChannel(null)}
                disabled={deleting}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className={nav.deleteWarning}>
              <strong>{deleteChannel.name}</strong> will disappear from your
              active Universe channels.
              <br/><br/>
              Your Universe data is preserved for recovery. This does
              <strong> not </strong>
              delete your YouTube channel, Buffer account, Instagram,
              Facebook or TikTok accounts.
            </div>

            <label className={nav.field}>
              <span>
                Type <strong>{deleteChannel.name}</strong> to confirm
              </span>
              <input
                autoFocus
                value={deleteConfirm}
                onChange={event=>setDeleteConfirm(event.target.value)}
                disabled={deleting}
                placeholder={deleteChannel.name}
              />
            </label>

            {deleteError&&(
              <p className={nav.modalError}>{deleteError}</p>
            )}

            <div className={nav.modalActions}>
              <button
                type="button"
                className={nav.secondaryButton}
                onClick={()=>setDeleteChannel(null)}
                disabled={deleting}
              >
                Cancel
              </button>

              <button
                type="button"
                className={nav.deleteButton}
                onClick={()=>void archiveSelectedChannel()}
                disabled={
                  deleting ||
                  deleteConfirm.trim()!==deleteChannel.name
                }
              >
                {deleting?'Deleting…':'Delete Channel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameChannel&&(
        <div
          className={nav.modalBackdrop}
          role="presentation"
          onMouseDown={()=>!renaming&&setRenameChannel(null)}
        >
          <div
            className={nav.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-channel-title"
            onMouseDown={event=>event.stopPropagation()}
          >
            <div className={nav.modalHeader}>
              <div>
                <span className={nav.modalEyebrow}>CHANNEL SETTINGS</span>
                <h2 id="rename-channel-title">Rename channel</h2>
              </div>

              <button
                type="button"
                className={nav.modalClose}
                onClick={()=>setRenameChannel(null)}
                disabled={renaming}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <label className={nav.field}>
              <span>Channel name</span>
              <input
                autoFocus
                value={renameValue}
                onChange={event=>setRenameValue(event.target.value)}
                disabled={renaming}
                onKeyDown={event=>{
                  if(event.key==='Enter'){
                    event.preventDefault();
                    void renameSelectedChannel();
                  }
                }}
              />
            </label>

            {renameError&&(
              <p className={nav.modalError}>{renameError}</p>
            )}

            <div className={nav.modalActions}>
              <button
                type="button"
                className={nav.secondaryButton}
                onClick={()=>setRenameChannel(null)}
                disabled={renaming}
              >
                Cancel
              </button>

              <button
                type="button"
                className={nav.createButton}
                onClick={()=>void renameSelectedChannel()}
                disabled={
                  renaming ||
                  !renameValue.trim() ||
                  renameValue.trim()===renameChannel.name
                }
              >
                {renaming?'Saving…':'Save Name'}
              </button>
            </div>
          </div>
        </div>
      )}

      {createOpen&&(
        <div className={nav.modalBackdrop} role="presentation" onMouseDown={()=>!creating&&setCreateOpen(false)}>
          <div
            className={nav.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-channel-title"
            onMouseDown={event=>event.stopPropagation()}
          >
            <div className={nav.modalHeader}>
              <div>
                <span className={nav.modalEyebrow}>CHANNELS</span>
                <h2 id="create-channel-title">Create a new channel</h2>
              </div>
              <button
                type="button"
                className={nav.modalClose}
                onClick={()=>setCreateOpen(false)}
                disabled={creating}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <label className={nav.field}>
              <span>Channel name</span>
              <input
                autoFocus
                value={newChannelName}
                onChange={event=>setNewChannelName(event.target.value)}
                placeholder="e.g. Suno Zara Bhakti"
                disabled={creating}
              />
            </label>

            <label className={nav.field}>
              <span>Primary language</span>
              <select
                value={newChannelLanguage}
                onChange={event=>setNewChannelLanguage(event.target.value)}
                disabled={creating}
              >
                <option value="">Select language</option>
                <option value="Bengali">Bengali</option>
                <option value="Hindi">Hindi</option>
                <option value="English">English</option>
                <option value="Punjabi">Punjabi</option>
                <option value="Tamil">Tamil</option>
                <option value="Telugu">Telugu</option>
                <option value="Marathi">Marathi</option>
                <option value="Gujarati">Gujarati</option>
                <option value="Other">Other</option>
              </select>
            </label>

            {createError&&(
              <p className={nav.modalError}>{createError}</p>
            )}

            <div className={nav.modalActions}>
              <button
                type="button"
                className={nav.secondaryButton}
                onClick={()=>setCreateOpen(false)}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                type="button"
                className={nav.createButton}
                onClick={createChannel}
                disabled={creating || !newChannelName.trim()}
              >
                {creating?'Creating…':'Create Channel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
