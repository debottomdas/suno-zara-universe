import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const execute=fs.readFileSync('utils/publishing/execute.ts','utf8');
const approve=fs.readFileSync('app/api/publishing/plan/approve/route.ts','utf8');

test('confirmed delivery states are monotonic',()=>{
 assert.match(execute,/CONFIRMED_DELIVERY_STATUSES=new Set\(\['scheduled','sent','published'\]\)/);
 assert.match(execute,/preserveConfirmedDelivery/);
 assert.match(execute,/pendingProviderOperation/);
 assert.match(execute,/lastConfirmedProviderState/);
});

test('Buffer receipt writes preserve a prior confirmed provider result',()=>{
 assert.match(approve,/preserveConfirmedDelivery\(old,p\.receipt\)/);
 assert.match(approve,/preserveConfirmedDelivery\(old,next\)/);
});

test('Akele regression shape: confirmed work is skipped, uncertain work is unresolved, untouched work remains actionable',async()=>{
 const source=await import('../utils/publishing/execute.ts');
 const mk=(platform,id,slot)=>({asset:{version:'akele-v1',slot,label:slot?\`Short \${slot}\`:'Full'},destination:{platform,id,name:id}});
 const rows=[
  mk('youtube','yt',0),...Array.from({length:6},(_,i)=>mk('youtube','yt',i+1)),
  ...['facebook','instagram','tiktok'].flatMap(p=>Array.from({length:6},(_,i)=>mk(p,p,i+1)))
 ];
 const receipt=(row,status,extra={})=>({itemKey:source.deliveryReceiptKey(row),assetVersion:'akele-v1',status,...extra});
 const receipts=[
  ...rows.filter(r=>r.destination.platform==='youtube').map(r=>receipt(r,'scheduled',{videoId:'abcdefghijk'})),
  receipt(rows.find(r=>r.destination.platform==='facebook'&&r.asset.slot===1),'scheduled',{postId:'fb-1'}),
  receipt(rows.find(r=>r.destination.platform==='instagram'&&r.asset.slot===1),'submitting',{postId:'ig-1'}),
  receipt(rows.find(r=>r.destination.platform==='tiktok'&&r.asset.slot===1),'submitting',{postId:'tt-1'}),
 ];
 const result=source.resumeDeliveryRows(rows,{canonicalReceipts:receipts});
 assert.equal(result.skipped.length,8);
 assert.equal(result.unresolved.length,2);
 assert.equal(result.actionable.length,15);
});

test('same provider object cannot be downgraded from scheduled to submitting',async()=>{
 const {preserveConfirmedDelivery}=await import('../utils/publishing/execute.ts');
 const previous={itemKey:'buffer-instagram-short-01',assetVersion:'v1',postId:'same-post',status:'scheduled',scheduledAt:'2026-10-07T18:40:00Z'};
 const next={...previous,status:'submitting',dueAt:'2026-10-07T18:55:00Z'};
 const saved=preserveConfirmedDelivery(previous,next);
 assert.equal(saved.status,'scheduled');
 assert.equal(saved.postId,'same-post');
 assert.equal(saved.pendingProviderOperation.attemptedStatus,'submitting');
});

test('different asset or provider object is not silently treated as the prior success',async()=>{
 const {preserveConfirmedDelivery}=await import('../utils/publishing/execute.ts');
 const previous={itemKey:'buffer-instagram-short-01',assetVersion:'v1',postId:'old-post',status:'scheduled'};
 assert.equal(preserveConfirmedDelivery(previous,{...previous,assetVersion:'v2',status:'submitting'}).status,'submitting');
 assert.equal(preserveConfirmedDelivery(previous,{...previous,postId:'new-post',status:'submitting'}).status,'submitting');
});
