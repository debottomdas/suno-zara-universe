import { createAdminClient } from "@/utils/supabase/admin";

type BufferAccount = { id: string; user_id: string; access_token: string; refresh_token: string; expires_at: string | null; status: string };

// Buffer refresh tokens are single-use across every app instance/environment.
// Claim in the database BEFORE calling Buffer; never retry an uncertain refresh.
export async function bufferAccessToken(accountId: string, userId: string, forceRefresh = false) {
  const admin = createAdminClient();
  const read = async () => {
    const { data, error } = await admin.from("buffer_accounts")
      .select("id,user_id,access_token,refresh_token,expires_at,status")
      .eq("id", accountId).eq("user_id", userId).maybeSingle();
    if (error || !data) throw new Error("Buffer account connection was not found.");
    return data as BufferAccount;
  };
  let account = await read();
  const originalToken = account.access_token;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (account.status === "refreshing") {
      await new Promise(resolve => setTimeout(resolve, 250));
      account = await read();
      continue;
    }
    if (account.status !== "connected") throw new Error("Buffer authorization needs review or reauthorization; channel bindings are unchanged.");
    if ((!forceRefresh || account.access_token !== originalToken) &&
        (!account.expires_at || Date.parse(account.expires_at) > Date.now() + 120000)) return account.access_token;

    const clientId = String(process.env.BUFFER_CLIENT_ID || "").trim();
    const secret = String(process.env.BUFFER_CLIENT_SECRET || "").trim();
    if (!clientId || !secret) throw new Error("Buffer OAuth environment variables are incomplete.");
    const { data: claimed, error: claimError } = await admin.from("buffer_accounts")
      .update({ status: "refreshing", updated_at: new Date().toISOString() })
      .eq("id", accountId).eq("user_id", userId).eq("status", "connected")
      .eq("refresh_token", account.refresh_token).select("id").maybeSingle();
    if (claimError) throw new Error("Could not safely reserve the Buffer token refresh.");
    if (!claimed) { account = await read(); continue; }

    try {
      const response = await fetch("https://auth.buffer.com/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: "refresh_token", refresh_token: account.refresh_token }),
        cache: "no-store", signal: AbortSignal.timeout(15000),
      });
      const tokens = await response.json().catch(() => ({}));
      if (!response.ok || !tokens.access_token || !tokens.refresh_token) {
        const code = ["invalid_grant", "invalid_client"].includes(tokens.error) ? tokens.error : `HTTP ${response.status}`;
        throw new Error(`Buffer token refresh rejected (${code}); no posts or bindings were changed.`);
      }
      const { data: saved, error: saveError } = await admin.from("buffer_accounts")
        .update({ access_token: tokens.access_token, refresh_token: tokens.refresh_token,
          expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
          scope: tokens.scope || undefined, status: "connected", updated_at: new Date().toISOString() })
        .eq("id", accountId).eq("user_id", userId).eq("status", "refreshing")
        .eq("refresh_token", account.refresh_token).select("id").maybeSingle();
      if (saveError || !saved) throw new Error("Buffer refreshed, but saving its new credentials failed. Do not retry the old refresh token.");
      return String(tokens.access_token);
    } catch (error) {
      // A timeout may have consumed the token. Keep it unavailable instead of
      // replaying it and revoking the entire grant. Reauthorization is explicit.
      await admin.from("buffer_accounts").update({ status: "needs_reauth", updated_at: new Date().toISOString() })
        .eq("id", accountId).eq("user_id", userId).eq("status", "refreshing").eq("refresh_token", account.refresh_token);
      throw error;
    }
  }
  throw new Error("Buffer token refresh is still in progress. No publishing request was sent.");
}
