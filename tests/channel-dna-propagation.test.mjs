import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {assDocument,brandingRenderSpec,validateFinishing} from '../local-worker/music-finishing.mjs';
const native=createRequire(import.meta.url),cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const ctx={exports:{},structuredClone,TextEncoder,Date,require:n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):native(n)};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);cache.set(file,ctx.exports);return ctx.exports;}
const {emptyDna}=load('utils/channel-dna/model.ts'),{channelInstructions}=load('utils/channel-dna/instructions.ts'),{brandingFinishing}=load('utils/channel-dna/context.ts'),{applyChannelPublishing}=load('utils/channel-dna/social.ts'),{resolveActiveChannelDNA}=load('utils/channel-dna/server.ts');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333'];
function fixture(i){const dna=emptyDna(),channelName=['Bangla Channel','Hindi Channel','Bhakti Channel'][i];Object.assign(dna.sections.visual.fields,{brandText:'{channelName}',watermark:'bottom right opacity 35% size 28px',typography:'Arial',colours:'#123456 #ABCDEF',intro:'1 seconds',outro:'3 seconds'});Object.assign(dna.sections.publishing.fields,{titleTemplate:'{title} | {channelName}',descriptionTemplate:'{channelName}\n{songDescription}',shortTitleTemplate:'{hook} | {channelName}',shortDescriptionTemplate:'{channelName}\n{songDescription}',credits:`Credits ${i}`,footer:`Footer ${i}`,fixedHashtags:`#Channel${i}`,tags:`Tag ${i}`,relatedVideoPolicy:i===1?'none':'required-studio',destinationIds:`destination-${i}`,privacyStatus:'unlisted'});dna.sections.publishing.rules=[{id:'platform-rule',text:`TikTok: use ${channelName} in captions`,strength:'required',locked:true,stages:['social','publishing']}];return{channelId:ids[i],channelName,dnaRevision:7+i,dna};}
const song={id:'song',title:'Song',language:'hi'};
test('each active channel supplies its own identity, visual instructions and actual ASS branding',()=>{for(let i=0;i<3;i++){const c=fixture(i),prompt=channelInstructions(c,'visual'),f=brandingFinishing(c);assert.ok(prompt.includes(c.channelName));assert.ok(prompt.includes('bottom right'));assert.equal(f.channelId,ids[i]);assert.equal(f.brandText,c.channelName);assert.equal(f.brandAlignment,3);assert.equal(f.brandOpacity,.35);assert.equal(f.brandFontSize,28);validateFinishing(f,30);const ass=assDocument(f,30);assert.ok(ass.includes(c.channelName));assert.ok(ass.includes('\\alpha&Ha6&'));assert.ok(ass.includes(',3,100,'));for(let j=0;j<3;j++)if(j!==i)assert.ok(!ass.includes(fixture(j).channelName));}});
test('full video and Shorts render specs composite authorized branding files with original audio mapping',()=>{const f=brandingFinishing(fixture(0)),assets=[{role:'watermark',file:'/tmp/channel.png',mimeType:'image/png'},{role:'outro',file:'/tmp/outro.mp4',mimeType:'video/mp4'}];for(const slot of [0,1]){const spec=brandingRenderSpec(f,30,slot,assets,'/tmp/finishing.ass');assert.ok(spec.inputs.includes('/tmp/channel.png'));assert.ok(spec.filter.includes('overlay=x=W-w-60:y=H-h-60'));assert.ok(spec.filter.includes('colorchannelmixer=aa=0.35'));assert.ok(spec.filter.includes("between(t,27,30)"));assert.equal(spec.output,'[brand2]');}const worker=fs.readFileSync('local-worker/full-video-worker.mjs','utf8');assert.ok(worker.includes('ref.expectedSha256.toLowerCase()'));assert.ok(worker.includes("'-map','1:a:0'"));});
test('DNA can disable the watermark without injecting global branding',()=>{const c=fixture(0);c.dna.sections.visual.fields.watermark='none';c.dna.sections.visual.fields.intro='none';c.dna.sections.visual.fields.outro='none';const f=brandingFinishing(c);assert.equal(f.watermarkEnabled,false);assert.ok(!assDocument(f,30).includes(c.channelName));assert.ok(!brandingRenderSpec(f,30,0,[{role:'watermark',file:'/tmp/logo.png',mimeType:'image/png'}],'/tmp/x.ass').inputs.length);});
test('every platform receives templates, channel credits, fixed tags and related-video policy without extra LLM calls',()=>{for(let i=0;i<3;i++){const c=fixture(i);assert.ok(channelInstructions(c,'social').includes(`TikTok: use ${c.channelName}`));for(const platform of ['youtube_full','youtube_shorts','instagram','facebook','tiktok']){const raw=platform==='youtube_full'?{recommendedTitle:'Raw',fullDescription:'Creative',hashtags:['#Song']}:platform==='youtube_shorts'?{shorts:[{shortNumber:1,title:'Hook',description:'Creative'}]}:platform==='tiktok'?{posts:[{postNumber:1,caption:'Creative'}]}:{reels:[{reelNumber:1,caption:'Creative'}]};const pack=applyChannelPublishing(c,song,platform,raw),row=pack.shorts?.[0]||pack.posts?.[0]||pack.reels?.[0]||pack;assert.equal(pack.channelId,c.channelId);assert.ok((row.caption||row.description).includes(c.channelName));assert.ok((row.caption||row.description).includes(`Credits ${i}`));assert.ok(row.hashtags.includes(`#Channel${i}`));if(platform==='youtube_shorts'){assert.equal(row.relatedVideo.channelId,c.channelId);assert.equal(row.relatedVideo.required,i!==1);assert.equal(row.relatedVideo.dependency,i===1?'none':'publish-long-video-first');assert.deepEqual(Array.from(row.destinationIds),[`destination-${i}`]);}assert.equal(JSON.stringify(applyChannelPublishing(c,song,platform,pack)),JSON.stringify(pack),'normalization is idempotent');assert.throws(()=>applyChannelPublishing(fixture((i+1)%3),song,platform,pack),/another channel/);}}});
test('revision changes reapply from original copy and remove obsolete DNA credits',()=>{const c=fixture(0),old=applyChannelPublishing(c,song,'youtube_full',{title:'Raw',description:'Creative'});const next=structuredClone(c);next.dnaRevision++;next.dna.sections.publishing.fields.credits='New credit';const updated=applyChannelPublishing(next,song,'youtube_full',old);assert.ok(updated.description.includes('New credit'));assert.ok(!updated.description.includes('Credits 0'));assert.equal(updated.dnaRevision,next.dnaRevision);});
test('resolver performs one owned-channel and one active-revision load; it never reads provider credentials',async()=>{const queries=[];const contexts=ids.map((_,i)=>fixture(i));const db={from(table){const filters=[];queries.push({table,filters});const q={select(){return q},eq(k,v){filters.push([k,v]);return q},maybeSingle:async()=>{const id=filters.find(([k])=>k==='id')?.[1];if(table==='channels'){const c=contexts.find(c=>c.channelId===id);return{data:c?{id:c.channelId,name:c.channelName,workspace_id:'workspace',active_dna_revision:c.dnaRevision}:null};}if(table==='workspaces')return{data:filters.some(([k,v])=>k==='owner_user_id'&&v==='owner')?{id:'workspace'}:null};if(table==='channel_dna_versions'){const c=contexts.find(c=>filters.some(([k,v])=>k==='channel_id'&&v===c.channelId)&&filters.some(([k,v])=>k==='revision'&&v===c.dnaRevision));return{data:c?{document:c.dna}:null};}throw Error('Unexpected table');}};return q;}};for(const c of contexts){const start=queries.length,result=await resolveActiveChannelDNA(db,'owner',c.channelId);assert.equal(result.dnaRevision,c.dnaRevision);assert.equal(result.channelName,c.channelName);assert.deepEqual(queries.slice(start).map(q=>q.table),['channels','workspaces','channel_dna_versions']);assert.ok(!JSON.stringify(result).includes('access_token'));}await assert.rejects(()=>resolveActiveChannelDNA(db,'foreign',ids[0]),/Channel not found/);});

