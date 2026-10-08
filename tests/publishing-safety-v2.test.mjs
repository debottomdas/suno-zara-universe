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

test('YouTube tags are normalized before any provider session is attempted',()=>{
 const route=fs.readFileSync('app/api/publishing/youtube/direct-session/route.ts','utf8');
 assert.match(route,/const YOUTUBE_TAG_BUDGET = 480/);
 assert.match(route,/normalizeYouTubeTags\(full\.tags, 50\)/);
 assert.match(route,/normalizeYouTubeTags\(item\.tags, 30\)/);
 assert.match(route,/if \(tagsCharacterCount\(next\) > YOUTUBE_TAG_BUDGET\) continue/);
 const normalizeAt=route.indexOf('tags = normalizeYouTubeTags');
 const providerAt=route.indexOf('providerSessionAttempted = true');
 assert.ok(normalizeAt>=0&&providerAt>normalizeAt);
});

test('YouTube tag normalization is whole-tag, ordered and case-insensitive de-duplicated',()=>{
 const route=fs.readFileSync('app/api/publishing/youtube/direct-session/route.ts','utf8');
 assert.match(route,/const seen = new Set<string>\(\)/);
 assert.match(route,/tag\.toLocaleLowerCase\(\)/);
 assert.match(route,/accepted\.push\(tag\)/);
 assert.doesNotMatch(route,/\.slice\(0,\s*YOUTUBE_TAG_BUDGET\)/);
});

test('YouTube upload session requires exact live provider identity first',()=>{
 const route=fs.readFileSync('app/api/publishing/youtube/direct-session/route.ts','utf8');
 assert.match(route,/select\("id,scopes,external_account_id"\)/);
 assert.match(route,/youtube\/v3\/channels/);
 assert.match(route,/searchParams\.set\("mine", "true"\)/);
 assert.match(route,/liveChannelId !== expectedChannelId/);
 assert.match(route,/Publishing stopped before upload/);
 const identityAt=route.indexOf('identityResponse = await fetch');
 const uploadAt=route.indexOf('providerSessionAttempted = true');
 assert.ok(identityAt>=0&&uploadAt>identityAt);
});

test('YouTube identity mismatch is explicitly retry-safe and cannot create an upload session',()=>{
 const route=fs.readFileSync('app/api/publishing/youtube/direct-session/route.ts','utf8');
 const mismatch=route.indexOf('liveChannelId !== expectedChannelId');
 const retrySafe=route.indexOf('retrySafe: true',mismatch);
 const upload=route.indexOf('providerSessionAttempted = true');
 assert.ok(mismatch>=0&&retrySafe>mismatch&&upload>retrySafe);
});

test('campaign approval preflights YouTube and Buffer before any receipt or provider mutation',()=>{
 const approve=fs.readFileSync('app/api/publishing/plan/approve/route.ts','utf8');
 assert.match(approve,/preflightOnly:true/);
 assert.match(approve,/bufferStatus/);
 assert.match(approve,/refresh=1/);
 const youtubePreflight=approve.indexOf('preflightOnly:true');
 const bufferPreflight=approve.indexOf('refresh=1');
 const history=approve.indexOf('assertDeliveryHistory(rows,state)',youtubePreflight);
 const receipt=approve.indexOf("worker(receiptPath",youtubePreflight);
 assert.ok(youtubePreflight>=0&&bufferPreflight>youtubePreflight&&history>bufferPreflight&&receipt>history);
});

test('YouTube campaign preflight returns before upload-session mutation',()=>{
 const route=fs.readFileSync('app/api/publishing/youtube/direct-session/route.ts','utf8');
 const preflight=route.indexOf('body.preflightOnly === true');
 const uploadMutation=route.indexOf('providerSessionAttempted = true');
 assert.ok(preflight>=0&&uploadMutation>preflight);
 assert.match(route,/preflightVerified: true/);
});

test('Buffer campaign preflight requires every selected destination to exist in live reconciled bindings',()=>{
 const approve=fs.readFileSync('app/api/publishing/plan/approve/route.ts','utf8');
 assert.match(approve,/const live=new Set/);
 assert.match(approve,/const missing=bufferRowsForPreflight\.filter/);
 assert.match(approve,/Nothing was published/);
});

test('YouTube completion verifies provider channel and schedule before saving publishing history',()=>{
 const route=fs.readFileSync('app/api/publishing/youtube/direct-complete/route.ts','utf8');
 assert.match(route,/select\("id,external_account_id"\)/);
 assert.match(route,/part", "status,snippet"/);
 assert.match(route,/snippet\?\.channelId\) !== expectedChannelId/);
 assert.match(route,/YouTube did not confirm the requested private schedule/);
 assert.match(route,/\["failed", "rejected"\]/);
 const verifyAt=route.indexOf('const verifyResponse = await fetch');
 const historyAt=route.indexOf('publishing_campaigns');
 assert.ok(verifyAt>=0&&historyAt>verifyAt);
});

test('Buffer reconciliation classifier is fail-closed and distinguishes confirmed delivery from safe retry',()=>{
 const source=fs.readFileSync('utils/publishing/execute.ts','utf8');
 assert.match(source,/classifyBufferReconciliation/);
 assert.match(source,/\['scheduled','sent','published'\]\.includes\(status\)/);
 assert.match(source,/\['error','failed','draft'\]\.includes\(status\)/);
 assert.match(source,/state:'unresolved'/);
 assert.match(source,/providerPost\.id!==receipt\.postId/);
});

test('resume reconciles uncertain Buffer receipts by exact post id before retry decision',()=>{
 const route=fs.readFileSync('app/api/publishing/plan/approve/route.ts','utf8');
 assert.match(route,/for\(const row of resume\.unresolved\)/);
 assert.match(route,/postIds:\[old\.postId\]/);
 assert.match(route,/classifyBufferReconciliation\(old,providerPost\)/);
 assert.match(route,/decision\.state==='delivered'/);
 assert.match(route,/resume\.skipped\.push\(row\)/);
 assert.match(route,/decision\.state==='retry_allowed'/);
 assert.match(route,/resume\.actionable\.push\(row\)/);
 assert.match(route,/remaining\.push\(row\)/);
});
