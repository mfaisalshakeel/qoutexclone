import { useState } from 'react';
import { STUDIES, STUDY_BY_ID, defaultSettings, type StudyId, type StudySettings } from '../chart/studies';

interface Props {
  active: StudySettings[];
  onChange: (studies: StudySettings[]) => void;
  onClose: () => void;
}

/**
 * The studies panel: everything the chart can draw, what is on it now, and the
 * periods and colours of each.
 *
 * The list is generated from the registry, so an indicator cannot be added to
 * the engine without its controls appearing here.
 */
export function StudiesPanel({ active, onChange, onClose }: Props) {
  const [expanded, setExpanded] = useState<StudyId | null>(null);
  const byId = new Map(active.map((study) => [study.id, study]));

  const toggle = (id: StudyId) => {
    if (byId.has(id)) {
      onChange(active.filter((study) => study.id !== id));
      if (expanded === id) setExpanded(null);
      return;
    }
    onChange([...active, defaultSettings(id)]);
    setExpanded(id);
  };

  const update = (id: StudyId, patch: Partial<StudySettings>) => {
    onChange(
      active.map((study) =>
        study.id === id
          ? {
              ...study,
              ...patch,
              values: { ...study.values, ...patch.values },
              colors: { ...study.colors, ...patch.colors },
            }
          : study,
      ),
    );
  };

  return (
    <div
      role="dialog"
      aria-label="Studies"
      className="absolute right-0 z-30 mt-2 max-h-[70vh] w-72 animate-fade-up overflow-y-auto rounded-xl border border-ink-500 bg-ink-800 p-1.5 shadow-2xl"
    >
      <div className="flex items-center justify-between px-2 py-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Studies</h3>
        <button
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-xs text-slate-400 hover:text-slate-200"
        >
          Done
        </button>
      </div>

      {STUDIES.map((study) => {
        const settings = byId.get(study.id);
        const on = !!settings;
        return (
          <div key={study.id} className="rounded-lg">
            <div className="flex items-center gap-2 px-2 py-1.5 transition hover:bg-ink-700/60">
              <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-xs">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(study.id)}
                  className="h-3.5 w-3.5 rounded border-ink-500 bg-ink-900"
                />
                <span className={on ? 'text-slate-100' : 'text-slate-400'}>{study.label}</span>
                {study.pane === 'own' && (
                  <span className="chip bg-ink-700 !px-1.5 !py-0 text-[10px] text-slate-500">pane</span>
                )}
              </label>
              {on && (study.params.length > 0 || study.colors.length > 0) && (
                <button
                  onClick={() => setExpanded(expanded === study.id ? null : study.id)}
                  aria-label={`Settings for ${study.label}`}
                  aria-expanded={expanded === study.id}
                  className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-ink-600 hover:text-slate-200"
                >
                  ⚙
                </button>
              )}
            </div>

            {on && expanded === study.id && settings && (
              <div className="mb-1 space-y-2 rounded-lg bg-ink-900/60 px-3 py-2.5">
                {study.params.map((param) => (
                  <label key={param.key} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="text-slate-400">{param.label}</span>
                    <input
                      type="number"
                      value={settings.values[param.key] ?? param.default}
                      min={param.min}
                      max={param.max}
                      step={param.step ?? 1}
                      aria-label={`${study.label} ${param.label}`}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value)) return;
                        update(study.id, { values: { [param.key]: value } });
                      }}
                      className="tabular w-20 rounded border border-ink-500 bg-ink-800 px-2 py-1 text-right text-slate-100"
                    />
                  </label>
                ))}
                {study.colors.map((color) => (
                  <label key={color.key} className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="text-slate-400">{color.label}</span>
                    <input
                      type="color"
                      value={settings.colors[color.key] ?? color.default}
                      aria-label={`${study.label} ${color.label} colour`}
                      onChange={(event) => update(study.id, { colors: { [color.key]: event.target.value } })}
                      className="h-6 w-10 cursor-pointer rounded border border-ink-500 bg-ink-800"
                    />
                  </label>
                ))}
                <button
                  onClick={() =>
                    onChange(active.map((each) => (each.id === study.id ? defaultSettings(study.id) : each)))
                  }
                  className="text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
                >
                  Reset to defaults
                </button>
              </div>
            )}
          </div>
        );
      })}

      {active.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="mt-1 w-full rounded-lg px-3 py-2 text-left text-[11px] text-slate-400 transition hover:bg-ink-700 hover:text-slate-200"
        >
          Clear all {active.length} {active.length === 1 ? 'study' : 'studies'}
        </button>
      )}
      {/* a study whose definition has gone is dropped rather than drawn wrong */}
      {active.some((study) => !STUDY_BY_ID.has(study.id)) && null}
    </div>
  );
}
