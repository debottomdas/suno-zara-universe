import {validatePlan,type Plan} from './plan';
// Dependency injection keeps validation and the consequential boundary testable with
// isolated fixtures. Production uses only the existing provider and receipt adapters.
export async function executeApproved(plan:Plan,state:any,approved:boolean,deliver:(row:any)=>Promise<void>){
 if(approved!==true)throw Error('Explicit creator approval is required.');
 const rows=validatePlan(plan,state);
 for(const row of rows)await deliver(row);
 return rows.length;
}

export function assertDeliveryHistory(rows:any[],state:any){
 for(const row of rows){
 const key=row.destination.platform==='youtube'?(row.asset.slot?`youtube-short-${String(row.asset.slot).padStart(2,'0')}`:'youtube-full'):`buffer-${row.destination.id}-short-${String(row.asset.slot).padStart(2,'0')}`;
 const old=state.canonicalReceipts?.find((r:any)=>r.itemKey===key);
 if(old&&(old.assetVersion!==row.asset.version||!(['draft','scheduled'].includes(old.status)||row.destination.platform!=='youtube'&&old.status==='error'&&old.providerCheckedAt&&old.postId)))throw Error(`${row.asset.label} already has previous delivery activity. Its asset version or outcome needs reconciliation before scheduling again. Open History; Universe will not create a duplicate.`);
 }
}
