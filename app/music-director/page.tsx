import { notFound } from 'next/navigation';
import MusicDirectorPreview from '@/components/music-director/MusicDirectorPreview';

export default async function MusicDirectorPage({ searchParams }: { searchParams: Promise<{ projectId?: string; channelId?: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const params = await searchParams;
  return <MusicDirectorPreview key={`${params.channelId}:${params.projectId}`} projectId={params.projectId ?? ''} channelId={params.channelId ?? ''} />;
}
