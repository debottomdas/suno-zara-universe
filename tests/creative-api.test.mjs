import path from 'node:path';import {createRequire} from 'node:module';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import sharp from 'sharp';
const image=await sharp({create:{width:32,height:32,channels:3,background:'blue'}}).png().toBuffer();
function transpile(file,modules={}){const ctx={exports:{},require:n=>modules[n],process,Buffer,Request,Response,URL,File,crypto,Date,structuredClone,console};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,ctx);return ctx.exports;}
const native=createRequire(import.meta.url),realCache=new Map();
function real(file){file=path.resolve(file);if(realCache.has(file))return realCache.get(file);const ctx={exports:{},require:n=>n.startsWith('.')?real(path.resolve(path.dirname(file),n)+'.ts'):native(n),process,Buffer,structuredClone,TextEncoder,Date};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,ctx);realCache.set(file,ctx.exports);return ctx.exports;}
const sceneHelpers=real('utils/creative/scene-plan.ts'),brandingHelpers=real('utils/creative/branding.ts'),sceneFixture=JSON.parse(fs.readFileSync('tests/fixtures/visual-bengali.json','utf8'));
function mockScenes(slots){return slots.map((slot,i)=>({...sceneFixture.scenes[i%16],slotId:slot.id,...(i===16?{beat:'He folds away the forgotten letter without reading again',location:'Small bedroom beside an open drawer',action:'He carefully shuts the drawer and leaves the letter inside'}:i===17?{beat:'Passing bicycles disturb a puddle reflecting the clearing sky',location:'Quiet back lane near parked bicycles',action:'A bicycle wheel breaks the reflected cloud into ripples',characters:[]}:{}),evidence:[{source:'lyrics',quote:'Test'}]}));}
function harness({blankDirection=false,planOnApproval=true,activeChannel={channelId:'11111111-1111-4111-8111-111111111111',channelName:'Test Channel',dnaRevision:null,dna:null}}={}){let directionCalls=0;let actor='owner',paid=0,failCopy=false;const tables={songs:[{id:'song',user_id:'owner',channel_id:'bangla',title:'Test',lyrics:'[Verse]\nTest\n[Chorus]\nTest'}],song_creative_workspaces:[],ai_usage_events:[],song_media_assets:[]};const blobs=new Map();
 const db={auth:{getUser:async()=>({data:{user:actor?{id:actor}:null}})},from:table=>{
  let filters=[],op='read',values;const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q;},insert:v=>{op='insert';values=v;return q;},update:v=>{op='update';values=v;return q;},upsert:v=>{op='upsert';values=v;return q;},single:()=>run(true),maybeSingle:()=>run(false),then:(a,b)=>run(false).then(a,b)};
  async function run(single){let rows=tables[table]||=[];let row=rows.find(r=>filters.every(([k,v])=>r[k]===v));if(op==='insert'){if(table==='song_creative_workspaces'&&rows.some(r=>r.song_id===values.song_id))return {error:{message:'conflict'}};row=structuredClone(values);rows.push(row);}if(op==='update'){if(!row)return{data:null,error:{message:'conflict'}};Object.assign(row,structuredClone(values));}if(op==='upsert'){row=rows.find(r=>r.song_id===values.song_id&&r.media_kind===values.media_kind);if(row)Object.assign(row,structuredClone(values));else{row=structuredClone(values);rows.push(row);}}return {data:row?structuredClone(row):null,error:single&&!row?{message:'not found'}:null};}return q;
 },storage:{from:()=>({upload:async(p,b)=>{assert.equal(blobs.has(p),false,'immutable path');blobs.set(p,b);return{};},createSignedUrls:async paths=>({data:paths.map(p=>({path:p,signedUrl:'https://preview.test/'+p,error:null}))}),copy:async(p,to)=>{if(failCopy){failCopy=false;return{error:{message:'temporary storage failure'}};}blobs.set(to,blobs.get(p));return{};},download:async p=>({data:blobs.has(p)?new Blob([blobs.get(p)]):null})})}};
 class AI{images={generate:async()=>{paid++;return {data:[{b64_json:image.toString('base64')}],usage:{input_tokens:5,output_tokens:10,total_tokens:15}};}};responses={create:async()=>{directionCalls++;return {output_text:JSON.stringify({bible:blankDirection?'   ':'Suggested world',scenes:mockScenes(tables.song_creative_workspaces[0].workspace.slots)}),usage:{input_tokens:1,output_tokens:1,total_tokens:2}};}};}
 const model=transpile('utils/creative/model.ts');const route=transpile('app/api/creative-workspace/route.ts',{'@/utils/creative/scene-plan':sceneHelpers,'@/utils/creative/branding':brandingHelpers,'@/utils/channel-dna/server':{resolveActiveChannelDNA:async()=>activeChannel},'@/utils/channel-dna/context':transpile('utils/channel-dna/context.ts'),'@/utils/channel-dna/instructions':{channelInstructions:c=>`ACTIVE CHANNEL: ${c.channelName}`},'next/server':{NextResponse:{json:(d,o)=>Response.json(d,o)}},'openai':AI,'@/utils/creative/image-generation':transpile('utils/creative/image-generation.ts',{'openai':AI}),'sharp':sharp,'@/utils/supabase/server':{createClient:async()=>db},'@/utils/creative/model':model,'node:fs/promises':{},'@/utils/media-source':{}});
 async function rawAct(action,extra={},revision){const rev=revision??tables.song_creative_workspaces[0]?.revision??0;const r=await route.POST(new Request('http://test/api/creative-workspace',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId:'song',revision:rev,action,...extra})}));return{ok:r.ok,status:r.status,...await r.json()};}
 async function act(action,extra={},revision){let result=await rawAct(action,extra,revision);if(planOnApproval&&result.ok&&action==='direction'&&extra.approve){const scenes=mockScenes(result.workspace.slots);result=await rawAct('scene-plan',{scenes});if(result.ok)result=await rawAct('approve-scene-plan');}return result;}
 return{act,rawAct,tables,blobs,get directionCalls(){return directionCalls;},read:async()=>{const r=await route.GET(new Request('http://test/api/creative-workspace?projectId=song'));return r.json();},failNextCopy:()=>{failCopy=true;},get paid(){return paid;},setActor:x=>actor=x};
}
test('API ownership, approval gate, immutable image candidates and usage accounting',async()=>{
 const h=harness();h.setActor('other');assert.equal((await h.act('setup',{duration:240})).ok,false);h.setActor('owner');assert.equal((await h.act('setup',{duration:240})).ok,true);
 assert.equal((await h.act('generate',{slotId:'short-1',confirmPaid:true})).ok,false);assert.equal(h.paid,0);
 await h.act('direction',{instructions:'',bible:'Characters and world',approve:true});const first=await h.act('generate',{slotId:'short-1',confirmPaid:true});assert.equal(first.ok,true,first.error);const id=first.workspace.slots.find(s=>s.id==='short-1').candidates[0].id;
 await h.act('approve-image',{slotId:'short-1',candidateId:id});const second=await h.act('generate',{slotId:'short-1',confirmPaid:true});assert.equal(second.ok,true,second.error);const slot=second.workspace.slots.find(s=>s.id==='short-1');assert.equal(slot.approvedId,id);assert.equal(slot.candidates.length,2);assert.notEqual(slot.candidates[0].storagePath,slot.candidates[1].storagePath);assert.equal(h.paid,2);assert.equal(h.tables.ai_usage_events.length,2);
 const stale=await h.act('direction',{bible:'clobber'},0);assert.equal(stale.ok,false);assert.equal(h.tables.song_creative_workspaces[0].workspace.bible,'Characters and world');
});
test('API refuses forged approvals, cross-project uploads, invalid timings and paid calls without confirmation',async()=>{const h=harness();await h.act('setup',{duration:240});await h.act('direction',{bible:'Bible',approve:true});assert.equal((await h.act('generate',{slotId:'short-1'})).ok,false);assert.equal((await h.act('approve-image',{slotId:'short-1',candidateId:'forged'})).ok,false);assert.equal((await h.act('register-upload',{slotId:'short-1',storagePath:'someone-else/song/image.png'})).ok,false);assert.equal((await h.act('plan',{scenes:[],shorts:[],approve:true})).ok,false);assert.equal(h.paid,0);});
test('cover approval copies to existing release asset contract without replacing immutable image',async()=>{const h=harness();await h.act('setup',{duration:240});await h.act('direction',{bible:'Bible',approve:true});const made=await h.act('generate',{slotId:'cover',confirmPaid:true});const c=made.workspace.slots.find(s=>s.id==='cover').candidates[0];const approved=await h.act('approve-image',{slotId:'cover',candidateId:c.id});assert.equal(approved.ok,true,approved.error);assert.equal(h.tables.song_media_assets[0].media_kind,'cover-art');assert.equal(h.tables.song_media_assets[0].metadata.width,3000);assert.ok(h.blobs.has(c.storagePath));assert.notEqual(h.tables.song_media_assets[0].storage_path,c.storagePath);});

