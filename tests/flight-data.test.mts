import assert from "node:assert/strict";
import test from "node:test";
import { buildStatisticRows, histogramBins, summarizePilots, type Flight } from "../app/flight-data.ts";

function flight(overrides: Partial<Omit<Flight, "metrics">> & Pick<Flight, "key" | "crew"> & { metrics?: Partial<Flight["metrics"]> }): Flight {
  const base: Flight = {
    key: overrides.key,
    aircraftType: "A-319/320",
    departure: "Шереметьево",
    arrival: "Пулково",
    crew: overrides.crew,
    metrics: {
      takeoffPitch: 10,
      flightLevel: 35000,
      glideslopeEntrySpeed: 140,
      autopilotDisconnectHeight: 200,
      touchdownDistance: 400,
      thresholdToTouchdownTime: 8,
      landingNy: 1.2,
      reverseOffSpeed: 60,
    },
  };
  return { ...base, ...overrides, metrics: { ...base.metrics, ...overrides.metrics } };
}

test("summarizePilots keeps min, average and max for each metric", () => {
  const pilots = summarizePilots([
    flight({
      key: "1",
      crew: [{ role: "КВС", name: "Иванов", code: "100" }],
      metrics: {
        takeoffPitch: 8,
        flightLevel: 33000,
        glideslopeEntrySpeed: 130,
        autopilotDisconnectHeight: 180,
        touchdownDistance: 300,
        thresholdToTouchdownTime: 7,
        landingNy: 1.1,
        reverseOffSpeed: 50,
      },
    }),
    flight({
      key: "2",
      crew: [{ role: "КВС", name: "Иванов", code: "100" }],
      metrics: {
        takeoffPitch: 12,
        flightLevel: 37000,
        glideslopeEntrySpeed: 150,
        autopilotDisconnectHeight: 220,
        touchdownDistance: 500,
        thresholdToTouchdownTime: 9,
        landingNy: 1.4,
        reverseOffSpeed: 70,
      },
    }),
    flight({
      key: "3",
      crew: [{ role: "КВС", name: "Иванов", code: "100" }],
      metrics: {
        takeoffPitch: null,
        flightLevel: null,
        glideslopeEntrySpeed: null,
        autopilotDisconnectHeight: null,
        touchdownDistance: null,
        thresholdToTouchdownTime: null,
        landingNy: 1.3,
        reverseOffSpeed: null,
      },
    }),
  ]);

  assert.equal(pilots.length, 1);
  assert.equal(pilots[0].flights, 3);
  assert.equal(pilots[0].minMetrics.landingNy, 1.1);
  assert.ok(pilots[0].metrics.landingNy !== null);
  assert.ok(Math.abs(pilots[0].metrics.landingNy - (1.1 + 1.4 + 1.3) / 3) < 1e-12);
  assert.equal(pilots[0].maxMetrics.landingNy, 1.4);
  assert.equal(pilots[0].minMetrics.takeoffPitch, 8);
  assert.equal(pilots[0].maxMetrics.takeoffPitch, 12);
  assert.equal(pilots[0].minMetrics.reverseOffSpeed, 50);
  assert.equal(pilots[0].maxMetrics.reverseOffSpeed, 70);
});

test("buildStatisticRows and histogramBins compare a selected group with others", () => {
  const flights = [
    flight({ key: "1", crew: [{ role: "КВС", name: "Иванов", code: "100" }], departure: "Шереметьево", metrics: { landingNy: 1.1 } }),
    flight({ key: "2", crew: [{ role: "КВС", name: "Иванов", code: "100" }], departure: "Внуково", metrics: { landingNy: 1.5 } }),
    flight({ key: "3", crew: [{ role: "КВС", name: "Петров", code: "200" }], departure: "Пулково", metrics: { landingNy: 1.3 } }),
  ];
  const rows = buildStatisticRows(flights, "departure");
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.id === "Внуково")?.maxMetrics.landingNy, 1.5);
  const bins = histogramBins([1.1, 1.5], [1.3], 4);
  assert.ok(bins.length >= 2);
  assert.equal(bins.reduce((sum, bin) => sum + bin.selected, 0), 2);
  assert.equal(bins.reduce((sum, bin) => sum + bin.others, 0), 1);
});
