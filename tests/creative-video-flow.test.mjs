import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {validateFinishing} from '../local-worker/music-finishing.mjs';
function load(file,modules={},globals={}){const c={exports:{},require:n=>modules[n],console,Error,...globals};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,c);return c.exports;}
const lyricHelpers=load('utils/creative/lyric-cues.ts',{}, {crypto,TextEncoder});const model=load('utils/creative/model.ts',{'./lyric-cues':lyricHelpers});const batch=load('utils/creative/visual-batch.ts',{'./model':model});const {releaseGaps}=load('utils/release-gaps.ts',{'./creative/model':model});
const jsx=(type,props)=>({type,props});
function nodes(t){return !t||typeof t!=='object'?[]:Array.isArray(t)?t.flatMap(nodes):[t,...nodes(t.props?.children)];}
function words(t){return t==null||typeof t==='boolean'?'':typeof t!=='object'?String(t):Array.isArray(t)?t.map(words).join(''):words(t.props?.children);}
function fixture(){const audio={id:'master',storagePath:'owned/audio.wav',updatedAt:'stable',url:'http://fixture/audio'};const w={...model.emptyWorkspace(),channelBranding:{channelId:'fixture-channel',dnaRevision:3,channelName:'Fixture Channel',brandText:'Fixture Channel'},bible:'Approved world',approvedBible:'Approved world',slots:model.makeSlots(203.08,'[Verse]\n[Chorus]'),analysis:{duration:203.08,energy:[],sourceKey:model.finalAudioKey(audio)}};for(const s of w.slots){s.candidates=[{id:s.id+'-v1',url:'http://fixture/'+s.id}];s.approvedId=s.candidates[0].id;}w.plan=model.proposePlan(w.slots,w.analysis,'');return {w,assets:{audio,styles:[],images:[],artwork:[{mediaKind:'cover-art'},{mediaKind:'thumbnail'}],fullVideos:[],shorts:[],creative:w},videos:{versions:[],approved:{},keys:{}}};}
function harness({hybrid=false,failAt=0,structured=false}={}){
 const {w,assets,videos}=fixture();if(hybrid)for(const slot of [0,1,2]){const v={id:'supplied-'+slot,slot,source:'uploaded',dependencyKey:'supplied',fileUrl:'http://fixture/video'};videos.versions.push(v);videos.approved[model.outputNames[slot]]=v.id;}
 if(structured){w.subtitleContext={identity:{subtitles:{enabled:true,position:'lower-middle',style:'clean',size:'medium',highlight:'none'}},cueContext:{phrases:['Synthetic lyric'],language:'Bengali',source:{lyricsHash:'a'.repeat(64),audioKey:model.finalAudioKey(assets.audio),duration:203.08}}};}
 let values=[],deps=[],effects=[],cursor=0,tree,continued=0,renders=0,calls=[],progress=[];
 const hooks={useState:init=>{const i=cursor++;if(!(i in values))values[i]=typeof init==='function'?init():init;return [values[i],n=>{values[i]=typeof n==='function'?n(values[i]):n;}];},useRef:init=>{const i=cursor++;return values[i]??={current:init};},useEffect:(fn,next)=>{const i=cursor++;if(!deps[i]||next.some((d,j)=>d!==deps[i][j])){deps[i]=next;effects.push(fn);}}};
 const fetch=async(url,options)=>{
  if(url.includes('/api/channel-context')){calls.push({url,layout:new URL(url,'http://local').searchParams.get('layout')});return Response.json({subtitleSource:w.subtitleContext?.cueContext.source,finishing:{...w.channelBranding,subtitles:false,cues:[],lyrics:'',...model.structuredSubtitleFinishing(w,new URL(url,'http://local').searchParams.get('layout')==='portrait'?1:0),font:'Arial',colour:'#FFFFFF',accent:'#FFFFFF',intro:0,outro:0,transition:'fade'}});}
  if(!options)return Response.json(url.includes('/creative/status')?videos:{workspace:w});
  if(url.includes('/creative/upload?')){const params=new URL(url).searchParams;const slot=Number(params.get('slot'));calls.push({url,slot});videos.versions.push({id:'edited-'+slot,slot,source:'uploaded',dependencyKey:'supplied',fileUrl:'http://fixture/edited.mp4'});return Response.json({});}
  const b=JSON.parse(options.body);calls.push({url,...b});
  if(url.endsWith('/creative/render')){renders++;if(renders===failAt)return Response.json({error:'Interrupted fixture render'},{status:500});videos.versions.push({id:'render-'+b.slot,slot:b.slot,source:'generated',dependencyKey:b.dependencyKey,fileUrl:'http://fixture/video'});}
  else if(url.endsWith('/creative/approve'))videos.approved[model.outputNames[b.slot]]=b.id;
  else if(url.endsWith('/creative/sync'))videos.keys=b.keys;
  else if(b.action==='subtitle-preference'){if(b.subtitlesEnabled===null)delete w.subtitlesEnabled;else w.subtitlesEnabled=b.subtitlesEnabled;w.revision++;}
  else if(b.action==='plan'){w.plan={scenes:b.scenes,shorts:b.shorts,approved:b.approve};w.revision++;}
  else throw Error('Unexpected mutation');
  progress.push(words(render()));return Response.json({workspace:w});
 };
 const C=load('components/creative/CreativeStudio.tsx',{'react':hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'@/utils/creative/model':model,'@/utils/creative/visual-batch':batch,'./LyricTimingReview':{default:'LyricTimingReview'},'./CreativeStudio.module.css':{default:{}},'@/utils/supabase/client':{}},{fetch,Response,URLSearchParams,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL:()=>{}},setTimeout,clearTimeout,document:{createElement:()=>({duration:12,videoWidth:1920,videoHeight:1080,set src(value){this.onloadedmetadata();}})}}).default;
 const props={projectId:'fixture',title:'Fixture',lyrics:'Words',stage:'Video & Shorts',assets,onRefresh:()=>{},onContinue:()=>continued++,onNavigate:s=>{throw Error('Unexpected backward navigation: '+s);}};
 function render(){cursor=0;tree=C(props);return tree;}
 async function flush(){for(let i=0;i<100;i++){render();const q=effects;effects=[];q.forEach(f=>f());await new Promise(r=>setImmediate(r));}render();}
 function primary(){return nodes(tree).filter(n=>n.type==='section'&&n.props['aria-label']==='Videos next step').map(n=>nodes(n).filter(x=>x.type==='button').at(-1));}
 async function click(double=false){const bs=primary();assert.equal(bs.length,2);assert.equal(words(bs[0]),words(bs[1]));assert.equal(bs[0].props.disabled,false);bs[0].props.onClick();if(double)bs[1].props.onClick();await flush();}
 return {w,assets,videos,calls,progress,flush,click,primary,get tree(){return tree;},get text(){return words(tree);},get continued(){return continued;},reopen:async()=>{values=[];deps=[];effects=[];await flush();}};
}
test('exact lyrics + finished audio + no Style journey: approved visuals → plan approval → create → review → Social, including reopen',async()=>{
 const h=harness();await h.flush();assert.equal(releaseGaps({lyrics:'Words'},h.assets,false).next,'Video & Shorts');assert.match(h.text,/Review and approve the Video Plan/);assert.equal(words(h.primary()[0]),'Approve Video Plan');assert.equal(h.calls.length,0);
 await h.reopen();assert.equal(words(h.primary()[0]),'Approve Video Plan');await h.click();assert.equal(words(h.primary()[0]),'Create Videos');assert.equal(h.w.plan.approved,true);
 await h.click(true);assert.equal(h.calls.filter(c=>c.url.endsWith('/creative/render')).length,7);for(const c of h.calls.filter(c=>c.url.endsWith('/creative/render'))){validateFinishing(c.finishing,c.durationSeconds);assert.equal(c.finishing.brandText,'Fixture Channel');assert.equal(c.finishing.channelId,'fixture-channel');assert.equal(c.finishing.dnaRevision,3);}assert.deepEqual(h.calls.filter(c=>c.url.includes('/api/channel-context')).map(c=>c.layout),['landscape',...Array(6).fill('portrait')]);assert.equal(words(h.primary()[0]),'Approve reviewed videos');assert.equal(Object.keys(h.videos.approved).length,0);assert.ok(h.progress.some(s=>s.includes('Creating your videos… 1 of 7 complete')));
 await h.reopen();assert.equal(words(h.primary()[0]),'Approve reviewed videos');await h.click();assert.equal(words(h.primary()[0]),'Continue to Social →');await h.click();assert.equal(h.continued,1);
});
test('hybrid supplied full and Shorts 1–2 create only four missing outputs, without their visuals',async()=>{const h=harness({hybrid:true});h.w.slots=h.w.slots.map(s=>s.kind==='scene'||s.kind==='short'&&s.number<=2?{...s,approvedId:undefined,candidates:[]}:s);await h.flush();await h.click();assert.equal(words(h.primary()[0]),'Create 4 Missing Videos');await h.click();assert.deepEqual(h.calls.filter(c=>c.url.endsWith('/creative/render')).map(c=>c.slot),[3,4,5,6]);await h.click();assert.equal(words(h.primary()[0]),'Continue to Social →');for(const slot of [0,1,2])assert.equal(h.videos.approved[model.outputNames[slot]],'supplied-'+slot);});
test('uncertain render stops, never retries, reload derives only remaining outputs',async()=>{const h=harness({failAt:3});h.w.plan.approved=true;await h.flush();await h.click();assert.equal(h.calls.filter(c=>c.url.endsWith('/creative/render')).length,3);assert.match(h.text,/Creation stopped/);assert.equal(words(h.primary()[0]),'Reload saved videos');await h.click();assert.equal(words(h.primary()[0]),'Create 5 Missing Videos');await h.click();assert.equal(h.calls.filter(c=>c.url.endsWith('/creative/render')).length,8);});
test('Style presence, signed URL refresh and optional direction edits do not change render dependencies',()=>{const {w,assets,videos}=fixture();w.plan.approved=true;const original=model.outputKey(w,1,model.finalAudioKey(assets.audio));assets.styles=[{id:'style'}];assets.audio.url='renewed-signed-url';w.bible='optional edited direction';assert.equal(model.outputKey(w,1,model.finalAudioKey(assets.audio)),original);assert.equal(model.videoReadiness(w,assets,videos).missing.every(o=>!o.blocker),true);assets.audio.storagePath='replacement';assert.equal(model.videoReadiness(w,assets,videos).missing[0].blocker.kind,'analysis');});
test('release summary and Visuals agree about hybrid requirements; missing scene cannot be skipped on reopen',()=>{const {w,assets}=fixture();w.slots[0].approvedId=undefined;assert.equal(releaseGaps({},assets,false).next,'Visuals');assets.fullVideos=[{_approved:true,_source:'uploaded'}];assert.equal(releaseGaps({},assets,false).next,'Video & Shorts');assets.styles=[];assert.equal(releaseGaps({},assets,false).next,'Video & Shorts');});
test('refresh never syncs failed reads or unchanged keys; genuine audio replacement updates keys',()=>{const {w,assets}=fixture();const keys=Object.fromEntries(model.outputNames.map((name,slot)=>[name,model.outputKey(w,slot,model.finalAudioKey(assets.audio))]));assert.equal(model.dependencySyncKeys(w,null,{keys}),null);assert.equal(model.dependencySyncKeys(undefined,{asset:assets.audio},{keys}),null);assert.equal(model.dependencySyncKeys(w,{asset:assets.audio},{keys}),null);assets.audio.url='renewed';assert.equal(model.dependencySyncKeys(w,{asset:assets.audio},{keys}),null);assets.audio.updatedAt='new-version';assert.equal(Object.keys(model.dependencySyncKeys(w,{asset:assets.audio},{keys})).length,7);});
test('stale creative approval cannot be revived by legacy inventory; supplied approvals stay independent',()=>{const {w,assets,videos}=fixture();const v={id:'old',slot:0,source:'generated',dependencyKey:'old-key'};videos.versions=[v];assets.fullVideos=[{...v,_source:'generated',_approved:true}];assert.equal(model.suppliedOutput(w,assets,0,videos),false);videos.approved.full='old';assert.equal(model.suppliedOutput(w,assets,0,videos),false);v.source='uploaded';assert.equal(model.suppliedOutput(w,assets,0,videos),true);});
test('all seven supplied outputs continue without workspace setup, audio, direction or timing requirements',async()=>{const h=harness({hybrid:true});for(const slot of [3,4,5,6]){h.videos.versions.push({id:'supplied-'+slot,slot,source:'uploaded',dependencyKey:'supplied'});h.videos.approved[model.outputNames[slot]]='supplied-'+slot;}h.w.slots=[];delete h.w.plan;delete h.w.analysis;h.assets.audio=null;await h.flush();assert.equal(words(h.primary()[0]),'Continue to Social →');await h.click();assert.equal(h.continued,1);assert.equal(h.calls.length,0);});
test('a genuinely missing visual is named precisely; artwork and optional direction never gate an otherwise ready render',()=>{const {w,assets}=fixture();w.plan.approved=true;delete w.slots.find(s=>s.id==='short-3').approvedId;assert.match(model.renderPrerequisite(w,assets.audio,3).message,/Approve Short 3/);assert.equal(model.renderPrerequisite(w,assets.audio,2),null);assets.artwork=[];w.bible='';w.approvedBible=undefined;assert.equal(model.renderPrerequisite(w,assets.audio,0),null);});

