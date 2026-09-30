import {notFound} from 'next/navigation';
import PublishingFixture from '@/components/publishing/PublishingFixture';
export default function Page(){if(process.env.NODE_ENV!=='development')notFound();return <PublishingFixture/>;}
