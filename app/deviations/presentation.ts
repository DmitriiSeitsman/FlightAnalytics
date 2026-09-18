// Как отклонение выглядит в интерфейсе: цвет уровня, короткая подпись, подсказка.
// Логика классификации сюда не лезет — здесь только представление.
import { describeTrigger, type DeviationClassification } from "./classify.ts";
import { type DeviationLevel } from "./config.ts";

export type LevelStyle = { bg: string; text: string; border: string };

// 2 — жёлтый, 3 — оранжевый, 4 — красный, как принято в отчётах по отклонениям.
export const LEVEL_STYLES: Record<DeviationLevel, LevelStyle> = {
  2: { bg: "#fefce8", text: "#a16207", border: "#fde68a" },
  3: { bg: "#fff7ed", text: "#ea580c", border: "#fed7aa" },
  4: { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
};
const NEUTRAL: LevelStyle = { bg: "#f4f7f8", text: "#5d6b75", border: "#dbe3e7" };
const REVIEW: LevelStyle = { bg: "#eef2ff", text: "#4338ca", border: "#c7d2fe" };

export function formatDeviationValue(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

export function worstLevel(classifications: DeviationClassification[]): DeviationLevel | null {
  let worst: DeviationLevel | null = null;
  for (const item of classifications) {
    if (item.level !== null && (worst === null || item.level > worst)) worst = item.level;
  }
  return worst;
}

export type DeviationDisplay = { label: string; style: LevelStyle; title: string };

// Измеренное значение в подписи: «Ny 1,969 g».
export function measuredValue(classification: DeviationClassification): string | null {
  if (classification.value === null) return null;
  const unit = classification.unit ? ` ${classification.unit}` : "";
  return `${classification.parameter ?? "значение"} ${formatDeviationValue(classification.value)}${unit}`;
}

export function displayDeviation(classification: DeviationClassification): DeviationDisplay {
  const { rule, level, reason } = classification;
  const measured = measuredValue(classification);
  const parts = [rule.name.ru, measured, `норматив: ${describeTrigger(rule.trigger)}`].filter(Boolean);
  if (reason === "condition-failed" || reason === "condition-unknown") {
    const condition = classification.failedCondition;
    const wording = condition ? `${condition.parameter} ${condition.compare === "less" || condition.compare === "lessOrEqual" ? "ниже" : "выше"} ${formatDeviationValue(condition.value)}` : "условие";
    return {
      label: "норматив не применим",
      style: NEUTRAL,
      title: `${parts.join(" · ")}. ${reason === "condition-failed" ? `Не выполнено условие: ${wording}.` : `Нечем проверить условие: ${wording}.`}`,
    };
  }
  if (reason === "manual-review") {
    return { label: "ручная оценка", style: REVIEW, title: `${parts.join(" · ")}. Уровень по выгрузке не определить.` };
  }
  if (reason === "no-value") {
    return { label: "нет параметра", style: NEUTRAL, title: `${parts.join(" · ")}. В событии нет параметра ${rule.match.kind === "event" ? rule.match.parameter ?? "" : ""}.` };
  }
  if (level === null) {
    return { label: "ниже 2 уровня", style: NEUTRAL, title: `${parts.join(" · ")}. Источник отметил событие раньше, чем начинаются уровни инструкции.` };
  }
  return { label: `${level} уровень`, style: LEVEL_STYLES[level], title: parts.join(" · ") };
}

// Подпись строки события под текстом: норматив, значение и лестница порогов.
export function deviationSummary(classification: DeviationClassification): string {
  return [classification.rule.name.ru, measuredValue(classification), describeTrigger(classification.rule.trigger)].filter(Boolean).join(" · ");
}

export const LEVEL_FILTERS = ["4", "3", "2", "none", "unmatched"] as const;
export type LevelFilter = (typeof LEVEL_FILTERS)[number];
export const LEVEL_FILTER_LABELS: Record<LevelFilter, string> = {
  "4": "4 уровень",
  "3": "3 уровень",
  "2": "2 уровень",
  none: "Без уровня",
  unmatched: "Не классифицировано",
};
export const LEVEL_FILTER_STYLES: Record<LevelFilter, LevelStyle> = {
  "4": LEVEL_STYLES[4],
  "3": LEVEL_STYLES[3],
  "2": LEVEL_STYLES[2],
  none: REVIEW,
  unmatched: NEUTRAL,
};

// К какой группе фильтра относится событие: уровень, «без уровня» (правило нашлось,
// но уровня нет) или «не классифицировано» (норматива для такого события нет).
export function levelFilterOf(classifications: DeviationClassification[]): LevelFilter {
  if (classifications.length === 0) return "unmatched";
  const worst = worstLevel(classifications);
  return worst === null ? "none" : (String(worst) as LevelFilter);
}
