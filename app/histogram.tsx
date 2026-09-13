import type { ReactNode } from "react";
import { formatMetric, type FlightMetricKey, type HistogramBin, type MultiHistogramBin, type StatisticRow } from "./flight-data";

const NAVY = "#183964";
const RED = "#d52238";
const GRID = "#d7e0e6";
const INK = "#14243a";
const MUTED = "#74818a";

export const SERIES_COLORS = [RED, NAVY, "#19805b", "#7c3aed", "#d97706"] as const;

export type ChartSeries = {
  id: string;
  label: string;
  subtitle: string;
  color: string;
  primary: boolean;
};

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

const rangeDomain = (rows: StatisticRow[], metric: FlightMetricKey) => {
  const values = rows.flatMap((row) => [row.minMetrics[metric], row.maxMetrics[metric], row.metrics[metric], row.baselineMetrics[metric]])
    .filter((value): value is number => value !== null);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const padding = span === 0 ? Math.abs(max) * 0.08 || 1 : span * 0.1;
  return { min: min - padding, max: max + padding };
};

const compactLabel = (value: string, limit = 24) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;

export function ComparisonRangeChart({
  rows,
  metric,
  series,
  baselineLabel,
}: {
  rows: StatisticRow[];
  metric: FlightMetricKey;
  series: ChartSeries[];
  baselineLabel: string;
}) {
  const domain = rangeDomain(rows, metric);
  if (!rows.length || !domain) return <p className="note">Недостаточно значений для сравнения.</p>;
  const width = 920;
  const rowHeight = 68;
  const pad = { top: 34, right: 118, bottom: 42, left: 238 };
  const height = pad.top + pad.bottom + rows.length * rowHeight;
  const innerWidth = width - pad.left - pad.right;
  const x = (value: number) => pad.left + ((value - domain.min) / (domain.max - domain.min)) * innerWidth;

  return <div className="chart-scroll range-chart-scroll">
    <div className="chart-plot" style={{ minWidth: width }}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Среднее и диапазон значений по выбранным объектам">
        {ticks(domain.min, domain.max, 5).map((tick) => <g key={tick}>
          <line x1={x(tick)} x2={x(tick)} y1={pad.top - 8} y2={height - pad.bottom} stroke={GRID} />
          <text x={x(tick)} y={height - 14} textAnchor="middle" fill={MUTED} fontSize="10">{formatMetric(tick, metric)}</text>
        </g>)}
        {rows.map((row, index) => {
          const meta = series.find((item) => item.id === row.id);
          const mean = row.metrics[metric];
          const min = row.minMetrics[metric];
          const max = row.maxMetrics[metric];
          const baseline = row.baselineMetrics[metric];
          const y = pad.top + index * rowHeight + rowHeight / 2;
          const color = meta?.color ?? NAVY;
          return <g key={row.id}>
            {index > 0 && <line x1="12" x2={width - 12} y1={y - rowHeight / 2} y2={y - rowHeight / 2} stroke="#edf0f2" />}
            <text x={pad.left - 16} y={y - 5} textAnchor="end" fill={INK} fontSize="12" fontWeight={meta?.primary ? 800 : 700}>{compactLabel(row.label)}</text>
            <text x={pad.left - 16} y={y + 11} textAnchor="end" fill={MUTED} fontSize="9">{compactLabel(row.subtitle || `${row.flights} рейсов`, 34)}</text>
            {min !== null && max !== null && <>
              <line x1={x(min)} x2={x(max)} y1={y} y2={y} stroke={color} strokeWidth="5" strokeLinecap="round" opacity=".3" />
              <circle cx={x(min)} cy={y} r="3" fill={color} opacity=".65" />
              <circle cx={x(max)} cy={y} r="3" fill={color} opacity=".65" />
            </>}
            {baseline !== null && <path d={`M ${x(baseline)} ${y - 7} L ${x(baseline) + 7} ${y} L ${x(baseline)} ${y + 7} L ${x(baseline) - 7} ${y} Z`} fill="white" stroke={color} strokeWidth="2" />}
            {mean !== null && <circle cx={x(mean)} cy={y} r="7" fill={color} stroke="white" strokeWidth="2"><title>{`${row.label}: среднее ${formatMetric(mean, metric, true)}, ${baselineLabel.toLocaleLowerCase("ru-RU")} ${formatMetric(baseline, metric, true)}`}</title></circle>}
            <text x={width - pad.right + 16} y={y - 4} fill={color} fontSize="12" fontWeight="800">{formatMetric(mean, metric, true)}</text>
            <text x={width - pad.right + 16} y={y + 12} fill={MUTED} fontSize="9">{row.flights.toLocaleString("ru-RU")} рейс.</text>
          </g>;
        })}
      </svg>
    </div>
  </div>;
}

