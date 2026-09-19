import { DRAWING_TOOLS, type Drawing, type DrawingKind } from '../chart/drawings';

const COLOURS = ['#f6c445', '#3d7bff', '#12b886', '#f0455e', '#e2e8f0'];

interface Props {
  tool: DrawingKind | null;
  onTool: (tool: DrawingKind | null) => void;
  color: string;
  onColor: (color: string) => void;
  selected: Drawing | null;
  onUpdate: (patch: Partial<Drawing>) => void;
  onDelete: () => void;
  onClear: () => void;
  count: number;
}

/**
 * The drawing tools, down the left edge of the chart.
 *
 * A tool draws one mark and then puts itself away, which is what a trader
 * expects from every other charting package — and it means the chart is back to
 * panning without a second click.
 */
export function DrawingTools({
  tool,
  onTool,
  color,
  onColor,
  selected,
  onUpdate,
  onDelete,
  onClear,
  count,
}: Props) {
  return (
    <div className="absolute left-2 top-2 z-10 flex flex-col gap-1" role="group" aria-label="Drawing tools">
      {DRAWING_TOOLS.map((each) => (
        <button
          key={each.kind}
          onClick={() => onTool(tool === each.kind ? null : each.kind)}
          aria-label={each.label}
          aria-pressed={tool === each.kind}
          title={each.label}
          className={`h-7 w-7 rounded-lg border text-xs font-semibold transition ${
            tool === each.kind
              ? 'border-accent bg-accent text-white'
              : 'border-ink-500 bg-ink-800/90 text-slate-300 hover:bg-ink-700'
          }`}
        >
          {each.glyph}
        </button>
      ))}

      {/* the colour the next mark is drawn in */}
      <div className="mt-1 flex flex-col gap-1 rounded-lg border border-ink-500 bg-ink-800/90 p-1">
        {COLOURS.map((each) => (
          <button
            key={each}
            onClick={() => (selected ? onUpdate({ color: each }) : onColor(each))}
            aria-label={`Colour ${each}`}
            aria-pressed={color === each}
            className={`h-4 w-5 rounded ${color === each ? 'ring-1 ring-white' : ''}`}
            style={{ background: each }}
          />
        ))}
      </div>

      {selected && (
        <div className="mt-1 flex flex-col gap-1">
          <button
            onClick={() => onUpdate({ locked: !selected.locked })}
            aria-label={selected.locked ? 'Unlock drawing' : 'Lock drawing'}
            aria-pressed={!!selected.locked}
            className="h-7 w-7 rounded-lg border border-ink-500 bg-ink-800/90 text-xs text-slate-300 transition hover:bg-ink-700"
          >
            {selected.locked ? '🔒' : '🔓'}
          </button>
          <button
            onClick={onDelete}
            aria-label="Delete drawing"
            className="h-7 w-7 rounded-lg border border-down/50 bg-ink-800/90 text-xs text-down transition hover:bg-down/20"
          >
            ✕
          </button>
        </div>
      )}

      {count > 0 && !selected && (
        <button
          onClick={onClear}
          aria-label="Clear all drawings"
          title={`Clear ${count} drawings`}
          className="mt-1 h-7 w-7 rounded-lg border border-ink-500 bg-ink-800/90 text-[10px] text-slate-400 transition hover:bg-ink-700"
        >
          ⌫{count}
        </button>
      )}
    </div>
  );
}
