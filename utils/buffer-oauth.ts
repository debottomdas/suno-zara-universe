import { createAdminClient } from "@/utils/supabase/admin";

type BufferAccount = { id:string; user_id:string; access_token:string; refresh_token:string; expires_at:string|null; status:string };
export async function bufferAccessToken(accountId:string,userId:string){
 const admin=createAdminClient(); const {data,error}=await admin.from("buffer_accounts").select("id,user_id,access_token,refresh_token,expires_at,status").eq("id",accountId).eq("user_id",userId).maybeSingle();
 if(error||!data)throw new Error("Buffer account connection was not found."); const a=data as BufferAccount;
 if(a.status!=="connected")throw new Error("Buffer account needs to be reconnected.");
 if(!a.expires_at||Date.parse(a.expires_at)>Date.now()+120000)return a.access_token;
 const clientId=String(process.env.BUFFER_CLIENT_ID||"").trim(), secret=String(process.env.BUFFER_CLIENT_SECRET||"").trim(); if(!clientId||!secret)throw new Error("Buffer OAuth environment variables are incomplete.");
 const res=await fetch("https://auth.buffer.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:secret,grant_type:"refresh_token",refresh_token:a.refresh_token}),cache:"no-store"}); const t=await res.json().catch(()=>({})) as any;
 if(!res.ok||!t.access_token||!t.refresh_token){await admin.from("buffer_accounts").update({status:"needs_reauth",updated_at:new Date().toISOString()}).eq("id",accountId);throw new Error("Buffer authorization expired. Reconnect this Buffer account.");}
 const expiresAt=new Date(Date.now()+Number(t.expires_in||3600)*1000).toISOString(); const {error:updateError}=await admin.from("buffer_accounts").update({access_token:t.access_token,refresh_token:t.refresh_token,expires_at:expiresAt,scope:t.scope||undefined,status:"connected",updated_at:new Date().toISOString()}).eq("id",accountId).eq("refresh_token",a.refresh_token);
 if(updateError)throw new Error(`Could not rotate Buffer token: ${updateError.message}`); return String(t.access_token);
}
