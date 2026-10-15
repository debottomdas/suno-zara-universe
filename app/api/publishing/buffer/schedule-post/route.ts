import { NextResponse } from "next/server";
import { POST as scheduleBatch } from "../schedule-posts-batch/route";
// Use the same scoped ownership and media-dependency checks as batch scheduling.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const response = await scheduleBatch(new Request(request.url, {
    method: "POST", headers: request.headers,
    body: JSON.stringify({projectId:body.projectId,items:[body]}),
  }));
  const data = await response.json();
  if (!response.ok) return NextResponse.json(data,{status:response.status});
  const result = data.results?.[0];
  return NextResponse.json(result?.error ? {error:result.error} : {ok:true,post:result?.post},{status:result?.error ? 502 : 200});
}
