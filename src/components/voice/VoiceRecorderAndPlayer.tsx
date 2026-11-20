import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Play, Pause, Trash2, Send, X, Flag, Loader2 } from 'lucide-react';
import { uploadMediaWithProgress } from '@/src/lib/mediaUtils';

interface VoiceRecorderProps {
  uid: string;
  storagePrefix: string;
  onUploaded: (payload: { audioUrl: string; durationSeconds: number; waveform: number[] }) => Promise<void> | void;
  onCancel?: () => void;
  submitLabel?: string;
}

export function VoiceRecorder({
  uid,
  storagePrefix,
  onUploaded,
  onCancel,
  submitLabel = 'Post Voice',
}: VoiceRecorderProps) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'preview' | 'uploading'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Microphone recording is not supported in this browser. Please use text instead.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      const bars: number[] = [];
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close().catch(() => {});
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setAudioBlob(blob);
        setPreviewUrl(url);
        setWaveform(bars.length > 0 ? bars.slice(0, 28) : Array.from({ length: 24 }, () => 35));
        setStatus('preview');
      };

      recorder.start(250);
      setSeconds(0);
      setStatus('recording');

      timerRef.current = window.setInterval(() => {
        analyser.getByteFrequencyData(dataArray);
        const avg = Math.round(
          (Array.from(dataArray).reduce((acc, v) => acc + v, 0) / Math.max(1, dataArray.length) / 255) * 100
        );
        if (bars.length < 28) bars.push(Math.max(18, Math.min(100, avg + 20)));
        setSeconds((s) => {
          if (s >= 179) {
            stopRecording();
            return 180;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err: any) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Enable microphone access to record voice.'
          : 'Could not access microphone.'
      );
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const resetRecording = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setAudioBlob(null);
    setPreviewUrl(null);
    setIsPlaying(false);
    setSeconds(0);
    setWaveform([]);
    setStatus('idle');
    onCancel?.();
  };

  const togglePreviewPlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleUpload = async () => {
    if (!audioBlob || seconds < 1) return;
    if (audioBlob.size > 15 * 1024 * 1024) {
      setError('Voice recording exceeds the 15 MB limit.');
      return;
    }
    setStatus('uploading');
    setError(null);
    try {
      const ext = audioBlob.type.includes('mp4') ? 'm4a' : audioBlob.type.includes('ogg') ? 'ogg' : 'webm';
      const path = `${storagePrefix}/${uid}/voice_${Date.now()}.${ext}`;
      const audioUrl = await uploadMediaWithProgress(path, audioBlob, setProgress, audioBlob.type || 'audio/webm');
      await onUploaded({
        audioUrl,
        durationSeconds: Math.max(1, seconds),
        waveform: waveform.length ? waveform : Array.from({ length: 20 }, () => 40),
      });
      resetRecording();
    } catch (err: any) {
      setError(err?.message || 'Failed to upload voice recording.');
      setStatus('preview');
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 space-y-2.5">
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {status === 'idle' && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={startRecording}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <Mic className="w-3.5 h-3.5" />
            Record Voice
          </button>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Mic permission is requested only when you click Record
          </span>
          {onCancel && (
            <button type="button" onClick={onCancel} className="p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {status === 'recording' && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
            <span className="text-xs font-mono font-medium text-neutral-900 dark:text-neutral-100">
              Recording · {fmt(seconds)} / 3:00
            </span>
          </div>
          <button
            type="button"
            onClick={stopRecording}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700"
          >
            <Square className="w-3 h-3 fill-current" />
            Stop
          </button>
        </div>
      )}

      {(status === 'preview' || status === 'uploading') && previewUrl && (
        <div className="space-y-2">
          <audio
            ref={audioRef}
            src={previewUrl}
            onEnded={() => setIsPlaying(false)}
            className="hidden"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={togglePreviewPlay}
              disabled={status === 'uploading'}
              className="h-9 w-9 rounded-full bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 flex items-center justify-center shrink-0"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <div className="flex-1 flex items-center gap-0.5 h-8">
              {(waveform.length ? waveform : [30, 55, 45, 70, 50, 80, 40, 60, 35, 75, 50, 40]).map((bar, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-full bg-[#1877F2]/80 dark:bg-blue-400/80"
                  style={{ height: `${Math.max(18, bar)}%` }}
                />
              ))}
            </div>

            <span className="text-xs font-mono text-neutral-600 dark:text-neutral-400 shrink-0">
              {fmt(seconds)}
            </span>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={resetRecording}
              disabled={status === 'uploading'}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:text-red-600"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Cancel
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={status === 'uploading'}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-medium hover:bg-[#166FE5] disabled:opacity-60"
            >
              {status === 'uploading' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Uploading {progress}%
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  {submitLabel}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface VoicePlayerProps {
  audioUrl: string;
  durationSeconds: number;
  waveform?: number[];
  canDelete?: boolean;
  onDelete?: () => void;
  onReport?: () => void;
}

export function VoicePlayer({
  audioUrl,
  durationSeconds,
  waveform = [35, 65, 45, 80, 55, 70, 40, 85, 60, 50, 75, 45, 65, 35, 55, 70],
  canDelete,
  onDelete,
  onReport,
}: VoicePlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<1 | 1.5 | 2>(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.play().catch(() => {});
      setPlaying(true);
    }
  };

  const cycleSpeed = () => {
    const nextRate: 1 | 1.5 | 2 = playbackRate === 1 ? 1.5 : playbackRate === 1.5 ? 2 : 1;
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const seekToBar = (barIndex: number, totalBars: number) => {
    if (!audioRef.current || totalBars <= 0) return;
    const total = audioRef.current.duration && Number.isFinite(audioRef.current.duration)
      ? audioRef.current.duration
      : durationSeconds;
    if (total <= 0) return;
    const target = ((barIndex + 0.5) / totalBars) * total;
    audioRef.current.currentTime = target;
    setCurrentTime(target);
  };

  const bars = waveform.slice(0, 24);
  const progressRatio = durationSeconds > 0 ? Math.min(1, currentTime / durationSeconds) : 0;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/70 px-3 py-2 text-neutral-900 dark:text-neutral-100">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pause voice audio' : 'Play voice audio'}
        className="h-9 w-9 rounded-full bg-[#1877F2] text-white flex items-center justify-center shrink-0 hover:bg-[#166FE5] transition-colors"
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>

      <div className="flex-1 flex items-center gap-0.5 h-7 min-w-[90px]" role="slider" aria-label="Voice playback progress" aria-valuenow={Math.round(progressRatio * 100)} aria-valuemin={0} aria-valuemax={100}>
        {bars.map((val, idx) => {
          const active = idx / Math.max(1, bars.length) <= progressRatio;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => seekToBar(idx, bars.length)}
              aria-label={`Seek to ${Math.round(((idx + 1) / Math.max(1, bars.length)) * 100)}%`}
              className={`flex-1 rounded-full transition-colors cursor-pointer ${
                active
                  ? 'bg-[#1877F2] dark:bg-blue-400'
                  : 'bg-neutral-300 dark:bg-neutral-700'
              }`}
              style={{ height: `${Math.max(20, Math.min(100, val))}%` }}
            />
          );
        })}
      </div>

      <span className="text-[11px] font-mono tabular-nums text-neutral-600 dark:text-neutral-400 shrink-0">
        {playing ? fmt(currentTime) : fmt(durationSeconds)}
      </span>

      <button
        type="button"
        onClick={cycleSpeed}
        title="Change voice playback speed"
        aria-label={`Playback speed ${playbackRate}x`}
        className="px-1.5 py-0.5 rounded-md bg-neutral-200/80 dark:bg-neutral-800 text-[10px] font-mono font-bold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-700 shrink-0"
      >
        {playbackRate}x
      </button>

      {canDelete && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title="Delete voice recording"
          className="p-1.5 text-neutral-400 hover:text-red-600 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      {!canDelete && onReport && (
        <button
          type="button"
          onClick={onReport}
          title="Report inappropriate audio"
          className="p-1.5 text-neutral-400 hover:text-amber-600 transition-colors"
        >
          <Flag className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
