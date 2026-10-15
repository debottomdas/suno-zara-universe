import type {Plan} from './plan';
export function validTimezone(value:unknown):value is string {
 if(typeof value!=='string'||!(value==='UTC'||value.includes('/')))return false;
 try{new Intl.DateTimeFormat('en',{timeZone:value}).format();return true}catch{return false}
}
// Only draft data is accepted here. Canonical approved receipts are never rewritten.
export function applyDraftTimezone(plan:Plan,timezone:string):Plan {
 if(!validTimezone(timezone))throw Error('Choose a valid publishing timezone.');
 return {...plan,timezone};
}
