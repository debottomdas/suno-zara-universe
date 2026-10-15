import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path,modules={}) { const context={exports:{},require:n=>modules[n],console,Date,Request,Response};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports; }
const {readLyricsFile}=load('utils/lyrics-import.ts');
test('TXT import preserves multilingual lyrics and normalizes line endings without saving',async()=>{assert.equal(await readLyricsFile({name:'song.TXT',size:40,text:async()=> '\uFEFF[Verse]\r\nবাংলা गीत\rHello'}),'[Verse]\nবাংলা गीत\nHello');});
test('unsupported, empty, oversized and non-text imports fail for review',async()=>{for(const file of [{name:'song.pdf',size:10,text:async()=>'%PDF'},{name:'song.docx',size:10,text:async()=>''},{name:'song.txt',size:1048577,text:async()=>''},{name:'song.txt',size:0,text:async()=>''},{name:'song.txt',size:2,text:async()=>'\0'}])await assert.rejects(readLyricsFile(file));});
function harness({user='owner',channel='channel-a',songChannel='channel-a',versionError=false}={}) {
 const writes=[];
 const db={auth:{getUser:async()=>({data:{user:user?{id:user}:null}})},from(table){const filters={};let write;return{select(){return this},eq(k,v){filters[k]=v;return this},insert(value){write=value;writes.push({table,value});return table==='song_versions'?Promise.resolve({error:versionError?{}:null}):this},update(value){write=value;writes.push({table,value});return this},async single(){if(table==='channels')return{data:filters.id===channel&&filters['workspaces.owner_user_id']==='owner'?{id:channel}:null};if(write)return{data:{id:'new-song',...write}};return{data:filters.user_id==='owner'?{id:'song',channel_id:songChannel,title:'Original',lyrics:'Old lyrics'}:null};}}}};
 const modules={'next/server':{NextResponse:Response},'@/utils/supabase/server':{createClient:async()=>db}};
 return{writes,async call(path,body){const route=load(path,modules);const response=await route.POST(new Request('http://localhost/test',{method:'POST',body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};}};
}
test('fresh lyrics reuse import API and persist in the owned selected channel without hooks',async()=>{const h=harness();const result=await h.call('app/api/import-lyrics/route.ts',{channelId:'channel-a',title:'My song',lyrics:'Pasted lyrics'});assert.equal(result.status,200);assert.equal(result.body.project.lyrics,'Pasted lyrics');assert.equal(h.writes[0].value.channel_id,'channel-a');assert.equal(h.writes[0].value.user_id,'owner');assert.equal(h.writes[0].value.hooks.length,0);});
test('fresh import rejects unauthenticated and wrong-channel writes',async()=>{for(const config of [{user:null},{}]){const h=harness(config);const result=await h.call('app/api/import-lyrics/route.ts',{channelId:'channel-b',title:'My song',lyrics:'Lyrics'});assert.equal(result.status,config.user===null?401:403);assert.equal(h.writes.length,0);}});
test('edits preserve prior lyrics and reject cross-channel saves',async()=>{const h=harness();assert.equal((await h.call('app/api/songs/lyrics/route.ts',{projectId:'song',channelId:'channel-a',lyrics:'New lyrics'})).status,200);assert.equal(h.writes[0].table,'song_versions');assert.equal(h.writes[0].value.lyrics,'Old lyrics');assert.equal(h.writes[1].value.lyrics,'New lyrics');const other=harness();assert.equal((await other.call('app/api/songs/lyrics/route.ts',{projectId:'song',channelId:'channel-b',lyrics:'Wrong'})).status,403);assert.equal(other.writes.length,0);});
test('failed version preservation blocks edit',async()=>{const h=harness({versionError:true});assert.equal((await h.call('app/api/songs/lyrics/route.ts',{projectId:'song',lyrics:'New'})).status,500);assert.equal(h.writes.length,1);});

function panelHarness(overrides={}) {
 let values=[],index=0,tree;const calls=[];
 const react={useState(initial){const i=index++;if(!(i in values))values[i]=initial;return[values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v}]},useEffect(){},useRef(initial){const i=index++;return values[i]??=( {current:initial})}};
 const jsx=(_type,props)=>({type:_type,props});
 const context={exports:{},require:n=>n==='react'?react:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:n==='@/utils/lyrics-import'?{readLyricsFile}:n.endsWith('.css')?{default:{}}:{},console};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/universe-next/MusicNext.tsx','utf8')+'\nexport {IdeaLyricsPanel};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,context);
 const props={title:'My song',setTitle:()=>{},initialMode:'lyrics',idea:'',language:'English',script:'Native',mood:'',genre:'',busy:false,error:'',hooks:[],selectedHook:'',complete:false,canReturnToHooks:false,onSaveLyrics:async (text,advance)=>calls.push(['save',text,advance]),onGenerate:()=>calls.push(['generate']),onContinue:()=>calls.push(['continue']),...overrides};
 function render(){index=0;tree=context.exports.IdeaLyricsPanel(props);return tree}
 function nodes(node=tree){return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(n=>nodes(n)):[node,...nodes(node.props?.children??null)]}
 const text=node=>!node?'':typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):text(node.props?.children);
 render();return{props,calls,render,nodes,button:label=>nodes().find(n=>n.type==='button'&&text(n)===label),editor:()=>nodes().find(n=>n.props?.['aria-label']==='Full lyrics')};
}
test('supplied lyrics have one save-and-continue action and preserve exact text',async()=>{const h=panelHarness();const label='Save & Continue to Song Style →';assert.ok(h.editor());assert.equal(h.button(label).props.disabled,true);assert.equal(h.button('Save full lyrics'),undefined);const lyrics='  [Verse]\nবাংলা गीत\n  ';h.editor().props.onChange({target:{value:lyrics}});h.render();assert.equal(h.button(label).props.disabled,false);h.button(label).props.onClick();await new Promise(r=>setImmediate(r));assert.deepEqual(h.calls,[['save',lyrics,true]]);});
test('upload opens chooser and imports into same editor; generation is explicit',async()=>{const h=panelHarness();const input=h.nodes().find(n=>n.type==='input'&&n.props.type==='file');let clicked=false;input.props.ref.current={click:()=>{clicked=true}};h.button('Upload lyrics (TXT)').props.onClick();assert.equal(clicked,true);input.props.onChange({target:{files:[{name:'song.txt',size:10,text:async()=>'Uploaded lyrics'}],value:'song.txt'}});await new Promise(r=>setImmediate(r));h.render();assert.equal(h.editor().props.value,'Uploaded lyrics');assert.deepEqual(h.calls,[]);h.button('Generate from an idea').props.onClick();h.render();h.button('Generate 3 hooks →').props.onClick();assert.deepEqual(h.calls,[['generate']]);h.button('Write or paste lyrics').props.onClick();h.render();assert.equal(h.editor().props.value,'Uploaded lyrics');});
test('save failure retains editable text and keeps continuation blocked',async()=>{const h=panelHarness({onSaveLyrics:async()=>{throw Error('Save failed')}});h.editor().props.onChange({target:{value:'Keep my draft'}});h.render();h.button('Save & Continue to Song Style →').props.onClick();await new Promise(r=>setImmediate(r));h.render();assert.equal(h.editor().props.value,'Keep my draft');assert.equal(h.button('Continue to Song Style →'),undefined);});
test('saved lyrics expose the existing refine action without invoking generation',()=>{const h=panelHarness({complete:true,song:{id:'song',lyrics:'[Verse]\nSaved words'}});h.button('Refine a section').props.onClick();h.render();assert.ok(h.button('Refine section →'));assert.equal(h.button('Refine section →').props.disabled,true);assert.deepEqual(h.calls,[]);});

