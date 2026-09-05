"use client";

import { useMemo, useState } from "react";
import {
  buildStatisticRows,
  collectMetricSeries,
  formatMetric,
  metricDefinitions,
  multiHistogramBins,
  statDimensionLabels,
  type Flight,
  type FlightMetricKey,
  type StatDimension,
} from "./flight-data";
import { ComparisonRangeChart, NormalizedDistributionHistogram, SERIES_COLORS, type ChartSeries } from "./histogram";
import { downloadStatisticExcel, printStatisticPdf } from "./report-export";

const dimensions = Object.entries(statDimensionLabels) as Array<[StatDimension, string]>;
const MAX_SERIES = SERIES_COLORS.length;

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
  const [dimension, setDimension] = useState<StatDimension>("pilots");
  const [metric, setMetric] = useState<FlightMetricKey>("landingNy");
  const [primaryId, setPrimaryId] = useState("");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [minFlights, setMinFlights] = useState(3);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | "">("");

  const rows = useMemo(() => buildStatisticRows(flights, dimension, dimension === "pilots" ? minFlights : 1), [dimension, flights, minFlights]);
  const activePrimaryId = rows.some((row) => row.id === primaryId) ? primaryId : rows[0]?.id ?? "";
  const activeComparisonIds = comparisonIds.filter((id) => id !== activePrimaryId && rows.some((row) => row.id === id)).slice(0, MAX_SERIES - 1);
  const selectedIds = useMemo(() => activePrimaryId ? [activePrimaryId, ...activeComparisonIds] : [], [activeComparisonIds, activePrimaryId]);
  const selectedRows = useMemo(() => selectedIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is NonNullable<typeof row> => Boolean(row)), [rows, selectedIds]);
  const availableRows = rows.filter((row) => !selectedIds.includes(row.id));
  const metricMeta = metricDefinitions.find((item) => item.key === metric)!;
  const baselineLabel = dimension === "pilots" ? "Среднее по типу ВС" : "Среднее выборки";
  const series = useMemo<ChartSeries[]>(() => selectedRows.map((row, index) => ({
    id: row.id,
    label: row.label,
    subtitle: row.subtitle,
    color: SERIES_COLORS[index],
    primary: index === 0,
  })), [selectedRows]);
  const distributions = useMemo(() => collectMetricSeries(flights, dimension, selectedIds, metric), [dimension, flights, metric, selectedIds]);
  const bins = useMemo(() => multiHistogramBins(distributions), [distributions]);

  const changeDimension = (next: StatDimension) => {
    setDimension(next);
    setPrimaryId("");
    setComparisonIds([]);
  };
  const changePrimary = (next: string) => {
    setPrimaryId(next);
    setComparisonIds((current) => current.filter((id) => id !== next));
  };
  const addComparison = (id: string) => {
    if (!id || selectedIds.includes(id) || selectedIds.length >= MAX_SERIES) return;
    setComparisonIds((current) => [...current, id]);
  };

  const report = () => ({
    generatedAt: new Date(),
    sourceFile,
    aircraftFilter,
    airportFilter,
    dimension,
    metric,
    metricLabel: metricMeta.label,
    metricUnit: metricMeta.unit,
    selectedIds,
    rows: selectedRows,
    bins,
    series,
    baselineLabel,
  });

  return (
    <div className="stats-panel">
      <div className="pilot-controls stats-controls">
        <label><span>Разрез</span>
          <select value={dimension} onChange={(event) => changeDimension(event.target.value as StatDimension)}>
            {dimensions.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select>
        </label>
        <label><span>Показатель</span>
          <select value={metric} onChange={(event) => setMetric(event.target.value as FlightMetricKey)}>
            {metricDefinitions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
          </select>
        </label>
        {dimension === "pilots" && <label><span>Минимум рейсов</span><input type="number" min="1" value={minFlights} onChange={(event) => setMinFlights(Math.max(1, Number(event.target.value) || 1))} /></label>}
      </div>

      <section className="comparison-picker" aria-label="Участники сравнения">
        <div className="comparison-picker-fields">
          <label><span>Основной {dimension === "pilots" ? "пилот" : "объект"}</span>
            <select value={activePrimaryId} onChange={(event) => changePrimary(event.target.value)} disabled={!rows.length}>
              {rows.map((row) => <option value={row.id} key={row.id}>{row.subtitle ? `${row.label} · ${row.subtitle}` : row.label}</option>)}
            </select>
          </label>
          <label><span>Добавить к сравнению</span>
            <select value="" onChange={(event) => addComparison(event.target.value)} disabled={!availableRows.length || selectedIds.length >= MAX_SERIES}>
              <option value="">{selectedIds.length >= MAX_SERIES ? `Выбрано максимум: ${MAX_SERIES}` : "Выберите ещё одного или нескольких"}</option>
              {availableRows.map((row) => <option value={row.id} key={row.id}>{row.subtitle ? `${row.label} · ${row.subtitle}` : row.label}</option>)}
            </select>
          </label>
        </div>
        {selectedRows.length > 0 && <div className="comparison-chips">
          {selectedRows.map((row, index) => <span className={`comparison-chip${index === 0 ? " primary" : ""}`} style={{ "--series-color": SERIES_COLORS[index] } as React.CSSProperties} key={row.id}>
            <i />
            <span><strong>{row.label}</strong><small>{row.subtitle || `${row.flights} рейсов`}</small></span>
            {index > 0 && <button type="button" onClick={() => setComparisonIds((current) => current.filter((id) => id !== row.id))} aria-label={`Убрать ${row.label} из сравнения`}>×</button>}
          </span>)}
        </div>}
        {dimension === "pilots" && <p className="note">Каждый пилот сравнивается со средним именно по своему типу ВС. В данных нет признака PF, поэтому учитываются все рейсы, где пилот входил в экипаж.</p>}
      </section>

      <div className="export-row">
        <p className="note">Точка показывает среднее, линия — минимум и максимум, ромб — {baselineLabel.toLocaleLowerCase("ru-RU")}. В распределении доли нормализованы, поэтому пилотов с разным числом рейсов можно сравнивать корректно.</p>
        <div className="export-actions">
          <button type="button" disabled={!selectedRows.length || Boolean(exporting)} onClick={async () => { setExporting("xlsx"); try { await downloadStatisticExcel(report()); } finally { setExporting(""); } }}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.6" y="1.6" width="12.8" height="12.8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.35"/><path d="M1.6 6h12.8M1.6 10h12.8M6 1.6v12.8" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="m8.9 6.9 2.4 2.4M11.3 6.9 8.9 9.3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/></svg>
            {exporting === "xlsx" ? "Готовим Excel…" : "Excel"}
          </button>
          <button type="button" className="ghost" disabled={!selectedRows.length || Boolean(exporting)} onClick={() => { setExporting("pdf"); try { printStatisticPdf(report()); } finally { setExporting(""); } }}>
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M4 1.5h5.2L13 5.3V14.5H4z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/><path d="M9.2 1.5V5.3H13" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round"/><path d="M6 8.4h4.2M6 10.6h4.2M6 12.7h2.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            PDF
          </button>
        </div>
      </div>

      {selectedRows.length ? <div className="stats-callout stats-participants">
        {selectedRows.map((row, index) => {
          const average = row.metrics[metric];
          const baseline = row.baselineMetrics[metric];
          const delta = average !== null && baseline !== null ? average - baseline : null;
          return <article className={index === 0 ? "is-primary" : ""} style={{ "--series-color": SERIES_COLORS[index] } as React.CSSProperties} key={row.id}>
            <span>{index === 0 ? "Основной" : `Сравнение ${index}`}</span>
            <strong>{row.label}</strong>
            <small>{row.subtitle}</small>
            <dl>
              <div><dt>Среднее</dt><dd>{formatMetric(average, metric, true)}</dd></div>
              <div><dt>Медиана</dt><dd>{formatMetric(row.medianMetrics[metric], metric, true)}</dd></div>
              <div><dt>{baselineLabel}</dt><dd>{formatMetric(baseline, metric, true)}</dd></div>
              <div><dt>Отклонение</dt><dd>{delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatMetric(delta, metric, true)}`}</dd></div>
            </dl>
          </article>;
        })}
      </div> : <p className="note">Нет объектов для выбранного разреза.</p>}

      <article className="chart-card">
        <div className="chart-head">
          <div><span>Среднее и диапазон</span><h2>{metricMeta.label}</h2></div>
          <ul className="chart-legend"><li><i className="range-line-icon" />Мин.–макс.</li><li><i className="mean-dot-icon" />Среднее</li><li><i className="baseline-diamond-icon" />{baselineLabel}</li></ul>
        </div>
        <ComparisonRangeChart rows={selectedRows} metric={metric} series={series} baselineLabel={baselineLabel} />
      </article>

      <article className="chart-card">
        <div className="chart-head">
          <div><span>Распределение значений</span><h2>Доля рейсов в каждом диапазоне</h2></div>
          <ul className="chart-legend series-legend">{series.map((item) => <li key={item.id}><i style={{ background: item.color }} />{item.label}</li>)}</ul>
        </div>
        <p className="note">Ось Y показывает процент рейсов каждого участника, а не абсолютное количество.</p>
        <NormalizedDistributionHistogram bins={bins} metric={metric} series={series} />
      </article>

      <div className="table-shell">
        <table className="pilot-table stats-table comparison-table">
          <thead><tr>{["Объект", "Рейсов", "Мин.", "Медиана", "Среднее", "Макс.", baselineLabel, "Отклонение"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{selectedRows.map((row, index) => {
            const average = row.metrics[metric];
            const baseline = row.baselineMetrics[metric];
            const delta = average !== null && baseline !== null ? average - baseline : null;
            return <tr key={row.id} className={index === 0 ? "is-selected" : ""}>
              <th><i className="table-series-mark" style={{ background: SERIES_COLORS[index] }} />{row.label}{row.subtitle && <small>{row.subtitle}</small>}</th>
              <td>{row.flights}</td>
              <td>{formatMetric(row.minMetrics[metric], metric, true)}</td>
              <td>{formatMetric(row.medianMetrics[metric], metric, true)}</td>
              <td>{formatMetric(average, metric, true)}</td>
              <td>{formatMetric(row.maxMetrics[metric], metric, true)}</td>
              <td>{formatMetric(baseline, metric, true)}</td>
              <td className="delta">{delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatMetric(delta, metric, true)}`}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  );
}
