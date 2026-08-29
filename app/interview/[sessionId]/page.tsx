import InterviewSession from '@/components/InterviewSession';

export default async function InterviewPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <InterviewSession sessionId={sessionId} />;
}
