// Движок классификации: событие из выгрузки → уровень отклонения по матрице.
//
// Источник сам ловит отклонения (его пороги ниже 2-го уровня инструкции) и кладёт
// в строку события измеренный параметр. Поэтому задача движка — не детектировать,
// а классифицировать уже отмеченное: найти правило по тексту события и разложить
// значение по лестнице уровней.
//
// Импорты здесь с расширением .ts: модуль напрямую грузится тестами через
// node --experimental-strip-types, который не резолвит пути без расширения.
import {
  compareSigns,
  compareValue,
  resolveAircraftRules,
  type DeviationCondition,
  type DeviationLevel,
  type DeviationMatrix,
  type DeviationRule,
  type DeviationTrigger,
  type LevelThreshold,
  type ParameterUse,
} from "./config.ts";

// Ровно та часть события, которая нужна движку: тип ВС приходит отдельно, из рейса.
export type ClassifiableEvent = { text: string; parameters: { name: string; max: string; min: string }[] };

export type ClassificationReason =
  | "threshold"           // значение дотянуло до уровня
  | "occurrence"          // отклонением считается сам факт события
  | "below-threshold"     // правило нашлось, значение ниже 2-го уровня
  | "no-value"            // правило нашлось, но параметра в событии нет
  | "manual-review"       // уровень по выгрузке не определить, нужна ручная оценка
  | "condition-failed"    // со-условие правила не выполнено
  | "condition-unknown";  // со-условие нечем проверить — параметра в событии нет

export type DeviationClassification = {
  rule: DeviationRule;
  level: DeviationLevel | null;
  parameter: string | null;
  value: number | null;
  unit: string | null;
  reason: ClassificationReason;
  failedCondition: DeviationCondition | null;
};