test('artwork registration can recover without generation or replacing the candidate',async()=>{const h=harness();await h.act('setup',{duration:240});await h.act('direction',{bible:'Bible',approve:true});const made=await h.act('generate',{slotId:'cover',confirmPaid:true});const c=made.workspace.slots.find(s=>s.id==='cover').candidates[0];h.failNextCopy();const failed=await h.act('approve-image',{slotId:'cover',candidateId:c.id});assert.equal(failed.ok,false);assert.equal(h.tables.song_creative_workspaces[0].workspace.slots.find(s=>s.id==='cover').approvedId,c.id);const recovered=await h.act('approve-image',{slotId:'cover',candidateId:c.id});assert.equal(recovered.ok,true,recovered.error);assert.equal(h.paid,1);assert.equal(recovered.workspace.slots.find(s=>s.id==='cover').candidates.length,1);assert.equal(h.tables.song_media_assets[0].metadata.creativeVersionId,c.id);});

test('hybrid timing approval does not require landscape or supplied-Short visuals; timing safety remains enforced',async()=>{const h=harness();await h.act('setup',{duration:120});const analysed=await h.act('analyse',{analysis:{duration:120,sourceKey:'master',energy:[]}});assert.equal(analysed.ok,true);const plan=analysed.workspace.plan;const approved=await h.act('plan',{...plan,approve:true});assert.equal(approved.ok,true,approved.error);assert.equal(approved.workspace.plan.approved,true);assert.equal(approved.workspace.slots.some(s=>s.approvedId),false);const invalid=await h.act('plan',{...plan,shorts:plan.shorts.map((s,i)=>i===2?{...s,end:999}:s),approve:true});assert.equal(invalid.ok,false);assert.equal(h.paid,0);});

