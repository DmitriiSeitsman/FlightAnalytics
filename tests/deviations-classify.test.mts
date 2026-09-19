import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeviationMatrix, type DeviationMatrix } from "../app/deviations/config.ts";
import { classifyEvent, classifyEventAll, describeTrigger, findRule, parseEventNumber, type ClassifiableEvent } from "../app/deviations/classify.ts";

const configDir = join(dirname(fileURLToPath(import.meta.url)), "..", "config", "deviations");

const matrix: DeviationMatrix = buildDeviationMatrix(
  readdirSync(configDir)
    .filter((file) => file.endsWith(".json") && file !== "schema.json")
    .sort()
    .map((file) => ({ source: file, data: JSON.parse(readFileSync(join(configDir, file), "utf8")) })),
);

function event(text: string, parameters: Record<string, string | { max?: string; min?: string }> = {}): ClassifiableEvent {
  return {
    text,
    parameters: Object.entries(parameters).map(([name, raw]) => {
      const value = typeof raw === "string" ? { max: raw, min: raw } : raw;
      return { name, max: value.max ?? "", min: value.min ?? "" };
    }),
  };
}

// Событие ровно в том виде, в каком его отдаёт выгрузка: значение строкой, запятая — дробная часть.
const touchdownNy = (value: string) => event("Посадка с вертикальной перегрузкой более 1.7 g", { Ny: value });

test("перегрузка на касании раскладывается по лестнице уровней", () => {
  const cases: [string, number | null][] = [
    ["1,5", null],     // источник событие отметил, но до 2 уровня не дотягивает
    ["1,76", 2],       // ровно порог: знак ≥
    ["1,777", 2],      // реальный кейс из выгрузки за август
    ["1,81", 3],
    ["1,99", 3],
    ["2,0", 3],        // 4 уровень строго больше 2.0 — на самом пороге это ещё 3
    ["2,05", 4],
  ];
  for (const [raw, expected] of cases) {
    const result = classifyEvent(touchdownNy(raw), "RRJ-95B", matrix);
    assert.ok(result, `событие с Ny = ${raw} не распознано`);
    assert.equal(result.rule.id, "high-acceleration-at-touchdown");
    assert.equal(result.level, expected, `Ny = ${raw}: ожидался уровень ${expected}, получен ${result.level}`);
    assert.equal(result.parameter, "Ny");
  }
});

test("распознанное событие ниже 2 уровня отличается от нераспознанного", () => {
  const below = classifyEvent(touchdownNy("1,5"), "RRJ-95B", matrix);
  assert.equal(below?.reason, "below-threshold");
  assert.equal(below?.value, 1.5);
  assert.equal(classifyEvent(event("Срабатывание сигнализации об отказе генератора"), "RRJ-95B", matrix), null);
});

test("перелёт и недолёт считаются по своим направлениям лестницы", () => {
  const long = (value: string) => classifyEvent(event("Расстояние от торца до касания более 800 м", { Sdis: value }), "RRJ-95LR", matrix);
  assert.equal(long("850")?.level, null);
  assert.equal(long("1030,95")?.level, 3);   // реальный кейс из выгрузки
  assert.equal(long("1200")?.level, 4);
  assert.equal(long("1030,95")?.rule.id, "long-touchdown");

  const short = (value: string) => classifyEvent(event("Расстояние от торца до касания менее 250 м", { Sdis: value }), "RRJ-95B", matrix);
  assert.equal(short("250")?.level, null);
  assert.equal(short("190")?.level, 2);
  assert.equal(short("120")?.level, 3);
  assert.equal(short("90")?.level, 4);
  assert.equal(short("120")?.rule.id, "short-touchdown");
});

test("правило по факту события не требует значения", () => {
  const result = classifyEvent(event("Использование режима REV MAX на скорости менее 65 knots"), "RRJ-95B", matrix);
  assert.equal(result?.rule.id, "reverser-max-at-low-speed");
  assert.equal(result?.level, 2);
  assert.equal(result?.reason, "occurrence");
  assert.equal(result?.value, null);
});

test("без параметра в событии уровень не выдумывается", () => {
  const result = classifyEvent(event("Посадка с вертикальной перегрузкой более 1.7 g"), "RRJ-95B", matrix);
  assert.equal(result?.reason, "no-value");
  assert.equal(result?.level, null);
});

test("тип ВС без конфига не классифицируется", () => {
  assert.equal(classifyEvent(touchdownNy("1,9"), "Embraer 190", matrix), null);
  assert.equal(classifyEvent(touchdownNy("1,9"), "", matrix), null);
});

test("параметр берётся по точному имени и по нужному краю", () => {
  const noisy: ClassifiableEvent = {
    text: "Посадка с вертикальной перегрузкой более 1.7 g",
    parameters: [
      { name: "Ny16", max: "2,4", min: "2,4" },   // соседний параметр не должен подменить Ny
      { name: "Ny", max: "1,78", min: "1,10" },
      { name: " ny ", max: "1,83", min: "1,20" }, // тот же параметр другой строкой события
    ],
  };
  const result = classifyEvent(noisy, "RRJ-95B", matrix);
  assert.equal(result?.value, 1.83);              // use: max → крайнее значение вверх
  assert.equal(result?.level, 3);
});

