"use client";

import { useMemo, useRef, useState } from "react";
import { formatMetric, metricDefinitions, parseFlightRows, parseEventRows, mergeEventsWithFlights, summarizeFlights, summarizePilots, type FlightMetricKey, type ImportResult, type SheetRow, type PilotSummary } from "./flight-data";
import { StatisticsView } from "./statistics-view";
import { PilotCard } from "./pilot-card";
import { EventsAnalytics } from "./events-analytics";
import { FlightsView } from "./flights-view";

type View = "aircraftType" | "departure" | "arrival" | "flights" | "pilots" | "statistics" | "events";
type SortDirection = "asc" | "desc";
type ImportProgress = { progress: number; title: string; detail: string };
type SummarySortKey = "label" | "flights" | FlightMetricKey;
type PilotSortKey = "name" | "role" | "aircraftType" | "flights" | "ownMin" | "own" | "ownMax" | "baseline" | "delta";
type SortRule<Key extends string> = { key: Key; direction: SortDirection };

function SortLabel({ label, unit, active, direction, priority, onToggleActive, onToggleDirection }: { label: string; unit?: string; active: boolean; direction: SortDirection; priority?: number; onToggleActive: () => void; onToggleDirection: () => void }) {
  return <div className={`sort-label${active ? " active" : ""}`}>
    <label><input type="checkbox" checked={active} onChange={onToggleActive} /><span>{label}{unit && <small>{unit}</small>}</span></label>
    {active && <span className="sort-priority" title={`Приоритет сортировки: ${priority}`}>{priority}</span>}
    <button className="sort-arrow" type="button" disabled={!active} onClick={onToggleDirection} aria-label={`Изменить направление сортировки: ${label}`}>{active ? direction === "asc" ? "↑" : "↓" : "↕"}</button>
  </div>;
}

