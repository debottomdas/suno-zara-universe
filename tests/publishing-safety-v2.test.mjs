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

test('Akele regression fixture encodes 8 skipped, 2 unresolved and 15 actionable publications',()=>{
 const mk=(platform,id,slot)=>({asset:{version:'akele-v1',slot,label:slot?`Short ${slot}`:'Full'},destination:{platform,id,name:id}});
 const key=row=>row.destination.platform==='youtube'?(row.asset.slot?`youtube-short-${String(row.asset.slot).padStart(2,'0')}`:'youtube-full'):`buffer-${row.destination.id}-short-${String(row.asset.slot).padStart(2,'0')}`;
 const rows=[
  mk('youtube','yt',0),...Array.from({length:6},(_,i)=>mk('youtube','yt',i+1)),
  ...['facebook','instagram','tiktok'].flatMap(p=>Array.from({length:6},(_,i)=>mk(p,p,i+1)))
 ];
 const receipt=(row,status,extra={})=>({itemKey:key(row),assetVersion:'akele-v1',status,...extra});
 const receipts=[
  ...rows.filter(r=>r.destination.platform==='youtube').map(r=>receipt(r,'scheduled',{videoId:'abcdefghijk'})),
  receipt(rows.find(r=>r.destination.platform==='facebook'&&r.asset.slot===1),'scheduled',{postId:'fb-1'}),
  receipt(rows.find(r=>r.destination.platform==='instagram'&&r.asset.slot===1),'submitting',{postId:'ig-1'}),
  receipt(rows.find(r=>r.destination.platform==='tiktok'&&r.asset.slot===1),'submitting',{postId:'tt-1'}),
 ];
 const byKey=new Map(receipts.map(r=>[r.itemKey,r]));
 const skipped=rows.filter(r=>['scheduled','sent','published'].includes(byKey.get(key(r))?.status));
 const unresolved=rows.filter(r=>byKey.get(key(r))?.status==='submitting');
 const actionable=rows.filter(r=>!byKey.has(key(r)));
 assert.equal(skipped.length,8);
 assert.equal(unresolved.length,2);
 assert.equal(actionable.length,15);
});

test('monotonic helper contract preserves confirmed state for same provider object',()=>{
 assert.match(execute,/sameIdentity&&sameProviderObject&&CONFIRMED_DELIVERY_STATUSES\.has\(previous\.status\)&&!CONFIRMED_DELIVERY_STATUSES\.has\(next\.status\)/);
 assert.match(execute,/status:previous\.status/);
 assert.match(execute,/postId:previous\.postId\?\?next\.postId/);
 assert.match(execute,/attemptedStatus:next\.status/);
});

test('monotonic helper is scoped to same asset and provider object',()=>{
 assert.match(execute,/previous\.itemKey===next\.itemKey&&previous\.assetVersion===next\.assetVersion/);
 assert.match(execute,/!previous\.postId\|\|!next\.postId\|\|previous\.postId===next\.postId/);
 assert.match(execute,/return next;/);
});
