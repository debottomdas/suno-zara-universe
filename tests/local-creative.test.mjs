import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {emptyDna} from '../utils/channel-dna/model.ts';
const base=process.env.SZU_TEST_URL,root=process.env.SZU_TEST_ROOT;
function raw(route,body,method=body?'POST':'GET'){
 const args=['-sS','-H','Host: localhost:3000','-X',method];if(body)args.push('-H','Content-Type: application/json','--data',JSON.stringify(body));return execFileSync('curl',[...args,base+route],{encoding:'utf8'});
}
function json(route,body,method){const data=JSON.parse(raw(route,body,method));assert.ok(!data.error,JSON.stringify(data));return data;}
test('all local creative production uses real persistence and local object storage with a stub provider',{skip:!base||!root||process.env.SZU_TEST_PROVIDER!=='stub'},async()=>{
 const {channel}=json('/api/channels',{name:'Creative local verification'});
 const dna=emptyDna();dna.sections.musical.fields.genres='BRASS_RULE_TEST';dna.sections.visual.fields.watermark='off';
 assert.equal(json('/api/channels/'+channel.id+'/dna',{document:dna,expectedRevision:null,lockChanges:[],changeNote:'Test DNA'},'PUT').revision,1);
 const hooks=json('/api/generate',{channelId:channel.id,idea:'A traveller journeys home',language:'English',script:'Native',mood:'hopeful',genre:'folk',freedom:50});assert.equal(hooks.hooks.length,3);const projectId=hooks.projectId;
 json('/api/select-hook',{projectId,selectedHook:hooks.hooks[0]});
 const song=json('/api/generate-song',{projectId});assert.match(song.lyrics,/traveller/);
 const rewritten=json('/api/rewrite-section',{projectId,sectionName:'Verse',instruction:'Open the gate'});assert.match(rewritten.lyrics,/opens the gate/);
 const styles=json('/api/suno-styles',{projectId});assert.equal(styles.styles.length,5);
 const concepts=json('/api/image-concepts',{projectId});const concept=concepts.concepts[0];
 const generated=json('/api/generate-image',{projectId,conceptId:concept.id,format:'youtube',imageNumber:1,imageUseSongTitle:false});assert.ok(generated);
 const inventory=json('/api/generate-image?projectId='+projectId);assert.equal(inventory.images.length,1);
 let {workspace:w}=json('/api/creative-workspace?projectId='+projectId);
 const command=(action,body={})=>{const data=json('/api/creative-workspace',{projectId,revision:w.revision,action,...body});if(data.workspace)w=data.workspace;return data;};
 command('setup',{duration:20,audioKey:'test-audio',instructions:'A traveller travels home'});
 command('propose-direction');assert.match(w.bible,/traveller/);
 command('direction',{instructions:w.instructions,bible:w.bible,approve:true});
 command('plan-scenes',{confirmPaid:true});command('scene-plan',{scenes:w.scenePlan.scenes});command('approve-scene-plan');
 command('prompt',{slotId:'scene-1',prompt:'A traveller enters the dawn light'});
 command('generate',{slotId:'scene-1',confirmPaid:true});assert.equal(w.slots[0].candidates.length,1);
 const first=w.slots[0].candidates[0];assert.match(first.url,/local-object/);
 command('derive',{slotId:'short-1',candidateId:first.id});
 command('approve-image',{slotId:'short-1',candidateId:w.slots.find(s=>s.id==='short-1').candidates[0].id});
 const png=await sharp({create:{width:24,height:24,channels:3,background:'#998877'}}).png().toBuffer();
 const prepared=command('prepare-upload',{slotId:'cover',mimeType:'image/png',size:png.length});assert.equal(prepared.localMode,true);
 const uploaded=JSON.parse(execFileSync('curl',['-sS','-X','PUT','-H','Host: localhost:3000','--data-binary','@-',base+prepared.upload.uploadUrl],{input:png,encoding:'utf8'}));assert.ok(uploaded.saved);
 command('register-upload',{slotId:'cover',storagePath:prepared.upload.storagePath});
 command('approve-image',{slotId:'cover',candidateId:w.slots.find(s=>s.id==='cover').candidates[0].id});
 const art=json('/api/media/artwork?projectId='+projectId);assert.equal(art.assets[0].storageProvider,'local');
 command('import-artwork',{slotId:'thumbnail',assetId:art.assets[0].id});
 command('import-image',{slotId:'scene-1',imageId:inventory.images[0].id});
 command('analyse',{analysis:{duration:20,sourceKey:'test-audio',energy:[{time:0,rms:.5}]}});
 command('plan',{scenes:w.plan.scenes,shorts:w.plan.shorts,approve:true});assert.equal(w.plan.approved,true);
 command('subtitle-preference',{subtitlesEnabled:false});command('add-scene',{prompt:'Another distinct journey moment'});
 const stale=JSON.parse(raw('/api/creative-workspace',{projectId,revision:0,action:'prompt',slotId:'scene-1',prompt:'Must reject'}));assert.ok(stale.error);
 const saved=JSON.parse(await readFile(root+'/local-state/workspace.json','utf8'));assert.ok(saved.tables.ai_usage_events.length>=3);assert.ok(saved.tables.song_versions.length>=1);
 await writeFile(root+'/creative-verification.json',JSON.stringify({projectId,revision:w.revision}));
});

