import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const arr = (v: unknown, n = 50) => Array.isArray(v) ? v.slice(0,n) : [];
const str = (v: unknown, n = 10000) => typeof v === "string" ? v.trim().slice(0,n) : "";
const obj = (v: unknown) => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string,unknown> : {};
const strings = (v: unknown, n = 50) => arr(v,n).map(x=>str(x,500)).filter(Boolean);

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const supabase = await createClient();
    const { data:{user}, error:authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({error:"You must be signed in."},{status:401});
    const body = await request.json();
    const projectId = str(body.projectId,100);
    const generatorGuidance = str(body.generatorGuidance,2000);
    if (!projectId) return NextResponse.json({error:"projectId is required."},{status:400});

    const {data:song,error:songError}=await supabase.from("songs").select("id,user_id,channel_id,title,idea,language,script,mood,genre,selected_hook,lyrics").eq("id",projectId).eq("user_id",user.id).single();
    if(songError||!song) return NextResponse.json({error:"Song not found."},{status:404});

    const {data:existing}=await supabase.from("social_media_packs").select("youtube_full,youtube_shorts,facebook,instagram,tiktok").eq("song_id",projectId).eq("user_id",user.id).maybeSingle();
    const complete = existing?.youtube_full && existing?.youtube_shorts && existing?.facebook && existing?.instagram && existing?.tiktok;
    if(complete && !body.force) return NextResponse.json({projectId,cached:true,aiCalls:0});

    const prompt=`Create ONE coordinated release campaign for this original song. Return JSON only. Understand the lyrics once, then create platform-specific copy from the same campaign strategy. Never invent lyric lines or collaborators.\n\nTITLE: ${song.title||"Untitled"}\nIDEA: ${song.idea||"Not specified"}\nLANGUAGE: ${song.language||"Not specified"}\nSCRIPT: ${song.script||"Not specified"}\nMOOD: ${song.mood||"Not specified"}\nGENRE: ${song.genre||"Not specified"}\nSELECTED HOOK: ${song.selected_hook||"Not specified"}\nCREATOR DIRECTION: ${generatorGuidance||"Natural, emotionally specific, true to the lyrics; avoid generic AI wording."}\n\nFULL LYRICS:\n${song.lyrics}\n\nReturn exactly one object with keys youtubeFull, youtubeShorts, facebook, instagram, tiktok.\n\nyoutubeFull: {recommendedTitle,whyRecommended,alternativeTitles[4],thumbnailTextOptions[3],openingDescription,fullDescription,hashtags[],tags[],seoKeywords[],pinnedComment,alternativePinnedComment,communityPost,informalCommunityPost,releasePost,playlistSuggestion,strongestLyricLines[],ctaOptions[],shortsBridgeCopy,filenameSuggestion,uploadChecklist[]}. Keep fullDescription creative/promotional only.\nyoutubeShorts: {shorts:[EXACTLY 10 objects {shortNumber,creativeAngle,lyricMoment,openingHook,title,description,hashtags[],tags[],pinnedComment,fullSongCta,visualDirection}]}.\nfacebook: {mainReleasePost,shortReleasePost,emotionalStoryPost,engagementQuestions[],ctaOptions[],hashtags[],reels:[EXACTLY 6 objects {reelNumber,creativeAngle,openingHook,caption,hashtags[],engagementPrompt,fullSongCta}]}.\ninstagram: {feedCaption,shortCaption,storyTextIdeas[],ctaOptions[],hashtags[],reels:[EXACTLY 10 objects {reelNumber,creativeAngle,openingHook,caption,hashtags[],fullSongCta,visualDirection}]}.\ntiktok: {posts:[EXACTLY 10 objects {postNumber,creativeAngle,lyricMoment,openingHook,caption,hashtags[],commentPrompt,fullSongCta,visualDirection}]}.\n\nMake each platform native rather than duplicating identical copy. Use exact lyric moments only when they occur in the supplied lyrics.`;

    const response=await openai.responses.create({model:"gpt-5.6-luna",input:[{role:"system",content:"You are the campaign brain for an independent music release. Produce valid JSON only and follow exact counts."},{role:"user",content:prompt}],text:{format:{type:"json_object"}}});
    const raw=response.output_text?.trim();
    if(!raw) throw new Error("No response received from AI.");
    const parsed=obj(JSON.parse(raw));
    const yf=obj(parsed.youtubeFull), ys=obj(parsed.youtubeShorts), fb=obj(parsed.facebook), ig=obj(parsed.instagram), tt=obj(parsed.tiktok);
    const releaseDetails={releaseType:"Official Music Video",artistBrand:"Suno Zara",lyricsCredit:"Music & Lyrics – Debottom Das",compositionCredit:"",producerCredit:"Producer – Suno Zara",preferredPlaylist:"",includeAiDisclosure:false,aiDisclosureDetails:"",descriptionLinks:""};
    const credits="Artist / Brand: Suno Zara\nMusic & Lyrics – Debottom Das\nProducer – Suno Zara";
    const fullDescription=str(yf.fullDescription);
    const youtubeFull={generatorGuidance,releaseDetails,recommendedTitle:str(yf.recommendedTitle,100),whyRecommended:str(yf.whyRecommended),alternativeTitles:strings(yf.alternativeTitles,4),thumbnailTextOptions:strings(yf.thumbnailTextOptions,3),openingDescription:str(yf.openingDescription),fullDescription,finalDescription:[fullDescription,credits].filter(Boolean).join("\n\n"),credits,aiDisclosure:"",hashtags:strings(yf.hashtags,30),tags:strings(yf.tags,40),seoKeywords:strings(yf.seoKeywords,30),pinnedComment:str(yf.pinnedComment),alternativePinnedComment:str(yf.alternativePinnedComment),communityPost:str(yf.communityPost),informalCommunityPost:str(yf.informalCommunityPost),releasePost:str(yf.releasePost),playlistSuggestion:str(yf.playlistSuggestion),strongestLyricLines:strings(yf.strongestLyricLines,10),ctaOptions:strings(yf.ctaOptions,10),shortsBridgeCopy:str(yf.shortsBridgeCopy),filenameSuggestion:str(yf.filenameSuggestion,160),uploadChecklist:strings(yf.uploadChecklist,20)};
    const youtubeShorts={generatorGuidance,shorts:arr(ys.shorts,10)};
    const facebook={...fb,generatorGuidance,reels:arr(fb.reels,6)};
    const instagram={...ig,generatorGuidance,reels:arr(ig.reels,10)};
    const tiktok={...tt,generatorGuidance,posts:arr(tt.posts,10)};
    if(!youtubeFull.recommendedTitle || youtubeShorts.shorts.length!==10 || arr(facebook.reels).length!==6 || arr(instagram.reels).length!==10 || arr(tiktok.posts).length!==10) throw new Error("Campaign plan was incomplete; existing packs were not replaced.");

    const {error:saveError}=await supabase.from("social_media_packs").upsert({song_id:projectId,user_id:user.id,youtube_full:youtubeFull,youtube_shorts:youtubeShorts,facebook,instagram,tiktok,updated_at:new Date().toISOString()},{onConflict:"song_id,user_id"});
    if(saveError) throw new Error(`Could not save campaign plan: ${saveError.message}`);

    const usage:any=(response as any).usage||{};
    await supabase.from("ai_usage_events").insert({user_id:user.id,channel_id:song.channel_id||null,song_id:song.id,feature:"campaign-plan",provider:"openai",model:"gpt-5.6-luna",input_tokens:Number(usage.input_tokens||0),output_tokens:Number(usage.output_tokens||0),total_tokens:Number(usage.total_tokens||0),duration_ms:Date.now()-started,metadata:{replaces:["youtube-full","youtube-shorts","platform-pack"],ai_calls:1}});
    return NextResponse.json({projectId,saved:true,cached:false,aiCalls:1});
  } catch(error){console.error("Campaign plan error:",error);return NextResponse.json({error:error instanceof Error?error.message:"Unable to create campaign plan."},{status:500});}
}
