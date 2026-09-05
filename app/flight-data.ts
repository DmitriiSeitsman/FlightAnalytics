export const metricDefinitions = [
  { key: "takeoffPitch", label: "Тангаж на отрыве", shortLabel: "Тангаж", unit: "°", digits: 2 },
  { key: "flightLevel", label: "Эшелон полёта", shortLabel: "Эшелон", unit: "ft", digits: 0 },
  { key: "glideslopeEntrySpeed", label: "Скорость входа в глиссаду", shortLabel: "Вход в глиссаду", unit: "уз", digits: 1 },
  { key: "autopilotDisconnectHeight", label: "Высота отключения автопилота", shortLabel: "Откл. АП", unit: "ft", digits: 0 },
  { key: "touchdownDistance", label: "Пролёт от торца до касания", shortLabel: "До касания", unit: "м", digits: 0 },
  { key: "thresholdToTouchdownTime", label: "Время от торца до касания", shortLabel: "Время", unit: "с", digits: 1 },
  { key: "landingNy", label: "Ny на посадке", shortLabel: "Ny", unit: "g", digits: 3 },
  { key: "reverseOffSpeed", label: "Скорость выключения реверса", shortLabel: "Реверс выкл.", unit: "уз", digits: 1 },
] as const;
export type FlightMetricKey = typeof metricDefinitions[number]["key"];
export type Metrics = Record<FlightMetricKey, number | null>;
export type SheetRow = Record<string, unknown>;
type CrewMember = { code: string; name: string; role: "КВС" | "2П" };
export type Flight = { key: string; aircraftType: string; departure: string; arrival: string; crew: CrewMember[]; metrics: Metrics };
export type ImportResult = { flights: Flight[]; sourceRows: number; duplicatesRemoved: number; duplicateGroups: number; conflictingDuplicateGroups: number };

const required = ["ID_Poleta", "Nazvanie_Aeroporta_Vzleta", "Nazvanie_Aeroporta_Posadki", "FIO_KVS", "Kod_KVS", "FIO_2P", "Kod_2P", "Bort", "Tip_VS", "Reys", "Data_Poleta", "Vremya_Vzleta", "Vremya_Posadki", "Tangazh_Pri_Otrive", "Eshelon_1", "Skorost_Vhoda_V_Glissadu", "Visota_Otklyucheniya_Avtopilota", "Rasstoyanie_proleta_ot_torca_VPP_do_kasaniya", "Vremya_proleta_ot_torca_VPP_do_kasaniya", "Vertikalnaya_Peregruzka_Na_Posadke", "Skorost_Viklyucheniya_Reversa"];
const text = (value: unknown): string => { if (value == null) return ""; if (value instanceof Date) return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value); if (typeof value === "object") { const item = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> }; if (item.text !== undefined) return text(item.text); if (item.result !== undefined) return text(item.result); if (item.richText) return item.richText.map((part) => text(part.text)).join("").trim(); } return String(value).trim(); };
const number = (value: unknown) => { if (typeof value === "number") return Number.isFinite(value) ? value : null; const source = text(value); const parsed = Number(source.replace(/\s/g, "").replace(",", ".")); return source && Number.isFinite(parsed) ? parsed : null; };
const presentNumbers = (values: Array<number | null>) => values.filter((item): item is number => item !== null && Number.isFinite(item));
const average = (values: Array<number | null>) => { const present = presentNumbers(values); return present.length ? present.reduce((sum, item) => sum + item, 0) / present.length : null; };
const minimum = (values: Array<number | null>) => { const present = presentNumbers(values); return present.length ? Math.min(...present) : null; };
const maximum = (values: Array<number | null>) => { const present = presentNumbers(values); return present.length ? Math.max(...present) : null; };
const uniqueAverage = (values: Array<number | null>) => average([...new Set(values.filter((item): item is number => item !== null))]);
const airport = (value: unknown) => { const clean = text(value).replace(/\s+/g, " ").toLocaleLowerCase("ru-RU"); return clean ? clean.charAt(0).toLocaleUpperCase("ru-RU") + clean.slice(1) : "Не указан"; };
const aircraftType = (value: unknown) => {
  const source = text(value);
  const normalized = source.toLocaleLowerCase("ru-RU").replace(/[\s_-]+/g, "");
  if (/^(airbus|a)(319|320)/.test(normalized)) return "A-319/320";
  if (/^(boeing|b)737/.test(normalized)) return "B-737";
  if (/^(boeing|b)777/.test(normalized)) return "B-777";
  if (/^(rrj95|ssj100)/.test(normalized)) return "RRJ-95";
  return source || "Не указан";
};
const metrics = (row: SheetRow): Metrics => ({ takeoffPitch: number(row.Tangazh_Pri_Otrive), flightLevel: average(Array.from({ length: 8 }, (_, index) => number(row[`Eshelon_${index + 1}`]))), glideslopeEntrySpeed: number(row.Skorost_Vhoda_V_Glissadu), autopilotDisconnectHeight: number(row.Visota_Otklyucheniya_Avtopilota), touchdownDistance: number(row.Rasstoyanie_proleta_ot_torca_VPP_do_kasaniya), thresholdToTouchdownTime: number(row.Vremya_proleta_ot_torca_VPP_do_kasaniya), landingNy: number(row.Vertikalnaya_Peregruzka_Na_Posadke), reverseOffSpeed: number(row.Skorost_Viklyucheniya_Reversa) });
const flightKey = (row: SheetRow, index: number) => { const parts = [row.Data_Poleta, row.Vremya_Vzleta, row.Vremya_Posadki, row.Reys, row.Bort].map((item) => text(item).toLocaleLowerCase("ru-RU")); return parts.filter(Boolean).length >= 4 ? parts.join("|") : `row:${text(row.ID_Poleta) || index}`; };
const crew = (rows: SheetRow[]) => { const members = new Map<string, CrewMember>(); for (const row of rows) for (const [role, nameKey, codeKey] of [["КВС", "FIO_KVS", "Kod_KVS"], ["2П", "FIO_2P", "Kod_2P"]] as const) { const name = text(row[nameKey]); const code = text(row[codeKey]); if (name && code) members.set(`${role}:${code}`, { role, name, code }); } return [...members.values()]; };

