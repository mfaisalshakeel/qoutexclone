import { beforeEach, describe, expect, it } from 'vitest';
import { useMarket } from './market';
import { defaultLayout } from '../lib/layout';

/**
 * The stored workspace arrives with the account, which can be well after the
 * terminal is usable. A market the trader has already chosen must survive it.
 */
describe('adopting the stored workspace', () => {
  const stored = {
    kind: 'single' as const,
    panes: [{ symbol: 'AAPL', timeframe: '4h' }],
    focused: 0,
  };

  beforeEach(() => {
    useMarket.setState({
      layout: defaultLayout('EURUSD', '1m'),
      symbol: 'EURUSD',
      timeframe: '1m',
      layoutTouched: false,
      recents: [],
    });
  });

  it('takes the layout the account was left in', () => {
    useMarket.getState().adoptLayout(stored);
    expect(useMarket.getState().symbol).toBe('AAPL');
    expect(useMarket.getState().timeframe).toBe('4h');
  });

  it('never overwrites a market the trader just chose', () => {
    useMarket.getState().selectSymbol('BTCUSDT');
    useMarket.getState().adoptLayout(stored);
    expect(useMarket.getState().symbol).toBe('BTCUSDT');
  });

  it('is claimed by any deliberate change to the workspace', () => {
    useMarket.getState().setTimeframe('5m');
    useMarket.getState().adoptLayout(stored);
    expect(useMarket.getState().timeframe).toBe('5m');
    expect(useMarket.getState().symbol).toBe('EURUSD');
  });

  it('adopts again once the session is handed over', () => {
    useMarket.getState().selectSymbol('BTCUSDT');
    useMarket.getState().forgetLayout();
    useMarket.getState().adoptLayout(stored);
    expect(useMarket.getState().symbol).toBe('AAPL');
  });

  it('falls back rather than throwing on a layout from another version', () => {
    useMarket.getState().adoptLayout({ kind: 'hexagon', panes: 'lots' });
    expect(useMarket.getState().symbol).toBe('EURUSD');
    expect(useMarket.getState().layout.panes).toHaveLength(1);
  });
});
