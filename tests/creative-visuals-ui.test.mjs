import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(file,modules={},globals={}) {
 const ctx={exports:{},require:name=>modules[name],console,...globals};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,ctx);
 return ctx.exports;
}
const model=load('utils/creative/model.ts');
const batch=load('utils/creative/visual-batch.ts',{'./model':model});
const jsx=(type,props)=>({type,props});
function nodes(tree){if(!tree||typeof tree!=='object')return [];if(Array.isArray(tree))return tree.flatMap(nodes);return [tree,...nodes(tree.props?.children)];}
function words(tree){if(tree==null||typeof tree==='boolean')return '';if(typeof tree!=='object')return String(tree);if(Array.isArray(tree))return tree.map(words).join('');return words(tree.props?.children);}
function harness({hybrid=false,finished=false,failAt=0,approved=true,empty=false}={}){
 let w={...model.emptyWorkspace(),revision:1,scenePlan:{reviewed:true,scenes:[]},bible:empty?'':'World',approvedBible:approved&&!empty?'World':undefined,slots:model.makeSlots(empty?300:60,'')};
 const candidate=id=>({id,source:'uploaded',url:'https://fixture.test/'+id,storagePath:id,prompt:'Existing',width:1080,height:1920});
 const assets={images:[],artwork:[],fullVideos:[],shorts:[]};
 if(hybrid){assets.artwork=[{mediaKind:'cover-art',id:'supplied-cover'}];for(const id of ['short-1','short-2']){const slot=w.slots.find(s=>s.id===id);slot.candidates=[candidate(id)];slot.approvedId=id;}}
 if(finished){assets.fullVideos=[{_approved:true,_source:'uploaded'}];assets.shorts=[1,2].map(slot=>({slot,_approved:true,_source:'uploaded'}));}
 const original=JSON.stringify(w.slots.filter(s=>['short-1','short-2'].includes(s.id)));
 let cursor=0,values=[],deps=[],effects=[],tree,continued=0,calls=[],generated=0,refreshes=0,observations=[];
 const hooks={useState:init=>{const i=cursor++;if(!(i in values))values[i]=typeof init==='function'?init():init;return [values[i],next=>{values[i]=typeof next==='function'?next(values[i]):next;}];},useRef:init=>{const i=cursor++;return values[i]??=( {current:init});},useEffect:(fn,next)=>{const i=cursor++;if(!deps[i]||next.some((d,j)=>d!==deps[i][j])){deps[i]=next;effects.push(fn);}}};
 const fetch=async(url,options)=>{
  if(url.includes('/creative/status'))return Response.json({versions:[],approved:{},keys:{}});
  if(url.includes('/creative/sync'))return Response.json({});
  if(!options)return Response.json({workspace:w});
  const body=JSON.parse(options.body);calls.push(body);assert.equal(body.revision,w.revision);
  const slot=w.slots.find(s=>s.id===body.slotId);
  if(body.action==='generate'){
   assert.equal(body.confirmPaid,true);assert.equal(body.missingOnly,true);assert.equal(slot.candidates.length,0);
   generated++;if(generated===failAt)return Response.json({error:'Fixture generation interrupted'},{status:400});
   slot.candidates.push({...candidate('generated-'+slot.id),source:'generated'});w.revision+=2;
  }else if(body.action==='approve-image'){slot.approvedId=body.candidateId;w.revision++;}
  else if(body.action==='direction'){if(w.instructions!==body.instructions)delete w.approvedBible;w.instructions=body.instructions;w.bible=body.bible;if(body.approve){assert.ok(w.bible.trim());w.approvedBible=w.bible;}w.revision++;}
  else if(body.action==='propose-direction'){w.bible='Proposed characters, wardrobe and world';w.slots.forEach(s=>s.prompt='Suggested '+s.id);w.revision+=2;}
  else throw Error('Unexpected mutation '+body.action);
  observations.push(words(render())); // Observe intermediate progress while the request is in flight.
  return Response.json({workspace:w});
 };
 const Component=load('components/creative/CreativeStudio.tsx',{'react':hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'@/utils/creative/model':model,'@/utils/creative/visual-batch':batch,'./CreativeStudio.module.css':{default:{}},'@/utils/supabase/client':{}},{fetch,Response,Error}).default;
 const props={projectId:'fixture',title:'Fixture',lyrics:'',stage:'Visuals',assets,onNavigate:()=>{},onContinue:()=>continued++,onRefresh:()=>{refreshes++;for(const slot of w.slots.filter(s=>['cover','thumbnail'].includes(s.kind)&&s.approvedId)){if(!assets.artwork.some(a=>a.mediaKind===(slot.kind==='cover'?'cover-art':'thumbnail')))assets.artwork.push({mediaKind:slot.kind==='cover'?'cover-art':'thumbnail'});}}};
 function render(){cursor=0;tree=Component(props);return tree;}
 async function flush(){for(let i=0;i<8;i++){render();const queued=effects;effects=[];queued.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));}render();}
 const actions=()=>nodes(tree).filter(n=>n.type==='section'&&n.props['aria-label']==='Visuals next step').map(n=>nodes(n).filter(x=>x.type==='button').at(-1));
 async function clickPrimary(double=false){const buttons=actions();assert.equal(buttons.length,2);assert.equal(words(buttons[0]),words(buttons[1]));assert.equal(buttons[0].props.disabled,false);buttons[0].props.onClick();if(double)buttons[1].props.onClick();await flush();}
 return {flush,clickPrimary,actions,render,observations,reopen:async()=>{values=[];deps=[];effects=[];await flush();},get tree(){return tree;},get calls(){return calls;},get w(){return w;},get continued(){return continued;},get refreshes(){return refreshes;},original};
}

