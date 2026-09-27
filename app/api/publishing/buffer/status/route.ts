import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { bufferConfigured, getBufferRateLimit, loadBufferChannels } from "@/utils/buffer-api";
import { bufferAccessToken } from "@/utils/buffer-oauth";
const SUPPORTED=new Set(["tiktok","instagram","facebook"]);
export async function GET(request:Request){try{
 const supabase=await createClient();const {data:{user}}=await supabase.auth.getUser();if(!user)return NextResponse.json({error:"You must be signed in."},{status:401});
 const url=new URL(request.url),channelId=url.searchParams.get("channelId")?.trim()||"";if(!channelId)return NextResponse.json({error:"channelId is required."},{status:400});
 const {data:channel}=await supabase.from("channels").select("id,workspace_id,workspaces!inner(owner_user_id)").eq("id",channelId).eq("workspaces.owner_user_id",user.id).maybeSingle();if(!channel)return NextResponse.json({error:"The selected channel is not available."},{status:403});
 const {data:bindings,error:bErr}=await supabase.from("buffer_channel_bindings").select("buffer_channel_id,buffer_account_id,service,display_name,metadata").eq("user_id",user.id).eq("channel_id",channelId);if(bErr)throw new Error(bErr.message);
 const oauthAccountIds=[...new Set((bindings||[]).map((b:any)=>b.buffer_account_id).filter(Boolean))];let available:any[]=[];const accounts:any[]=[];
 const {data:workspaceAccounts}=await supabase.from("buffer_accounts").select("id,email,display_name,status").eq("user_id",user.id).eq("workspace_id",(channel as any).workspace_id);
 for(const accountId of oauthAccountIds){try{const token=await bufferAccessToken(String(accountId),user.id);const rows=(await loadBufferChannels({force:url.searchParams.get("refresh")==="1",accessToken:token})).filter(x=>SUPPORTED.has(String(x.service).toLowerCase()));available.push(...rows.map(x=>({...x,bufferAccountId:accountId})));const {data:a}=await supabase.from("buffer_accounts").select("id,email,display_name,status").eq("id",accountId).maybeSingle();if(a)accounts.push(a);}catch(e){accounts.push({id:accountId,status:"needs_reauth",error:e instanceof Error?e.message:"Reconnect Buffer"});}}
 // Legacy API-key account remains available for the already-migrated Bangla bindings.
 const legacyIds=new Set((bindings||[]).filter((b:any)=>!b.buffer_account_id).map((b:any)=>b.buffer_channel_id));
 if(legacyIds.size&&bufferConfigured()){const legacy=(await loadBufferChannels({force:url.searchParams.get("refresh")==="1"})).filter(x=>SUPPORTED.has(String(x.service).toLowerCase())&&legacyIds.has(x.id));available.push(...legacy.map(x=>({...x,bufferAccountId:null})));accounts.push({id:"legacy",display_name:"Legacy Buffer API key",status:"connected",legacy:true});}
 const allowed=new Set((bindings||[]).map((b:any)=>b.buffer_channel_id));const channels=available.filter(x=>allowed.has(x.id));
 return NextResponse.json({configured:Boolean(channels.length||oauthAccountIds.length||bufferConfigured()),channels,accounts,availableAccounts:workspaceAccounts||[],oauthConfigured:Boolean(process.env.BUFFER_CLIENT_ID&&process.env.BUFFER_CLIENT_SECRET),rateLimit:getBufferRateLimit()});
}catch(e){console.error("Buffer status error:",e);return NextResponse.json({configured:bufferConfigured(),channels:[],accounts:[],rateLimit:getBufferRateLimit(),error:e instanceof Error?e.message:"Could not load Buffer channels."},{status:500});}}
