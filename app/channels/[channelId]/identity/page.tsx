import ChannelIdentityEditor from '@/components/channels/ChannelIdentityEditor';
export default async function ChannelIdentityPage({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return <ChannelIdentityEditor key={channelId} channelId={channelId} />;
}