test("числа выгрузки разбираются в русской локали", () => {
  assert.equal(parseEventNumber("1,777"), 1.777);
  assert.equal(parseEventNumber("1 030,95"), 1030.95);
  assert.equal(parseEventNumber("1.777"), 1.777);
  assert.equal(parseEventNumber("1,030.95"), 1030.95);
  assert.equal(parseEventNumber("-2,5"), -2.5);
  assert.equal(parseEventNumber("0"), 0);
  assert.equal(parseEventNumber(""), null);
  assert.equal(parseEventNumber("null"), null);
  assert.equal(parseEventNumber("1,2,3"), null);
  assert.equal(parseEventNumber(undefined), null);
});

test("из нескольких подходящих правил выигрывает более конкретное", () => {
  const custom = buildDeviationMatrix([{
    source: "test.json",
    data: {
      document: { id: "И-04.02-28-24", edition: "06" },
      aircraft: { id: "TU-000", aliases: ["TU-000A"] },
      rules: [
        {
          id: "general", name: { ru: "Общее" }, category: "Other",
          match: { kind: "event", textContains: "касания" },
          trigger: { type: "occurrence", level: 2 },
        },
        {
          id: "specific", name: { ru: "Частное" }, category: "Other",
          match: { kind: "event", textContains: "от торца до касания более" },
          trigger: { type: "occurrence", level: 4 },
        },
      ],
    },
  }]);
  const result = classifyEvent(event("Расстояние от торца до касания более 800 м"), "TU-000A", custom);
  assert.equal(result?.rule.id, "specific");
  assert.equal(result?.level, 4);
  assert.equal(findRule(event("Разброс отметок касания"), "TU-000", custom)?.id, "general");
});

test("со-условие отсекает событие и объясняет, почему", () => {
  const custom = buildDeviationMatrix([{
    source: "conditions.json",
    data: {
      document: { id: "И-04.02-28-24", edition: "06" },
      aircraft: { id: "TU-001", aliases: ["TU-001A"] },
      rules: [
        {
          id: "ny-with-vy", name: { ru: "Перегрузка при большой вертикальной скорости" }, category: "Acceleration",
          match: { kind: "event", textContains: "перегрузкой", parameter: "Ny" },
          trigger: { type: "threshold", compare: "greaterOrEqual", unit: "g", levels: { 2: 1.76, 3: 1.81 } },
          conditions: [{ parameter: "Vy", compare: "greater", value: 300, unit: "fpm" }],
        },
      ],
    },
  }]);
  const met = classifyEvent(event("Посадка с перегрузкой", { Ny: "1,9", Vy: "420" }), "TU-001", custom);
  assert.equal(met?.level, 3);
  assert.equal(met?.reason, "threshold");

  const failed = classifyEvent(event("Посадка с перегрузкой", { Ny: "1,9", Vy: "180" }), "TU-001", custom);
  assert.equal(failed?.level, null);
  assert.equal(failed?.reason, "condition-failed");
  assert.equal(failed?.failedCondition?.parameter, "Vy");

  const unknown = classifyEvent(event("Посадка с перегрузкой", { Ny: "1,9" }), "TU-001", custom);
  assert.equal(unknown?.reason, "condition-unknown");
});

test("текст события сверяется без оглядки на регистр, «ё» и лишние пробелы", () => {
  const messy = event("Перед взлётом  НЕ ПРОВОДИЛАСЬ ИЛИ ПРОВЕДЕНА НЕ В ПОЛНОМ ОБЪЁМЕ ПРОВЕРКА руля высоты", {});
  assert.equal(classifyEvent(messy, "rrj-95b", matrix)?.rule.id, "flight-control-check");
});

test("порог человекочитаемо описывается", () => {
  const rule = matrix.rules.find((item) => item.key === "RRJ-95:high-acceleration-at-touchdown");
  assert.equal(describeTrigger(rule!.trigger), "≥ 1.76 / ≥ 1.81 / > 2 g");
  const occurrence = matrix.rules.find((item) => item.key === "RRJ-95:reverser-max-at-low-speed");
  assert.equal(describeTrigger(occurrence!.trigger), "сам факт события — 2 уровень");
});

test("знакопеременные параметры сравниваются по модулю", () => {
  // Крен влево приходит отрицательным: max = -5,27, min = -7,12 — это 7 градусов крена.
  const leftBank = classifyEvent(event("Угол крена на выравнивании перед посадкой / посадке (более 7 град)", { ROLL: { max: "-5,27", min: "-7,12" } }), "RRJ-95B", matrix);
  assert.equal(leftBank?.rule.id, "excessive-bank-angle-at-landing");
  assert.equal(leftBank?.value, 7.12);
  assert.equal(leftBank?.level, 2);

  const rightBank = classifyEvent(event("Угол крена на выравнивании перед посадкой / посадке (более 7 град)", { ROLL: { max: "10,5", min: "3,2" } }), "RRJ-95B", matrix);
  assert.equal(rightBank?.level, 3);
});

