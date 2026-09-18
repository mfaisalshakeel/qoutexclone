import { describe, expect, it } from 'vitest';
import {
  clampFocus,
  defaultLayout,
  gridClass,
  paneCount,
  parseLayout,
  resize,
  updatePane,
  type Pane,
  type TerminalLayout,
} from './layout';

const pane = (symbol: string, timeframe = '1m'): Pane => ({ symbol, timeframe });
const base = defaultLayout('EURUSD', '1m');

describe('layout shapes', () => {
  it('knows how many charts each one holds', () => {
    expect(paneCount('single')).toBe(1);
    expect(paneCount('cols')).toBe(2);
    expect(paneCount('rows')).toBe(2);
    expect(paneCount('quad')).toBe(4);
  });

  it('falls back for an unknown kind rather than rendering nothing', () => {
    expect(paneCount('nonsense' as never)).toBe(1);
    expect(gridClass('nonsense' as never)).toContain('grid-cols-1');
  });

  it('stacks rows and splits columns', () => {
    expect(gridClass('rows')).toContain('grid-rows-2');
    expect(gridClass('cols')).toContain('md:grid-cols-2');
  });
});

describe('resizing', () => {
  it('keeps the panes that survive and fills the new ones', () => {
    const grown = resize([pane('EURUSD')], 'quad', pane('EURUSD'));
    expect(grown).toHaveLength(4);
    expect(grown.every((each) => each.symbol === 'EURUSD')).toBe(true);
  });

  it('drops the extras, keeping the first ones', () => {
    const shrunk = resize([pane('A'), pane('B'), pane('C'), pane('D')], 'cols', pane('A'));
    expect(shrunk.map((each) => each.symbol)).toEqual(['A', 'B']);
  });

  it('leaves the first pane untouched through a round trip', () => {
    const start = [pane('BTCUSDT', '5m')];
    const back = resize(resize(start, 'quad', pane('X')), 'single', pane('X'));
    expect(back).toEqual(start);
  });

  it('fills from the fallback when there is nothing to copy', () => {
    expect(resize([], 'cols', pane('XAUUSD', '1h'))).toEqual([pane('XAUUSD', '1h'), pane('XAUUSD', '1h')]);
  });

  it('copies rather than sharing a pane object', () => {
    const grown = resize([pane('A')], 'cols', pane('A'));
    grown[1].symbol = 'B';
    expect(grown[0].symbol).toBe('A');
  });
});

describe('focus', () => {
  it('stays on a pane that exists', () => {
    expect(clampFocus(3, 'quad')).toBe(3);
    expect(clampFocus(3, 'single')).toBe(0);
    expect(clampFocus(-2, 'cols')).toBe(0);
    expect(clampFocus(Number.NaN, 'quad')).toBe(0);
  });
});

describe('reading a stored layout', () => {
  it('falls back for anything that is not one', () => {
    expect(parseLayout(null, base)).toEqual(base);
    expect(parseLayout('single', base)).toEqual(base);
    expect(parseLayout(42, base)).toEqual(base);
  });

  it('keeps a valid layout', () => {
    const stored: TerminalLayout = { kind: 'cols', panes: [pane('A'), pane('B', '5m')], focused: 1 };
    expect(parseLayout(stored, base)).toEqual(stored);
  });

  it('drops panes that are not panes, then refills to the right count', () => {
    const parsed = parseLayout(
      { kind: 'cols', panes: [pane('A'), { symbol: 7 }, null, { timeframe: '1m' }], focused: 0 },
      base,
    );
    expect(parsed.panes).toHaveLength(2);
    expect(parsed.panes[0].symbol).toBe('A');
    expect(parsed.panes[1].symbol).toBe('A');
  });

  it('pulls a focus beyond the layout back into it', () => {
    expect(parseLayout({ kind: 'single', panes: [pane('A')], focused: 9 }, base).focused).toBe(0);
  });

  it('treats an unknown kind as a single chart', () => {
    const parsed = parseLayout({ kind: 'hexagonal', panes: [pane('A'), pane('B')], focused: 1 }, base);
    expect(parsed.kind).toBe('single');
    expect(parsed.panes).toHaveLength(1);
    expect(parsed.focused).toBe(0);
  });
});

describe('changing one pane', () => {
  const layout: TerminalLayout = { kind: 'cols', panes: [pane('A'), pane('B')], focused: 0 };

  it('leaves the others alone', () => {
    const next = updatePane(layout, 1, { timeframe: '1h' });
    expect(next.panes[0]).toEqual(pane('A'));
    expect(next.panes[1]).toEqual(pane('B', '1h'));
  });

  it('ignores an index that is not there', () => {
    expect(updatePane(layout, 5, { symbol: 'C' })).toBe(layout);
    expect(updatePane(layout, -1, { symbol: 'C' })).toBe(layout);
  });
});
