import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { bufferConfigured, getBufferRateLimit, loadBufferChannels } from "@/utils/buffer-api";
import { bufferAccessToken } from "@/utils/buffer-oauth";

const SUPPORTED = new Set(["tiktok", "instagram", "facebook"]);
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    const url = new URL(request.url), channelId = url.searchParams.get("channelId")?.trim() || "";
    const reconcile = url.searchParams.get("refresh") === "1";
    if (!channelId) return NextResponse.json({ error: "channelId is required." }, { status: 400 });
    const { data: channel } = await supabase.from("channels").select("id,workspace_id,workspaces!inner(owner_user_id)").eq("id", channelId).eq("workspaces.owner_user_id", user.id).maybeSingle();
    if (!channel) return NextResponse.json({ error: "The selected channel is not available." }, { status: 403 });
    const { data: bindings, error: bindingError } = await supabase.from("buffer_channel_bindings").select("buffer_channel_id,buffer_account_id,service,display_name,metadata").eq("user_id", user.id).eq("channel_id", channelId);
    if (bindingError) throw new Error(bindingError.message);
    const { data: workspaceAccounts, error: accountError } = await supabase.from("buffer_accounts").select("id,email,display_name,status").eq("user_id", user.id).eq("workspace_id", (channel as any).workspace_id);
    const knownChannels = (bindings || []).filter(b => SUPPORTED.has(b.service)).map(b => ({ id: b.buffer_channel_id, service: b.service, name: b.display_name || b.service, bufferAccountId: b.buffer_account_id || null }));
    const accounts: any[] = [], channels: any[] = [];
    const accountIds = [...new Set((bindings || []).map(b => b.buffer_account_id || null))];
    for (const accountId of accountIds) {
      const owned = (bindings || []).filter(b => (b.buffer_account_id || null) === accountId);
      const saved = accountId ? (workspaceAccounts || []).find(a => a.id === accountId) : { id: "legacy", display_name: "Legacy Buffer API key", status: bufferConfigured() ? "connected" : "unavailable", legacy: true };
      const account: any = { ...(saved || { id: accountId, status: "unavailable" }), verification: "saved" };
      accounts.push(account);
      if (accountError || !saved || saved.status !== "connected") {
        account.error = saved?.status === "needs_reauth" ? "Buffer authorization needs review; saved destinations are unchanged." : "Buffer account is temporarily unverifiable; saved destinations are unchanged.";
        account.verification = "unavailable";
        continue;
      }
      if (!reconcile) {
        // Normal page loads read persisted bindings only. An earlier successful
        // reconciliation can mark a destination unavailable without deleting it.
        channels.push(...knownChannels.filter(c => c.bufferAccountId === accountId && !owned.some(b => b.buffer_channel_id === c.id && b.metadata?.buffer_verification?.available === false)));
        continue;
      }
      try {
        const token = accountId ? await bufferAccessToken(String(accountId), user.id) : undefined;
        const live = await loadBufferChannels({ force: true, accessToken: token });
        const checkedAt = new Date().toISOString();
        for (const binding of owned) {
          const found = live.find(c => c.id === binding.buffer_channel_id && String(c.service).toLowerCase() === binding.service);
          // Reconcile only this user's existing binding; never auto-bind another
          // channel's destinations or erase bindings after a transport failure.
          const { error } = await supabase.from("buffer_channel_bindings").update({
            ...(found ? { display_name: found.name } : {}),
            metadata: { ...binding.metadata, buffer_verification: { available: Boolean(found), checkedAt } },
          }).eq("user_id", user.id).eq("channel_id", channelId).eq("buffer_channel_id", binding.buffer_channel_id);
          if (error) throw new Error("Buffer was checked, but its destination state could not be saved. Refresh again before relying on it.");
        }
        channels.push(...live.filter(c => owned.some(b => b.buffer_channel_id === c.id && b.service === String(c.service).toLowerCase())).map(c => ({ ...c, service: String(c.service).toLowerCase(), bufferAccountId: accountId })));
        account.verification = "checked";
        account.checkedAt = checkedAt;
      } catch (error) {
        // A 429/timeout is not revoked authorization or a disconnected channel.
        account.verification = "unavailable";
        account.error = error instanceof Error ? error.message : "Buffer is temporarily unverifiable.";
      }
    }
    return NextResponse.json({ configured: Boolean(knownChannels.length || bufferConfigured()), channels, knownChannels, accounts, availableAccounts: workspaceAccounts || [], oauthConfigured: Boolean(process.env.BUFFER_CLIENT_ID && process.env.BUFFER_CLIENT_SECRET), source: reconcile ? "reconciliation" : "saved", rateLimit: getBufferRateLimit(accountIds.some(Boolean) ? "oauth" : undefined) });
  } catch (error) {
    console.error("Buffer status error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Buffer channels." }, { status: 500 });
  }
}
