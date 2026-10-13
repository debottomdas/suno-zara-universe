import "server-only";

import type { NextRequest } from "next/server";

export function assertLocalYouTubeRequest(request: NextRequest) {
  if (process.env.VERCEL === "1") {
    throw new Error("Local YouTube OAuth is disabled on Vercel.");
  }

  const host = request.headers.get("host");

  if (host !== "localhost:3000" && host !== "127.0.0.1:3000") {
    throw new Error("Local YouTube OAuth requires localhost:3000.");
  }

  const forwardedHost = request.headers.get("x-forwarded-host");

  if (forwardedHost && forwardedHost !== host) {
    throw new Error("Unexpected forwarded host.");
  }
}
