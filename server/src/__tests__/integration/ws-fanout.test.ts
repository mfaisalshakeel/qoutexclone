/**
 * `ws.ts` never writes to a client socket except from inside the `pubsub`
 * subscription — every business event, whatever instance it happened on,
 * arrives the same way a message published by a *different* instance would.
 * This proves that path directly: publish a message shaped exactly like a
 * real instance would (the envelope `ws.ts` reads on `FANOUT_CHANNEL`) and
 * assert a real, authenticated WebSocket client actually receives it —
 * without ever going through this process's own `tradeEvents`/etc. emitters,
 * so it cannot pass by accident because the same process also happened to
 * fire the in-process event.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;
const FANOUT_CHANNEL = 'ws:fanout';

suite('realtime fan-out across instances', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let attachWebsocket: (typeof import('../../ws.js'))['attachWebsocket'];
  let pubsub: (typeof import('../../services/pubsub.js'))['pubsub'];
  let signAccessToken: (typeof import('../../lib/jwt.js'))['signAccessToken'];

  const made: string[] = [];
  let server: Server;
  let wsHandle: { close: () => void };
  let port: number;

  const makeUser = async (role: 'TRADER' | 'ADMIN' = 'TRADER') => {
    const user = await prisma.user.create({
      data: {
        email: `fanout-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`,
        name: 'Fanout Test',
        passwordHash: 'x',
        referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        role,
        ...(role === 'ADMIN' ? { adminRole: 'SUPPORT' } : {}),
      },
    });
    made.push(user.id);
    return user;
  };

  // buffers every message from the moment the socket exists, so nothing sent
  // in the gap between the server's synchronous `welcome` and this test
  // attaching a `.once('message', ...)` a tick later is ever silently lost
  const inboxes = new WeakMap<WebSocket, Record<string, unknown>[]>();
  const waiters = new WeakMap<WebSocket, ((message: Record<string, unknown>) => void)[]>();

  const connect = (token: string): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
      inboxes.set(socket, []);
      waiters.set(socket, []);
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        const pending = waiters.get(socket)!;
        const next = pending.shift();
        if (next) next(message);
        else inboxes.get(socket)!.push(message);
      });
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
    });

  const nextMessage = (socket: WebSocket): Promise<Record<string, unknown>> => {
    const buffered = inboxes.get(socket)!.shift();
    if (buffered) return Promise.resolve(buffered);
    return new Promise((resolve) => waiters.get(socket)!.push(resolve));
  };

  /** The `welcome` frame always arrives first; tests care about what follows it. */
  const afterWelcome = async (socket: WebSocket) => {
    const first = await nextMessage(socket);
    expect(first.type).toBe('welcome');
  };

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    attachWebsocket = (await import('../../ws.js')).attachWebsocket;
    pubsub = (await import('../../services/pubsub.js')).pubsub;
    signAccessToken = (await import('../../lib/jwt.js')).signAccessToken;

    server = createServer();
    wsHandle = attachWebsocket(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    wsHandle?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  const sockets: WebSocket[] = [];
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  it('a message published for a specific user reaches only that user’s socket', async () => {
    const trader = await makeUser();
    const otherTrader = await makeUser();
    const mine = await connect(signAccessToken({ sub: trader.id, role: 'TRADER', email: trader.email }));
    const theirs = await connect(
      signAccessToken({ sub: otherTrader.id, role: 'TRADER', email: otherTrader.email }),
    );
    sockets.push(mine, theirs);
    await Promise.all([afterWelcome(mine), afterWelcome(theirs)]);

    const theirNext = nextMessage(theirs);
    const mineNext = nextMessage(mine);

    // exactly the envelope a real instance publishes from ws.ts's publishToUser —
    // this process never called it; only pubsub.publish did
    await pubsub.publish(FANOUT_CHANNEL, {
      target: { kind: 'user', userId: trader.id },
      payload: { type: 'trade:opened', trade: { id: 'fake-trade' } },
    });

    const receivedByMine = await mineNext;
    expect(receivedByMine).toEqual({ type: 'trade:opened', trade: { id: 'fake-trade' } });

    // the other trader's socket gets nothing from this — prove it with a race
    // against something that definitely does arrive
    await pubsub.publish(FANOUT_CHANNEL, { target: { kind: 'all' }, payload: { type: 'ping-everyone' } });
    expect(await theirNext).toEqual({ type: 'ping-everyone' });
  });

  it('a message published to admins reaches only an admin-bound socket', async () => {
    const trader = await makeUser();
    const admin = await makeUser('ADMIN');
    const traderSocket = await connect(
      signAccessToken({ sub: trader.id, role: 'TRADER', email: trader.email }),
    );
    const adminSocket = await connect(signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email }));
    sockets.push(traderSocket, adminSocket);
    await Promise.all([afterWelcome(traderSocket), afterWelcome(adminSocket)]);

    const adminNext = nextMessage(adminSocket);
    const traderNext = nextMessage(traderSocket);

    await pubsub.publish(FANOUT_CHANNEL, {
      target: { kind: 'admins' },
      payload: { type: 'admin:withdrawal', event: 'created' },
    });

    expect(await adminNext).toEqual({ type: 'admin:withdrawal', event: 'created' });

    await pubsub.publish(FANOUT_CHANNEL, { target: { kind: 'all' }, payload: { type: 'ping-everyone' } });
    expect(await traderNext).toEqual({ type: 'ping-everyone' });
  });

  it('a message published to everyone reaches every connected socket, signed in or not', async () => {
    const anonymous = await connect('');
    sockets.push(anonymous);
    await afterWelcome(anonymous);

    const anonNext = nextMessage(anonymous);
    await pubsub.publish(FANOUT_CHANNEL, { target: { kind: 'all' }, payload: { type: 'settings:changed' } });

    expect(await anonNext).toEqual({ type: 'settings:changed' });
  });
});