test('render context derives channel from owned song, authorizes assets in that channel and never returns credentials',async()=>{
 for(let i=0;i<3;i++)for(const foreignAsset of [false,true]){
  const c=fixture(i),mediaId='44444444-4444-4444-8444-444444444444';c.dna.assets=[{id:'mark',mediaAssetId:mediaId,role:'watermark',expectedSha256:'a'.repeat(64)}];
  const queries=[],signed=[];const db={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table){const filters=[];queries.push({table,filters});const q={select(){return q},eq(k,v){filters.push([k,v]);return q},in(k,v){filters.push([k,v]);return q},single:async()=>({data:{channel_id:c.channelId}}),maybeSingle:async()=>({data:table==='channels'?{id:c.channelId,name:c.channelName,workspace_id:'workspace',active_dna_revision:c.dnaRevision}:table==='workspaces'?{id:'workspace'}:{document:c.dna}}),then(resolve){assert.equal(table,'song_media_assets');assert.ok(filters.some(([k,v])=>k==='songs.channel_id'&&v===c.channelId));assert.ok(filters.some(([k,v])=>k==='songs.user_id'&&v==='owner'));return Promise.resolve({data:foreignAsset?[]:[{id:mediaId,mime_type:'image/png'}]}).then(resolve);}};return q;}};
  const ctx={exports:{},Response,URL,require:n=>({'@/utils/supabase/server':{createClient:async()=>db},'@/utils/channel-dna/server':{resolveActiveChannelDNA},'@/utils/channel-dna/context':{brandingFinishing},'@/utils/media-source':{buildMediaAssetResponse:async(db,a)=>{signed.push(a.id);return{url:'https://owned.example/mark.png'}}}})[n]};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/channel-context/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
  const response=await ctx.exports.GET(new Request(`http://local/api/channel-context?projectId=song&channelId=${ids[(i+1)%3]}`)),body=await response.json();
  assert.equal(response.status,foreignAsset?400:200);assert.equal(signed.length,foreignAsset?0:1);
  if(!foreignAsset){assert.equal(body.finishing.channelId,c.channelId);assert.equal(body.finishing.brandText,c.channelName);assert.equal(body.finishing.renderAssets[0].expectedSha256,'a'.repeat(64));assert.ok(!JSON.stringify(body).includes('access_token'));assert.equal(queries.filter(q=>q.table==='channels').length,1);assert.equal(queries.filter(q=>q.table==='channel_dna_versions').length,1);}
  assert.ok(queries.every(q=>['songs','channels','workspaces','channel_dna_versions','song_media_assets'].includes(q.table)));
 }
});
test('changing active DNA invalidates render dependency keys without signed URLs or credentials',()=>{
 const model=load('utils/creative/model.ts'),w=model.emptyWorkspace();w.channelBranding=brandingFinishing(fixture(0));const a=model.outputKey(w,0,'audio');w.channelBranding=brandingFinishing(fixture(1));assert.notEqual(model.outputKey(w,0,'audio'),a);assert.ok(!a.includes('access_token'));assert.ok(!a.includes('https://'));
});
test('explicit DNA credits replace stale generic release credits in the publishing description',()=>{const c=fixture(0),pack=applyChannelPublishing(c,song,'youtube_full',{title:'Song',finalDescription:'Creative\n\nOld generic credits',credits:'Old generic credits'});assert.equal(pack.credits,'Credits 0');assert.ok(pack.description.includes('Credits 0'));assert.ok(!pack.description.includes('Old generic credits'));});