export function parseFlightRows(rows: SheetRow[], headers: string[]): ImportResult {
  const missing = required.filter((header) => !headers.includes(header)); if (missing.length) throw new Error(`В файле не найдены обязательные столбцы: ${missing.join(", ")}`);
  const groups = new Map<string, SheetRow[]>(); rows.forEach((row, index) => { if (!Object.values(row).some((value) => text(value))) return; const key = flightKey(row, index + 2); groups.set(key, [...(groups.get(key) ?? []), row]); });
  let duplicateGroups = 0; let conflicts = 0;
  const flights = [...groups.entries()].map(([key, group]): Flight => { if (group.length > 1) duplicateGroups += 1; const rowMetrics = group.map(metrics); if (group.length > 1 && metricDefinitions.some(({ key: metric }) => new Set(rowMetrics.map((item) => item[metric]).filter((item) => item !== null)).size > 1)) conflicts += 1; const representative = group.reduce((best, row) => Object.values(metrics(row)).filter((item) => item !== null).length > Object.values(metrics(best)).filter((item) => item !== null).length ? row : best); return { key, aircraftType: aircraftType(representative.Tip_VS), departure: airport(representative.Nazvanie_Aeroporta_Vzleta), arrival: airport(representative.Nazvanie_Aeroporta_Posadki), crew: crew(group), metrics: Object.fromEntries(metricDefinitions.map(({ key: metric }) => [metric, uniqueAverage(rowMetrics.map((item) => item[metric]))])) as Metrics }; });
  return { flights, sourceRows: rows.length, duplicatesRemoved: rows.length - flights.length, duplicateGroups, conflictingDuplicateGroups: conflicts };
}
const metricSet = (items: Flight[]) => {
  const values = (key: FlightMetricKey) => items.map((item) => item.metrics[key]);
  return {
    metrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, average(values(key))])) as Metrics,
    minMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, minimum(values(key))])) as Metrics,
    maxMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, maximum(values(key))])) as Metrics,
  };
};

export type Summary = { label: string; flights: number; metrics: Metrics; minMetrics: Metrics; maxMetrics: Metrics };
export function summarizeFlights(flights: Flight[], groupBy: "aircraftType" | "departure" | "arrival"): Summary[] {
  const groups = new Map<string, Flight[]>();
  flights.forEach((flight) => groups.set(flight[groupBy], [...(groups.get(flight[groupBy]) ?? []), flight]));
  return [...groups].map(([label, items]) => ({ label, flights: items.length, ...metricSet(items) })).sort((a, b) => b.flights - a.flights || a.label.localeCompare(b.label, "ru"));
}

export function formatMetric(value: number | null, key: FlightMetricKey, withUnit = false) {
  if (value === null) return "—";
  const metric = metricDefinitions.find((item) => item.key === key)!;
  const formatted = value.toLocaleString("ru-RU", { minimumFractionDigits: metric.digits, maximumFractionDigits: metric.digits });
  return withUnit ? `${formatted} ${metric.unit}` : formatted;
}

