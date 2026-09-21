import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { money } from '../../lib/format';

const COLORS = { up: '#12b886', down: '#f0455e', accent: '#3d7bff', grid: '#1c2436', axis: '#64748b' };

export interface DailyPoint {
  date: string;
  depositVolume: number;
  withdrawalVolume: number;
  housePnl: number;
}

export interface ChartsData {
  days: number;
  series: DailyPoint[];
  funnel: { registrations: number; firstTimeDepositors: number };
  volumeByAssetClass: { assetClass: string; volume: number }[];
  topAssets: { symbol: string; pair: string; volume: number }[];
  exposure: { symbol: string; up: number; down: number }[];
  hourlyActivity: number[][];
}

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );

/** A card wrapping one chart, with its own empty state so one dead chart never blanks the rest. */
function ChartCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    // min-w-0 stops the grid track from expanding to a chart's SVG intrinsic
    // width — without it, ResponsiveContainer's own shrink-to-fit fights a
    // grid item's default content-based sizing and the column blows out.
    <div className="card min-w-0 p-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      {empty ? (
        <div className="flex h-56 items-center justify-center text-xs text-slate-500">
          No data in this window yet
        </div>
      ) : (
        children
      )}
    </div>
  );
}

const tooltipStyle = {
  background: '#151c2c',
  border: '1px solid #273149',
  borderRadius: 8,
  fontSize: 11,
};

export function AdminCharts({ data }: { data: ChartsData }) {
  const hasSeries = data.series.some((p) => p.depositVolume || p.withdrawalVolume || p.housePnl);
  const hasVolume = data.volumeByAssetClass.length > 0;
  const hasTopAssets = data.topAssets.length > 0;
  const hasExposure = data.exposure.length > 0;
  const maxHourly = Math.max(1, ...data.hourlyActivity.flat());

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title={`Deposits vs withdrawals · last ${data.days} days`} empty={!hasSeries}>
        <ResponsiveContainer width="100%" height={224}>
          <LineChart data={data.series}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              stroke={COLORS.axis}
              fontSize={10}
              minTickGap={20}
            />
            <YAxis stroke={COLORS.axis} fontSize={10} tickFormatter={(v) => money(v)} width={64} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => shortDate(String(v))}
              formatter={(v) => money(Number(v))}
            />
            <Line type="monotone" dataKey="depositVolume" name="Deposits" stroke={COLORS.up} dot={false} />
            <Line
              type="monotone"
              dataKey="withdrawalVolume"
              name="Withdrawals"
              stroke={COLORS.down}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`House P&L · last ${data.days} days`} empty={!hasSeries}>
        <ResponsiveContainer width="100%" height={224}>
          <LineChart data={data.series}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              stroke={COLORS.axis}
              fontSize={10}
              minTickGap={20}
            />
            <YAxis stroke={COLORS.axis} fontSize={10} tickFormatter={(v) => money(v, { sign: true })} width={64} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => shortDate(String(v))}
              formatter={(v) => money(Number(v), { sign: true })}
            />
            <Line type="monotone" dataKey="housePnl" name="House P&L" stroke={COLORS.accent} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Registrations → first deposit · last ${data.days} days`}>
        <ResponsiveContainer width="100%" height={224}>
          <BarChart
            layout="vertical"
            data={[
              { stage: 'Registered', value: data.funnel.registrations },
              { stage: 'First deposit', value: data.funnel.firstTimeDepositors },
            ]}
            margin={{ left: 24 }}
          >
            <CartesianGrid stroke={COLORS.grid} horizontal={false} />
            <XAxis type="number" stroke={COLORS.axis} fontSize={10} />
            <YAxis type="category" dataKey="stage" stroke={COLORS.axis} fontSize={11} width={110} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" fill={COLORS.accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 text-center text-[11px] text-slate-500">
          {data.funnel.registrations === 0
            ? 'No registrations in this window'
            : `${Math.round((data.funnel.firstTimeDepositors / data.funnel.registrations) * 100)}% converted to a first deposit`}
        </p>
      </ChartCard>

      <ChartCard title={`Volume by asset class · last ${data.days} days`} empty={!hasVolume}>
        <ResponsiveContainer width="100%" height={224}>
          <BarChart data={data.volumeByAssetClass}>
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="assetClass" stroke={COLORS.axis} fontSize={10} />
            <YAxis stroke={COLORS.axis} fontSize={10} tickFormatter={(v) => money(v)} width={64} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
            <Bar dataKey="volume" fill={COLORS.accent} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title={`Top 10 assets by volume · last ${data.days} days`} empty={!hasTopAssets}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart layout="vertical" data={data.topAssets} margin={{ left: 12 }}>
            <CartesianGrid stroke={COLORS.grid} horizontal={false} />
            <XAxis type="number" stroke={COLORS.axis} fontSize={10} tickFormatter={(v) => money(v)} />
            <YAxis type="category" dataKey="symbol" stroke={COLORS.axis} fontSize={10} width={100} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
            <Bar dataKey="volume" fill={COLORS.accent} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Live exposure per market" empty={!hasExposure}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart layout="vertical" data={data.exposure} margin={{ left: 12 }}>
            <CartesianGrid stroke={COLORS.grid} horizontal={false} />
            <XAxis type="number" stroke={COLORS.axis} fontSize={10} tickFormatter={(v) => money(v)} />
            <YAxis type="category" dataKey="symbol" stroke={COLORS.axis} fontSize={10} width={100} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => money(Number(v))} />
            <Bar dataKey="up" name="Up" stackId="a" fill={COLORS.up} />
            <Bar dataKey="down" name="Down" stackId="a" fill={COLORS.down} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="card min-w-0 p-4 lg:col-span-2">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Hourly activity · last {data.days} days, UTC
        </p>
        <HourlyHeatmap grid={data.hourlyActivity} max={maxHourly} />
      </div>
    </div>
  );
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function HourlyHeatmap({ grid, max }: { grid: number[][]; max: number }) {
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid min-w-[640px] grid-cols-[2.5rem_repeat(24,1fr)] gap-[3px]">
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center text-[9px] text-slate-500">
            {h}
          </div>
        ))}
        {grid.map((row, day) => (
          <div key={day} className="contents">
            <div className="flex items-center text-[10px] text-slate-500">{WEEKDAYS[day]}</div>
            {row.map((count, hour) => (
              <div
                key={hour}
                title={`${WEEKDAYS[day]} ${hour}:00 UTC — ${count} trade${count === 1 ? '' : 's'}`}
                className="aspect-square rounded-sm"
                style={{
                  backgroundColor: count === 0 ? '#1c2436' : COLORS.accent,
                  opacity: count === 0 ? 1 : 0.25 + 0.75 * (count / max),
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
