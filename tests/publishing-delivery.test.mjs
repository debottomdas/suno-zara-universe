import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
import vm from 'node:vm';
import ts from 'typescript';
function load(file,modules={},globals={}){const code=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const ctx={exports:{},require:n=>{if(!(n in modules))throw Error('Unexpected import '+n);return modules[n]},Date,Intl,Set,Map,Request,Response,URL,AbortSignal,process,console,Buffer,...globals};vm.runInNewContext(code,ctx);return ctx.exports;}
const m=load('utils/publishing/plan.ts');const executor=load('utils/publishing/execute.ts',{'./plan':m});
const assets=Array.from({length:7},(_,slot)=>({slot,key:slot?`short-${slot}`:'full',ready:true,version:'v'+slot}));
const destinations=['youtube','instagram','facebook','tiktok'].map(platform=>({id:platform,platform,name:platform,channelId:'bangla'}));
function harness(options={}){
 let snapshots=0;const calls=[],receipts=[],state={projectId:'p',channelId:'bangla',userId:'u',revision:'rev',ready:options.ready!==false,reasons:['Short 1 changed'],assets,destinations,canonicalReceipts:options.receipts||[],social:options.social||{}};
 const plan={projectId:'p',channelId:'bangla',revision:'rev',timezone:'Europe/London',rows:m.deriveRows(assets,destinations,'bangla','Europe/London',new Date(Date.now()+86400000).toISOString())};
 const handler=name=>({POST:async req=>{const body=await req.json();calls.push({name,body});if(name==='schedule')return Response.json({publishAt:options.wrongYoutubeTime?new Date(Date.parse(body.publishAt)+60000).toISOString():body.publishAt});if(name==='post-status')return Response.json({posts:body.postIds.map(id=>({id,status:options.providerStatus||'error'}))});if(name==='stage-session')return Response.json({upload:{signedUploadUrl:'https://fixture.invalid',storagePath:'fixture'}});if(name==='stage-complete')return Response.json({mediaUrl:'https://fixture.invalid/media'});if(name==='direct-session'&&body.preflightOnly===true)return Response.json({preflightVerified:true,channelId:'UCfixture'});if(name==='direct-session'&&options.youtubeFailure)return Response.json({error:'Fixture upload rejected',retrySafe:options.youtubeFailure==='safe'},{status:500});if(name==='direct-session')return Response.json({uploadUrl:'https://fixture.invalid/youtube',transientAccessToken:'fake',title:'Test'});if(name.includes('batch'))return Response.json({results:body.items.map(item=>({...item,post:options.partialFailure&&item.channelId==='instagram'?null:{id:item.channelId+item.slot,status:options.bufferStatus===undefined?'scheduled':options.bufferStatus,dueAt:options.wrongTime?new Date(Date.parse(item.dueAt)+60000).toISOString():item.dueAt}}))});return Response.json({ok:true});}});
 const mods={'next/server':{NextResponse:Response},'node:fs/promises':{mkdir:async()=>{},rmdir:async()=>{}},'node:os':{tmpdir:()=>'/fixture'},'node:path':{join:(...x)=>x.join('/')},'node:crypto':{createHash:()=>({update:()=>({digest:()=> 'lock'})})},'@/utils/publishing/plan':m,'@/utils/publishing/execute':executor,'@/utils/publishing/snapshot':{snapshot:async()=>{snapshots++;return {...structuredClone(state),...(options.changedAfterLock&&snapshots>1?{revision:'new'}:{})}},worker:async(path,body)=>{calls.push({name:path,body});if(path.includes('/receipt')){receipts.push(body.receipt);if(options.social){const i=state.canonicalReceipts.findIndex(r=>r.itemKey===body.receipt.itemKey);if(i<0)state.canonicalReceipts.push(body.receipt);else state.canonicalReceipts[i]=body.receipt;}return {ok:true}}if(path.includes('file-info'))return {sizeBytes:100,mimeType:'video/mp4',filename:'fixture.mp4'};if(path==='/publish/youtube')return {videoId:options.social?'abcdefghijk':'fixture',itemKey:body.kind==='full'?'youtube-full':`youtube-short-0${body.slot}`};return {ok:true}}}};
 for(const name of ['direct-session','direct-complete','schedule'])mods[`@/app/api/publishing/youtube/${name}/route`]=handler(name);
 for(const name of ['stage-session','stage-complete','create-posts-batch','schedule-posts-batch','post-status'])mods[`@/app/api/publishing/buffer/${name}/route`]=handler(name);
 mods['@/app/api/publishing/buffer/status/route']={GET:async req=>{
  calls.push({name:'buffer-status',url:req.url});
  const channels=destinations.filter(d=>d.platform!=='youtube').map(d=>({id:d.id,service:d.platform,name:d.name,bufferAccountId:d.accountId||null}));
  return Response.json({channels,source:'reconciliation'});
 }};
 const route=load('app/api/publishing/plan/approve/route.ts',mods);return {calls,receipts,plan,run:(approved,resumeCampaign=false)=>route.POST(new Request('http://fixture',{method:'POST',body:JSON.stringify({plan,approved,resumeCampaign})}))};
}
test('approval endpoint makes zero provider or receipt writes without explicit approval',async()=>{const h=harness();assert.equal((await h.run(false)).status,409);assert.equal(h.calls.length,0)});
test('approval endpoint blocks invalidated assets and historical receipts before all mutations',async()=>{for(const options of [{ready:false},{receipts:[{itemKey:'youtube-full',videoId:'legacy',status:'published'}]}]){const h=harness(options);assert.equal((await h.run(true)).status,409);const mutations=h.calls.filter(c=>!['buffer-status','direct-session'].includes(c.name)&&!String(c.name).startsWith('/publishing/file-info?'));assert.equal(mutations.length,0)}});
test('25 approved posts reuse YouTube adapter and one Buffer staging claim per Short',async()=>{const h=harness();const response=await h.run(true);assert.equal(response.status,200);assert.equal((await response.json()).scheduled,25);assert.equal(h.calls.filter(c=>c.name==='direct-session'&&!c.body.preflightOnly).length,7);assert.ok(h.calls.filter(c=>c.name==='direct-session'&&!c.body.preflightOnly).every(c=>c.body.privacyStatus==='private'&&c.body.publishAt.endsWith('Z')));const batches=h.calls.filter(c=>c.name==='create-posts-batch');assert.equal(batches.length,6);assert.ok(batches.every(c=>c.body.items.length===3&&c.body.items.every(i=>i.publishMode==='schedule'&&i.dueAt.endsWith('Z'))));assert.equal(h.calls.filter(c=>c.name==='stage-session').length,6);assert.equal(h.receipts.filter(r=>r.status==='scheduled').length,25)});

