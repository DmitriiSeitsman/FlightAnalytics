import type { ReactNode } from "react";
import { formatMetric, type FlightMetricKey, type HistogramBin, type MultiHistogramBin, type StatisticRow } from "./flight-data";
import { PILOT_BODY_PATH, PILOT_HEAD_PATH, PLANE_PATH } from "./marker-icons";

const NAVY = "#183964";
const RED = "#d52238";
const GREEN = "#19805b";
const GRID = "#d7e0e6";
const INK = "#14243a";
const MUTED = "#74818a";

export const SERIES_COLORS = [RED, NAVY, "#19805b", "#7c3aed", "#d97706"] as const;
// Цвет закреплён за ролью в экипаже: CM1 всегда красный, CM2 всегда зелёный —
// и когда выбраны обе роли, и когда только одна (в том числе у «чистых» 2П).
export const SEAT_COLORS = { CM1: RED, CM2: GREEN } as const;

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

// Маркеры сравнения: силуэт человека — значение объекта, самолёт — базис по типу ВС.
// Человек — тот же силуэт (голова и плечи), что у иконки пилота на графике профиля,
// только в системе координат маркера: центр в нуле, размах ±7.
export const PILOT_MARKER_PATH = "M -3.6 -3.4 A 3.6 3.6 0 1 1 3.6 -3.4 A 3.6 3.6 0 1 1 -3.6 -3.4 Z M 0 1.5 C 3.75 1.5 6.9 3.98 6.9 7.05 L -6.9 7.05 C -6.9 3.98 -3.75 1.5 0 1.5 Z";
export const PLANE_MARKER_PATH = "M 0 -7.2 C 0.95 -7.2 1.6 -6.1 1.6 -4.7 L 1.6 -2.3 L 7.4 1.5 L 7.4 3 L 1.6 1.5 L 1.6 4.3 L 3.4 5.8 L 3.4 6.9 L 0 6 L -3.4 6.9 L -3.4 5.8 L -1.6 4.3 L -1.6 1.5 L -7.4 3 L -7.4 1.5 L -1.6 -2.3 L -1.6 -4.7 C -1.6 -6.1 -0.95 -7.2 0 -7.2 Z";

// Белый контур под заливкой — иначе силуэт теряется на полосе диапазона.
export function ChartMarker({ path, x, y, color, scale = 1, opacity = 1, title }: { path: string; x: number; y: number; color: string; scale?: number; opacity?: number; title?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={path} fill="none" stroke="#fff" strokeWidth="3.2" strokeLinejoin="round" />
      <path d={path} fill={color} fillOpacity={opacity}>{title && <title>{title}</title>}</path>
    </g>
  );
}

// Тот же силуэт в легенде графика.
export function ChartMarkerIcon({ path, color = NAVY, opacity = 1 }: { path: string; color?: string; opacity?: number }) {
  return (
    <svg className="chart-legend-icon" viewBox="-9 -9 18 18" width="15" height="15" aria-hidden="true">
      <path d={path} fill={color} fillOpacity={opacity} />
    </svg>
  );
}

function markerMarkup(path: string, x: number, y: number, color: string, scale: number, opacity = 1): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})"><path d="${path}" fill="none" stroke="#ffffff" stroke-width="3.2" stroke-linejoin="round"/><path d="${path}" fill="${color}" fill-opacity="${opacity}"/></g>`;
}

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
            {baseline !== null && <ChartMarker path={PLANE_MARKER_PATH} x={x(baseline)} y={y} color={color} scale={1} opacity={0.6} title={`${baselineLabel}: ${formatMetric(baseline, metric, true)}`} />}
            {mean !== null && <ChartMarker path={PILOT_MARKER_PATH} x={x(mean)} y={y} color={color} scale={1.1} title={`${row.label}: среднее ${formatMetric(mean, metric, true)}, ${baselineLabel.toLocaleLowerCase("ru-RU")} ${formatMetric(baseline, metric, true)}`} />}
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
      ${baseline !== null ? markerMarkup(PLANE_MARKER_PATH, x(baseline), y, color, 0.85, 0.6) : ""}
      ${mean !== null ? `${markerMarkup(PILOT_MARKER_PATH, x(mean), y, color, 0.95)}<text x="${width - pad.right + 12}" y="${y + 4}" fill="${color}" font-size="10" font-weight="700">${escapeXml(formatMetric(mean, metric, true))}</text>` : ""}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Среднее, диапазон и ${escapeXml(baselineLabel.toLocaleLowerCase("ru-RU"))}"><rect width="${width}" height="${height}" fill="#fff"/>${grid}${marks}</svg>`;
}