test('each finished output exposes upload, preview and download; uploaded edit and preserved approval survive reopen',async()=>{
 const h=harness();h.w.plan.approved=true;await h.flush();await h.click();await h.click();
 let labels=nodes(h.tree).filter(n=>n.type==='label'&&words(n)==='Upload Edited Version');assert.equal(labels.length,7);
 assert.equal(nodes(h.tree).filter(n=>n.type==='a'&&words(n)==='Download').length,7);
 h.videos.versions.push({id:'edited-6',slot:6,source:'uploaded',dependencyKey:'supplied',fileUrl:'http://fixture/edited.mp4'});
 await h.reopen();assert.match(h.text,/Uploaded edit · Current review candidate/);assert.match(h.text,/previous approved version remains selected/);
 const article=nodes(h.tree).find(n=>n.type==='article'&&nodes(n).some(x=>x.type==='video'&&x.props.src==='http://fixture/edited.mp4'));
 const approve=nodes(article).find(n=>n.type==='button'&&words(n)==='Approve this version');approve.props.onClick();await h.flush();assert.equal(h.videos.approved['short-6'],'edited-6');
 await h.reopen();assert.match(h.text,/Approved for publishing/);assert.equal(h.videos.approved.full,'render-0');assert.equal(words(h.primary()[0]),'Continue to Social →');
});