const compareValues = (left: string | number | null, right: string | number | null, direction: SortDirection) => {
  if (left === null) return 1;
  if (right === null) return -1;
  const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "ru");
  return direction === "asc" ? result : -result;
};
export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const eventsInputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [eventsFileName, setEventsFileName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [view, setView] = useState<View>("aircraftType");
  const [aircraftType, setAircraftType] = useState("");
  const [airport, setAirport] = useState("");
  const [pilotMetric, setPilotMetric] = useState<FlightMetricKey>("landingNy");
  const [pilotSearch, setPilotSearch] = useState("");
  const [minimumFlights, setMinimumFlights] = useState(3);
  const [summarySort, setSummarySort] = useState<Array<SortRule<SummarySortKey>>>([{ key: "flights", direction: "desc" }]);
  const [pilotSort, setPilotSort] = useState<Array<SortRule<PilotSortKey>>>([{ key: "flights", direction: "desc" }]);
  const [selectedPilot, setSelectedPilot] = useState<PilotSummary | null>(null);

  const importFile = async (file: File) => {
    const showProgress = async (progress: ImportProgress) => {
      setImportProgress(progress);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    setLoading(true); setError(""); setFileName(file.name);
    try {
      await showProgress({ progress: 8, title: "Подготавливаем файл", detail: "Проверяем формат и размер отчёта" });
      if (!file.name.toLocaleLowerCase("ru-RU").endsWith(".xlsx")) throw new Error("Выберите файл Excel в формате .xlsx.");
      const ExcelJS = await import("exceljs");
      await showProgress({ progress: 24, title: "Читаем Excel", detail: "Открываем книгу и первый лист" });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer() as never);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("В книге нет листа с данными.");
      await showProgress({ progress: 48, title: "Собираем строки", detail: `Найдено строк: ${Math.max(0, sheet.rowCount - 1).toLocaleString("ru-RU")}` });
      const headers: string[] = [];
      sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { headers[column - 1] = String(cell.text || cell.value || "").trim(); });
      const rows: SheetRow[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const item: SheetRow = {};
        headers.forEach((header, index) => { if (header) item[header] = row.getCell(index + 1).value; });
        rows.push(item);
      });
      await showProgress({ progress: 72, title: "Убираем дубли", detail: "Объединяем сдвоенные записи одного рейса" });
      const parsed = parseFlightRows(rows, headers);
      await showProgress({ progress: 91, title: "Считаем статистику", detail: "Готовим показатели по ВС, аэропортам и пилотам" });
      setResult(parsed); setAircraftType(""); setAirport("");
      await showProgress({ progress: 100, title: "Готово", detail: `${parsed.flights.length.toLocaleString("ru-RU")} уникальных рейсов` });
      await new Promise((resolve) => setTimeout(resolve, 450));
    } catch (caught) {
      setResult(null); setError(caught instanceof Error ? caught.message : "Не удалось прочитать файл.");
    } finally {
      setLoading(false); setImportProgress(null); if (inputRef.current) inputRef.current.value = "";
    }
  };

  const importEventsFile = async (file: File) => {
    if (!result) {
      setError("Сначала загрузите основной файл с рейсами");
      return;
    }
    
    const showProgress = async (progress: ImportProgress) => {
      setImportProgress(progress);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    
    setLoading(true); setError(""); setEventsFileName(file.name);
    try {
      await showProgress({ progress: 8, title: "Подготавливаем файл событий", detail: "Проверяем формат и размер файла" });
      if (!file.name.toLocaleLowerCase("ru-RU").endsWith(".xlsx")) throw new Error("Выберите файл Excel в формате .xlsx.");
      
      const ExcelJS = await import("exceljs");
      await showProgress({ progress: 24, title: "Читаем Excel событий", detail: "Открываем книгу и первый лист" });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer() as never);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("В книге нет листа с данными.");
      
      await showProgress({ progress: 48, title: "Собираем события", detail: `Найдено строк: ${Math.max(0, sheet.rowCount - 1).toLocaleString("ru-RU")}` });
      const headers: string[] = [];
      sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { headers[column - 1] = String(cell.text || cell.value || "").trim(); });
      
      const rows: SheetRow[] = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const item: SheetRow = {};
        headers.forEach((header, index) => { if (header) item[header] = row.getCell(index + 1).value; });
        rows.push(item);
      });
      
      await showProgress({ progress: 72, title: "Парсим события", detail: "Извлекаем данные о событиях" });
      const events = parseEventRows(rows, headers);
      
      await showProgress({ progress: 85, title: "Объединяем с рейсами", detail: "Сопоставляем события с рейсами по дате и номеру" });
      const mergeResult = mergeEventsWithFlights(result.flights, events);
      
      await showProgress({ progress: 100, title: "Готово", detail: `${mergeResult.mergedCount.toLocaleString("ru-RU")} событий объединено, ${mergeResult.unmergedCount.toLocaleString("ru-RU")} не объединено` });
      setResult({ 
        ...result, 
        flights: mergeResult.flights, 
        events,
        eventsMergeStats: {
          mergedCount: mergeResult.mergedCount,
          unmergedCount: mergeResult.unmergedCount,
          unmergedReasons: mergeResult.unmergedReasons
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 450));
    } catch (caught) {
      console.error("Error importing events:", caught);
      // Не удаляем основной результат при ошибке событий
      setError(caught instanceof Error ? caught.message : "Не удалось прочитать файл событий.");
    } finally {
      setLoading(false); setImportProgress(null); if (eventsInputRef.current) eventsInputRef.current.value = "";
    }
  };

  const aircraftTypes = useMemo(() => [...new Set(result?.flights.map((item) => item.aircraftType) ?? [])].sort(), [result]);
  const airports = useMemo(() => [...new Set(result?.flights.flatMap((item) => [item.departure, item.arrival]) ?? [])].sort(), [result]);
  const flights = useMemo(() => (result?.flights ?? []).filter((flight) => (!aircraftType || flight.aircraftType === aircraftType) && (!airport || flight.departure === airport || flight.arrival === airport)), [aircraftType, airport, result]);
  const summaries = useMemo(() => view === "pilots" || view === "statistics" || view === "events" || view === "flights" ? [] : summarizeFlights(flights, view), [flights, view]);
  const pilots = useMemo(() => summarizePilots(flights).filter((pilot) => pilot.flights >= minimumFlights && (!pilotSearch || `${pilot.name} ${pilot.code}`.toLocaleLowerCase("ru-RU").includes(pilotSearch.toLocaleLowerCase("ru-RU")))), [flights, minimumFlights, pilotSearch]);
  const selectedMetric = metricDefinitions.find((item) => item.key === pilotMetric)!;
  const sortedSummaries = useMemo(() => [...summaries].sort((left, right) => {
    for (const rule of summarySort) {
      const leftValue = rule.key === "label" || rule.key === "flights" ? left[rule.key] : left.metrics[rule.key];
      const rightValue = rule.key === "label" || rule.key === "flights" ? right[rule.key] : right.metrics[rule.key];
      const result = compareValues(leftValue, rightValue, rule.direction);
      if (result !== 0) return result;
    }
    return 0;
  }), [summaries, summarySort]);
  const sortedPilots = useMemo(() => [...pilots].sort((left, right) => {
    const value = (pilot: typeof left, key: PilotSortKey) => {
      if (["name", "role", "aircraftType", "flights"].includes(key)) return pilot[key as "name" | "role" | "aircraftType" | "flights"];
      const own = pilot.metrics[pilotMetric];
      const baseline = pilot.typeMetrics[pilotMetric];
      if (key === "ownMin") return pilot.minMetrics[pilotMetric];
      if (key === "own") return own;
      if (key === "ownMax") return pilot.maxMetrics[pilotMetric];
      if (key === "baseline") return baseline;
      return own !== null && baseline !== null ? own - baseline : null;
    };
    for (const rule of pilotSort) {
      const result = compareValues(value(left, rule.key), value(right, rule.key), rule.direction);
      if (result !== 0) return result;
    }
    return 0;
  }), [pilotMetric, pilots, pilotSort]);
  const toggleSummaryActive = (key: SummarySortKey) => setSummarySort((current) => current.some((rule) => rule.key === key) ? current.filter((rule) => rule.key !== key) : [...current, { key, direction: key === "label" ? "asc" : "desc" }]);
  const togglePilotActive = (key: PilotSortKey) => setPilotSort((current) => current.some((rule) => rule.key === key) ? current.filter((rule) => rule.key !== key) : [...current, { key, direction: ["name", "role", "aircraftType"].includes(key) ? "asc" : "desc" }]);
  const toggleSummaryDirection = (key: SummarySortKey) => setSummarySort((current) => current.map((rule) => rule.key === key ? { ...rule, direction: rule.direction === "asc" ? "desc" : "asc" } : rule));
  const togglePilotDirection = (key: PilotSortKey) => setPilotSort((current) => current.map((rule) => rule.key === key ? { ...rule, direction: rule.direction === "asc" ? "desc" : "asc" } : rule));

  return <main>
    <header className="hero">
      <div className="brand"><span>FA</span><strong>Flight Analytics</strong></div>
      <div className="hero-copy"><p className="eyebrow">Аналитика лётных данных</p><h1>Загрузите статистику<br />из Excel-файла</h1><p>Загрузите отчёт RegularInfoReport. Сервис уберёт сдвоенные рейсы, сравнит пилотов, аэродромы и типы ВС на гистограммах и подготовит выгрузку в Excel или PDF.</p></div>
      <div className="privacy"><span>●</span><div><strong>Данные остаются у вас</strong><small>Файл обрабатывается только в браузере</small></div></div>
    </header>
    <section className="workspace">
      <button className="upload" type="button" disabled={loading} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void importFile(file); }}>
        <span className={`upload-icon${loading ? " loading" : ""}`}>{loading ? <span className="mini-spinner" /> : "↥"}</span><span><strong>{loading ? importProgress?.title ?? "Обрабатываем файл…" : result ? "Загрузить другой файл" : "Перетащите Excel сюда"}</strong><small>{fileName || "или нажмите, чтобы выбрать .xlsx"}</small></span>
      </button>
      <input ref={inputRef} className="hidden-input" type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
      
      {result && result.events.length === 0 && (
        <button className="upload upload-secondary" type="button" disabled={loading} onClick={() => eventsInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void importEventsFile(file); }}>
          <span className="upload-icon">📋</span><span><strong>Загрузить файл событий</strong><small>{eventsFileName || "или перетащите Excel с событиями"}</small></span>
        </button>
      )}
      
      {result && result.eventsMergeStats && (
        <div className="events-merge-stats">
          <span>Статистика объединения:</span>
          <div>
            <strong>{result.eventsMergeStats.mergedCount}</strong> объединено
          </div>
          <div>
            <strong>{result.eventsMergeStats.unmergedCount}</strong> не объединено
          </div>
          {result.eventsMergeStats.unmergedReasons.size > 0 && (
            <div className="unmerged-reasons">
              <span>Причины:</span>
              {Array.from(result.eventsMergeStats.unmergedReasons.entries()).map(([reason, count]) => (
                <span key={reason}>{reason}: {count}</span>
              ))}
            </div>
          )}
        </div>
      )}
      <input ref={eventsInputRef} className="hidden-input" type="file" accept=".xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importEventsFile(file); }} />
      {loading && importProgress && <div className="processing" role="status" aria-live="polite" aria-label={`${importProgress.title}: ${importProgress.progress}%`}>
        <div className="processing-visual" aria-hidden="true"><span className="processing-ring" /><strong>{importProgress.progress}%</strong></div>
        <div className="processing-copy"><div><span>Обработка отчёта</span><strong>{importProgress.title}</strong><small>{importProgress.detail}</small></div><div className="processing-percent">{importProgress.progress}%</div>
          <div className="progress-track"><span style={{ width: `${importProgress.progress}%` }} /></div>
          <ol>{["Чтение файла", "Проверка данных", "Удаление дублей", "Расчёт статистики"].map((step, index) => <li className={importProgress.progress >= [24, 48, 72, 91][index] ? "done" : importProgress.progress >= [8, 24, 48, 72][index] ? "active" : ""} key={step}><i>{importProgress.progress >= [24, 48, 72, 91][index] ? "✓" : index + 1}</i>{step}</li>)}</ol>
        </div>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}

      {!result ? (!loading ? <div className="feature-grid">
        <article className="feature-card"><div className="feature-top"><span>01</span><i>Подготовка данных</i></div><h2>Как сравниваем</h2><p>Повторяющиеся строки одного рейса объединяем по дате, времени, номеру рейса и борту. В итоговой статистике каждый рейс учитывается один раз.</p><div className="feature-rule"><b>1 рейс</b><span>→</span><b>1 запись</b></div></article>
        <article className="feature-card metrics-card"><div className="feature-top"><span>02</span><i>Параметры полёта</i></div><h2>Что анализируем</h2><ul className="metric-list"><li>Тангаж на отрыве</li><li>Эшелон полёта</li><li>Вход в глиссаду</li><li>Отключение автопилота</li><li>Расстояние до касания</li><li>Время до касания</li><li>Ny на посадке</li><li>Выключение реверса</li></ul></article>
        <article className="feature-card"><div className="feature-top"><span>03</span><i>Персональная статистика</i></div><h2>Что сравниваем</h2><p>Для каждого пилота считаем минимум, среднее и максимум по выбранному элементу и сопоставляем среднее со средним на его типе ВС — с учётом фильтров и минимального числа рейсов.</p><div className="comparison-flow"><b>Мин / среднее / макс</b><span>↔</span><b>Среднее типа ВС</b></div></article>
      </div> : null) : <>
        <div className="result-strip"><div><span>Исходных строк</span><strong>{result.sourceRows.toLocaleString("ru-RU")}</strong></div><div><span>Уникальных рейсов</span><strong>{result.flights.length.toLocaleString("ru-RU")}</strong></div><div><span>Устранено дублей</span><strong>{result.duplicatesRemoved.toLocaleString("ru-RU")}</strong></div><p>{result.conflictingDuplicateGroups > 0 ? `В ${result.conflictingDuplicateGroups} группах дублей расхождения усреднены.` : "Расхождений внутри дублей не найдено."}</p></div>
        <div className="filters">
          <label><span>Тип ВС</span><select value={aircraftType} onChange={(event) => setAircraftType(event.target.value)}><option value="">Все типы</option>{aircraftTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Аэропорт маршрута</span><select value={airport} onChange={(event) => setAirport(event.target.value)}><option value="">Все аэропорты</option>{airports.map((item) => <option key={item}>{item}</option>)}</select></label>
          <div><span>В выборке</span><strong>{flights.length.toLocaleString("ru-RU")} рейсов</strong></div>
        </div>
        <nav className="tabs" aria-label="Разрез аналитики">{([["aircraftType", "Типы ВС"], ["departure", "Аэродромы взлёта"], ["arrival", "Аэродромы посадки"], ["flights", "Рейсы"], ["pilots", "Пилоты"], ["statistics", "Статистика"], ...(result?.events && result.events.length > 0 ? [["events", "События"] as [View, string]] : [])] as Array<[View, string]>).map(([key, label]) => <button type="button" className={view === key ? "active" : ""} key={key} onClick={() => setView(key)}>{label}</button>)}</nav>
        {view !== "statistics" && view !== "flights" && <p className="sort-help">Отметьте галочками нужные столбцы. Цифры показывают порядок сортировки; стрелка меняет направление.<span className="mobile-table-hint">↔ Проведите по таблице влево, чтобы увидеть остальные столбцы.</span></p>}
        {view === "statistics" ? <StatisticsView flights={flights} sourceFile={fileName} aircraftFilter={aircraftType} airportFilter={airport} /> : view === "events" ? <EventsAnalytics flights={flights} events={result?.events || []} aircraftFilter={aircraftType} airportFilter={airport} /> : view === "flights" ? <FlightsView flights={flights} /> : view === "pilots" ? <>
          <div className="pilot-controls"><label><span>Показатель</span><select value={pilotMetric} onChange={(event) => setPilotMetric(event.target.value as FlightMetricKey)}>{metricDefinitions.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label><label><span>Поиск пилота</span><input placeholder="ФИО или табельный номер" value={pilotSearch} onChange={(event) => setPilotSearch(event.target.value)} /></label><label><span>Минимум рейсов</span><input type="number" min="1" value={minimumFlights} onChange={(event) => setMinimumFlights(Math.max(1, Number(event.target.value) || 1))} /></label></div>
          <p className="note">В форме нет признака пилотирующего пилота (PF), поэтому показаны рейсы, где пилот входил в состав экипажа. Нажмите на строку пилота для просмотра детальной информации.</p>
          <div className="table-shell"><table className="pilot-table"><thead><tr>
            {([['name', 'Пилот'], ['role', 'Роль'], ['aircraftType', 'Тип ВС'], ['flights', 'Рейсов'], ['ownMin', 'Мин. пилота'], ['own', 'Среднее пилота'], ['ownMax', 'Макс. пилота'], ['baseline', 'Среднее типа'], ['delta', 'Разница']] as Array<[PilotSortKey, string]>).map(([key, label]) => {
              const rule = pilotSort.find((item) => item.key === key);
              return <th key={key} aria-sort={pilotSort[0]?.key === key ? pilotSort[0].direction === "asc" ? "ascending" : "descending" : "none"}><SortLabel label={label} active={Boolean(rule)} direction={rule?.direction ?? "desc"} priority={pilotSort.findIndex((item) => item.key === key) + 1} onToggleActive={() => togglePilotActive(key)} onToggleDirection={() => togglePilotDirection(key)} /></th>;
            })}
          </tr></thead><tbody>{sortedPilots.map((pilot) => { const own = pilot.metrics[pilotMetric]; const ownMin = pilot.minMetrics[pilotMetric]; const ownMax = pilot.maxMetrics[pilotMetric]; const baseline = pilot.typeMetrics[pilotMetric]; const delta = own !== null && baseline !== null ? own - baseline : null; return <tr key={`${pilot.role}-${pilot.code}-${pilot.aircraftType}`} className="pilot-row" onClick={() => setSelectedPilot(pilot)}><th>{pilot.name}<small>{pilot.code}</small></th><td>{pilot.role}</td><td>{pilot.aircraftType}</td><td>{pilot.flights}</td><td>{formatMetric(ownMin, pilotMetric, true)}</td><td>{formatMetric(own, pilotMetric, true)}</td><td>{formatMetric(ownMax, pilotMetric, true)}</td><td>{formatMetric(baseline, pilotMetric, true)}</td><td className="delta">{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta.toLocaleString("ru-RU", { maximumFractionDigits: selectedMetric.digits })} ${selectedMetric.unit}`}</td></tr>; })}</tbody></table></div>
          {selectedPilot && <PilotCard pilot={selectedPilot} flights={flights} onClose={() => setSelectedPilot(null)} />}
        </> : <div className="table-shell"><table><thead><tr>
          <th aria-sort={summarySort[0]?.key === "label" ? summarySort[0].direction === "asc" ? "ascending" : "descending" : "none"}><SortLabel label={view === "aircraftType" ? "Тип ВС" : "Аэродром"} active={summarySort.some((item) => item.key === "label")} direction={summarySort.find((item) => item.key === "label")?.direction ?? "asc"} priority={summarySort.findIndex((item) => item.key === "label") + 1} onToggleActive={() => toggleSummaryActive("label")} onToggleDirection={() => toggleSummaryDirection("label")} /></th>
          <th aria-sort={summarySort[0]?.key === "flights" ? summarySort[0].direction === "asc" ? "ascending" : "descending" : "none"}><SortLabel label="Рейсов" active={summarySort.some((item) => item.key === "flights")} direction={summarySort.find((item) => item.key === "flights")?.direction ?? "desc"} priority={summarySort.findIndex((item) => item.key === "flights") + 1} onToggleActive={() => toggleSummaryActive("flights")} onToggleDirection={() => toggleSummaryDirection("flights")} /></th>
          {metricDefinitions.map((item) => {
            const rule = summarySort.find((sortItem) => sortItem.key === item.key);
            return <th key={item.key} aria-sort={summarySort[0]?.key === item.key ? summarySort[0].direction === "asc" ? "ascending" : "descending" : "none"}><SortLabel label={item.shortLabel} unit={item.unit} active={Boolean(rule)} direction={rule?.direction ?? "desc"} priority={summarySort.findIndex((sortItem) => sortItem.key === item.key) + 1} onToggleActive={() => toggleSummaryActive(item.key)} onToggleDirection={() => toggleSummaryDirection(item.key)} /></th>;
          })}
        </tr></thead><tbody>{sortedSummaries.map((row) => <tr key={row.label}><th>{row.label}</th><td>{row.flights.toLocaleString("ru-RU")}</td>{metricDefinitions.map((item) => <td key={item.key}>{formatMetric(row.metrics[item.key], item.key)}</td>)}</tr>)}</tbody></table></div>}
        <p className="method">Эшелон полёта — среднее заполненных значений BD–BK. Пустые значения исключаются. Дубли определяются по дате, времени, номеру рейса и борту.</p>
      </>}
    </section>
  </main>;
}