export function NormalizedDistributionHistogram({
  bins,
  metric,
  series,
}: {
  bins: MultiHistogramBin[];
  metric: FlightMetricKey;
  series: ChartSeries[];
}) {
  if (!bins.length || !series.length) return <p className="note">Недостаточно значений для распределения.</p>;
  const totals = Object.fromEntries(series.map((item) => [item.id, bins.reduce((sum, bin) => sum + (bin.counts[item.id] ?? 0), 0)]));
  const percentages = bins.flatMap((bin) => series.map((item) => totals[item.id] ? ((bin.counts[item.id] ?? 0) / totals[item.id]) * 100 : 0));
  const maxPercent = Math.max(10, ...percentages);
  const yMax = Math.ceil(maxPercent / 10) * 10;
  const width = Math.max(760, bins.length * 112);
  const height = 238;
  const pad = { top: 18, right: 18, bottom: 10, left: 52 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const slot = innerWidth / bins.length;
  const groupWidth = Math.min(76, slot * 0.76);
  const barWidth = Math.max(4, groupWidth / series.length - 2);

  return <ChartFrame
    width={width}
    height={height}
    pad={pad}
    label="Распределение значений выбранных объектов в процентах"
    axis={bins.map((bin) => ({ key: `${bin.from}-${bin.to}`, title: formatMetric(bin.from, metric), detail: `– ${formatMetric(bin.to, metric)}` }))}
  >
    {ticks(0, yMax, 5).map((tick) => {
      const tickY = pad.top + innerHeight - (tick / yMax) * innerHeight;
      return <g key={tick}>
        <line x1={pad.left} x2={width - pad.right} y1={tickY} y2={tickY} stroke={GRID} />
        <text x={pad.left - 8} y={tickY + 3} textAnchor="end" fill={MUTED} fontSize="10">{Math.round(tick)}%</text>
      </g>;
    })}
    {bins.map((bin, binIndex) => {
      const startX = pad.left + slot * binIndex + (slot - groupWidth) / 2;
      return <g key={`${bin.from}-${bin.to}`}>
        {series.map((item, seriesIndex) => {
          const count = bin.counts[item.id] ?? 0;
          const percent = totals[item.id] ? (count / totals[item.id]) * 100 : 0;
          const barHeight = (percent / yMax) * innerHeight;
          return <rect
            key={item.id}
            x={startX + seriesIndex * (barWidth + 2)}
            y={pad.top + innerHeight - barHeight}
            width={barWidth}
            height={barHeight}
            rx="3"
            fill={item.color}
            opacity={item.primary ? 1 : .82}
          ><title>{`${item.label}: ${count} рейс. (${percent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%) в диапазоне ${formatMetric(bin.from, metric)}–${formatMetric(bin.to, metric)}`}</title></rect>;
        })}
      </g>;
    })}
  </ChartFrame>;
}

export function comparisonRangeSvg(rows: StatisticRow[], metric: FlightMetricKey, series: ChartSeries[], baselineLabel: string, width = 860) {
  const domain = rangeDomain(rows, metric);
  if (!rows.length || !domain) return "";
  const rowHeight = 44;
  const pad = { top: 26, right: 96, bottom: 34, left: 190 };
  const height = pad.top + pad.bottom + rows.length * rowHeight;
  const innerWidth = width - pad.left - pad.right;
  const x = (value: number) => pad.left + ((value - domain.min) / (domain.max - domain.min)) * innerWidth;
  const grid = ticks(domain.min, domain.max, 5).map((tick) => `<line x1="${x(tick)}" x2="${x(tick)}" y1="${pad.top}" y2="${height - pad.bottom}" stroke="${GRID}"/><text x="${x(tick)}" y="${height - 10}" text-anchor="middle" fill="${MUTED}" font-size="9">${escapeXml(formatMetric(tick, metric))}</text>`).join("");
  const marks = rows.map((row, index) => {
    const meta = series.find((item) => item.id === row.id);
    const color = meta?.color ?? NAVY;
    const y = pad.top + index * rowHeight + rowHeight / 2;
    const min = row.minMetrics[metric];
    const max = row.maxMetrics[metric];
    const mean = row.metrics[metric];
    const baseline = row.baselineMetrics[metric];
    return `<text x="${pad.left - 12}" y="${y + 4}" text-anchor="end" fill="${INK}" font-size="10" font-weight="700">${escapeXml(compactLabel(row.label, 26))}</text>
      ${min !== null && max !== null ? `<line x1="${x(min)}" x2="${x(max)}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity=".3"/>` : ""}
      ${baseline !== null ? `<path d="M ${x(baseline)} ${y - 6} L ${x(baseline) + 6} ${y} L ${x(baseline)} ${y + 6} L ${x(baseline) - 6} ${y} Z" fill="white" stroke="${color}" stroke-width="2"/>` : ""}
      ${mean !== null ? `<circle cx="${x(mean)}" cy="${y}" r="6" fill="${color}" stroke="white" stroke-width="2"/><text x="${width - pad.right + 12}" y="${y + 4}" fill="${color}" font-size="10" font-weight="700">${escapeXml(formatMetric(mean, metric, true))}</text>` : ""}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Среднее, диапазон и ${escapeXml(baselineLabel.toLocaleLowerCase("ru-RU"))}"><rect width="${width}" height="${height}" fill="#fff"/>${grid}${marks}</svg>`;
}

export type PilotRadarAxis = {
  key: FlightMetricKey;
  label: string;
  unit: string;
  digits: number;
  pilotMin: number | null;
  pilotMax: number | null;
  pilotAvg: number | null;
  typeAvg: number | null;
};

const RADAR_R = 118;
const RADAR_CENTER = { x: 250, y: 198 };
const RADAR_SIZE = { width: 500, height: 470 };
const RADAR_OVERFLOW_CAP = 1.1;
const RADAR_LABEL_R = RADAR_R * 1.24;
const RADAR_UNDERFLOW_R = RADAR_R * 0.09;
const RADAR_RINGS = [0.25, 0.5, 0.75, 1];

const radarPolar = (angle: number, r: number) => ({
  x: RADAR_CENTER.x + r * Math.cos(angle),
  y: RADAR_CENTER.y + r * Math.sin(angle),
});
const radarLabelAnchor = (angle: number): "start" | "middle" | "end" => {
  const cos = Math.cos(angle);
  if (cos > 0.25) return "start";
  if (cos < -0.25) return "end";
  return "middle";
};
const radarLabelDy = (angle: number) => {
  const sin = Math.sin(angle);
  if (sin < -0.35) return -6;
  if (sin > 0.35) return 15;
  return 4;
};

export function PilotRadarChart({
  axes,
  selectedMetric,
  pilotLabel,
  baselineLabel,
}: {
  axes: PilotRadarAxis[];
  selectedMetric: FlightMetricKey;
  pilotLabel: string;
  baselineLabel: string;
}) {
  const n = axes.length;
  if (n < 3) return <p className="note">Недостаточно показателей для диаграммы.</p>;
  const angleStep = (Math.PI * 2) / n;
  const angleAt = (index: number) => -Math.PI / 2 + index * angleStep;

  const pilotPoints: Array<{ x: number; y: number; axis: PilotRadarAxis }> = [];
  const typePoints: Array<{ x: number; y: number; axis: PilotRadarAxis; overflow: "high" | "low" | null }> = [];

  axes.forEach((axis, index) => {
    if (axis.pilotMin === null || axis.pilotMax === null || axis.pilotAvg === null) return;
    const angle = angleAt(index);
    const span = axis.pilotMax - axis.pilotMin;
    const pilotT = span === 0 ? 0.5 : (axis.pilotAvg - axis.pilotMin) / span;
    const pilotPoint = radarPolar(angle, RADAR_R * pilotT);
    pilotPoints.push({ x: pilotPoint.x, y: pilotPoint.y, axis });

    if (axis.typeAvg === null) return;
    let overflow: "high" | "low" | null = null;
    let typeR: number;
    if (span === 0) {
      if (axis.typeAvg === axis.pilotMin) typeR = RADAR_R * 0.5;
      else if (axis.typeAvg > axis.pilotMin) { overflow = "high"; typeR = RADAR_R * RADAR_OVERFLOW_CAP; }
      else { overflow = "low"; typeR = RADAR_UNDERFLOW_R; }
    } else {
      const rawR = RADAR_R * ((axis.typeAvg - axis.pilotMin) / span);
      if (rawR > RADAR_R) { overflow = "high"; typeR = Math.min(rawR, RADAR_R * RADAR_OVERFLOW_CAP); }
      else if (rawR < 0) { overflow = "low"; typeR = RADAR_UNDERFLOW_R; }
      else typeR = rawR;
    }
    const typePoint = radarPolar(angle, typeR);
    typePoints.push({ x: typePoint.x, y: typePoint.y, axis, overflow });
  });

  const pilotPath = pilotPoints.length > 2 ? `M ${pilotPoints.map((p) => `${p.x} ${p.y}`).join(" L ")} Z` : "";
  const typePath = typePoints.length > 2 ? `M ${typePoints.map((p) => `${p.x} ${p.y}`).join(" L ")} Z` : "";

  return (
    <div className="chart-scroll">
      <div className="chart-plot" style={{ minWidth: Math.max(RADAR_SIZE.width, 420) }}>
        <svg
          viewBox={`0 0 ${RADAR_SIZE.width} ${RADAR_SIZE.height}`}
          role="img"
          aria-label={`Личная статистика ${pilotLabel} по всем показателям в сравнении со средним по типу ВС`}
          preserveAspectRatio="xMidYMid meet"
        >
          {RADAR_RINGS.map((ring) => (
            <circle key={ring} cx={RADAR_CENTER.x} cy={RADAR_CENTER.y} r={RADAR_R * ring} fill="none" stroke={GRID} strokeWidth={ring === 1 ? 1.4 : 1} />
          ))}
          {axes.map((axis, index) => {
            const angle = angleAt(index);
            const tip = radarPolar(angle, RADAR_R);
            const selected = axis.key === selectedMetric;
            return (
              <line
                key={axis.key}
                x1={RADAR_CENTER.x}
                y1={RADAR_CENTER.y}
                x2={tip.x}
                y2={tip.y}
                stroke={selected ? NAVY : GRID}
                strokeWidth={selected ? 1.6 : 1}
                opacity={selected ? 0.55 : 1}
              />
            );
          })}

          {typePath && <path d={typePath} fill="none" stroke={NAVY} strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />}
          {pilotPath && <path d={pilotPath} fill={RED} fillOpacity="0.16" stroke={RED} strokeWidth="2" strokeLinejoin="round" />}

          {typePoints.map(({ x, y, axis, overflow }) => (
            <g key={`type-${axis.key}`}>
              <path d={`M ${x} ${y - 5} L ${x + 5} ${y} L ${x} ${y + 5} L ${x - 5} ${y} Z`} fill="white" stroke={NAVY} strokeWidth="2" />
              <title>{`${axis.label}: среднее по типу ВС ${formatMetric(axis.typeAvg, axis.key, true)}${overflow ? " (вне диапазона пилота)" : ""}`}</title>
            </g>
          ))}

          {pilotPoints.map(({ x, y, axis }) => (
            <g key={`pilot-${axis.key}`}>
              <circle cx={x} cy={y} r="4.5" fill={RED} stroke="white" strokeWidth="1.6" />
              <title>{`${axis.label}: ${pilotLabel} — мин. ${formatMetric(axis.pilotMin, axis.key, true)}, среднее ${formatMetric(axis.pilotAvg, axis.key, true)}, макс. ${formatMetric(axis.pilotMax, axis.key, true)}`}</title>
            </g>
          ))}

          {axes.map((axis, index) => {
            const angle = angleAt(index);
            const pos = radarPolar(angle, RADAR_LABEL_R);
            const selected = axis.key === selectedMetric;
            const anchor = radarLabelAnchor(angle);
            const baseDy = radarLabelDy(angle);
            const hasPilotValue = axis.pilotAvg !== null;
            const typeEntry = typePoints.find((p) => p.axis.key === axis.key);
            return (
              <g key={`label-${axis.key}`}>
                <text x={pos.x} y={pos.y} textAnchor={anchor} dy={baseDy} fill={selected ? RED : INK} fontSize={selected ? 11 : 10} fontWeight={selected ? 800 : 700}>
                  {axis.label}
                </text>
                {hasPilotValue && (
                  <text x={pos.x} y={pos.y} textAnchor={anchor} dy={baseDy + 15} fill={RED} fontSize="9" fontWeight="700">
                    {`● ${formatMetric(axis.pilotAvg, axis.key, true)}`}
                  </text>
                )}
                {typeEntry && (
                  <text x={pos.x} y={pos.y} textAnchor={anchor} dy={baseDy + 29} fill={NAVY} fontSize="9" fontWeight="700">
                    {`${typeEntry.overflow ? (typeEntry.overflow === "high" ? "▲ " : "▼ ") : "◇ "}${formatMetric(axis.typeAvg, axis.key, true)}`}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export function normalizedDistributionSvg(bins: MultiHistogramBin[], metric: FlightMetricKey, series: ChartSeries[], width = 860, height = 250) {
  if (!bins.length || !series.length) return "";
  const totals = Object.fromEntries(series.map((item) => [item.id, bins.reduce((sum, bin) => sum + (bin.counts[item.id] ?? 0), 0)]));
  const maxPercent = Math.max(10, ...bins.flatMap((bin) => series.map((item) => totals[item.id] ? ((bin.counts[item.id] ?? 0) / totals[item.id]) * 100 : 0)));
  const yMax = Math.ceil(maxPercent / 10) * 10;
  const pad = { top: 18, right: 16, bottom: 48, left: 46 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const slot = innerWidth / bins.length;
  const groupWidth = Math.min(70, slot * .75);
  const barWidth = Math.max(3, groupWidth / series.length - 2);
  const grid = ticks(0, yMax, 5).map((tick) => { const y = pad.top + innerHeight - (tick / yMax) * innerHeight; return `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y}" y2="${y}" stroke="${GRID}"/><text x="${pad.left - 7}" y="${y + 3}" text-anchor="end" fill="${MUTED}" font-size="9">${Math.round(tick)}%</text>`; }).join("");
  const bars = bins.map((bin, binIndex) => {
    const startX = pad.left + slot * binIndex + (slot - groupWidth) / 2;
    const columns = series.map((item, seriesIndex) => {
      const percent = totals[item.id] ? ((bin.counts[item.id] ?? 0) / totals[item.id]) * 100 : 0;
      const h = (percent / yMax) * innerHeight;
      return `<rect x="${startX + seriesIndex * (barWidth + 2)}" y="${pad.top + innerHeight - h}" width="${barWidth}" height="${h}" rx="2" fill="${item.color}" opacity="${item.primary ? 1 : .82}"/>`;
    }).join("");
    return `${columns}<text x="${pad.left + slot * binIndex + slot / 2}" y="${height - 24}" text-anchor="middle" fill="${INK}" font-size="8">${escapeXml(formatMetric(bin.from, metric))}</text><text x="${pad.left + slot * binIndex + slot / 2}" y="${height - 12}" text-anchor="middle" fill="${MUTED}" font-size="7">– ${escapeXml(formatMetric(bin.to, metric))}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"><rect width="${width}" height="${height}" fill="#fff"/>${grid}${bars}</svg>`;
}
