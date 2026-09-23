import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import {
  parseTableState,
  sortDirection,
  sortField,
  tableStateToParams,
  toggleSort,
} from '../../lib/table-query';
import { toast } from '../../store/toast';
import { TableSkeleton } from '../Skeleton';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
  /** Hidden until the viewer opts in from the column picker. */
  hiddenByDefault?: boolean;
}

export interface DataTableFilter {
  key: string;
  label: string;
  type: 'enum' | 'dateRange';
  options?: { value: string; label: string }[];
}

export interface DataTablePage<T> {
  items: T[];
  total: number;
  pageCount: number;
}

export interface DataTableBulkAction {
  label: string;
  tone?: 'default' | 'danger';
  onClick: (selectedIds: string[]) => Promise<void> | void;
}

interface DataTableProps<T> {
  title: string;
  columns: DataTableColumn<T>[];
  filters?: DataTableFilter[];
  searchPlaceholder?: string;
  rowKey: (row: T) => string;
  fetchPage: (state: {
    page: number;
    pageSize: number;
    sort?: string;
    search?: string;
    filters: Record<string, string>;
  }) => Promise<DataTablePage<T>>;
  /** Builds the export URL from the current filter/search/sort state. */
  exportPath?: (params: URLSearchParams) => string;
  renderMobileCard?: (row: T) => ReactNode;
  renderDrawer?: (row: T, close: () => void) => ReactNode;
  bulkActions?: DataTableBulkAction[];
  pageSizeOptions?: number[];
  defaultPageSize?: number;
  /** Bumping this forces a reload — e.g. after an action elsewhere changed the data. */
  reloadToken?: number;
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];

