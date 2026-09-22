import type { Response } from 'express';
import { z } from 'zod';
import { badRequest } from './errors.js';
import { csvRow } from './csv.js';

/**
 * The generic shape every admin list endpoint shares: page + pageSize with a
 * total, multi-column sort, a free-text search, and typed filters. One
 * schema and one set of builders, reused by every list rather than each
 * route inventing its own query parsing.
 */

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sort: z.string().max(200).optional(),
  search: z.string().max(120).optional(),
});
export type ListQueryInput = z.infer<typeof listQuerySchema>;

export type SortOrder = { [field: string]: 'asc' | 'desc' };

/**
 * Parses `sort=-createdAt,email` into Prisma `orderBy` clauses, applied in
 * the order given (the first is the primary sort). Only fields the caller
 * named are eligible — a client cannot sort by a column the endpoint never
 * offered, indexed or not.
 */
export function buildOrderBy(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: SortOrder,
): SortOrder[] {
  if (!sort) return [fallback];
  const clauses = sort
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean);
  if (clauses.length === 0) return [fallback];
  return clauses.map((raw) => {
    const desc = raw.startsWith('-');
    const field = desc ? raw.slice(1) : raw;
    if (!allowed.includes(field)) throw badRequest(`Cannot sort by "${field}"`, 'invalid_sort');
    return { [field]: desc ? 'desc' : 'asc' };
  });
}

/**
 * Builds `{ a: { b: value } }` from a dot-path like `"a.b"` — Prisma's own
 * shape for filtering through a relation (`user.email` becomes a nested
 * `user: { email: ... }` clause, not a literal `"user.email"` key).
 */
function nested(path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.');
  return parts.reduceRight<unknown>((acc, key) => ({ [key]: acc }), value) as Record<string, unknown>;
}

/**
 * A search term OR'd across every configured field, substring-matched. A
 * field may be a dot-path through a relation, e.g. `user.email`, since
 * "search by the trader's email" is the common case on almost every list
 * that is not the trader list itself.
 */
export function buildSearchWhere(
  search: string | undefined,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (!search || fields.length === 0) return undefined;
  return { OR: fields.map((field) => nested(field, { contains: search })) };
}

export type FilterSpec =
  | { type: 'enum'; values: readonly string[] }
  | { type: 'dateRange' }
  | { type: 'numberRange' }
  | { type: 'boolean' };

/**
 * Turns `{status: "PENDING,APPROVED", createdAt: "2026-01-01..2026-02-01"}`
 * into a Prisma `where` fragment, validated against each field's declared
 * shape. An enum takes a comma-separated list; a range takes `from..to`,
 * either side optional. An unrecognised value refuses loudly rather than
 * silently matching everything.
 */
export function buildFilterWhere(
  specs: Record<string, FilterSpec>,
  raw: Record<string, string | undefined>,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const value = raw[name];
    if (value === undefined || value === '') continue;

    if (spec.type === 'enum') {
      const values = value.split(',').filter(Boolean);
      for (const v of values) {
        if (!spec.values.includes(v))
          throw badRequest(`Invalid value for filter "${name}": ${v}`, 'invalid_filter');
      }
      if (values.length > 0) where[name] = values.length === 1 ? values[0] : { in: values };
      continue;
    }

    if (spec.type === 'boolean') {
      if (value !== 'true' && value !== 'false') {
        throw badRequest(`Filter "${name}" must be true or false`, 'invalid_filter');
      }
      where[name] = value === 'true';
      continue;
    }

    // dateRange | numberRange: "from..to", either side optional
    const [fromRaw, toRaw] = value.split('..');
    const range: Record<string, Date | number> = {};
    const parse = spec.type === 'dateRange' ? (s: string) => new Date(s) : (s: string) => Number(s);
    const invalid = (v: number | Date) => (v instanceof Date ? Number.isNaN(v.getTime()) : Number.isNaN(v));

    if (fromRaw) {
      const from = parse(fromRaw);
      if (invalid(from)) throw badRequest(`Invalid value for filter "${name}"`, 'invalid_filter');
      range.gte = from;
    }
    if (toRaw) {
      const to = parse(toRaw);
      if (invalid(to)) throw badRequest(`Invalid value for filter "${name}"`, 'invalid_filter');
      range.lte = to;
    }
    if (Object.keys(range).length > 0) where[name] = range;
  }
  return where;
}

/** ANDs together whichever where-fragments actually have something in them. */
export function combineWhere(...parts: (Record<string, unknown> | undefined)[]): Record<string, unknown> {
  const clauses = parts.filter((p): p is Record<string, unknown> => !!p && Object.keys(p).length > 0);
  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { AND: clauses };
}

export interface OffsetPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
}

/**
 * The common offset-paginated list: a page of rows plus the total count, run
 * as one round trip. `findMany`/`count` are the caller's own Prisma delegate
 * methods, so this stays usable against any model without a shared generic
 * type fighting Prisma's per-model types.
 */
export async function paginateOffset<T>(options: {
  findMany: (args: { where: unknown; orderBy: unknown; skip: number; take: number }) => Promise<T[]>;
  count: (args: { where: unknown }) => Promise<number>;
  where: unknown;
  orderBy: unknown;
  page: number;
  pageSize: number;
}): Promise<OffsetPage<T>> {
  const skip = (options.page - 1) * options.pageSize;
  const [items, total] = await Promise.all([
    options.findMany({ where: options.where, orderBy: options.orderBy, skip, take: options.pageSize }),
    options.count({ where: options.where }),
  ]);
  return {
    items,
    page: options.page,
    pageSize: options.pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / options.pageSize)),
  };
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Cursor pagination for a table too large to count on every page — no
 * `COUNT(*)`, no `OFFSET` to skip past on a huge table, just "the next N
 * after this id". Fetches one extra row to know whether there is a next
 * page without a second query, the same trick `listTransactions` already
 * uses for the wallet ledger.
 */
export async function paginateCursor<T extends { id: string }>(options: {
  findMany: (args: {
    where: unknown;
    orderBy: unknown;
    take: number;
    cursor?: { id: string };
    skip?: number;
  }) => Promise<T[]>;
  where: unknown;
  orderBy: unknown;
  cursor?: string;
  pageSize: number;
}): Promise<CursorPage<T>> {
  const items = await options.findMany({
    where: options.where,
    orderBy: options.orderBy,
    take: options.pageSize + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > options.pageSize;
  return {
    items: hasMore ? items.slice(0, options.pageSize) : items,
    nextCursor: hasMore ? items[options.pageSize - 1].id : null,
  };
}

const CSV_BATCH_SIZE = 500;

/**
 * Streams the full filtered result as CSV rather than building it in memory
 * — a back office export can run into the tens of thousands of rows. The
 * caller supplies one page at a time via `fetchPage`, keyed by whatever
 * cursor its own model uses, so this helper never has to know the shape of
 * the underlying table.
 */
export async function streamCsvExport<T>(
  res: Response,
  filename: string,
  header: string[],
  toRow: (item: T) => string[],
  fetchPage: (skip: number, take: number) => Promise<T[]>,
): Promise<void> {
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="${filename}"`);
  res.write(`${csvRow(header)}\r\n`);

  let skip = 0;
  for (;;) {
    const batch = await fetchPage(skip, CSV_BATCH_SIZE);
    for (const item of batch) res.write(`${csvRow(toRow(item))}\r\n`);
    if (batch.length < CSV_BATCH_SIZE) break;
    skip += CSV_BATCH_SIZE;
  }
  res.end();
}
