"use client";

import { airportAverageFor, formatFlightCount, formatFlightDate, formatMetric, metricDefinitions, type AirportAverages, type Flight, type Metrics } from "./flight-data";
import { MarkerGlyph } from "./marker-icons";
import { COLOR_LABELS, COLOR_STYLES } from "./events-analytics";
import { classifyEventAll, classifyMetric } from "./deviations/classify";
import { deviationMatrix } from "./deviations/registry";
import { DeviationBadge } from "./deviations/badge";
import { deviationSummary, displayDeviation, LEVEL_STYLES, worstLevel } from "./deviations/presentation";

// Диапазон по типу ВС для этого рейса: минимум, среднее и максимум по каждому показателю.
// flights — сколько рейсов типа попало в выборку; нужно легенде, чтобы честно сказать,
// на чём построено среднее.
export type FlightTypeSummary = { metrics: Metrics; minMetrics: Metrics; maxMetrics: Metrics; flights?: number };

interface FlightDetailCardProps {
  flight: Flight;
  onClose: () => void;
  positions?: Map<string, "КВС" | "2П">;
  typeSummary?: FlightTypeSummary;
  airportAverages?: AirportAverages;
  onSelectPilot?: (code: string, aircraftType: string) => void;
}

// Полоса показывает, где значение рейса внутри диапазона по типу ВС. Цветом здесь не судим:
// красный только за норматив из матрицы, диапазон — просто контекст.
// Три дорожки, чтобы силуэты не наезжали друг на друга: вышка аэропорта — над полосой,
// значение рейса — на самой полосе, среднее по типу ВС — под полосой.
function MetricRange({ value, min, max, avg, airport, alert }: { value: number; min: number; max: number; avg: number | null; airport: number | null; alert: boolean }) {
  const span = max - min;
  if (!(span > 0)) return null;
  const at = (point: number) => Math.min(100, Math.max(0, ((point - min) / span) * 100));
  const outside = value < min ? "low" : value > max ? "high" : null;
  return (
    <div className="fd-range" aria-hidden="true">
      <span className="fd-range-track" />
      {airport !== null && (
        <span className="fd-marker is-airport" style={{ left: `${at(airport)}%` }}><MarkerGlyph kind="airport" size={13} /></span>
      )}
      {avg !== null && (
        <span className="fd-marker is-type" style={{ left: `${at(avg)}%` }}><MarkerGlyph kind="plane" /></span>
      )}
      {outside
        ? <span className={`fd-range-edge${outside === "high" ? " is-high" : ""}`} />
        : <span className={`fd-marker is-flight${alert ? " is-alert" : ""}`} style={{ left: `${at(value)}%` }}><MarkerGlyph kind="pilot" halo /></span>}
    </div>
  );
}

