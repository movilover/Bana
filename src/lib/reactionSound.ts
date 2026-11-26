import type { ReactionType } from '@/src/types/bana';

/**
 * Original, synthesized reaction sounds (Web Audio API). No audio files are needed,
 * so nothing can 404. Sounds only play from a user gesture, are very short and quiet,
 * and failures are swallowed so reactions never break.
 */
const STORAGE_KEY = 'bana.reactionSound';

export function isReactionSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setReactionSoundEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
}

let ctx: AudioContext | null = null;

const PATTERNS: Record<ReactionType, { freqs: number[]; type: OscillatorType }> = {
  like: { freqs: [520, 780], type: 'sine' },
  love: { freqs: [440, 554, 659], type: 'sine' },
  haha: { freqs: [660, 740, 660, 740], type: 'triangle' },
  wow: { freqs: [420, 840], type: 'sine' },
  sad: { freqs: [440, 330], type: 'sine' },
  angry: { freqs: [220, 196], type: 'sawtooth' },
};

export function playReactionSound(reaction: ReactionType) {
  if (!isReactionSoundEnabled()) return;
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = ctx || new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const { freqs, type } = PATTERNS[reaction] || PATTERNS.like;
    const step = 0.07;
    const start = ctx.currentTime + 0.01;
    freqs.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const t0 = start + i * step;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.05, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + step + 0.04);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + step + 0.06);
    });
  } catch {
    /* never let audio break a reaction */
  }
}
