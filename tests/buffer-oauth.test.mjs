import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync(new URL('../utils/buffer-oauth.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function harness({failure=false,lostSave=false}={}) {
 let row={id:'a',user_id:'u',status:'connected',access_token:'old',refresh_token:'single-use',expires_at:'2000-01-01'},calls=0;
 const admin={from(){let update,filters=[];const run=async()=>{if(!filters.every(([k,v])=>row[k]===v))return {data:null};if(update){if(lostSave&&update.access_token)return {data:null,error:{message:'save failed'}};row={...row,...update};}return {data:{...row}};};const q={select(){return q},eq(k,v){filters.push([k,v]);return q},update(v){update=v;return q},maybeSingle:run,then:(ok,bad)=>run().then(ok,bad)};return q;}};
 const ctx={exports:{},require:()=>({createAdminClient:()=>admin}),Date,URLSearchParams,AbortSignal,setTimeout,process:{env:{BUFFER_CLIENT_ID:'client',BUFFER_CLIENT_SECRET:'secret'}},fetch:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {ok:!failure,status:failure?400:200,json:async()=>failure?{error:'invalid_grant'}:{access_token:'new',refresh_token:'new-single-use',expires_in:3600}}}};
 vm.runInNewContext(source,ctx);return {token:ctx.exports.bufferAccessToken,calls:()=>calls,row:()=>row};
}
test('parallel app instances consume a refresh token once and all receive the saved token',async()=>{
 const h=harness();const values=await Promise.all(Array.from({length:4},()=>h.token('a','u')));assert.deepEqual(values,['new','new','new','new']);assert.equal(h.calls(),1);assert.equal(h.row().status,'connected');assert.equal(h.row().refresh_token,'new-single-use');
});
test('a rejected or uncertain refresh cannot replay the single-use token',async()=>{
 for(const options of [{failure:true},{lostSave:true}]){const h=harness(options);await assert.rejects(()=>h.token('a','u'));await assert.rejects(()=>h.token('a','u'));assert.equal(h.calls(),1);assert.equal(h.row().status,'needs_reauth');}
});
test('fresh credentials require no refresh and ownership mismatch never calls Buffer',async()=>{
 const h=harness();await h.token('a','u');assert.equal(await h.token('a','u'),'new');assert.equal(h.calls(),1);await assert.rejects(()=>h.token('a','other'));assert.equal(h.calls(),1);
});