export function FlightDetailCard({ flight, onClose, positions, typeSummary, airportAverages, onSelectPilot }: FlightDetailCardProps) {
  const identity = [formatFlightDate(flight.date), flight.aircraftType, flight.board].filter(Boolean).join(" · ");
  // Уровни отклонений по матрице нормативов: одно событие может отвечать сразу двум нормативам.
  const deviations = flight.events.map((event) => classifyEventAll(event, flight.aircraftType, deviationMatrix));
  const levelCounts = new Map<number, number>();
  for (const classifications of deviations) {
    const level = worstLevel(classifications);
    if (level !== null) levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
  }
  const levels = [4, 3, 2].filter((level) => levelCounts.has(level));
  // Аэропорты вылета и посадки нужны и легенде, и полосам, поэтому достаём их один раз.
  const departureAverage = airportAverageFor(airportAverages, flight, "departure");
  const arrivalAverage = airportAverageFor(airportAverages, flight, "arrival");

  return (
    <div className="pilot-card-overlay">
      <button type="button" className="pilot-card-backdrop" onClick={onClose} aria-label="Закрыть карточку рейса" />
      <div className="pilot-card flight-detail-card" role="dialog" aria-modal="true" aria-labelledby="flight-detail-title">
        <div className="fd-head">
          <button className="pilot-card-close" onClick={onClose} aria-label="Закрыть">×</button>
          <div className="fd-title">
            <h2 id="flight-detail-title">Рейс {flight.flightNumber || "—"}</h2>
            <span>{identity}</span>
          </div>
          <div className="fd-route">
            {flight.departure} <i aria-hidden="true">→</i> {flight.arrival}
            <em>вылет {flight.departureTime || "—"} · посадка {flight.arrivalTime || "—"}</em>
          </div>
        </div>

        <div className="fd-body">
          <section>
            <h3 className="fd-block-title">Экипаж</h3>
            {flight.crew.length === 0 ? (
              <p className="pilot-card-empty">Нет данных об экипаже</p>
            ) : (
              <ul className="fd-crew">
                {flight.crew.map((member) => {
                  const position = positions?.get(`${member.code}:${flight.aircraftType}`);
                  const inner = (
                    <>
                      <span className={`fd-seat${member.role === "CM2" ? " is-second" : ""}`}>{member.role}</span>
                      <div>
                        <b>{member.name}{position ? ` (${position})` : ""}</b>
                        <small>Табельный № {member.code}</small>
                      </div>
                      {onSelectPilot && <i className="fd-crew-go" aria-hidden="true">→</i>}
                    </>
                  );
                  return (
                    <li key={`${member.role}-${member.code}`}>
                      {onSelectPilot ? (
                        <button
                          type="button"
                          className="fd-crew-item is-link"
                          title="Открыть карточку пилота"
                          onClick={() => onSelectPilot(member.code, flight.aircraftType)}
                        >
                          {inner}
                        </button>
                      ) : (
                        <div className="fd-crew-item">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3 className="fd-block-title">Параметры полёта</h3>
            {typeSummary && (
              <ul className="fd-legend">
                <li>
                  <span className="fd-legend-mark"><MarkerGlyph kind="pilot" /></span>
                  <span><b>Этот рейс</b> — значение из выгрузки. Полоса под ним — диапазон от минимума до максимума по типу {flight.aircraftType}.</span>
                </li>
                <li>
                  <span className="fd-legend-mark is-type"><MarkerGlyph kind="plane" /></span>
                  <span><b>Среднее по типу {flight.aircraftType}</b> — среднее арифметическое по всем рейсам этого типа в выборке{typeSummary.flights ? ` (${formatFlightCount(typeSummary.flights)})` : ""}.</span>
                </li>
                {(departureAverage || arrivalAverage) && (
                  <li>
                    <span className="fd-legend-mark is-airport"><MarkerGlyph kind="airport" size={13} /></span>
                    <span>
                      <b>Среднее по аэропорту</b> — только по рейсам того же типа ВС в этом аэропорту.
                      {departureAverage && <> Тангаж на отрыве — аэропорт вылета ({departureAverage.airport}, {formatFlightCount(departureAverage.flights)}).</>}
                      {arrivalAverage && <> Посадочные показатели — аэропорт посадки ({arrivalAverage.airport}, {formatFlightCount(arrivalAverage.flights)}).</>}
                      {" "}У эшелона полёта аэропорта нет, поэтому на его полосе только два маркера.
                    </span>
                  </li>
                )}
              </ul>
            )}
            <div className="fd-metrics">
              {metricDefinitions.map((metric) => {
                const value = flight.metrics[metric.key];
                // Предел по показателю рейса — из матрицы нормативов для этого типа ВС.
                const limit = classifyMetric(metric.key, value, flight.aircraftType, deviationMatrix);
                const alert = limit !== null && limit.level !== null;
                const min = typeSummary?.minMetrics[metric.key] ?? null;
                const max = typeSummary?.maxMetrics[metric.key] ?? null;
                const avg = typeSummary?.metrics[metric.key] ?? null;
                // Для тангажа сравниваем с аэропортом вылета, для посадочных показателей — с аэропортом посадки.
                const airport = metric.airportScope === "departure" ? departureAverage : metric.airportScope === "arrival" ? arrivalAverage : null;
                const airportValue = airport?.metrics[metric.key] ?? null;
                const typeHint = min !== null && max !== null
                  ? `Тип ${flight.aircraftType}: ${formatMetric(min, metric.key)} – ${formatMetric(max, metric.key, true)}, среднее ${formatMetric(avg, metric.key, true)}`
                  : null;
                const airportHint = airport && airportValue !== null
                  ? `${airport.airport} (${airport.aircraftType}, рейсов: ${airport.flights}): среднее ${formatMetric(airportValue, metric.key, true)}`
                  : null;
                const hint = [typeHint, airportHint].filter(Boolean).join(" · ") || undefined;
                return (
                  <div className="fd-metric" key={metric.key} title={hint}>
                    <div className="fd-metric-top">
                      <span>{metric.label}</span>
                      <span className="fd-metric-value">
                        {alert && limit && <DeviationBadge display={displayDeviation(limit)} />}
                        <b className={alert ? "is-alert" : ""}>{formatMetric(value, metric.key, true)}</b>
                      </span>
                    </div>
                    {value !== null && min !== null && max !== null && (
                      <MetricRange value={value} min={min} max={max} avg={avg} airport={airportValue} alert={alert} />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="fd-block-title">
              События · {flight.events.length}
              {levels.length > 0 && (
                <span className="fd-level-counts">
                  {levels.map((level) => (
                    <span
                      key={level}
                      className="fd-level-count"
                      style={{ background: LEVEL_STYLES[level as 2 | 3 | 4].bg, color: LEVEL_STYLES[level as 2 | 3 | 4].text, borderColor: LEVEL_STYLES[level as 2 | 3 | 4].border }}
                    >
                      {level} уровень — {levelCounts.get(level)}
                    </span>
                  ))}
                </span>
              )}
            </h3>
            {flight.events.length === 0 ? (
              <p className="pilot-card-empty">Событий не зафиксировано</p>
            ) : (
              <ul className="flight-detail-events">
                {flight.events.map((event, eventIndex) => {
                  const classifications = deviations[eventIndex];
                  const level = worstLevel(classifications);
                  // Полоса слева — по уровню отклонения, если он известен; иначе по цвету из выгрузки.
                  const accent = level === null ? COLOR_STYLES[event.color].text : LEVEL_STYLES[level].text;
                  return (
                  <li key={event.id} className="flight-detail-event" style={{ borderLeftColor: accent }}>
                    <div className="flight-detail-event-marks">
                      <span
                        className="event-color-badge"
                        style={{ background: COLOR_STYLES[event.color].bg, color: COLOR_STYLES[event.color].text, borderColor: COLOR_STYLES[event.color].border }}
                      >
                        {COLOR_LABELS[event.color]}
                      </span>
                      {classifications.map((classification) => (
                        <DeviationBadge key={classification.rule.key} display={displayDeviation(classification)} />
                      ))}
                    </div>
                    <div className="flight-detail-event-body">
                      <p>{event.text}</p>
                      {classifications.map((classification) => (
                        <p className="flight-detail-event-rule" key={classification.rule.key}>{deviationSummary(classification)}</p>
                      ))}
                      {(event.phase || event.duration) && (
                        <div className="flight-detail-event-meta">
                          {event.phase && <span>Фаза: {event.phase}</span>}
                          {event.duration && <span>Длительность: {event.duration}</span>}
                        </div>
                      )}
                      {event.parameters.length > 0 && (
                        <ul className="flight-detail-event-params">
                          {event.parameters.map((param, index) => (
                            <li key={index}>{param.name || "Параметр"}: мин {param.min || "—"} / макс {param.max || "—"}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