function structuredFixture(){const c=fixture(0);c.dna.sections.visual.identity={branding:{enabled:true,position:'bottom-right',opacity:.65,size:'medium',horizontalMargin:60,verticalMargin:60},title:{enabled:true},subtitles:{enabled:true},landscape:{branding:{horizontalMargin:0}},portrait:{branding:{position:'top-left',verticalMargin:0}}};return c;}
test('structured layouts inherit base branding, preserve zero margins and ignore title/subtitle settings',()=>{
 const c=structuredFixture(),before=JSON.stringify(c),full=brandingFinishing(c,'landscape'),short=brandingFinishing(c,'portrait');
 assert.equal(full.brandHorizontalMargin,0);assert.equal(full.brandVerticalMargin,60);assert.equal(full.brandAlignment,3);
 assert.equal(short.brandHorizontalMargin,60);assert.equal(short.brandVerticalMargin,0);assert.equal(short.brandAlignment,7);
 assert.equal(JSON.stringify(brandingFinishing(c)),JSON.stringify(full));
 for(const f of [full,short]){validateFinishing(f,30);assert.equal(f.brandOpacity,.65);assert.equal(f.subtitles,false);assert.equal(f.intro,1);assert.equal(f.outro,3);assert.equal(f.introBrandOpacity,.35);}
 assert.equal(JSON.stringify(c),before);
 c.dna.sections.visual.identity.title={enabled:false,position:'top'};c.dna.sections.visual.identity.subtitles={enabled:false,style:'different'};
 assert.equal(JSON.stringify(brandingFinishing(c)),JSON.stringify(full));assert.equal(before,JSON.stringify(structuredFixture()));
});
test('all structured positions, sizes, opacity and margins reach ASS and asset composition in both layouts',()=>{
 for(const [position,alignment] of Object.entries({'top-left':7,'top-right':9,'bottom-left':1,'bottom-centre':2,'bottom-right':3}))for(const [size,font,ratio] of [['small',26,.08],['medium',32,.12],['large',42,.16]])for(const slot of [0,1]){
  const c=structuredFixture();delete c.dna.sections.visual.identity.landscape;delete c.dna.sections.visual.identity.portrait;
  Object.assign(c.dna.sections.visual.identity.branding,{position,size,horizontalMargin:0,verticalMargin:17});
  const f=brandingFinishing(c,slot?'portrait':'landscape');validateFinishing(f,30);
  assert.equal(f.brandAlignment,alignment);assert.equal(f.brandFontSize,font);assert.equal(f.brandLogoWidth,ratio);
  const ass=assDocument(f,30,slot),style=ass.match(/^Style: Brand,.*$/m)[0].split(',');
  assert.equal(style[2],String(font));assert.equal(style[18],String(alignment));assert.deepEqual(style.slice(19,22),['0','0','17']);assert.match(ass,/\\alpha&H59&/);
  const spec=brandingRenderSpec(f,30,slot,[{role:'logo',file:'/tmp/logo.png',mimeType:'image/png'}],'/tmp/f.ass');
  assert.ok(spec.filter.includes(`scale=${Math.round((slot?1080:1920)*ratio)}:-1`));assert.ok(spec.filter.includes('colorchannelmixer=aa=0.65'));
  if(alignment===2)assert.ok(spec.filter.includes(`overlay=x=(W-${Math.round((slot?1080:1920)*ratio)})/2+0:y=H-h-${17+Math.ceil(font*1.5)+({26:12,32:16,42:20}[font])}`));
  else assert.ok(spec.filter.includes(`overlay=x=${[1,7].includes(alignment)?'0':'W-w-0'}:y=${[1,3].includes(alignment)?'H-h-17':'17'}`));
 }
});
test('disabled persistent branding preserves legacy intro/outro text and media exactly',()=>{
 const c=structuredFixture(),legacy=brandingFinishing(fixture(0));c.dna.sections.visual.identity.branding.enabled=false;const f=brandingFinishing(c);
 const ass=assDocument(f,30);assert.ok(!ass.includes('Dialogue: 1,'));
 const intro=ass.split('\n').filter(s=>s.startsWith('Dialogue: 2,'));assert.deepEqual(intro.map(s=>s.replace('IntroBrand','Brand')),assDocument(legacy,30).split('\n').filter(s=>s.startsWith('Dialogue: 2,')));
 const style=ass.match(/^Style: IntroBrand,.*$/m)[0].replace('IntroBrand','Brand');assert.equal(style,assDocument(legacy,30).match(/^Style: Brand,.*$/m)[0]);
 const assets=['logo','watermark','intro','outro'].map(role=>({role,file:`/tmp/${role}.png`,mimeType:'image/png'}));
 for(const slot of [0,1]){const spec=brandingRenderSpec(f,30,slot,assets,'/tmp/f.ass'),old=brandingRenderSpec(legacy,30,slot,assets.filter(a=>['intro','outro'].includes(a.role)),'/tmp/f.ass');assert.deepEqual(spec,old);assert.ok(!spec.inputs.includes('/tmp/logo.png'));assert.ok(!spec.inputs.includes('/tmp/watermark.png'));}
});
test('channel context validates layout and skips disabled persistent assets while retaining intro/outro/font authorization',async()=>{
 const c=structuredFixture();c.dna.sections.visual.identity.portrait.branding.enabled=false;
 c.dna.assets=['logo','watermark','intro','outro','font'].map((role,i)=>({id:role,mediaAssetId:String(i),role}));
 const requested=[],signed=[];
 const db={auth:{getUser:async()=>({data:{user:{id:'owner'}}})},from(table){let selected=[];const q={select(){return q},eq(){return q},in(k,v){selected=v;requested.push(...v);return q},single:async()=>({data:{channel_id:c.channelId}}),then(resolve){return Promise.resolve({data:selected.map(id=>({id,mime_type:'image/png'}))}).then(resolve)}};return q;}};
 const ctx={exports:{},Response,URL,require:n=>({'@/utils/supabase/server':{createClient:async()=>db},'@/utils/channel-dna/server':{resolveActiveChannelDNA:async()=>c},'@/utils/channel-dna/context':{brandingFinishing},'@/utils/media-source':{buildMediaAssetResponse:async(db,a)=>{signed.push(a.id);return{url:'https://owned.example/'+a.id}}}})[n]};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/channel-context/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 for(const layout of ['', '&layout=landscape','&layout=portrait']){requested.length=0;signed.length=0;const r=await ctx.exports.GET(new Request('http://local/api/channel-context?projectId=song'+layout));assert.equal(r.status,200);const body=await r.json();validateFinishing(body.finishing,30);assert.equal(body.finishing.brandAlignment,layout.includes('portrait')?7:3);assert.deepEqual(requested,layout.includes('portrait')?['2','3','4']:['0','1','2','3','4']);assert.deepEqual(signed,requested);}
 requested.length=0;const r=await ctx.exports.GET(new Request('http://local/api/channel-context?projectId=song&layout=square'));assert.equal(r.status,400);assert.equal(requested.length,0);
});

