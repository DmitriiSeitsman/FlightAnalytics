"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildStatisticRows,
  collectMetricValues,
  formatMetric,
  histogramBins,
  metricDefinitions,
  statDimensionLabels,
  type Flight,
  type FlightMetricKey,
  type StatDimension,
} from "./flight-data";
import { ComparisonHistogram, DistributionHistogram, toComparisonBars } from "./histogram";
import { downloadStatisticExcel, printStatisticPdf } from "./report-export";

const dimensions = Object.entries(statDimensionLabels) as Array<[StatDimension, string]>;

export function StatisticsView({
  flights,
  sourceFile,
  aircraftFilter,
  airportFilter,
}: {
  flights: Flight[];
  sourceFile: string;
  aircraftFilter: string;
  airportFilter: string;
}) {
  const [dimension, setDimension] = useState<StatDimension>("aircraftType");
  const [metric, setMetric] = useState<FlightMetricKey>("landingNy");
  const [selectedId, setSelectedId] = useState("");
  const [minFlights, setMinFlights] = useState(3);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | "">("");

  const rows = useMemo(() => buildStatisticRows(flights, dimension, dimension === "pilots" ? minFlights : 1), [dimension, flights, minFlights]);
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];
  const activeId = selected?.id ?? "";
  const metricMeta = metricDefinitions.find((item) => item.key === metric)!;
  const ordered = useMemo(() => [...rows].filter((row) => row.metrics[metric] !== null).sort((left, right) => (left.metrics[metric] ?? 0) - (right.metrics[metric] ?? 0)), [metric, rows]);
  const overallAverage = ordered.length ? ordered.reduce((sum, row) => sum + (row.metrics[metric] ?? 0), 0) / ordered.length : null;
  const distribution = useMemo(() => {
    if (!activeId) return { selected: [] as number[], others: [] as number[] };
    return collectMetricValues(flights, dimension, activeId, metric);
  }, [activeId, dimension, flights, metric]);
  const bins = useMemo(() => histogramBins(distribution.selected, distribution.others), [distribution]);
  const rank = selected ? ordered.findIndex((row) => row.id === selected.id) + 1 : 0;
  const delta = selected && selected.metrics[metric] !== null && overallAverage !== null ? selected.metrics[metric]! - overallAverage : null;

  useEffect(() => {
    if (!rows.some((row) => row.id === selectedId)) setSelectedId(rows[0]?.id ?? "");
  }, [rows, selectedId]);

  const report = () => ({
    generatedAt: new Date(),
    sourceFile,
    aircraftFilter,
    airportFilter,
    dimension,
    metric,
    metricLabel: metricMeta.label,
    metricUnit: metricMeta.unit,
    selectedId: activeId,
    rows,
    bins,
    overallAverage,
  });

  return (
    <div className="stats-panel">
      <div className="pilot-controls stats-controls">
        <label><span>Разрез</span>
          <select value={dimension} onChange={(event) => setDimension(event.target.value as StatDimension)}>
            {dimensions.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select>
        </label>
        <label><span>Показатель</span>
          <select value={metric} onChange={(event) => setMetric(event.target.value as FlightMetricKey)}>
            {metricDefinitions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
          </select>
        </label>
        <label><span>Сравнить</span>
          <select value={activeId} onChange={(event) => setSelectedId(event.target.value)}>
            {rows.map((row) => <option value={row.id} key={row.id}>{row.subtitle ? `${row.label} · ${row.subtitle}` : row.label}</option>)}
          </select>
        </label>
        {dimension === "pilots" && <label><span>Минимум рейсов</span><input type="number" min="1" value={minFlights} onChange={(event) => setMinFlights(Math.max(1, Number(event.target.value) || 1))} /></label>}
      </div>
      <div className="export-row">
        <p className="note">Красный столбец — выбранный объект, синие — остальные в том же разрезе. Пунктир — среднее сравниваемых групп. PDF открывает диалог печати: выберите «Сохранить как PDF», чтобы сохранить кириллицу.</p>
        <div className="export-actions">
          <button type="button" disabled={!rows.length || Boolean(exporting)} onClick={async () => { setExporting("xlsx"); try { await downloadStatisticExcel(report()); } finally { setExporting(""); } }}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.6" y="1.6" width="12.8" height="12.8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.35"/><path d="M1.6 6h12.8M1.6 10h12.8M6 1.6v12.8" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="m8.9 6.9 2.4 2.4M11.3 6.9 8.9 9.3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/></svg>
            {exporting === "xlsx" ? "Готовим Excel…" : "Excel"}
          </button>
          <button type="button" className="ghost" disabled={!rows.length || Boolean(exporting)} onClick={() => { setExporting("pdf"); try { printStatisticPdf(report()); } finally { setExporting(""); } }}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M4 1.5h5.2L13 5.3V14.5H4z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/><path d="M9.2 1.5V5.3H13" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/><path d="M6 8.4h4.2M6 10.6h4.2M6 12.7h2.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            PDF
          </button>
        </div>
      </div>
      {selected ? <div className="stats-callout">
        <div>
          <span>Выбранный объект</span>
          <strong>{selected.label}</strong>
          {selected.subtitle && <small>{selected.subtitle}</small>}
        </div>
        <div><span>Среднее</span><strong>{formatMetric(selected.metrics[metric], metric, true)}</strong></div>
        <div><span>Мин / макс</span><strong>{formatMetric(selected.minMetrics[metric], metric)} · {formatMetric(selected.maxMetrics[metric], metric)}</strong></div>
        <div><span>Среди групп</span><strong>{rank ? `${rank} из ${ordered.length}` : "—"}</strong><small>{delta === null ? "нет сравнения" : `${delta > 0 ? "+" : ""}${formatMetric(delta, metric, true)} к среднему`}</small></div>
      </div> : <p className="note">Нет групп для выбранного разреза.</p>}
      <article className="chart-card">
        <div className="chart-head">
          <div>
            <span>Сравнение средних</span>
            <h2>{metricMeta.label}</h2>
          </div>
          <ul className="chart-legend">
            <li><i className="swatch selected" />Выбранный</li>
            <li><i className="swatch rest" />Остальные</li>
            <li><i className="swatch mean" />Среднее групп</li>
          </ul>
        </div>
        <p className="note">Шкала подогнана под разброс, чтобы было видно отличие выбранного объекта. Если групп больше 16, показываем окно вокруг выбранного. Нажмите столбец, чтобы сменить объект.</p>
        <ComparisonHistogram bars={toComparisonBars(rows, metric, activeId)} metric={metric} onSelect={setSelectedId} />
      </article>
      <article className="chart-card">
        <div className="chart-head">
          <div>
            <span>Распределение значений</span>
            <h2>Выбранный объект относительно остальных рейсов</h2>
          </div>
          <ul className="chart-legend">
            <li><i className="swatch rest" />Остальные рейсы</li>
            <li><i className="swatch selected" />Рейсы выбранного</li>
          </ul>
        </div>
        <DistributionHistogram bins={bins} metric={metric} />
      </article>
      <div className="table-shell">
        <table className="pilot-table stats-table">
          <thead>
            <tr>
              {["Объект", "Рейсов", "Мин.", "Среднее", "Макс.", "К среднему"].map((label) => <th key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const avg = row.metrics[metric];
              const d = avg !== null && overallAverage !== null ? avg - overallAverage : null;
              return <tr key={row.id} className={row.id === activeId ? "is-selected" : ""} onClick={() => setSelectedId(row.id)}>
                <th>{row.label}{row.subtitle && <small>{row.subtitle}</small>}</th>
                <td>{row.flights}</td>
                <td>{formatMetric(row.minMetrics[metric], metric, true)}</td>
                <td>{formatMetric(avg, metric, true)}</td>
                <td>{formatMetric(row.maxMetrics[metric], metric, true)}</td>
                <td className="delta">{d === null ? "—" : `${d > 0 ? "+" : ""}${formatMetric(d, metric, true)}`}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