test('local multipart image import and lyric cue review persist without cloud storage',{skip:!base||!root||process.env.SZU_TEST_PROVIDER!=='stub'},async()=>{
 const {projectId}=JSON.parse(await readFile(root+'/creative-verification.json','utf8'));
 let {workspace:w}=json('/api/creative-workspace?projectId='+projectId);
 const png=await sharp({create:{width:16,height:16,channels:3,background:'#225577'}}).png().toBuffer();
 const imported=JSON.parse(execFileSync('curl',['-sS','-H','Host: localhost:3000','-F','projectId='+projectId,'-F','revision='+w.revision,'-F','action=import-file','-F','slotId=scene-1','-F','file=@-;filename=local.png;type=image/png',base+'/api/creative-workspace'],{input:png,encoding:'utf8'}));assert.ok(!imported.error,JSON.stringify(imported));w=imported.workspace;
 const bytes=Buffer.from('isolated audio cue fixture');
 const params=new URLSearchParams({projectId,mediaKind:'final-audio',slot:'1',filename:'cue.wav',mimeType:'audio/wav',sizeBytes:String(bytes.length),uploadId:crypto.randomUUID(),chunkIndex:'0',totalChunks:'1',chunkStart:'0',chunkEnd:String(bytes.length),metadata:JSON.stringify({durationSeconds:20})});
 const audio=JSON.parse(execFileSync('curl',['-sS','-H','Host: localhost:3000','--data-binary','@-',base+'/api/media/local-upload?'+params],{input:bytes,encoding:'utf8'}));assert.ok(audio.saved);
 const current=json('/api/creative-workspace?projectId='+projectId),context=current.lyricCueContext;assert.ok(context.source);
 const reviewed=json('/api/creative-workspace',{projectId,revision:w.revision,action:'lyric-cues',source:context.source,cues:[{start:0,end:3,lineIndex:0,text:context.phrases[0]}],reviewed:true,listened:true});assert.equal(reviewed.workspace.lyricCueReview.reviewed,true);
 const missing=json('/api/creative-workspace',{projectId,revision:reviewed.workspace.revision,action:'generate',slotId:'scene-1',missingOnly:true,confirmPaid:true});assert.equal(missing.workspace.revision,reviewed.workspace.revision);
 await writeFile(root+'/creative-verification.json',JSON.stringify({projectId,revision:reviewed.workspace.revision}));
});
