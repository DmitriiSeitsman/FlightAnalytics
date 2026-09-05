import type { ReactNode } from "react";
import { formatMetric, type FlightMetricKey, type HistogramBin, type StatisticRow } from "./flight-data";

const NAVY = "#183964";
const RED = "#d52238";
const GRID = "#d7e0e6";
const INK = "#14243a";
const MUTED = "#74818a";

export type ComparisonBar = {
  id: string;
  label: string;
  subtitle: string;
  flights: number;
  value: number | null;
  min: number | null;
  max: number | null;
  selected: boolean;
};

export function toComparisonBars(rows: StatisticRow[], metric: FlightMetricKey, selectedId: string): ComparisonBar[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    subtitle: row.subtitle,
    flights: row.flights,
    value: row.metrics[metric],
    min: row.minMetrics[metric],
    max: row.maxMetrics[metric],
    selected: row.id === selectedId,
  }));
}

export function windowedBars(bars: ComparisonBar[], limit = 16) {
  const ranked = [...bars].filter((bar) => bar.value !== null).sort((left, right) => (left.value ?? 0) - (right.value ?? 0));
  if (ranked.length <= limit) return ranked;
  const selectedIndex = Math.max(0, ranked.findIndex((bar) => bar.selected));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(limit / 2), ranked.length - limit));
  return ranked.slice(start, start + limit);
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char] ?? char));
const ticks = (min: number, max: number, count = 4) => {
  if (min === max) return [min];
  return Array.from({ length: count }, (_, index) => min + ((max - min) * index) / (count - 1));
};

