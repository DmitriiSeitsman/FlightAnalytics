"use client";

import { formatFlightDate, formatMetric, metricDefinitions, violatesLimit, type Flight, type Metrics } from "./flight-data";
import { COLOR_LABELS, COLOR_STYLES } from "./events-analytics";

// Диапазон по типу ВС для этого рейса: минимум, среднее и максимум по каждому показателю.
export type FlightTypeSummary = { metrics: Metrics; minMetrics: Metrics; maxMetrics: Metrics };

interface FlightDetailCardProps {
  flight: Flight;
  onClose: () => void;
  positions?: Map<string, "КВС" | "2П">;
  typeSummary?: FlightTypeSummary;
  onSelectPilot?: (code: string, aircraftType: string) => void;
}

// Полоса показывает, где значение рейса внутри диапазона по типу ВС. Цветом здесь не судим:
// красный только за нарушение жёсткого ограничения (metricLimits), диапазон — просто контекст.
function MetricRange({ value, min, max, avg, alert }: { value: number; min: number; max: number; avg: number | null; alert: boolean }) {
  const span = max - min;
  if (!(span > 0)) return null;
  const at = (point: number) => Math.min(100, Math.max(0, ((point - min) / span) * 100));
  const outside = value < min ? "low" : value > max ? "high" : null;
  return (
    <div className="fd-range" aria-hidden="true">
      <span className="fd-range-track" />
      {avg !== null && <span className="fd-range-avg" style={{ left: `${at(avg)}%` }} />}
      {outside
        ? <span className={`fd-range-edge${outside === "high" ? " is-high" : ""}`} />
        : <span className={`fd-range-dot${alert ? " is-alert" : ""}`} style={{ left: `${at(value)}%` }} />}
    </div>
  );
}

export function FlightDetailCard({ flight, onClose, positions, typeSummary, onSelectPilot }: FlightDetailCardProps) {
  const identity = [formatFlightDate(flight.date), flight.aircraftType, flight.board].filter(Boolean).join(" · ");

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
            <h3 className="fd-block-title">
              Параметры полёта
              {typeSummary && <span className="fd-block-note">точка — этот рейс, штрих — среднее по типу {flight.aircraftType}</span>}
            </h3>
            <div className="fd-metrics">
              {metricDefinitions.map((metric) => {
                const value = flight.metrics[metric.key];
                const alert = violatesLimit(metric.key, value);
                const min = typeSummary?.minMetrics[metric.key] ?? null;
                const max = typeSummary?.maxMetrics[metric.key] ?? null;
                const avg = typeSummary?.metrics[metric.key] ?? null;
                const hint = min !== null && max !== null
                  ? `Тип ${flight.aircraftType}: ${formatMetric(min, metric.key)} – ${formatMetric(max, metric.key, true)}, среднее ${formatMetric(avg, metric.key, true)}`
                  : undefined;
                return (
                  <div className="fd-metric" key={metric.key} title={hint}>
                    <div className="fd-metric-top">
                      <span>{metric.label}</span>
                      <b className={alert ? "is-alert" : ""}>{formatMetric(value, metric.key, true)}</b>
                    </div>
                    {value !== null && min !== null && max !== null && (
                      <MetricRange value={value} min={min} max={max} avg={avg} alert={alert} />
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="fd-block-title">События · {flight.events.length}</h3>
            {flight.events.length === 0 ? (
              <p className="pilot-card-empty">Событий не зафиксировано</p>
            ) : (
              <ul className="flight-detail-events">
                {flight.events.map((event) => (
                  <li key={event.id} className="flight-detail-event" style={{ borderLeftColor: COLOR_STYLES[event.color].text }}>
                    <span
                      className="event-color-badge"
                      style={{ background: COLOR_STYLES[event.color].bg, color: COLOR_STYLES[event.color].text, borderColor: COLOR_STYLES[event.color].border }}
                    >
                      {COLOR_LABELS[event.color]}
                    </span>
                    <div className="flight-detail-event-body">
                      <p>{event.text}</p>
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
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