const batchModel=transpile('utils/creative/model.ts');
const {visualBatchState,runVisualBatch}=transpile('utils/creative/visual-batch.ts',{'./model':batchModel});
test('missing-only batch uses the existing provider, sequential revisions and explicit review with hybrid uploads',async()=>{
 const h=harness();let w=(await h.act('setup',{duration:30})).workspace;
 w=(await h.act('direction',{bible:'Approved world',approve:true})).workspace;
 for(const id of ['cover','short-1','short-2']){
  const path=`owner/song/creative-incoming/${id}`;h.blobs.set(path,image);
  w=(await h.act('register-upload',{slotId:id,storagePath:path})).workspace;
  const candidate=w.slots.find(s=>s.id===id).candidates[0];
  w=(await h.act('approve-image',{slotId:id,candidateId:candidate.id})).workspace;
 }
 const supplied=JSON.stringify(w.slots.filter(s=>['cover','short-1','short-2'].includes(s.id)));
 const required=()=>w.slots.filter(s=>!h.tables.song_media_assets.some(a=>a.media_kind===(s.kind==='cover'?'cover-art':s.kind==='thumbnail'?'thumbnail':null)));
 let state=visualBatchState(w,required());assert.equal(state.missing.length,7);assert.equal(state.label,'Generate 7 Missing Visuals');
 const requests=[],progress=[];
 const request=async(action,body,revision)=>{requests.push({action,body,revision});const r=await h.act(action,body,revision);assert.equal(r.ok,true,r.error);w=r.workspace;return w;};
 w=await runVisualBatch(w,state.missing,'generate',request,(n,total)=>progress.push([n,total]));
 assert.equal(h.paid,7);assert.equal(requests.length,7);assert.equal(progress.length,8);
 assert.equal(JSON.stringify(w.slots.filter(s=>['cover','short-1','short-2'].includes(s.id))),supplied);
 assert.equal(w.slots.find(s=>s.id==='short-3').approvedId,undefined,'generation never invents approval');
 state=visualBatchState(w,required());assert.equal(state.label,'Approve reviewed visuals');
 w=await runVisualBatch(w,state.review,'approve-image',request,()=>{});
 assert.equal(visualBatchState(w,required()).ready,true);assert.equal(h.paid,7);
 const untouched=JSON.stringify(w.slots.filter(s=>s.id!=='short-3'));
 const old=w.slots.find(s=>s.id==='short-3').approvedId;
 w=(await h.act('generate',{slotId:'short-3',confirmPaid:true})).workspace;
 assert.equal(JSON.stringify(w.slots.filter(s=>s.id!=='short-3')),untouched);
 assert.equal(w.slots.find(s=>s.id==='short-3').approvedId,old);
 assert.equal(w.slots.find(s=>s.id==='short-3').candidates.length,2);
 assert.equal(h.paid,8);
});
test('missing-only endpoint preserves unapproved uploads and supplied release artwork without spending',async()=>{
 const h=harness();await h.act('setup',{duration:30});await h.act('direction',{bible:'World',approve:true});
 const path='owner/song/creative-incoming/short';h.blobs.set(path,image);
 const uploaded=await h.act('register-upload',{slotId:'short-1',storagePath:path});
 const before=JSON.stringify(uploaded.workspace.slots.find(s=>s.id==='short-1'));
 const skipped=await h.act('generate',{slotId:'short-1',confirmPaid:true,missingOnly:true});
 assert.equal(skipped.ok,true);assert.equal(JSON.stringify(skipped.workspace.slots.find(s=>s.id==='short-1')),before);
 h.tables.song_media_assets.push({id:'own-cover',song_id:'song',user_id:'owner',media_kind:'cover-art',slot:1,storage_path:'own.png'});
 const artwork=JSON.stringify(h.tables.song_media_assets);
 assert.equal((await h.act('generate',{slotId:'cover',confirmPaid:true,missingOnly:true})).ok,true);
 assert.equal(JSON.stringify(h.tables.song_media_assets),artwork);assert.equal(h.paid,0);
});
test('batch stops on uncertainty, never retries and does not start additional requests after leaving',async()=>{
 const w={...batchModel.emptyWorkspace(),bible:'World',approvedBible:'World',scenePlan:{reviewed:true},slots:batchModel.makeSlots(30,'')};
 let calls=0;const progress=[];
 await assert.rejects(()=>runVisualBatch(w,w.slots,'generate',async(action,body,revision)=>{calls++;if(calls===2)throw Error('Lost response');const next=structuredClone(w);next.revision=revision+2;next.slots[0].candidates=[{id:'saved'}];return next;},n=>progress.push(n)),/Lost response/);
 assert.equal(calls,2);assert.deepEqual(progress,[0,1]);
 calls=0;await runVisualBatch(w,w.slots,'generate',async()=>{calls++;return w;},()=>{},()=>false);assert.equal(calls,0);
 const unapproved={...w,approvedBible:undefined};await assert.rejects(()=>runVisualBatch(unapproved,w.slots,'generate',async()=>{calls++;return w;},()=>{}),/Approve the current/);assert.equal(calls,0);
});

