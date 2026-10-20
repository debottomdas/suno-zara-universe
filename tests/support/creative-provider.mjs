// Deterministic local provider fixture. Never connects to OpenAI or spends credits.
import http from 'node:http';
import sharp from 'sharp';
const png=(await sharp({create:{width:48,height:48,channels:3,background:'#557799'}}).png().toBuffer()).toString('base64');
const beats=['Departure before sunrise','Crossing the harbour bridge','Searching the crowded market','Finding shelter from rainfall','Opening an abandoned letter','Remembering distant childhood','Listening beside a waterfall','Resting beneath forest branches','Returning through the hillside','Choosing another winding pathway'];
function scenes(slots){return slots.map((s,i)=>({slotId:s.id,beat:beats[i],state:'present',location:'Location '+beats[i],characters:['traveller'],action:'The traveller enacts '+beats[i],composition:'Wide foreground arrangement '+beats[i],evidence:[{source:'bible',quote:'traveller'}]}));}
let count=0;
http.createServer(async(req,res)=>{
 if(req.url==='/count'){res.end(JSON.stringify({count}));return;}
 let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);count++;
 res.setHeader('content-type','application/json');
 if(req.url.endsWith('/images/generations')){res.end(JSON.stringify({created:123,data:[{b64_json:png}],usage:{input_tokens:5,output_tokens:5,total_tokens:10}}));return;}
 const text=JSON.stringify(body);let answer;
 if(text.includes('"hooks"')||text.includes('\\"hooks\\"'))answer={hooks:['First distinct hook','Second hopeful hook','Third reflective hook']};
 else if(text.includes('updatedLyrics'))answer={updatedLyrics:'[Verse]\nThe traveller opens the gate\n[Chorus]\nMy hook',rewrittenSection:'The traveller opens the gate'};
 else if(text.includes('conceptNumber'))answer={concepts:[1,2,3].map(n=>({conceptNumber:n,title:'Concept '+n,description:'A traveller journeys across varied landscapes',imagePrompt:'A warm cinematic landscape'}))};
 else if(text.includes('whyItFits'))answer={styles:Array.from({length:5},(_,i)=>({name:'Style '+i,category:'Folk',recommended:i===0,whyItFits:'Fits the journey',prompt:'Warm brass and acoustic folk '+i}))};
 else if(typeof body.input==='string'&&body.input.startsWith('Create a DISTINCT SCENE PLAN')){const input=JSON.parse(body.input.slice(body.input.lastIndexOf('\n')+1));answer={scenes:scenes(input.slots)};}
 else if(typeof body.input==='string'&&body.input.includes('Required slots:')){const slots=JSON.parse(body.input.split('Required slots: ')[1]);answer={bible:'A traveller explores distinct landscapes with consistent clothing.',scenes:scenes(slots)};}
 else answer={title:'The local journey',lyrics:'[Verse]\nThe traveller follows the river\n[Chorus]\nMy hook'};
 const output=JSON.stringify(answer);
 res.end(JSON.stringify({id:'resp_fixture_'+count,object:'response',status:'completed',output:[{type:'message',id:'msg_fixture',status:'completed',role:'assistant',content:[{type:'output_text',text:output,annotations:[]}]}],usage:{input_tokens:5,output_tokens:5,total_tokens:10}}));
}).listen(3108,'127.0.0.1',()=>console.log('Local provider fixture ready on 3108'));
