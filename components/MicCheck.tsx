'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IMicrophoneAudioTrack } from 'agora-rtc-react';
import { Loader2, Mic, MicOff, AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

const cardClass =
  'relative mx-auto w-[min(92vw,34rem)] animate-fade-up overflow-hidden rounded-[28px] border border-border/60 bg-card/80 px-8 py-9 shadow-[0_20px_60px_-15px_rgba(74,74,74,0.28)] backdrop-blur-xl';

// Volume level (0-1, per AgoraRTC.getVolumeLevel()) above which we consider the
// candidate to have audibly demonstrated their mic works.
const SPEECH_DETECTED_THRESHOLD = 0.15;
const METER_BAR_COUNT = 24;

type MicCheckStatus = 'idle' | 'requesting' | 'ready' | 'error';

type MicCheckErrorKind = 'permission-denied' | 'not-readable' | 'device-not-found' | 'unknown';

interface MicCheckDevice {
  deviceId: string;
  label: string;
}

interface MicCheckProps {
  /** Called once the candidate confirms their mic and clicks Continue, with the
   *  candidate's name (trimmed, non-empty). The test track is already closed by
   *  then — browser mic permission is already granted, so the conversation
   *  flow's own track creation won't re-prompt the candidate. */
  onConfirm: (candidateName: string) => void;
}

const ERROR_COPY: Record<MicCheckErrorKind, { title: string; detail: string }> = {
  'permission-denied': {
    title: 'Microphone access is blocked',
    detail:
      "Your browser is blocking microphone access for this site. Click the lock/camera icon in your address bar, allow the microphone, then retry.",
  },
  'not-readable': {
    title: 'Microphone is unavailable',
    detail:
      "Your microphone couldn't be started — it may be in use by another app (Zoom, another browser tab, etc.) or there's a driver issue. Close other apps using it and retry.",
  },
  'device-not-found': {
    title: 'No microphone found',
    detail:
      'We couldn\'t detect a microphone on this device. Plug one in, check your OS sound settings, then retry.',
  },
  unknown: {
    title: "Couldn't access your microphone",
    detail: 'Something went wrong while starting your microphone. Please retry.',
  },
};

function classifyError(error: unknown): MicCheckErrorKind {
  const code = (error as { code?: string } | undefined)?.code;
  if (code === 'PERMISSION_DENIED') return 'permission-denied';
  if (code === 'DEVICE_NOT_FOUND') return 'device-not-found';
  if (code === 'NOT_READABLE') return 'not-readable';
  return 'unknown';
}

export function MicCheck({ onConfirm }: MicCheckProps) {
  const [status, setStatus] = useState<MicCheckStatus>('idle');
  const [errorKind, setErrorKind] = useState<MicCheckErrorKind>('unknown');
  const [devices, setDevices] = useState<MicCheckDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [level, setLevel] = useState(0);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [candidateName, setCandidateName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const trackRef = useRef<IMicrophoneAudioTrack | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const closeTrack = useCallback(() => {
    stopMeter();
    trackRef.current?.close();
    trackRef.current = null;
  }, [stopMeter]);

  // Always tear down the test track on unmount — it exists only to prove the mic
  // works, never to carry audio into the interview itself.
  useEffect(() => {
    return () => {
      closeTrack();
    };
  }, [closeTrack]);

  const pollLevel = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const current = track.getVolumeLevel();
    setLevel(current);
    if (current >= SPEECH_DETECTED_THRESHOLD) {
      setSpeechDetected(true);
    }
    rafRef.current = requestAnimationFrame(pollLevel);
  }, []);

  const refreshDevices = useCallback(async (track: IMicrophoneAudioTrack | null) => {
    try {
      const AgoraRTC = (await import('agora-rtc-react')).default;
      const microphones = await AgoraRTC.getMicrophones();
      setDevices(
        microphones.map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${d.deviceId.slice(0, 5)}...`,
        })),
      );
      if (track) {
        const currentLabel = track.getTrackLabel();
        const match = microphones.find((d) => d.label === currentLabel);
        if (match) setCurrentDeviceId(match.deviceId);
      }
    } catch {
      // Device enumeration failing after a successful track creation is non-fatal —
      // the picker just won't show alternate devices.
    }
  }, []);

  const startMicCheck = useCallback(async () => {
    setStatus('requesting');
    setSpeechDetected(false);
    setLevel(0);
    try {
      const AgoraRTC = (await import('agora-rtc-react')).default;
      const track = await AgoraRTC.createMicrophoneAudioTrack();
      trackRef.current = track;
      setStatus('ready');
      await refreshDevices(track);
      rafRef.current = requestAnimationFrame(pollLevel);
    } catch (error) {
      console.error('Mic check failed:', error);
      setErrorKind(classifyError(error));
      setStatus('error');
    }
  }, [pollLevel, refreshDevices]);

  const handleDeviceChange = useCallback(async (deviceId: string) => {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.setDevice(deviceId);
      setCurrentDeviceId(deviceId);
      setSpeechDetected(false);
    } catch (error) {
      console.error('Failed to switch microphone device:', error);
    }
  }, []);

  const handleRetry = useCallback(() => {
    closeTrack();
    setStatus('idle');
    startMicCheck();
  }, [closeTrack, startMicCheck]);

  const handleContinue = useCallback(() => {
    const trimmedName = candidateName.trim();
    if (!trimmedName) {
      setNameError('Please enter your name.');
      return;
    }
    closeTrack();
    onConfirm(trimmedName);
  }, [candidateName, closeTrack, onConfirm]);

  const activeBars = Math.round(Math.min(1, level / 0.5) * METER_BAR_COUNT);

  return (
    <div className={cardClass}>
      <h1 className="text-[26px] font-medium leading-[1.2] text-foreground text-center">
        Check your microphone
      </h1>
      <p className="mt-3 text-sm font-medium leading-6 text-muted-foreground text-center">
        Before you join, let&apos;s make sure your interviewers can hear you.
      </p>

      <div className="mt-6">
        <label
          htmlFor="candidate-name"
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
        >
          Your name
        </label>
        <input
          id="candidate-name"
          type="text"
          value={candidateName}
          onChange={(e) => {
            setCandidateName(e.target.value);
            if (nameError) setNameError(null);
          }}
          placeholder="Jane Doe"
          autoComplete="name"
          className="mt-2 w-full rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-sm text-foreground backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {nameError && (
          <p className="mt-1.5 text-xs text-destructive" role="alert">
            {nameError}
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-col items-center">
        {status === 'idle' && (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/60 bg-gradient-to-br from-secondary/50 to-muted/50 shadow-inner">
              <Mic className="h-6 w-6 text-muted-foreground" />
            </div>
            <Button
              onClick={startMicCheck}
              className="mt-8 h-11 w-full rounded-xl border border-primary bg-gradient-to-r from-primary to-secondary text-sm font-medium text-primary-foreground shadow-[0_8px_20px_-6px_rgba(226,180,189,0.6)] transition-transform hover:scale-[1.01] hover:from-primary/90 hover:to-secondary/90"
            >
              Test microphone
            </Button>
          </>
        )}

        {status === 'requesting' && (
          <>
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border/60 bg-gradient-to-br from-secondary/50 to-muted/50 shadow-inner">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Waiting for microphone permission...
            </p>
          </>
        )}

        {status === 'error' && (
          <div className="w-full">
            <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 backdrop-blur-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {ERROR_COPY[errorKind].title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ERROR_COPY[errorKind].detail}
                </p>
              </div>
            </div>
            <Button
              onClick={handleRetry}
              variant="outline"
              className="mt-4 h-10 w-full rounded-xl border-border/70 bg-transparent text-sm font-medium text-foreground hover:bg-muted"
            >
              Retry
            </Button>
          </div>
        )}

        {status === 'ready' && (
          <div className="w-full">
            {/* Live volume meter */}
            <div
              className="flex h-16 items-center justify-center gap-[3px] rounded-xl border border-border/70 bg-muted/50 px-4 backdrop-blur-sm"
              role="meter"
              aria-label="Microphone input level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(1, level / 0.5) * 100)}
            >
              {Array.from({ length: METER_BAR_COUNT }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-colors duration-100 ${
                    i < activeBars ? 'bg-gradient-to-t from-primary to-secondary' : 'bg-border/70'
                  }`}
                  style={{ height: `${20 + (i % 5) * 8}%` }}
                />
              ))}
            </div>

            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs">
              {speechDetected ? (
                <>
                  <Check className="h-3.5 w-3.5 text-primary" />
                  <span className="text-primary">We can hear you</span>
                </>
              ) : (
                <>
                  <MicOff className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Say something to test your mic
                  </span>
                </>
              )}
            </div>

            {devices.length > 1 && (
              <div className="mt-5">
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Microphone
                </label>
                <select
                  value={currentDeviceId}
                  onChange={(e) => handleDeviceChange(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-border/70 bg-muted/50 px-3 py-2 text-sm text-foreground backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId} className="bg-card">
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <Button
              onClick={handleContinue}
              className="mt-6 h-11 w-full rounded-xl border border-primary bg-gradient-to-r from-primary to-secondary text-sm font-medium text-primary-foreground shadow-[0_8px_20px_-6px_rgba(226,180,189,0.6)] transition-transform hover:scale-[1.01] hover:from-primary/90 hover:to-secondary/90"
            >
              Continue
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
