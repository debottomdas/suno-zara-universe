import {validateReleasePackage} from '@/utils/social/local-release-package';
import {NextResponse} from 'next/server';
import OpenAI from 'openai';

export const runtime='nodejs';
const fields=['youtube_full','youtube_shorts','instagram','facebook','tiktok'] as const;
type Field=typeof fields[number];
const clean=(v:unknown,n=12000)=>typeof v==='string'?v.trim().slice(0,n):'';
function instant(title:string,language:string,channel:string,idea:string):Record<Field,string>{
 const bn=/bangla|bengali|বাংলা|^bn$/i.test(language+' '+channel);
 const brand=channel||'Suno Zara';
 const intro=bn?`🎵 ${title} — একটি নতুন মৌলিক গান, ${brand}-এর পক্ষ থেকে।`:`🎵 ${title} — ${brand} की एक नई मौलिक प्रस्तुति।`;
 const context=idea? '\n'+idea.slice(0,500):'';
 const cta=bn?'পুরো গানটি শুনুন, ভালো লাগলে শেয়ার করুন এবং চ্যানেলটি সাবস্ক্রাইব করুন।':'पूरा गीत सुनें, पसंद आए तो शेयर करें और चैनल सब्सक्राइब करें।';
 const tags=bn?'#SunoZaraBangla #বাংলাগান #মৌলিকগান':'#SunoZara #OriginalSong #HindiMusic';
 return {youtube_full:`${intro}${context}\n\n${cta}\n\n${tags}`,youtube_shorts:Array.from({length:6},(_,i)=>`${i+1}. ${intro}\n${bn?'সম্পূর্ণ গান YouTube-এ শুনুন।':'पूरा गीत YouTube पर सुनें।'}\n${tags}`).join('\n\n'),instagram:`${intro}${context}\n${bn?'পুরো গান YouTube-এ — লিংক বায়োতে।':'पूरा गीत YouTube पर — लिंक बायो में।'}\n${tags}`,facebook:`${intro}${context}\n${cta}\n${tags}`,tiktok:`${intro}\n${bn?'পুরো গান YouTube-এ — লিংক বায়োতে।':'पूरा गीत YouTube पर — लिंक बायो में।'}\n${tags}`};
}
export async function POST(request:Request){
 try{
  const body=await request.json();
  const engine=clean(body.engine,20),title=clean(body.title,200),channel=clean(body.channel,120),language=clean(body.language,60),lyrics=clean(body.lyrics,7000),idea=clean(body.idea,1000);
  if(!title)return NextResponse.json({error:'A saved song title is required.'},{status:400});
  if(!['instant','ollama','gpt'].includes(engine))return NextResponse.json({error:'Unknown generator.'},{status:400});
  if(body.structured===true){
   const projectId=clean(body.projectId,100),channelId=clean(body.channelId,100);
   if(!projectId||!channelId)return NextResponse.json({error:'Project and channel are required.'},{status:400});
   const base=instant(title,language,channel,idea);
   const makeVideo=(name:string,description:string)=>({title:name.slice(0,100),description:description.slice(0,5000),tags:[title,channel,'Original Music'].filter(Boolean),hashtags:/bangla|bengali|বাংলা|^bn$/i.test(language+' '+channel)?['#SunoZaraBangla','#বাংলাগান']:['#SunoZara','#OriginalMusic'],pinnedComment:'',credits:'',categoryId:'10' as const,language:language||'',thumbnailAssetId:null});
   let full=makeVideo(title+' | '+(channel||'Suno Zara'),base.youtube_full);
   let shorts=Array.from({length:6},(_,i)=>({slot:i+1,video:makeVideo(title+' | Short '+(i+1),base.youtube_shorts.split('\\n\\n')[i]||base.youtube_shorts),instagram:base.instagram,facebook:base.facebook,tiktok:base.tiktok,sourceVideoId:null}));
   if(engine!=='instant'){
    const prompt=`Return ONLY valid JSON with keys full and shorts. full is {title,description,tags (array of strings),hashtags (array of strings),pinnedComment,credits}. shorts is an array of EXACTLY six items, each {slot (1-6),video:{title,description,tags,hashtags,pinnedComment,credits},instagram,facebook,tiktok}. Create DISTINCT short hooks, one per slot; do not invent lyric lines, singers, credits, links or what each Short depicts. Write in natural ${language} for channel ${channel}. Use title ${title}, context ${idea}, lyrics ${lyrics}. Each YouTube title at most 100 characters and description at most 5000. Leave credits blank when unknown. Do not mention AI.`;
    let raw='';
    if(engine==='ollama'){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);try{const r=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3:4b',stream:false,think:false,format:'json',messages:[{role:'user',content:prompt}]}),signal:controller.signal});const d=await r.json();if(!r.ok)throw Error(d.error||'Ollama failed.');raw=d.message?.content||'';}finally{clearTimeout(timer);}}
    else{if(!process.env.OPENAI_API_KEY)throw Error('OPENAI_API_KEY not configured.');const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});const r=await client.responses.create({model:process.env.SOCIAL_COPY_OPENAI_MODEL||'gpt-4.1-mini',input:prompt,text:{format:{type:'json_object'}}});raw=r.output_text;}
    const parsed=JSON.parse(raw);
    if(!parsed.full||!Array.isArray(parsed.shorts)||parsed.shorts.length!==6)throw Error('Generator did not return seven complete packages.');
    const merge=(v:any,baseVideo:any)=>({...baseVideo,...v,categoryId:'10',language:language||'',thumbnailAssetId:null,credits:typeof v.credits==='string'?v.credits:''});
    full=merge(parsed.full,full);
    shorts=shorts.map((v,i)=>{const p=parsed.shorts.find((x:any)=>x.slot===i+1);if(!p||!p.video)throw Error('Missing Short '+(i+1));return {...v,...p,slot:i+1,video:merge(p.video,v.video),sourceVideoId:null};});
   }
   const release=validateReleasePackage({schemaVersion:1,projectId,channelId,full,shorts,approved:false,generatedBy:engine,createdAt:new Date().toISOString()},projectId,channelId);
   return NextResponse.json({release,engine});
  }
  if(engine==='instant')return NextResponse.json({copy:instant(title,language,channel,idea),engine});
  const prompt=`Prepare an original-song social media release pack. Return ONLY a JSON object with exactly these five string keys: youtube_full, youtube_shorts, instagram, facebook, tiktok. youtube_shorts must contain SIX numbered distinct short captions in one string. Write natural ${language||'Bengali or Hindi'} appropriate to the channel ${channel||'Suno Zara'}. Follow these rules: do not invent lyrics, singers, collaborators, links, release dates, or claims. Do not mention AI. No Urdu-heavy vocabulary unless a ghazal. Instagram and TikTok should say full song on YouTube, link in bio. Use tasteful hashtags, clear CTAs and preserve the original song title. Song: ${JSON.stringify({title,channel,language,idea,lyrics})}`;
  let raw='';
  if(engine==='ollama'){
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),180000);
   try{
    const r=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'qwen3:4b',stream:false,think:false,format:'json',messages:[{role:'user',content:prompt}]}),signal:controller.signal});
    const d=await r.json();if(!r.ok)throw Error(d.error||'Ollama failed.');raw=d.message?.content||'';
   }finally{clearTimeout(timer);}
  }else{
   if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:'OPENAI_API_KEY is not configured for this local server.'},{status:503});
   const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
   const r=await client.responses.create({model:process.env.SOCIAL_COPY_OPENAI_MODEL||'gpt-4.1-mini',input:prompt,text:{format:{type:'json_object'}}});
   raw=r.output_text;
  }
  const parsed=JSON.parse(raw);const copy={} as Record<Field,string>;
  for(const field of fields){if(typeof parsed[field]!=='string'||!parsed[field].trim())throw Error('Generator omitted '+field);copy[field]=parsed[field].slice(0,30000);}
  return NextResponse.json({copy,engine});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Social generation failed.'},{status:500});}
}
