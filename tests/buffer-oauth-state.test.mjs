import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
const source = ts.transpileModule(fs.readFileSync(new URL('../utils/buffer-oauth-state.ts', import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ctx = {exports:{},require:()=>crypto,Buffer,URL,Date,process:{env:{BUFFER_CLIENT_SECRET:'test-secret'}}};
vm.runInNewContext(source,ctx);
const {bufferOrigin,bufferReturnPath,createBufferState,validateBufferState}=ctx.exports;
for(const origin of ['http://localhost:3002','https://suno-zara-universe.vercel.app']) {
 test(`preserves exact callback, page, query, fragment and channel for ${origin}`,()=>{
  const path=bufferReturnPath('/music-next?projectId=song&channelId=wrong#publish',origin,'channel-a');
  const state=createBufferState(origin,path,'channel-a','user-a');
  const data=validateBufferState(state,origin+'/api/publishing/buffer/callback');
  assert.equal(data.redirectUri,origin+'/api/publishing/buffer/callback');
  assert.equal(data.returnTo,'/music-next?projectId=song&channelId=channel-a#publish');
  assert.equal(data.userId,'user-a');
  assert.throws(()=>validateBufferState(state,origin==='http://localhost:3002'?'https://suno-zara-universe.vercel.app':'http://localhost:3002'));
  assert.throws(()=>validateBufferState(state+'x',origin));
  const [payload,mac]=state.split('.');
  const changed=JSON.parse(Buffer.from(payload,'base64url'));changed.channelId='other';
  assert.throws(()=>validateBufferState(Buffer.from(JSON.stringify(changed)).toString('base64url')+'.'+mac,origin));
 });
}
test('rejects open redirect paths and unregistered origins',()=>{
 for(const path of ['https://evil.test','//evil.test','/\\evil.test','/api/publishing/buffer/connect','/\n/evil.test'])assert.throws(()=>bufferReturnPath(path,'http://localhost:3002','a'));
 for(const origin of ['http://evil.test','http://localhost:3000','https://suno-zara-universe.vercel.app.evil.test'])assert.throws(()=>bufferOrigin(origin));
});
test('rejects expired signed state',()=>{
 const state=createBufferState('http://localhost:3002','/music-next','a','u');
 ctx.Date={now:()=>Date.now()+601000};
 assert.throws(()=>validateBufferState(state,'http://localhost:3002'));
 ctx.Date=Date;
});
function routeHarness() {
 const jar=new Map(); let exchange; let userId='user-a';
 const supabase={auth:{getUser:async()=>({data:{user:{id:userId}}})},from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{id:'channel-a',workspace_id:'w'}})};return q;}};
 const NextResponse={redirect:url=>({url:String(url),cookies:{set:(k,v)=>jar.set(k,v)}}),json:(body,options)=>({body,...options})};
 const load=path=>{const scope={exports:{},require:name=>name==='crypto'?crypto:name==='next/server'?{NextResponse}:name==='next/headers'?{cookies:async()=>({get:k=>jar.has(k)?{value:jar.get(k)}:undefined})}:name.includes('buffer-oauth-state')?ctx.exports:name.includes('/admin')?{createAdminClient:()=>{throw Error('Unexpected database write');}}:{createClient:async()=>supabase},URL,URLSearchParams,Buffer,console,process:{env:{BUFFER_CLIENT_ID:'client',BUFFER_CLIENT_SECRET:'test-secret',BUFFER_REDIRECT_URI:'https://wrong.example/callback',NEXT_PUBLIC_APP_URL:'https://wrong.example'}},fetch:async(url,options)=>{exchange=options.body;return {ok:false,json:async()=>({})};}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);return scope.exports.GET;};
 return {start:load('../app/api/publishing/buffer/connect/route.ts'),callback:load('../app/api/publishing/buffer/callback/route.ts'),jar,exchange:()=>exchange,setUser:id=>{userId=id;}};
}
for(const origin of ['http://localhost:3002','https://suno-zara-universe.vercel.app'])test(`routes exchange the authorization redirect URI verbatim for ${origin}`,async()=>{
 const h=routeHarness();const start=await h.start(new Request(origin+'/api/publishing/buffer/connect?channelId=channel-a&returnTo='+encodeURIComponent('/music-next?projectId=song#publish')));
 const auth=new URL(start.url);const callback=auth.searchParams.get('redirect_uri');
 assert.equal(callback,origin+'/api/publishing/buffer/callback');
 const result=await h.callback(new Request(callback+'?code=test&state='+encodeURIComponent(auth.searchParams.get('state'))));
 assert.equal(h.exchange().get('redirect_uri'),callback);
 assert.equal(h.exchange().get('code_verifier').length>0,true);
 const returned=new URL(result.url);assert.equal(returned.origin,origin);assert.equal(returned.searchParams.get('channelId'),'channel-a');assert.equal(returned.searchParams.get('projectId'),'song');assert.equal(returned.hash,'#publish');
 assert.equal(h.jar.get('sz_buffer_oauth_state'),'');
});
test('routes reject missing CSRF cookie, changed channel and changed signed-in user before exchange',async()=>{
 for(const mode of ['cookie','channel','user']){
  const h=routeHarness();const start=await h.start(new Request('http://localhost:3002/api/publishing/buffer/connect?channelId=channel-a'));
  const auth=new URL(start.url);
  if(mode==='cookie')h.jar.delete('sz_buffer_oauth_state');
  if(mode==='channel')h.jar.set('sz_buffer_oauth_channel','other');
  if(mode==='user')h.setUser('other');
  await h.callback(new Request('http://localhost:3002/api/publishing/buffer/callback?code=test&state='+encodeURIComponent(auth.searchParams.get('state'))));
  assert.equal(h.exchange(),undefined);
 }
});
