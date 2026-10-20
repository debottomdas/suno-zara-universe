import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const base=process.env.SZU_TEST_URL;
export async function request(route,method='GET',body){
 const args=['-sS','-H','Host: localhost:3000','-X',method];
 if(body)args.push('-H','Content-Type: application/json','--data',JSON.stringify(body));
 const data=JSON.parse(execFileSync('curl',[...args,base+route],{encoding:'utf8'}));assert.ok(!data.error,JSON.stringify(data));return data;
}
test('local production routes work without application login or Supabase configuration',{skip:!base},async()=>{
 const {channel}=await request('/api/channels','POST',{name:'Local route test'});
 const {projectId}=await request('/api/songs','POST',{projectId:crypto.randomUUID(),channelId:channel.id,title:'Preserved project',language:'English'});
 const hook=await request('/api/select-hook','POST',{projectId,selectedHook:'My local hook'});assert.equal(hook.project.selectedHook,'My local hook');
 await request('/api/songs/lyrics','POST',{projectId,channelId:channel.id,lyrics:'[Verse]\nLocal original lyrics'});
 await request('/api/suno-styles','POST',{projectId,action:'save',styles:[{name:'Local style',prompt:'Warm acoustic folk',recommended:true}]});
 const styles=await request('/api/suno-styles?projectId='+projectId);assert.equal(styles.styles[0].name,'Local style');
 await request('/api/songs/lifecycle','PATCH',{projectId,channelId:channel.id,projectState:'later'});
 const songs=await request('/api/songs?channelId='+channel.id);const song=songs.projects.find(s=>s.id===projectId);assert.equal(song.projectState,'later');assert.match(song.lyrics,/Local original/);
 const dna=await request('/api/channels/'+channel.id+'/dna');assert.equal(dna.version,null);
 const invalid=execFileSync('curl',['-sS','-o','/dev/null','-w','%{http_code}','-H','Host: localhost:3000','-H','Content-Type: application/json','-X','PATCH','--data',JSON.stringify({projectId,channelId:crypto.randomUUID(),projectState:'current'}),base+'/api/songs/lifecycle'],{encoding:'utf8'});assert.equal(invalid,'404');
});
