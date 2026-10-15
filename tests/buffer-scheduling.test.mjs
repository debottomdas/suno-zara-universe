import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=ts.transpileModule(fs.readFileSync(new URL('../utils/buffer-scheduling.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(fetch){const ctx={exports:{},Date,Intl,fetch};vm.runInNewContext(source,ctx);return ctx.exports;}
const receipt={itemKey:'buffer-fb-short-01',postId:'6aba559734b4a8ea9e07ce21',slot:1,channelId:'fb',service:'facebook',status:'draft',mediaUrl:'https://example.test/original.mp4'};
test('one draft uses the production batch route once with exactly one existing post',async()=>{
 const calls=[];const api=load(async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return {ok:true,json:async()=>({results:[{post:{id:receipt.postId,status:'scheduled'}}]})};});
 const item=api.singleDraftItem(receipt,'2026-09-28T15:00:00Z',Date.parse('2026-09-28T14:00:00Z'));
 await api.submitBufferSchedule('song',[item]);assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/publishing/buffer/schedule-posts-batch');assert.equal(calls[0].body.items.length,1);assert.equal(calls[0].body.items[0].postId,receipt.postId);assert.equal(calls[0].body.items[0].mediaUrl,receipt.mediaUrl);assert.equal(receipt.status,'draft');
});
test('invalid, stale and non-draft targets are rejected before submission',()=>{
 const api=load();const now=Date.parse('2026-09-28T14:00:00Z');for(const change of [{status:'sent'},{status:'scheduled'},{mediaUrl:''},{itemKey:'historical'},{postId:''},{slot:7}])assert.throws(()=>api.singleDraftItem({...receipt,...change},'2026-09-28T15:00:00Z',now));assert.throws(()=>api.singleDraftItem(receipt,'2026-09-28T14:01:00Z',now));
});
test('UK times handle BST, GMT, invalid dates and both clock-change hazards',()=>{
 const api=load();assert.equal(api.ukTimeToIso('2026-09-28T16:00'),'2026-09-28T15:00:00.000Z');assert.equal(api.ukTimeToIso('2026-12-28T16:00'),'2026-12-28T16:00:00.000Z');for(const value of ['2026-03-29T01:30','2026-10-25T01:30','2026-02-30T12:00',''])assert.throws(()=>api.ukTimeToIso(value));
});
test('a failed scheduling request is not retried',async()=>{
 let calls=0;const api=load(async()=>{calls++;return {ok:false,json:async()=>({error:'Rejected'})};});await assert.rejects(api.submitBufferSchedule('song',[receipt]),/Rejected/);assert.equal(calls,1);
});