test('YouTube failure before an upload session rolls the receipt back to draft',async()=>{
 const h=harness({youtubeFailure:'safe'});
 h.plan.rows=h.plan.rows.filter(r=>r.key==='youtube:full');
 const response=await h.run(true);
 assert.equal(response.status,409);
 assert.equal(h.calls.filter(c=>c.name==='direct-session'&&!c.body.preflightOnly).length,1);
 const full=h.receipts.filter(r=>r.itemKey==='youtube-full');
 assert.equal(full[0]?.status,'submitting');
 assert.equal(full.at(-1)?.status,'draft');
 assert.equal(h.calls.filter(c=>c.name==='/publish/youtube').length,0);
});

test('ambiguous YouTube session failure remains submitting for reconciliation',async()=>{
 const h=harness({youtubeFailure:'uncertain'});
 h.plan.rows=h.plan.rows.filter(r=>r.key==='youtube:full');
 const response=await h.run(true);
 assert.equal(response.status,409);
 const full=h.receipts.filter(r=>r.itemKey==='youtube-full');
 assert.equal(full.length,1);
 assert.equal(full[0]?.status,'submitting');
 assert.equal(h.calls.filter(c=>c.name==='/publish/youtube').length,0);
});

test('state is revalidated after acquiring the delivery lock',async()=>{const h=harness({changedAfterLock:true});assert.equal((await h.run(true)).status,409);assert.equal(h.calls.length,0)});
test('retry rechecks provider failure before allowing a replacement',async()=>{const old={itemKey:'buffer-instagram-short-01',slot:1,assetVersion:'v1',status:'error',postId:'failed',providerCheckedAt:'2026-09-28'};const blocked=harness({receipts:[old],providerStatus:'sent'});assert.equal((await blocked.run(true)).status,409);assert.deepEqual(blocked.calls.filter(c=>!['buffer-status','direct-session'].includes(c.name)&&!String(c.name).startsWith('/publishing/file-info?')).map(c=>c.name),['post-status']);const allowed=harness({receipts:[old]});assert.equal((await allowed.run(true)).status,200);assert.equal(allowed.calls.filter(c=>c.name==='create-posts-batch').length,6);});