test('fresh setup → suggestion → reload → approval uses existing persistence and preserves approved directions',async()=>{
 const h=harness();let r=await h.act('setup',{duration:300});assert.equal(r.workspace.slots.length,18);assert.equal(r.workspace.bible,'');assert.equal(h.directionCalls,0);
 assert.equal((await h.act('direction',{bible:' ',approve:true})).ok,false);
 r=await h.act('propose-direction');assert.equal(r.ok,true,r.error);assert.equal(r.workspace.bible,'Suggested world');assert.equal(r.workspace.approvedBible,undefined);assert.equal(h.directionCalls,1);assert.equal(r.workspace.scenePlan.scenes.length,18);assert.equal(r.workspace.scenePlan.reviewed,false);assert.ok(r.workspace.slots.every(s=>s.prompt.length>20));
 assert.equal((await h.read()).workspace.bible,'Suggested world');
 r=await h.act('direction',{bible:r.workspace.bible,approve:true});assert.equal(r.ok,true);const saved=JSON.stringify(r.workspace);assert.equal(JSON.stringify((await h.read()).workspace),saved);assert.equal(h.directionCalls,1);assert.equal(h.paid,0);
 assert.equal(h.tables.ai_usage_events[0].channel_id,'bangla');assert.equal(h.tables.ai_usage_events[0].feature,'visual-direction');
});
test('blank suggestion is rejected without approval or automatic retry',async()=>{
 const h=harness({blankDirection:true});await h.act('setup',{duration:300});const r=await h.act('propose-direction');assert.equal(r.ok,false);assert.match(r.error,/incomplete/);assert.equal(h.directionCalls,1);const saved=(await h.read()).workspace;assert.equal(saved.bible,'');assert.equal(saved.approvedBible,undefined);assert.ok(saved.pending);
});

