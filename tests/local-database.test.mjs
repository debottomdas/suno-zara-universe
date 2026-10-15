import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('local repository persists production changes, serializes writers and rejects unknown operations',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'szu-database-'));
 try{
  for(const name of ['store','database','storage']){
   const source=(await readFile(`utils/local-first/${name}.ts`,'utf8')).replace(/^import ['"]server-only['"];\s*/,'').replaceAll("from './store'","from './store.ts'").replaceAll("from './storage'","from './storage.ts'").replace("from '@/utils/media-source'","from './media-source.ts'");
   await writeFile(path.join(root,`${name}.ts`),source);
  }
  await writeFile(path.join(root,'media-source.ts'),await readFile('utils/media-source.ts','utf8'));
  const script=`
   import assert from 'node:assert/strict';
   import {createLocalDatabase} from './database.ts';
   import {readLocalWorkspace,updateLocalSong,replaceLocalWorkspace} from './store.ts';
   const db=createLocalDatabase(),{data:{user}}=await db.auth.getUser();
   const ws=(await db.from('workspaces').insert({name:'Local',owner_user_id:user.id}).single()).data;
   const a=(await db.from('channels').insert({workspace_id:ws.id,name:'A'}).single()).data;
   const b=(await db.from('channels').insert({workspace_id:ws.id,name:'B'}).single()).data;
   const song=(await db.from('songs').insert({channel_id:a.id,user_id:user.id,title:'Keep',lyrics:'Original',selected_hook:'Hook'}).single()).data;
   assert.equal((await db.from('songs').select().eq('id',song.id).eq('channel_id',b.id).maybeSingle()).data,null);
   await Promise.all(Array.from({length:15},(_,i)=>updateLocalSong(song.id,{['field'+i]:i})));
   assert.equal((await db.from('songs').update({selected_hook:'New'}).eq('id',song.id).single()).error,null);
   let saved=(await readLocalWorkspace()).songsByChannel[a.id][0];
   assert.equal(saved.selectedHook,'New');for(let i=0;i<15;i++)assert.equal(saved['field'+i],i);
   assert.ok((await db.from('unknown_cloud_table').select()).error);
   assert.ok((await db.from('songs').delete().eq('id',song.id)).error);
   await replaceLocalWorkspace({workspace:ws,channels:[b],songsByChannel:{[b.id]:[]}});
   assert.equal((await db.from('songs').select().eq('id',song.id).single()).data.lyrics,'Original');
   await db.from('song_creative_workspaces').insert({song_id:song.id,user_id:user.id,workspace:{slots:[]},revision:1});
   const results=await Promise.all([2,3].map(revision=>db.from('song_creative_workspaces').update({workspace:{slots:[]},revision}).eq('song_id',song.id).eq('revision',1).single()));
   assert.equal(results.filter(r=>!r.error).length,1);
   await import('node:fs/promises').then(fs=>fs.writeFile(process.env.SZU_WORKER_ROOT+'/local-state/workspace.json','broken'));
   await assert.rejects(updateLocalSong(song.id,{title:'Must not overwrite'}));
  `;
  const result=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',script],{cwd:root,env:{...process.env,SZU_WORKER_ROOT:root,VERCEL:'0',SZU_DISABLE_LOCAL_MODE:'0'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(await readFile(path.join(root,'local-state/workspace.json'),'utf8'),'broken');
 }finally{await rm(root,{recursive:true,force:true});}
});
