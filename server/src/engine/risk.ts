/**
 * Risk limits on new positions.
 *
 * The house has to be able to cap what it is on the hook for, and this is the
 * only honest way to do it: **refuse a stake, never steer a quote.** Nothing
 * here touches a price, a payout or an outcome. A trader who is inside every
 * limit gets exactly the market everyone else gets.
 *
 * Pure, so the rejection a trader sees and the figure the back office shows
 * come from the same arithmetic, and so it can be reasoned about in a test
 * rather than only observed in production.
 */

export type RiskCode = 'stake_too_low' | 'stake_too_high' | 'user_exposure_limit' | 'market_exposure_limit';

export interface RiskLimits {
  /** Smallest and largest a single position may be, in cents. */
  minStake: number;
  maxStake: number;
  /**
   * Most one trader may hold open on this market at once, in cents. 0 means
   * the runtime default applies; the caller resolves that before calling.
   */
  maxOpenStakePerUser: number;
  /** Most the house will hold open on one side of this market, in cents. */
  maxExposurePerDirection: number;
}

export interface RiskState {
  /** What this trader already holds open on this market, in cents. */
  userOpenStake: number;
  /** What the house already holds open on this side of this market, in cents. */
  directionExposure: number;
}

export interface RiskCheck {
  stake: number;
  limits: RiskLimits;
  state: RiskState;
}

export interface RiskRejection {
  code: RiskCode;
  message: string;
  /** What the trader could still stake, in cents; 0 when nothing is left. */
  remaining: number;
}

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A limit of 0 is "no limit", which keeps an unconfigured market unrestricted. */
function capped(limit: number): boolean {
  return Number.isFinite(limit) && limit > 0;
}

/**
 * The most this trader could stake on this market right now, in cents, given
 * every limit. Used for the rejection message and for the ticket's own cap.
 */
export function allowance(limits: RiskLimits, state: RiskState): number {
  let room = capped(limits.maxStake) ? limits.maxStake : Number.POSITIVE_INFINITY;
  if (capped(limits.maxOpenStakePerUser)) {
    room = Math.min(room, limits.maxOpenStakePerUser - state.userOpenStake);
  }
  if (capped(limits.maxExposurePerDirection)) {
    room = Math.min(room, limits.maxExposurePerDirection - state.directionExposure);
  }
  return Number.isFinite(room) ? Math.max(Math.floor(room), 0) : Number.POSITIVE_INFINITY;
}

/**
 * Checks a stake against every limit, returning null when it is allowed.
 *
 * The order matters for the message a trader sees: the stake's own bounds come
 * first, because "the maximum is $5,000" is more useful than "you already hold
 * too much" when both are true.
 */
export function checkRisk({ stake, limits, state }: RiskCheck): RiskRejection | null {
  if (stake < limits.minStake) {
    return {
      code: 'stake_too_low',
      message: `Minimum stake is ${dollars(limits.minStake)}`,
      remaining: 0,
    };
  }
  if (capped(limits.maxStake) && stake > limits.maxStake) {
    return {
      code: 'stake_too_high',
      message: `Maximum stake is ${dollars(limits.maxStake)} on this market`,
      remaining: limits.maxStake,
    };
  }

  if (capped(limits.maxOpenStakePerUser)) {
    const room = limits.maxOpenStakePerUser - state.userOpenStake;
    if (stake > room) {
      return {
        code: 'user_exposure_limit',
        message:
          room > 0
            ? `You can hold ${dollars(limits.maxOpenStakePerUser)} open on this market. ${dollars(room)} left.`
            : `You already hold the maximum ${dollars(limits.maxOpenStakePerUser)} open on this market.`,
        remaining: Math.max(room, 0),
      };
    }
  }

  if (capped(limits.maxExposurePerDirection)) {
    const room = limits.maxExposurePerDirection - state.directionExposure;
    if (stake > room) {
      return {
        code: 'market_exposure_limit',
        message:
          room > 0
            ? `This market is near its limit on that side. ${dollars(room)} can still be staked.`
            : 'This market has reached its limit on that side. Try the other direction or another market.',
        remaining: Math.max(room, 0),
      };
    }
  }

  return null;
}
