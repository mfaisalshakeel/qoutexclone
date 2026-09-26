const STORAGE_KEY = 'quantex.announcements.dismissed';

/** Per device: dismissing a banner on a phone should not hide it on a desk. */
export function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function dismiss(id: string): void {
  try {
    const next = new Set(loadDismissed());
    next.add(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* a browser with storage denied just shows the banner again next visit */
  }
}
