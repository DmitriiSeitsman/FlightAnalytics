"use client";

import { useMemo, useState } from "react";
import { formatFlightDate, normalizeFlightDate, shortenPilotName, summarizeFlights, type Flight } from "./flight-data";
import { COLOR_LABELS, COLOR_STYLES } from "./events-analytics";
import { FlightDetailCard, type FlightTypeSummary } from "./flight-detail-card";
import { DeviationBadge } from "./deviations/badge";
import { detachmentConfig, deviationMatrix } from "./deviations/registry";
import { deviationSummary, displayDeviation, LEVEL_STYLES } from "./deviations/presentation";
import { ALL_BASES, buildSummaryTable, cellKey, collectDeviations, type DeviationEntry, type SummaryCell, type SummaryColumn } from "./deviations/summary";
import { commanderDetachment, flightBases } from "./deviations/detachments";
import { buildLevel4Report, downloadLevel4Excel, downloadLevel4Pdf } from "./deviations/report";

interface DeviationsViewProps {
  flights: Flight[];
  positions?: Map<string, "КВС" | "2П">;
  onSelectPilot?: (code: string, aircraftType: string) => void;
}

type LevelKey = "4" | "3" | "2" | "none";
const LEVEL_KEYS: LevelKey[] = ["4", "3", "2", "none"];
const LEVEL_LABELS: Record<LevelKey, string> = { "4": "4 уровень", "3": "3 уровень", "2": "2 уровень", none: "Без уровня" };
const NEUTRAL = { bg: "#f4f7f8", text: "#5d6b75", border: "#dbe3e7" };
const levelStyleOf = (key: LevelKey) => (key === "none" ? NEUTRAL : LEVEL_STYLES[Number(key) as 2 | 3 | 4]);
const levelKeyOf = (entry: DeviationEntry): LevelKey => (entry.classification.level === null ? "none" : (String(entry.classification.level) as LevelKey));

// В ячейке сводной таблицы основное число — рейсы, в подсказке — события.
function Cell({ cell }: { cell: SummaryCell }) {
  if (cell.flights === 0) return <td className="summary-zero">0</td>;
  const sameCount = cell.events === cell.flights;
  return (
    <td title={sameCount ? `${cell.flights} рейсов` : `${cell.flights} рейсов, ${cell.events} событий`}>
      <b>{cell.flights}</b>
      {!sameCount && <small> / {cell.events}</small>}
    </td>
  );
}

const BASE_COLUMNS: { key: string; label: string }[] = [...flightBases.map((base) => ({ key: base, label: base })), { key: ALL_BASES, label: "Все" }];

// Ячейки одной строки: по каждому типу ВС три базы, затем «всего по а/к».
function RowCells({ columns, cells }: { columns: SummaryColumn[]; cells: Map<string, SummaryCell> }) {
  return (
    <>
      {[...columns, { key: "total", label: "всего" }].flatMap((column) =>
        BASE_COLUMNS.map((base) => (
          <Cell key={cellKey(column.key, base.key)} cell={cells.get(cellKey(column.key, base.key)) ?? { flights: 0, events: 0 }} />
        )),
      )}
    </>
  );
}

