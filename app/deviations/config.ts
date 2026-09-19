// Матрица отклонений: типы данных, разбор и проверка конфигов.
//
// Нормативы (И-04.02-28-24, приложение № 6) в код не зашиты: они лежат в
// config/deviations/<тип>.json — один файл на тип ВС. Чтобы добавить тип или
// поправить порог, правится только JSON. config/deviations/schema.json нужна
// редактору для подсказок; обязательная проверка выполняется здесь.

export const deviationLevels = [2, 3, 4] as const;
export type DeviationLevel = (typeof deviationLevels)[number];

export const compareOperators = ["greater", "greaterOrEqual", "less", "lessOrEqual"] as const;
export type CompareOperator = (typeof compareOperators)[number];

export const deviationCategories = ["Speed", "Attitude", "Roll", "Acceleration", "VerticalRate", "Alignment", "Configuration", "Warning", "Caution", "Engine", "Procedure", "DualInput", "Other"] as const;
export type DeviationCategory = (typeof deviationCategories)[number];

// Строки сводной таблицы приложения № 5А, дословно как в инструкции (стр. 38).
// Правило либо попадает в одну из этих строк, либо не попадает в сводку вовсе (null).
export const summaryRows = [
  "повышенная перегрузка при посадке Ny",
  "повышенный тангаж \u0398\u00b0 на взлёте",
  "повышенный тангаж \u0398\u00b0 на посадке",
  "крен (Roll\u00b0) более допустимого",
  "отклонение по скорости (Vcom, Vgr)",
  "повышенная вертикальная скорость Vy",
  "конфигурация",
  "оповещение",
  "двойное управление",
  "повышенные поперечная/продольная перегрузки Nz/Nx",
  "перелёт при посадке",
  "отклонение LOC, G/S, G/P",
  "отклонение выполнения СОП",
  "интенсивное торможение",
] as const;
export type SummaryRow = (typeof summaryRows)[number];

export const compareSigns: Record<CompareOperator, string> = {
  greater: ">",
  greaterOrEqual: "≥",
  less: "<",
  lessOrEqual: "≤",
};

export function compareValue(value: number, operator: CompareOperator, threshold: number): boolean {
  switch (operator) {
    case "greater": return value > threshold;
    case "greaterOrEqual": return value >= threshold;
    case "less": return value < threshold;
    case "lessOrEqual": return value <= threshold;
  }
}

// Порог одного уровня. compare хранится у каждого уровня: инструкция смешивает ≥ и >
// внутри одной лестницы (Ny: 1.76 ≥, 1.81 ≥, но 2.0 строго больше).
export type LevelThreshold = { level: DeviationLevel; value: number; compare: CompareOperator };

// «abs» — параметр знакопеременный (крен влево, вертикальная скорость вниз),
// инструкция сравнивает модуль: |ROLL| > 7°.
export const parameterUses = ["max", "min", "abs"] as const;
export type ParameterUse = (typeof parameterUses)[number];
export type EventMatch = { kind: "event"; textContains: string; parameter: string | null; use: ParameterUse; patternVerified: boolean };
export type MetricMatch = { kind: "metric"; metric: string };
export type DeviationMatch = EventMatch | MetricMatch;

export type ThresholdTrigger = { type: "threshold"; unit: string | null; ladder: LevelThreshold[] };
export type OccurrenceTrigger = { type: "occurrence"; level: DeviationLevel; description: string | null };
// Уровень определяется не значением параметра, а тем, чего в выгрузке нет
// (длительность превышения, разница с расчётной скоростью) — только ручная оценка.
export type ManualTrigger = { type: "manual"; reason: string };
export type DeviationTrigger = ThresholdTrigger | OccurrenceTrigger | ManualTrigger;

export type DeviationCondition = { parameter: string; compare: CompareOperator; value: number; unit: string | null; use: ParameterUse | null };
export type DeviationSource = { page: number | null; codes: string[]; origin: "instruction" | "company" };
export type DeviationDocument = { id: string; edition: string; change: string | null; effectiveFrom: string | null; appendix: string | null };

export type DeviationRule = {
  key: string;        // `${aircraftId}:${id}` — уникален во всей матрице
  id: string;         // уникален внутри типа ВС
  // Сводное событие источника: дублирует конкретное сообщение того же рейса
  // («Предупреждение GPWS (уровень Caution)» приходит вместе с DON'T SINK).
  aggregate: boolean;
  aircraftId: string;
  name: { ru: string; en: string | null };
  category: DeviationCategory;
  summaryRow: SummaryRow | null;
  source: DeviationSource;
  match: DeviationMatch;
  trigger: DeviationTrigger;
  conditions: DeviationCondition[];
  note: string | null;
};