export function comparisonHistogramSvg(bars: ComparisonBar[], metric: FlightMetricKey, width = 860, height = 320) {
  const values = bars.map((bar) => bar.value).filter((value): value is number => value !== null);
  if (!bars.length || !values.length) return "";
  const pad = { top: 22, right: 16, bottom: 118, left: 58 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue;
  const padding = span === 0 ? Math.abs(maxValue) * 0.08 || 1 : span * 0.16;
  const yMin = minValue - padding;
  const yMax = maxValue + padding;
  const y = (value: number) => pad.top + innerHeight - ((value - yMin) / (yMax - yMin)) * innerHeight;
  const slot = innerWidth / bars.length;
  const barWidth = Math.max(10, Math.min(36, slot * 0.62));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const meanY = y(mean);
  const grid = ticks(yMin, yMax).map((tick) => {
    const tickY = y(tick);
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${tickY}" y2="${tickY}" stroke="${GRID}" stroke-width="1"/>
      <text x="${pad.left - 8}" y="${tickY + 3}" text-anchor="end" fill="${MUTED}" font-size="9" font-family="Arial,Helvetica,sans-serif">${escapeXml(formatMetric(tick, metric))}</text>`;
  }).join("");
  const columns = bars.map((bar, index) => {
    if (bar.value === null) return "";
    const x = pad.left + slot * index + (slot - barWidth) / 2;
    const top = y(bar.value);
    const h = Math.max(2, y(yMin) - top);
    const color = bar.selected ? RED : NAVY;
    const label = bar.label.length > 18 ? `${bar.label.slice(0, 17)}…` : bar.label;
    return `<g>
      <rect x="${x}" y="${top}" width="${barWidth}" height="${h}" rx="7" fill="${color}" opacity="${bar.selected ? 1 : 0.78}"/>
      <text x="${x + barWidth / 2}" y="${pad.top + innerHeight + 16}" text-anchor="middle" fill="${bar.selected ? RED : INK}" font-size="11" font-weight="${bar.selected ? 800 : 700}" font-family="Arial,Helvetica,sans-serif">${escapeXml(label)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">
    <rect width="${width}" height="${height}" fill="#fff"/>
    ${grid}
    <line x1="${pad.left}" x2="${width - pad.right}" y1="${meanY}" y2="${meanY}" stroke="${RED}" stroke-dasharray="5 4" stroke-width="1.4"/>
    ${columns}
  </svg>`;
}

export function distributionHistogramSvg(bins: HistogramBin[], metric: FlightMetricKey, width = 860, height = 280) {
  if (!bins.length) return "";
  const pad = { top: 18, right: 16, bottom: 88, left: 48 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const maxCount = Math.max(1, ...bins.map((bin) => bin.selected + bin.others), ...bins.map((bin) => Math.max(bin.selected, bin.others)));
  const slot = innerWidth / bins.length;
  const groupWidth = Math.max(12, Math.min(46, slot * 0.7));
  const barWidth = groupWidth / 2 - 1;
  const grid = ticks(0, maxCount).map((tick) => {
    const tickY = pad.top + innerHeight - (tick / maxCount) * innerHeight;
    return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${tickY}" y2="${tickY}" stroke="${GRID}" stroke-width="1"/>
      <text x="${pad.left - 8}" y="${tickY + 3}" text-anchor="end" fill="${MUTED}" font-size="9" font-family="Arial,Helvetica,sans-serif">${Math.round(tick)}</text>`;
  }).join("");
  const columns = bins.map((bin, index) => {
    const x = pad.left + slot * index + (slot - groupWidth) / 2;
    const othersH = (bin.others / maxCount) * innerHeight;
    const selectedH = (bin.selected / maxCount) * innerHeight;
    const from = formatMetric(bin.from, metric);
    const to = formatMetric(bin.to, metric);
    return `<g>
      <rect x="${x}" y="${pad.top + innerHeight - othersH}" width="${barWidth}" height="${othersH}" rx="4" fill="${NAVY}" opacity="0.72"/>
      <rect x="${x + barWidth + 2}" y="${pad.top + innerHeight - selectedH}" width="${barWidth}" height="${selectedH}" rx="4" fill="${RED}"/>
      <text x="${x + groupWidth / 2}" y="${pad.top + innerHeight + 16}" text-anchor="middle" fill="${INK}" font-size="10" font-weight="700" font-family="Arial,Helvetica,sans-serif">${escapeXml(from)}</text>
      <text x="${x + groupWidth / 2}" y="${pad.top + innerHeight + 30}" text-anchor="middle" fill="${MUTED}" font-size="9" font-family="Arial,Helvetica,sans-serif">– ${escapeXml(to)}</text>
    </g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img">
    <rect width="${width}" height="${height}" fill="#fff"/>
    ${grid}
    ${columns}
  </svg>`;
}

function ChartFrame({
  width,
  height,
  pad,
  label,
  axis,
  children,
}: {
  width: number;
  height: number;
  pad: { top: number; right: number; bottom: number; left: number };
  label: string;
  axis: Array<{ key: string; title: string; detail?: string; selected?: boolean; onClick?: () => void }>;
  children: ReactNode;
}) {
  return (
    <div className="chart-scroll">
      <div className="chart-plot" style={{ minWidth: Math.max(width, 520) }}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
          {children}
        </svg>
        <div
          className="chart-axis"
          style={{
            paddingLeft: `${(pad.left / width) * 100}%`,
            paddingRight: `${(pad.right / width) * 100}%`,
            gridTemplateColumns: `repeat(${Math.max(1, axis.length)}, minmax(0, 1fr))`,
          }}
        >
          {axis.map((item) => (
            <button
              type="button"
              className={`chart-axis-label${item.selected ? " is-selected" : ""}${item.onClick ? "" : " static"}`}
              key={item.key}
              onClick={item.onClick}
              disabled={!item.onClick}
              title={item.detail ? `${item.title} · ${item.detail}` : item.title}
            >
              <strong>{item.title}</strong>
              {item.detail && <small>{item.detail}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ComparisonHistogram({ bars, metric, onSelect }: { bars: ComparisonBar[]; metric: FlightMetricKey; onSelect: (id: string) => void }) {
  const shown = windowedBars(bars);
  const values = shown.map((bar) => bar.value).filter((value): value is number => value !== null);
  if (!shown.length || !values.length) return <p className="note">Недостаточно значений для гистограммы.</p>;
  const width = Math.max(720, shown.length * 92);
  const height = 220;
  const pad = { top: 18, right: 18, bottom: 12, left: 58 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const span = maxValue - minValue;
  const padding = span === 0 ? Math.abs(maxValue) * 0.08 || 1 : span * 0.16;
  const yMin = minValue - padding;
  const yMax = maxValue + padding;
  const y = (value: number) => pad.top + innerHeight - ((value - yMin) / (yMax - yMin)) * innerHeight;
  const slot = innerWidth / shown.length;
  const barWidth = Math.max(16, Math.min(42, slot * 0.58));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return (
    <ChartFrame
      width={width}
      height={height}
      pad={pad}
      label="Сравнение средних значений"
      axis={shown.map((bar) => ({
        key: bar.id,
        title: bar.label,
        detail: bar.subtitle || `${bar.flights} рейс.`,
        selected: bar.selected,
        onClick: () => onSelect(bar.id),
      }))}
    >
      {ticks(yMin, yMax).map((tick) => {
        const tickY = y(tick);
        return <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={tickY} y2={tickY} stroke={GRID} />
          <text x={pad.left - 8} y={tickY + 3} textAnchor="end" fill={MUTED} fontSize="10">{formatMetric(tick, metric)}</text>
        </g>;
      })}
      <line x1={pad.left} x2={width - pad.right} y1={y(mean)} y2={y(mean)} stroke={RED} strokeDasharray="5 4" />
      {shown.map((bar, index) => {
        if (bar.value === null) return null;
        const x = pad.left + slot * index + (slot - barWidth) / 2;
        const top = y(bar.value);
        const h = Math.max(2, y(yMin) - top);
        return <g key={bar.id} className="chart-bar" onClick={() => onSelect(bar.id)} style={{ cursor: "pointer" }}>
          <title>{`${bar.label}${bar.subtitle ? `, ${bar.subtitle}` : ""}: ${formatMetric(bar.value, metric, true)}, рейсов ${bar.flights}`}</title>
          <rect x={x} y={top} width={barWidth} height={h} rx="7" fill={bar.selected ? RED : NAVY} opacity={bar.selected ? 1 : 0.78} />
        </g>;
      })}
    </ChartFrame>
  );
}

export function DistributionHistogram({ bins, metric }: { bins: HistogramBin[]; metric: FlightMetricKey }) {
  if (!bins.length) return <p className="note">Недостаточно значений для распределения.</p>;
  const width = Math.max(720, bins.length * 108);
  const height = 200;
  const pad = { top: 16, right: 18, bottom: 8, left: 48 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const maxCount = Math.max(1, ...bins.map((bin) => Math.max(bin.selected, bin.others)));
  const slot = innerWidth / bins.length;
  const groupWidth = Math.max(18, Math.min(52, slot * 0.7));
  const barWidth = groupWidth / 2 - 1;
  return (
    <ChartFrame
      width={width}
      height={height}
      pad={pad}
      label="Распределение значений"
      axis={bins.map((bin) => ({
        key: `${bin.from}-${bin.to}`,
        title: formatMetric(bin.from, metric),
        detail: `– ${formatMetric(bin.to, metric)}`,
      }))}
    >
      {ticks(0, maxCount).map((tick) => {
        const tickY = pad.top + innerHeight - (tick / maxCount) * innerHeight;
        return <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={tickY} y2={tickY} stroke={GRID} />
          <text x={pad.left - 8} y={tickY + 3} textAnchor="end" fill={MUTED} fontSize="10">{Math.round(tick)}</text>
        </g>;
      })}
      {bins.map((bin, index) => {
        const x = pad.left + slot * index + (slot - groupWidth) / 2;
        const othersH = (bin.others / maxCount) * innerHeight;
        const selectedH = (bin.selected / maxCount) * innerHeight;
        return <g key={`${bin.from}-${bin.to}`}>
          <title>{`${formatMetric(bin.from, metric)}–${formatMetric(bin.to, metric)}: выбранный ${bin.selected}, остальные ${bin.others}`}</title>
          <rect x={x} y={pad.top + innerHeight - othersH} width={barWidth} height={othersH} rx="4" fill={NAVY} opacity="0.72" />
          <rect x={x + barWidth + 2} y={pad.top + innerHeight - selectedH} width={barWidth} height={selectedH} rx="4" fill={RED} />
        </g>;
      })}
    </ChartFrame>
  );
}
