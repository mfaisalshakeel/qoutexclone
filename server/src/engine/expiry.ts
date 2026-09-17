/**
 * When a position expires.
 *
 * Two modes, both resolved here so the server and the terminal agree to the
 * second:
 *
 * - **Duration**: a fixed length from the moment of purchase. 30 seconds from
 *   now expires 30 seconds from now.
 * - **Clock time**: the next boundary on the clock — 12:05, 12:10, 12:15 — the
 *   way an exchange-listed option expires. A boundary stops accepting
 *   positions a configurable cut-off before it arrives, because a trade bought
 *   a tick before expiry is a coin toss on latency rather than on the market.
 *
 * Pure: the same instant and configuration always produce the same slots, so
 * the countdown a trader watches and the validation that accepts their trade
 * cannot disagree.
 */

export interface ClockConfig {
  /** Boundary spacings offered, in seconds (60 = every minute). */
  steps: number[];
  /** How long before a boundary it stops accepting positions, in seconds. */
  cutoffSec: number;
  /** How far ahead boundaries are offered at all, in seconds. */
  horizonSec: number;
}

export interface ClockSlot {
  /** Boundary instant, in epoch milliseconds. */
  expiresAt: number;
  /** The step this boundary belongs to, in seconds. */
  stepSec: number;
  /** When this boundary stops accepting positions, in epoch milliseconds. */
  closesAt: number;
  /** Seconds until it stops accepting, for the countdown. */
  secondsToClose: number;
  /** Seconds from now to expiry, which is what the position's length will be. */
  durationSec: number;
}

export type ExpiryMode = 'DURATION' | 'CLOCK';

export interface ExpiryRejection {
  code: 'invalid_duration' | 'invalid_expiry' | 'expiry_closed' | 'expiry_past_close';
  message: string;
}

/** The next boundary of `stepSec` strictly after `at`, in epoch milliseconds. */
export function nextBoundary(at: number, stepSec: number): number {
  const step = Math.max(Math.floor(stepSec), 1) * 1000;
  return Math.floor(at / step) * step + step;
}

/** Is this instant exactly on a boundary of `stepSec`? */
export function onBoundary(at: number, stepSec: number): boolean {
  const step = Math.max(Math.floor(stepSec), 1) * 1000;
  return at % step === 0;
}

/**
 * The boundaries a trader may buy right now, soonest first.
 *
 * A boundary inside its own cut-off is left out rather than shown disabled: the
 * list is what can be bought, and the terminal counts down to the moment the
 * next one drops off.
 */
export function clockSlots(now: number, config: ClockConfig): ClockSlot[] {
  const cutoff = Math.max(config.cutoffSec, 0) * 1000;
  const slots = new Map<number, ClockSlot>();

  for (const stepSec of config.steps) {
    if (!(stepSec > 0)) continue;
    // walk forward until one is far enough out to still be buyable
    let expiresAt = nextBoundary(now, stepSec);
    const limit = now + config.horizonSec * 1000;
    while (expiresAt - cutoff <= now && expiresAt <= limit) {
      expiresAt += Math.floor(stepSec) * 1000;
    }
    if (expiresAt > limit) continue;

    const closesAt = expiresAt - cutoff;
    const existing = slots.get(expiresAt);
    // the same instant can be a boundary of several steps; the coarsest wins,
    // because that is how a trader thinks of it ("the 13:00 expiry")
    if (existing && existing.stepSec >= stepSec) continue;
    slots.set(expiresAt, {
      expiresAt,
      stepSec: Math.floor(stepSec),
      closesAt,
      secondsToClose: Math.max(Math.ceil((closesAt - now) / 1000), 0),
      durationSec: Math.round((expiresAt - now) / 1000),
    });
  }

  return [...slots.values()].sort((a, b) => a.expiresAt - b.expiresAt);
}

/** Checks a duration-mode expiry against the list this market offers. */
export function validateDuration(durationSec: number, allowed: number[]): ExpiryRejection | null {
  if (!allowed.includes(durationSec)) {
    return { code: 'invalid_duration', message: 'That expiry is not offered on this market' };
  }
  return null;
}

/**
 * Checks a clock-mode expiry: a real boundary, still open for purchase, and
 * inside the horizon.
 */
export function validateClockExpiry(
  now: number,
  expiresAt: number,
  config: ClockConfig,
): ExpiryRejection | null {
  if (!Number.isFinite(expiresAt)) {
    return { code: 'invalid_expiry', message: 'That expiry time is not valid' };
  }
  if (expiresAt > now + config.horizonSec * 1000) {
    return { code: 'invalid_expiry', message: 'That expiry is further out than this market offers' };
  }
  if (!config.steps.some((stepSec) => stepSec > 0 && onBoundary(expiresAt, stepSec))) {
    return { code: 'invalid_expiry', message: 'That expiry is not one of the clock boundaries' };
  }

  const cutoff = Math.max(config.cutoffSec, 0) * 1000;
  if (expiresAt - cutoff <= now) {
    const seconds = Math.max(Math.ceil(cutoff / 1000), 0);
    return {
      code: 'expiry_closed',
      message:
        seconds > 0
          ? `That expiry closed to new positions ${seconds}s before it lands. Pick the next one.`
          : 'That expiry has already passed. Pick the next one.',
    };
  }
  return null;
}

/**
 * A position may not outlive its market's session: an expiry after the close
 * has no tick to be priced from.
 */
export function validateAgainstClose(expiresAt: number, nextClose: number | null): ExpiryRejection | null {
  if (nextClose == null || expiresAt <= nextClose) return null;
  return {
    code: 'expiry_past_close',
    message: 'This market closes before that expiry. Pick a shorter one, or trade the OTC market.',
  };
}