test('the existing YouTube upload API sends publishAt together with private state',async()=>{
 let uploadedBody;
 const chain=result=>{const q={select:()=>q,eq:()=>q,filter:()=>q,order:()=>q,limit:()=>q,single:async()=>({data:result}),maybeSingle:async()=>({data:result})};return q};
 const db={auth:{getUser:async()=>({data:{user:{id:'u'}}})},from:t=>chain(t==='songs'?{id:'p',title:'Test',channel_id:'bangla'}:{youtube_full:{recommendedTitle:'Test',finalDescription:'Caption',categoryId:'10',defaultLanguage:'hi',playlistIds:['PL1234567890']}})};
 const admin={from:t=>chain(t==='publishing_connections'?{id:'youtube',scopes:[],external_account_id:'UCfixture'}:{access_token:'fixture',expires_at:new Date(Date.now()+3600000).toISOString()})};
 const route=load('app/api/publishing/youtube/direct-session/route.ts',{'next/server':{NextResponse:Response},'@/utils/supabase/server':{createClient:async()=>db},'@/utils/supabase/admin':{createAdminClient:()=>admin}},{fetch:async(url,options={})=>{if(String(url).includes('/youtube/v3/channels'))return Response.json({items:[{id:'UCfixture'}]});uploadedBody=JSON.parse(options.body);return new Response('',{status:200,headers:{location:'https://fixture.invalid/resumable'}})}});
 const publishAt=new Date(Date.now()+86400000).toISOString();const response=await route.POST(new Request('http://fixture',{method:'POST',body:JSON.stringify({projectId:'p',kind:'full',sizeBytes:100,privacyStatus:'public',publishAt})}));assert.equal(response.status,200);assert.equal(uploadedBody.status.privacyStatus,'private');assert.equal(uploadedBody.status.publishAt,publishAt);assert.equal(uploadedBody.snippet.defaultLanguage,'hi');assert.equal(uploadedBody.snippet.categoryId,'10');assert.equal((await response.json()).playlistPreparation.automaticallyApplied,false);
});

test('a partial Buffer failure preserves prior YouTube and successful sibling receipts, stops remaining batches',async()=>{const h=harness({partialFailure:true});const response=await h.run(true);assert.equal(response.status,409);assert.equal(h.calls.filter(c=>c.name==='direct-session'&&!c.body.preflightOnly).length,7);assert.equal(h.calls.filter(c=>c.name==='create-posts-batch').length,1);assert.equal(h.receipts.filter(r=>r.status==='scheduled').length,9);assert.equal(h.receipts.filter(r=>r.itemKey==='buffer-instagram-short-01').at(-1).status,'submitting');});

