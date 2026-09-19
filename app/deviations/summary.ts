// Сводная таблица выявленных Отклонений — приложение № 5А инструкции (стр. 38).
// Строки формы фиксированы (summaryRows), колонки — типы ВС так, как они названы
// в бланке: 738, 773, 744, A-319/320, RRJ-95, каждый в разрезе МСК / СПБ / Все.
// База рейса определяется по лётному отряду командира (config/detachments.json).
import { classifyEventAll, type DeviationClassification } from "./classify.ts";
import { summaryRows, type DeviationLevel, type DeviationMatrix, type SummaryRow } from "./config.ts";
import { deviationLevels } from "./config.ts";
import { baseOfDetachment, flightBases, type DetachmentConfig, type FlightBase } from "./detachments.ts";
import type { Event, Flight } from "../flight-data.ts";

export type DeviationEntry = {
  id: string;
  flight: Flight;
  event: Event;
  classification: DeviationClassification;
};

// Одно событие может отвечать двум нормативам, поэтому записей бывает больше, чем событий.
// Сводные события источника («Предупреждение GPWS (уровень Caution)») выбрасываются,
// если в том же рейсе есть конкретное сообщение того же вида: инструкция нормирует
// именно конкретные, и считать оба — значит посчитать одно отклонение дважды.
export function collectDeviations(flights: Flight[], matrix: DeviationMatrix): DeviationEntry[] {
  const entries: DeviationEntry[] = [];
  for (const flight of flights) {
    const collected: DeviationEntry[] = [];
    for (const event of flight.events ?? []) {
      for (const classification of classifyEventAll(event, flight.aircraftType, matrix)) {
        collected.push({ id: `${event.id}:${classification.rule.key}`, flight, event, classification });
      }
    }
    const kindOf = (entry: DeviationEntry) => entry.classification.rule.summaryRow ?? `категория:${entry.classification.rule.category}`;
    const specific = new Set(collected.filter((entry) => !entry.classification.rule.aggregate).map(kindOf));
    for (const entry of collected) {
      if (entry.classification.rule.aggregate && specific.has(kindOf(entry))) continue;
      entries.push(entry);
    }
  }
  return entries;
}

// Порядок колонок — не как в бланке, а как удобно смотреть: A-319/320 и RRJ-95
// слева, потому что по ним основной парк и основная работа с отклонениями.
export const aircraftColumns = [
  { key: "a319320", label: "A-319/320", pattern: /a-?3(19|20)|airbus3(19|20)/ },
  { key: "rrj95", label: "RRJ-95", pattern: /rrj/ },
  { key: "738", label: "738", pattern: /737/ },
  { key: "773", label: "773", pattern: /777/ },
  { key: "744", label: "744", pattern: /747/ },
] as const;
export const OTHER_COLUMN = "other";

// Тип ВС из выгрузки → колонка бланка. Всё, что не опознано, идёт в «прочие».
export function aircraftColumnOf(aircraftType: string): string {
  const normalized = (aircraftType ?? "").toLowerCase().replace(/[\s_]+/g, "");
  for (const column of aircraftColumns) {
    if (column.pattern.test(normalized)) return column.key;
  }
  return OTHER_COLUMN;
}

// В ячейке два числа: по рейсам и по событиям. Один рейс может дать несколько
// событий одного норматива (проверка управления пишется на каждую поверхность),
// поэтому основным считаем число рейсов.
export type SummaryCell = { flights: number; events: number };
export type SummaryColumn = { key: string; label: string };
// Ключ ячейки внутри строки: «колонка типа ВС : база», где база — МСК, СПБ или «все».
export const ALL_BASES = "all";
export const cellKey = (column: string, base: string) => `${column}:${base}`;
export type SummaryLevelRow = { level: DeviationLevel; cells: Map<string, SummaryCell>; total: SummaryCell };
export type SummaryTableRow = { row: SummaryRow; levels: SummaryLevelRow[]; total: SummaryCell };
export type SummaryExtraRow = { label: string; hint: string; cells: Map<string, SummaryCell>; total: SummaryCell };
export type SummaryTable = {
  columns: SummaryColumn[];
  rows: SummaryTableRow[];
  levelTotals: SummaryLevelRow[];
  extras: SummaryExtraRow[];
  flights: number;
};

type Counter = { flightKeys: Set<string>; events: number };

function emptyCell(): SummaryCell {
  return { flights: 0, events: 0 };
}

