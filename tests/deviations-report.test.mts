import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeviationMatrix } from "../app/deviations/config.ts";
import { collectDeviations } from "../app/deviations/summary.ts";
import { buildLevel4Report, buildLevel4PdfDocument, buildLevel4Workbook, REPORT_COLUMNS } from "../app/deviations/report.ts";
import type { Event, Flight } from "../app/flight-data.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(root, "config", "deviations");
const matrix = buildDeviationMatrix(
  readdirSync(configDir)
    .filter((file) => file.endsWith(".json") && file !== "schema.json")
    .sort()
    .map((file) => ({ source: file, data: JSON.parse(readFileSync(join(configDir, file), "utf8")) })),
);

let counter = 0;
function event(text: string, parameters: Record<string, string> = {}): Event {
  counter += 1;
  return {
    id: `e${counter}`, text, color: "clRed", pilotCode: null, pilotName: null, pilotRole: null,
    date: "12.08.2026", flightNumber: "1234", flightId: "f", phase: "", duration: "",
    parameters: Object.entries(parameters).map(([name, value]) => ({ name, max: value, min: value })),
  };
}

function flight(key: string, date: string, detachment: string, events: Event[]): Flight {
  return {
    key, aircraftType: "RRJ-95B", departure: "Шереметьево", arrival: "Пулково",
    crew: [{ role: "CM1", name: "Иванов И.И.", code: "100" }],
    metrics: { takeoffPitch: null, flightLevel: null, glideslopeEntrySpeed: null, autopilotDisconnectHeight: null, touchdownDistance: null, thresholdToTouchdownTime: null, landingNy: null, reverseOffSpeed: null },
    flightNumber: "1234", date, departureTime: "10:35", arrivalTime: "12:05", board: "RA-89000", events, detachment,
  };
}

const surfaces = ["руля направления", "руля высоты", "элеронов"].map((surface) =>
  event(`Перед взлетом не проводилась или проведена не в полном объеме проверка ${surface}`),
);
const flights = [
  flight("f2", "12.08.2026", "ЛО4 RRJ-95 - АЭ 1,ЛО4 RRJ-95 - АЭ 2", surfaces),
  flight("f1", "03.08.2026", "ЛО 5 RRJ-95 - АЭ 1,ЛО 5 RRJ-95 - АЭ 2", [event("Посадка с вертикальной перегрузкой более 1.7 g", { Ny: "2,094" })]),
  flight("f3", "20.08.2026", "ЛО 5 RRJ-95 - АЭ 1,ЛО 5 RRJ-95 - АЭ 2", [event("Расстояние от пролета торца ВПП (h~50 ft) до касания более 800 м", { Sdis: "950" })]),
];
const entries = collectDeviations(flights, matrix);

test("в таблицу учёта попадают только отклонения 4 уровня, по одному на рейс и норматив", () => {
  const report = buildLevel4Report(entries, { generatedAt: new Date("2026-09-19T10:00:00Z") });
  // Перелёт 950 м — это 2 уровень, в таблицу он не идёт.
  assert.equal(report.rows.length, 2);
  // Три события проверки управления на одном рейсе — одна строка.
  assert.deepEqual(report.rows.map((row) => row.index), [1, 2]);
  assert.equal(report.rows[0].dateTime, "03.08.2026, 10:35");
  assert.match(report.rows[0].nature, /Повышенная вертикальная перегрузка на посадке · Ny 2,094 g/);
  assert.match(report.rows[1].nature, /Проверка органов управления/);
  assert.equal(report.rows[1].flightNumber, "1234");
  // Стрелки в бланке нет: в шрифте pdfmake для неё нет глифа, поэтому тире.
  assert.match(report.rows[0].details, /Шереметьево \u2013 Пулково, RRJ-95B/);
  assert.equal(report.periodFrom, "2026-08-03");
  assert.equal(report.periodTo, "2026-08-12");
});

test("отчёт можно ограничить одним лётным отрядом", () => {
  const spb = buildLevel4Report(entries, { detachment: "ЛО5" });
  assert.equal(spb.rows.length, 1);
  assert.match(spb.rows[0].nature, /перегрузка/i);
  const msk = buildLevel4Report(entries, { detachment: "ЛО4" });
  assert.equal(msk.rows.length, 1);
  assert.match(msk.rows[0].nature, /Проверка органов управления/);
  assert.equal(buildLevel4Report(entries, { detachment: "ЛО1" }).rows.length, 0);
});

test("бланк PDF повторяет шапку и колонки приложения № 5", () => {
  const report = buildLevel4Report(entries, { detachment: "ЛО4" });
  const document = buildLevel4PdfDocument(report);
  const content = document.content as unknown as Array<Record<string, unknown>>;
  const texts = content.map((item) => item.text).filter((text) => typeof text === "string") as string[];
  assert.ok(texts.includes("Приложение № 5"));
  assert.ok(texts.includes("АО «Авиакомпания «Россия»"));
  assert.ok(texts.some((text) => text.startsWith("ЛЁТНЫЙ ОТРЯД ЛО4 тип ВС RRJ-95B")));
  assert.ok(texts.includes("Учёта Отклонений 4 уровня по результатам обработки полётной информации"));
  assert.ok(texts.some((text) => /^За период с 12\.08\.2026 по 12\.08\.2026$/.test(text)));
  const table = content.find((item) => "table" in item) as { table: { body: unknown[][] } };
  assert.deepEqual((table.table.body[0] as Array<{ text: string }>).map((cell) => cell.text), REPORT_COLUMNS);
  assert.equal(table.table.body.length, 2);
});

test("пустой отчёт печатается пустым бланком на семь строк", () => {
  const empty = buildLevel4Report([], {});
  const table = (buildLevel4PdfDocument(empty).content as unknown as Array<Record<string, unknown>>).find((item) => "table" in item) as { table: { body: unknown[][] } };
  assert.equal(table.table.body.length, 8);
});

test("книга Excel повторяет тот же бланк", async () => {
  const report = buildLevel4Report(entries, { generatedAt: new Date("2026-09-19T10:00:00Z") });
  const workbook = await buildLevel4Workbook(report);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.name, "Отклонения 4 уровня");
  assert.equal(String(sheet.getCell("A1").value), "АО «Авиакомпания «Россия»");
  const headerRow = sheet.getRow(8);
  assert.deepEqual(REPORT_COLUMNS.map((_, index) => String(headerRow.getCell(index + 1).value)), REPORT_COLUMNS);
  assert.equal(sheet.getRow(9).getCell(1).value, 1);
  assert.equal(String(sheet.getRow(9).getCell(2).value), "03.08.2026, 10:35");
  assert.match(String(sheet.getRow(9).getCell(4).value), /Ny 2,094 g/);
  // Причина, выводы и подпись остаются пустыми.
  for (const column of [5, 6, 7]) assert.equal(String(sheet.getRow(9).getCell(column).value ?? ""), "");
});