for(const target of ['youtube:full','youtube:short-1','instagram:short-1','facebook:short-1','tiktok:short-1'])test(`one edited ${target} survives serialization and reaches its adapter and receipt exactly`,async()=>{
 const h=harness(),before=structuredClone(h.plan.rows),row=h.plan.rows.find(r=>r.key===target);
 row.localTime=m.localDateTime(new Date(Date.now()+3*86400000+37*60000).toISOString(),h.plan.timezone);
 h.plan.rows=JSON.parse(JSON.stringify(h.plan.rows));const expected=m.toProviderTime(row.localTime,h.plan.timezone);
 assert.equal((await h.run(true)).status,200);
 for(const original of before){if(original.key!==target)assert.equal(h.plan.rows.find(r=>r.key===original.key).localTime,original.localTime)}
 const platform=target.split(':')[0],slot=target.endsWith('full')?0:1;
 const payload=platform==='youtube'?h.calls.find(c=>c.name==='direct-session'&&c.body.kind===(slot?'short':'full')&&c.body.slot===(slot||1)).body:h.calls.filter(c=>c.name==='create-posts-batch').flatMap(c=>c.body.items).find(i=>i.channelId===platform&&i.slot===slot);
 assert.equal(payload[platform==='youtube'?'publishAt':'dueAt'],expected);
 const key=platform==='youtube'?(slot?'youtube-short-01':'youtube-full'):`buffer-${platform}-short-01`;
 const receipt=h.receipts.filter(r=>r.itemKey===key).at(-1);assert.equal(receipt.dueAt,expected);assert.equal(receipt.localTime,row.localTime);assert.equal(receipt.timezone,'Europe/London');
});
for(const options of [{bufferStatus:null},{bufferStatus:'draft'},{bufferStatus:'error'},{wrongTime:true}])test(`Buffer requires exact confirmed schedule: ${JSON.stringify(options)}`,async()=>{const h=harness(options);assert.equal((await h.run(true)).status,409);for(const r of h.receipts.filter(r=>r.service!=='youtube'))assert.notEqual(m.receiptStatus(r),'Scheduled');assert.equal(h.calls.filter(c=>c.name==='create-posts-batch').length,1)});
test('stale schedule timestamps never imply success for drafts or interrupted/failed attempts',()=>{for(const status of ['draft','submitting','sending','private','unknown'])assert.equal(m.receiptStatus({status,scheduledAt:'2026-10-02T18:00:00Z'}),'Needs Attention');assert.equal(m.receiptStatus({status:'error',scheduledAt:'2026-10-02T18:00:00Z'}),'Failed');assert.equal(m.receiptStatus({status:'published',scheduledAt:'2026-10-02T18:00:00Z'}),'Published')});

for(const operation of ['create-posts-batch','schedule-posts-batch'])test(`Buffer ${operation} sends every destination's exact instant to GraphQL`,async()=>{
 const captured=[],services=['instagram','facebook','tiktok'];
 const db={auth:{getUser:async()=>({data:{user:{id:'u'}}})},from:table=>{const data=table==='songs'?{id:'p',channel_id:'bangla'}:table==='buffer_channel_bindings'?services.map(s=>({buffer_channel_id:s,buffer_account_id:'account'})):{};const q={select:()=>q,eq:()=>q,in:()=>q,single:async()=>({data}),maybeSingle:async()=>({data}),then:resolve=>Promise.resolve({data}).then(resolve)};return q}};
 const route=load(`app/api/publishing/buffer/${operation}/route.ts`,{'next/server':{NextResponse:Response},'@/utils/supabase/server':{createClient:async()=>db},'@/utils/media-source':{cleanString:v=>typeof v==='string'?v.trim():''},'@/utils/buffer-oauth':{bufferAccessToken:async()=> 'fixture'},'@/utils/buffer-media-ledger':{claimBufferMedia:async()=>{},recordBufferMedia:async()=>{},claimBufferSchedule:async()=>async()=>{}},'@/utils/buffer-api':{assertBufferBudget:()=>{},getBufferRateLimit:()=>({}),bufferGraphqlDetailed:async(query,variables)=>{captured.push({query,variables});return {data:Object.fromEntries(Object.entries(variables).map(([k,v],i)=>['p'+i,{post:{id:v.id||'post'+i,status:'scheduled',dueAt:v.dueAt}}]))}}}});
 const items=services.map((service,i)=>({slot:1,channelId:service,service,postId:'existing-'+service,itemKey:`buffer-${service}-short-01`,mediaUrl:'https://fixture.invalid/approved-edit.mp4',publishMode:'schedule',dueAt:m.toProviderTime(m.localDateTime(new Date(Date.now()+(i+1)*86400000).toISOString(),'Europe/London'),'Europe/London')}));
 const response=await route.POST(new Request('http://fixture',{method:'POST',body:JSON.stringify({projectId:'p',items})}));assert.equal(response.status,200);assert.equal(captured.length,1);
 items.forEach((item,i)=>{const input=captured[0].variables['input'+i];assert.equal(input.dueAt,item.dueAt);assert.equal(input.mode,'customScheduled');assert.equal(input.saveToDraft,false);assert.equal(input.assets[0].video.url,item.mediaUrl);if(operation==='schedule-posts-batch')assert.equal(input.id,item.postId);else assert.equal(input.channelId,item.channelId)});
});

