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
type CrewMember = { code: string; name: string; role: "CM1" | "CM2" };
export type Flight = { key: string; aircraftType: string; departure: string; arrival: string; crew: CrewMember[]; metrics: Metrics; flightNumber: string; date: string; departureTime: string; arrivalTime: string; board: string; events: Event[] };

export type EventColor = "clRed" | "clOrange" | "clBlack" | "clGreen" | "clOlive" | "clFuchsia" | "unknown";
export type EventParameter = { name: string; max: string; min: string };
export type Event = {
  id: string;
  text: string;
  color: EventColor;
  pilotCode: string | null;
  pilotName: string | null;
  pilotRole: "CM1" | "CM2" | null;
  date: string;
  flightNumber: string;
  flightId: string;
  phase: string;
  duration: string;
  parameters: EventParameter[];
};
export type ImportResult = { 
  flights: Flight[]; 
  sourceRows: number; 
  duplicatesRemoved: number; 
  duplicateGroups: number;
  conflictingDuplicateGroups: number;
  routeConflictGroups: number;
  events: Event[];
  eventsMergeStats?: {
    mergedCount: number;
    unmergedCount: number;
    unmergedReasons: Map<string, number>;
  };
};

const validFlightDateKey = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export function normalizeFlightDate(value: string | null | undefined) {
  const source = value?.trim() ?? "";
  if (!source) return null;
  const russian = source.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
  if (russian) return validFlightDateKey(Number(russian[3]), Number(russian[2]), Number(russian[1]));
  const iso = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T|\s|$)/);
  if (iso) return validFlightDateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : validFlightDateKey(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

export function formatFlightDate(value: string | null | undefined) {
  const normalized = normalizeFlightDate(value);
  if (!normalized) return value?.trim() || "—";
  const [year, month, day] = normalized.split("-");
  return `${day}.${month}.${year}`;
}

// Приоритет "тяжести" цвета события при выборе главного цвета рейса:
// красный тяжелее оранжевого, тот тяжелее оливкового, затем чёрный, затем зелёный.
// Фиолетовый и неизвестный цвет явно не оговорены, поэтому идут последними.
export const EVENT_COLOR_SEVERITY: Record<EventColor, number> = {
  clRed: 1,
  clOrange: 2,
  clOlive: 3,
  clBlack: 4,
  clGreen: 5,
  clFuchsia: 6,
  unknown: 7,
};

export function worstEventColor(events: Event[]): EventColor | null {
  if (!events.length) return null;
  return events.reduce<EventColor>(
    (worst, event) => (EVENT_COLOR_SEVERITY[event.color] < EVENT_COLOR_SEVERITY[worst] ? event.color : worst),
    events[0].color
  );
}

export function summarizeEventColors(events: Event[], labels: Record<EventColor, string>): string {
  if (!events.length) return "";
  const counts = new Map<EventColor, number>();
  events.forEach((event) => counts.set(event.color, (counts.get(event.color) ?? 0) + 1));
  return [...counts.entries()]
    .sort(([left], [right]) => EVENT_COLOR_SEVERITY[left] - EVENT_COLOR_SEVERITY[right])
    .map(([color, count]) => `${labels[color]}: ${count}`)
    .join(", ");
}

const required = ["ID_Poleta", "Nazvanie_Aeroporta_Vzleta", "Nazvanie_Aeroporta_Posadki", "FIO_KVS", "Kod_KVS", "FIO_2P", "Kod_2P", "Bort", "Tip_VS", "Reys", "Data_Poleta", "Vremya_Vzleta", "Vremya_Posadki", "Tangazh_Pri_Otrive", "Eshelon_1", "Skorost_Vhoda_V_Glissadu", "Visota_Otklyucheniya_Avtopilota", "Rasstoyanie_proleta_ot_torca_VPP_do_kasaniya", "Vremya_proleta_ot_torca_VPP_do_kasaniya", "Vertikalnaya_Peregruzka_Na_Posadke", "Skorost_Viklyucheniya_Reversa"];
const eventsRequired = ["Text_Sobitiya", "Color", "Kod_KVS", "FIO_KVS", "Data_Poleta", "Reys"];
export const shortenPilotName = (fio: string): string => {
  const parts = fio.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const [surname, ...rest] = parts;
  const initials = rest.map((part) => `${part.charAt(0).toLocaleUpperCase("ru-RU")}.`).join("");
  return initials ? `${surname} ${initials}` : surname;
};
const text = (value: unknown): string => { if (value == null) return ""; if (value instanceof Date) return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value); if (typeof value === "object") { const item = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> }; if (item.text !== undefined) return text(item.text); if (item.result !== undefined) return text(item.result); if (item.richText) return item.richText.map((part) => text(part.text)).join("").trim(); } return String(value).trim(); };
const number = (value: unknown) => { if (typeof value === "number") return Number.isFinite(value) ? value : null; const source = text(value); const parsed = Number(source.replace(/\s/g, "").replace(",", ".")); return source && Number.isFinite(parsed) ? parsed : null; };
const presentNumbers = (values: Array<number | null>) => values.filter((item): item is number => item !== null && Number.isFinite(item));
// Самое частое значение среди дублирующихся строк одного рейса (например, аэропорт или тип ВС),
// с устойчивым порядком при равенстве счётчиков — побеждает то, что встретилось раньше.
const mostCommonValue = <T,>(values: T[]): T => {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
  return best;
};
const average = (values: Array<number | null>) => { const present = presentNumbers(values); return present.length ? present.reduce((sum, item) => sum + item, 0) / present.length : null; };
const minimum = (values: Array<number | null>) => { const present = presentNumbers(values); return present.length ? Math.min(...present) : null; };
const maximum = (values: Array<number | null>) => { const present = presentNumbers(values); return present.length ? Math.max(...present) : null; };
const median = (values: Array<number | null>) => {
  const present = presentNumbers(values).sort((left, right) => left - right);
  if (!present.length) return null;
  const middle = Math.floor(present.length / 2);
  return present.length % 2 ? present[middle] : (present[middle - 1] + present[middle]) / 2;
};
const uniqueAverage = (values: Array<number | null>) => average([...new Set(values.filter((item): item is number => item !== null))]);
// Заглавная буква нужна не только в начале строки, но и после дефиса/пробела/скобки —
// иначе "Санкт-Петербург" после общего понижения регистра превращался в "Санкт-петербург".
// Соединительные частицы в топонимах ("Ростов-на-Дону", "Комсомольск-на-Амуре") по-русски
// пишутся со строчной буквы — не капитализируем их отдельно.
const AIRPORT_LOWERCASE_WORDS = new Set(["на", "по", "им"]);
const airport = (value: unknown) => {
  const clean = text(value).replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
  if (!clean) return "Не указан";
  return clean.replace(/[^\s(-]+/g, (word) => (AIRPORT_LOWERCASE_WORDS.has(word) ? word : word.charAt(0).toLocaleUpperCase("ru-RU") + word.slice(1)));
};
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
// Времена считаются совместимыми, если совпадают или отсутствуют в одной из строк:
// в выгрузке время вылета бывает пустым у части строк одного и того же рейса.
const timesCompatible = (left: string, right: string) => !left || !right || left === right;
const flightIdentity = (row: SheetRow) => {
  const parts = [row.Data_Poleta, row.Vremya_Vzleta, row.Vremya_Posadki, row.Reys, row.Bort].map((item) => text(item).toLocaleLowerCase("ru-RU"));
  if (parts.filter(Boolean).length < 4) return null;
  const [date, departure, arrival, flightNumber, board] = parts;
  return { bucket: [date, flightNumber, board].join("|"), departure, arrival };
};
type FlightCluster = { key: string; departure: string; arrival: string; rows: SheetRow[] };
const firstFilled = (group: SheetRow[], key: string) => { for (const row of group) { const value = text(row[key]); if (value) return value; } return ""; };

// Один рейс — это строки с одинаковыми датой, номером и бортом, у которых времена не
// противоречат друг другу. Строки с разным непустым временем остаются разными рейсами.
function groupFlightRows(rows: SheetRow[]) {
  const buckets = new Map<string, FlightCluster[]>();
  const clusters: FlightCluster[] = [];
  rows.forEach((row, index) => {
    if (!Object.values(row).some((value) => text(value))) return;
    const identity = flightIdentity(row);
    if (!identity) {
      clusters.push({ key: `row:${text(row.ID_Poleta) || index + 2}`, departure: "", arrival: "", rows: [row] });
      return;
    }
    const bucket = buckets.get(identity.bucket) ?? [];
    const match = bucket.find((cluster) => timesCompatible(cluster.departure, identity.departure) && timesCompatible(cluster.arrival, identity.arrival));
    if (match) {
      match.rows.push(row);
      if (!match.departure) match.departure = identity.departure;
      if (!match.arrival) match.arrival = identity.arrival;
      return;
    }
    const created: FlightCluster = { key: identity.bucket, departure: identity.departure, arrival: identity.arrival, rows: [row] };
    bucket.push(created);
    buckets.set(identity.bucket, bucket);
    clusters.push(created);
  });
  return clusters.map((cluster): [string, SheetRow[]] => [
    cluster.key.startsWith("row:") ? cluster.key : `${cluster.key}|${cluster.departure}|${cluster.arrival}`,
    cluster.rows,
  ]);
}
const crew = (rows: SheetRow[]) => { const members = new Map<string, CrewMember>(); for (const row of rows) for (const [role, nameKey, codeKey] of [["CM1", "FIO_KVS", "Kod_KVS"], ["CM2", "FIO_2P", "Kod_2P"]] as const) { const name = text(row[nameKey]); const code = text(row[codeKey]); if (name && code) members.set(`${role}:${code}`, { role, name, code }); } return [...members.values()]; };

export function parseEventRows(rows: SheetRow[], headers: string[]): Event[] {
  const missing = eventsRequired.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`В файле событий не найдены обязательные столбцы: ${missing.join(", ")}`);

  // Группируем строки по ID_Sobitiya
  const eventGroups = new Map<string, SheetRow[]>();
  rows.forEach((row) => {
    const eventId = text(row.ID_Sobitiya);
    if (eventId) {
      if (!eventGroups.has(eventId)) {
        eventGroups.set(eventId, []);
      }
      eventGroups.get(eventId)!.push(row);
    }
  });
  
  const events: Event[] = [];
  
  // Обрабатываем каждую группу как одно событие
  eventGroups.forEach((groupRows, eventId) => {
    const firstRow = groupRows[0];
    const eventText = text(firstRow.Text_Sobitiya);
    const rawColor = text(firstRow.Color);
    
    // Пропускаем строки без события
    if (!eventText || !rawColor || rawColor === "null") return;
    
    // Безопасное определение цвета
    const color: EventColor = ["clRed", "clOrange", "clBlack", "clGreen", "clOlive", "clFuchsia"].includes(rawColor) 
      ? rawColor as EventColor 
      : "unknown";
    
    const kodKVS = text(firstRow.Kod_KVS);
    const fioKVS = text(firstRow.FIO_KVS);
    const date = text(firstRow.Data_Poleta);
    const reys = text(firstRow.Reys);

    // Табельный номер и ФИО пилота берём из Kod_KVS/FIO_KVS: колонка Imya_Personala
    // содержит идентификатор оператора/аналитика, а не пилота, и не совпадает
    // с табельными номерами КВС/2П ни в одной строке реальных выгрузок.
    const pilotCode: string | null = kodKVS || null;
    const pilotName: string | null = fioKVS || null;
    const pilotRole: "CM1" | "CM2" | null = kodKVS ? "CM1" : null;
    
    // Собираем все параметры из всех строк группы
    const parameters: EventParameter[] = [];
    groupRows.forEach((row) => {
      if (row.Parametr_1) {
        parameters.push({
          name: text(row.Parametr_1),
          max: text(row.Max_Parametera_1),
          min: text(row.Min_Parametera_1)
        });
      }
      if (row.Parametr_2) {
        parameters.push({
          name: text(row.Parametr_2),
          max: text(row.Max_Parametera_2),
          min: text(row.Min_Parametera_2)
        });
      }
    });
    
    events.push({
      id: eventId,
      text: eventText,
      color,
      pilotCode,
      pilotName,
      pilotRole,
      date,
      flightNumber: reys,
      flightId: text(firstRow.ID_Poleta_1) || text(firstRow.ID_Poleta),
      phase: text(firstRow.Faza_Nachala_Sobitiya),
      duration: text(firstRow.Dlitelnost_Sobitiya),
      parameters
    });
  });
  
  return events;
}