export type AircraftDeviationSet = {
  aircraftId: string;
  aliases: string[];
  document: DeviationDocument;
  rules: DeviationRule[];
  configSource: string;
};

export type DeviationMatrix = {
  sets: AircraftDeviationSet[];
  rules: DeviationRule[];
  byAircraftKey: Map<string, AircraftDeviationSet>;
};

export class DeviationConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Конфиг отклонений не прошёл проверку:\n${issues.map((issue) => `  • ${issue}`).join("\n")}`);
    this.name = "DeviationConfigError";
    this.issues = issues;
  }
}

// Ключ сопоставления типа ВС: регистр, пробелы и дефисы не важны.
// «RRJ-95B», «rrj 95b» и «RRJ95B» — один и тот же тип.
export function normalizeAircraftKey(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-zа-яё]+/g, "");
}

export function resolveAircraftRules(matrix: DeviationMatrix, aircraftType: string): AircraftDeviationSet | null {
  const key = normalizeAircraftKey(aircraftType ?? "");
  if (!key) return null;
  return matrix.byAircraftKey.get(key) ?? null;
}

type Issues = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === undefined) return "ничего";
  if (value === null) return "null";
  if (typeof value === "string") return `«${value}»`;
  if (Array.isArray(value)) return "массив";
  if (isRecord(value)) return "объект";
  return String(value);
}

function prefix(path: string): string {
  return path ? `${path}.` : "";
}

function checkKeys(raw: Record<string, unknown>, allowed: readonly string[], path: string, issues: Issues): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) issues.push(`${prefix(path)}${key}: неизвестное поле (допустимы: ${allowed.join(", ")})`);
  }
}

function readString(raw: Record<string, unknown>, key: string, path: string, issues: Issues): string | null {
  const value = raw[key];
  if (typeof value === "string" && value.trim() !== "") return value;
  issues.push(`${prefix(path)}${key}: ожидалась непустая строка, получено ${describe(value)}`);
  return null;
}

function readOptionalString(raw: Record<string, unknown>, key: string, path: string, issues: Issues): string | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  return readString(raw, key, path, issues);
}

function readOptionalBoolean(raw: Record<string, unknown>, key: string, path: string, issues: Issues): boolean | null {
  const value = raw[key];
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  issues.push(`${prefix(path)}${key}: ожидалось true или false, получено ${describe(value)}`);
  return null;
}

function readNumber(value: unknown, path: string, issues: Issues): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  issues.push(`${path}: ожидалось число, получено ${describe(value)}`);
  return null;
}

function parseCompare(value: unknown, path: string, issues: Issues): CompareOperator | null {
  if (typeof value === "string" && (compareOperators as readonly string[]).includes(value)) return value as CompareOperator;
  issues.push(`${path}: ожидался знак сравнения (${compareOperators.join(", ")}), получено ${describe(value)}`);
  return null;
}

function parseDocument(raw: unknown, issues: Issues): DeviationDocument | null {
  if (!isRecord(raw)) {
    issues.push(`document: ожидался объект, получено ${describe(raw)}`);
    return null;
  }
  checkKeys(raw, ["id", "edition", "change", "effectiveFrom", "appendix"], "document", issues);
  const id = readString(raw, "id", "document", issues);
  const edition = readString(raw, "edition", "document", issues);
  const change = readOptionalString(raw, "change", "document", issues);
  const effectiveFrom = readOptionalString(raw, "effectiveFrom", "document", issues);
  const appendix = readOptionalString(raw, "appendix", "document", issues);
  if (!id || !edition) return null;
  return { id, edition, change, effectiveFrom, appendix };
}

function parseAircraft(raw: unknown, issues: Issues): { id: string; aliases: string[] } | null {
  if (!isRecord(raw)) {
    issues.push(`aircraft: ожидался объект, получено ${describe(raw)}`);
    return null;
  }
  checkKeys(raw, ["id", "aliases"], "aircraft", issues);
  const id = readString(raw, "id", "aircraft", issues);
  const aliasesRaw = raw.aliases;
  const aliases: string[] = [];
  if (!Array.isArray(aliasesRaw)) {
    issues.push(`aircraft.aliases: ожидался массив названий типа из выгрузки, получено ${describe(aliasesRaw)}`);
  } else {
    aliasesRaw.forEach((alias, index) => {
      if (typeof alias === "string" && alias.trim() !== "") aliases.push(alias);
      else issues.push(`aircraft.aliases[${index}]: ожидалась непустая строка, получено ${describe(alias)}`);
    });
  }
  if (!id) return null;
  return { id, aliases };
}

function parseSourceInfo(raw: unknown, path: string, issues: Issues): DeviationSource {
  const empty: DeviationSource = { page: null, codes: [], origin: "instruction" };
  if (raw === undefined || raw === null) return empty;
  if (!isRecord(raw)) {
    issues.push(`${path}: ожидался объект, получено ${describe(raw)}`);
    return empty;
  }
  checkKeys(raw, ["page", "codes", "origin"], path, issues);
  let page: number | null = null;
  if (raw.page !== undefined && raw.page !== null) {
    const value = readNumber(raw.page, `${path}.page`, issues);
    if (value !== null && !Number.isInteger(value)) issues.push(`${path}.page: ожидался номер страницы целым числом, получено ${value}`);
    else page = value;
  }
  const codes: string[] = [];
  if (raw.codes !== undefined && raw.codes !== null) {
    if (!Array.isArray(raw.codes)) issues.push(`${path}.codes: ожидался массив строк, получено ${describe(raw.codes)}`);
    else raw.codes.forEach((code, index) => {
      if (typeof code === "string" && code.trim() !== "") codes.push(code);
      else issues.push(`${path}.codes[${index}]: ожидалась непустая строка, получено ${describe(code)}`);
    });
  }
  let origin: DeviationSource["origin"] = "instruction";
  if (raw.origin !== undefined && raw.origin !== null) {
    if (raw.origin === "instruction" || raw.origin === "company") origin = raw.origin;
    else issues.push(`${path}.origin: ожидалось "instruction" или "company", получено ${describe(raw.origin)}`);
  }
  return { page, codes, origin };
}

function parseUse(value: unknown, path: string, issues: Issues): ParameterUse | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && (parameterUses as readonly string[]).includes(value)) return value as ParameterUse;
  issues.push(`${path}: ожидалось одно из ${parameterUses.join(", ")}, получено ${describe(value)}`);
  return null;
}

function parseMatch(raw: unknown, path: string, issues: Issues): DeviationMatch | null {
  if (!isRecord(raw)) {
    issues.push(`${path}: ожидался объект, получено ${describe(raw)}`);
    return null;
  }
  if (raw.kind === "event") {
    checkKeys(raw, ["kind", "textContains", "parameter", "use", "patternVerified"], path, issues);
    const textContains = readString(raw, "textContains", path, issues);
    const parameter = readOptionalString(raw, "parameter", path, issues);
    const use = parseUse(raw.use, `${path}.use`, issues) ?? "max";
    const patternVerified = readOptionalBoolean(raw, "patternVerified", path, issues) ?? false;
    if (!textContains) return null;
    return { kind: "event", textContains, parameter, use, patternVerified };
  }
  if (raw.kind === "metric") {
    checkKeys(raw, ["kind", "metric"], path, issues);
    const metric = readString(raw, "metric", path, issues);
    if (!metric) return null;
    return { kind: "metric", metric };
  }
  issues.push(`${path}.kind: ожидалось "event" или "metric", получено ${describe(raw.kind)}`);
  return null;
}

function parseLevelThreshold(raw: unknown, level: DeviationLevel, path: string, ruleCompare: CompareOperator | null, issues: Issues): LevelThreshold | null {
  if (typeof raw === "number") {
    const value = readNumber(raw, path, issues);
    if (value === null || !ruleCompare) return null;
    return { level, value, compare: ruleCompare };
  }
  if (isRecord(raw)) {
    checkKeys(raw, ["value", "compare"], path, issues);
    const value = readNumber(raw.value, `${path}.value`, issues);
    const compare = raw.compare === undefined || raw.compare === null ? ruleCompare : parseCompare(raw.compare, `${path}.compare`, issues);
    if (value === null || !compare) return null;
    return { level, value, compare };
  }
  issues.push(`${path}: ожидалось число или объект { value, compare }, получено ${describe(raw)}`);
  return null;
}

// Лестница обязана быть монотонной: уровень 4 не может быть мягче уровня 2.
function checkLadderOrder(ladder: LevelThreshold[], ruleCompare: CompareOperator, path: string, issues: Issues): void {
  const rising = ruleCompare === "greater" || ruleCompare === "greaterOrEqual";
  for (let index = 1; index < ladder.length; index += 1) {
    const previous = ladder[index - 1];
    const current = ladder[index];
    const ordered = rising ? current.value >= previous.value : current.value <= previous.value;
    if (!ordered) {
      issues.push(`${path}: пороги должны ${rising ? "расти" : "убывать"} от уровня 2 к уровню 4 (уровень ${previous.level} = ${previous.value}, уровень ${current.level} = ${current.value})`);
    }
  }
}

function parseTrigger(raw: unknown, path: string, issues: Issues): DeviationTrigger | null {
  if (!isRecord(raw)) {
    issues.push(`${path}: ожидался объект, получено ${describe(raw)}`);
    return null;
  }
  if (raw.type === "threshold") {
    checkKeys(raw, ["type", "compare", "unit", "levels"], path, issues);
    const compare = parseCompare(raw.compare, `${path}.compare`, issues);
    const unit = readOptionalString(raw, "unit", path, issues);
    const levelsRaw = raw.levels;
    if (!isRecord(levelsRaw)) {
      issues.push(`${path}.levels: ожидался объект с порогами по уровням, получено ${describe(levelsRaw)}`);
      return null;
    }
    checkKeys(levelsRaw, deviationLevels.map(String), `${path}.levels`, issues);
    const ladder: LevelThreshold[] = [];
    for (const level of deviationLevels) {
      const entry = levelsRaw[String(level)];
      if (entry === undefined || entry === null) continue;
      const parsed = parseLevelThreshold(entry, level, `${path}.levels.${level}`, compare, issues);
      if (parsed) ladder.push(parsed);
    }
    if (ladder.length === 0) {
      issues.push(`${path}.levels: не задан ни один уровень (2, 3 или 4)`);
      return null;
    }
    if (!compare) return null;
    checkLadderOrder(ladder, compare, `${path}.levels`, issues);
    return { type: "threshold", unit, ladder };
  }
  if (raw.type === "occurrence") {
    checkKeys(raw, ["type", "level", "description"], path, issues);
    const description = readOptionalString(raw, "description", path, issues);
    const level = raw.level;
    if (typeof level !== "number" || !(deviationLevels as readonly number[]).includes(level)) {
      issues.push(`${path}.level: ожидался уровень ${deviationLevels.join(", ")}, получено ${describe(level)}`);
      return null;
    }
    return { type: "occurrence", level: level as DeviationLevel, description };
  }
  if (raw.type === "manual") {
    checkKeys(raw, ["type", "reason"], path, issues);
    const reason = readString(raw, "reason", path, issues);
    if (!reason) return null;
    return { type: "manual", reason };
  }
  issues.push(`${path}.type: ожидалось "threshold", "occurrence" или "manual", получено ${describe(raw.type)}`);
  return null;
}

function parseConditions(raw: unknown, path: string, issues: Issues): DeviationCondition[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.push(`${path}: ожидался массив со-условий, получено ${describe(raw)}`);
    return [];
  }
  const conditions: DeviationCondition[] = [];
  raw.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      issues.push(`${entryPath}: ожидался объект, получено ${describe(entry)}`);
      return;
    }
    checkKeys(entry, ["parameter", "compare", "value", "unit", "use"], entryPath, issues);
    const parameter = readString(entry, "parameter", entryPath, issues);
    const compare = parseCompare(entry.compare, `${entryPath}.compare`, issues);
    const value = readNumber(entry.value, `${entryPath}.value`, issues);
    const unit = readOptionalString(entry, "unit", entryPath, issues);
    const use = parseUse(entry.use, `${entryPath}.use`, issues);
    if (parameter && compare && value !== null) conditions.push({ parameter, compare, value, unit, use });
  });
  return conditions;
}

function parseRule(raw: unknown, index: number, aircraftId: string, issues: Issues): DeviationRule | null {
  const path = `rules[${index}]`;
  if (!isRecord(raw)) {
    issues.push(`${path}: ожидался объект, получено ${describe(raw)}`);
    return null;
  }
  checkKeys(raw, ["id", "name", "category", "summaryRow", "source", "match", "trigger", "conditions", "note", "aggregate"], path, issues);
  const id = readString(raw, "id", path, issues);
  if (id !== null && !/^[a-z0-9-]+$/.test(id)) {
    issues.push(`${path}.id: допустимы только строчные латинские буквы, цифры и дефис, получено «${id}»`);
  }
  let name: { ru: string; en: string | null } | null = null;
  if (!isRecord(raw.name)) {
    issues.push(`${path}.name: ожидался объект { ru, en }, получено ${describe(raw.name)}`);
  } else {
    checkKeys(raw.name, ["ru", "en"], `${path}.name`, issues);
    const ru = readString(raw.name, "ru", `${path}.name`, issues);
    const en = readOptionalString(raw.name, "en", `${path}.name`, issues);
    if (ru) name = { ru, en };
  }
  let category: DeviationCategory | null = null;
  if (typeof raw.category === "string" && (deviationCategories as readonly string[]).includes(raw.category)) {
    category = raw.category as DeviationCategory;
  } else {
    issues.push(`${path}.category: ожидалась одна из категорий (${deviationCategories.join(", ")}), получено ${describe(raw.category)}`);
  }
  const summaryRowRaw = readOptionalString(raw, "summaryRow", path, issues);
  let summaryRow: SummaryRow | null = null;
  if (summaryRowRaw !== null) {
    if ((summaryRows as readonly string[]).includes(summaryRowRaw)) summaryRow = summaryRowRaw as SummaryRow;
    else issues.push(`${path}.summaryRow: строки «${summaryRowRaw}» нет в сводной таблице приложения № 5А`);
  }
  const source = parseSourceInfo(raw.source, `${path}.source`, issues);
  const match = parseMatch(raw.match, `${path}.match`, issues);
  const trigger = parseTrigger(raw.trigger, `${path}.trigger`, issues);
  const conditions = parseConditions(raw.conditions, `${path}.conditions`, issues);
  const note = readOptionalString(raw, "note", path, issues);
  const aggregate = readOptionalBoolean(raw, "aggregate", path, issues) ?? false;
  if (!id || !name || !category || !match || !trigger) return null;
  return { key: `${aircraftId}:${id}`, id, aircraftId, aggregate, name, category, summaryRow, source, match, trigger, conditions, note };
}

export function parseDeviationConfig(raw: unknown, issues: Issues): AircraftDeviationSet | null {
  if (!isRecord(raw)) {
    issues.push(`корень конфига должен быть объектом, получено ${describe(raw)}`);
    return null;
  }
  checkKeys(raw, ["$schema", "document", "aircraft", "rules"], "", issues);
  const document = parseDocument(raw.document, issues);
  const aircraft = parseAircraft(raw.aircraft, issues);
  const rules: DeviationRule[] = [];
  if (!Array.isArray(raw.rules)) {
    issues.push(`rules: ожидался массив правил, получено ${describe(raw.rules)}`);
  } else if (aircraft) {
    const seen = new Set<string>();
    raw.rules.forEach((ruleRaw, index) => {
      const rule = parseRule(ruleRaw, index, aircraft.id, issues);
      if (!rule) return;
      if (seen.has(rule.id)) issues.push(`rules[${index}].id: правило «${rule.id}» уже объявлено выше`);
      else {
        seen.add(rule.id);
        rules.push(rule);
      }
    });
    if (raw.rules.length === 0) issues.push("rules: конфиг типа ВС без правил бесполезен");
  }
  if (!document || !aircraft) return null;
  return { aircraftId: aircraft.id, aliases: aircraft.aliases, document, rules, configSource: "" };
}

// Собирает матрицу из уже прочитанных конфигов. Чистая функция: источники читает
// вызывающая сторона (registry.ts — из бандла, тесты — с диска).
export function buildDeviationMatrix(inputs: { source: string; data: unknown }[]): DeviationMatrix {
  const issues: string[] = [];
  const sets: AircraftDeviationSet[] = [];
  for (const input of inputs) {
    const local: Issues = [];
    const set = parseDeviationConfig(input.data, local);
    for (const issue of local) issues.push(`${input.source} → ${issue}`);
    if (set) sets.push({ ...set, configSource: input.source });
  }
  const byAircraftKey = new Map<string, AircraftDeviationSet>();
  for (const set of sets) {
    for (const name of [set.aircraftId, ...set.aliases]) {
      const key = normalizeAircraftKey(name);
      if (!key) {
        issues.push(`${set.configSource} → aircraft: название «${name}» пустое после нормализации`);
        continue;
      }
      const existing = byAircraftKey.get(key);
      if (existing && existing !== set) issues.push(`${set.configSource} → aircraft: тип «${name}» уже занят конфигом ${existing.configSource}`);
      else byAircraftKey.set(key, set);
    }
  }
  if (issues.length > 0) throw new DeviationConfigError(issues);
  return { sets, rules: sets.flatMap((set) => set.rules), byAircraftKey };
}
