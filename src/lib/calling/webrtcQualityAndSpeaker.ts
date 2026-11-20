import type { NetworkQualityLevel, NetworkQualityStats } from '@/src/types/calling';

export async function samplePeerNetworkQuality(
  pc: RTCPeerConnection
): Promise<NetworkQualityStats> {
  const fallback: NetworkQualityStats = {
    level: 'unknown',
    rttMs: null,
    packetLossPct: null,
    bitrateKbps: null,
    measuredAt: Date.now(),
  };

  if (!pc || pc.connectionState === 'closed') return fallback;

  try {
    const stats = await pc.getStats();
    let rttMs: number | null = null;
    let packetsLost = 0;
    let packetsReceived = 0;
    let bitrateKbps: number | null = null;
    let iceType: string | undefined;

    const candidatesById = new Map<string, any>();
    stats.forEach((report: any) => {
      if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
        candidatesById.set(report.id, report);
      }
    });

    stats.forEach((report: any) => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
        if (typeof report.currentRoundTripTime === 'number') {
          rttMs = Math.round(report.currentRoundTripTime * 1000);
        }
        const localCand = candidatesById.get(report.localCandidateId);
        if (localCand?.candidateType) {
          iceType = String(localCand.candidateType);
        }
      }
      if (report.type === 'inbound-rtp' && !report.isRemote) {
        packetsLost += Number(report.packetsLost || 0);
        packetsReceived += Number(report.packetsReceived || 0);
      }
      if (report.type === 'candidate-pair' && typeof report.availableOutgoingBitrate === 'number') {
        bitrateKbps = Math.round(report.availableOutgoingBitrate / 1000);
      }
    });

    const totalPackets = packetsLost + packetsReceived;
    const packetLossPct = totalPackets > 0 ? Number(((packetsLost / totalPackets) * 100).toFixed(2)) : 0;

    let level: NetworkQualityLevel = 'excellent';
    if (rttMs === null && totalPackets === 0) {
      level = 'unknown';
    } else if ((rttMs !== null && rttMs > 300) || packetLossPct > 5) {
      level = 'poor';
    } else if ((rttMs !== null && rttMs > 140) || packetLossPct > 1.5) {
      level = 'good';
    }

    return {
      level,
      rttMs,
      packetLossPct,
      bitrateKbps,
      iceType,
      measuredAt: Date.now(),
    };
  } catch {
    return fallback;
  }
}

export async function adaptVideoSenderBitrate(
  pc: RTCPeerConnection,
  level: NetworkQualityLevel
): Promise<number | null> {
  if (!pc || pc.connectionState === 'closed' || level === 'unknown') return null;

  const targetKbps = level === 'poor' ? 280 : level === 'good' ? 750 : 1600;
  const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!sender || typeof sender.getParameters !== 'function') return null;

  try {
    const params = sender.getParameters();
    if (!Array.isArray(params.encodings) || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = targetKbps * 1000;
    await sender.setParameters(params);
    return targetKbps;
  } catch {
    return null;
  }
}

export function createAudioLevelMonitor(
  stream: MediaStream,
  onSpeakingChange: (speaking: boolean, level: number) => void
): () => void {
  if (typeof window === 'undefined' || !stream || stream.getAudioTracks().length === 0) {
    return () => {};
  }

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return () => {};

  let stopped = false;
  let ctx: AudioContext | null = null;
  let rafOrTimer: number | null = null;
  let lastSpeaking = false;

  try {
    ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);

    rafOrTimer = window.setInterval(() => {
      if (stopped) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        sum += data[i];
      }
      const avg = sum / data.length;
      const speaking = avg > 16;
      if (speaking !== lastSpeaking || speaking) {
        lastSpeaking = speaking;
        onSpeakingChange(speaking, Math.min(100, Math.round((avg / 128) * 100)));
      }
    }, 220);
  } catch {
    return () => {};
  }

  return () => {
    stopped = true;
    if (rafOrTimer) window.clearInterval(rafOrTimer);
    ctx?.close().catch(() => {});
  };
}

export async function acquireScreenShareStream(includeAudio = true): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error('Screen sharing (getDisplayMedia) is not supported on this browser or device.');
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: {
        cursor: 'always',
        frameRate: { ideal: 30, max: 60 },
      } as any,
      audio: includeAudio,
    });
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') {
      throw new Error('Screen share permission was cancelled or denied.');
    }
    throw new Error(err?.message || 'Unable to start screen sharing.');
  }
}