export type PilotProfileAxis = {
  key: FlightMetricKey;
  label: string;
  unit: string;
  digits: number;
  pilotMin: number | null;
  pilotMax: number | null;
  pilotAvg: number | null;
  typeAvg: number | null;
  typeMin: number | null;
  typeMax: number | null;
  // Вторая роль в экипаже (CM2), если выбраны обе: рисуется второй дорожкой зелёным.
  pilot2Min?: number | null;
  pilot2Max?: number | null;
  pilot2Avg?: number | null;
};

const PROFILE_WIDTH = 600;
const PROFILE_LABEL_W = 150;
const PROFILE_VALUE_W = 84;
const PROFILE_ROW_H = 24;
const PROFILE_SELECTED_ROW_H = 52;
const PROFILE_PAD_TOP = 8;
const PROFILE_PAD_BOTTOM = 5;
const PROFILE_TRACK_H = 11;
const PROFILE_BAND_H = 6;
// Силуэты в системе координат 24x24: самолёт помечает среднее по типу ВС, фигура человека — среднее пилота.
const PROFILE_ICON = 16;
const PROFILE_ICON_GAP = 4;

const PROFILE_TRACK_FILL = "#e8eef9";

// Геометрия профиля считается один раз и используется и экранной версией, и SVG для PDF,
// чтобы две отрисовки не разъезжались.
type ProfileRowLayout = {
  axis: PilotProfileAxis;
  top: number;
  rowHeight: number;
  mid: number;
  selected: boolean;
  trackFrom: number;
  trackWidth: number;
  bandFrom: number | null;
  bandWidth: number;
  pilotX: number | null;
  band2From: number | null;
  band2Width: number;
  pilot2X: number | null;
  typeX: number | null;
};

function layoutPilotProfile(axes: PilotProfileAxis[], selectedMetric: FlightMetricKey) {
  const rows = axes.filter((axis) => axis.typeMin !== null && axis.typeMax !== null);
  const plotX = PROFILE_LABEL_W;
  const plotWidth = PROFILE_WIDTH - PROFILE_LABEL_W - PROFILE_VALUE_W;
  const rowHeights = rows.map((axis) => (axis.key === selectedMetric ? PROFILE_SELECTED_ROW_H : PROFILE_ROW_H));
  const rowTops = rowHeights.map((_, index) => PROFILE_PAD_TOP + rowHeights.slice(0, index).reduce((sum, item) => sum + item, 0));

  const laidOut = rows.map((axis, index): ProfileRowLayout => {
    const typeMin = axis.typeMin as number;
    const typeMax = axis.typeMax as number;
    const rawSpan = typeMax - typeMin;
    const pad = rawSpan !== 0 ? rawSpan * 0.1 : (typeMax !== 0 ? Math.abs(typeMax) * 0.1 : 1);
    const scaleMin = typeMin - pad;
    const scaleSpan = rawSpan + pad * 2;
    const xFor = (value: number) => plotX + plotWidth * Math.min(1, Math.max(0, (value - scaleMin) / scaleSpan));

    const trackFrom = xFor(typeMin);
    const hasPilotRange = axis.pilotMin !== null && axis.pilotMax !== null;
    const bandFrom = hasPilotRange ? xFor(axis.pilotMin as number) : null;
    const hasSecondRange = axis.pilot2Min !== null && axis.pilot2Min !== undefined && axis.pilot2Max !== null && axis.pilot2Max !== undefined;
    const band2From = hasSecondRange ? xFor(axis.pilot2Min as number) : null;

    return {
      axis,
      top: rowTops[index],
      rowHeight: rowHeights[index],
      mid: rowTops[index] + rowHeights[index] / 2,
      selected: axis.key === selectedMetric,
      trackFrom,
      trackWidth: Math.max(PROFILE_TRACK_H, xFor(typeMax) - trackFrom),
      bandFrom,
      bandWidth: bandFrom === null ? 0 : Math.max(PROFILE_BAND_H, xFor(axis.pilotMax as number) - bandFrom),
      pilotX: axis.pilotAvg === null ? null : xFor(axis.pilotAvg),
      band2From,
      band2Width: band2From === null ? 0 : Math.max(PROFILE_BAND_H, xFor(axis.pilot2Max as number) - band2From),
      pilot2X: axis.pilot2Avg === null || axis.pilot2Avg === undefined ? null : xFor(axis.pilot2Avg),
      typeX: axis.typeAvg === null ? null : xFor(axis.typeAvg),
    };
  });

  return {
    rows: laidOut,
    height: PROFILE_PAD_TOP + rowHeights.reduce((sum, item) => sum + item, 0) + PROFILE_PAD_BOTTOM,
    valueX: PROFILE_WIDTH - 4,
  };
}

