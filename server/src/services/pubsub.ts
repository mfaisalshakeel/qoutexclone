import { EventEmitter } from 'node:events';
import { Redis } from 'ioredis';
import { env } from '../env.js';
import { log } from '../lib/logger.js';

/**
 * Realtime fan-out across API instances. `ws.ts` never talks to a socket map
 * belonging to another process — instead every event it wants to deliver is
 * published on a channel here, and every instance (including the one that
 * published it) subscribes and delivers to whichever of its own local
 * sockets the message is addressed to. Single instance and multi-instance
 * are the same code path; only which `PubSub` gets constructed differs.
 */
export interface PubSub {
  publish(channel: string, message: unknown): Promise<void>;
  subscribe(channel: string, handler: (message: unknown) => void): void;
  close(): Promise<void>;
}

/**
 * Default: everything stays in one process. `publish` delivers synchronously
 * to this same process's subscribers — there is nowhere else for the message
 * to go — so a single-instance deployment behaves exactly as it did before
 * this existed.
 */
export class InMemoryPubSub implements PubSub {
  private bus = new EventEmitter();

  constructor() {
    // this fan-out can reach every open socket at once (payouts, settings)
    this.bus.setMaxListeners(0);
  }

  async publish(channel: string, message: unknown): Promise<void> {
    this.bus.emit(channel, message);
  }

  subscribe(channel: string, handler: (message: unknown) => void): void {
    this.bus.on(channel, handler);
  }

  async close(): Promise<void> {
    this.bus.removeAllListeners();
  }
}

/**
 * Every API instance behind a load balancer connects to the same Redis and
 * shares one namespace of channels. A trader's socket can be on any
 * instance; publishing here is how an event on instance B ever reaches it.
 *
 * Redis requires a connection doing `SUBSCRIBE` to be used for nothing else,
 * so publishing and subscribing use two separate connections.
 */
export class RedisPubSub implements PubSub {
  private pub: Redis;
  private sub: Redis;
  private handlers = new Map<string, Set<(message: unknown) => void>>();

  constructor(url: string) {
    this.pub = new Redis(url, { lazyConnect: false });
    this.sub = new Redis(url, { lazyConnect: false });
    for (const [role, client] of [
      ['publisher', this.pub],
      ['subscriber', this.sub],
    ] as const) {
      client.on('error', (err) => log.pubsub.error({ err, role }, 'redis connection error'));
    }
    this.sub.on('message', (channel: string, raw: string) => {
      const set = this.handlers.get(channel);
      if (!set) return;
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      for (const handler of set) handler(message);
    });
  }

  async publish(channel: string, message: unknown): Promise<void> {
    await this.pub.publish(channel, JSON.stringify(message));
  }

  subscribe(channel: string, handler: (message: unknown) => void): void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
      void this.sub.subscribe(channel).catch((err) => log.pubsub.error({ err, channel }, 'subscribe failed'));
    }
    this.handlers.get(channel)!.add(handler);
  }

  async close(): Promise<void> {
    await Promise.all([this.pub.quit(), this.sub.quit()]).catch(() => undefined);
  }
}

export const pubsub: PubSub = env.redisUrl ? new RedisPubSub(env.redisUrl) : new InMemoryPubSub();
if (env.redisUrl)
  log.pubsub.info({ url: env.redisUrl.replace(/:[^:@]*@/, ':***@') }, 'realtime fan-out via Redis');
