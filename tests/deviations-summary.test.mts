import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeviationMatrix } from "../app/deviations/config.ts";
import { baseOfDetachment, commanderDetachment, parseDetachmentConfig } from "../app/deviations/detachments.ts";
import { aircraftColumnOf, buildSummaryTable, cellKey, collectDeviations, ALL_BASES } from "../app/deviations/summary.ts";
import type { Event, Flight } from "../app/flight-data.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configDir = join(root, "config", "deviations");
const matrix = buildDeviationMatrix(
  readdirSync(configDir)
    .filter((file) => file.endsWith(".json") && file !== "schema.json")
    .sort()
    .map((file) => ({ source: file, data: JSON.parse(readFileSync(join(configDir, file), "utf8")) })),
);
const detachments = parseDetachmentConfig(JSON.parse(readFileSync(join(root, "config", "detachments.json"), "utf8")));

let eventCounter = 0;
function event(text: string, parameters: Record<string, string> = {}): Event {
  eventCounter += 1;
  return {
    id: `e${eventCounter}`,
    text,
    color: "clBlack",
    pilotCode: null,
    pilotName: null,
    pilotRole: null,
    date: "01.05.2026",
    flightNumber: "1234",
    flightId: "f",
    phase: "",
    duration: "",
    parameters: Object.entries(parameters).map(([name, value]) => ({ name, max: value, min: value })),
  };
}

function flight(key: string, detachment: string, events: Event[], aircraftType = "RRJ-95B"): Flight {
  return {
    key,
    aircraftType,
    departure: "Шереметьево",
    arrival: "Пулково",
    crew: [{ role: "CM1", name: "Иванов И.И.", code: "100" }],
    metrics: { takeoffPitch: null, flightLevel: null, glideslopeEntrySpeed: null, autopilotDisconnectHeight: null, touchdownDistance: null, thresholdToTouchdownTime: null, landingNy: null, reverseOffSpeed: null },
    flightNumber: "1234",
    date: "01.05.2026",
    departureTime: "10:00",
    arrivalTime: "12:00",
    board: "RA-89000",
    events,
    detachment,
  };
}

test("база рейса берётся по отряду командира", () => {
  assert.equal(commanderDetachment("ЛО4 RRJ-95 - АЭ 1,ЛО4 RRJ-95 - АЭ 6"), "ЛО4");
  assert.equal(commanderDetachment("ЛО 5 RRJ-95 - АЭ 3,Учебная АЭ - УАЭ 1"), "ЛО5");
  assert.equal(commanderDetachment("СЛТС - ОПЛС ДПП,ЛО4 RRJ-95 - АЭ 1"), null);

  assert.equal(baseOfDetachment("ЛО4 RRJ-95 - АЭ 5 МСК,УТО - УТО RRJ-95", detachments), "МСК");
  assert.equal(baseOfDetachment("ЛО2 Б-737/А-319/320 - АЭ 4 (СПБ),ЛО2 Б-737/А-319/320 - АЭ 2", detachments), "МСК");
  assert.equal(baseOfDetachment("ЛО 5 RRJ-95 - АЭ 2,ЛО 5 RRJ-95 - АЭ 1", detachments), "СПБ");
  assert.equal(baseOfDetachment("ЛО 1 - АЭ 3,ЛО 1 - АЭ 3", detachments), "СПБ");
  // ЛО 3 (777/747) и учебные подразделения в справочнике не заведены.
  assert.equal(baseOfDetachment("ЛО3 - АЭ 1,ЛО3 - АЭ 1", detachments), null);
  assert.equal(baseOfDetachment("", detachments), null);
});

test("справочник отрядов проверяется при загрузке", () => {
  assert.throws(() => parseDetachmentConfig({ detachments: [{ id: "ЛО 9", prefix: "ЛО9", base: "КЗН" }] }), /base/);
  assert.throws(() => parseDetachmentConfig({ detachments: [] }), /пустой список/);
});

test("тип ВС из выгрузки ложится в колонку бланка", () => {
  assert.equal(aircraftColumnOf("RRJ-95B"), "rrj95");
  assert.equal(aircraftColumnOf("Boeing-737-900ER"), "738");
  assert.equal(aircraftColumnOf("Boeing 777-300ER"), "773");
  assert.equal(aircraftColumnOf("Boeing 747-400"), "744");
  assert.equal(aircraftColumnOf("Airbus 319"), "a319320");
  assert.equal(aircraftColumnOf("A-320"), "a319320");
  assert.equal(aircraftColumnOf("Ан-24"), "other");
});

