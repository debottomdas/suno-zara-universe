import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import ts from 'typescript';import sharp from 'sharp';import {createRequire} from 'node:module';
const native=createRequire(import.meta.url),cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const ctx={exports:{},process,structuredClone,Buffer,Date,TextEncoder,require:n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):native(n)};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,ctx);cache.set(file,ctx.exports);return ctx.exports;}
const scene=load('utils/creative/scene-plan.ts'),brand=load('utils/creative/branding.ts'),f=JSON.parse(fs.readFileSync('tests/fixtures/visual-bengali.json','utf8'));
const plan=()=>scene.makeScenePlan(f.input,f.slots,f.scenes,true);
test('actual Bengali sources yield 16 concrete distinct scene prompts, with continuity rather than repeated staging',()=>{
 const p=plan(),prompts=p.scenes.map(s=>scene.sceneImagePrompt(f.input,s,f.slots.find(q=>q.id===s.slotId)));
 assert.equal(p.scenes.length,16);assert.equal(new Set(prompts).size,16);assert.equal(new Set(p.scenes.map(s=>s.action)).size,16);assert.equal(new Set(p.scenes.map(s=>s.beat)).size,16);assert.ok(new Set(p.scenes.map(s=>s.location)).size>8);
 for(let i=0;i<p.scenes.length;i++){const s=p.scenes[i];assert.ok(prompts[i].includes(s.action));assert.ok(prompts[i].includes(s.location));assert.ok(prompts[i].includes(s.beat));assert.ok(prompts[i].includes(f.input.channel.channelName));}
 assert.ok(prompts[1].indexOf('Remembered comfort under one umbrella')<prompts[1].indexOf('Continuity Bible'));
 assert.ok(scene.continuityBible(f.input.bible).length<f.input.bible.length);assert.ok(scene.continuityBible(f.input.bible).includes('MAIN PROTAGONIST'));assert.ok(!scene.continuityBible(f.input.bible).includes('## PRIMARY APARTMENT'));
 assert.ok(scene.scenePlanInstructions(f.input,f.slots).includes(JSON.stringify(f.input.lyrics)));
});
test('repeated staging and camera-only changes are rejected before image generation',()=>{
 const repeated=structuredClone(f.scenes);repeated[1]={...repeated[0],slotId:repeated[1].slotId,beat:'He remains alone contemplating a different unresolved question',composition:'Close-up portrait from a different camera angle'};
 assert.throws(()=>scene.makeScenePlan(f.input,f.slots,repeated),/Repetitive scenes/);
 repeated[1].beat=repeated[0].beat;assert.throws(()=>scene.makeScenePlan(f.input,f.slots,repeated),/Repetitive narrative/);
 const fake=structuredClone(f.scenes);fake[0].evidence[0].quote='Invented lyrics not present in this song';assert.throws(()=>scene.makeScenePlan(f.input,f.slots,fake),/exact approved source/);
});
test('missing, unreviewed and stale source or active channel/DNA are blocked',()=>{
 const w={slots:f.slots};assert.throws(()=>scene.requireScenePlan(f.input,w,'scene-1'),/approve/);
 w.scenePlan={...plan(),reviewed:false};assert.throws(()=>scene.requireScenePlan(f.input,w,'scene-1'),/approve/);w.scenePlan=plan();
 assert.equal(scene.requireScenePlan(f.input,w,'scene-1').slotId,'scene-1');
 for(const key of ['lyrics','context','instructions','bible'])assert.throws(()=>scene.requireScenePlan({...f.input,[key]:f.input[key]+' changed'},w,'scene-1'),/changed/);
 for(const channel of [{...f.input.channel,channelId:'22222222-2222-4222-8222-222222222222'}, {...f.input.channel,dnaRevision:3},{...f.input.channel,channelName:'Future Channel'}])assert.throws(()=>scene.requireScenePlan({...f.input,channel},w,'scene-1'),/changed/);
 const changed=structuredClone(f.input);changed.channel.dna.sections.visual.fields.direction+=' New identity rule.';assert.throws(()=>scene.requireScenePlan(changed,w,'scene-1'),/changed/);
});
test('required channel name is deterministically composited into pixels for each active channel',async()=>{
 const base=await sharp({create:{width:640,height:480,channels:3,background:'#315370'}}).png().toBuffer();
 const c=structuredClone(f.input.channel);c.dna.sections.visual.rules.push({id:'mandatory-brand',text:'Channel Name branding on every visual',strength:'required',locked:true,stages:['visual']});
 const out=await brand.finishVisual(base,640,480,c);assert.equal(out.branding.required,true);assert.equal(out.branding.applied,true);assert.equal(out.branding.text,c.channelName+'\n'+c.dna.sections.visual.fields.brandText);assert.notDeepEqual(out.image,base);
 const original=await sharp(base).raw().toBuffer(),finished=await sharp(out.image).removeAlpha().raw().toBuffer();assert.deepEqual(finished.subarray(0,640*3),original.subarray(0,640*3),'outside overlay stays unchanged');assert.notDeepEqual(finished,original,'final pixels include overlay');
 const future=structuredClone(c);future.channelId='22222222-2222-4222-8222-222222222222';future.channelName='Future Channel';future.dna.sections.visual.fields.brandText='Future identity';
 const second=await brand.finishVisual(base,640,480,future);assert.equal(second.branding.channelId,future.channelId);assert.equal(second.branding.text,'Future Channel\nFuture identity');assert.notDeepEqual(second.image,out.image);
 assert.ok(!second.branding.text.includes(c.channelName));
 c.dna.sections.visual.fields.watermark='off';assert.throws(()=>brand.visualBranding(c),/conflicting/);
});
test('branding assets are owner/channel scoped and fail closed before provider spending',async()=>{
 const c=structuredClone(f.input.channel);c.dna.assets=[{role:'logo',mediaAssetId:'logo-id',expectedSha256:'0'.repeat(64)}];const filters=[];
 const q={select(){return this;},in(){return this;},eq(k,v){filters.push([k,v]);return this;},then(ok){return Promise.resolve({data:[],error:null}).then(ok);}};
 await assert.rejects(()=>brand.visualBrandAssets({from:()=>q},'owner',c),/active channel/);
 assert.ok(filters.some(([k,v])=>k==='songs.channel_id'&&v===c.channelId));assert.ok(filters.some(([k,v])=>k==='songs.user_id'&&v==='owner'));assert.ok(filters.some(([k,v])=>k==='user_id'&&v==='owner'));
});