// Тексты в выгрузке и в инструкции расходятся регистром, «ё» и пробелами.
function normalizeText(value: string): string {
  return (value ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

// Числа приходят строками в русской локали: «1,777», «1 030,95», иногда «1.777».
export function parseEventNumber(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/[\u2212\u2013\u2014]/g, "-");
  if (!cleaned) return null;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (lastComma >= 0 && lastDot >= 0) {
    // Разделитель дробной части — тот знак, что стоит правее; второй знак разделяет разряды.
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    normalized = cleaned.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(/,/g, ".");
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

// Параметр может прийти несколькими строками одного события: берём крайнее значение
// в нужную сторону. Имя сверяется точно — «Ny» не должен подхватить «Ny16».
// «abs» нужен там, где инструкция сравнивает модуль: крен влево и вертикальная
// скорость снижения приходят со знаком минус.
function readParameter(event: ClassifiableEvent, name: string, use: ParameterUse): number | null {
  const wanted = normalizeText(name);
  const values: number[] = [];
  for (const parameter of event.parameters ?? []) {
    if (normalizeText(parameter?.name ?? "") !== wanted) continue;
    const max = parseEventNumber(parameter.max);
    const min = parseEventNumber(parameter.min);
    if (use === "abs") {
      for (const value of [max, min]) if (value !== null) values.push(Math.abs(value));
      continue;
    }
    const value = use === "max" ? max ?? min : min ?? max;
    if (value !== null) values.push(value);
  }
  if (values.length === 0) return null;
  return use === "min" ? Math.min(...values) : Math.max(...values);
}

type ConditionState = { ok: true } | { ok: false; reason: "condition-failed" | "condition-unknown"; condition: DeviationCondition };

function evaluateConditions(rule: DeviationRule, event: ClassifiableEvent): ConditionState {
  for (const condition of rule.conditions) {
    const use: ParameterUse = condition.use ?? (condition.compare === "less" || condition.compare === "lessOrEqual" ? "min" : "max");
    const value = readParameter(event, condition.parameter, use);
    if (value === null) return { ok: false, reason: "condition-unknown", condition };
    if (!compareValue(value, condition.compare, condition.value)) return { ok: false, reason: "condition-failed", condition };
  }
  return { ok: true };
}

function levelFromLadder(ladder: LevelThreshold[], value: number): DeviationLevel | null {
  let level: DeviationLevel | null = null;
  for (const step of ladder) {
    if (!compareValue(value, step.compare, step.value)) continue;
    if (level === null || step.level > level) level = step.level;
  }
  return level;
}

function evaluate(rule: DeviationRule, event: ClassifiableEvent, conditions: ConditionState): DeviationClassification {
  const parameter = rule.match.kind === "event" ? rule.match.parameter : null;
  const use = rule.match.kind === "event" ? rule.match.use : "max";
  const value = parameter ? readParameter(event, parameter, use) : null;
  const unit = rule.trigger.type === "threshold" ? rule.trigger.unit : null;
  const base = { rule, parameter, value, unit, failedCondition: null };
  if (!conditions.ok) return { ...base, level: null, reason: conditions.reason, failedCondition: conditions.condition };
  if (rule.trigger.type === "occurrence") return { ...base, level: rule.trigger.level, reason: "occurrence" };
  if (rule.trigger.type === "manual") return { ...base, level: null, reason: "manual-review" };
  if (value === null) return { ...base, level: null, reason: "no-value" };
  const level = levelFromLadder(rule.trigger.ladder, value);
  return { ...base, level, reason: level === null ? "below-threshold" : "threshold" };
}

const reasonRank: Record<ClassificationReason, number> = {
  threshold: 0,
  occurrence: 0,
  "manual-review": 0,
  "below-threshold": 1,
  "no-value": 2,
  "condition-failed": 3,
  "condition-unknown": 3,
};

// Одно событие может отвечать нескольким нормативам: «Грубая посадка» несёт и Ny,
// и VyHg — в сводной таблице это разные строки. Поэтому кандидаты группируются по
// параметру, и внутри группы остаётся один, самый подходящий: сперва тот, чьи
// со-условия выполнены (так различаются полосы высот), затем — с более длинным,
// то есть более конкретным образцом текста.
export function classifyEventAll(event: ClassifiableEvent, aircraftType: string, matrix: DeviationMatrix): DeviationClassification[] {
  const set = resolveAircraftRules(matrix, aircraftType);
  if (!set) return [];
  const text = normalizeText(event?.text ?? "");
  if (!text) return [];
  const best = new Map<string, { rule: DeviationRule; weight: number; conditions: ConditionState }>();
  for (const rule of set.rules) {
    if (rule.match.kind !== "event") continue;
    const needle = normalizeText(rule.match.textContains);
    if (!needle || !text.includes(needle)) continue;
    const key = rule.match.parameter ? normalizeText(rule.match.parameter) : "";
    const candidate = { rule, weight: needle.length, conditions: evaluateConditions(rule, event) };
    const current = best.get(key);
    if (!current || preferred(candidate, current)) best.set(key, candidate);
  }
  return [...best.values()]
    .map((candidate) => evaluate(candidate.rule, event, candidate.conditions))
    .sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || reasonRank[a.reason] - reasonRank[b.reason] || a.rule.id.localeCompare(b.rule.id));
}

function preferred(candidate: { rule: DeviationRule; weight: number; conditions: ConditionState }, current: { rule: DeviationRule; weight: number; conditions: ConditionState }): boolean {
  if (candidate.conditions.ok !== current.conditions.ok) return candidate.conditions.ok;
  if (candidate.weight !== current.weight) return candidate.weight > current.weight;
  return candidate.rule.id < current.rule.id;
}

// Самое тяжёлое из отклонений события — то, что показывается в карточке и в бейдже.
export function classifyEvent(event: ClassifiableEvent, aircraftType: string, matrix: DeviationMatrix): DeviationClassification | null {
  return classifyEventAll(event, aircraftType, matrix)[0] ?? null;
}

export function findRule(event: ClassifiableEvent, aircraftType: string, matrix: DeviationMatrix): DeviationRule | null {
  return classifyEvent(event, aircraftType, matrix)?.rule ?? null;
}

// «≥ 1.76 / ≥ 1.81 / > 2 g» — для подсказок в интерфейсе и отчёта покрытия.
export function describeTrigger(trigger: DeviationTrigger): string {
  if (trigger.type === "occurrence") return `сам факт события — ${trigger.level} уровень`;
  if (trigger.type === "manual") return `уровень вручную: ${trigger.reason}`;
  const steps = trigger.ladder.map((step) => `${compareSigns[step.compare]} ${step.value}`).join(" / ");
  return trigger.unit ? `${steps} ${trigger.unit}` : steps;
}