export function DataTable<T>({
  title,
  columns,
  filters = [],
  searchPlaceholder = 'Search',
  rowKey,
  fetchPage,
  exportPath,
  renderMobileCard,
  renderDrawer,
  bulkActions,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  defaultPageSize = 25,
  reloadToken = 0,
}: DataTableProps<T>) {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => parseTableState(params, defaultPageSize), [params, defaultPageSize]);

  const [searchInput, setSearchInput] = useState(state.search ?? '');
  const [page, setPage] = useState<DataTablePage<T> | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(columns.filter((c) => c.hiddenByDefault).map((c) => c.key)),
  );
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const [drawerRow, setDrawerRow] = useState<T | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const update = (patch: Partial<typeof state>) => {
    setParams(tableStateToParams({ ...state, ...patch }), { replace: true });
  };

  // the search box debounces locally; every other control updates the URL immediately
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (searchInput !== (state.search ?? '')) update({ search: searchInput || undefined, page: 1 });
    }, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const filtersKey = JSON.stringify(state.filters);

  useEffect(() => {
    let cancelled = false;
    setError('');
    fetchPage(state)
      .then((result) => {
        if (!cancelled) setPage(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this list');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.page, state.pageSize, state.sort, state.search, filtersKey, reloadToken]);

  // a filter/search/sort change that shrinks the result set can strand a stale selection
  useEffect(() => setSelected(new Set()), [state.page, state.search, filtersKey]);

  const visibleColumns = columns.filter((c) => !hiddenColumns.has(c.key));

  const allSelected = page
    ? page.items.length > 0 && page.items.every((row) => selected.has(rowKey(row)))
    : false;
  const toggleAll = () => {
    if (!page) return;
    setSelected(allSelected ? new Set() : new Set(page.items.map(rowKey)));
  };
  const toggleRow = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulkAction = async (action: DataTableBulkAction) => {
    setBulkBusy(true);
    try {
      await action.onClick([...selected]);
      setSelected(new Set());
      update({});
    } catch (err) {
      toast.error('Bulk action failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBulkBusy(false);
    }
  };

  const exportUrl = exportPath ? exportPath(tableStateToParams(state)) : undefined;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {page && <p className="mt-0.5 text-xs text-slate-500">{page.total} total</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={searchPlaceholder}
            className="field !w-56 !py-2 !text-xs"
          />
          <ColumnPicker
            columns={columns}
            hidden={hiddenColumns}
            onChange={setHiddenColumns}
            open={columnPickerOpen}
            setOpen={setColumnPickerOpen}
          />
          {exportUrl && (
            <button
              onClick={() =>
                void api.download(exportUrl).catch((err) => {
                  toast.error('Export failed', err instanceof ApiError ? err.message : undefined);
                })
              }
              className="btn-ghost !px-3 !py-2 text-xs"
            >
              Export CSV
            </button>
          )}
        </div>
      </div>

      {filters.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {filters.map((filter) => (
            <FilterChip
              key={filter.key}
              filter={filter}
              value={state.filters[filter.key]}
              onChange={(value) => update({ page: 1, filters: { ...state.filters, [filter.key]: value } })}
            />
          ))}
          {Object.keys(state.filters).length > 0 && (
            <button
              onClick={() => update({ page: 1, filters: {} })}
              className="chip bg-ink-700 text-slate-400 hover:text-slate-200"
            >
              Clear filters ✕
            </button>
          )}
        </div>
      )}

      {bulkActions && bulkActions.length > 0 && selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-accent/40 bg-accent-soft px-4 py-2.5">
          <span className="text-xs font-semibold">{selected.size} selected</span>
          <span className="ml-auto flex gap-2">
            {bulkActions.map((action) => (
              <button
                key={action.label}
                disabled={bulkBusy}
                onClick={() => void runBulkAction(action)}
                className={`btn-ghost !px-3 !py-1.5 text-xs ${action.tone === 'danger' ? '!text-down' : ''}`}
              >
                {action.label}
              </button>
            ))}
          </span>
        </div>
      )}

      {error ? (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <p className="text-xs text-slate-400">{error}</p>
          <button onClick={() => update({})} className="btn-ghost text-xs">
            Retry
          </button>
        </div>
      ) : !page ? (
        <TableSkeleton rows={8} cols={visibleColumns.length + (bulkActions ? 1 : 0)} />
      ) : page.items.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm text-slate-500">Nothing matches</p>
        </div>
      ) : (
        <>
          {/* cards on phones */}
          <ul className="space-y-2 sm:hidden">
            {page.items.map((row) => (
              <li key={rowKey(row)} className="card p-3.5">
                {renderMobileCard ? (
                  renderMobileCard(row)
                ) : (
                  <MobileFallbackCard row={row} columns={visibleColumns} />
                )}
                {renderDrawer && (
                  <button
                    onClick={() => setDrawerRow(row)}
                    className="btn-ghost mt-2 w-full !py-1.5 text-[11px]"
                  >
                    View details
                  </button>
                )}
              </li>
            ))}
          </ul>

          {/* real table on desktop */}
          <div className="card hidden overflow-hidden sm:block">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="sticky top-0 z-10 bg-ink-700 text-[10px] uppercase tracking-wide text-slate-400">
                  <tr>
                    {bulkActions && (
                      <th className="w-10 px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleAll}
                          aria-label="Select all rows on this page"
                          className="accent-accent"
                        />
                      </th>
                    )}
                    {visibleColumns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-4 py-2.5 font-medium ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                      >
                        {col.sortable ? (
                          <button
                            onClick={() => update({ page: 1, sort: toggleSort(state.sort, col.key) })}
                            className="flex items-center gap-1 hover:text-slate-200"
                          >
                            {col.label}
                            {sortField(state.sort) === col.key && (
                              <span>{sortDirection(state.sort) === 'desc' ? '▼' : '▲'}</span>
                            )}
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700">
                  {page.items.map((row) => {
                    const id = rowKey(row);
                    return (
                      <tr
                        key={id}
                        onClick={() => renderDrawer && setDrawerRow(row)}
                        className={renderDrawer ? 'cursor-pointer hover:bg-ink-700/40' : ''}
                      >
                        {bulkActions && (
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected.has(id)}
                              onChange={() => toggleRow(id)}
                              aria-label={`Select row ${id}`}
                              className="accent-accent"
                            />
                          </td>
                        )}
                        {visibleColumns.map((col) => (
                          <td
                            key={col.key}
                            className={`px-4 py-3 align-top ${col.align === 'right' ? 'text-right' : ''}`}
                          >
                            {col.render(row)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Pager
            page={state.page}
            pageCount={page.pageCount}
            pageSize={state.pageSize}
            pageSizeOptions={pageSizeOptions}
            onPage={(p) => update({ page: p })}
            onPageSize={(size) => update({ page: 1, pageSize: size })}
          />
        </>
      )}

      {renderDrawer && drawerRow && (
        <Drawer onClose={() => setDrawerRow(null)}>
          {renderDrawer(drawerRow, () => setDrawerRow(null))}
        </Drawer>
      )}
    </div>
  );
}

function MobileFallbackCard<T>({ row, columns }: { row: T; columns: DataTableColumn<T>[] }) {
  return (
    <dl className="space-y-1.5">
      {columns.map((col) => (
        <div key={col.key} className="flex items-baseline justify-between gap-3 text-xs">
          <dt className="text-slate-500">{col.label}</dt>
          <dd className="text-right">{col.render(row)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ColumnPicker<T>({
  columns,
  hidden,
  onChange,
  open,
  setOpen,
}: {
  columns: DataTableColumn<T>[];
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="btn-ghost !px-3 !py-2 text-xs">
        Columns
      </button>
      {open && (
        <>
          <button
            aria-label="Close column picker"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-20 cursor-default"
          />
          <div className="absolute right-0 top-full z-30 mt-1.5 w-48 rounded-lg border border-ink-600 bg-ink-800 p-2 shadow-lg">
            {columns.map((col) => (
              <label
                key={col.key}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-ink-700"
              >
                <input
                  type="checkbox"
                  checked={!hidden.has(col.key)}
                  onChange={() => {
                    const next = new Set(hidden);
                    if (next.has(col.key)) next.delete(col.key);
                    else next.add(col.key);
                    onChange(next);
                  }}
                  className="accent-accent"
                />
                {col.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Exported so a bespoke list layout (e.g. the support inbox) can reuse the same filter UI as DataTable. */
export function FilterChip({
  filter,
  value,
  onChange,
}: {
  filter: DataTableFilter;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  if (filter.type === 'enum') {
    const selectedValues = new Set((value ?? '').split(',').filter(Boolean));
    return (
      <details className="relative">
        <summary
          className={`chip cursor-pointer select-none ${selectedValues.size > 0 ? 'bg-accent-soft text-accent' : 'bg-ink-700 text-slate-400'}`}
        >
          {filter.label}
          {selectedValues.size > 0 ? ` (${selectedValues.size})` : ''}
        </summary>
        <div className="absolute left-0 top-full z-30 mt-1.5 w-44 rounded-lg border border-ink-600 bg-ink-800 p-2 shadow-lg">
          {(filter.options ?? []).map((option) => (
            <label
              key={option.value}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-ink-700"
            >
              <input
                type="checkbox"
                checked={selectedValues.has(option.value)}
                onChange={() => {
                  const next = new Set(selectedValues);
                  if (next.has(option.value)) next.delete(option.value);
                  else next.add(option.value);
                  onChange([...next].join(','));
                }}
                className="accent-accent"
              />
              {option.label}
            </label>
          ))}
        </div>
      </details>
    );
  }

  // dateRange: "from..to"
  const [from, to] = (value ?? '..').split('..');
  return (
    <details className="relative">
      <summary
        className={`chip cursor-pointer select-none ${value ? 'bg-accent-soft text-accent' : 'bg-ink-700 text-slate-400'}`}
      >
        {filter.label}
      </summary>
      <div className="absolute left-0 top-full z-30 mt-1.5 flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 p-2 shadow-lg">
        <input
          type="date"
          value={from || ''}
          onChange={(e) => onChange(`${e.target.value}..${to || ''}`)}
          className="field !w-auto !py-1 !text-[11px]"
        />
        <span className="text-slate-500">–</span>
        <input
          type="date"
          value={to || ''}
          onChange={(e) => onChange(`${from || ''}..${e.target.value}`)}
          className="field !w-auto !py-1 !text-[11px]"
        />
      </div>
    </details>
  );
}

/** Exported so a bespoke list layout (e.g. the support inbox) can reuse the same pager as DataTable. */
export function Pager({
  page,
  pageCount,
  pageSize,
  pageSizeOptions,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  // a compact window around the current page, so a 300-page table doesn't render 300 buttons
  const window = 2;
  const numbers = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === pageCount || Math.abs(n - page) <= window,
  );

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-[11px] text-slate-500">
        Rows per page
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="field !w-auto !py-1.5 !text-xs"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="btn-ghost !px-2.5 !py-1.5 text-xs disabled:opacity-40"
        >
          ‹
        </button>
        {numbers.map((n, i) => (
          <span key={n} className="flex items-center">
            {i > 0 && numbers[i - 1] !== n - 1 && <span className="px-1 text-slate-600">…</span>}
            <button
              onClick={() => onPage(n)}
              className={`min-w-[1.75rem] rounded-md px-2 py-1.5 text-xs font-semibold ${
                n === page ? 'bg-ink-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {n}
            </button>
          </span>
        ))}
        <button
          onClick={() => onPage(Math.min(pageCount, page + 1))}
          disabled={page >= pageCount}
          className="btn-ghost !px-2.5 !py-1.5 text-xs disabled:opacity-40"
        >
          ›
        </button>
      </div>
    </div>
  );
}

function Drawer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Close panel" onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative h-full w-full max-w-md overflow-y-auto bg-ink-800 p-5 shadow-2xl">
        <button onClick={onClose} className="btn-ghost absolute right-4 top-4 !px-2.5 !py-1.5 text-xs">
          Close ✕
        </button>
        {children}
      </div>
    </div>
  );
}
