// Explicit local-only integration test. Uses synthetic media and a separate manifest.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'szu-v525-integration-'));
const audio=path.join(root,'tone.wav');execFileSync(ffmpeg,['-y','-f','lavfi','-i','sine=frequency=440:duration=12','-c:a','pcm_s16le',audio],{stdio:'ignore'});
const image=await sharp({create:{width:320,height:180,channels:3,background:'#315f9b'}}).png().toBuffer();const wav=await fs.readFile(audio);
const media=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/audio'?'audio/wav':'image/png');res.end(req.url==='/audio'?wav:image);});await new Promise(r=>media.listen(0,'127.0.0.1',r));
const mediaBase=`http://127.0.0.1:${media.address().port}`,port=47125,base=`http://127.0.0.1:${port}`,projectId='synthetic-v525';
const untouched={buffer:{existing:{postId:'do-not-touch',status:'draft'}},bufferAttemptHistory:{old:{status:'error'}},youtube:{existing:{videoId:'keep'}}};
await fs.writeFile(path.join(root,'worker-manifest.json'),JSON.stringify({projects:{[projectId]:{publishing:untouched}}}));
const worker=spawn(process.execPath,['local-worker/full-video-worker.mjs'],{env:{...process.env,SZU_WORKER_PORT:String(port),SZU_WORKER_ROOT:root},stdio:['ignore','pipe','pipe']});let logs='';worker.stdout.on('data',c=>logs+=c);worker.stderr.on('data',c=>logs+=c);
async function request(route,body){const r=await fetch(base+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,...body})}:undefined);const d=await r.json();assert.equal(r.ok,true,JSON.stringify(d));return d;}
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker startup timeout')),10000);worker.once('error',reject);worker.stdout.on('data',c=>{if(String(c).includes('worker ready')){clearTimeout(timer);resolve();}});});
 const keys=Object.fromEntries(Array.from({length:7},(_,i)=>[i?`short-${i}`:'full',`inputs-${i}`]));await request('/creative/sync',{keys});
 const versions=[];
 for(let slot=0;slot<=6;slot++){
  const name=slot?`short-${slot}`:'full';const {version}=await request('/creative/render',{slot,title:'Synthetic verification',audioUrl:mediaBase+'/audio',durationSeconds:12,visuals:[{url:mediaBase+'/image',format:slot?'vertical':'landscape',mediaType:'image'}],sceneDurations:[12],highlight:{startSeconds:slot%3,endSeconds:slot%3+8},dependencyKey:keys[name]});versions.push(version);await request('/creative/approve',{slot,id:version.id});console.log(`Rendered and approved ${name}`);
 }
 let status=await request(`/creative/status?projectId=${projectId}`);assert.equal(status.complete,true);const before=JSON.stringify(status.approved);
 const result=await request('/creative/render',{slot:3,title:'Synthetic verification',audioUrl:mediaBase+'/audio',durationSeconds:12,visuals:[{url:mediaBase+'/image',format:'vertical',mediaType:'image'}],highlight:{startSeconds:2,endSeconds:10},dependencyKey:keys['short-3']});
 status=await request(`/creative/status?projectId=${projectId}`);assert.equal(JSON.stringify(status.approved),before);assert.equal(status.versions.length,8);
 const preview=await fetch(result.version.fileUrl,{headers:{Range:'bytes=0-99'}});assert.equal(preview.status,206);assert.equal((await preview.arrayBuffer()).byteLength,100);
 const manifest=JSON.parse(await fs.readFile(path.join(root,'worker-manifest.json'),'utf8'));assert.deepEqual(manifest.projects[projectId].publishing,untouched);
 const old=manifest.projects[projectId].creative.versions.find(v=>v.id===versions[3].id);const originalHash=createHash('sha256').update(await fs.readFile(old.filePath)).digest('hex');
 await request('/creative/sync',{keys:{...keys,'short-3':'changed-input'}});status=await request(`/creative/status?projectId=${projectId}`);assert.equal(status.complete,false);assert.equal(Object.keys(status.approved).length,6);assert.equal(status.approved['short-3'],undefined);assert.equal(createHash('sha256').update(await fs.readFile(old.filePath)).digest('hex'),originalHash);
 const failed=await fetch(base+'/creative/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,slot:3,id:versions[3].id})});assert.equal(failed.ok,false);
 for(const v of manifest.projects[projectId].creative.versions){const meta=execFileSync(ffmpeg,['-i',v.filePath,'-f','null','-'],{encoding:'utf8',stdio:['ignore','ignore','pipe']});}
 // Real uploads into an isolated hybrid project, followed by rendering only a missing Short.
 const hybridId='synthetic-hybrid',ownVersions=[];
 for(const slot of [0,1,2]){
  const source=manifest.projects[projectId].creative.versions.find(v=>v.id===versions[slot].id);const bytes=await fs.readFile(source.filePath);
  const params=new URLSearchParams({projectId:hybridId,title:'Hybrid verification',slot:String(slot),filename:`own-${slot}.mp4`,mimeType:'video/mp4',sizeBytes:String(bytes.length),durationSeconds:slot?'8':'12',width:slot?'1080':'1920',height:slot?'1920':'1080'});
  const uploaded=await fetch(base+'/creative/upload?'+params,{method:'POST',headers:{'content-type':'video/mp4'},body:bytes});assert.equal(uploaded.ok,true);const {version}=await uploaded.json();ownVersions.push(version);
  await request('/creative/approve',{projectId:hybridId,slot,id:version.id});
 }
 await request('/creative/sync',{projectId:hybridId,keys});
 let hybridStatus=await request(`/creative/status?projectId=${hybridId}`);assert.equal(Object.keys(hybridStatus.approved).length,3);assert.ok(hybridStatus.versions.every(v=>v.source==='uploaded'));
 await request('/creative/render',{projectId:hybridId,slot:3,title:'Hybrid verification',audioUrl:mediaBase+'/audio',durationSeconds:12,visuals:[{url:mediaBase+'/image',format:'vertical',mediaType:'image'}],highlight:{startSeconds:1,endSeconds:9},dependencyKey:keys['short-3']});
 hybridStatus=await request(`/creative/status?projectId=${hybridId}`);for(const [i,slot] of [0,1,2].entries())assert.equal(hybridStatus.approved[slot?`short-${slot}`:'full'],ownVersions[i].id);assert.equal(hybridStatus.versions.length,4);assert.equal(hybridStatus.versions.filter(v=>v.source==='generated').length,1);
 // Replace two generated outputs without touching any other version or approval.
 for(const slot of [0,6]){
  const name=slot?`short-${slot}`:'full';
  const prior=await request(`/creative/status?projectId=${projectId}`);
  const original=manifest.projects[projectId].creative.versions.find(v=>v.id===versions[slot].id);
  const bytes=await fs.readFile(original.filePath),hash=createHash('sha256').update(bytes).digest('hex');
  const params=new URLSearchParams({projectId,slot:String(slot),filename:`edited-${slot}.mp4`,mimeType:'video/mp4',sizeBytes:String(bytes.length),durationSeconds:'8',width:slot?'1080':'1920',height:slot?'1920':'1080'});
  const upload=await fetch(base+'/creative/upload?'+params,{method:'POST',headers:{'content-type':'video/mp4'},body:bytes});assert.equal(upload.ok,true);const {version}=await upload.json();
  let saved=await request(`/creative/status?projectId=${projectId}`);
  assert.equal(saved.versions.at(-1).id,version.id);assert.deepEqual(saved.approved,prior.approved);assert.equal(saved.versions.length,prior.versions.length+1);
  assert.equal(createHash('sha256').update(await fs.readFile(original.filePath)).digest('hex'),hash);
  const wrong=await fetch(base+'/creative/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,slot:slot?0:6,id:version.id})});assert.equal(wrong.ok,false);
  await request('/creative/approve',{slot,id:version.id});
  saved=await request(`/creative/status?projectId=${projectId}`);assert.deepEqual(saved.approved,{...prior.approved,[name]:version.id});
  const disk=JSON.parse(await fs.readFile(path.join(root,'worker-manifest.json'),'utf8'));assert.equal(disk.projects[projectId].creative.approved[name],version.id);
  const released=await request(`/publishing/file-info?projectId=${projectId}&kind=${slot?'short':'full'}&slot=${slot}`);assert.equal(released.filename,`edited-${slot}.mp4`);assert.equal(released.source,'uploaded');
  assert.equal((await fetch(version.fileUrl)).status,200);
  assert.match((await fetch(version.fileUrl+'&download=1')).headers.get('content-disposition'),/^attachment;/);
  // Invalid type, output shape, unreadable bytes and slot leave history unchanged.
  for(const change of [{mimeType:'image/png'},{width:'100',height:'100'},{slot:'7'},{sizeBytes:'3',corrupt:true}]){
   const invalid=new URLSearchParams(params);for(const [key,value] of Object.entries(change))if(key!=='corrupt')invalid.set(key,value);
   const r=await fetch(base+'/creative/upload?'+invalid,{method:'POST',body:change.corrupt?Buffer.from('bad'):bytes});assert.equal(r.ok,false);assert.ok((await r.json()).error);
  }
  assert.deepEqual(await request(`/creative/status?projectId=${projectId}`),saved);
  // Explicitly reverting chooses the original immutable version; reapprove the edit.
  await request('/creative/approve',{slot,id:original.id});
  assert.equal((await request(`/publishing/file-info?projectId=${projectId}&kind=${slot?'short':'full'}&slot=${slot}`)).source,'generated');
  await request('/creative/approve',{slot,id:version.id});
 }
 assert.deepEqual((await request(`/creative/status?projectId=${hybridId}`)),hybridStatus);
 console.log('Replacement: full + Short 6 immutable uploads, explicit approval, reopen, publishing resolution, revert and invalid inputs passed.');
 console.log('Hybrid: uploaded full video + 2 own Shorts preserved; only missing Short 3 rendered.');
 const evidence={root,outputs:9,hybridUploads:3,hybridSuppliedApprovalsPreserved:true,approvedBeforeInvalidation:7,approvedAfterShort3Change:6,rangePlayback:206,publishingUnchanged:true,originalFileUnchanged:true};await fs.writeFile(path.join(root,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{worker.kill('SIGTERM');media.close();}