test('finished-song visual direction and image generation require no Suno Style record',async()=>{
 const h=harness();assert.equal(h.tables.suno_styles,undefined);
 let result=await h.act('setup',{duration:203.08,audioKey:'finished-master'});
 result=await h.act('propose-direction');assert.equal(result.ok,true,result.error);
 result=await h.act('direction',{bible:result.workspace.bible,approve:true});assert.equal(result.ok,true,result.error);
 result=await h.act('generate',{slotId:'scene-1',confirmPaid:true});assert.equal(result.ok,true,result.error);
 assert.equal(result.workspace.slots[0].candidates.length,1);assert.equal(h.tables.suno_styles,undefined);
 assert.equal(h.directionCalls,1);assert.equal(h.paid,1,'mock provider only');
});

test('image provider receives zero calls for missing/unreviewed/repeated/stale scene plans',async()=>{
 const h=harness({planOnApproval:false});await h.act('setup',{duration:240});await h.act('direction',{bible:'World',approve:true});
 assert.equal((await h.act('generate',{slotId:'scene-1',confirmPaid:true})).ok,false);assert.equal(h.paid,0);
 const slots=h.tables.song_creative_workspaces[0].workspace.slots,scenes=mockScenes(slots);
 assert.equal((await h.act('scene-plan',{scenes})).ok,true);assert.equal((await h.act('generate',{slotId:'scene-1',confirmPaid:true})).ok,false);assert.equal(h.paid,0);
 const repeated=structuredClone(scenes);repeated[1]={...repeated[0],slotId:repeated[1].slotId};assert.equal((await h.act('scene-plan',{scenes:repeated})).ok,false);assert.equal(h.paid,0);
 assert.equal((await h.act('approve-scene-plan')).ok,true);h.tables.songs[0].lyrics+=' Changed source';
 assert.equal((await h.act('generate',{slotId:'scene-1',confirmPaid:true})).ok,false);assert.equal(h.paid,0);
});
test('approving a legacy image applies active branding to a new immutable version without generation',async()=>{
 const h=harness({planOnApproval:false,activeChannel:sceneFixture.input.channel});await h.act('setup',{duration:240});
 const w=h.tables.song_creative_workspaces[0].workspace,slot=w.slots.find(s=>s.id==='scene-1'),original='owner/song/old-image.png';h.blobs.set(original,image);slot.candidates.push({id:'legacy',storagePath:original,prompt:'Existing scene',source:'uploaded',width:32,height:32});
 const approved=await h.act('approve-image',{slotId:'scene-1',candidateId:'legacy'});assert.equal(approved.ok,true,approved.error);const result=approved.workspace.slots.find(s=>s.id==='scene-1');assert.equal(result.candidates.length,2);assert.notEqual(result.approvedId,'legacy');assert.deepEqual(h.blobs.get(original),image);assert.equal(h.paid,0);
 const branded=result.candidates.at(-1);assert.equal(branded.visualProduction.branding.applied,true);assert.equal(branded.visualProduction.branding.text,sceneFixture.input.channel.channelName+'\n'+sceneFixture.input.channel.dna.sections.visual.fields.brandText);
 assert.equal((await h.act('approve-image',{slotId:'scene-1',candidateId:branded.id})).workspace.slots.find(s=>s.id==='scene-1').candidates.length,2,'approval retry does not duplicate branded images');
});