test('top and bottom mirror Generate → review → Continue, with progressively filled card props',async()=>{
 const h=harness();await h.flush();assert.equal(h.calls.length,0,'mount never generates');assert.equal(words(h.actions()[0]),'Generate 10 Missing Visuals');
 await h.clickPrimary(true);assert.equal(h.calls.filter(c=>c.action==='generate').length,10);assert.equal(words(h.actions()[0]),'Approve reviewed visuals');
 const cards=nodes(h.tree).filter(n=>typeof n.type==='function'&&n.type.name==='VisualCard');assert.equal(cards.length,10);assert.ok(cards.every(c=>c.props.slot.candidates[0].url));
 assert.ok(h.observations.some(text=>text.includes('Creating your visuals… 1 of 10 complete')));
 assert.ok(h.w.slots.every(s=>!s.approvedId));await h.clickPrimary();assert.equal(words(h.actions()[0]),'Continue to Video & Shorts →');await h.clickPrimary();assert.equal(h.continued,1);
});
test('hybrid existing cover and Shorts 1–2 remain untouched; both CTAs show the actual missing count',async()=>{
 const h=harness({hybrid:true});await h.flush();assert.equal(words(h.actions()[0]),'Generate 7 Missing Visuals');await h.clickPrimary();
 assert.equal(h.calls.filter(c=>c.action==='generate').length,7);assert.equal(JSON.stringify(h.w.slots.filter(s=>['short-1','short-2'].includes(s.id))),h.original);
 assert.ok(h.calls.every(c=>!['cover','short-1','short-2'].includes(c.slotId)));await h.clickPrimary();assert.equal(words(h.actions()[1]),'Continue to Video & Shorts →');
});
test('unapproved direction exposes approval; partial failure preserves filled cards and prevents accidental retry',async()=>{
 const draft=harness({approved:false});await draft.flush();assert.ok(draft.actions().every(b=>!b.props.disabled));assert.equal(words(draft.actions()[0]),'Approve Direction');assert.equal(draft.calls.length,0);
 const h=harness({failAt:3});await h.flush();await h.clickPrimary();assert.equal(h.calls.length,3);assert.equal(h.w.slots.filter(s=>s.candidates.length).length,2);
 assert.ok(h.actions().every(b=>b.props.disabled));assert.match(words(h.tree),/Batch stopped/);await h.flush();assert.equal(h.calls.length,3);
});

test('supplied full video and Shorts exclude their visual prerequisites from generation',async()=>{
 const h=harness({hybrid:true,finished:true});await h.flush();assert.equal(words(h.actions()[0]),'Generate 5 Missing Visuals');await h.clickPrimary();
 assert.deepEqual(h.calls.map(c=>c.slotId),['short-3','short-4','short-5','short-6','thumbnail']);await h.clickPrimary();assert.equal(words(h.actions()[0]),'Continue to Video & Shorts →');
});

test('fresh 18-slot workspace exposes generation, persists candidate on reopen and unlocks missing visuals only after approval',async()=>{
 const h=harness({empty:true});await h.flush();assert.equal(h.w.slots.length,18);assert.equal(h.calls.length,0);
 assert.equal(words(h.actions()[0]),'Generate Visual Direction');
 const editor=nodes(h.tree).find(n=>n.type==='details'&&words(n).includes('Write your own direction'));assert.equal(editor.props.open,true);
 await h.clickPrimary(true);assert.deepEqual(h.calls.map(c=>c.action),['propose-direction']);assert.match(words(h.tree),/Proposed characters, wardrobe and world/);assert.equal(h.w.approvedBible,undefined);
 await h.reopen();assert.equal(words(h.actions()[0]),'Approve Direction');assert.equal(h.calls.length,1);
 await h.clickPrimary();assert.equal(h.w.approvedBible,h.w.bible);assert.equal(words(h.actions()[0]),'Generate 18 Missing Visuals');
 const saved=JSON.stringify(h.w);await h.reopen();assert.equal(JSON.stringify(h.w),saved);assert.equal(h.calls.length,2);
});
test('manual direction supports Save and Save & Approve, and edited instructions are saved before suggestion',async()=>{
 const h=harness({empty:true});await h.flush();
 const edit=(label,value)=>{nodes(h.tree).find(n=>n.type==='textarea'&&n.props['aria-label']===label).props.onChange({target:{value}});h.render();};
 edit('Visual Direction / Character & World Bible','My manually written world');
 const save=nodes(h.tree).find(n=>n.type==='button'&&words(n)==='Save edits');assert.equal(save.props.disabled,false);save.props.onClick();await h.flush();assert.equal(h.w.approvedBible,undefined);
 await h.reopen();assert.match(words(h.tree),/My manually written world/);
 edit('Visual Direction / Character & World Bible','Revised world');assert.equal(words(h.actions()[0]),'Save & Approve Direction');await h.clickPrimary();assert.equal(h.w.approvedBible,'Revised world');assert.ok(h.calls.every(c=>c.action==='direction'));
 const g=harness({empty:true});await g.flush();nodes(g.tree).find(n=>n.type==='textarea'&&n.props['aria-label']==='Creative Instructions (optional)').props.onChange({target:{value:'Blue palette'}});g.render();await g.clickPrimary();assert.deepEqual(g.calls.map(c=>c.action),['direction','propose-direction']);assert.equal(g.w.instructions,'Blue palette');
});