test("одно событие может отвечать сразу двум нормативам", () => {
  // Грубая посадка несёт и перегрузку, и вертикальную скорость: в сводной таблице это разные строки.
  const results = classifyEventAll(event("Грубая посадка при посадочном весе меньше максимально допустимого значения", { Ny: "1,586", VyHg: { max: "-579,2", min: "-579,2" } }), "RRJ-95B", matrix);
  assert.equal(results.length, 2);
  const byRule = new Map(results.map((item) => [item.rule.id, item]));
  assert.equal(byRule.get("hard-landing")?.level, null);                       // Ny 1,586 — источник сработал раньше 2 уровня
  assert.equal(byRule.get("hard-landing")?.reason, "below-threshold");
  assert.equal(byRule.get("high-vertical-speed-at-touchdown")?.level, 4);      // |VyHg| = 579 fpm
  assert.equal(results[0].rule.id, "high-vertical-speed-at-touchdown");        // сверху самое тяжёлое
  assert.equal(classifyEvent(event("Грубая посадка при посадочном весе меньше максимально допустимого значения", { Ny: "1,586", VyHg: "-579,2" }), "RRJ-95B", matrix)?.level, 4);
});

test("со-условия по высоте разводят полосы одного текста события", () => {
  const text = "Нестабилизированный заход: вертикальная скорость снижения на глиссаде больше 1000 ft/min";
  // Полоса 499–50 ft: то же превышение 1100 fpm — это уже 4 уровень.
  const low = classifyEvent(event(text, { Hg: { max: "357", min: "269" }, Vy: { max: "-1088", min: "-1280" } }), "RRJ-95B", matrix);
  assert.equal(low?.rule.id, "high-rate-of-descent-low-alt");
  assert.equal(low?.level, 4);
  assert.equal(low?.value, 1280);

  const med = classifyEvent(event(text, { Hg: { max: "870", min: "640" }, Vy: { max: "-1150", min: "-1200" } }), "RRJ-95B", matrix);
  assert.equal(med?.rule.id, "high-rate-of-descent-med-alt");
  assert.equal(med?.level, 3);

  // Ниже порога по скорости — правило нашлось, отклонения нет.
  const calm = classifyEvent(event(text, { Hg: { max: "300", min: "100" }, Vy: { max: "-1020", min: "-1040" } }), "RRJ-95B", matrix);
  assert.equal(calm?.level, null);
  assert.equal(calm?.reason, "below-threshold");
});

test("правила без вычислимого уровня честно просят ручной оценки", () => {
  const result = classifyEvent(event("Двойное управление самолетом", { "Xcp.l": "3,1", "Xcp.r": "2,8" }), "RRJ-95B", matrix);
  assert.equal(result?.rule.id, "dual-input");
  assert.equal(result?.level, null);
  assert.equal(result?.reason, "manual-review");
  assert.match(describeTrigger(result!.rule.trigger), /^уровень вручную: /);
});

test("реальные тексты выгрузки разбираются в ожидаемые правила", () => {
  const cases: [string, string][] = [
    ["Перед взлетом не проводилась или проведена не в полном объеме проверка руля направления", "flight-control-check"],
    ["Расстояние от пролета торца ВПП (h~50 ft) до касания более 800 м (уточните по LAT, LON)", "long-touchdown"],
    ["Посадка с вертикальной перегрузкой более 1.7 g", "high-acceleration-at-touchdown"],
    ["Тангаж на выравнивании перед посадкой / посадке более 10 град (нос вверх)", "pitch-high-at-touchdown"],
    ["Использование режима REV IDLE на скорости менее 30 knots", "reverser-idle-at-low-speed"],
    ["Речевое сообщение DON'T SINK – не снижайся", "taws-caution-dont-sink"],
    ["Речевое сообщение TERRAIN TERRAIN – земля, земля", "taws-caution-terrain-terrain"],
    ["Сигнализация LDG GEAR NOT DOWN – шасси не выпущено", "landing-gear-not-locked-down"],
    ["Масса самолета при посадке больше максимально допустимой (41000 кг)", "overweight-landing"],
    ["После запуска время прогрева правого двигателя на режиме не более 50 % N1 менее 3 минут", "engine-cooling-time"],
    ["Полет с выпущенной механизацией крыла на высоте более допустимой (20000 ft)", "flaps-slats-altitude-limit"],
  ];
  for (const [text, id] of cases) {
    assert.equal(findRule(event(text), "RRJ-95B", matrix)?.id, id, `текст «${text.slice(0, 40)}…»`);
  }
  // Технологические сообщения нормативов не имеют и остаются нераспознанными.
  assert.equal(findRule(event("Технологическое сообщение. Использование режима DERATE(FLEX) при взлете."), "RRJ-95B", matrix), null);
});
