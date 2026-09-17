import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeviationMatrix, DeviationConfigError, normalizeAircraftKey, resolveAircraftRules } from "../app/deviations/config.ts";

const configDir = join(dirname(fileURLToPath(import.meta.url)), "..", "config", "deviations");

function realConfigs(): { source: string; data: unknown }[] {
  return readdirSync(configDir)
    .filter((file) => file.endsWith(".json") && file !== "schema.json")
    .sort()
    .map((file) => ({ source: file, data: JSON.parse(readFileSync(join(configDir, file), "utf8")) }));
}

// Минимальный валидный конфиг: база для проверок на порчу.
function baseConfig(): Record<string, unknown> {
  return {
    document: { id: "И-04.02-28-24", edition: "06" },
    aircraft: { id: "TU-000", aliases: ["TU-000A"] },
    rules: [
      {
        id: "pitch-high-at-touchdown",
        name: { ru: "Большой угол тангажа на посадке" },
        category: "Attitude",
        match: { kind: "event", textContains: "угол тангажа", parameter: "Pitch" },
        trigger: { type: "threshold", compare: "greater", unit: "°", levels: { 2: 9, 3: 10, 4: 11 } },
      },
    ],
  };
}

function broken(mutate: (config: Record<string, unknown>) => void): DeviationConfigError {
  const config = baseConfig();
  mutate(config);
  try {
    buildDeviationMatrix([{ source: "broken.json", data: config }]);
  } catch (error) {
    assert.ok(error instanceof DeviationConfigError, `ожидалась DeviationConfigError, получено ${String(error)}`);
    return error;
  }
  throw new assert.AssertionError({ message: "битый конфиг прошёл валидацию" });
}

function rulesOf(config: Record<string, unknown>): Record<string, unknown>[] {
  return config.rules as Record<string, unknown>[];
}

test("конфиги из config/deviations проходят валидацию", () => {
  const configs = realConfigs();
  assert.ok(configs.length > 0, "в config/deviations нет ни одного конфига типа ВС");
  const matrix = buildDeviationMatrix(configs);
  assert.equal(matrix.sets.length, configs.length);
  assert.ok(matrix.rules.length > 0);
  const keys = new Set(matrix.rules.map((rule) => rule.key));
  assert.equal(keys.size, matrix.rules.length, "ключи правил должны быть уникальны во всей матрице");
  for (const rule of matrix.rules) assert.equal(rule.key, `${rule.aircraftId}:${rule.id}`);
});

test("тип ВС из выгрузки резолвится через алиасы", () => {
  const matrix = buildDeviationMatrix(realConfigs());
  const set = resolveAircraftRules(matrix, "RRJ-95B");
  assert.ok(set, "RRJ-95B должен резолвиться в конфиг RRJ-95");
  assert.equal(set.aircraftId, "RRJ-95");
  assert.equal(resolveAircraftRules(matrix, "RRJ-95")?.aircraftId, "RRJ-95");
  assert.equal(resolveAircraftRules(matrix, "rrj 95b")?.aircraftId, "RRJ-95");
  assert.equal(resolveAircraftRules(matrix, "A-319/320"), null);
  assert.equal(resolveAircraftRules(matrix, ""), null);
});

test("normalizeAircraftKey игнорирует регистр, пробелы и разделители", () => {
  assert.equal(normalizeAircraftKey("RRJ-95B"), normalizeAircraftKey("rrj 95 b"));
  assert.notEqual(normalizeAircraftKey("RRJ-95"), normalizeAircraftKey("RRJ-95B"));
  assert.equal(normalizeAircraftKey("Б737-800/900"), "б737800900");
});

test("лестница порогов разворачивается по уровням, знак сравнения наследуется", () => {
  const matrix = buildDeviationMatrix(realConfigs());
  const rule = matrix.rules.find((item) => item.key === "RRJ-95:high-acceleration-at-touchdown");
  assert.ok(rule, "в конфиге RRJ-95 нет правила по перегрузке на касании");
  assert.equal(rule.trigger.type, "threshold");
  assert.deepEqual(rule.trigger.type === "threshold" ? rule.trigger.ladder : null, [
    { level: 2, value: 1.76, compare: "greaterOrEqual" },
    { level: 3, value: 1.81, compare: "greaterOrEqual" },
    // уровень 4 в инструкции строго больше 2.0 — свой знак перекрывает знак правила
    { level: 4, value: 2.0, compare: "greater" },
  ]);
});

test("событийное правило получает разбор со значениями по умолчанию", () => {
  const matrix = buildDeviationMatrix([{ source: "base.json", data: baseConfig() }]);
  const rule = matrix.rules[0];
  assert.deepEqual(rule.match, { kind: "event", textContains: "угол тангажа", parameter: "Pitch", use: "max", patternVerified: false });
  assert.deepEqual(rule.source, { page: null, codes: [], origin: "instruction" });
  assert.deepEqual(rule.conditions, []);
  assert.equal(rule.summaryRow, null);
});

test("битый конфиг падает с внятной ошибкой", () => {
  const cases: { name: string; mutate: (config: Record<string, unknown>) => void; expect: string }[] = [
    { name: "id не в kebab-case", mutate: (c) => { rulesOf(c)[0].id = "Pitch High"; }, expect: "rules[0].id" },
    { name: "дубль правила", mutate: (c) => { rulesOf(c).push({ ...rulesOf(c)[0] }); }, expect: "уже объявлено выше" },
    { name: "опечатка в поле", mutate: (c) => { rulesOf(c)[0].trigers = {}; }, expect: "неизвестное поле" },
    { name: "неизвестная категория", mutate: (c) => { rulesOf(c)[0].category = "Landing"; }, expect: "rules[0].category" },
    { name: "лестница не монотонна", mutate: (c) => { (rulesOf(c)[0].trigger as Record<string, unknown>).levels = { 2: 11, 3: 10, 4: 9 }; }, expect: "пороги должны расти" },
    { name: "пустая лестница", mutate: (c) => { (rulesOf(c)[0].trigger as Record<string, unknown>).levels = {}; }, expect: "не задан ни один уровень" },
    { name: "несуществующий уровень", mutate: (c) => { rulesOf(c)[0].trigger = { type: "occurrence", level: 5 }; }, expect: "trigger.level" },
    { name: "нет текста события", mutate: (c) => { rulesOf(c)[0].match = { kind: "event" }; }, expect: "match.textContains" },
    { name: "нет типа ВС", mutate: (c) => { delete c.aircraft; }, expect: "aircraft" },
    { name: "пустой список правил", mutate: (c) => { c.rules = []; }, expect: "без правил" },
  ];
  for (const scenario of cases) {
    const error = broken(scenario.mutate);
    assert.ok(
      error.issues.some((issue) => issue.includes(scenario.expect)),
      `${scenario.name}: в ошибке нет «${scenario.expect}», есть: ${error.issues.join(" | ")}`,
    );
    assert.ok(error.issues.every((issue) => issue.startsWith("broken.json → ")), `${scenario.name}: в ошибке не указан файл`);
  }
});

test("два конфига не могут претендовать на один тип ВС", () => {
  const first = baseConfig();
  const second = baseConfig();
  (second.aircraft as Record<string, unknown>).id = "TU-001";
  assert.throws(
    () => buildDeviationMatrix([{ source: "a.json", data: first }, { source: "b.json", data: second }]),
    (error: unknown) => error instanceof DeviationConfigError && error.issues.some((issue) => issue.includes("уже занят конфигом a.json")),
  );
});
