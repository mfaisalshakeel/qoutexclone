import { useSettings } from '../store/settings';

/** Shown for the whole time maintenance mode is on — matches what the server actually enforces. */
export function MaintenanceBanner() {
  const active = useSettings((s) => s.values['general.maintenanceMode'] as boolean | undefined);
  const message = useSettings((s) => s.values['general.maintenanceMessage'] as string | undefined);
  if (!active) return null;

  return (
    <div role="status" className="border-b border-amber-400/30 bg-amber-400/10 px-3 py-2.5 sm:px-4">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 text-sm text-amber-300">
        <p>{message || 'Trading and payments are paused for maintenance.'}</p>
      </div>
    </div>
  );
}
