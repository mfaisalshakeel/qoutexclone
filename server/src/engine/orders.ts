/**
 * When a pending order fires.
 *
 * An order waits for one of two things: the price reaching a level, or a time
 * arriving. Which side of the level counts is decided *when the order is
 * placed*, from the price at that moment — an order placed above the market
 * fires on the way up, one placed below fires on the way down. Storing the side
 * rather than re-deriving it later is what makes the condition unambiguous when
 * the price has since crossed and come back.
 *
 * Pure, so the condition a trader is shown and the condition the execution
 * sweep applies are the same one.
 */

export type OrderTrigger = 'PRICE' | 'TIME';
export type TriggerSide = 'ABOVE' | 'BELOW';

export interface PendingOrder {
  /** Widened to string because it arrives from a database column. */
  trigger: string;
  triggerPrice?: number | null;
  triggerSide?: string | null;
  triggerAt?: Date | null;
  goodUntil: Date;
}

/**
 * Which way the price has to cross `level` for an order placed while the market
 * is at `current`. Null when the level is the price itself: an order that is
 * already true is a market order, and saying so beats firing on the next tick
 * in whichever direction it happens to move.
 */
export function sideFor(level: number, current: number): TriggerSide | null {
  if (!Number.isFinite(level) || !Number.isFinite(current) || level <= 0) return null;
  if (level > current) return 'ABOVE';
  if (level < current) return 'BELOW';
  return null;
}

/** Has the price met the level, from the side the order was placed on? */
export function priceMet(side: string | null | undefined, level: number, price: number): boolean {
  if (!Number.isFinite(level) || !Number.isFinite(price)) return false;
  if (side === 'ABOVE') return price >= level;
  if (side === 'BELOW') return price <= level;
  return false;
}

/** Should this order fire right now, at this price? */
export function shouldTrigger(order: PendingOrder, context: { price?: number | null; now: number }): boolean {
  if (isExpired(order, context.now)) return false;

  if (order.trigger === 'TIME') {
    return order.triggerAt != null && order.triggerAt.getTime() <= context.now;
  }

  // a market with no price cannot meet a level; the order waits
  if (context.price == null || order.triggerPrice == null) return false;
  return priceMet(order.triggerSide, order.triggerPrice, context.price);
}

/** Has the order run out of time to be filled? */
export function isExpired(order: PendingOrder, now: number): boolean {
  return order.goodUntil.getTime() <= now;
}

/** A one-line description of the condition, for a list or a log. */
export function describeTrigger(order: PendingOrder): string {
  if (order.trigger === 'TIME') {
    return order.triggerAt ? `at ${order.triggerAt.toISOString()}` : 'at a time';
  }
  if (order.triggerPrice == null) return 'at a price';
  return `${order.triggerSide === 'BELOW' ? 'at or below' : 'at or above'} ${order.triggerPrice}`;
}