test('scene and short clean finishing retains normalization and never composites branding assets',async()=>{
 const bytes=await sharp({create:{width:80,height:40,channels:3,background:'#315370'}}).png().toBuffer();
 const c=structuredClone(f.input.channel);c.dna.sections.visual.rules.push({id:'mandatory',text:'Channel Name on every visual',strength:'required',locked:true,stages:['visual']});c.dna.sections.visual.fields.watermark='off';
 for(const [width,height] of [[160,90],[90,160]]){
  const expected=await sharp(bytes).rotate().resize(width,height,{fit:'cover'}).png().toBuffer();
  const result=await brand.finishVisual(bytes,width,height,c,[{role:'logo',bytes:Buffer.from('invalid logo'),expectedSha256:'0'.repeat(64)}],'clean-source');
  assert.deepEqual(result.image,expected);assert.equal(result.branding.applied,false);
  const meta=await sharp(result.image).metadata();assert.equal(meta.width,width);assert.equal(meta.height,height);assert.equal(meta.format,'png');
 }
});
test('explicit artwork finishing preserves prior cover and thumbnail composition',async()=>{
 const bytes=await sharp({create:{width:80,height:40,channels:3,background:'#315370'}}).png().toBuffer();
 for(const [width,height] of [[480,480],[640,360]]){
  const old=await brand.finishVisual(bytes,width,height,f.input.channel);
  const artwork=await brand.finishVisual(bytes,width,height,f.input.channel,[],'branded-artwork');
  assert.deepEqual(artwork.image,old.image);assert.equal(artwork.branding.applied,true);
 }
});
test('clean prompt policy overrides conflicting branding requests without dropping visual DNA',()=>{
 const input=structuredClone(f.input);input.channel.dna.sections.visual.fields.brandText='Render written channel name';input.channel.dna.sections.visual.fields.direction='Soft blue cinematic light';
 for(const kind of ['scene','short']){
  const prompt=scene.sceneImagePrompt(input,f.scenes[0],{...f.slots[0],kind});
  assert.match(prompt,/CLEAN VIDEO SOURCE — overrides/);assert.match(prompt,/Do not render any written words, song title, channel name, lettering, logo or watermark text/);assert.match(prompt,/Soft blue cinematic light/);
  assert.ok(!prompt.includes('composited deterministically onto the final image'));
 }
 for(const kind of ['cover','thumbnail'])assert.match(scene.sceneImagePrompt(input,f.scenes[0],{...f.slots[0],kind}),/composited deterministically onto the final image/);
});
