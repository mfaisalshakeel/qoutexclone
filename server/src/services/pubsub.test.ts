import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryPubSub, RedisPubSub, type PubSub } from './pubsub.js';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';

describe('InMemoryPubSub', () => {
  it('delivers a published message to a subscriber on the same channel', async () => {
    const bus = new InMemoryPubSub();
    const received: unknown[] = [];
    bus.subscribe('a', (message) => received.push(message));

    await bus.publish('a', { hello: 'world' });

    expect(received).toEqual([{ hello: 'world' }]);
  });

  it('fans out to every subscriber on the channel', async () => {
    const bus = new InMemoryPubSub();
    const first: unknown[] = [];
    const second: unknown[] = [];
    bus.subscribe('a', (message) => first.push(message));
    bus.subscribe('a', (message) => second.push(message));

    await bus.publish('a', 1);

    expect(first).toEqual([1]);
    expect(second).toEqual([1]);
  });

  it('never delivers across channels', async () => {
    const bus = new InMemoryPubSub();
    const received: unknown[] = [];
    bus.subscribe('a', (message) => received.push(message));

    await bus.publish('b', 'wrong channel');

    expect(received).toEqual([]);
  });

  it('close() stops further delivery', async () => {
    const bus = new InMemoryPubSub();
    const received: unknown[] = [];
    bus.subscribe('a', (message) => received.push(message));
    await bus.close();

    await bus.publish('a', 'after close');

    expect(received).toEqual([]);
  });
});

describe('RedisPubSub', () => {
  const clients: PubSub[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()));
  });

  it('delivers a message published from one connection to a subscriber on another — the shape multiple API instances rely on', async () => {
    const instanceA = new RedisPubSub(REDIS_URL);
    const instanceB = new RedisPubSub(REDIS_URL);
    clients.push(instanceA, instanceB);

    const received: unknown[] = [];
    instanceB.subscribe('fanout-test', (message) => received.push(message));
    // subscribing is a round trip to Redis; give it a moment to actually land
    // before publishing, the same way a real instance's boot precedes traffic
    await new Promise((resolve) => setTimeout(resolve, 100));

    await instanceA.publish('fanout-test', { type: 'trade:settled', tradeId: 't1' });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual([{ type: 'trade:settled', tradeId: 't1' }]);
  });

  it('the publishing instance also receives its own message if it subscribed to the same channel', async () => {
    const instance = new RedisPubSub(REDIS_URL);
    clients.push(instance);

    const received: unknown[] = [];
    instance.subscribe('self-echo', (message) => received.push(message));
    await new Promise((resolve) => setTimeout(resolve, 100));

    await instance.publish('self-echo', 'ping');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual(['ping']);
  });

  it('a subscriber on a different channel never sees the message', async () => {
    const instanceA = new RedisPubSub(REDIS_URL);
    const instanceB = new RedisPubSub(REDIS_URL);
    clients.push(instanceA, instanceB);

    const received: unknown[] = [];
    instanceB.subscribe('channel-a', (message) => received.push(message));
    await new Promise((resolve) => setTimeout(resolve, 100));

    await instanceA.publish('channel-b', 'wrong channel');

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual([]);
  });
});
