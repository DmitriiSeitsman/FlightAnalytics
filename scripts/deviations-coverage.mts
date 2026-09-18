// Отчёт покрытия: сколько событий выгрузки матрица отклонений распознаёт.
// Запуск: npm run deviations:coverage -- "<путь к выгрузке событий.xlsx>" [--all]
// По умолчанию считаются только события по технике пилотирования (TP), с --all — все.
import ExcelJS from "exceljs";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeviationMatrix, resolveAircraftRules, type DeviationMatrix } from "../app/deviations/config.ts";
import { classifyEventAll, type ClassifiableEvent } from "../app/deviations/classify.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(root, "config", "deviations");

function loadMatrix(): DeviationMatrix {
  return buildDeviationMatrix(
    readdirSync(configDir)
      .filter((file) => file.endsWith(".json") && file !== "schema.json")
      .sort()
      .map((file) => ({ source: file, data: JSON.parse(readFileSync(join(configDir, file), "utf8")) })),
  );
}

function bump<K>(counter: Map<K, number>, key: K, by = 1): void {
  counter.set(key, (counter.get(key) ?? 0) + by);
}

function sorted<K>(counter: Map<K, number>): [K, number][] {
  return [...counter].sort((a, b) => b[1] - a[1]);
}

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error('Укажите выгрузку событий: npm run deviations:coverage -- "<файл.xlsx>" [--all]');
  process.exit(1);
}
const onlyPilotingTechnique = !flags.includes("--all");

const matrix = loadMatrix();

type EventRow = { type: string; piloting: boolean; event: ClassifiableEvent };
const events = new Map<string, EventRow>();

// Выгрузка за несколько месяцев — это сотня тысяч строк, поэтому читаем потоком:
// обычный readFile держит всю книгу в памяти и падает по heap.
const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { entries: "ignore", sharedStrings: "cache", worksheets: "emit", styles: "ignore" });
let headers: string[] = [];
for await (const worksheet of reader) {
  for await (const row of worksheet) {
    const values = row.values as (ExcelJS.CellValue | undefined)[];
    const text = (index: number) => {
      const value = values[index];
      if (value === null || value === undefined) return "";
      if (typeof value === "object" && "text" in value) return String(value.text ?? "").trim();
      if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
      return String(value).trim();
    };
    if (headers.length === 0) {
      headers = values.map((value) => (value === null || value === undefined ? "" : String(value).trim()));
      continue;
    }
    const column = (name: string) => headers.indexOf(name);
    const cell = (name: string) => {
      const index = column(name);
      return index < 0 ? "" : text(index);
    };
    const id = cell("ID_Sobitiya");
    const eventText = cell("Text_Sobitiya");
    if (!id || !eventText) continue;
    const existing = events.get(id) ?? {
      type: cell("Tip_VS"),
      piloting: cell("TP").toLowerCase() === "true",
      event: { text: eventText, parameters: [] },
    };
    for (const [name, max, min] of [["Parametr_1", "Max_Parametera_1", "Min_Parametera_1"], ["Parametr_2", "Max_Parametera_2", "Min_Parametera_2"]] as const) {
      const parameter = cell(name);
      if (parameter) existing.event.parameters.push({ name: parameter, max: cell(max), min: cell(min) });
    }
    events.set(id, existing);
  }
  break; // события лежат на первом листе
}

const withoutConfig = new Map<string, number>();
const perType = new Map<string, { total: number; matched: number; leveled: number }>();
const perLevel = new Map<string, number>();
const perReason = new Map<string, number>();
const perRule = new Map<string, number>();
const unmatched = new Map<string, number>();
let considered = 0;

for (const { type, piloting, event } of events.values()) {
  if (onlyPilotingTechnique && !piloting) continue;
  considered += 1;
  if (!resolveAircraftRules(matrix, type)) {
    bump(withoutConfig, type || "(тип не указан)");
    continue;
  }
  const stats = perType.get(type) ?? { total: 0, matched: 0, leveled: 0 };
  stats.total += 1;
  const results = classifyEventAll(event, type, matrix);
  if (results.length === 0) {
    bump(unmatched, event.text);
  } else {
    stats.matched += 1;
    if (results.some((result) => result.level !== null)) stats.leveled += 1;
    for (const result of results) {
      bump(perRule, result.rule.key);
      bump(perReason, result.reason);
      bump(perLevel, result.level === null ? "без уровня" : `${result.level} уровень`);
    }
  }
  perType.set(type, stats);
}

const scope = onlyPilotingTechnique ? "по технике пилотирования (TP)" : "всех";
console.log(`\nВыгрузка: ${file}`);
console.log(`Событий ${scope}: ${considered} из ${events.size}`);

console.log("\nТипы ВС без конфига в матрице:");
for (const [type, count] of sorted(withoutConfig)) console.log(`  ${String(count).padStart(6)}  ${type}`);
if (withoutConfig.size === 0) console.log("  —");

console.log("\nПокрытие по типам ВС:");
for (const [type, stats] of [...perType].sort((a, b) => b[1].total - a[1].total)) {
  const share = stats.total ? Math.round((stats.matched / stats.total) * 100) : 0;
  console.log(`  ${type}: распознано ${stats.matched} из ${stats.total} (${share} %), с уровнем — ${stats.leveled}`);
}

console.log("\nПо уровням:");
for (const [level, count] of sorted(perLevel)) console.log(`  ${String(count).padStart(6)}  ${level}`);

console.log("\nПо исходам классификации:");
for (const [reason, count] of sorted(perReason)) console.log(`  ${String(count).padStart(6)}  ${reason}`);

console.log("\nСработавшие правила:");
for (const [key, count] of sorted(perRule)) console.log(`  ${String(count).padStart(6)}  ${key}`);

const silent = matrix.rules.filter((rule) => !perRule.has(rule.key));
console.log(`\nПравил в матрице: ${matrix.rules.length}, не сработало ни разу: ${silent.length}`);
for (const rule of silent) {
  const verified = rule.match.kind === "event" && rule.match.patternVerified ? "текст подтверждён" : "текст не подтверждён";
  console.log(`  ${rule.key} (${verified})`);
}

console.log(`\nНераспознанные тексты (${[...unmatched.values()].reduce((sum, count) => sum + count, 0)} событий, ${unmatched.size} текстов):`);
for (const [text, count] of sorted(unmatched).slice(0, 25)) console.log(`  ${String(count).padStart(6)}  ${text.slice(0, 110)}`);