test("сводка считает рейсы, а не события, и разносит их по базам", () => {
  const surfaces = ["руля направления", "руля высоты", "элеронов", "спойлеров"].map((surface) =>
    event(`Перед взлетом не проводилась или проведена не в полном объеме проверка ${surface}`),
  );
  const flights = [
    flight("msk-1", "ЛО4 RRJ-95 - АЭ 1,ЛО4 RRJ-95 - АЭ 2", surfaces),
    flight("spb-1", "ЛО 5 RRJ-95 - АЭ 2,ЛО 5 RRJ-95 - АЭ 1", [event("Расстояние от пролета торца ВПП (h~50 ft) до касания более 800 м", { Sdis: "1028,37" })]),
  ];
  const entries = collectDeviations(flights, matrix);
  const summary = buildSummaryTable(flights, entries, detachments);
  assert.equal(summary.columns.length, 1);
  assert.equal(summary.columns[0].key, "rrj95");

  const sop = summary.rows.find((row) => row.row === "отклонение выполнения СОП")!;
  const sopLevel4 = sop.levels.find((level) => level.level === 4)!;
  // Четыре события одной проверки управления — один рейс с отклонением.
  assert.deepEqual(sopLevel4.cells.get(cellKey("rrj95", ALL_BASES)), { flights: 1, events: 4 });
  assert.deepEqual(sopLevel4.cells.get(cellKey("rrj95", "МСК")), { flights: 1, events: 4 });
  assert.deepEqual(sopLevel4.cells.get(cellKey("rrj95", "СПБ")), { flights: 0, events: 0 });
  assert.deepEqual(sopLevel4.cells.get(cellKey("total", ALL_BASES)), { flights: 1, events: 4 });

  const long = summary.rows.find((row) => row.row === "перелёт при посадке")!;
  const longLevel3 = long.levels.find((level) => level.level === 3)!;
  assert.deepEqual(longLevel3.cells.get(cellKey("rrj95", "СПБ")), { flights: 1, events: 1 });
  assert.deepEqual(longLevel3.cells.get(cellKey("rrj95", "МСК")), { flights: 0, events: 0 });

  const totals4 = summary.levelTotals.find((level) => level.level === 4)!;
  assert.equal(totals4.cells.get(cellKey("total", ALL_BASES))!.flights, 1);
  const totals3 = summary.levelTotals.find((level) => level.level === 3)!;
  assert.equal(totals3.cells.get(cellKey("total", ALL_BASES))!.flights, 1);
});

test("одно событие с двумя нормативами попадает в две строки сводки", () => {
  const flights = [flight("f1", "ЛО4 RRJ-95 - АЭ 1,ЛО4 RRJ-95 - АЭ 1", [
    event("Грубая посадка при посадочном весе меньше максимально допустимого значения", { Ny: "1,9", VyHg: "-579,2" }),
  ])];
  const entries = collectDeviations(flights, matrix);
  assert.equal(entries.length, 2);
  const summary = buildSummaryTable(flights, entries, detachments);
  const ny = summary.rows.find((row) => row.row === "повышенная перегрузка при посадке Ny")!;
  const vy = summary.rows.find((row) => row.row === "повышенная вертикальная скорость Vy")!;
  assert.equal(ny.levels.find((level) => level.level === 3)!.total.flights, 1);
  assert.equal(vy.levels.find((level) => level.level === 4)!.total.flights, 1);
});

test("ручная оценка и уходы на 2-й круг считаются отдельными строками", () => {
  const flights = [flight("f1", "ЛО 1 - АЭ 3,ЛО 1 - АЭ 3", [
    event("Технологическое сообщение. Скорость на рулении больше рекомендованной 30 knots", { Vgr: "57" }),
    event("Технологическое сообщение. Уход на 2-й круг"),
  ])];
  const summary = buildSummaryTable(flights, collectDeviations(flights, matrix), detachments);
  const manual = summary.extras.find((row) => row.label === "Требуют ручной оценки")!;
  const goaround = summary.extras.find((row) => row.label === "Уходы на 2-ой круг")!;
  assert.equal(manual.cells.get(cellKey("total", ALL_BASES))!.flights, 1);
  assert.equal(manual.cells.get(cellKey("rrj95", "СПБ"))!.flights, 1);
  assert.equal(goaround.cells.get(cellKey("total", ALL_BASES))!.flights, 1);
});

test("сводное сообщение GPWS не задваивает конкретное", () => {
  // Источник шлёт «Предупреждение GPWS (уровень Caution)» вместе с речевым сообщением.
  const both = [flight("f1", "ЛО4 RRJ-95 - АЭ 1,ЛО4 RRJ-95 - АЭ 1", [
    event("Речевое сообщение DON'T SINK – не снижайся"),
    event("Предупреждение GPWS (уровень Caution)"),
  ])];
  const paired = collectDeviations(both, matrix);
  assert.deepEqual(paired.map((entry) => entry.classification.rule.id), ["taws-caution-dont-sink"]);

  // Если конкретного сообщения в рейсе нет, сводное остаётся отклонением.
  const alone = [flight("f2", "ЛО4 RRJ-95 - АЭ 1,ЛО4 RRJ-95 - АЭ 1", [event("Предупреждение GPWS (уровень Caution)")])];
  const single = collectDeviations(alone, matrix);
  assert.deepEqual(single.map((entry) => entry.classification.rule.id), ["gpws-caution-summary"]);
  assert.equal(single[0].classification.level, 2);

  const summary = buildSummaryTable([...both, ...alone], collectDeviations([...both, ...alone], matrix), detachments);
  const alerts = summary.rows.find((row) => row.row === "оповещение")!;
  // Два рейса, по одному отклонению 2 уровня в каждом, а не три.
  assert.equal(alerts.levels.find((level) => level.level === 2)!.total.flights, 2);
  assert.equal(alerts.levels.find((level) => level.level === 2)!.total.events, 2);
});