const profileSeriesPart = (axis: PilotProfileAxis, label: string, min: number | null, max: number | null, avg: number | null) =>
  avg !== null
    ? `${label}: ${formatMetric(min, axis.key, true)} – ${formatMetric(max, axis.key, true)}, среднее ${formatMetric(avg, axis.key, true)}`
    : `${label}: нет данных`;

const profileRowTitle = (axis: PilotProfileAxis, pilotLabel: string, baselineLabel: string, primaryLabel?: string, secondaryLabel?: string) => {
  const hasSecond = axis.pilot2Avg !== null && axis.pilot2Avg !== undefined;
  const pilotPart = profileSeriesPart(
    axis,
    hasSecond && primaryLabel ? `${pilotLabel} (${primaryLabel})` : pilotLabel,
    axis.pilotMin,
    axis.pilotMax,
    axis.pilotAvg,
  );
  const secondPart = hasSecond
    ? ` ${profileSeriesPart(axis, `${pilotLabel} (${secondaryLabel ?? "CM2"})`, axis.pilot2Min ?? null, axis.pilot2Max ?? null, axis.pilot2Avg ?? null)}.`
    : "";
  const typePart = `${baselineLabel}: ${formatMetric(axis.typeMin, axis.key, true)} – ${formatMetric(axis.typeMax, axis.key, true)}, среднее ${formatMetric(axis.typeAvg, axis.key, true)}`;
  return `${axis.label}. ${pilotPart}.${secondPart} ${typePart}.`;
};

