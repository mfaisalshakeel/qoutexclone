import { toneFor } from './notifications';

/**
 * The platform's few sounds, synthesised rather than shipped.
 *
 * A short tone per kind of news, built with the Web Audio API: no asset to
 * download, nothing to cache, and no silent failure when a file is missing.
 * The context is created on the first real chime, because a browser will not
 * let a page start one before the trader has interacted with it anyway.
 */

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (context) return context;
  try {
    const Ctor =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    return context;
  } catch {
    // an audio context can be refused (no output device, a hardened browser);
    // the centre works perfectly well silently
    return null;
  }
}

/** A single soft tone. Never throws: sound is the least important thing here. */
export function chime(kind: string): void {
  const ctx = audio();
  if (!ctx) return;

  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const { hz, ms } = toneFor(kind);
    const now = ctx.currentTime;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = hz;

    // a quick fade in and out: a square-edged tone clicks
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + ms / 1000 + 0.02);
  } catch {
    /* no sound is fine */
  }
}
