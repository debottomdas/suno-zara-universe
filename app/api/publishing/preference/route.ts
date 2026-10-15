import {NextResponse} from 'next/server';
import {createClient} from '@/utils/supabase/server';
import {validTimezone} from '@/utils/publishing/preference';
export async function GET(){
 const db=await createClient();const {data:{user},error}=await db.auth.getUser();
 if(error||!user)return NextResponse.json({error:'Sign in to choose your publishing timezone.'},{status:401});
 const timezone=user.user_metadata?.publishing_timezone;
 return NextResponse.json({timezone:validTimezone(timezone)?timezone:null},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request){
 const db=await createClient();const {data:{user},error}=await db.auth.getUser();
 if(error||!user)return NextResponse.json({error:'Sign in to save your publishing timezone.'},{status:401});
 let body;try{body=await req.json()}catch{return NextResponse.json({error:'Invalid preference.'},{status:400})}
 if(!validTimezone(body?.timezone))return NextResponse.json({error:'Choose a valid publishing timezone.'},{status:400});
 // Auth updates only the signed-in account and merges this field into its metadata.
 const {error:saveError}=await db.auth.updateUser({data:{publishing_timezone:body.timezone}});
 if(saveError)return NextResponse.json({error:'Could not save your publishing timezone. Please try again.'},{status:500});
 return NextResponse.json({timezone:body.timezone});
}
