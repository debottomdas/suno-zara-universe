import {notFound} from 'next/navigation';
import MusicReleaseStudio from '@/components/music-release/MusicReleaseStudio';
export default async function MusicReleasePage({searchParams}:{searchParams:Promise<{projectId?:string;channelId?:string;userId?:string;workerPort?:string;snapshot?:string}>}) {
  if(process.env.NODE_ENV!=='development')notFound();
  const q=await searchParams,port=Number(q.workerPort||47123);if(!Number.isInteger(port)||port<1024||port>65535)notFound();
  return <MusicReleaseStudio projectId={q.projectId||''} channelId={q.channelId||''} userId={q.userId} workerPort={port} snapshot={q.snapshot==='1'}/>;
}
