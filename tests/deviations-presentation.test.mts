import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeviationMatrix } from "../app/deviations/config.ts";
import { classifyEventAll, type ClassifiableEvent } from "../app/deviations/classify.ts";
import { displayDeviation, deviationSummary, levelFilterOf, LEVEL_STYLES, measuredValue, worstLevel } from "../app/deviations/presentation.ts";

const configDir = join(dirname(fileURLToPath(import.meta.url)), "..", "config", "deviations");
const matrix = buildDeviationMatrix(
  readdirSync(configDir)
    .filter((file) => file.endsWith(".json") && file !== "schema.json")
    .sort()
    .map((file) => ({ source: file, data: JSON.parse(readFileSync(join(configDir, file), "utf8")) })),
);

function classify(text: string, parameters: Record<string, string> = {}) {
  const event: ClassifiableEvent = { text, parameters: Object.entries(parameters).map(([name, value]) => ({ name, max: value, min: value })) };
  return classifyEventAll(event, "RRJ-95B", matrix);
}

test("уровень получает свой цвет, а прочие исходы — нейтральный", () => {
  const level4 = displayDeviation(classify("Посадка с вертикальной перегрузкой более 1.7 g", { Ny: "2,094" })[0]);
  assert.equal(level4.label, "4 уровень");
  assert.equal(level4.style, LEVEL_STYLES[4]);
  assert.match(level4.title, /Повышенная вертикальная перегрузка на посадке/);
  assert.match(level4.title, /Ny 2,094 g/);

  const below = displayDeviation(classify("Посадка с вертикальной перегрузкой более 1.7 g", { Ny: "1,7" })[0]);
  assert.equal(below.label, "ниже 2 уровня");
  assert.notEqual(below.style, LEVEL_STYLES[2]);
  assert.match(below.title, /раньше, чем начинаются уровни/);

  const manual = displayDeviation(classify("Технологическое сообщение. Скорость на рулении больше рекомендованной 30 knots", { Vgr: "57" })[0]);
  assert.equal(manual.label, "ручная оценка");

  const noValue = displayDeviation(classify("Посадка с вертикальной перегрузкой более 1.7 g")[0]);
  assert.equal(noValue.label, "нет параметра");
});

test("значение показывается в русской локали с единицей норматива", () => {
  // Разделитель разрядов в ru-RU — неразрывный пробел, поэтому в шаблоне он любой.
  assert.match(measuredValue(classify("Расстояние от пролета торца ВПП (h~50 ft) до касания более 800 м", { Sdis: "1028,37" })[0])!, /^Sdis 1.028,37 м$/);
  assert.match(deviationSummary(classify("Расстояние от пролета торца ВПП (h~50 ft) до касания более 800 м", { Sdis: "1028,37" })[0]), /Перелёт.*Sdis 1.028,37 м.*> 900 \/ > 1000 \/ > 1100 м/);
});

test("группа фильтра считается по самому тяжёлому уровню события", () => {
  const hardLanding = classify("Грубая посадка при посадочном весе меньше максимально допустимого значения", { Ny: "1,586", VyHg: "-579,2" });
  assert.equal(worstLevel(hardLanding), 4);
  assert.equal(levelFilterOf(hardLanding), "4");
  assert.equal(levelFilterOf(classify("Технологическое сообщение. Скорость на рулении больше рекомендованной 30 knots", { Vgr: "57" })), "none");
  assert.equal(levelFilterOf(classify("Технологическое сообщение. Использование режима TOGA при взлете.")), "unmatched");
});
