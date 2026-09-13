"use client";

import { useMemo, useState } from "react";
import { type Event, type EventColor, type Flight, shortenPilotName } from "./flight-data";

interface EventsAnalyticsProps {
  flights: Flight[];
  events: Event[];
  aircraftFilter?: string;
  airportFilter?: string;
}

const COLOR_ORDER: EventColor[] = ["clRed", "clOrange", "clBlack", "clOlive", "clFuchsia", "clGreen", "unknown"];
export const COLOR_LABELS: Record<EventColor, string> = {
  clRed: "Красные",
  clOrange: "Оранжевые", 
  clBlack: "Черные",
  clOlive: "Оливковые",
  clFuchsia: "Фиолетовые",
  clGreen: "Зеленые",
  unknown: "Неизвестные"
};

export const COLOR_STYLES: Record<EventColor, { bg: string; text: string; border: string }> = {
  clRed: { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
  clOrange: { bg: "#fff7ed", text: "#ea580c", border: "#fed7aa" },
  clBlack: { bg: "#f3f4f6", text: "#374151", border: "#d1d5db" },
  clOlive: { bg: "#f5f5dc", text: "#556b2f", border: "#d4d4aa" },
  clFuchsia: { bg: "#fdf4ff", text: "#a21caf", border: "#f5d0fe" },
  clGreen: { bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" },
  unknown: { bg: "#f9fafb", text: "#6b7280", border: "#e5e7eb" }
};

export function EventsAnalytics({ flights, events, aircraftFilter, airportFilter }: EventsAnalyticsProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedColors, setSelectedColors] = useState<EventColor[]>([]);
  const eventsPerPage = 50;

  const toggleColor = (color: EventColor) => {
    setSelectedColors((current) =>
      current.includes(color) ? current.filter((item) => item !== color) : [...current, color]
    );
    setCurrentPage(1);
  };

  const clearColorFilter = () => {
    setSelectedColors([]);
    setCurrentPage(1);
  };

  // Фильтруем рейсы сначала
  const filteredFlights = useMemo(() => {
    return flights.filter((flight) => {
      const matchesAircraft = !aircraftFilter || flight.aircraftType === aircraftFilter;
      const matchesAirport = !airportFilter || flight.departure === airportFilter || flight.arrival === airportFilter;
      return matchesAircraft && matchesAirport;
    });
  }, [flights, aircraftFilter, airportFilter]);

  // Собираем события только из отфильтрованных рейсов
  const allEvents = useMemo(() => {
    const resultEvents: Event[] = [];
    
    filteredFlights.forEach(flight => {
      if (flight.events && flight.events.length > 0) {
        flight.events.forEach((event: Event) => {
          // Проверяем дубликаты по ID
          if (!resultEvents.some(e => e.id === event.id)) {
            resultEvents.push(event);
          }
        });
      }
    });
    
    return resultEvents;
  }, [filteredFlights]);

  const eventsByColor = useMemo(() => {
    const grouped: Record<EventColor, Event[]> = {
      clRed: [],
      clOrange: [],
      clBlack: [],
      clOlive: [],
      clFuchsia: [],
      clGreen: [],
      unknown: []
    };
    
    allEvents.forEach(event => {
      if (event.color && grouped[event.color] !== undefined) {
        grouped[event.color].push(event);
      }
    });
    
    return grouped;
  }, [allEvents]);

  const sortedEvents = useMemo(() => {
    const sorted: Event[] = [];
    COLOR_ORDER.forEach(color => {
      sorted.push(...eventsByColor[color]);
    });
    return sorted;
  }, [eventsByColor]);

  // Фильтруем по выбранным цветам
  const filteredEvents = useMemo(() => {
    if (!selectedColors.length) return sortedEvents;
    return sortedEvents.filter((event) => selectedColors.includes(event.color));
  }, [sortedEvents, selectedColors]);

  // Пагинация
  const totalPages = Math.ceil(filteredEvents.length / eventsPerPage);
  const paginatedEvents = useMemo(() => {
    const startIndex = (currentPage - 1) * eventsPerPage;
    return filteredEvents.slice(startIndex, startIndex + eventsPerPage);
  }, [filteredEvents, currentPage]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const stats = useMemo(() => {
    return COLOR_ORDER.map(color => ({
      color,
      label: COLOR_LABELS[color],
      count: eventsByColor[color].length,
      style: COLOR_STYLES[color]
    }));
  }, [eventsByColor]);

  if (!events.length) {
    return (
      <div className="events-analytics-empty">
        <p>Нет данных о событиях. Загрузите файл с событиями.</p>
      </div>
    );
  }

  return (
    <div className="events-analytics">
      <div className="events-stats-grid">
        {stats.map(stat => {
          const isSelected = selectedColors.includes(stat.color);
          const isDimmed = selectedColors.length > 0 && !isSelected;
          return (
            <button
              key={stat.color}
              type="button"
              className={`event-stat-card${isSelected ? " event-stat-card-active" : ""}`}
              aria-pressed={isSelected}
              onClick={() => toggleColor(stat.color)}
              style={{
                background: stat.style.bg,
                borderColor: isSelected ? stat.style.text : stat.style.border,
                opacity: isDimmed ? 0.5 : 1
              }}
            >
              <span style={{ color: stat.style.text }}>{stat.label}</span>
              <strong style={{ color: stat.style.text }}>{stat.count}</strong>
            </button>
          );
        })}
      </div>

      {selectedColors.length > 0 && (
        <div className="events-filter-bar">
          <span>
            Фильтр: {selectedColors.map((color) => COLOR_LABELS[color]).join(", ")}
          </span>
          <button type="button" className="events-filter-reset" onClick={clearColorFilter}>
            Сбросить фильтр
          </button>
        </div>
      )}

      <div className="events-table-container">
        <h3>Все события ({filteredEvents.length})</h3>
        {filteredEvents.length === 0 ? (
          <p className="events-analytics-empty-filter">Нет событий выбранного цвета.</p>
        ) : (
        <div className="table-shell">
          <table className="events-table">
            <thead>
              <tr>
                <th>Цвет</th>
                <th>Событие</th>
                <th>Пилот</th>
                <th>Роль</th>
                <th>Дата</th>
                <th>Рейс</th>
                <th>Фаза</th>
                <th>Длительность</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEvents.map((event, index) => {
                const style = COLOR_STYLES[event.color];
                return (
                  <tr key={`${event.id}-${index}`}>
                    <td>
                      <span 
                        className="event-color-badge"
                        style={{ 
                          background: style.bg, 
                          color: style.text,
                          borderColor: style.border 
                        }}
                      >
                        {COLOR_LABELS[event.color]}
                      </span>
                    </td>
                    <td>{event.text}</td>
                    <td>{event.pilotCode ? `${event.pilotCode} ${shortenPilotName(event.pilotName ?? "")}`.trim() : "—"}</td>
                    <td>{event.pilotRole || "—"}</td>
                    <td>{event.date}</td>
                    <td>{event.flightNumber}</td>
                    <td>{event.phase || "—"}</td>
                    <td>{event.duration || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}

        {totalPages > 1 && (
          <div className="pagination">
            <button 
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="pagination-button"
            >
              ← Назад
            </button>
            <span className="pagination-info">
              Страница {currentPage} из {totalPages}
            </span>
            <button 
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="pagination-button"
            >
              Вперёд →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}