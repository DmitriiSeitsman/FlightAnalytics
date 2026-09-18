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
} from "./config.ts";

// Ровно та часть события, которая нужна движку: тип ВС приходит отдельно, из рейса.
export type ClassifiableEvent = { text: string; parameters: { name: string; max: string; min: string }[] };

export type ClassificationReason =
  | "threshold"           // значение дотянуло до уровня
  | "occurrence"          // отклонением считается сам факт события
  | "below-threshold"     // правило нашлось, значение ниже 2-го уровня
  | "no-value"            // правило нашлось, но параметра в событии нет
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
function readParameter(event: ClassifiableEvent, name: string, use: "max" | "min"): number | null {
  const wanted = normalizeText(name);
  const values: number[] = [];
  for (const parameter of event.parameters ?? []) {
    if (normalizeText(parameter?.name ?? "") !== wanted) continue;
    const primary = parseEventNumber(use === "max" ? parameter.max : parameter.min);
    const fallback = parseEventNumber(use === "max" ? parameter.min : parameter.max);
    const value = primary ?? fallback;
    if (value !== null) values.push(value);
  }
  if (values.length === 0) return null;
  return use === "max" ? Math.max(...values) : Math.min(...values);
}

// Правило ищется по паре «тип ВС + текст события»: кодов событий выгрузка не заполняет.
// При нескольких совпадениях выигрывает более длинный (более конкретный) образец.
export function findRule(event: ClassifiableEvent, aircraftType: string, matrix: DeviationMatrix): DeviationRule | null {
  const set = resolveAircraftRules(matrix, aircraftType);
  if (!set) return null;
  const text = normalizeText(event.text ?? "");
  if (!text) return null;
  let best: { rule: DeviationRule; weight: number } | null = null;
  for (const rule of set.rules) {
    if (rule.match.kind !== "event") continue;
    const needle = normalizeText(rule.match.textContains);
    if (!needle || !text.includes(needle)) continue;
    const weight = needle.length;
    if (!best || weight > best.weight || (weight === best.weight && rule.id < best.rule.id)) best = { rule, weight };
  }
  return best?.rule ?? null;
}

function levelFromLadder(ladder: LevelThreshold[], value: number): DeviationLevel | null {
  let level: DeviationLevel | null = null;
  for (const step of ladder) {
    if (!compareValue(value, step.compare, step.value)) continue;
    if (level === null || step.level > level) level = step.level;
  }
  return level;
}

export function classifyEvent(event: ClassifiableEvent, aircraftType: string, matrix: DeviationMatrix): DeviationClassification | null {
  const rule = findRule(event, aircraftType, matrix);
  if (!rule) return null;
  const parameter = rule.match.kind === "event" ? rule.match.parameter : null;
  const use = rule.match.kind === "event" ? rule.match.use : "max";
  const value = parameter ? readParameter(event, parameter, use) : null;
  const unit = rule.trigger.type === "threshold" ? rule.trigger.unit : null;
  const base = { rule, parameter, value, unit, failedCondition: null };

  for (const condition of rule.conditions) {
    const conditionValue = readParameter(event, condition.parameter, condition.compare === "less" || condition.compare === "lessOrEqual" ? "min" : "max");
    if (conditionValue === null) return { ...base, level: null, reason: "condition-unknown", failedCondition: condition };
    if (!compareValue(conditionValue, condition.compare, condition.value)) return { ...base, level: null, reason: "condition-failed", failedCondition: condition };
  }

  if (rule.trigger.type === "occurrence") return { ...base, level: rule.trigger.level, reason: "occurrence" };
  if (value === null) return { ...base, level: null, reason: "no-value" };
  const level = levelFromLadder(rule.trigger.ladder, value);
  return { ...base, level, reason: level === null ? "below-threshold" : "threshold" };
}

// «≥ 1.76 / ≥ 1.81 / > 2 g» — для подсказок в интерфейсе и отчёта покрытия.
export function describeTrigger(trigger: DeviationTrigger): string {
  if (trigger.type === "occurrence") return `сам факт события — ${trigger.level} уровень`;
  const steps = trigger.ladder.map((step) => `${compareSigns[step.compare]} ${step.value}`).join(" / ");
  return trigger.unit ? `${steps} ${trigger.unit}` : steps;
}
