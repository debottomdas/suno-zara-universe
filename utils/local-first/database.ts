import 'server-only';
import {localStorage} from './storage';
import { mutateLocalWorkspace, readLocalWorkspace, type LocalWorkspaceState } from './store';

// A deliberately bounded local repository, sharing the existing route contracts.
// Unknown tables/operators fail locally; they never trigger a cloud request.
const TABLES = new Set(['workspaces','workspace_members','channels','songs','channel_dna_versions',
  'song_versions','suno_styles','song_creative_workspaces','song_media_assets','ai_usage_events',
  'song_visual_concepts','song_image_sets','song_images']);
export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';
const aliases: Record<string,string> = {selected_hook:'selectedHook',english_title:'englishTitle',
  created_at:'createdAt',updated_at:'updatedAt',project_state:'projectState'};
export function localOwner(state: LocalWorkspaceState) { return state.workspace?.owner_user_id || LOCAL_USER_ID; }
function rows(state: LocalWorkspaceState, table: string): any[] {
  if (!TABLES.has(table)) throw Error(`Local repository does not support table ${table}.`);
  const owner = localOwner(state);
  if (table === 'workspaces') return state.workspace ? [{...state.workspace,owner_user_id:owner}] : [];
  if (table === 'channels') return state.channels.map(c=>({...c,is_archived:c.is_archived??false,active_dna_revision:c.active_dna_revision??null,workspaces:{owner_user_id:owner}}));
  if (table === 'songs') return Object.entries(state.songsByChannel).flatMap(([channelId,songs])=>songs.map(s=>{
    const row = {...s,id:s.id||s.projectId,user_id:owner,channel_id:channelId};
    for (const [key,alias] of Object.entries(aliases)) row[key] = s[alias] !== undefined ? s[alias] : s[key];
    return row;
  }));
  if (table === 'song_creative_workspaces') return rows(state,'songs').filter(s=>s.creativeWorkspace).map(s=>({song_id:s.id,user_id:owner,workspace:s.creativeWorkspace,revision:s.creativeWorkspace.revision}));
  if (table === 'suno_styles' && !state.tables?.suno_styles) return rows(state,'songs').flatMap(s=>(s.sunoStyles||[]).map((style:any,index:number)=>({...style,id:`${s.id}-style-${index}`,song_id:s.id,user_id:owner,why_it_fits:style.whyItFits,created_at:s.created_at})));
  return (state.tables?.[table] || []).map(r=>({...r,...(r.user_id?{user_id:owner}:{}),...(r.song_id?{songs:rows(state,'songs').find(s=>s.id===r.song_id)}:{})}));
}
function putRows(state: LocalWorkspaceState, table: string, records: any[]) {
  if(table==='workspaces'){state.workspace=records[0]||null;return;}
  if(table==='channels'){state.channels=records.map(({workspaces,...r})=>r);return;}
  if(table==='songs'){
    for(const r of records){
      if(!state.channels.some(c=>c.id===r.channel_id))throw Error('Unknown local channel.');
      const list=state.songsByChannel[r.channel_id]||=[];
      const index=list.findIndex(s=>(s.id||s.projectId)===r.id);
      const song={...r,projectId:r.id,localDirty:true};
      for(const [key,alias] of Object.entries(aliases))if(key in r)song[alias]=r[key];
      if(index<0)list.push(song);else list[index]=song;
    }return;
  }
  if(table==='song_creative_workspaces'){
    for(const r of records){
      const song=Object.values(state.songsByChannel).flat().find(s=>(s.id||s.projectId)===r.song_id);
      if(!song)throw Error('Unknown local project.');
      song.creativeWorkspace={...r.workspace,revision:r.revision};song.localDirty=true;
    }return;
  }
  state.tables??={};state.tables[table]=records.map(({songs,...r})=>r);
}
const valueAt=(row:any,key:string)=>key.split('.').reduce((r,k)=>r?.[k],row);
class LocalQuery implements PromiseLike<any> {
  private filters: ((row:any)=>boolean)[]=[];
  private operation='select';private values:any;private conflict='id';private one=false;private optional=false;
  private ordering:{key:string;ascending:boolean}[]=[];private maximum=Infinity;
  private table:string;
  constructor(table:string){this.table=table;}
  select(_columns?:string){return this;}
  eq(key:string,value:any){this.filters.push(r=>valueAt(r,key)===value);return this;}
  neq(key:string,value:any){this.filters.push(r=>valueAt(r,key)!==value);return this;}
  is(key:string,value:any){return this.eq(key,value);}
  in(key:string,values:any[]){this.filters.push(r=>values.includes(valueAt(r,key)));return this;}
  order(key:string,options?:{ascending?:boolean}){this.ordering.push({key,ascending:options?.ascending!==false});return this;}
  limit(n:number){this.maximum=n;return this;}
  single(){this.one=true;return this;}
  maybeSingle(){this.one=true;this.optional=true;return this;}
  insert(values:any){this.operation='insert';this.values=values;return this;}
  upsert(values:any,options?:{onConflict?:string}){this.operation='upsert';this.values=values;this.conflict=options?.onConflict||'id';return this;}
  update(values:any){this.operation='update';this.values=values;return this;}
  delete(){this.operation='delete';return this;}
  then<TResult1=any,TResult2=never>(resolve?:((v:any)=>TResult1|PromiseLike<TResult1>)|null,reject?:((e:any)=>TResult2|PromiseLike<TResult2>)|null):PromiseLike<TResult1|TResult2>{return this.execute().then(resolve,reject);}
  private async execute(){
    try{
      const run=(state:LocalWorkspaceState)=>{
        let records=rows(state,this.table),result=records.filter(r=>this.filters.every(f=>f(r)));
        if(this.operation==='delete'){
          // Keep immutable history. Explicit deletes only detach active records.
          state.tables??={};(state.tables.local_record_history??=[]).push(...result.map(r=>({table:this.table,record:r,archivedAt:new Date().toISOString()})));
          if(['songs','channels','workspaces'].includes(this.table))throw Error('Local production records must be archived, never deleted.');
          records=records.filter(r=>!result.includes(r));putRows(state,this.table,records);
        }else if(this.operation==='update'){
          if (this.table==='songs' && ('id' in this.values || 'channel_id' in this.values || 'user_id' in this.values)) throw Error('Project identity cannot be changed.');
          const updated=result.map(r=>({...r,...this.values}));
          if(this.one&&updated.length!==1)throw Error('Record changed or was not found.');
          state.tables??={};(state.tables.local_record_history??=[]).push(...result.map(r=>({table:this.table,record:r,archivedAt:new Date().toISOString()})));
          putRows(state,this.table,['songs','song_creative_workspaces'].includes(this.table)?updated:records.map(r=>{const i=result.indexOf(r);return i<0?r:updated[i];}));result=updated;
        }else if(this.operation==='insert'||this.operation==='upsert'){
          result=[];
          for(const raw of Array.isArray(this.values)?this.values:[this.values]){
            const input = this.table==='song_media_assets' && raw.storage_provider==='supabase'
              ? {...raw,storage_provider:'local',local_path:`objects/song-media/${raw.storage_path}`,storage_path:null} : raw;
            const row={id:crypto.randomUUID(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),...input};
            if(this.table==='channels'){row.is_archived??=false;row.active_dna_revision??=null;}
            if(row.song_id&&!rows(state,'songs').some(s=>s.id===row.song_id))throw Error('Unknown local project.');
            const keys=this.conflict.split(',');const index=records.findIndex(r=>keys.every(k=>r[k]===row[k]));
            if(index>=0&&this.operation==='insert')throw Error('Record already exists.');
            if(index>=0){state.tables??={};(state.tables.local_record_history??=[]).push({table:this.table,record:records[index],archivedAt:new Date().toISOString()});const previous=records[index];records[index]={...previous,...input};result.push(records[index]);}
            else{records.push(row);result.push(row);}
          }
          putRows(state,this.table,['songs','song_creative_workspaces'].includes(this.table)?result:records);
        }
        for(const o of [...this.ordering].reverse())result.sort((a,b)=>{const x=valueAt(a,o.key),y=valueAt(b,o.key);return (x<y?-1:x>y?1:0)*(o.ascending?1:-1);});
        result=result.slice(0,this.maximum);
        if(this.one){if(result.length>1||(!this.optional&&result.length!==1))throw Error('Expected one local record.');return {data:result[0]||null,error:null};}
        return {data:result,error:null};
      };
      return this.operation==='select'?run(await readLocalWorkspace()):await mutateLocalWorkspace(run);
    }catch(e){return {data:null,error:{message:e instanceof Error?e.message:'Local repository failed.',code:'LOCAL_DATA_ERROR'}};}
  }
}
export function createLocalDatabase(){
 return {local:true,storage:localStorage(),auth:{getUser:async()=>({data:{user:{id:localOwner(await readLocalWorkspace()),user_metadata:{}}},error:null})},from:(table:string)=>new LocalQuery(table)};
}