// Профиль пилота: по строке на показатель. Голубая дорожка — диапазон типа ВС (минимум→максимум),
// одинаковой длины во всех строках, потому что каждая строка нормирована по своему диапазону типа.
// Внутри неё красный пояс — диапазон пилота, точка — его среднее, синяя метка — среднее по типу.
export function PilotRangeProfile({
  axes,
  selectedMetric,
  pilotLabel,
  baselineLabel,
  primaryLabel,
  secondaryLabel,
  primaryColor = RED,
  secondaryColor = GREEN,
}: {
  axes: PilotProfileAxis[];
  selectedMetric: FlightMetricKey;
  pilotLabel: string;
  baselineLabel: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  primaryColor?: string;
  secondaryColor?: string;
}) {
  const { rows, height, valueX } = layoutPilotProfile(axes, selectedMetric);
  if (!rows.length) return <p className="note">Недостаточно данных для профиля пилота.</p>;

  return (
    <div className="chart-scroll">
      <div className="chart-plot" style={{ minWidth: 540 }}>
        <svg
          viewBox={`0 0 ${PROFILE_WIDTH} ${height}`}
          role="img"
          aria-label={`Профиль ${pilotLabel}: диапазон и среднее по каждому показателю в сравнении с диапазоном по ${baselineLabel}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {rows.map(({ axis, top, rowHeight, mid, selected, trackFrom, trackWidth, bandFrom, bandWidth, pilotX, band2From, band2Width, pilot2X, typeX }) => {
            // Когда выбраны обе роли, строка делится на две дорожки: CM1 выше центра, CM2 ниже.
            const split = pilot2X !== null || band2From !== null;
            const lane = split ? 3 : 0;
            const bandHeight = split ? 5 : PROFILE_BAND_H;
            const dotRadius = split ? 3.6 : 4;
            const textLane = split ? 5.5 : 0;
            return (
            <g key={axis.key}>
              <title>{profileRowTitle(axis, pilotLabel, baselineLabel, primaryLabel, secondaryLabel)}</title>
              <rect x="0" y={top + 1} width={PROFILE_WIDTH} height={rowHeight - 2} rx="8" fill={selected ? `${RED}0f` : "transparent"} />

              <text
                x={PROFILE_LABEL_W - 12}
                y={mid}
                dy="3"
                textAnchor="end"
                fill={selected ? RED : INK}
                fontSize={selected ? 10 : 9}
                fontWeight={selected ? 800 : 600}
              >
                {axis.label}
              </text>

              <rect x={trackFrom} y={mid - PROFILE_TRACK_H / 2} width={trackWidth} height={PROFILE_TRACK_H} rx={PROFILE_TRACK_H / 2} fill={PROFILE_TRACK_FILL} />

              {bandFrom !== null && (
                <rect x={bandFrom} y={mid - lane - bandHeight / 2} width={bandWidth} height={bandHeight} rx={bandHeight / 2} fill={primaryColor} fillOpacity="0.32" />
              )}

              {band2From !== null && (
                <rect x={band2From} y={mid + lane - bandHeight / 2} width={band2Width} height={bandHeight} rx={bandHeight / 2} fill={secondaryColor} fillOpacity="0.3" />
              )}

              {typeX !== null && (
                <g>
                  {selected && (
                    <g transform={`translate(${typeX - PROFILE_ICON / 2}, ${mid - PROFILE_TRACK_H / 2 - PROFILE_ICON_GAP - PROFILE_ICON}) scale(${PROFILE_ICON / 24})`} fill={NAVY}>
                      <path d={PLANE_PATH} />
                    </g>
                  )}
                  <rect x={typeX - 3} y={mid - 9} width="6" height="18" rx="3" fill="white" />
                  <rect x={typeX - 1} y={mid - 7.5} width="2" height="15" rx="1" fill={NAVY} />
                </g>
              )}

              {pilotX !== null && (
                <>
                  <circle cx={pilotX} cy={mid - lane} r={dotRadius} fill={primaryColor} stroke="white" strokeWidth="2" />
                  {selected && !split && (
                    <g transform={`translate(${pilotX - PROFILE_ICON / 2}, ${mid + PROFILE_TRACK_H / 2 + PROFILE_ICON_GAP}) scale(${PROFILE_ICON / 24})`} fill={primaryColor}>
                      <path d={PILOT_HEAD_PATH} />
                      <path d={PILOT_BODY_PATH} />
                    </g>
                  )}
                </>
              )}

              {pilot2X !== null && (
                <circle cx={pilot2X} cy={mid + lane} r={dotRadius} fill={secondaryColor} stroke="white" strokeWidth="2" />
              )}

              {split ? (
                <>
                  <text x={valueX} y={mid - textLane} dy="3" textAnchor="end" fill={primaryColor} fontSize="8.5" fontWeight="700">
                    {axis.pilotAvg !== null ? formatMetric(axis.pilotAvg, axis.key, true) : "—"}
                  </text>
                  <text x={valueX} y={mid + textLane} dy="3" textAnchor="end" fill={secondaryColor} fontSize="8.5" fontWeight="700">
                    {axis.pilot2Avg !== null && axis.pilot2Avg !== undefined ? formatMetric(axis.pilot2Avg, axis.key, true) : "—"}
                  </text>
                </>
              ) : (
                <text x={valueX} y={mid} dy="3" textAnchor="end" fill={INK} fontSize="9" fontWeight="700">
                  {axis.pilotAvg !== null ? formatMetric(axis.pilotAvg, axis.key, true) : "—"}
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

// Легенда профиля теми же фигурами, что и на графике, — для PDF.
export function pilotProfileLegendSvg({
  pilotColor = RED,
  primaryLabel,
  secondaryColor = GREEN,
  secondaryLabel,
}: {
  pilotColor?: string;
  primaryLabel?: string;
  secondaryColor?: string;
  secondaryLabel?: string;
} = {}) {
  const width = PROFILE_WIDTH;
  const height = 16;
  const mid = height / 2;
  const rangeMark = (color: string) => (x: number) => `<rect x="${x}" y="${mid - 4}" width="18" height="8" rx="4" fill="${color}" fill-opacity="0.32"/>`;
  const avgMark = (color: string) => (x: number) => `<circle cx="${x + 7}" cy="${mid}" r="4" fill="${color}" stroke="#ffffff" stroke-width="2"/>`;
  const items: Array<{ label: string; mark: (x: number) => string }> = [
    { label: "Диапазон типа ВС", mark: (x) => `<rect x="${x}" y="${mid - 5}" width="18" height="10" rx="5" fill="${PROFILE_TRACK_FILL}"/>` },
    { label: `Диапазон ${primaryLabel ?? "пилота"}`, mark: rangeMark(pilotColor) },
    { label: `Среднее ${primaryLabel ?? "пилота"}`, mark: avgMark(pilotColor) },
    ...(secondaryLabel ? [
      { label: `Диапазон ${secondaryLabel}`, mark: rangeMark(secondaryColor) },
      { label: `Среднее ${secondaryLabel}`, mark: avgMark(secondaryColor) },
    ] : []),
    { label: "Среднее по типу ВС", mark: (x) => `<rect x="${x + 5}" y="${mid - 6}" width="2" height="12" rx="1" fill="${NAVY}"/>` },
  ];
  const step = width / items.length;
  const content = items.map((item, index) => {
    const x = index * step;
    return `${item.mark(x)}<text x="${x + 24}" y="${mid + 3}" fill="${MUTED}" font-size="8" font-weight="700">${escapeXml(item.label)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Легенда профиля"><rect width="${width}" height="${height}" fill="#ffffff"/>${content}</svg>`;
}

// Тот же профиль строкой SVG — для вставки в PDF-досье.
export function pilotProfileSvg(axes: PilotProfileAxis[], selectedMetric: FlightMetricKey, pilotColor: string = RED, secondColor: string = GREEN) {
  const { rows, height, valueX } = layoutPilotProfile(axes, selectedMetric);
  if (!rows.length) return "";

  const marks = rows.map(({ axis, top, rowHeight, mid, selected, trackFrom, trackWidth, bandFrom, bandWidth, pilotX, band2From, band2Width, pilot2X, typeX }) => {
    // Разметка один в один как на экране: при двух ролях строка делится на две дорожки.
    const split = pilot2X !== null || band2From !== null;
    const lane = split ? 3 : 0;
    const bandHeight = split ? 5 : PROFILE_BAND_H;
    const dotRadius = split ? 3.6 : 4;
    const textLane = split ? 5.5 : 0;
    const highlight = selected ? `<rect x="0" y="${top + 1}" width="${PROFILE_WIDTH}" height="${rowHeight - 2}" rx="8" fill="#fdeef0"/>` : "";
    const label = `<text x="${PROFILE_LABEL_W - 12}" y="${mid + 3}" text-anchor="end" fill="${selected ? RED : INK}" font-size="${selected ? 10 : 9}" font-weight="${selected ? 800 : 600}">${escapeXml(axis.label)}</text>`;
    const track = `<rect x="${trackFrom}" y="${mid - PROFILE_TRACK_H / 2}" width="${trackWidth}" height="${PROFILE_TRACK_H}" rx="${PROFILE_TRACK_H / 2}" fill="${PROFILE_TRACK_FILL}"/>`;
    const band = bandFrom === null ? "" : `<rect x="${bandFrom}" y="${mid - lane - bandHeight / 2}" width="${bandWidth}" height="${bandHeight}" rx="${bandHeight / 2}" fill="${pilotColor}" fill-opacity="0.32"/>`;
    const band2 = band2From === null ? "" : `<rect x="${band2From}" y="${mid + lane - bandHeight / 2}" width="${band2Width}" height="${bandHeight}" rx="${bandHeight / 2}" fill="${secondColor}" fill-opacity="0.3"/>`;
    const plane = typeX !== null && selected ? `<g transform="translate(${typeX - PROFILE_ICON / 2}, ${mid - PROFILE_TRACK_H / 2 - PROFILE_ICON_GAP - PROFILE_ICON}) scale(${PROFILE_ICON / 24})" fill="${NAVY}"><path d="${PLANE_PATH}"/></g>` : "";
    const typeMark = typeX === null ? "" : `<rect x="${typeX - 3}" y="${mid - 9}" width="6" height="18" rx="3" fill="#ffffff"/><rect x="${typeX - 1}" y="${mid - 7.5}" width="2" height="15" rx="1" fill="${NAVY}"/>`;
    const pilotMark = pilotX === null ? "" : `<circle cx="${pilotX}" cy="${mid - lane}" r="${dotRadius}" fill="${pilotColor}" stroke="#ffffff" stroke-width="2"/>`;
    const pilot2Mark = pilot2X === null ? "" : `<circle cx="${pilot2X}" cy="${mid + lane}" r="${dotRadius}" fill="${secondColor}" stroke="#ffffff" stroke-width="2"/>`;
    const person = pilotX !== null && selected && !split ? `<g transform="translate(${pilotX - PROFILE_ICON / 2}, ${mid + PROFILE_TRACK_H / 2 + PROFILE_ICON_GAP}) scale(${PROFILE_ICON / 24})" fill="${pilotColor}"><path d="${PILOT_HEAD_PATH}"/><path d="${PILOT_BODY_PATH}"/></g>` : "";
    const value = split
      ? `<text x="${valueX}" y="${mid - textLane + 3}" text-anchor="end" fill="${pilotColor}" font-size="8.5" font-weight="700">${escapeXml(axis.pilotAvg !== null ? formatMetric(axis.pilotAvg, axis.key, true) : "—")}</text>`
        + `<text x="${valueX}" y="${mid + textLane + 3}" text-anchor="end" fill="${secondColor}" font-size="8.5" font-weight="700">${escapeXml(axis.pilot2Avg !== null && axis.pilot2Avg !== undefined ? formatMetric(axis.pilot2Avg, axis.key, true) : "—")}</text>`
      : `<text x="${valueX}" y="${mid + 3}" text-anchor="end" fill="${INK}" font-size="9" font-weight="700">${escapeXml(axis.pilotAvg !== null ? formatMetric(axis.pilotAvg, axis.key, true) : "—")}</text>`;
    return `${highlight}${label}${track}${band}${band2}${plane}${typeMark}${pilotMark}${pilot2Mark}${person}${value}`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PROFILE_WIDTH} ${height}" width="${PROFILE_WIDTH}" height="${height}" role="img" aria-label="Профиль пилота по всем показателям"><rect width="${PROFILE_WIDTH}" height="${height}" fill="#ffffff"/>${marks}</svg>`;
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
