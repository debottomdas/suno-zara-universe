import { bufferGraphql } from "@/utils/buffer-api";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";

import { bufferAuthorityOrigin, validateBufferState } from "@/utils/buffer-oauth-state";

export const runtime = "nodejs";
const STATE_COOKIE="sz_buffer_oauth_state", VERIFIER_COOKIE="sz_buffer_oauth_verifier", CHANNEL_COOKIE="sz_buffer_oauth_channel";
export async function GET(request:Request){
 let origin: string;
 try {
  origin = bufferAuthorityOrigin();
  if (new URL(request.url).origin !== origin) throw new Error("Wrong authority.");
 } catch {
  return NextResponse.json({error:"Unsupported Buffer OAuth origin."},{status:400});
 }
 let returnOrigin = origin;
 let returnTo = "/music-next?workspace=publish";
 function redirect(status:"connected"|"error", reason?:string){ const u=new URL(returnTo,returnOrigin); u.searchParams.set("buffer",status); if(reason)u.searchParams.set("reason",reason); const r=NextResponse.redirect(u); for(const n of [STATE_COOKIE,VERIFIER_COOKIE,CHANNEL_COOKIE])r.cookies.set(n,"",{httpOnly:true,sameSite:"lax",secure:true,path:"/",maxAge:0}); return r; }
 try{
  const url=new URL(request.url);
  const code=url.searchParams.get("code"), state=url.searchParams.get("state"); const c=await cookies(); const expected=c.get(STATE_COOKIE)?.value, verifier=c.get(VERIFIER_COOKIE)?.value, channelId=c.get(CHANNEL_COOKIE)?.value||"";
  if(!state||!expected||state!==expected||!verifier||!channelId)return redirect("error","state");
  let context;
  try { context=validateBufferState(state,request.url); } catch { return redirect("error","state"); }
  if(context.channelId!==channelId)return redirect("error","state");
  returnOrigin=context.returnOrigin;
  returnTo=context.returnTo;
  if(url.searchParams.get("error"))return redirect("error","denied");
  if(!code)return redirect("error","state");
  const userId=context.userId;
  const admin=createAdminClient();
  const {data:channel,error:channelError}=await admin.from("channels").select("id,workspace_id,workspaces!inner(owner_user_id)").eq("id",channelId).eq("workspaces.owner_user_id",userId).maybeSingle(); if(channelError||!channel)return redirect("error","channel");
  const clientId=String(process.env.BUFFER_CLIENT_ID||"").trim(), secret=String(process.env.BUFFER_CLIENT_SECRET||"").trim(), redirectUri=context.redirectUri; if(!clientId||!secret)return redirect("error","configuration");
  const tokenRes=await fetch("https://auth.buffer.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:secret,grant_type:"authorization_code",code,redirect_uri:redirectUri,code_verifier:verifier}),cache:"no-store"}); const tokens=await tokenRes.json().catch(()=>({})) as any; if(!tokenRes.ok||!tokens.access_token||!tokens.refresh_token)return redirect("error","token");
  const gql=<T>(query:string,variables:Record<string,unknown>={})=>bufferGraphql<T>(query,variables,tokens.access_token);
  const account=await gql<{account:{id:string,email?:string,organizations:Array<{id:string,name:string}>}}>(`query OAuthAccount { account { id email organizations { id name } } }`);
  const now=new Date().toISOString(), expiresAt=new Date(Date.now()+Number(tokens.expires_in||3600)*1000).toISOString();
  const {data:acct,error:acctErr}=await admin.from("buffer_accounts").upsert({user_id:userId,workspace_id:(channel as any).workspace_id,external_account_id:account.account.id,email:account.account.email||null,display_name:account.account.email||"Buffer account",access_token:tokens.access_token,refresh_token:tokens.refresh_token,token_type:tokens.token_type||"Bearer",scope:tokens.scope||"",expires_at:expiresAt,status:"connected",updated_at:now},{onConflict:"user_id,external_account_id"}).select("id").single(); if(acctErr||!acct)throw new Error(acctErr?.message||"Could not save Buffer account");
  const rows:any[]=[]; for(const org of account.account.organizations||[]){const d=await gql<{channels:Array<{id:string,name:string,service:string}>}>(`query Channels($organizationId: OrganizationId!) { channels(input:{organizationId:$organizationId}) { id name service } }`,{organizationId:org.id}); for(const x of d.channels||[]){const service=String(x.service||"").toLowerCase();if(!["facebook","instagram","tiktok"].includes(service))continue;rows.push({user_id:userId,channel_id:channelId,buffer_account_id:acct.id,buffer_channel_id:x.id,service,display_name:x.name||null,metadata:{organization_id:org.id,organization_name:org.name}});}}
  const destinationIds=rows.map((x:any)=>x.buffer_channel_id);
  const {data:owned}=destinationIds.length?await admin.from("buffer_channel_bindings").select("buffer_channel_id,channel_id").eq("user_id",userId).in("buffer_channel_id",destinationIds):{data:[] as any[]};
  const owners=new Map((owned||[]).map((x:any)=>[x.buffer_channel_id,x.channel_id]));
  const safeRows=rows.filter((x:any)=>!owners.has(x.buffer_channel_id)||owners.get(x.buffer_channel_id)===channelId);
  const {error:clearErr}=await admin.from("buffer_channel_bindings").delete().eq("user_id",userId).eq("channel_id",channelId);if(clearErr)throw new Error(clearErr.message);
  if(safeRows.length){const {error:e}=await admin.from("buffer_channel_bindings").upsert(safeRows,{onConflict:"user_id,buffer_channel_id"});if(e)throw new Error(e.message);}
  return redirect("connected");
 }catch(e){console.error("Buffer OAuth callback error:",e);return redirect("error","unexpected");}
}
