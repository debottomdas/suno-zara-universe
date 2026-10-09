import { NextResponse } from "next/server";
import { replaceLocalWorkspace } from "@/utils/local-first/store";

export async function POST(request: Request) {
  if (process.env.VERCEL === "1") return NextResponse.json({ error: "Local bootstrap receiver is disabled on hosted deployments." }, { status: 404 });
  const url = new URL(request.url);
  if (!/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) return NextResponse.json({ error: "Local bootstrap requires loopback." }, { status: 403 });
  try {
    const form = await request.formData();
    const payload = String(form.get("payload") || "");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || !Array.isArray(parsed.channels) || !parsed.songsByChannel) throw new Error("Invalid bootstrap payload.");
    await replaceLocalWorkspace(parsed);
    return NextResponse.redirect(new URL("/music-next?localSync=complete", url.origin), 303);
  } catch {
    return NextResponse.redirect(new URL("/music-next?localSync=failed", url.origin), 303);
  }
}
