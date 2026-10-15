import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {recordBufferReceipt} from '../local-worker/buffer-receipts.mjs';
function load(file,modules={}) {
 const source=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const ctx={exports:{},require:n=>{if(!(n in modules))throw Error(n);return modules[n]},Date,URL,process,console};vm.runInNewContext(source,ctx);return ctx.exports;
}
const {releaseState}=load('utils/release-state.ts');
const {canCleanBufferMedia}=load('utils/buffer-cleanup-policy.ts');
const channels=['ig','fb','tt'];
const youtube=['youtube-full',...Array.from({length:6},(_,i)=>`youtube-short-0${i+1}`)].map(itemKey=>({itemKey,videoId:itemKey}));
const drafts=channels.flatMap(channelId=>Array.from({length:6},(_,i)=>({channelId,slot:i+1,itemKey:`buffer-${channelId}-short-0${i+1}`,postId:`${channelId}-${i}`,status:'draft'})));
test('18 drafts are Prepared, never complete; schedules remain incomplete; all sent complete',()=>{
 const state=releaseState(youtube,drafts,channels);assert.equal(state.prepared,18);assert.equal(state.failed,0);assert.equal(state.complete,false);assert.equal(state.state,'prepared');
 const scheduled=drafts.map(r=>({...r,status:'scheduled'}));assert.equal(releaseState(youtube,scheduled,channels).state,'scheduled');assert.equal(releaseState(youtube,scheduled,channels).complete,false);
 const sent=drafts.map(r=>({...r,status:'sent'}));assert.equal(releaseState(youtube,sent,channels).complete,true);
 assert.equal(releaseState(youtube.slice(1),sent,channels).complete,false);
 assert.equal(releaseState(youtube,sent.slice(1),channels).complete,false);
 assert.equal(releaseState(youtube,[...sent.slice(1),{...sent[0],status:'error'}],channels).failed,1);
 assert.equal(releaseState(youtube,sent,channels,false).complete,false);
 assert.equal(releaseState(youtube.map(r=>({...r,scheduledAt:'2000-01-01'})),sent,channels).complete,false);
});
test('disconnecting a destination does not erase its release obligation',()=>{
 assert.equal(releaseState(youtube,[...drafts.filter(r=>r.channelId==='tt'),...drafts.filter(r=>r.channelId!=='tt').map(r=>({...r,status:'sent'}))],['ig','fb']).complete,false);
});
test('retry and refresh preserve immutable snapshots separately from canonical receipt',()=>{
 const failed={...drafts[0],postId:'old-failed',status:'error',errorMessage:'Original failure'};
 let state=recordBufferReceipt({},failed);const original=JSON.stringify(state.bufferAttemptHistory);
 state=recordBufferReceipt(state,drafts[0]);assert.equal(Object.keys(state.buffer).length,1);assert.equal(state.buffer[drafts[0].itemKey].status,'draft');
 assert.equal(Object.values(state.bufferAttemptHistory).filter(r=>r.status==='error').length,1);
 const old=Object.values(state.bufferAttemptHistory).find(r=>r.postId==='old-failed');assert.equal(old.errorMessage,'Original failure');
 const again=recordBufferReceipt(state,drafts[0]);assert.equal(Object.keys(again.bufferAttemptHistory).length,2);assert.ok(original.includes('Original failure'));
 assert.equal(releaseState(youtube,drafts,channels).failed,0);
});
function cleanupHarness({authenticated=true,owned=true,ledgerError=false,media,posts=[]}={}) {
 let removals=0,bufferReads=0,locks=0;
 const chain=(result)=>{const q={select(){return q},eq(){return q},single:async()=>result,maybeSingle:async()=>result,then:(ok,bad)=>Promise.resolve(result).then(ok,bad)};return q};
 const storage={from:()=>({remove:async()=>{removals++;return {error:null}}})};
 const client={auth:{getUser:async()=>({data:{user:authenticated?{id:'u'}:null},error:null})},from:()=>chain({data:owned?{id:'s'}:null}),storage};
 const admin={from:()=>({select:()=>chain({data:media,error:ledgerError?{message:'missing table'}:null}),update:(v)=>{if(v.state==='deleting')locks++;return chain({data:{storage_path:'u/s/buffer-temp/x'},error:null})}})};
 const route=load('app/api/publishing/buffer/cleanup/route.ts',{
  'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status||200})}},
  '@/utils/supabase/server':{createClient:async()=>client},'@/utils/supabase/admin':{createAdminClient:()=>admin},
  '@/utils/media-source':{MEDIA_BUCKET:'media',cleanString:v=>typeof v==='string'?v.trim():''},
  '@/utils/buffer-api':{assertBufferBudget(){},bufferGraphqlDetailed:async()=>{bufferReads++;return {data:Object.fromEntries(posts.map((p,i)=>['p'+i,p]))}}},
  '@/utils/buffer-oauth':{bufferAccessToken:async()=> 'test-only'},'@/utils/buffer-cleanup-policy':{canCleanBufferMedia},
 });return {run:(storagePath='u/s/buffer-temp/x')=>route.POST({json:async()=>({projectId:'s',storagePath})}),counts:()=>({removals,bufferReads,locks})};
}
const media={state:'submitted',buffer_account_id:'account',attempts:[{postId:'a',channelId:'ig'},{postId:'b',channelId:'fb'},{postId:'c',channelId:'tt'}]};
for(const status of ['draft','scheduled','sending','error','unknown'])test(`server refuses deletion if any dependency is ${status}`,async()=>{
 const h=cleanupHarness({media,posts:media.attempts.map((a,i)=>({id:a.postId,channelId:a.channelId,status:i===1?status:'sent'}))});assert.equal((await h.run()).status,409);assert.equal(h.counts().removals,0);
});
test('server protects legacy, missing ledger, uncertain, and omitted dependencies',async()=>{
 for(const options of [{},{ledgerError:true},{media:{...media,state:'submitting'}},{media:{...media,state:'uncertain'}},{media,posts:[]},{media:{...media,attempts:[]}}]) {const h=cleanupHarness(options);assert.equal((await h.run()).status,409);assert.equal(h.counts().removals,0)}
});
test('server retains ownership/path checks and allows deletion only after all verified sent',async()=>{
 for(const [options,path,status] of [[{authenticated:false},undefined,401],[{owned:false},undefined,404],[{},'other/s/buffer-temp/x',400],[{},'u/s/buffer-temp/../x',400]]){const h=cleanupHarness(options);assert.equal((await h.run(path)).status,status);assert.equal(h.counts().removals,0)}
 const h=cleanupHarness({media,posts:media.attempts.map(a=>({id:a.postId,channelId:a.channelId,status:'sent'}))});assert.equal((await h.run()).status,200);assert.equal(h.counts().removals,1);assert.equal(h.counts().locks,1);
});
test('scheduling cannot bypass ownership of the recorded media/post pair or a cleanup lock',async()=>{
 const saved=process.env.NEXT_PUBLIC_SUPABASE_URL;process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.test';
 try {
  for(const [state,postId,allowed] of [['submitted','p',true],['deleting','p',false],['submitted','other',false],['submitting','p',false]]) {
   let updates=[];
   const chain=result=>{const q={eq(){return q},select(){return q},maybeSingle:async()=>result,then:(ok,bad)=>Promise.resolve(result).then(ok,bad)};return q;};
   const admin={from:()=>({select:()=>chain({data:{state,attempts:[{postId:'p',channelId:'ig',slot:1}],buffer_account_id:'account'}}),update:v=>{updates.push(v.state);return chain({data:{storage_path:'u/s/buffer-temp/x'}})}})};
   const {claimBufferSchedule}=load('utils/buffer-media-ledger.ts',{'@/utils/supabase/admin':{createAdminClient:()=>admin},'@/utils/media-source':{MEDIA_BUCKET:'media'}});
   const operation=()=>claimBufferSchedule('u','s',[{postId,channelId:'ig',slot:1,mediaUrl:'https://example.test/storage/v1/object/sign/media/u/s/buffer-temp/x'}],'account');
   if(allowed){const release=await operation();assert.deepEqual(updates,['submitting']);await release();assert.deepEqual(updates,['submitting','submitted']);}
   else {await assert.rejects(operation);assert.equal(updates.length,0);}
  }
 } finally {if(saved===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=saved;}
});
