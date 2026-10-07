import {validatePlan,type Plan} from './plan';
// Dependency injection keeps validation and the consequential boundary testable with
// isolated fixtures. Production uses only the existing provider and receipt adapters.
export async function executeApproved(plan:Plan,state:any,approved:boolean,deliver:(row:any)=>Promise<void>,rowsOverride?:any[]){
 if(approved!==true)throw Error('Explicit creator approval is required.');
 const rows=rowsOverride??validatePlan(plan,state);
 for(const row of rows)await deliver(row);
 return rows.length;
}

export type ReconciliationState='retry_allowed'|'delivered';
export type ReceiptReconciliation={state:ReconciliationState;resolvedAt:string;note?:string};

// A reconciliation decision belongs to one immutable delivery receipt. It never
// clears another asset version, slot, platform or destination.
export function retryWasExplicitlyAllowed(receipt:any){
 return receipt?.reconciliation?.state==='retry_allowed'&&Boolean(receipt?.reconciliation?.resolvedAt);
}

export function deliveryReceiptKey(row:any){
 return row.destination.platform==='youtube'?(row.asset.slot?`youtube-short-${String(row.asset.slot).padStart(2,'0')}`:'youtube-full'):`buffer-${row.destination.id}-short-${String(row.asset.slot).padStart(2,'0')}`;
}

// Campaign resume is fail-closed per publication. Confirmed deliveries are skipped,
// safe/reconciled failures may run again, and uncertain outcomes remain untouched
// while independent not-started work is allowed to continue.
export function resumeDeliveryRows(rows:any[],state:any){
 const actionable:any[]=[];const skipped:any[]=[];const unresolved:any[]=[];
 for(const row of rows){
  const old=state.canonicalReceipts?.find((r:any)=>r.itemKey===deliveryReceiptKey(row));
  if(!old){actionable.push(row);continue;}
  const sameAsset=old.assetVersion===row.asset.version;
  if(!sameAsset)throw Error(`${row.asset.label} already has previous delivery activity for another asset version. Open History; Universe will not create a duplicate.`);
  if(['scheduled','sent','published'].includes(old.status)){skipped.push(row);continue;}
  const retryAllowed=retryWasExplicitlyAllowed(old);
  const safeDraft=old.status==='draft';
  const providerConfirmedFailure=row.destination.platform!=='youtube'&&old.status==='error'&&old.providerCheckedAt&&old.postId;
  if(retryAllowed||safeDraft||providerConfirmedFailure){actionable.push(row);continue;}
  unresolved.push(row);
 }
 return {actionable,skipped,unresolved};
}

export function assertDeliveryHistory(rows:any[],state:any){
 for(const row of rows){
 const key=deliveryReceiptKey(row);
 const old=state.canonicalReceipts?.find((r:any)=>r.itemKey===key);
 if(!old)continue;
 const sameAsset=old.assetVersion===row.asset.version;
 const retryAllowed=sameAsset&&retryWasExplicitlyAllowed(old);
 const ordinarilyRetryable=sameAsset&&(['draft','scheduled'].includes(old.status)||row.destination.platform!=='youtube'&&old.status==='error'&&old.providerCheckedAt&&old.postId);
 if(!retryAllowed&&!ordinarilyRetryable)throw Error(`${row.asset.label} already has previous delivery activity. Its asset version or outcome needs reconciliation before scheduling again. Open History; Universe will not create a duplicate.`);
 }
}