test('campaign resume never reschedules an already confirmed YouTube delivery',async()=>{const h=harness({receipts:[{itemKey:'youtube-full',assetVersion:'v0',videoId:'existing',status:'scheduled',scheduledAt:'2026-10-01T12:00:00Z'}]});h.plan.rows=h.plan.rows.filter(r=>r.key==='youtube:full');const response=await h.run(true,true);assert.equal(response.status,200);const body=await response.json();assert.equal(body.skipped,1);assert.equal(body.scheduled,0);assert.equal(h.calls.filter(c=>c.name==='schedule'||c.name==='direct-session'&&!c.body.preflightOnly).length,0);assert.equal(h.receipts.length,0)});

test('provider monitoring keeps the canonical instant and local display synchronized',async()=>{
 const receipts=[{platform:'youtube',itemKey:'youtube-full',videoId:'yt',timezone:'Europe/London',dueAt:'2026-10-01T10:00:00Z',localTime:'2026-10-01T11:00'},{platform:'instagram',itemKey:'buffer-ig-short-01',postId:'ig',timezone:'Europe/London',dueAt:'2026-10-01T10:00:00Z',localTime:'2026-10-01T11:00'}],saved=[];
 const route=load('app/api/publishing/plan/monitor/route.ts',{'next/server':{NextResponse:Response},'node:fs/promises':{mkdir:async()=>{},rmdir:async()=>{}},'node:os':{tmpdir:()=>'/fixture'},'node:path':{join:(...a)=>a.join('/')},'node:crypto':{createHash:()=>({update:()=>({digest:()=> 'fixture'})})},'@/utils/publishing/plan':m,'@/utils/publishing/snapshot':{snapshot:async()=>({userId:'u',projectId:'p',receipts}),worker:async(path,body)=>saved.push(body.receipt)},'@/app/api/publishing/youtube/schedule/route':{GET:async()=>Response.json({videos:[{videoId:'yt',status:'scheduled',scheduledAt:'2026-10-25T18:00:00.000Z'}]})},'@/app/api/publishing/buffer/post-status/route':{POST:async()=>Response.json({posts:[{id:'ig',status:'scheduled',dueAt:'2026-10-24T17:00:00.000Z'}]})}});
 assert.equal((await route.POST(new Request('http://fixture',{method:'POST',body:JSON.stringify({projectId:'p',channelId:'c'})}))).status,200);
 assert.equal(saved[0].dueAt,saved[0].scheduledAt);assert.equal(saved[0].localTime,'2026-10-25T18:00');assert.equal(saved[1].localTime,'2026-10-24T18:00');
});

test('failed YouTube pre-session scheduling rolls back safely and never starts sibling uploads',async()=>{const h=harness({youtubeFailure:'safe'});assert.equal((await h.run(true)).status,409);assert.equal(h.receipts.length,2);assert.equal(h.receipts[0].status,'submitting');assert.equal(h.receipts.at(-1).status,'draft');assert.equal(m.receiptStatus(h.receipts.at(-1)),'Needs Attention');assert.equal(h.calls.filter(c=>c.name==='/publish/youtube'||c.name==='create-posts-batch').length,0)});

test('dependent Shorts store the obtained own-song long-video ID without pretending Studio linking occurred',async()=>{const social={youtube_shorts:{shorts:Array.from({length:6},(_,i)=>({shortNumber:i+1,relatedVideo:{songId:'p',channelId:'bangla',assetKey:'full',dependency:'publish-long-video-first',method:'youtube-studio',youtubeVideoId:null}}))}};const h=harness({social});h.plan.rows.reverse();const response=await h.run(true);assert.equal(response.status,200);assert.equal(h.calls.find(c=>c.name==='direct-session'&&!c.body.preflightOnly).body.kind,'full');const shorts=h.receipts.filter(r=>r.platform==='youtube'&&r.kind==='short'&&r.status==='scheduled');assert.equal(shorts.length,6);assert.ok(shorts.every(r=>r.relatedVideo.youtubeVideoId==='abcdefghijk'&&r.relatedVideo.status==='needs-studio-link-after-long-is-public-or-unlisted'));});


test('uncertain delivery stays blocked until that exact receipt is explicitly reconciled for retry',()=>{
 const row={asset:{slot:0,label:'Full video',version:'v0'},destination:{id:'youtube',platform:'youtube'}};
 const state={canonicalReceipts:[{itemKey:'youtube-full',assetVersion:'v0',status:'submitting'}]};
 assert.throws(()=>executor.assertDeliveryHistory([row],state),/needs reconciliation/);
 state.canonicalReceipts[0].reconciliation={state:'retry_allowed',resolvedAt:'2026-10-07T12:00:00.000Z'};
 assert.doesNotThrow(()=>executor.assertDeliveryHistory([row],state));
});

