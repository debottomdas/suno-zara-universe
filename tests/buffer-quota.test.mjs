import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
const source = file => ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function apiHarness(respond) {
 let now=Date.parse('2026-09-29T12:00:00Z');const calls=[];
 class Clock extends Date {constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const ctx={exports:{},require:n=>{assert.equal(n,'node:crypto');return crypto},Date:Clock,Headers,process:{env:{BUFFER_API_KEY:'legacy-fixture',BUFFER_CLIENT_ID:'oauth-fixture'}},fetch:async(url,init)=>{const body=JSON.parse(init.body);calls.push({token:init.headers.authorization,...body});return respond?respond(body,calls.length):Response.json({data:body.query.includes('BufferOrganizations')?{account:{organizations:[{id:'org',name:'Org'}]}}:{channels:[{id:init.headers.authorization,name:'Fixture',service:'instagram'}]}})}};
 vm.runInNewContext(source('utils/buffer-api.ts'),ctx);return {api:ctx.exports,calls,advance:ms=>{now+=ms}};
}
test('20 simultaneous OAuth discoveries collapse to 2 calls, cached for 10 minutes; forced refresh has a 30s guard',async()=>{
 const h=apiHarness();const batches=await Promise.all(Array.from({length:20},()=>h.api.loadBufferChannels({accessToken:'account-a'})));assert.equal(h.calls.length,2);assert.ok(batches.every(b=>b[0].id==='Bearer account-a'));
 await h.api.loadBufferChannels({accessToken:'account-a',force:true});assert.equal(h.calls.length,2);
 h.advance(31_000);await h.api.loadBufferChannels({accessToken:'account-a'});assert.equal(h.calls.length,2);
 await h.api.loadBufferChannels({accessToken:'account-a',force:true});assert.equal(h.calls.length,4);
 h.advance(601_000);await h.api.loadBufferChannels({accessToken:'account-a'});assert.equal(h.calls.length,6);
});
test('destination caches cannot cross OAuth accounts, legacy keys, or credential rotation, even with the same caller cacheKey',async()=>{
 const h=apiHarness();for(const token of ['a','b',undefined,'rotated-a']){const rows=await h.api.loadBufferChannels({accessToken:token,cacheKey:'shared'});assert.equal(rows[0].id,'Bearer '+(token||'legacy-fixture'))}assert.equal(h.calls.length,8);
});
test('failed discovery is not cached as an empty or successful connection',async()=>{
 let fail=true;const h=apiHarness(body=>fail?new Response('failure',{status:503}):Response.json({data:body.query.includes('BufferOrganizations')?{account:{organizations:[]}}:{channels:[]}}));await assert.rejects(h.api.loadBufferChannels({accessToken:'a'}));fail=false;assert.equal((await h.api.loadBufferChannels({accessToken:'a'})).length,0);assert.equal(h.calls.length,2);
});
test('low-quota windows age independently; missing policy still suppresses reads, then reset permits a fresh probe',async()=>{
 const h=apiHarness(()=>Response.json({data:{ok:true}},{headers:{RateLimit:'"short"; r=2; t=10, "long"; r=50; t=100','RateLimit-Policy':'"short"; q=100; w=900, "long"; q=1000; w=86400'}}));await h.api.bufferGraphql('query X',{},'a');await assert.rejects(h.api.loadBufferChannels({accessToken:'a'}),/quota/);h.advance(11_000);assert.equal(h.api.getBufferRateLimit('a').windows.length,1);assert.throws(()=>h.api.assertBufferBudget('a'));h.advance(90_000);assert.doesNotThrow(()=>h.api.assertBufferBudget('a'));
 const unknown=apiHarness(()=>Response.json({data:{ok:true}},{headers:{RateLimit:'"unknown"; r=1; t=30'}}));await unknown.api.bufferGraphql('query X');assert.throws(()=>unknown.api.assertBufferBudget(),/quota/);
});
for(const retry of ['120','Tue, 29 Sep 2026 12:02:00 GMT',null])test(`429 ${retry||'reset fallback'} blocks queued calls until deadline without retrying`,async()=>{
 const headers=retry?{'Retry-After':retry}:{RateLimit:'"short"; r=0; t=120'};
 const h=apiHarness((_body,n)=>n===1?new Response('{}',{status:429,headers}):Response.json({data:{ok:true}}));
 const results=await Promise.allSettled(Array.from({length:8},()=>h.api.bufferGraphql('query X',{},'a')));assert.ok(results.every(r=>r.status==='rejected'));assert.equal(h.calls.length,1);assert.equal(results[0].reason.retryAfter,120);
 h.advance(119_000);await assert.rejects(h.api.bufferGraphql('mutation X',{},'a'));assert.equal(h.calls.length,1);h.advance(2000);await h.api.bufferGraphql('query X',{},'a');assert.equal(h.calls.length,2);
});
test('OAuth app budget is shared across accounts but separate from legacy API-key budget',async()=>{
 const h=apiHarness((_b,n)=>n===1?new Response('{}',{status:429,headers:{'Retry-After':'60'}}):Response.json({data:{ok:true}}));await assert.rejects(h.api.bufferGraphql('query X',{},'a'));await assert.rejects(h.api.bufferGraphql('query X',{},'b'));await h.api.bufferGraphql('query X');assert.equal(h.calls.length,2);
});
function statusHarness({live,fail=false,accountStatus='connected',owned=true}={}) {
 let tokens=0,reads=0,writes=0;const binding={buffer_channel_id:'ig-a',buffer_account_id:'a',service:'instagram',display_name:'Saved IG',metadata:{keep:'yes'}};
 const db={auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:table=>{const filters=[];let update;const result=()=>{if(update){assert.equal(table,'buffer_channel_bindings');assert.ok(filters.some(([k,v])=>k==='user_id'&&v==='user'));assert.ok(filters.some(([k,v])=>k==='channel_id'&&v==='channel'));Object.assign(binding,update);writes++;return {error:null}}return {data:table==='channels'?(owned?{id:'channel',workspace_id:'workspace'}:null):table==='buffer_accounts'?[{id:'a',status:accountStatus}]:[binding]}};const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q},update:v=>{update=v;return q},maybeSingle:async()=>result(),then:(ok,bad)=>Promise.resolve(result()).then(ok,bad)};return q}};
 const ctx={exports:{},Request,Response,URL,process:{env:{}},console,require:n=>({'next/server':{NextResponse:Response},'@/utils/supabase/server':{createClient:async()=>db},'@/utils/buffer-api':{bufferConfigured:()=>false,getBufferRateLimit:()=>null,loadBufferChannels:async()=>{reads++;if(fail)throw Error('Buffer rate limited');return live||[{id:'ig-a',name:'Live IG',service:'instagram'},{id:'other-channel',name:'Other',service:'instagram'}]}},'@/utils/buffer-oauth':{bufferAccessToken:async()=>{tokens++;return 'token'}}}[n])};vm.runInNewContext(source('app/api/publishing/buffer/status/route.ts'),ctx);
 return {run:async(refresh=false)=>{const response=await ctx.exports.GET(new Request('http://fixture?channelId=channel'+(refresh?'&refresh=1':'')));return {status:response.status,...await response.json()}},counts:()=>({tokens,reads,writes}),binding};
}
test('ordinary Publishing fan-out of 20 snapshots uses persisted channels: zero Buffer and token calls, zero writes',async()=>{
 const h=statusHarness();const results=await Promise.all(Array.from({length:20},()=>h.run()));assert.ok(results.every(r=>r.channels[0].id==='ig-a'&&r.source==='saved'));assert.deepEqual(h.counts(),{tokens:0,reads:0,writes:0});
});
test('manual reconciliation only updates owned bindings; missing remote destination is retained, marked unavailable',async()=>{
 const h=statusHarness({live:[]});const result=await h.run(true);assert.equal(result.channels.length,0);assert.equal(result.knownChannels[0].id,'ig-a');assert.equal(h.binding.metadata.keep,'yes');assert.equal(h.binding.metadata.buffer_verification.available,false);assert.equal((await h.run()).channels.length,0);assert.deepEqual(h.counts(),{tokens:1,reads:1,writes:1});
 const good=statusHarness();const found=await good.run(true);assert.equal(found.channels.length,1);assert.equal(found.channels[0].id,'ig-a');assert.equal((await good.run()).channels[0].name,'Live IG');
});
test('temporary Buffer failure preserves saved binding and account authorization, without claiming live verification',async()=>{
 const h=statusHarness({fail:true});const result=await h.run(true);assert.equal(result.knownChannels.length,1);assert.equal(result.accounts[0].status,'connected');assert.equal(result.accounts[0].verification,'unavailable');assert.equal(result.channels.length,0);assert.equal(h.counts().writes,0);assert.equal((await h.run()).channels.length,1);
});
test('reauthorization and channel ownership remain enforced without provider calls',async()=>{
 const h=statusHarness({accountStatus:'needs_reauth'});const result=await h.run();assert.equal(result.channels.length,0);assert.equal(result.knownChannels.length,1);assert.equal(result.accounts[0].status,'needs_reauth');assert.equal(h.counts().tokens,0);const denied=statusHarness({owned:false});assert.equal((await denied.run(true)).status,403);assert.equal(denied.counts().reads,0);
});
test('receipt queries remain fresh and uncertain mutations are never retried',async()=>{
 const h=apiHarness((_b,n)=>Response.json({data:{status:n===1?'scheduled':'sent'}}));assert.equal((await h.api.bufferGraphql('query Post')).status,'scheduled');assert.equal((await h.api.bufferGraphql('query Post')).status,'sent');assert.equal(h.calls.length,2);
 const broken=apiHarness(()=>{throw Error('transport uncertain')});await assert.rejects(broken.api.bufferGraphql('mutation CreatePost'),/uncertain/);assert.equal(broken.calls.length,1);
});
test('post-status forwards HTTP 429 and Retry-After without claiming receipt updates',async()=>{
 const q={select:()=>q,eq:()=>q,single:async()=>({data:{id:'p',channel_id:'c'}}),then:ok=>Promise.resolve({data:[{buffer_account_id:'a'}]}).then(ok)};
 const ctx={exports:{},console:{error(){}},require:n=>({'next/server':{NextResponse:Response},'@/utils/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'u'}}})},from:()=>q})},'@/utils/buffer-oauth':{bufferAccessToken:async()=> 'a'},'@/utils/media-source':{cleanString:v=>String(v||'')},'@/utils/buffer-api':{assertBufferBudget:()=>{throw Object.assign(Error('quota'),{status:429,retryAfter:87})},getBufferRateLimit:()=>null,bufferGraphqlDetailed:()=>{throw Error('must not contact provider')}}}[n])};vm.runInNewContext(source('app/api/publishing/buffer/post-status/route.ts'),ctx);
 const result=await ctx.exports.POST({json:async()=>({projectId:'p',postIds:['one']})});assert.equal(result.status,429);assert.equal(result.headers.get('Retry-After'),'87');assert.equal((await result.json()).posts,undefined);
});
