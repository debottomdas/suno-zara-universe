import { NextResponse } from "next/server";
import { replaceLocalWorkspace } from "@/utils/local-first/store";

export async function POST(request: Request) {
  if (process.env.VERCEL === "1") return NextResponse.json({ error: "Local bootstrap is available only on your Mac." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const cloudOrigin = String(body.cloudOrigin || process.env.SZU_CLOUD_ORIGIN || "https://suno-zara-universe.vercel.app").trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(cloudOrigin)) return NextResponse.json({ error: "Hosted Universe URL is not configured." }, { status: 400 });
  const local = new URL(request.url);
  const returnTo = `${local.origin}/api/local-mode/bootstrap/receive`;
  const target = new URL("/api/local-mode/cloud-bootstrap", cloudOrigin);
  target.searchParams.set("returnTo", returnTo);
  return NextResponse.json({ authorizeUrl: target.toString() });
}
