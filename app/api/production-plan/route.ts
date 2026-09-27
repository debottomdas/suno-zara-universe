import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function cleanStyles(value: any) {
  const styles = Array.isArray(value) ? value : [];
  const cleaned = styles.slice(0, 8).filter((x: any) => x && typeof x.name === "string" && typeof x.prompt === "string").map((x: any) => ({
    name: String(x.name).trim(), category: String(x.category || "Other").trim(), recommended: Boolean(x.recommended),
    whyItFits: String(x.whyItFits || "").trim(), prompt: String(x.prompt).trim().slice(0, 1000),
  }));
  if (cleaned.length < 5) throw new Error("Production plan did not return enough music directions.");
  if (cleaned.filter((x: any) => x.recommended).length !== 1) cleaned.forEach((x: any, i: number) => x.recommended = i === 0);
  return cleaned;
}
function cleanConcepts(value: any) {
  const xs = Array.isArray(value) ? value : [];
  const cleaned = xs.slice(0,3).filter((x:any)=>x && typeof x.title === "string" && typeof x.description === "string" && typeof x.imagePrompt === "string").map((x:any,i:number)=>({conceptNumber:i+1,title:String(x.title).trim(),description:String(x.description).trim(),imagePrompt:String(x.imagePrompt).trim()}));
  if (cleaned.length !== 3) throw new Error("Production plan did not return exactly three visual concepts.");
  return cleaned;
}
function cleanBriefs(value:any,count:number) {
  const xs=Array.isArray(value)?value:[];
  const cleaned=xs.slice(0,count).filter((x:any)=>x && typeof x.brief === "string").map((x:any,i:number)=>({imageNumber:i+1,role:String(x.role||`Scene ${i+1}`).trim(),brief:String(x.brief).trim()}));
  if(cleaned.length!==count) throw new Error(`Production plan did not return ${count} shot briefs.`);
  return cleaned;
}

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const body = await request.json();
    const projectId = String(body.projectId || "").trim();
    const additionalDirection = String(body.additionalDirection || "").trim().slice(0, 600);
    if (!projectId) return NextResponse.json({ error: "projectId is required." }, { status: 400 });

    const { data: song, error: songError } = await supabase.from("songs").select("id,user_id,channel_id,title,idea,language,script,mood,genre,freedom,selected_hook,lyrics").eq("id",projectId).eq("user_id",user.id).single();
    if (songError || !song) return NextResponse.json({ error: "Song not found." }, { status: 404 });
    if (!song.lyrics?.trim()) return NextResponse.json({ error: "Generate the full song before preparing it." }, { status: 400 });

    const { data: cached } = await supabase.from("song_production_plans").select("plan,version").eq("song_id",song.id).eq("user_id",user.id).maybeSingle();
    if (cached?.plan && !body.force) {
      const plan:any = cached.plan;
      return NextResponse.json({ plan, styles: plan.styles || [], concepts: plan.concepts || [], cached: true });
    }

    // Existing prepared songs can be migrated into the Production Plan system
    // without making an AI call or replacing any existing creative asset.
    if (body.backfillExisting === true) {
      const [{ data: existingStyles, error: stylesLoadError }, { data: existingConcepts, error: conceptsLoadError }, { data: existingImages, error: imagesLoadError }] = await Promise.all([
        supabase.from("suno_styles").select("name,category,recommended,why_it_fits,prompt").eq("song_id",song.id).eq("user_id",user.id),
        supabase.from("song_visual_concepts").select("id,concept_number,title,description,image_prompt,selected,user_ideas").eq("song_id",song.id).eq("user_id",user.id).order("concept_number",{ascending:true}),
        supabase.from("song_images").select("format,image_number,generation_prompt,image_set_id,created_at").eq("song_id",song.id).eq("user_id",user.id).order("created_at",{ascending:false}),
      ]);
      if (stylesLoadError) throw new Error(`Could not load existing Suno styles: ${stylesLoadError.message}`);
      if (conceptsLoadError) throw new Error(`Could not load existing visual concepts: ${conceptsLoadError.message}`);
      if (imagesLoadError) throw new Error(`Could not load existing prepared images: ${imagesLoadError.message}`);
      if (!existingStyles?.length || !existingConcepts?.length) {
        return NextResponse.json({ error: "This song does not yet have enough prepared assets to backfill a Production Plan." }, { status: 400 });
      }

      const styles = existingStyles.map((x:any)=>({name:x.name,category:x.category||"Other",recommended:Boolean(x.recommended),whyItFits:x.why_it_fits||"",prompt:x.prompt||""}));
      const concepts = existingConcepts.map((x:any)=>({id:x.id,conceptNumber:x.concept_number,title:x.title,description:x.description,imagePrompt:x.image_prompt,selected:Boolean(x.selected)}));
      const selectedConcept = existingConcepts.find((x:any)=>x.selected) || existingConcepts[0];
      const currentSetId = (existingImages || []).find((x:any)=>x.image_set_id)?.image_set_id || null;
      const currentImages = (existingImages || []).filter((x:any)=>!currentSetId || x.image_set_id === currentSetId);
      const extractBrief = (prompt:any) => {
        const text = String(prompt || "");
        const match = text.match(/MANDATORY UNIQUE SHOT BRIEF:\s*([\s\S]*?)\s*This shot brief overrides/i);
        return match?.[1]?.trim() || "";
      };
      const briefsFor = (format:string,count:number) => Array.from({length:count},(_,i)=>{
        const imageNumber=i+1;
        const image=currentImages.find((x:any)=>x.format===format && Number(x.image_number)===imageNumber);
        return {imageNumber,role:`Existing ${format === "youtube" ? "landscape" : "vertical"} scene ${imageNumber}`,brief:extractBrief(image?.generation_prompt) || `Reuse the existing prepared ${format === "youtube" ? "16:9" : "9:16"} scene ${imageNumber}; no regeneration is required.`};
      });
      const plan={
        version:1,
        songDNA:{migrationSource:"existing-prepared-assets",note:"Backfilled without an AI call."},
        styles,
        concepts,
        landscapeBriefs:briefsFor("youtube",3),
        verticalBriefs:briefsFor("shorts",6),
        socialDirection:{migrationSource:"existing-social-pack"},
        additionalDirection,
        selectedConceptId:selectedConcept?.id || null,
        backfilled:true,
        generatedAt:new Date().toISOString(),
      };
      const { error: planError }=await supabase.from("song_production_plans").upsert({song_id:song.id,user_id:user.id,channel_id:song.channel_id||null,version:1,plan,updated_at:new Date().toISOString()},{onConflict:"song_id"});
      if(planError) throw new Error(`Could not save backfilled production plan: ${planError.message}`);
      return NextResponse.json({plan,styles,concepts,cached:false,backfilled:true,aiCalls:0});
    }

    const prompt = `Build ONE reusable production plan for this original song. Return JSON only.\n\nSONG TITLE: ${song.title || "Untitled"}\nIDEA: ${song.idea || "Not specified"}\nLANGUAGE: ${song.language || "Not specified"}\nSCRIPT: ${song.script || "Not specified"}\nMOOD: ${song.mood || "Not specified"}\nGENRE: ${song.genre || "Not specified"}\nCREATIVE FREEDOM: ${song.freedom || "Not specified"}\nSELECTED HOOK: ${song.selected_hook || "Not specified"}\nADDITIONAL MUSIC DIRECTION: ${additionalDirection || "None"}\n\nFULL LYRICS:\n${song.lyrics}\n\nReturn exactly this shape:\n{\n "songDNA":{"emotionalCore":"","arc":"","hookStrategy":"","audiencePromise":"","visualMotifs":[""]},\n "styles":[5 to 8 objects: {"name":"","category":"","recommended":true/false,"whyItFits":"","prompt":"max 1000 chars, Suno-ready"}],\n "concepts":[exactly 3 objects: {"title":"","description":"","imagePrompt":""}],\n "landscapeBriefs":[exactly 3 objects: {"role":"","brief":"distinct 16:9 generation-ready scene"}],\n "verticalBriefs":[exactly 6 objects: {"role":"","brief":"distinct 9:16 generation-ready scene"}],\n "socialDirection":{"positioning":"","tone":"","keywords":[""],"avoid":[""]}\n}\n\nRules: understand the lyrics once and make every section consistent with that understanding. Exactly one style recommended. Styles must be genuinely different. Concepts must be genuinely different. All nine shot briefs must vary camera distance, composition, subject arrangement, narrative moment and visual hierarchy; do not create nine similar portraits. Preserve culturally believable Indian/Bengali/Hindi details where relevant. No copyrighted artist imitation. No text/logos in shot briefs.`;

    const response = await openai.responses.create({ model:"gpt-5.6-luna", input:[{role:"system",content:"You are Suno Zara Universe's senior music producer, creative director and release strategist. Produce compact, specific, production-ready JSON; avoid generic AI language."},{role:"user",content:prompt}], text:{format:{type:"json_object"}} });
    const raw=response.output_text?.trim(); if(!raw) throw new Error("No production plan returned from AI.");
    const parsed=JSON.parse(raw);
    const styles=cleanStyles(parsed.styles); const concepts=cleanConcepts(parsed.concepts); const landscapeBriefs=cleanBriefs(parsed.landscapeBriefs,3); const verticalBriefs=cleanBriefs(parsed.verticalBriefs,6);

    await supabase.from("suno_styles").delete().eq("song_id",song.id).eq("user_id",user.id);
    const { error: stylesError } = await supabase.from("suno_styles").insert(styles.map((x:any)=>({song_id:song.id,user_id:user.id,name:x.name,category:x.category,recommended:x.recommended,why_it_fits:x.whyItFits,prompt:x.prompt})));
    if(stylesError) throw new Error(`Could not save planned music directions: ${stylesError.message}`);

    await supabase.from("song_visual_concepts").delete().eq("song_id",song.id).eq("user_id",user.id);
    const { data: savedConcepts, error: conceptsError } = await supabase.from("song_visual_concepts").insert(concepts.map((x:any)=>({song_id:song.id,user_id:user.id,user_ideas:additionalDirection||null,concept_number:x.conceptNumber,title:x.title,description:x.description,image_prompt:x.imagePrompt,selected:false}))).select("id,concept_number,title,description,image_prompt,selected").order("concept_number",{ascending:true});
    if(conceptsError) throw new Error(`Could not save planned visual concepts: ${conceptsError.message}`);
    const returnedConcepts=(savedConcepts||[]).map((x:any)=>({id:x.id,conceptNumber:x.concept_number,title:x.title,description:x.description,imagePrompt:x.image_prompt,selected:x.selected}));

    const plan={version:1,songDNA:parsed.songDNA||{},styles,concepts:returnedConcepts,landscapeBriefs,verticalBriefs,socialDirection:parsed.socialDirection||{},additionalDirection,generatedAt:new Date().toISOString()};
    const { error: planError }=await supabase.from("song_production_plans").upsert({song_id:song.id,user_id:user.id,channel_id:song.channel_id||null,version:1,plan,updated_at:new Date().toISOString()},{onConflict:"song_id"});
    if(planError) throw new Error(`Could not save production plan: ${planError.message}`);

    const usage:any=(response as any).usage||{};
    await supabase.from("ai_usage_events").insert({user_id:user.id,channel_id:song.channel_id||null,song_id:song.id,feature:"production-plan",provider:"openai",model:"gpt-5.6-luna",input_tokens:usage.input_tokens??usage.prompt_tokens??null,output_tokens:usage.output_tokens??usage.completion_tokens??null,total_tokens:usage.total_tokens??null,duration_ms:Date.now()-started,metadata:{replaced_calls:["suno-styles","image-concepts","image-shot-briefs:youtube","image-shot-briefs:shorts"]}});

    return NextResponse.json({plan,styles,concepts:returnedConcepts,cached:false});
  } catch(error) {
    console.error("Production plan error:",error);
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to create production plan."},{status:500});
  }
}

export async function GET(request: Request) {
  try {
    const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser(); if(!user) return NextResponse.json({error:"You must be signed in."},{status:401});
    const projectId=String(new URL(request.url).searchParams.get("projectId")||"").trim();
    const {data,error}=await supabase.from("song_production_plans").select("plan,version,updated_at").eq("song_id",projectId).eq("user_id",user.id).maybeSingle();
    if(error) throw error; return NextResponse.json({plan:data?.plan||null,version:data?.version||null,updatedAt:data?.updated_at||null});
  } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Unable to load production plan."},{status:500}); }
}
