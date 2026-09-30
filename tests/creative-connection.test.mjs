import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function requestWith(fetch){
 const source=fs.readFileSync(new URL('../components/creative/CreativeStudio.tsx',import.meta.url),'utf8')+'\nexport {json as testedRequest};';
 const context={exports:{},require:()=>({}),fetch,Response,Error};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
 return context.exports.testedRequest;
}
test('offline local worker has actionable error and never automatically replays a request',async()=>{
 let calls=0;const request=requestWith(async()=>{calls++;throw new TypeError('Failed to fetch');});
 for(const options of [undefined,{method:'POST',body:'unchanged'}])await assert.rejects(()=>request('http://127.0.0.1:47123/creative/status',options),/saved videos are temporarily unavailable.*saved work and approvals are preserved/);
 assert.equal(calls,2);
});
test('cloud network errors are distinct; successful read-only reconnect returns saved versions',async()=>{
 const offline=requestWith(async()=>{throw new TypeError('Failed to fetch');});await assert.rejects(()=>offline('/api/creative-workspace'),/Cannot reach Universe/);
 let calls=0;const saved={versions:[{id:'existing'}],approved:{full:'existing'}};const online=requestWith(async(url,options)=>{calls++;assert.equal(options,undefined);return Response.json(saved);});
 assert.deepEqual(await online('http://127.0.0.1:47123/creative/status'),saved);assert.equal(calls,1);
});