export function mergeEventsWithFlights(flights: Flight[], events: Event[]): { 
  flights: Flight[]; 
  mergedCount: number; 
  unmergedCount: number;
  unmergedReasons: Map<string, number>;
} {
  // Создаем индексы для быстрого поиска
  const flightIndex = new Map<string, Flight[]>();
  
  // Индекс по дате + номеру рейса (основной ключ)
  flights.forEach((flight) => {
    const key = `${flight.date}-${flight.flightNumber}`;
    if (!flightIndex.has(key)) {
      flightIndex.set(key, []);
    }
    flightIndex.get(key)!.push(flight);
  });
  
  // Создаем копии рейсов с пустыми массивами событий
  const flightsWithEvents = flights.map(flight => ({ ...flight, events: [] as Event[] }));
  
  let mergedCount = 0;
  let unmergedCount = 0;
  const unmergedReasons = new Map<string, number>();
  
  const addUnmergedReason = (reason: string) => {
    unmergedReasons.set(reason, (unmergedReasons.get(reason) || 0) + 1);
  };
  
  // Распределяем события по рейсам с использованием индекса
  events.forEach((event) => {
    const eventKey = `${event.date}-${event.flightNumber}`;
    const candidateFlights = flightIndex.get(eventKey);
    
    if (!candidateFlights || candidateFlights.length === 0) {
      addUnmergedReason("Рейс не найден по дате и номеру");
      unmergedCount++;
      return;
    }
    
    // Если несколько кандидатов, уточняем по борту или пилоту
    let matchedFlight: Flight | null = null;
    
    if (candidateFlights.length === 1) {
      matchedFlight = candidateFlights[0];
    } else {
      // Несколько рейсов с той же датой и номером - уточняем
      for (const flight of candidateFlights) {
        // Проверяем по пилоту в экипаже
        if (event.pilotCode && event.pilotRole) {
          const pilotInCrew = flight.crew.some(
            (member) => member.code === event.pilotCode && member.role === event.pilotRole
          );
          if (pilotInCrew) {
            matchedFlight = flight;
            break;
          }
        }
        
        // Если пилот не определен, используем другие критерии
        if (!matchedFlight && event.flightId) {
          if (String(flight.key) === event.flightId || flight.key.includes(event.flightId)) {
            matchedFlight = flight;
            break;
          }
        }
      }
      
      // Если всё равно не нашли, берём первый кандидат
      if (!matchedFlight) {
        matchedFlight = candidateFlights[0];
        addUnmergedReason("Несколько кандидатов, выбран первый");
      }
    }
    
    if (matchedFlight) {
      // Находим соответствующий рейс в flightsWithEvents
      const targetFlight = flightsWithEvents.find(f => 
        f.key === matchedFlight!.key && 
        f.date === matchedFlight!.date && 
        f.flightNumber === matchedFlight!.flightNumber
      );
      
      if (targetFlight) {
        // Проверяем пилота, если он указан в событии
        if (event.pilotCode && event.pilotRole) {
          const pilotInCrew = targetFlight.crew.some(
            (member) => member.code === event.pilotCode && member.role === event.pilotRole
          );
          
          if (pilotInCrew) {
            targetFlight.events.push(event);
            mergedCount++;
          } else {
            addUnmergedReason("Пилот не в экипаже");
            unmergedCount++;
          }
        } else {
          // Событие без пилота - добавляем к рейсу
          targetFlight.events.push(event);
          mergedCount++;
        }
      } else {
        addUnmergedReason("Рейс не найден в целевом массиве");
        unmergedCount++;
      }
    } else {
      addUnmergedReason("Рейс не найден");
      unmergedCount++;
    }
  });
  
  return {
    flights: flightsWithEvents,
    mergedCount,
    unmergedCount,
    unmergedReasons
  };
}

