import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { money } from '../../lib/format';
import { toast } from '../../store/toast';
import { Empty, Loading, PageHead, StatusPill, Table, Td } from '../../components/admin/ui';

/* ------------------------------ bonus offers ------------------------------ */

interface BonusOffer {
  id: string;
  key: string;
  name: string;
  description: string;
  percent: number;
  maxBonusCents: number;
  minDepositCents: number;
  turnoverMultiplier: number;
  enabled: boolean;
  sortOrder: number;
}

const emptyOfferForm = {
  key: '',
  name: '',
  description: '',
  percent: 30,
  maxBonus: 300,
  minDeposit: 50,
  turnoverMultiplier: 15,
  sortOrder: 0,
};

/** The deposit-time bonus offers a trader is shown — Phase 4's bonus engine, with no admin screen of its own until now. */
export function AdminBonusOffers() {
  const [offers, setOffers] = useState<BonusOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<BonusOffer | null>(null);
  const [form, setForm] = useState(emptyOfferForm);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ offers: BonusOffer[] }>('/admin/bonus-offers');
      setOffers(data.offers);
      setOpen((current) => (current ? (data.offers.find((o) => o.id === current.id) ?? null) : null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load bonus offers');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/admin/bonus-offers', {
        key: form.key,
        name: form.name,
        description: form.description,
        percent: form.percent,
        maxBonusCents: Math.round(form.maxBonus * 100),
        minDepositCents: Math.round(form.minDeposit * 100),
        turnoverMultiplier: form.turnoverMultiplier,
        sortOrder: form.sortOrder,
        enabled: true,
      });
      setForm(emptyOfferForm);
      toast.success('Bonus offer created');
      void load();
    } catch (err) {
      toast.error('Could not create it', err instanceof ApiError ? err.message : undefined);
    }
  };

  const toggle = async (offer: BonusOffer) => {
    try {
      await api.patch(`/admin/bonus-offers/${offer.id}`, { enabled: !offer.enabled });
      void load();
    } catch (err) {
      toast.error('Could not update it', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <div>
      <PageHead
        title="Bonus offers"
        subtitle="Deposit-time bonuses a trader chooses from, each with its own turnover requirement before it can be withdrawn."
      />

      <form onSubmit={create} className="card mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="bo-key">
            Key
          </label>
          <input
            id="bo-key"
            required
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })}
            className="field font-mono !text-xs"
            placeholder="welcome-30"
          />
        </div>
        <div>
          <label className="label" htmlFor="bo-name">
            Name
          </label>
          <input
            id="bo-name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="field"
            placeholder="30% welcome bonus"
          />
        </div>
        <div>
          <label className="label" htmlFor="bo-percent">
            Bonus %
          </label>
          <input
            id="bo-percent"
            type="number"
            min={1}
            value={form.percent}
            onChange={(e) => setForm({ ...form, percent: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div className="sm:col-span-3">
          <label className="label" htmlFor="bo-description">
            Description
          </label>
          <input
            id="bo-description"
            required
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="field"
            placeholder="Adds 30% to your deposit, up to $300. Stake it 15 times to release it."
          />
        </div>
        <div>
          <label className="label" htmlFor="bo-max">
            Cap $
          </label>
          <input
            id="bo-max"
            type="number"
            min={1}
            value={form.maxBonus}
            onChange={(e) => setForm({ ...form, maxBonus: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="bo-min">
            Min deposit $
          </label>
          <input
            id="bo-min"
            type="number"
            min={0}
            value={form.minDeposit}
            onChange={(e) => setForm({ ...form, minDeposit: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="bo-turnover">
            Turnover ×
          </label>
          <input
            id="bo-turnover"
            type="number"
            min={0}
            value={form.turnoverMultiplier}
            onChange={(e) => setForm({ ...form, turnoverMultiplier: Number(e.target.value) })}
            className="field"
          />
        </div>
        <div className="flex items-end sm:col-span-3">
          <button type="submit" className="btn-primary">
            Create offer
          </button>
        </div>
      </form>

      {!error && offers === null && <Loading rows={4} cols={4} />}
      {!error && offers !== null && offers.length === 0 && <Empty text="No bonus offers yet." />}
      {!error && offers !== null && offers.length > 0 && (
        <Table head={['Offer', 'Terms', 'Min deposit', 'State']}>
          {offers.map((offer) => (
            <tr key={offer.id} className="transition hover:bg-ink-700/40">
              <Td>
                <button onClick={() => setOpen(offer)} className="text-left hover:text-accent">
                  <span className="block text-sm font-semibold">{offer.name}</span>
                  <span className="block font-mono text-[11px] text-slate-500">{offer.key}</span>
                </button>
              </Td>
              <Td className="text-xs text-slate-300">
                {offer.percent}% up to {money(offer.maxBonusCents)}, {offer.turnoverMultiplier}× turnover
              </Td>
              <Td className="tabular text-xs text-slate-400">{money(offer.minDepositCents)}</Td>
              <Td>
                <button onClick={() => void toggle(offer)} className="inline-flex">
                  <StatusPill status={offer.enabled ? 'active' : 'closed'} />
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && <BonusOfferDrawer offer={open} onClose={() => setOpen(null)} onSaved={load} />}
    </div>
  );
}

function BonusOfferDrawer({
  offer,
  onClose,
  onSaved,
}: {
  offer: BonusOffer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: offer.name,
    description: offer.description,
    percent: String(offer.percent),
    maxBonus: String(offer.maxBonusCents / 100),
    minDeposit: String(offer.minDepositCents / 100),
    turnoverMultiplier: String(offer.turnoverMultiplier),
    sortOrder: String(offer.sortOrder),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/bonus-offers/${offer.id}`, {
        name: form.name,
        description: form.description,
        percent: Number(form.percent),
        maxBonusCents: Math.round(Number(form.maxBonus) * 100),
        minDepositCents: Math.round(Number(form.minDeposit) * 100),
        turnoverMultiplier: Number(form.turnoverMultiplier),
        sortOrder: Number(form.sortOrder),
      });
      toast.success('Saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title={offer.name} onClose={onClose}>
      <div>
        <label className="label" htmlFor="bo-e-name">
          Name
        </label>
        <input id="bo-e-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="bo-e-description">
          Description
        </label>
        <input
          id="bo-e-description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="field"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="bo-e-percent">
            Bonus %
          </label>
          <input
            id="bo-e-percent"
            type="number"
            value={form.percent}
            onChange={(e) => setForm({ ...form, percent: e.target.value })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="bo-e-max">
            Cap $
          </label>
          <input
            id="bo-e-max"
            type="number"
            value={form.maxBonus}
            onChange={(e) => setForm({ ...form, maxBonus: e.target.value })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="bo-e-min">
            Min deposit $
          </label>
          <input
            id="bo-e-min"
            type="number"
            value={form.minDeposit}
            onChange={(e) => setForm({ ...form, minDeposit: e.target.value })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="bo-e-turnover">
            Turnover ×
          </label>
          <input
            id="bo-e-turnover"
            type="number"
            value={form.turnoverMultiplier}
            onChange={(e) => setForm({ ...form, turnoverMultiplier: e.target.value })}
            className="field"
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="bo-e-sort">
          Sort order
        </label>
        <input
          id="bo-e-sort"
          type="number"
          value={form.sortOrder}
          onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
          className="field"
        />
      </div>
      <button onClick={() => void save()} disabled={busy} className="btn-primary w-full">
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </Drawer>
  );
}

/* ---------------------------- marketplace items ---------------------------- */

const ITEM_KINDS = ['PAYOUT_BOOSTER', 'RISK_FREE', 'DEPOSIT_BONUS', 'PRACTICE_REFILL'] as const;
type ItemKind = (typeof ITEM_KINDS)[number];
const KIND_LABELS: Record<ItemKind, string> = {
  PAYOUT_BOOSTER: 'Payout booster',
  RISK_FREE: 'Risk-free',
  DEPOSIT_BONUS: 'Deposit coupon',
  PRACTICE_REFILL: 'Practice refill',
};

interface MarketplaceItem {
  id: string;
  key: string;
  name: string;
  description: string;
  kind: ItemKind;
  priceCents: number;
  pricePoints: number;
  config: Record<string, number>;
  enabled: boolean;
  sortOrder: number;
}

/** Every field a config needs, per kind — the same shape `parseItemConfig` validates server-side. */
const CONFIG_FIELDS: Record<ItemKind, { key: string; label: string }[]> = {
  PAYOUT_BOOSTER: [
    { key: 'bonusPct', label: 'Bonus payout (percentage points)' },
    { key: 'minutes', label: 'Duration (minutes)' },
  ],
  RISK_FREE: [
    { key: 'trades', label: 'Losing trades covered' },
    { key: 'maxRefundCentsUsd', label: 'Max refund per trade $' },
    { key: 'hours', label: 'Time to use it (hours)' },
  ],
  DEPOSIT_BONUS: [
    { key: 'percent', label: 'Bonus %' },
    { key: 'maxBonusCentsUsd', label: 'Cap $' },
    { key: 'days', label: 'Valid for (days)' },
  ],
  PRACTICE_REFILL: [{ key: 'amountCentsUsd', label: 'Amount added $' }],
};

/** Dollar fields in the config carry a `...Usd` suffix in the form only; the wire field drops it and is cents. */
const wireKey = (key: string) => key.replace(/Usd$/, '');
const isDollarField = (key: string) => key.endsWith('Usd');

function defaultConfig(kind: ItemKind): Record<string, number> {
  const defaults: Record<ItemKind, Record<string, number>> = {
    PAYOUT_BOOSTER: { bonusPct: 10, minutes: 30 },
    RISK_FREE: { trades: 1, maxRefundCentsUsd: 50, hours: 24 },
    DEPOSIT_BONUS: { percent: 20, maxBonusCentsUsd: 100, days: 7 },
    PRACTICE_REFILL: { amountCentsUsd: 100 },
  };
  return defaults[kind];
}

function configToForm(kind: ItemKind, config: Record<string, number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of CONFIG_FIELDS[kind]) {
    const wire = wireKey(field.key);
    const raw = config[wire] ?? 0;
    out[field.key] = String(isDollarField(field.key) ? raw / 100 : raw);
  }
  return out;
}

function formToConfig(kind: ItemKind, form: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of CONFIG_FIELDS[kind]) {
    const value = Number(form[field.key] ?? 0);
    out[wireKey(field.key)] = isDollarField(field.key) ? Math.round(value * 100) : value;
  }
  return out;
}

const emptyItemForm = { key: '', name: '', description: '', kind: 'PAYOUT_BOOSTER' as ItemKind, priceCents: 500, pricePoints: 0 };

export function AdminMarketplaceItems() {
  const [items, setItems] = useState<MarketplaceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<MarketplaceItem | null>(null);
  const [form, setForm] = useState(emptyItemForm);
  const [config, setConfig] = useState<Record<string, string>>(configToForm('PAYOUT_BOOSTER', defaultConfig('PAYOUT_BOOSTER')));

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get<{ items: MarketplaceItem[] }>('/admin/marketplace/items');
      setItems(data.items);
      setOpen((current) => (current ? (data.items.find((i) => i.id === current.id) ?? null) : null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load marketplace items');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeKind = (kind: ItemKind) => {
    setForm({ ...form, kind });
    setConfig(configToForm(kind, defaultConfig(kind)));
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/admin/marketplace/items', {
        key: form.key,
        name: form.name,
        description: form.description,
        kind: form.kind,
        priceCents: Math.round(form.priceCents),
        pricePoints: Math.round(form.pricePoints),
        config: formToConfig(form.kind, config),
        enabled: true,
      });
      setForm(emptyItemForm);
      setConfig(configToForm('PAYOUT_BOOSTER', defaultConfig('PAYOUT_BOOSTER')));
      toast.success('Marketplace item created');
      void load();
    } catch (err) {
      toast.error('Could not create it', err instanceof ApiError ? err.message : undefined);
    }
  };

  const toggle = async (item: MarketplaceItem) => {
    try {
      if (item.enabled) await api.del(`/admin/marketplace/items/${item.id}`);
      else await api.patch(`/admin/marketplace/items/${item.id}`, { enabled: true });
      void load();
    } catch (err) {
      toast.error('Could not update it', err instanceof ApiError ? err.message : undefined);
    }
  };

  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <div>
      <PageHead
        title="Marketplace items"
        subtitle="Payout boosters, risk-free trades, deposit coupons and practice refills a trader buys with points or balance."
      />

      <form onSubmit={create} className="card mb-4 grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="mi-key">
            Key
          </label>
          <input
            id="mi-key"
            required
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase() })}
            className="field font-mono !text-xs"
            placeholder="booster-10-30"
          />
        </div>
        <div>
          <label className="label" htmlFor="mi-name">
            Name
          </label>
          <input
            id="mi-name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="mi-kind">
            Kind
          </label>
          <select
            id="mi-kind"
            value={form.kind}
            onChange={(e) => changeKind(e.target.value as ItemKind)}
            className="field"
          >
            {ITEM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label className="label" htmlFor="mi-description">
            Description
          </label>
          <input
            id="mi-description"
            required
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="mi-price-cents">
            Price $ (0 = not sold for cash)
          </label>
          <input
            id="mi-price-cents"
            type="number"
            min={0}
            value={form.priceCents / 100}
            onChange={(e) => setForm({ ...form, priceCents: Number(e.target.value) * 100 })}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="mi-price-points">
            Price (points, 0 = not sold for points)
          </label>
          <input
            id="mi-price-points"
            type="number"
            min={0}
            value={form.pricePoints}
            onChange={(e) => setForm({ ...form, pricePoints: Number(e.target.value) })}
            className="field"
          />
        </div>
        {CONFIG_FIELDS[form.kind].map((field) => (
          <div key={field.key}>
            <label className="label" htmlFor={`mi-cfg-${field.key}`}>
              {field.label}
            </label>
            <input
              id={`mi-cfg-${field.key}`}
              type="number"
              value={config[field.key] ?? ''}
              onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
              className="field"
            />
          </div>
        ))}
        <div className="flex items-end sm:col-span-3">
          <button type="submit" className="btn-primary">
            Create item
          </button>
        </div>
      </form>

      {!error && items === null && <Loading rows={4} cols={4} />}
      {!error && items !== null && items.length === 0 && <Empty text="No marketplace items yet." />}
      {!error && items !== null && items.length > 0 && (
        <Table head={['Item', 'Kind', 'Price', 'State']}>
          {items.map((item) => (
            <tr key={item.id} className="transition hover:bg-ink-700/40">
              <Td>
                <button onClick={() => setOpen(item)} className="text-left hover:text-accent">
                  <span className="block text-sm font-semibold">{item.name}</span>
                  <span className="block font-mono text-[11px] text-slate-500">{item.key}</span>
                </button>
              </Td>
              <Td className="text-xs text-slate-400">{KIND_LABELS[item.kind]}</Td>
              <Td className="tabular text-xs text-slate-300">
                {item.priceCents > 0 && money(item.priceCents)}
                {item.priceCents > 0 && item.pricePoints > 0 && ' / '}
                {item.pricePoints > 0 && `${item.pricePoints} pts`}
              </Td>
              <Td>
                <button onClick={() => void toggle(item)} className="inline-flex">
                  <StatusPill status={item.enabled ? 'active' : 'closed'} />
                </button>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {open && <MarketplaceItemDrawer item={open} onClose={() => setOpen(null)} onSaved={load} />}
    </div>
  );
}

function MarketplaceItemDrawer({
  item,
  onClose,
  onSaved,
}: {
  item: MarketplaceItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);
  const [priceCents, setPriceCents] = useState(item.priceCents / 100);
  const [pricePoints, setPricePoints] = useState(item.pricePoints);
  const [config, setConfig] = useState(configToForm(item.kind, item.config));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`/admin/marketplace/items/${item.id}`, {
        name,
        description,
        priceCents: Math.round(priceCents * 100),
        pricePoints: Math.round(pricePoints),
        config: formToConfig(item.kind, config),
      });
      toast.success('Saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Could not save', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title={item.name} onClose={onClose}>
      <p className="text-[11px] text-slate-500">
        {KIND_LABELS[item.kind]} — the kind is fixed once created; make a new item for a different kind.
      </p>
      <div>
        <label className="label" htmlFor="mi-e-name">
          Name
        </label>
        <input id="mi-e-name" value={name} onChange={(e) => setName(e.target.value)} className="field" />
      </div>
      <div>
        <label className="label" htmlFor="mi-e-description">
          Description
        </label>
        <input
          id="mi-e-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="field"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="mi-e-price-cents">
            Price $
          </label>
          <input
            id="mi-e-price-cents"
            type="number"
            value={priceCents}
            onChange={(e) => setPriceCents(Number(e.target.value))}
            className="field"
          />
        </div>
        <div>
          <label className="label" htmlFor="mi-e-price-points">
            Price (points)
          </label>
          <input
            id="mi-e-price-points"
            type="number"
            value={pricePoints}
            onChange={(e) => setPricePoints(Number(e.target.value))}
            className="field"
          />
        </div>
      </div>
      {CONFIG_FIELDS[item.kind].map((field) => (
        <div key={field.key}>
          <label className="label" htmlFor={`mi-e-cfg-${field.key}`}>
            {field.label}
          </label>
          <input
            id={`mi-e-cfg-${field.key}`}
            type="number"
            value={config[field.key] ?? ''}
            onChange={(e) => setConfig({ ...config, [field.key]: e.target.value })}
            className="field"
          />
        </div>
      ))}
      <button onClick={() => void save()} disabled={busy} className="btn-primary w-full">
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </Drawer>
  );
}

/* --------------------------------- shared ---------------------------------- */

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex">
      <button aria-label="Close" onClick={onClose} className="flex-1 bg-black/60" />
      <aside
        role="dialog"
        aria-label={title}
        className="flex w-full max-w-lg flex-col gap-3 overflow-y-auto border-l border-ink-600 bg-ink-800 p-4"
      >
        <header className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold">{title}</p>
          <button onClick={onClose} className="btn-ghost !py-1.5">
            Close ✕
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card p-6 text-center">
      <p className="text-sm text-slate-300">{message}</p>
      <button onClick={onRetry} className="btn-primary mt-4">
        Try again
      </button>
    </div>
  );
}
