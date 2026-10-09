import { NextResponse } from "next/server";
import { replaceLocalWorkspace } from "@/utils/local-first/store";

export async function GET(request: Request) {
  if (process.env.VERCEL === "1") return NextResponse.json({ error: "Local bootstrap receiver is disabled on hosted deployments." }, { status: 404 });
  const url = new URL(request.url);
  const payload = url.searchParams.get("payload") || "";
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || !Array.isArray(parsed.channels) || !parsed.songsByChannel) throw new Error("Invalid bootstrap payload.");
    await replaceLocalWorkspace(parsed);
    return NextResponse.redirect(new URL("/music-next?localSync=complete", url.origin));
  } catch {
    return NextResponse.redirect(new URL("/music-next?localSync=failed", url.origin));
  }
}

export async function POST(request: Request) {
  if (process.env.VERCEL === "1") return NextResponse.json({ error: "Local bootstrap is available only on your Mac." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const cloudOrigin = String(body.cloudOrigin || process.env.SZU_CLOUD_ORIGIN || "").trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(cloudOrigin)) return NextResponse.json({ error: "Hosted Universe URL is not configured." }, { status: 400 });
  const local = new URL(request.url);
  const returnTo = `${local.origin}/api/local-mode/bootstrap`;
  const target = new URL("/api/local-mode/cloud-bootstrap", cloudOrigin);
  target.searchParams.set("returnTo", returnTo);
  return NextResponse.json({ authorizeUrl: target.toString() });
}
