"use client";

import { formatFlightDate, formatMetric, metricDefinitions, type Flight } from "./flight-data";
import { COLOR_LABELS, COLOR_STYLES } from "./events-analytics";

interface FlightDetailCardProps {
  flight: Flight;
  onClose: () => void;
}

export function FlightDetailCard({ flight, onClose }: FlightDetailCardProps) {
  return (
    <div className="pilot-card-overlay">
      <button type="button" className="pilot-card-backdrop" onClick={onClose} aria-label="Закрыть карточку рейса" />
      <div className="pilot-card flight-detail-card" role="dialog" aria-modal="true" aria-labelledby="flight-detail-title">
        <div className="pilot-card-header">
          <div>
            <h2 id="flight-detail-title">Рейс {flight.flightNumber || "—"}</h2>
            <div className="pilot-card-meta">
              <span className="pilot-card-role">{formatFlightDate(flight.date)}</span>
              <span className="pilot-card-aircraft">{flight.aircraftType}</span>
              <span className="pilot-card-code">Борт: {flight.board || "—"}</span>
            </div>
          </div>
          <button className="pilot-card-close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        <div className="flight-detail-route">
          <span className="route-content">
            <span className="route-departure">{flight.departure}</span>
            <span className="route-arrow">→</span>
            <span className="route-arrival">{flight.arrival}</span>
          </span>
          <span className="flight-detail-times">Вылет {flight.departureTime || "—"} · Посадка {flight.arrivalTime || "—"}</span>
        </div>

        <section className="flight-detail-section">
          <h3>Экипаж</h3>
          {flight.crew.length === 0 ? (
            <p className="pilot-card-empty">Нет данных об экипаже</p>
          ) : (
            <ul className="flight-detail-crew">
              {flight.crew.map((member) => (
                <li key={`${member.role}-${member.code}`}>
                  <span className="flight-detail-crew-role">{member.role}</span>
                  <span className="flight-detail-crew-name">{member.name}</span>
                  <span className="flight-detail-crew-code">Табельный № {member.code}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flight-detail-section">
          <h3>Параметры полёта</h3>
          <div className="flight-detail-metrics">
            {metricDefinitions.map((metric) => (
              <div className="flight-detail-metric" key={metric.key}>
                <span>{metric.label}</span>
                <strong>{formatMetric(flight.metrics[metric.key], metric.key, true)}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="flight-detail-section">
          <h3>События ({flight.events.length})</h3>
          {flight.events.length === 0 ? (
            <p className="pilot-card-empty">Событий не зафиксировано</p>
          ) : (
            <ul className="flight-detail-events">
              {flight.events.map((event) => (
                <li key={event.id} className="flight-detail-event">
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
  );
}
