'use client';

import { useState } from 'react';
import AgoraRTC, { AgoraRTCProvider } from 'agora-rtc-react';

export default function AgoraProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [client] = useState(() =>
    AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' }),
  );
  return <AgoraRTCProvider client={client}>{children}</AgoraRTCProvider>;
}