export function parseFlightRows(rows: SheetRow[], headers: string[]): ImportResult {
  const missing = required.filter((header) => !headers.includes(header)); if (missing.length) throw new Error(`В файле не найдены обязательные столбцы: ${missing.join(", ")}`);
  const groups = groupFlightRows(rows);
  let duplicateGroups = 0; let conflicts = 0; let routeConflicts = 0;
  const flights = groups.map(([key, group]): Flight => {
    if (group.length > 1) duplicateGroups += 1;
    const rowMetrics = group.map(metrics);
    if (group.length > 1 && metricDefinitions.some(({ key: metric }) => new Set(rowMetrics.map((item) => item[metric]).filter((item) => item !== null)).size > 1)) conflicts += 1;
    // Аэропорты и тип ВС не входят в ключ группировки, поэтому у "сдвоенных" строк одного рейса
    // они могут разойтись (опечатка, запасной аэродром и т.п.). Берём самое частое значение по
    // группе, а не значение из representative — она выбрана по полноте метрик и может случайно
    // указывать на неверный маршрут.
    const departureValues = group.map((row) => airport(row.Nazvanie_Aeroporta_Vzleta));
    const arrivalValues = group.map((row) => airport(row.Nazvanie_Aeroporta_Posadki));
    const aircraftTypeValues = group.map((row) => aircraftType(row.Tip_VS));
    if (group.length > 1 && (new Set(departureValues).size > 1 || new Set(arrivalValues).size > 1 || new Set(aircraftTypeValues).size > 1)) routeConflicts += 1;
    return {
      key,
      aircraftType: mostCommonValue(aircraftTypeValues),
      departure: mostCommonValue(departureValues),
      arrival: mostCommonValue(arrivalValues),
      crew: crew(group),
      metrics: Object.fromEntries(metricDefinitions.map(({ key: metric }) => [metric, uniqueAverage(rowMetrics.map((item) => item[metric]))])) as Metrics,
      // Опознавательные поля берём по первому непустому значению в группе: у части строк
      // одного рейса время вылета пустое, и representative выбран по полноте метрик.
      flightNumber: firstFilled(group, "Reys"),
      date: firstFilled(group, "Data_Poleta"),
      departureTime: firstFilled(group, "Vremya_Vzleta"),
      arrivalTime: firstFilled(group, "Vremya_Posadki"),
      board: firstFilled(group, "Bort"),
      events: [],
    };
  });
  return { flights, sourceRows: rows.length, duplicatesRemoved: rows.length - flights.length, duplicateGroups, conflictingDuplicateGroups: conflicts, routeConflictGroups: routeConflicts, events: [] };
}
const metricSet = (items: Flight[]) => {
  const values = (key: FlightMetricKey) => items.map((item) => item.metrics[key]);
  return {
    metrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, average(values(key))])) as Metrics,
    minMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, minimum(values(key))])) as Metrics,
    medianMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, median(values(key))])) as Metrics,
    maxMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, maximum(values(key))])) as Metrics,
  };
};