function toCell(counter: Counter | undefined): SummaryCell {
  return counter ? { flights: counter.flightKeys.size, events: counter.events } : emptyCell();
}

function count(counters: Map<string, Counter>, key: string, flightKey: string): void {
  const counter = counters.get(key) ?? { flightKeys: new Set<string>(), events: 0 };
  counter.flightKeys.add(flightKey);
  counter.events += 1;
  counters.set(key, counter);
}

export function buildSummaryTable(flights: Flight[], entries: DeviationEntry[], detachments: DetachmentConfig): SummaryTable {
  const baseByFlight = new Map<string, FlightBase | null>(flights.map((flight) => [flight.key, baseOfDetachment(flight.detachment ?? "", detachments)]));
  const present = new Set(flights.map((flight) => aircraftColumnOf(flight.aircraftType)));
  const columns: SummaryColumn[] = aircraftColumns
    .filter((column) => present.has(column.key))
    .map((column) => ({ key: column.key, label: column.label }));
  if (present.has(OTHER_COLUMN)) columns.push({ key: OTHER_COLUMN, label: "прочие" });

  // Ключ счётчика — «строка бланка | уровень | колонка : база».
  const counters = new Map<string, Counter>();
  const key = (row: string, level: string, column: string, base: string) => `${row}|${level}|${cellKey(column, base)}`;

  // Одно попадание считается в четырёх местах: своя колонка и «всего по а/к»,
  // каждая — в своей базе и в «Все».
  const tally = (row: string, level: string, flight: Flight) => {
    const column = aircraftColumnOf(flight.aircraftType);
    const base = baseByFlight.get(flight.key) ?? null;
    for (const target of [column, "total"]) {
      count(counters, key(row, level, target, ALL_BASES), flight.key);
      if (base) count(counters, key(row, level, target, base), flight.key);
    }
  };

  for (const entry of entries) {
    const { summaryRow } = entry.classification.rule;
    const level = entry.classification.level;
    if (level !== null && summaryRow !== null) {
      tally(summaryRow, String(level), entry.flight);
      tally("*", String(level), entry.flight);
    }
    if (level !== null && summaryRow === null) tally("#outside", "-", entry.flight);
    if (entry.classification.reason === "manual-review") tally("#manual", "-", entry.flight);
  }

  // Уходы на 2-й круг — отдельные строки бланка, нормативом они не являются.
  for (const flight of flights) {
    for (const event of flight.events ?? []) {
      if (!/уход на 2/i.test(event.text ?? "")) continue;
      tally("#goaround", "-", flight);
    }
  }

  const bases: string[] = [...flightBases, ALL_BASES];
  const cellsOf = (row: string, level: string) =>
    new Map(columns.flatMap((column) => bases.map((base) => [cellKey(column.key, base), toCell(counters.get(key(row, level, column.key, base)))] as const)));
  const totalsOf = (row: string, level: string) =>
    new Map(bases.map((base) => [cellKey("total", base), toCell(counters.get(key(row, level, "total", base)))] as const));

  const levelRows = (row: string): SummaryLevelRow[] =>
    deviationLevels.map((level) => ({
      level,
      cells: new Map([...cellsOf(row, String(level)), ...totalsOf(row, String(level))]),
      total: toCell(counters.get(key(row, String(level), "total", ALL_BASES))),
    }));

  const rows: SummaryTableRow[] = summaryRows.map((row) => {
    const levels = levelRows(row);
    return {
      row,
      levels,
      total: levels.reduce<SummaryCell>((sum, item) => ({ flights: sum.flights + item.total.flights, events: sum.events + item.total.events }), emptyCell()),
    };
  });

  const extra = (row: string, label: string, hint: string): SummaryExtraRow => ({
    label,
    hint,
    cells: new Map([...cellsOf(row, "-"), ...totalsOf(row, "-")]),
    total: toCell(counters.get(key(row, "-", "total", ALL_BASES))),
  });

  return {
    columns,
    rows,
    levelTotals: levelRows("*"),
    extras: [
      extra("#manual", "Требуют ручной оценки", "Норматив нашёлся, но уровень по выгрузке не определить: он задан длительностью превышения или разницей с расчётной скоростью."),
      extra("#outside", "Вне строк приложения 5А", "Отклонение с уровнем, для которого в бланке сводной таблицы нет своей строки."),
      extra("#goaround", "Уходы на 2-ой круг", "Считаются по событиям выгрузки, нормативом не являются."),
    ],
    flights: flights.length,
  };
}
