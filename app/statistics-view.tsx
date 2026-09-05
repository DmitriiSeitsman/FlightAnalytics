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
import { downloadStatisticExcel, downloadStatisticPdf } from "./report-export";
import { SearchableSelect, type SearchableOption } from "./searchable-select";

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
  const [statisticsAircraftType, setStatisticsAircraftType] = useState("");
  const [metric, setMetric] = useState<FlightMetricKey>("landingNy");
  const [primaryId, setPrimaryId] = useState("");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [minFlights, setMinFlights] = useState(3);
  const [reportMetrics, setReportMetrics] = useState<FlightMetricKey[]>(() => metricDefinitions.map((item) => item.key));
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | "">("");

  const aircraftTypes = useMemo(() => [...new Set(flights.map((flight) => flight.aircraftType))].sort((left, right) => left.localeCompare(right, "ru")), [flights]);
  const activeAircraftType = aircraftTypes.includes(statisticsAircraftType) ? statisticsAircraftType : "";
  const statisticsFlights = useMemo(() => flights.filter((flight) => !activeAircraftType || flight.aircraftType === activeAircraftType), [activeAircraftType, flights]);
  const rows = useMemo(() => buildStatisticRows(statisticsFlights, dimension, dimension === "pilots" ? minFlights : 1), [dimension, minFlights, statisticsFlights]);
  const activePrimaryId = rows.some((row) => row.id === primaryId) ? primaryId : rows[0]?.id ?? "";
  const activeComparisonIds = comparisonIds.filter((id) => id !== activePrimaryId && rows.some((row) => row.id === id)).slice(0, MAX_SERIES - 1);
  const selectedIds = useMemo(() => activePrimaryId ? [activePrimaryId, ...activeComparisonIds] : [], [activeComparisonIds, activePrimaryId]);
  const selectedRows = useMemo(() => selectedIds.map((id) => rows.find((row) => row.id === id)).filter((row): row is NonNullable<typeof row> => Boolean(row)), [rows, selectedIds]);
  const availableRows = rows.filter((row) => !selectedIds.includes(row.id));
  const primaryOptions = useMemo<SearchableOption[]>(() => rows.map((row) => ({ value: row.id, label: row.label, detail: row.subtitle || `${row.flights} рейсов`, keywords: `${row.id} ${row.subtitle}` })), [rows]);
  const comparisonOptions = useMemo<SearchableOption[]>(() => availableRows.map((row) => ({ value: row.id, label: row.label, detail: row.subtitle || `${row.flights} рейсов`, keywords: `${row.id} ${row.subtitle}` })), [availableRows]);
  const metricMeta = metricDefinitions.find((item) => item.key === metric)!;
  const baselineLabel = dimension === "pilots" ? "Среднее по типу ВС" : "Среднее выборки";
  const series = useMemo<ChartSeries[]>(() => selectedRows.map((row, index) => ({
    id: row.id,
    label: row.label,
    subtitle: row.subtitle,
    color: SERIES_COLORS[index],
    primary: index === 0,
  })), [selectedRows]);
  const distributions = useMemo(() => collectMetricSeries(statisticsFlights, dimension, selectedIds, metric), [dimension, metric, selectedIds, statisticsFlights]);
  const bins = useMemo(() => multiHistogramBins(distributions), [distributions]);

  const changeDimension = (next: StatDimension) => {
    setDimension(next);
    setPrimaryId("");
    setComparisonIds([]);
  };
  const changeAircraftType = (next: string) => {
    setStatisticsAircraftType(next);
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
  const toggleReportMetric = (key: FlightMetricKey) => setReportMetrics((current) => {
    if (current.includes(key)) return current.length === 1 ? current : current.filter((item) => item !== key);
    const selected = new Set([...current, key]);
    return metricDefinitions.map((item) => item.key).filter((item) => selected.has(item));
  });

  const report = () => {
    const chartMetric = reportMetrics.includes(metric) ? metric : reportMetrics[0];
    const chartMeta = metricDefinitions.find((item) => item.key === chartMetric)!;
    const chartDistributions = collectMetricSeries(statisticsFlights, dimension, selectedIds, chartMetric);
    return {
      generatedAt: new Date(),
      sourceFile,
      aircraftFilter: activeAircraftType || aircraftFilter,
      airportFilter,
      dimension,
      minimumFlights: dimension === "pilots" ? minFlights : 1,
      metric: chartMetric,
      metricLabel: chartMeta.label,
      metricUnit: chartMeta.unit,
      reportMetrics,
      selectedIds,
      rows: selectedRows,
      bins: multiHistogramBins(chartDistributions),
      series,
      baselineLabel,
    };
  };

  return (
    <div className="stats-panel">
      <div className="pilot-controls stats-controls">
        <label><span>Тип ВС</span>
          <select value={activeAircraftType} onChange={(event) => changeAircraftType(event.target.value)}>
            <option value="">Все типы</option>
            {aircraftTypes.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        </label>
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
          <SearchableSelect
            label={`Основной ${dimension === "pilots" ? "пилот" : "объект"}`}
            value={activePrimaryId}
            options={primaryOptions}
            onChange={changePrimary}
            placeholder={dimension === "pilots" ? "Введите ФИО или табельный номер" : "Введите название"}
            emptyText={dimension === "pilots" ? "Пилот не найден" : "Объект не найден"}
            disabled={!rows.length}
          />
          <SearchableSelect
            label="Добавить к сравнению"
            value=""
            options={comparisonOptions}
            onChange={addComparison}
            placeholder={selectedIds.length >= MAX_SERIES ? `Выбрано максимум: ${MAX_SERIES}` : "Начните вводить имя"}
            emptyText={dimension === "pilots" ? "Пилот не найден" : "Объект не найден"}
            disabled={!availableRows.length || selectedIds.length >= MAX_SERIES}
          />
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

      <section className="report-settings" aria-labelledby="report-settings-title">
        <div className="report-settings-head">
          <div><span>Состав выгрузки</span><strong id="report-settings-title">Показатели отчёта</strong><small>Отмеченные показатели попадут и в Excel, и в PDF.</small></div>
          <div><button type="button" onClick={() => setReportMetrics(metricDefinitions.map((item) => item.key))}>Выбрать все</button><button type="button" onClick={() => setReportMetrics([metric])}>Только на экране</button></div>
        </div>
        <div className="report-metric-grid">
          {metricDefinitions.map((item) => <label htmlFor={`report-metric-${item.key}`} key={item.key}>
            <input id={`report-metric-${item.key}`} aria-label={item.label} type="checkbox" checked={reportMetrics.includes(item.key)} onChange={() => toggleReportMetric(item.key)} />
            <span><strong>{item.label}</strong><small>{item.unit}</small></span>
          </label>)}
        </div>
      </section>

      <div className="export-row">
        <p className="note">В отчёт войдут текущие фильтры, выбранные участники и {reportMetrics.length} из {metricDefinitions.length} показателей. PDF сразу скачается готовым файлом.</p>
        <div className="export-actions">
          <button type="button" disabled={!selectedRows.length || !reportMetrics.length || Boolean(exporting)} onClick={async () => { setExporting("xlsx"); try { await downloadStatisticExcel(report()); } finally { setExporting(""); } }}>
            <span className="export-format-icon excel" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 10h17M3.5 14.75h17M10 4.5v15M15.25 10v9.5"/></svg>
            </span>
            {exporting === "xlsx" ? "Готовим Excel…" : "Excel"}
          </button>
          <button type="button" className="ghost" disabled={!selectedRows.length || !reportMetrics.length || Boolean(exporting)} onClick={async () => { setExporting("pdf"); try { await downloadStatisticPdf(report()); } finally { setExporting(""); } }}>
            <span className="export-format-icon pdf" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12.5h6M9 16h6"/></svg>
            </span>
            {exporting === "pdf" ? "Готовим PDF…" : "Скачать PDF"}
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