test('retry reconciliation never clears another asset version or a delivered resolution',()=>{
 const row={asset:{slot:0,label:'Full video',version:'v2'},destination:{id:'youtube',platform:'youtube'}};
 for(const receipt of [
  {itemKey:'youtube-full',assetVersion:'v1',status:'submitting',reconciliation:{state:'retry_allowed',resolvedAt:'2026-10-07T12:00:00.000Z'}},
  {itemKey:'youtube-full',assetVersion:'v2',status:'submitting',reconciliation:{state:'delivered',resolvedAt:'2026-10-07T12:00:00.000Z'}},
 ]) assert.throws(()=>executor.assertDeliveryHistory([row],{canonicalReceipts:[receipt]}),/needs reconciliation/);
});


test('YouTube worker handoff carries immutable receipt identity before the upload response returns',()=>{
 const approve=fs.readFileSync(path.join(root,'app/api/publishing/plan/approve/route.ts'),'utf8');
 const worker=fs.readFileSync(path.join(root,'local-worker/full-video-worker.mjs'),'utf8');
 assert.match(approve,/assetVersion:row\.asset\.version,channelId:row\.destination\.id,channelName:row\.destination\.name/);
 assert.match(worker,/assetVersion: String\(body\.assetVersion \|\| ""\)\.trim\(\) \|\| undefined/);
 assert.match(worker,/channelId: String\(body\.channelId \|\| ""\)\.trim\(\) \|\| undefined/);
});


test('legacy YouTube recovery is fail-closed and requires exact current approved filename identity',()=>{
 const source=fs.readFileSync(path.join(root,'utils/publishing/snapshot.ts'),'utf8');
 assert.match(source,/legacyIdentityMissing=!r\.assetVersion&&!r\.channelId&&r\.videoId&&\['scheduled','published'\]\.includes\(r\.status\)/);
 assert.match(source,/exactFileMatch=Boolean\(asset\?\.ready&&asset\?\.version&&asset\?\.approvedFilename&&r\.filename&&asset\.approvedFilename===r\.filename\)/);
 assert.match(source,/legacyIdentityMissing&&exactFileMatch&&youtubeDestination/);
});


test('publishing assets retain approved filename separately from immutable version id',()=>{
 const source=fs.readFileSync(path.join(root,'utils/publishing/plan.ts'),'utf8');
 assert.match(source,/approvedFilename\?:string/);
 assert.match(source,/approvedFilename:item\?\.approvedVideo\?\.filename\|\|undefined/);
});


test('legacy YouTube recovery cannot become current until provider verification succeeds',()=>{
 const source=fs.readFileSync(path.join(root,'utils/publishing/snapshot.ts'),'utf8');
 assert.match(source,/legacyIdentityRecovered&&!r\.providerCheckedAt/);
 assert.match(source,/verifiedCurrentReceipts=currentReceipts\.filter/);
 assert.match(source,/canonicalReceipts:verifiedCurrentReceipts/);
});


test('campaign resume reconciles uncertain receipts and sends only remaining work',async()=>{
 const prior=[
  ...Array.from({length:7},(_,slot)=>({itemKey:slot?`youtube-short-${String(slot).padStart(2,'0')}`:'youtube-full',slot,kind:slot?'short':'full',assetVersion:'v'+slot,status:'scheduled',videoId:'abcdefghijk'})),
  {itemKey:'buffer-facebook-short-01',slot:1,assetVersion:'v1',status:'scheduled',postId:'fb1'},
  {itemKey:'buffer-instagram-short-01',slot:1,assetVersion:'v1',status:'submitting',postId:'ig1'},
  {itemKey:'buffer-tiktok-short-01',slot:1,assetVersion:'v1',status:'submitting',postId:'tt1'},
 ];
 // Unknown provider truth must remain unresolved; it is never retry permission.
 const h=harness({receipts:prior,providerStatus:'unknown'});
 const response=await h.run(true,true);
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.scheduled,15);
 assert.equal(body.skipped,8);
 assert.equal(body.unresolved,2);
 assert.equal(h.calls.filter(c=>c.name==='direct-session'||c.name==='schedule').length,0);
 assert.equal(h.calls.filter(c=>c.name==='create-posts-batch').length,5);
 assert.equal(h.calls.filter(c=>c.name==='create-posts-batch').flatMap(c=>c.body.items).length,15);
 assert.equal(h.receipts.some(r=>r.itemKey==='buffer-instagram-short-01'||r.itemKey==='buffer-tiktok-short-01'),false);
});