test('structured persistent lockups separate text and assets at all anchors and sizes, including zero margins',()=>{
 const asset={role:'logo',file:'/tmp/logo.png',mimeType:'image/png'};
 for(const slot of [0,1])for(const alignment of [1,2,3,7,9])for(const [font,ratio,gap] of [[26,.08,12],[32,.12,16],[42,.16,20]])for(const margin of [0,60]){
  const f={...brandingFinishing(structuredFixture()),brandAlignment:alignment,brandFontSize:font,brandLogoWidth:ratio,brandHorizontalMargin:margin,brandVerticalMargin:margin,renderAssets:[asset]};
  const width=Math.round((slot?1080:1920)*ratio),ass=assDocument(f,30,slot),style=ass.match(/^Style: Brand,.*$/m)[0].split(',');
  assert.equal(style[19],String(margin+([1,7].includes(alignment)?width+gap:0)));assert.equal(style[20],String(margin+([3,9].includes(alignment)?width+gap:0)));assert.equal(style[21],String(margin));
  assert.ok(ass.includes('{\\q2}'));assert.equal(ass.split('\n').filter(s=>s.startsWith('Dialogue: 1,')).length,1);
  const spec=brandingRenderSpec(f,30,slot,[asset],'/tmp/f.ass');
  if(alignment===2)assert.ok(spec.filter.includes(`overlay=x=(W-${width})/2+0:y=H-h-${margin+Math.ceil(font*1.5)+gap}`));
  else assert.ok(spec.filter.includes(`overlay=x=${[1,7].includes(alignment)?String(margin):'W-w-'+margin}:y=${[1,3].includes(alignment)?'H-h-'+margin:String(margin)}`));
  const introStyle=ass.match(/^Style: IntroBrand,.*$/m)[0];assert.equal(introStyle,assDocument({...f,renderAssets:[]},30,slot).match(/^Style: IntroBrand,.*$/m)[0]);
  assert.deepEqual(ass.split('\n').filter(s=>s.startsWith('Dialogue: 2,')),assDocument({...f,renderAssets:[]},30,slot).split('\n').filter(s=>s.startsWith('Dialogue: 2,')));
  assert.ok(spec.filter.includes('colorchannelmixer=aa=0.65'));
 }
});
test('lockup leaves text-only, asset-only, disabled and legacy positioning unchanged; multiple assets occupy separate slots',()=>{
 const asset={role:'logo',file:'/tmp/logo.png',mimeType:'image/png'},f=brandingFinishing(structuredFixture());f.brandHorizontalMargin=0;f.brandVerticalMargin=0;
 const noAssets=assDocument(f,30);assert.equal(assDocument({...f,renderAssets:[]},30),noAssets);
 const logoOnly={...f,brandText:'',renderAssets:[asset]};assert.ok(!assDocument(logoOnly,30).includes('Dialogue: 1,'));assert.ok(brandingRenderSpec(logoOnly,30,0,[asset],'/tmp/f.ass').filter.includes('overlay=x=W-w-0:y=H-h-0'));
 const disabled={...f,watermarkEnabled:false,renderAssets:[asset]};assert.ok(!assDocument(disabled,30).includes('Dialogue: 1,'));assert.equal(brandingRenderSpec(disabled,30,0,[asset],'/tmp/f.ass').inputs.length,0);
 const legacy=brandingFinishing(fixture(0));assert.equal(assDocument({...legacy,renderAssets:[asset]},30),assDocument(legacy,30));assert.ok(brandingRenderSpec(legacy,30,0,[asset],'/tmp/f.ass').filter.includes('overlay=x=W-w-60:y=H-h-60'));
 const assets=[asset,{...asset,role:'watermark'}],multi={...f,renderAssets:assets};assert.equal(assDocument(multi,30).match(/^Style: Brand,.*$/m)[0].split(',')[20],'492');assert.ok(brandingRenderSpec(multi,30,0,assets,'/tmp/f.ass').filter.includes('overlay=x=W-w-246:y=H-h-0'));
 const intros=[{...asset,role:'intro'},{...asset,role:'outro'}];assert.deepEqual(brandingRenderSpec({...f,renderAssets:[asset]},30,0,intros,'/tmp/f.ass'),brandingRenderSpec(f,30,0,intros,'/tmp/f.ass'));
});
