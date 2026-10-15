import 'server-only';
import path from 'node:path';
import {mkdir,writeFile,readFile,stat,copyFile} from 'node:fs/promises';
import {resolveLocalPath} from '@/utils/media-source';
import {readLocalWorkspace,mutateLocalWorkspace} from './store';
const localOwner=(state:Awaited<ReturnType<typeof readLocalWorkspace>>)=>state.workspace?.owner_user_id||'00000000-0000-4000-8000-000000000001';

const buckets=new Set(['song-media','song-images']);
export async function localObjectPath(bucket:string,key:string){
 if(!buckets.has(bucket))throw Error('Unknown local media collection.');
 const parts=key.split('/');
 if(parts.length<3||parts.some(p=>!p||p==='.'||p==='..')||key.includes('\\'))throw Error('Invalid media object path.');
 const state=await readLocalWorkspace();
 const song=(Object.values(state.songsByChannel).flat()).find(s=>(s.id||s.projectId)===parts[1]);
 if(!song||parts[0]!==localOwner(state))throw Error('Media is not available in this local project.');
 return resolveLocalPath(`objects/${bucket}/${key}`);
}
const failure=(error:unknown)=>({data:null,error:{message:error instanceof Error?error.message:'Local storage failed.'}});
const objectUrl=(bucket:string,key:string,download?:string|boolean)=>'/api/media/local-object?'+new URLSearchParams({bucket,path:key,...(download?{download:typeof download==='string'?download:'media'}:{})});
export function localStorage(){return {from:(bucket:string)=>({
 async upload(key:string,bytes:Buffer|Uint8Array|Blob,_options?:unknown){
  try{const destination=await localObjectPath(bucket,key);await mkdir(path.dirname(destination),{recursive:true});await writeFile(destination,bytes instanceof Blob?Buffer.from(await bytes.arrayBuffer()):bytes as Uint8Array,{flag:'wx',mode:0o600});return {data:{path:key},error:null};}catch(error){return failure(error);}
 },
 async download(key:string){try{return {data:new Blob([new Uint8Array(await readFile(await localObjectPath(bucket,key)))]),error:null};}catch(error){return failure(error);}},
 async createSignedUrl(key:string,_seconds:number,options?:{download?:string|boolean}){
  try{await stat(await localObjectPath(bucket,key));return {data:{signedUrl:objectUrl(bucket,key,options?.download)},error:null};}catch(error){return failure(error);}
 },
 async createSignedUrls(keys:string[],seconds:number){
  const output=[];for(const key of keys){const result=await this.createSignedUrl(key,seconds);if(result.error)return result;output.push({path:key,signedUrl:result.data!.signedUrl});}return {data:output,error:null};
 },
 async createSignedUploadUrl(key:string){
  try{await localObjectPath(bucket,key);const token=crypto.randomUUID();await mutateLocalWorkspace(state=>{state.tables??={};(state.tables.local_upload_tickets??=[]).push({token,bucket,key,expires:Date.now()+60*60*1000});});return {data:{token,path:key,signedUrl:objectUrl(bucket,key)+'&token='+token},error:null};}catch(error){return failure(error);}
 },
 async copy(source:string,destination:string){try{const from=await localObjectPath(bucket,source),to=await localObjectPath(bucket,destination);await mkdir(path.dirname(to),{recursive:true});await copyFile(from,to,1);return {data:{path:destination},error:null};}catch(error){return failure(error);}},
 async remove(_keys:string[]){return {data:[],error:null};} // Detachment is recorded by the repository; originals remain immutable.
})};}
