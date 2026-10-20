import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,stat,mkdir,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
const base=process.env.SZU_TEST_URL,root=process.env.SZU_TEST_ROOT;
function call(route,body,options=[]){const args=['-sS','-H','Host: localhost:3000',...options];if(body)args.push('-H','Content-Type: application/json','--data',JSON.stringify(body));return execFileSync('curl',[...args,base+route],{encoding:'utf8'});}
function json(route,body){const data=JSON.parse(call(route,body));assert.ok(!data.error,JSON.stringify(data));return data;}
function upload(projectId,kind,bytes,slot=1,metadata={}){
 const mime=kind==='final-audio'?'audio/wav':kind.endsWith('video')?'video/mp4':'image/png';
 const params=new URLSearchParams({projectId,mediaKind:kind,slot:String(slot),filename:kind+'.bin',mimeType:mime,sizeBytes:String(bytes.length),uploadId:crypto.randomUUID(),chunkIndex:'0',totalChunks:'1',chunkStart:'0',chunkEnd:String(bytes.length),metadata:JSON.stringify(metadata)});
 const data=JSON.parse(execFileSync('curl',['-sS','-H','Host: localhost:3000','--data-binary','@-','-H','Content-Type: '+mime,base+'/api/media/local-upload?'+params],{input:bytes,encoding:'utf8'}));assert.ok(!data.error,JSON.stringify(data));return data.asset;
}
test('local media survives replacement, preserves metadata and rejects path escapes',{skip:!base||!root},async()=>{
 const {channel}=json('/api/channels',{name:'Media verification'});
 const {projectId}=json('/api/songs',{projectId:crypto.randomUUID(),channelId:channel.id,title:'Media project',language:'English'});
 const contents=Buffer.from('local media persistence verification');
 for(const kind of ['final-audio','cover-art','thumbnail','youtube-video','vertical-video']){
  const endpoint='/api/media/'+(['cover-art','thumbnail'].includes(kind)?'artwork':kind),slot=kind==='vertical-video'?3:1;
  const mime=kind==='final-audio'?'audio/wav':kind.endsWith('video')?'video/mp4':'image/png';
  const prep=json(endpoint,{action:'prepare',projectId,mediaKind:kind,slot,originalFilename:'test.bin',mimeType:mime,sizeBytes:contents.length});assert.equal(prep.localMode,true);
  const first=upload(projectId,kind,contents,slot,{durationSeconds:20,width:1920,height:1080});
  assert.equal(call(first.url),contents.toString());
  assert.equal(call(first.url,null,['-H','Range: bytes=-5']),contents.subarray(-5).toString());
  const second=upload(projectId,kind,Buffer.from('replacement'),slot,{verified:true});
  assert.notEqual(first.localPath,second.localPath);assert.equal((await readFile(path.join(root,first.localPath))).toString(),contents.toString());
  const loaded=json(endpoint+'?projectId='+projectId);const asset=loaded.asset||(loaded.assets||[]).find(a=>a.mediaKind===kind&&a.slot===slot);assert.equal(asset.localPath,second.localPath);assert.equal(asset.metadata.verified,true);
  const registered=json(endpoint,{action:'register',projectId,mediaKind:kind,slot,localPath:second.localPath,originalFilename:'replacement.bin',mimeType:mime,sizeBytes:11,metadata:{registered:true}});assert.equal(registered.asset.metadata.registered,true);
 }
 const outside=path.join(root,'..','outside-media-test');await mkdir(outside,{recursive:true});await writeFile(path.join(outside,'escape.wav'),'escape');
 const link=path.join(root,'songs',projectId,'escape');await symlink(outside,link);
 for(const localPath of ['../outside-media-test/escape.wav',`songs/${projectId}/escape/escape.wav`,`songs/${crypto.randomUUID()}/file.wav`]){
  const rejected=JSON.parse(call('/api/media/final-audio',{action:'register',projectId,localPath,originalFilename:'escape.wav',mimeType:'audio/wav',sizeBytes:6}));assert.ok(rejected.error);
 }
 const saved=JSON.parse(await readFile(path.join(root,'local-state/workspace.json'),'utf8'));assert.ok(saved.tables.local_record_history.length>=5);
 await writeFile(path.join(root,'media-verification.json'),JSON.stringify({projectId}));
});
