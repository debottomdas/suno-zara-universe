import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,modules={}){const c={exports:{},require:n=>modules[n],process,Date,console,structuredClone};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,c);return c.exports;}
const copy=load('utils/social/copy.ts');const intake=load('utils/social/intake.ts',{'./copy':copy});
const filled=value=>Object.fromEntries(Object.entries(value).map(([k,v])=>[k,typeof v==='string'?v||`Copy ${k}`:v]));
function completed(count=6){return Object.fromEntries(copy.platforms.map(p=>{let data=intake.blankPlatform(p,count);data=filled(data);const list=copy.collection(p);if(list)data[list]=data[list].map(filled);return[p,data];}));}
function harness(existing=null){
 let calls=0,saved=null,requested=[];
 const db={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(){const q={select(){return q},eq(){return q},single:async()=>({data:{id:'song',user_id:'owner',channel_id:'bangla',lyrics:null,idea:'Creator description'}}),maybeSingle:async()=>({data:existing}),insert:async()=>({})};return q;}};
 class OpenAI{responses={create:async request=>{calls++;const input=JSON.parse(request.input[1].content);requested=input.posts;return{output_text:JSON.stringify({posts:input.posts.map(p=>({...p,value:filled(p.value)}))}),usage:{}}}}}
 const channelContext={userId:'owner',channelId:'bangla',channelName:'Suno Zara Bangla',dnaRevision:3,dna:{sections:{publishing:{fields:{}}}}};
 const route=load('app/api/campaign-plan/route.ts',{'@/utils/social/intake':intake,'@/utils/social/copy':copy,'@/utils/social/release-slots':{loadReleaseShortSlots:async()=>[1,2,3,4,5,6]},'@/utils/social/persistence':{saveSocialPack:async(_db,_user,_project,value,missingOnly)=>{saved=value;return{error:null}}},'@/utils/channel-dna/server':{resolveActiveChannelDNA:async()=>channelContext},'@/utils/channel-dna/instructions':{channelInstructions:()=>''},'@/utils/channel-dna/social':{applyChannelPublishing:(_context,_song,_platform,value)=>value},openai:{default:OpenAI},'next/server':{NextResponse:Response},'@/utils/supabase/server':{createClient:async()=>db}});
 return{run:()=>route.POST(new Request('http://localhost/api/campaign-plan',{method:'POST',body:JSON.stringify({projectId:'song'})})),get calls(){return calls},get saved(){return saved},get requested(){return requested}};
}
test('new coordinated campaign accepts exactly six posts per production destination without lyrics',async()=>{const h=harness();const r=await h.run();assert.equal(r.status,200);assert.equal(h.calls,1);for(const [platform,key] of [['youtube_shorts','shorts'],['instagram','reels'],['facebook','reels'],['tiktok','posts']])assert.equal(h.saved[platform][key].length,6);});
test('loading a complete existing ten-post campaign never invokes generation or discards history',async()=>{const row=completed(10),before=JSON.stringify(row);const h=harness(row);const r=await h.run();assert.equal(r.status,200);assert.equal(h.calls,0);assert.ok(h.saved);assert.equal(JSON.stringify(row),before);assert.equal((await r.json()).cached,true);});
test('one missing post requests only that post, with other platform copy untouched',async()=>{const row=completed();row.instagram.reels[3].caption='';const h=harness(row);const r=await h.run();assert.equal(r.status,200);assert.equal(h.requested.length,1);assert.equal(h.requested[0].key,'reels:3');assert.deepEqual(Object.keys(h.saved),['instagram']);assert.equal(h.saved.instagram.reels[0].caption,row.instagram.reels[0].caption);});