export function DeviationsView({ flights, positions, onSelectPilot }: DeviationsViewProps) {
  const [selectedLevels, setSelectedLevels] = useState<LevelKey[]>([]);
  const [search, setSearch] = useState("");
  const [showEmptyRows, setShowEmptyRows] = useState(false);
  const [reportDetachment, setReportDetachment] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const perPage = 50;

  const typeSummaries = useMemo(
    () => new Map<string, FlightTypeSummary>(summarizeFlights(flights, "aircraftType").map((item) => [item.label, item])),
    [flights],
  );

  const entries = useMemo(() => {
    const collected = collectDeviations(flights, deviationMatrix);
    return collected.sort((left, right) => {
      const byLevel = (right.classification.level ?? 0) - (left.classification.level ?? 0);
      if (byLevel !== 0) return byLevel;
      return (normalizeFlightDate(right.flight.date) ?? "").localeCompare(normalizeFlightDate(left.flight.date) ?? "");
    });
  }, [flights]);

  const summary = useMemo(() => buildSummaryTable(flights, entries, detachmentConfig), [flights, entries]);

  const detachments = useMemo(() => {
    const found = new Set<string>();
    for (const flight of flights) {
      const detachment = commanderDetachment(flight.detachment ?? "");
      if (detachment) found.add(detachment);
    }
    return [...found].sort();
  }, [flights]);

  const level4Report = useMemo(
    () => buildLevel4Report(entries, { detachment: reportDetachment || null }),
    [entries, reportDetachment],
  );

  const levelStats = useMemo(() => {
    const counts = new Map<LevelKey, number>();
    for (const entry of entries) {
      const key = levelKeyOf(entry);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return LEVEL_KEYS.map((key) => ({ key, label: LEVEL_LABELS[key], count: counts.get(key) ?? 0, style: levelStyleOf(key) }));
  }, [entries]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    return entries.filter((entry) => {
      if (selectedLevels.length && !selectedLevels.includes(levelKeyOf(entry))) return false;
      if (!query) return true;
      const haystack = [
        entry.event.text,
        entry.classification.rule.name.ru,
        entry.flight.flightNumber,
        entry.flight.departure,
        entry.flight.arrival,
        ...entry.flight.crew.map((member) => `${member.name} ${member.code}`),
      ].join(" ").toLocaleLowerCase("ru-RU");
      return haystack.includes(query);
    });
  }, [entries, selectedLevels, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const page = Math.min(currentPage, totalPages);
  const visible = useMemo(() => filtered.slice((page - 1) * perPage, page * perPage), [filtered, page]);

  const toggleLevel = (key: LevelKey) => {
    setSelectedLevels((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
    setCurrentPage(1);
  };

  if (entries.length === 0) {
    return (
      <div className="events-analytics-empty">
        <p>Отклонений по матрице нормативов не найдено. Загрузите файл с событиями или проверьте, есть ли в выборке типы ВС с конфигом нормативов.</p>
      </div>
    );
  }

  return (
    <div className="deviations-view">
      <section className="deviation-summary">
        <div className="deviation-section-head">
          <div>
            <h3>Сводная таблица выявленных Отклонений</h3>
            <p className="note">
              Приложение № 5А инструкции. В ячейке — число рейсов с отклонением; если событий больше, второе число показывает их. База рейса — по лётному отряду командира.
            </p>
          </div>
          <label className="deviation-toggle">
            <input type="checkbox" checked={showEmptyRows} onChange={(event) => setShowEmptyRows(event.target.checked)} />
            <span>Показывать пустые строки</span>
          </label>
        </div>
        <div className="table-shell">
          <table className="summary-table">
            <thead>
              <tr>
                <th rowSpan={2}>Вид отклонения</th>
                <th rowSpan={2}>Уровень</th>
                {summary.columns.map((column) => <th key={column.key} colSpan={BASE_COLUMNS.length}>{column.label}</th>)}
                <th colSpan={BASE_COLUMNS.length}>всего по а/к</th>
              </tr>
              <tr>
                {[...summary.columns, { key: "total", label: "всего" }].flatMap((column) =>
                  BASE_COLUMNS.map((base) => <th key={cellKey(column.key, base.key)} className="summary-base">{base.label}</th>),
                )}
              </tr>
            </thead>
            <tbody>
              {summary.rows.filter((row) => showEmptyRows || row.total.flights > 0).map((row) => row.levels.map((levelRow, index) => (
                <tr key={`${row.row}-${levelRow.level}`} className={`${row.total.flights === 0 ? "summary-empty-row" : ""}${index === 0 ? " summary-group-start" : ""}`}>
                  {index === 0 && <th rowSpan={row.levels.length} className="summary-row-title">{row.row}</th>}
                  <td className="summary-level">
                    <span style={{ background: LEVEL_STYLES[levelRow.level].bg, color: LEVEL_STYLES[levelRow.level].text, borderColor: LEVEL_STYLES[levelRow.level].border }}>
                      {levelRow.level} уровень
                    </span>
                  </td>
                  <RowCells columns={summary.columns} cells={levelRow.cells} />
                </tr>
              )))}
              {summary.levelTotals.map((levelRow, index) => (
                <tr key={`total-${levelRow.level}`} className={`summary-total-row${index === 0 ? " summary-group-start" : ""}`}>
                  {index === 0 && <th rowSpan={summary.levelTotals.length} className="summary-row-title">Всего отклонений</th>}
                  <td className="summary-level">
                    <span style={{ background: LEVEL_STYLES[levelRow.level].bg, color: LEVEL_STYLES[levelRow.level].text, borderColor: LEVEL_STYLES[levelRow.level].border }}>
                      {levelRow.level} уровень
                    </span>
                  </td>
                  <RowCells columns={summary.columns} cells={levelRow.cells} />
                </tr>
              ))}
              {summary.extras.map((row) => (
                <tr key={row.label} className="summary-extra-row" title={row.hint}>
                  <th colSpan={2} className="summary-row-title">{row.label}</th>
                  <RowCells columns={summary.columns} cells={row.cells} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="method">
          Строки СДЭ, НПК и «Всего из ООПИ» бланка не заполняются: в выгрузке нет данных для них. Соответствие отрядов базам задано в config/detachments.json по структуре из CrewPlannerWeb: ЛО 1 и ЛО 5 — Санкт-Петербург, ЛО 2 и ЛО 4 — Москва. Рейсы прочих подразделений (ЛО 3, УТО, СЛТС, учебные АЭ) попадают только в колонку «Все».
        </p>
      </section>

      <section className="deviation-report">
        <div className="deviation-section-head">
          <div>
            <h3>Приложение № 5 — таблица учёта Отклонений 4 уровня</h3>
            <p className="note">
              Бланк со стр. 37 инструкции. Заполняются номер, дата и время полёта, номер рейса и характер отклонения; «Причина», «Выводы» и «Подпись ком. ЛО» остаются пустыми под руку.
            </p>
          </div>
        </div>
        <div className="deviation-report-controls">
          <label>
            <span>Лётный отряд</span>
            <select value={reportDetachment} onChange={(event) => setReportDetachment(event.target.value)}>
              <option value="">Все отряды</option>
              {detachments.map((detachment) => <option key={detachment} value={detachment}>{detachment}</option>)}
            </select>
          </label>
          <div className="deviation-report-summary">
            <span>В отчёте</span>
            <strong>{level4Report.rows.length} отклонений 4 уровня</strong>
          </div>
          <button type="button" className="pagination-button" onClick={() => void downloadLevel4Pdf(level4Report)}>Скачать PDF</button>
          <button type="button" className="pagination-button" onClick={() => void downloadLevel4Excel(level4Report)}>Скачать Excel</button>
        </div>
      </section>

      <section className="deviation-list">
        <h3>Отклонения · {filtered.length}</h3>
        <div className="events-stats-grid">
          {levelStats.map((stat) => {
            const isSelected = selectedLevels.includes(stat.key);
            const isDimmed = selectedLevels.length > 0 && !isSelected;
            return (
              <button
                key={stat.key}
                type="button"
                className={`event-stat-card${isSelected ? " event-stat-card-active" : ""}`}
                aria-pressed={isSelected}
                onClick={() => toggleLevel(stat.key)}
                style={{ background: stat.style.bg, borderColor: isSelected ? stat.style.text : stat.style.border, opacity: isDimmed ? 0.5 : 1 }}
              >
                <span style={{ color: stat.style.text }}>{stat.label}</span>
                <strong style={{ color: stat.style.text }}>{stat.count}</strong>
              </button>
            );
          })}
        </div>

        <div className="pilot-controls">
          <label>
            <span>Поиск</span>
            <input
              placeholder="Событие, норматив, рейс, аэропорт или пилот"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }}
            />
          </label>
        </div>

        {filtered.length === 0 ? (
          <p className="events-analytics-empty-filter">Нет отклонений, подходящих под фильтр.</p>
        ) : (
          <div className="table-shell">
            <table className="events-table deviations-table">
              <thead>
                <tr>
                  <th>Уровень</th>
                  <th>Цвет</th>
                  <th>Событие</th>
                  <th>Дата</th>
                  <th>Рейс</th>
                  <th>Маршрут</th>
                  <th>Экипаж</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const style = COLOR_STYLES[entry.event.color];
                  return (
                    <tr
                      key={entry.id}
                      className="deviation-row"
                      title="Открыть карточку рейса"
                      onClick={() => setSelectedFlight(entry.flight)}
                    >
                      <td><DeviationBadge display={displayDeviation(entry.classification)} /></td>
                      <td>
                        <span className="event-color-badge" style={{ background: style.bg, color: style.text, borderColor: style.border }}>
                          {COLOR_LABELS[entry.event.color]}
                        </span>
                      </td>
                      <td>
                        {entry.event.text}
                        <small className="deviation-rule">{deviationSummary(entry.classification)}</small>
                      </td>
                      <td>{formatFlightDate(entry.flight.date)}</td>
                      <td>{entry.flight.flightNumber || "—"}<small>{entry.flight.aircraftType}</small></td>
                      <td>{entry.flight.departure} → {entry.flight.arrival}</td>
                      <td>
                        {entry.flight.crew.length === 0 ? "—" : entry.flight.crew.map((member) => (
                          <small key={`${member.role}-${member.code}`} className="deviation-crew">
                            <b>{member.role}</b> {shortenPilotName(member.name)}
                            {positions?.get(`${member.code}:${entry.flight.aircraftType}`) ? ` (${positions.get(`${member.code}:${entry.flight.aircraftType}`)})` : ""}
                          </small>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="pagination">
            <button type="button" className="pagination-button" disabled={page === 1} onClick={() => setCurrentPage(page - 1)}>← Назад</button>
            <span className="pagination-info">Страница {page} из {totalPages}</span>
            <button type="button" className="pagination-button" disabled={page === totalPages} onClick={() => setCurrentPage(page + 1)}>Вперёд →</button>
          </div>
        )}
      </section>

      {selectedFlight && <FlightDetailCard
        flight={selectedFlight}
        onClose={() => setSelectedFlight(null)}
        positions={positions}
        typeSummary={typeSummaries.get(selectedFlight.aircraftType)}
        onSelectPilot={onSelectPilot && ((code, type) => { setSelectedFlight(null); onSelectPilot(code, type); })}
      />}
    </div>
  );
}