export type Summary = { label: string; flights: number; metrics: Metrics; minMetrics: Metrics; medianMetrics: Metrics; maxMetrics: Metrics };
export function summarizeFlights(flights: Flight[], groupBy: "aircraftType" | "departure" | "arrival"): Summary[] {
  const groups = new Map<string, Flight[]>();
  flights.forEach((flight) => groups.set(flight[groupBy], [...(groups.get(flight[groupBy]) ?? []), flight]));
  return [...groups].map(([label, items]) => ({ label, flights: items.length, ...metricSet(items) })).sort((a, b) => {
    const flightDiff = b.flights - a.flights;
    if (flightDiff !== 0) return flightDiff;
    
    const labelA = String(a.label || "");
    const labelB = String(b.label || "");
    return labelA.localeCompare(labelB, "ru");
  });
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
  medianMetrics: Metrics;
  maxMetrics: Metrics;
  baselineMetrics: Metrics;
  position?: "КВС" | "2П";
};

export function buildStatisticRows(flights: Flight[], dimension: StatDimension, minFlights = 1, positions: Map<string, "КВС" | "2П"> = new Map()): StatisticRow[] {
  if (dimension === "pilots") {
    return summarizePilots(flights, positions).filter((pilot) => pilot.flights >= minFlights).map((pilot) => ({
      id: `${pilot.role}:${pilot.code}:${pilot.aircraftType}`,
      label: pilot.name,
      position: pilot.position,
      subtitle: `${pilot.position} · ${pilot.role} · ${pilot.code} · ${pilot.aircraftType}`,
      flights: pilot.flights,
      metrics: pilot.metrics,
      minMetrics: pilot.minMetrics,
      medianMetrics: pilot.medianMetrics,
      maxMetrics: pilot.maxMetrics,
      baselineMetrics: pilot.typeMetrics,
    }));
  }
  const baselineMetrics = metricSet(flights).metrics;
  return summarizeFlights(flights, dimension).map((row) => ({
    id: row.label,
    label: row.label,
    subtitle: "",
    flights: row.flights,
    metrics: row.metrics,
    minMetrics: row.minMetrics,
    medianMetrics: row.medianMetrics,
    maxMetrics: row.maxMetrics,
    baselineMetrics,
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

export function collectMetricSeries(flights: Flight[], dimension: StatDimension, ids: string[], metric: FlightMetricKey) {
  const series = Object.fromEntries(ids.map((id) => [id, [] as number[]])) as Record<string, number[]>;
  for (const flight of flights) {
    const value = flight.metrics[metric];
    if (value === null) continue;
    for (const id of ids) {
      const match = dimension === "pilots"
        ? flight.crew.some((member) => `${member.role}:${member.code}:${flight.aircraftType}` === id)
        : flight[dimension] === id;
      if (match) series[id].push(value);
    }
  }
  return series;
}

const niceStep = (span: number, bins: number) => {
  const raw = span / Math.max(1, bins);
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const residual = raw / magnitude;
  const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return nice * magnitude;
};

export type HistogramBin = { from: number; to: number; selected: number; others: number };
export type MultiHistogramBin = { from: number; to: number; counts: Record<string, number> };

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

export function multiHistogramBins(series: Record<string, number[]>, binCount = 8): MultiHistogramBin[] {
  const entries = Object.entries(series);
  const all = entries.flatMap(([, values]) => values);
  if (!all.length) return [];
  const min = Math.min(...all);
  const max = Math.max(...all);
  if (min === max) return [{ from: min, to: max, counts: Object.fromEntries(entries.map(([id, values]) => [id, values.length])) }];
  const step = niceStep(max - min, binCount);
  const start = Math.floor(min / step) * step;
  const end = Math.max(start + step, Math.ceil(max / step) * step);
  const count = Math.max(1, Math.round((end - start) / step));
  const bins: MultiHistogramBin[] = Array.from({ length: count }, (_, index) => ({
    from: start + index * step,
    to: start + (index + 1) * step,
    counts: Object.fromEntries(entries.map(([id]) => [id, 0])),
  }));
  for (const [id, values] of entries) for (const value of values) {
    const index = Math.min(count - 1, Math.max(0, Math.floor((value - start) / step)));
    bins[index].counts[id] += 1;
  }
  return bins;
}
export function derivePositions(flights: Flight[]): Map<string, "КВС" | "2П"> {
  const positions = new Map<string, "КВС" | "2П">();
  for (const flight of flights) {
    for (const member of flight.crew) {
      const key = `${member.code}:${flight.aircraftType}`;
      if (member.role === "CM1") positions.set(key, "КВС");
      else if (!positions.has(key)) positions.set(key, "2П");
    }
  }
  return positions;
}
export type PilotSummary = {
  code: string;
  name: string;
  role: CrewMember["role"];
  aircraftType: string;
  flights: number;
  metrics: Metrics;
  minMetrics: Metrics;
  medianMetrics: Metrics;
  maxMetrics: Metrics;
  typeMetrics: Metrics;
  typeMinMetrics: Metrics;
  typeMaxMetrics: Metrics;
  position: "КВС" | "2П";
};
export function summarizePilots(flights: Flight[], positions: Map<string, "КВС" | "2П">): PilotSummary[] {
  const groups = new Map<string, { member: CrewMember; aircraftType: string; flights: Flight[] }>();
  for (const flight of flights) for (const member of flight.crew) {
    const key = `${member.role}:${member.code}:${flight.aircraftType}`;
    const group = groups.get(key) ?? { member, aircraftType: flight.aircraftType, flights: [] };
    group.flights.push(flight);
    groups.set(key, group);
  }
  const baselines = new Map(summarizeFlights(flights, "aircraftType").map((item) => [item.label, item]));
  return [...groups.values()].map(({ member, aircraftType, flights: items }) => {
    const values = (key: FlightMetricKey) => items.map((item) => item.metrics[key]);
    return {
      ...member,
      aircraftType,
      flights: items.length,
      metrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, average(values(key))])) as Metrics,
      minMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, minimum(values(key))])) as Metrics,
      medianMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, median(values(key))])) as Metrics,
      maxMetrics: Object.fromEntries(metricDefinitions.map(({ key }) => [key, maximum(values(key))])) as Metrics,
      typeMetrics: baselines.get(aircraftType)!.metrics,
      typeMinMetrics: baselines.get(aircraftType)!.minMetrics,
      typeMaxMetrics: baselines.get(aircraftType)!.maxMetrics,
      position: positions.get(`${member.code}:${aircraftType}`) ?? "2П",
    };
  }).sort((a, b) => {
    const flightDiff = b.flights - a.flights;
    if (flightDiff !== 0) return flightDiff;
    
    const nameA = String(a.name || "");
    const nameB = String(b.name || "");
    return nameA.localeCompare(nameB, "ru");
  });
}

export type PilotRow = {
  code: string;
  name: string;
  position: "КВС" | "2П";
  aircraftType: string;
  totalFlights: number;
  summaries: Partial<Record<"CM1" | "CM2", PilotSummary>>;
};

export function groupPilotRows(pilots: PilotSummary[]): PilotRow[] {
  const groups = new Map<string, PilotRow>();
  for (const pilot of pilots) {
    const key = `${pilot.code}:${pilot.aircraftType}`;
    const row = groups.get(key) ?? {
      code: pilot.code,
      name: pilot.name,
      position: pilot.position,
      aircraftType: pilot.aircraftType,
      totalFlights: 0,
      summaries: {},
    };
    row.summaries[pilot.role] = pilot;
    row.totalFlights += pilot.flights;
    groups.set(key, row);
  }
  return [...groups.values()].sort((a, b) => {
    const flightDiff = b.totalFlights - a.totalFlights;
    if (flightDiff !== 0) return flightDiff;
    return a.name.localeCompare(b.name, "ru");
  });
}
