import {NextResponse} from 'next/server';
import {snapshot} from '@/utils/publishing/snapshot';
import {assertDeliveryHistory} from '@/utils/publishing/execute';
import {validatePlan} from '@/utils/publishing/plan';
export const runtime='nodejs';
export async function GET(req:Request){try{const p=new URL(req.url).searchParams;return NextResponse.json(await snapshot(p.get('projectId')||'',p.get('channelId')||''));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Unable to verify release.'},{status:400});}}
// Review validates against current owned assets; this route never mutates providers.
export async function POST(req:Request){try{const plan=await req.json();const state=await snapshot(plan.projectId,plan.channelId);const rows=validatePlan(plan,state);assertDeliveryHistory(rows,state);return NextResponse.json({count:rows.length,rows,revision:state.revision});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Plan needs review.'},{status:400});}}