test('resume classifier never treats an uncertain same-asset receipt as retry permission',()=>{
 const rows=[
  {asset:{slot:1,label:'Short 1',version:'v1'},destination:{id:'instagram',platform:'instagram'}},
  {asset:{slot:2,label:'Short 2',version:'v2'},destination:{id:'instagram',platform:'instagram'}},
 ];
 const state={canonicalReceipts:[{itemKey:'buffer-instagram-short-01',assetVersion:'v1',status:'submitting',postId:'ig1'}]};
 const resume=executor.resumeDeliveryRows(rows,state);
 assert.equal(resume.unresolved.length,1);
 assert.equal(resume.actionable.length,1);
 assert.equal(resume.actionable[0].asset.slot,2);
});

test('resume restores provider-confirmed uncertain Buffer posts and never duplicates them',async()=>{
 const prior=[
  ...Array.from({length:7},(_,slot)=>({itemKey:slot?`youtube-short-${String(slot).padStart(2,'0')}`:'youtube-full',slot,kind:slot?'short':'full',assetVersion:'v'+slot,status:'scheduled',videoId:'abcdefghijk'})),
  {itemKey:'buffer-facebook-short-01',slot:1,assetVersion:'v1',status:'scheduled',postId:'fb1'},
  {itemKey:'buffer-instagram-short-01',slot:1,assetVersion:'v1',status:'submitting',postId:'ig1'},
  {itemKey:'buffer-tiktok-short-01',slot:1,assetVersion:'v1',status:'submitting',postId:'tt1'},
 ];
 const h=harness({receipts:prior,providerStatus:'scheduled'});
 const response=await h.run(true,true);assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.scheduled,15);assert.equal(body.skipped,10);assert.equal(body.unresolved,0);
 assert.equal(h.calls.filter(x=>x.name==='post-status').length,2);
 assert.equal(h.calls.filter(x=>x.name==='direct-session'&&!x.body.preflightOnly).length,0);
 assert.equal(h.calls.filter(x=>x.name==='create-posts-batch').flatMap(x=>x.body.items).length,15);
 assert.ok(h.receipts.filter(r=>['buffer-instagram-short-01','buffer-tiktok-short-01'].includes(r.itemKey)).every(r=>r.status==='scheduled'&&r.reconciliation?.state==='delivered'));
});

test('resume allows exact Buffer retry only after provider explicitly confirms failure',async()=>{
 const prior=[{itemKey:'buffer-instagram-short-01',slot:1,assetVersion:'v1',status:'submitting',postId:'ig1'}];
 const h=harness({receipts:prior,providerStatus:'error'});
 h.plan.rows=h.plan.rows.filter(r=>r.key==='instagram:short-1');
 const response=await h.run(true,true);assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.unresolved,0);
 assert.equal(h.calls.filter(x=>x.name==='post-status').length,2);
 assert.equal(h.calls.filter(x=>x.name==='schedule-posts-batch').length,1);
 assert.equal(h.calls.filter(x=>x.name==='create-posts-batch').length,0);
 assert.equal(h.calls.find(x=>x.name==='schedule-posts-batch').body.items[0].postId,'ig1');
});

test('provider-confirmed resume never invokes YouTube again for already confirmed Akele-shaped rows',async()=>{
 const prior=Array.from({length:7},(_,slot)=>({itemKey:slot?`youtube-short-${String(slot).padStart(2,'0')}`:'youtube-full',slot,kind:slot?'short':'full',assetVersion:'v'+slot,status:'scheduled',videoId:'abcdefghijk'}));
 const h=harness({receipts:prior});const response=await h.run(true,true);assert.equal(response.status,200);
 assert.equal(h.calls.filter(x=>['direct-session','schedule','/publish/youtube'].includes(x.name)).length,0);
});
