/** Cents -> "$1,234.56". */
export function money(cents: number, options: { sign?: boolean; currency?: boolean } = {}): string {
  const { sign = false, currency = true } = options;
  const value = cents / 100;
  const text = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const prefix = value < 0 ? '-' : sign ? '+' : '';
  return `${prefix}${currency ? '$' : ''}${text}`;
}

export function price(value: number | null | undefined, precision = 2): string {
  if (value == null) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export function percent(value: number, digits = 2): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

/** mm:ss left until `target`, floored at zero. */
export function countdown(target: string | Date): string {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return '00:00';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** "in 2h 15m" / "in 3d", for a market's next open. */
export function untilShort(target: string | Date): string {
  const ms = new Date(target).getTime() - Date.now();
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

export function dateTime(value: string | Date): string {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shortHash(hash?: string | null, size = 6): string {
  if (!hash) return '—';
  return hash.length <= size * 2 + 3 ? hash : `${hash.slice(0, size)}…${hash.slice(-size)}`;
}
