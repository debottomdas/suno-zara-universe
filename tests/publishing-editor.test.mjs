import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,modules,globals={}){const code=ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;const ctx={exports:{},require:n=>{if(!(n in modules))throw Error(n);return modules[n]},Date,Intl,Set,Map,console,...globals};vm.runInNewContext(code,ctx);return ctx.exports;}
const plan=load('utils/publishing/plan.ts',{}),campaign=load('utils/publishing/campaign.ts',{'./plan':plan}),preference=load('utils/publishing/preference.ts',{});
const release={userId:'u',projectId:'p',channelId:'c',revision:'v1',assets:Array.from({length:7},(_,slot)=>({key:slot?`short-${slot}`:'full',slot,label:slot?`Short ${slot}`:'Full video',ready:true,version:'v'+slot})),destinations:['youtube','instagram','facebook','tiktok'].map(platform=>({id:platform,platform,name:platform,channelId:'c'})),receipts:[]};
const storage=new Map();const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
function mount(r=release,seedPost){
 const states=[],refs=[],effects=[];let si=0,ri=0,initial=true,tree;
 const react={useState:value=>{const i=si++;if(initial)states[i]=value;return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}]},useRef:value=>{const i=ri++;if(initial)refs[i]={current:value};return refs[i]},useCallback:fn=>fn,useEffect:fn=>{if(initial)effects.push(fn)}};
 const jsx=(type,props)=>({type,props});const window={addEventListener(){},removeEventListener(){}};
 const Component=load('components/publishing/PlanWorkspace.tsx',{'react':react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'@/utils/publishing/plan':plan,'@/utils/publishing/campaign':campaign,'@/utils/publishing/preference':preference,'./TimezonePicker':{default:'TimezonePicker'},'./Publishing.module.css':{default:{}}},{localStorage,window,setTimeout,clearTimeout}).default;
 const request=async url=>{assert.equal(url,'/api/publishing/preference');return {timezone:'Europe/London'}};
 const render=()=>{si=0;ri=0;tree=Component({release:r,seedPost,request,onClose(){}});initial=false;return tree};
 render();effects.forEach(fn=>fn());
 return {render,ready:async()=>{await new Promise(setImmediate);return render()}};
}
function all(node,predicate,result=[]){if(!node||typeof node!=='object')return result;if(Array.isArray(node)){node.forEach(x=>all(x,predicate,result));return result}if(predicate(node))result.push(node);all(node.props?.children,predicate,result);return result}
test('real editor handlers persist isolated publication edits through close/reopen and changed revision',async()=>{
 storage.clear();let editor=mount(),tree=await editor.ready();const key='szu:publishing:v1:u:c:p',before=JSON.parse(storage.get(key));
 assert.equal(all(tree,n=>n.props?.['aria-label']==='YouTube schedules').length,1);assert.equal(all(tree,n=>n.props?.['aria-label']==='Buffer schedules').length,1);
 for(const [target,time] of [['Full video youtube youtube date and time','2026-10-02T19:00'],['Short 1 youtube youtube date and time','2026-10-03T11:00'],['Short 1 instagram instagram date and time','2026-10-03T18:00'],['Short 1 facebook facebook date and time','2026-10-03T19:00'],['Short 1 tiktok tiktok date and time','2026-10-03T20:00']]){
 const input=all(tree,n=>n.type==='input'&&n.props['aria-label']===target)[0];assert.ok(input,target);input.props.onChange({target:{value:time}});tree=editor.render();
 }
 const edited=JSON.parse(storage.get(key));assert.equal(edited.rows.filter((r,i)=>r.localTime!==before.rows[i].localTime).length,5);
 editor=mount();await editor.ready();assert.deepEqual(JSON.parse(storage.get(key)).rows,edited.rows);
 editor=mount({...release,revision:'v2'});await editor.ready();assert.deepEqual(JSON.parse(storage.get(key)).rows,edited.rows);assert.equal(JSON.parse(storage.get(key)).revision,'v2');
 assert.equal(plan.toProviderTime(edited.rows[0].localTime,edited.timezone),'2026-10-02T18:00:00.000Z');
});

test('single-post edit drafts reopen without overwriting the full campaign draft',async()=>{
 storage.clear();await mount().ready();const campaignKey='szu:publishing:v1:u:c:p',before=storage.get(campaignKey),seed={itemKey:'youtube-full',channelId:'youtube',kind:'full',status:'scheduled',dueAt:'2026-10-02T18:00:00Z'};
 let editor=mount(release,seed),tree=await editor.ready();const input=all(tree,n=>n.type==='input'&&n.props['aria-label']==='Full video youtube youtube date and time')[0];input.props.onChange({target:{value:'2026-10-03T20:00'}});assert.equal(storage.get(campaignKey),before);
 await mount(release,seed).ready();const single=JSON.parse(storage.get(campaignKey+':item:youtube-full'));assert.equal(single.rows.length,1);assert.equal(single.rows[0].localTime,'2026-10-03T20:00');assert.equal(storage.get(campaignKey),before);
});