test('import and edit save all creative context using existing fields and preserve whitespace',async()=>{
 const context={title:'Window light',language:'Bengali',script:'Latin transliteration',mood:'Hopeful',genre:'Acoustic / unplugged',idea:'Intimate, gradually hopeful'};
 const lyrics='  [Verse]\nআমার গান\n  ';
 for(const path of ['app/api/import-lyrics/route.ts','app/api/songs/lyrics/route.ts']){
  const h=harness();const result=await h.call(path,{projectId:'song',channelId:'channel-a',lyrics,...context});assert.equal(result.status,200);
  const saved=h.writes.find(w=>w.table==='songs').value;for(const [key,value] of Object.entries(context))assert.equal(saved[key],value);assert.equal(saved.lyrics,lyrics);
 }
});
test('lyrics-only edit leaves omitted context untouched; explicit blank clears optional context',async()=>{
 const h=harness();await h.call('app/api/songs/lyrics/route.ts',{projectId:'song',lyrics:'Old lyrics',mood:'',genre:'',idea:''});const saved=h.writes.find(w=>w.table==='songs').value;assert.equal('title' in saved,false);assert.equal('language' in saved,false);assert.equal(saved.mood,'');assert.equal(h.writes.length,1);
});
test('Idea generation remains explicit and has no lyrics intake title control',()=>{const h=panelHarness({initialMode:'idea'});assert.ok(h.button('Generate 3 hooks →'));assert.equal(h.editor(),undefined);assert.deepEqual(h.calls,[]);});
