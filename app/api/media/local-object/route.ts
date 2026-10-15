import {createReadStream} from 'node:fs';
import {stat,mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import {Readable} from 'node:stream';
import {isLocalRequest} from '@/utils/local-first/media';
import {localObjectPath} from '@/utils/local-first/storage';
import {mutateLocalWorkspace} from '@/utils/local-first/store';
export const runtime='nodejs';
export async function GET(request:Request){
 if(!isLocalRequest(request))return Response.json({error:'Local media only.'},{status:404});
 try{
  const params=new URL(request.url).searchParams,key=params.get('path')||'';
  const filename=await localObjectPath(params.get('bucket')||'',key),info=await stat(filename);
  const headers:Record<string,string>={'content-type':key.endsWith('.png')?'image/png':'application/octet-stream','content-length':String(info.size),'cache-control':'private, no-store'};
  if(params.has('download'))headers['content-disposition']=`attachment; filename="${path.basename(params.get('download')||key).replace(/["\r\n]/g,'_')}"`;
  return new Response(Readable.toWeb(createReadStream(filename)) as ReadableStream,{headers});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Local image unavailable.'},{status:404});}
}
export async function PUT(request:Request){
 if(!isLocalRequest(request))return Response.json({error:'Local media only.'},{status:404});
 let file:Awaited<ReturnType<typeof open>>|undefined;
 try{
  const params=new URL(request.url).searchParams,bucket=params.get('bucket')||'',key=params.get('path')||'',token=params.get('token');
  if(!request.body)throw Error('Image body required.');
  const destination=await localObjectPath(bucket,key);
  // Reserve a one-use ticket before accepting bytes; double submissions cannot overwrite.
  await mutateLocalWorkspace(state=>{
   const ticket=state.tables?.local_upload_tickets?.find(t=>t.token===token&&t.bucket===bucket&&t.key===key&&!t.used&&t.expires>Date.now());
   if(!ticket)throw Error('Upload reservation expired or was already used. Prepare another upload.');ticket.used=true;
  });
  await mkdir(path.dirname(destination),{recursive:true});file=await open(destination,'wx',0o600);
  const reader=request.body.getReader();let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20*1024*1024){await reader.cancel();throw Error('Choose an image up to 20 MB.');}await file.write(value);}
  if(!size)throw Error('Empty image upload.');
  return Response.json({saved:true,sizeBytes:size});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Image upload failed.'},{status:400});}
 finally{await file?.close();}
}
