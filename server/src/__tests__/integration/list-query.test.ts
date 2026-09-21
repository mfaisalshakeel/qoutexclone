/**
 * `paginateOffset` and `streamCsvExport` against a real Prisma delegate.
 *
 * The pure builders (sort, search, filter parsing) are proven in
 * `list-query.test.ts`; what only shows up against a real database is that
 * paging, ordering and streaming actually behave against real rows — an
 * off-by-one in `skip`, or a batch loop that never terminates, would not
 * show up against a mock.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

const suite = TEST_DB ? describe : describe.skip;

suite('generic list pagination and export', () => {
  let prisma: (typeof import('../../lib/prisma.js'))['prisma'];
  let paginateOffset: (typeof import('../../lib/list-query.js'))['paginateOffset'];
  let paginateCursor: (typeof import('../../lib/list-query.js'))['paginateCursor'];
  let streamCsvExport: (typeof import('../../lib/list-query.js'))['streamCsvExport'];

  const made: string[] = [];
  const prefix = `lq-${Date.now()}`;

  beforeAll(async () => {
    prisma = (await import('../../lib/prisma.js')).prisma;
    ({ paginateOffset, paginateCursor, streamCsvExport } = await import('../../lib/list-query.js'));

    // 5 users, distinguishable by a shared email prefix and an ordinal in the name
    for (let i = 0; i < 5; i += 1) {
      const user = await prisma.user.create({
        data: {
          email: `${prefix}-${i}@test.dev`,
          name: `List Query ${i}`,
          passwordHash: 'x',
          referralCode: Math.random().toString(36).slice(2, 10).toUpperCase(),
        },
      });
      made.push(user.id);
    }
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  });

  const where = { email: { startsWith: prefix } };

  it('pages through real rows with a correct total and page count', async () => {
    const page1 = await paginateOffset({
      findMany: (args) => prisma.user.findMany(args as never),
      count: (args) => prisma.user.count(args as never),
      where,
      orderBy: [{ email: 'asc' }],
      page: 1,
      pageSize: 2,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.pageCount).toBe(3);
    expect(page1.items.map((u: { email: string }) => u.email)).toEqual([`${prefix}-0@test.dev`, `${prefix}-1@test.dev`]);

    const page3 = await paginateOffset({
      findMany: (args) => prisma.user.findMany(args as never),
      count: (args) => prisma.user.count(args as never),
      where,
      orderBy: [{ email: 'asc' }],
      page: 3,
      pageSize: 2,
    });
    // the last page holds only the remainder
    expect(page3.items).toHaveLength(1);
    expect((page3.items[0] as { email: string }).email).toBe(`${prefix}-4@test.dev`);
  });

  it('returns an empty page, not an error, past the end of the result', async () => {
    const page = await paginateOffset({
      findMany: (args) => prisma.user.findMany(args as never),
      count: (args) => prisma.user.count(args as never),
      where,
      orderBy: [{ email: 'asc' }],
      page: 99,
      pageSize: 2,
    });
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(5);
  });

  it('streams every matching row as CSV, batching past a single page', async () => {
    const chunks: string[] = [];
    const headers: Record<string, string> = {};
    const fakeRes = {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      end: () => undefined,
    };

    await streamCsvExport(
      fakeRes as never,
      'test.csv',
      ['Email'],
      (u: { email: string }) => [u.email],
      (skip, take) =>
        prisma.user.findMany({ where, orderBy: { email: 'asc' }, skip, take }) as never,
    );

    expect(headers['content-type']).toContain('text/csv');
    expect(headers['content-disposition']).toContain('test.csv');
    const body = chunks.join('');
    const lines = body.trim().split('\r\n');
    expect(lines[0]).toBe('Email');
    expect(lines).toHaveLength(6); // header + 5 rows
    for (let i = 0; i < 5; i += 1) expect(body).toContain(`${prefix}-${i}@test.dev`);
  });

  it('cursor-pages through real rows without a count, one id past the last', async () => {
    const first = await paginateCursor({
      findMany: (args) => prisma.user.findMany(args as never),
      where,
      orderBy: { email: 'asc' },
      pageSize: 2,
    });
    expect(first.items.map((u: { email: string }) => u.email)).toEqual([
      `${prefix}-0@test.dev`,
      `${prefix}-1@test.dev`,
    ]);
    expect(first.nextCursor).toBeTruthy();

    const second = await paginateCursor({
      findMany: (args) => prisma.user.findMany(args as never),
      where,
      orderBy: { email: 'asc' },
      cursor: first.nextCursor!,
      pageSize: 2,
    });
    expect(second.items.map((u: { email: string }) => u.email)).toEqual([
      `${prefix}-2@test.dev`,
      `${prefix}-3@test.dev`,
    ]);

    const last = await paginateCursor({
      findMany: (args) => prisma.user.findMany(args as never),
      where,
      orderBy: { email: 'asc' },
      cursor: second.nextCursor!,
      pageSize: 2,
    });
    // only one row left: no further page
    expect(last.items).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
  });
});