test('file input uploads full video candidate without approval or regeneration; invalid file stays local',async()=>{
 const h=harness();h.w.plan.approved=true;await h.flush();await h.click();await h.click();
 const before={...h.videos.approved},count=h.calls.length;
 const input=()=>nodes(h.tree).find(n=>n.type==='input'&&n.props['aria-label']==='Upload Edited Version for Full video');
 input().props.onChange({target:{files:[{type:'image/png',size:12,name:'wrong.png'}],value:'wrong.png'}});await h.flush();assert.match(h.text,/Choose a non-empty MP4 or MOV/);assert.equal(h.calls.length,count);
 input().props.onChange({target:{files:[{type:'video/mp4',size:12,name:'edit.mp4'}],value:'edit.mp4'}});await h.flush();assert.equal(h.calls.length,count+1);assert.deepEqual(h.videos.approved,before);assert.equal(h.videos.versions.at(-1).id,'edited-0');assert.match(h.text,/Full video uploaded as a new version/);
 await h.reopen();assert.match(h.text,/Uploaded edit · Current review candidate/);
});

test('three-state control shows effective choice, persists false and default, and gates rendering on current reviewed cues',async()=>{
 const h=harness({structured:true});h.w.plan.approved=true;await h.flush();
 const choice=()=>nodes(h.tree).find(n=>n.type==='select'&&n.props['aria-label']==='Add subtitles to video');
 assert.equal(choice().props.value,'default');assert.match(h.text,/Effective subtitles: On/);assert.match(h.text,/Subtitles are enabled, but reviewed lyric timings are required/);assert.equal(h.primary()[0].props.disabled,true);
 choice().props.onChange({target:{value:'off'}});await h.flush();assert.equal(h.w.subtitlesEnabled,false);assert.match(h.text,/Effective subtitles: Off/);assert.equal(h.primary()[0].props.disabled,false);await h.click();assert.equal(h.calls.filter(c=>c.url.endsWith('/creative/render')).length,7);assert.ok(h.calls.filter(c=>c.url.endsWith('/creative/render')).every(c=>c.finishing.subtitles===false));
 choice().props.onChange({target:{value:'on'}});await h.flush();assert.equal(h.w.subtitlesEnabled,true);assert.equal(h.primary()[0].props.disabled,true);
 choice().props.onChange({target:{value:'default'}});await h.flush();assert.equal(h.w.subtitlesEnabled,undefined);assert.match(h.text,/Effective subtitles: On/);
 const source=h.w.subtitleContext.cueContext.source;h.w.lyricCueReview={version:1,source,reviewed:true,cues:[{lineIndex:0,text:'Synthetic lyric',start:3,end:8}]};await h.reopen();assert.equal(h.primary()[0].props.disabled,false,h.text);await h.click();const rendered=h.calls.filter(c=>c.url.endsWith('/creative/render')&&c.finishing.subtitles);assert.equal(rendered.length,7);assert.ok(rendered.every(c=>c.finishing.cues[0].text==='Synthetic lyric'));assert.equal(h.w.lyricCueReview.reviewed,true);
});