export type StatDimension = "aircraftType" | "departure" | "arrival" | "pilots";
export const statDimensionLabels: Record<StatDimension, string> = {
  aircraftType: "Типы ВС",
  departure: "Аэродромы взлёта",
  arrival: "Аэродромы посадки",
  pilots: "Пилоты",
};

export type StatisticRow = {
  id: string;
  label: string;
  subtitle: string;
  flights: number;
  metrics: Metrics;
  minMetrics: Metrics;
  maxMetrics: Metrics;
};

export function buildStatisticRows(flights: Flight[], dimension: StatDimension, minFlights = 1): StatisticRow[] {
  if (dimension === "pilots") {
    return summarizePilots(flights).filter((pilot) => pilot.flights >= minFlights).map((pilot) => ({
      id: `${pilot.role}:${pilot.code}:${pilot.aircraftType}`,
      label: pilot.name,
      subtitle: `${pilot.role} · ${pilot.code} · ${pilot.aircraftType}`,
      flights: pilot.flights,
      metrics: pilot.metrics,
      minMetrics: pilot.minMetrics,
      maxMetrics: pilot.maxMetrics,
    }));
  }
  return summarizeFlights(flights, dimension).map((row) => ({
    id: row.label,
    label: row.label,
    subtitle: "",
    flights: row.flights,
    metrics: row.metrics,
    minMetrics: row.minMetrics,
    maxMetrics: row.maxMetrics,
  }));
}

export function collectMetricValues(flights: Flight[], dimension: StatDimension, id: string, metric: FlightMetricKey) {
  const selected: number[] = [];
  const others: number[] = [];
  for (const flight of flights) {
    const value = flight.metrics[metric];
    if (value === null) continue;
    const match = dimension === "pilots"
      ? flight.crew.some((member) => `${member.role}:${member.code}:${flight.aircraftType}` === id)
      : flight[dimension] === id;
    (match ? selected : others).push(value);
  }
  return { selected, others };
}

const niceStep = (span: number, bins: number) => {
  const raw = span / Math.max(1, bins);
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const residual = raw / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return nice * magnitude;
};

export type HistogramBin = { from: number; to: number; selected: number; others: number };

export function histogramBins(selected: number[], others: number[], binCount = 8): HistogramBin[] {
  const all = [...selected, ...others];
  if (!all.length) return [];
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (min === max) return [{ from: min, to: max, selected: selected.length, others: others.length }];
  const step = niceStep(max - min, binCount);
  const start = Math.floor(min / step) * step;
  const end = Math.max(start + step, Math.ceil(max / step) * step);
  const count = Math.max(1, Math.round((end - start) / step));
  const bins: HistogramBin[] = Array.from({ length: count }, (_, index) => ({
    from: start + index * step,
    to: start + (index + 1) * step,
    selected: 0,
    others: 0,
  }));
  const place = (value: number, key: "selected" | "others") => {
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - start) / step)));
    bins[index][key] += 1;
  };
  selected.forEach((value) => place(value, "selected"));
  others.forEach((value) => place(value, "others"));
  return bins;
}
export type PilotSummary = {
  code: string;
  name: string;
  role: CrewMember["role"];
  aircraftType: string;
  flights: number;
  metrics: Metrics;
  minMetrics: Metrics;
  maxMetrics: Metrics;
  typeMetrics: Metrics;
};
export function summarizePilots(flights: Flight[]): PilotSummary[] {
  const groups = new Map<string, { member: CrewMember; aircraftType: string; flights: Flight[] }>();
  for (const flight of flights) for (const member of flight.crew) {
    const key = `${member.role}:${member.code}:${flight.aircraftType}`;
    const group = groups.get(key) ?? { member, aircraftType: flight.aircraftType, flights: [] };
    group.flights.push(flight);
    groups.set(key, group);
  }
  const baselines = new Map(summarizeFlights(flights, "aircraftType").map((item) => [item.label, item.metrics]));
  return [...groups.values()].map(({ member, aircraftType, flights: items }) => {
    const values = (key: FlightMetricKey) => items.map((item) => item.metrics[key]);
    return {
      ...member,
      aircraftType,
      flights: items.length,
      metrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, average(values(key))])) as Metrics,
      minMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, minimum(values(key))])) as Metrics,
      maxMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, maximum(values(key))])) as Metrics,
      typeMetrics: baselines.get(aircraftType)!,
    };
  }).sort((a, b) => b.flights - a.flights || a.name.localeCompare(b.name, "ru"));
}
