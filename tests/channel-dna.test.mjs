import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import crypto from 'node:crypto';
function load(file, modules = {}) {
  const ctx = { exports: {}, require: name => { if (!(name in modules)) throw Error(`Unexpected import: ${name}`); return modules[name]; }, Buffer, URL, Request, Response, TextDecoder, console };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
  return ctx.exports;
}
const model = load('utils/channel-dna/model.ts');
const validation = load('utils/channel-dna/validation.ts', { './model': model });
const compiler = load('utils/channel-dna/compile.ts', { './model': model, './validation': validation, 'node:crypto': crypto });
const server = load('utils/channel-dna/server.ts', { './validation': validation });
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const rule = (extra = {}) => ({ id: 'native-script', text: 'বাংলা — exact text!\nKeep every line.', strength: 'required', locked: false, stages: ['music', 'visual'], ...extra });
const doc = () => { const d = model.emptyDna(); d.sections.core.rules.push(rule()); return d; };
const body = (document = doc(), expectedRevision = null, lockChanges = []) => ({ document, expectedRevision, lockChanges, changeNote: 'Test' });
test('empty defaults are independent and legacy compilation injects nothing', () => {
  const a = model.emptyDna(), b = model.emptyDna(); a.sections.core.fields.purpose = 'X';
  assert.equal(b.sections.core.fields.purpose, ''); assert.equal(compiler.compileBrandContext(A, null, null, 'music'), null);
  assert.throws(() => compiler.compileBrandContext(A, 1, null, 'music'));
});
test('strict validation rejects unknown schema, unknown keys, duplicate IDs and unsafe references', () => {
  for (const mutate of [d => d.schemaVersion = 2, d => d.sections.core.rules[0].strength = ['required'], d => d.extra = true, d => d.sections.core.rules.push(rule()), d => d.sections.core.rules[0].stages = [], d => d.sections.core.rules[0].locked = 'false', d => d.sections.core.fields.purpose = 'x'.repeat(2001), d => d.assets.push({ id:'logo', url:'file:///secret' }), d => d.sections.publishing.fields.links = 'javascript:alert(1)', d => d.sections.publishing.fields.titleTemplate = '{unknown}']) {
    const d = doc(); mutate(d); assert.throws(() => validation.validateDna(d));
  }
  const valid = doc(); valid.sections.publishing.fields.titleTemplate = '{title} · {channelName}'; valid.sections.publishing.fields.links = 'https://example.com/about';
  assert.equal(validation.validateDna(valid).sections.core.rules[0].text, rule().text);
});
test('expected revision and explicit lock operations are strictly validated', () => {
  for (const revision of [0, -1, '1', 1.2, 2147483647, undefined]) assert.throws(() => validation.validateSave({ ...body(), expectedRevision: revision }));
  assert.throws(() => validation.validateSave({ ...body(), lockChanges: [{ id:'a',locked:true },{ id:'a',locked:false }] }));
  assert.equal(validation.validateSave(body()).expectedRevision, null);
});
test('locking requires explicit intent; unlock is its own revision before edits/deletion/movement', () => {
  const old = doc(), locked = doc(); locked.sections.core.rules[0].locked = true;
  assert.throws(() => validation.validateLockChanges(old, locked, []));
  validation.validateLockChanges(old, locked, [{id:'native-script',locked:true}]);
  for (const mutate of [d => d.sections.core.rules[0].text='Changed', d => d.sections.core.rules=[], d => {d.sections.visual.rules=d.sections.core.rules;d.sections.core.rules=[];}, d => d.sections.core.rules[0].stages=['social']]) {
    const changed = structuredClone(locked); changed.sections.core.rules[0].locked=false; mutate(changed);
    assert.throws(() => validation.validateLockChanges(locked, changed, [{id:'native-script',locked:false}]), /unlock/);
  }
  const unlocked = structuredClone(locked); unlocked.sections.core.rules[0].locked=false;
  validation.validateLockChanges(locked, unlocked, [{id:'native-script',locked:false}]);
  const edited=structuredClone(unlocked);edited.sections.core.rules[0].text='Changed after unlock';
  validation.validateLockChanges(unlocked,edited,[]);
  assert.throws(() => validation.validateLockChanges(unlocked,edited,[{id:'native-script',locked:false}]));
});
test('compiler is deterministic, pure, stage specific and preserves complete cross-section locked rules', () => {
  const d = doc(); d.sections.visual.rules.push(rule({id:'cross-section',locked:true,text:'Complete '.repeat(200)}));
  d.sections.musical.fields.vocals='Warm';d.sections.visual.fields.direction='Minimal';
  const snapshot=JSON.stringify(d), a=compiler.compileBrandContext(A,3,d,'music'), b=compiler.compileBrandContext(A,3,JSON.parse(snapshot),'music');
  assert.equal(a.prompt,b.prompt);assert.equal(JSON.stringify(d),snapshot);assert.equal(a.structured.rules.find(r=>r.id==='cross-section').text,'Complete '.repeat(200));
  assert.equal(a.structured.sections.visual,undefined);assert.equal(a.structured.sections.musical.vocals,'Warm');
  assert.equal(a.structured.dnaHash.length,64);assert.equal(a.structured.revision,3);assert.equal(a.structured.channelId,A);
  assert.notEqual(compiler.compileBrandContext(B,3,d,'music').prompt,a.prompt);
  const reordered=Object.fromEntries(Object.entries(d).reverse());assert.equal(compiler.compileBrandContext(A,3,reordered,'music').prompt,a.prompt);
});
function harness() {
  let actor='owner', failRpc=false, rpcCalls=0;
  const tables={ channels:[{id:A,name:'A',workspace_id:'wa',is_archived:false,active_dna_revision:null},{id:B,name:'B',workspace_id:'wb',is_archived:false,active_dna_revision:null}], workspaces:[{id:'wa',owner_user_id:'owner'},{id:'wb',owner_user_id:'other'}],channel_dna_versions:[],song_media_assets:[] };
  const db={auth:{getUser:async()=>({data:{user:actor?{id:actor}:null}})},from:table=>{
    assert.ok(table in tables,`No downstream access: ${table}`);let filters=[],single=false,sort=false,limit=Infinity;
    const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},order:()=>{sort=true;return q;},limit:n=>{limit=n;return q;},maybeSingle:()=>{single=true;return run();},then:(a,b)=>run().then(a,b)};
    async function run(){let rows=tables[table].filter(r=>filters.every(f=>f(r)));if(sort)rows=rows.toSorted((a,b)=>b.revision-a.revision);rows=rows.slice(0,limit);return {data:structuredClone(single?rows[0]??null:rows),error:null};}return q;
  }};
  const admin=()=>({rpc:async(name,p)=>{
    rpcCalls++;assert.equal(name,'save_channel_dna');
    const c=tables.channels.find(c=>c.id===p.p_channel_id),w=tables.workspaces.find(w=>w.id===c.workspace_id);
    if(w.owner_user_id!==p.p_actor_id||c.is_archived)return{error:{code:'42501'}};
    if(c.active_dna_revision!==p.p_expected_revision)return{error:{code:'40001'}};
    if(failRpc)return{error:{code:'XX000'}};
    const revision=(c.active_dna_revision??0)+1;
    tables.channel_dna_versions.push({channel_id:c.id,revision,document:structuredClone(p.p_document),lock_changes:p.p_lock_changes,created_at:'2026-10-03',created_by:p.p_actor_id,change_note:p.p_change_note});c.active_dna_revision=revision;
    return{data:revision,error:null};
  }});
  const route=load('app/api/channels/[channelId]/dna/route.ts',{'@/utils/supabase/server':{createClient:async()=>db},'@/utils/supabase/admin':{createAdminClient:admin},'@/utils/channel-dna/server':server,'@/utils/channel-dna/validation':validation,'@/utils/channel-dna/compile':compiler,'@/utils/channel-dna/model':model});
  const call=async(method,id=A,payload,query='')=>{const response=await route[method](new Request(`http://local/api/channels/${id}/dna${query}`,{method,...(payload===undefined?{}:{body:typeof payload==='string'||payload instanceof Uint8Array?payload:JSON.stringify(payload)})}),{params:Promise.resolve({channelId:id})});return{status:response.status,headers:response.headers,...await response.json()};};
  return{call,tables,setActor:x=>actor=x,fail:()=>failRpc=true,get rpcCalls(){return rpcCalls;}};
}
test('API requires authentication and workspace ownership for reads, saves and previews',async()=>{
  const h=harness();h.setActor(null);assert.equal((await h.call('GET')).status,401);h.setActor('owner');
  for(const method of ['GET','PUT','POST'])assert.equal((await h.call(method,B,method==='GET'?undefined:method==='PUT'?body():{document:doc(),stage:'music'})).status,404);
  assert.equal(h.rpcCalls,0);assert.equal((await h.call('GET','not-uuid')).status,400);
  h.tables.channels[0].is_archived=true;assert.equal((await h.call('PUT',A,body())).status,404);
});
test('no-DNA read does not create data; previews never write and are not cached',async()=>{
  const h=harness(),read=await h.call('GET');assert.equal(read.version,null);assert.equal(read.history.length,0);assert.equal(read.headers.get('cache-control'),'no-store');
  const preview=await h.call('POST',A,{document:doc(),stage:'music'});assert.equal(preview.status,200);assert.equal(preview.draft,true);assert.equal(h.rpcCalls,0);assert.equal(h.tables.channels[0].active_dna_revision,null);
});
test('API save/history retain immutable documents and isolate channel revisions',async()=>{
  const h=harness();assert.equal((await h.call('PUT',A,body())).revision,1);const next=doc();next.sections.core.fields.purpose='New';
  assert.equal((await h.call('PUT',A,body(next,1))).revision,2);
  const first=await h.call('GET',A,undefined,'?revision=1');assert.equal(first.version.document.sections.core.fields.purpose,'');
  assert.equal((await h.call('GET')).version.revision,2);assert.equal(h.tables.channels[1].active_dna_revision,null);
  assert.equal((await h.call('GET',A,undefined,'?revision=0')).status,400);
});
test('API concurrent saves: RPC conflict is surfaced; failed RPC does not claim activation (mock transaction)',async()=>{
  const h=harness();const results=await Promise.all([h.call('PUT',A,body()),h.call('PUT',A,body())]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal(h.tables.channel_dna_versions.length,1);
  h.fail();assert.equal((await h.call('PUT',A,body(doc(),1))).status,500);assert.equal(h.tables.channels[0].active_dna_revision,1);assert.equal(h.tables.channel_dna_versions.length,1);
});
test('API rejects forged locks, foreign media and malformed bodies before privileged writes',async()=>{
  const h=harness(),d=doc();d.sections.core.rules[0].locked=true;assert.equal((await h.call('PUT',A,body(d))).status,400);
  d.assets=[{id:'logo',mediaAssetId:B,role:'logo',expectedSha256:'a'.repeat(64)}];d.sections.core.rules[0].locked=false;
  assert.equal((await h.call('PUT',A,body(d))).status,404);assert.equal(h.rpcCalls,0);
  assert.equal((await h.call('PUT',A,'{bad')).status,400);assert.equal((await h.call('PUT',A,'x'.repeat(450001))).status,413);
});
test('migration contract restricts writes, locks ownership rows, guards activation and never touches outputs',()=>{
  const sql=fs.readFileSync('supabase/migrations/20261003_channel_dna_foundation.sql','utf8');
  for(const expected of ['for share of w','for update of c','current_revision is distinct from p_expected_revision','before update or delete','current_user <> \'postgres\'','from public, anon, authenticated','to service_role','foreign key (id, active_dna_revision)','w.owner_user_id=p_actor_id'])assert.ok(sql.includes(expected),expected);
  assert.match(sql,/insert into public\.channel_dna_versions[\s\S]*update public\.channels set active_dna_revision/);
  assert.doesNotMatch(sql,/(?:update|insert into|delete from) public\.(?:songs|song_media_assets|publishing_\w+)/);
});

async function editorHarness({ locked = false, conflict = false, delayedPreview = false, refreshFails = false } = {}) {
  const saved = doc(); saved.sections.core.rules[0].locked = locked;
  let record = { channel: { name: 'Test Channel', active_dna_revision: 1 }, version: { document: saved, revision: 1 }, history: [] };
  const listeners = {}, cleanups = {};
  let confirmResult = false, confirmCalls = 0, resolvePreview;
  const surface = prefix => ({addEventListener(name, fn) { listeners[prefix + name] = fn; },removeEventListener(name) { delete listeners[prefix + name]; }});
  class Element { closest() { return this; } }
  class HTMLAnchorElement extends Element {
    constructor(href, target = '') { super(); this.href = href; this.target = target; }
    hasAttribute() { return false; }
  }
  const values = [], effects = [], calls = []; let index = 0, tree;
  const react = {
    useState(initial) { const i = index++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], v => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial) { const i = index++; return values[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++; if (!(i in values) || deps.some((x,j)=>x!==values[i][j])) { values[i]=deps;effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const jsx=(type,props)=>({type,props});
  const fetch=async(url,options={})=>{
    calls.push({url,...options});
    if(options.method==='PUT') {
      const input=JSON.parse(options.body);
      if(conflict)return Response.json({error:'DNA changed. Reload latest.'},{status:409});
      record={...record,channel:{...record.channel,active_dna_revision:2},version:{document:input.document,revision:2}};
      return Response.json({revision:2});
    }
    if(options.method==='POST') { if (delayedPreview) return new Promise(resolve => { resolvePreview = () => resolve(Response.json({context:{prompt:'STALE preview'}})); }); return Response.json({context:{prompt:'Preview only'}}); }
    if (refreshFails && calls.some(c => c.method === 'PUT')) throw Error('Refresh failed');
    return Response.json(record);
  };
  const ctx={exports:{},require:n=>n==='react'?react:n==='react/jsx-runtime'?{jsx,jsxs:jsx}:n==='@/utils/channel-dna/model'?model:n==='@/utils/channel-dna/validation'?validation:{default:{}},fetch,crypto,AbortController,URL,Element,HTMLAnchorElement,window:{...surface('window:'),document:surface('document:'),navigation:surface('navigation:'),confirm:()=>{confirmCalls++;return confirmResult;},location:{href:`http://local/channels/${A}/identity`,reload(){}}},console};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/channels/ChannelIdentityEditor.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,ctx);
  function render(){index=0;tree=ctx.exports.default({channelId:A});const pending=effects.splice(0);pending.forEach(fn=>fn());}
  function nodes(node=tree){return !node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(nodes):[node,...nodes(node.props?.children ?? null)];}
  const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?text(node.props?.children):'';
  const button=title=>nodes().find(n=>n.type==='button'&&text(n)===title);
  const flush=async()=>{await new Promise(r=>setImmediate(r));render();};
  render();await flush();
  return {render,flush,nodes,button,calls,listeners,HTMLAnchorElement,
    confirm(value) { confirmResult = value; }, get confirmCalls() { return confirmCalls; },
    resolvePreview() { resolvePreview?.(); }, unmount() { Object.values(cleanups).forEach(fn => fn?.()); },text:()=>text(tree)};
}
test('editor unlock requires a saved revision before changing rule text',async()=>{
  const h=await editorHarness({locked:true});
  const textArea=()=>h.nodes().find(n=>n.type==='textarea'&&n.props.value===rule().text);
  assert.equal(textArea().props.disabled,true);h.button('Unlock rule').props.onClick();h.render();
  assert.equal(textArea().props.disabled,true,'pending unlock does not allow same-revision edit');
  h.button('Save & activate DNA').props.onClick();await h.flush();
  assert.equal(textArea().props.disabled,false);
  const put=h.calls.find(c=>c.method==='PUT');assert.deepEqual(JSON.parse(put.body).lockChanges,[{id:'native-script',locked:false}]);
  assert.match(h.text(),/Revision 2 saved/);
});
test('editor preserves the draft after conflicts and compiles only on explicit preview',async()=>{
  const h=await editorHarness({conflict:true});
  const field=h.nodes().find(n=>n.type==='textarea'&&!n.props.disabled);
  field.props.onChange({target:{value:'Keep this unsaved purpose'}});h.render();
  assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
  h.button('Save & activate DNA').props.onClick();await h.flush();
  assert.match(h.text(),/DNA changed/);assert.ok(h.nodes().some(n=>n.props?.value==='Keep this unsaved purpose'));
  h.button('Compile draft preview').props.onClick();await h.flush();
  assert.match(h.text(),/Preview only/);assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
});

test('malformed reader structures and lock changes fail before privileged writes', async () => {
  for (const mutate of [d => d.sections = {}, d => d.sections.core = null, d => d.sections.core.fields = [], d => delete d.sections.visual.fields.brandText, d => d.sections.core.rules = {}, d => d.sections.core.rules = [null], d => d.sections.musical.rules = [rule()], d => d.assets = null, d => d.sections.core.rules[0].stages = ['music','music']]) {
    const d = doc(); mutate(d); const h = harness();
    assert.equal((await h.call('PUT', A, body(d))).status, 400); assert.equal(h.rpcCalls, 0);
  }
  for (const changes of [null, {}, [null], [{id:'x'}], [{id:'x',locked:'false'}], [{id:'x',locked:true,extra:1}], [{id:'missing',locked:true}]]) {
    const h = harness(); assert.equal((await h.call('PUT', A, body(doc(),null,changes))).status,400); assert.equal(h.rpcCalls,0);
  }
});
test('Unicode is preserved exactly and unpaired surrogates fail preview and save', async () => {
  const valid = 'বাংলা हिन्दी 👩🏽‍🎤 e\u0301 é \uDBFF\uDFFF';
  const d = doc(); d.sections.core.fields.purpose = valid;
  assert.equal(validation.validateDna(d).sections.core.fields.purpose,valid);
  assert.equal(compiler.compileBrandContext(A,1,d,'music').structured.sections.core.purpose,valid);
  const h = harness(); assert.equal((await h.call('PUT',A,body(d))).status,200);
  assert.equal((await h.call('GET')).version.document.sections.core.fields.purpose,valid);
  for (const bad of ['\uD800','\uDC00','a\uD800z','\uD800\uD800','😀\uDC00']) {
    const d = doc(); d.sections.core.fields.purpose = bad; const h = harness();
    assert.equal((await h.call('PUT',A,body(d))).status,400);
    assert.equal((await h.call('POST',A,{document:d,stage:'music'})).status,400);
    assert.equal((await h.call('PUT',A,{...body(),changeNote:bad})).status,400); assert.equal(h.rpcCalls,0);
  }
});
test('revision bounds apply to reads, compiler, saves and terminal draft previews', async () => {
  const h = harness();
  for (const value of ['2147483648','9007199254740991','1.5','-1','01']) assert.equal((await h.call('GET',A,undefined,'?revision='+value)).status,400);
  assert.equal((await h.call('GET',A,undefined,'?revision=2147483647')).status,404);
  validation.validateSave(body(doc(),2147483646));
  assert.throws(()=>compiler.compileBrandContext(A,2147483648,doc(),'music'));
  h.tables.channels[0].active_dna_revision=2147483647;
  assert.equal((await h.call('POST',A,{document:doc(),stage:'music'})).status,409);
  assert.equal((await h.call('PUT',A,body(doc(),2147483647))).status,409); assert.equal(h.rpcCalls,0);
  for (const code of ['22P02','22003']) assert.throws(()=>server.databaseError({code}),e=>e.status===400);
  for (const code of ['54000','40P01']) assert.throws(()=>server.databaseError({code}),e=>e.status===409);
});
test('note-only edits are dirty; reverted notes clear guards; links and cancelable history respect discard',async()=>{
  const h = await editorHarness();
  const note = () => h.nodes().find(n=>n.type==='input'&&n.props.maxLength===500);
  note().props.onChange({target:{value:'A note'}});h.render();
  assert.match(h.text(),/Unsaved changes/); assert.equal(h.button('Save & activate DNA').props.disabled,false);
  let prevented=0, stopped=0;
  const click = {button:0,target:new h.HTMLAnchorElement('http://local/music-next'),preventDefault(){prevented++;},stopPropagation(){stopped++;}};
  h.listeners['document:click'](click); assert.equal(prevented,1);assert.equal(stopped,1);
  h.confirm(true);h.listeners['document:click'](click);assert.equal(prevented,1);
  h.confirm(false);
  for (const extra of [{ctrlKey:true},{button:1},{target:new h.HTMLAnchorElement('http://local/other','_blank')},{target:new h.HTMLAnchorElement(`http://local/channels/${A}/identity#section`)}]) h.listeners['document:click']({...click,...extra});
  assert.equal(h.confirmCalls,2);
  h.listeners['navigation:navigate']({navigationType:'traverse',cancelable:true,preventDefault(){prevented++;}});assert.equal(prevented,2);
  h.listeners['navigation:navigate']({navigationType:'traverse',cancelable:false});assert.equal(h.confirmCalls,3);
  note().props.onChange({target:{value:''}});h.render();assert.doesNotMatch(h.text(),/Unsaved changes/);assert.equal(h.listeners['document:click'],undefined);
  h.unmount();assert.equal(Object.keys(h.listeners).length,0);
});
test('late previews cannot reappear after save, including a failed history refresh',async()=>{
  for (const refreshFails of [false,true]) {
    const h=await editorHarness({delayedPreview:true,refreshFails});
    const note=h.nodes().find(n=>n.type==='input'&&n.props.maxLength===500);
    note.props.onChange({target:{value:'note only'}});h.render();
    h.button('Compile draft preview').props.onClick();
    h.button('Save & activate DNA').props.onClick();await h.flush();
    h.resolvePreview();await h.flush();
    assert.doesNotMatch(h.text(),/STALE preview|Unsaved changes/);assert.match(h.text(),/Revision 2 saved/);
    assert.equal(h.button('Save & activate DNA').props.disabled,true);
  }
});
test('SQL contract declares lifecycle exceptions, structural constraint and shared-first ordering (not database execution)',()=>{
  const sql=fs.readFileSync('supabase/migrations/20261003_channel_dna_foundation.sql','utf8');
  assert.match(sql,/references public.channels\(id\) on delete cascade/);
  assert.match(sql,/created_by uuid references auth.users\(id\) on delete set null/);
  assert.match(sql,/not exists \(select 1 from public.channels where id=old.channel_id\)/);
  assert.match(sql,/constraint channel_dna_structure_check/);
  assert.ok(sql.indexOf('for share of w') < sql.indexOf('for update of c'));
  for(const text of ['current_revision = 2147483647',"jsonb_typeof(item->'locked')",'any(ids)','any(change_ids)','any(asset_ids)']) assert.ok(sql.includes(text));
});

test('malformed UTF-8 request bytes are rejected rather than replaced', async () => {
  const h = harness();
  const bytes = Buffer.concat([Buffer.from('{"bad":"'), Buffer.from([0xc3,0x28]), Buffer.from('"}')]);
  assert.equal((await h.call('PUT',A,bytes)).status,400);
  assert.equal(h.rpcCalls,0);
});
test('extended publishing settings remain channel-scoped and legacy documents retain their exact compiler hash',()=>{const legacy=doc();for(const field of model.OPTIONAL_PUBLISHING_FIELDS)delete legacy.sections.publishing.fields[field];const before=JSON.stringify(legacy),valid=validation.validateDna(legacy);assert.equal(JSON.stringify(valid),before);const modern=doc();Object.assign(modern.sections.publishing.fields,{shortTitleTemplate:'{hook} · {shortNumber}',defaultPlaylistIds:'PL1234567890',privacyStatus:'private',relatedVideoPolicy:'required-studio'});assert.ok(validation.validateDna(modern));for(const change of [{privacyStatus:'invalid'},{defaultPlaylistIds:'bad url'},{relatedVideoPolicy:'invented-api'}]){const d=doc();Object.assign(d.sections.publishing.fields,change);assert.throws(()=>validation.validateDna(d));}});
