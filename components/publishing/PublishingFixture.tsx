'use client';
import {useState,useRef,useCallback,useMemo} from 'react';
import s from './Publishing.module.css';
import {Detail} from './Publishing';
import {validatePlan} from '@/utils/publishing/plan';
import {executeApproved} from '@/utils/publishing/execute';
import {receiptKey} from '@/utils/publishing/campaign';
export default function PublishingFixture(){
 const preference=useRef<string|null>(null),receipts=useRef<any[]>([]);
 const [blocked,setBlocked]=useState(false),[unavailable,setUnavailable]=useState(false),[fail,setFail]=useState(false),[calls,setCalls]=useState(0);
 const release=useMemo(()=>({userId:'fixture',projectId:'isolated-fixture',channelId:'fixture-channel',channelName:'Isolated test channel',title:'Publishing V1.1 test release',revision:'fixture-v1',ready:!blocked,reasons:blocked?['Short 1 needs updating because its visual changed.']:[],assets:Array.from({length:7},(_,slot)=>({key:slot?`short-${slot}`:'full',slot,label:slot?`Short ${slot}`:'Main Video',version:`fixture-${slot}`,ready:!blocked||slot!==1})),destinations:['youtube','instagram','facebook','tiktok'].map(platform=>({id:platform,name:`Test ${platform}`,platform,channelId:'fixture-channel',available:!unavailable||platform==='youtube'})),connectionNotes:unavailable?['Fixture Buffer quota exhausted. Retry later.']:[],receipts:[],history:[]}),[blocked,unavailable]);
 const request=useCallback(async (url:string,body?:any)=>{
 if(url==='/api/publishing/preference'){if(body)preference.current=body.timezone;return {timezone:preference.current}}
 if(url.includes('/progress?'))return {receipts:receipts.current};
 if(url.endsWith('/approve')){let count=0;await executeApproved(body.plan,release,body.approved,async row=>{await new Promise(resolve=>setTimeout(resolve,180));if(fail&&row.destination.platform==='instagram')throw Error('Fixture social delivery interrupted; successful receipts are retained.');receipts.current.push({itemKey:receiptKey(row,row.destination),assetVersion:row.asset.version,status:'scheduled',dueAt:row.dueAt});count++;setCalls(count)});return {scheduled:count}}
 const rows=validatePlan(body,release);return {rows,count:rows.length};
 },[release,fail]);
 return <div className={s.app}><main className={s.main}><h1>Isolated Publishing V1.1 fixture</h1><p>This development-only page uses in-memory fixtures. It cannot contact YouTube, Buffer or your saved releases.</p><button onClick={()=>setBlocked(!blocked)}>{blocked?'Use ready fixture':'Invalidate Short 1 in fixture'}</button><button onClick={()=>setUnavailable(!unavailable)}>{unavailable?'Restore fixture destinations':'Make social destinations unavailable'}</button><label><input type="checkbox" checked={fail} onChange={e=>setFail(e.target.checked)}/> Simulate failure after YouTube succeeds</label><p role="status">Mock deliveries: {calls}. External requests: 0.</p></main><Detail key={`${blocked}:${unavailable}`} release={release} readOnly={false} close={()=>{}} reload={()=>{}} request={request} fixture/></div>;
}
