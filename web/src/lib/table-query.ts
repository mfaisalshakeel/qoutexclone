/**
 * The URL <-> table-state mapping every admin `DataTable` shares: page,
 * pageSize, sort, search and filters all live in the query string, so a
 * link to a filtered, sorted, paged view is shareable and the back button
 * works exactly as it does everywhere else on the web.
 */

export interface TableState {
  page: number;
  pageSize: number;
  sort?: string;
  search?: string;
  filters: Record<string, string>;
}

const RESERVED = new Set(['page', 'pageSize', 'sort', 'search']);

export function parseTableState(params: URLSearchParams, defaultPageSize: number): TableState {
  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? String(defaultPageSize));
  const filters: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (!RESERVED.has(key) && value) filters[key] = value;
  }
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : defaultPageSize,
    sort: params.get('sort') ?? undefined,
    search: params.get('search') ?? undefined,
    filters,
  };
}

export function tableStateToParams(state: TableState): URLSearchParams {
  const params = new URLSearchParams();
  // page 1 and the default page size are the common case; keeping them out
  // of the URL when unremarkable is what makes the "reset" link back to a
  // clean state actually clean
  if (state.page > 1) params.set('page', String(state.page));
  params.set('pageSize', String(state.pageSize));
  if (state.sort) params.set('sort', state.sort);
  if (state.search) params.set('search', state.search);
  for (const [key, value] of Object.entries(state.filters)) {
    if (value) params.set(key, value);
  }
  return params;
}

/** Clicking a new column sorts ascending; clicking the active one flips it. */
export function toggleSort(current: string | undefined, field: string): string {
  if (current === field) return `-${field}`;
  if (current === `-${field}`) return field;
  return field;
}

export function sortField(sort: string | undefined): string | undefined {
  return sort?.replace(/^-/, '');
}

export function sortDirection(sort: string | undefined): 'asc' | 'desc' | undefined {
  if (!sort) return undefined;
  return sort.startsWith('-') ? 'desc' : 'asc';
}
