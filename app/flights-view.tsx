"use client";

import { useMemo, useState } from "react";
import { formatFlightDate, normalizeFlightDate, shortenPilotName, worstEventColor, summarizeEventColors, type Flight } from "./flight-data";
import { COLOR_LABELS, COLOR_STYLES } from "./events-analytics";
import { FlightDetailCard } from "./flight-detail-card";

interface FlightsViewProps {
  flights: Flight[];
}

type FlightsSortKey = "date" | "flightNumber" | "route" | "departureTime" | "arrivalTime" | "board" | "aircraftType";
type SortDirection = "asc" | "desc";

export function FlightsView({ flights }: FlightsViewProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: FlightsSortKey; direction: SortDirection }>({ key: "date", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const perPage = 50;

  const filteredFlights = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    if (!query) return flights;
    return flights.filter((flight) => {
      const crewMatch = flight.crew.some((member) => `${member.name} ${member.code}`.toLocaleLowerCase("ru-RU").includes(query));
      const fieldsMatch = [flight.flightNumber, flight.departure, flight.arrival, flight.board]
        .some((value) => (value ?? "").toLocaleLowerCase("ru-RU").includes(query));
      return crewMatch || fieldsMatch;
    });
  }, [flights, search]);

  const sortedFlights = useMemo(() => {
    const getValue = (flight: Flight, key: FlightsSortKey) => {
      if (key === "date") return normalizeFlightDate(flight.date) ?? flight.date ?? "";
      if (key === "flightNumber") return flight.flightNumber || "";
      if (key === "route") return `${flight.departure} ${flight.arrival}`;
      if (key === "departureTime") return flight.departureTime || "";
      if (key === "arrivalTime") return flight.arrivalTime || "";
      if (key === "board") return flight.board || "";
      return flight.aircraftType || "";
    };
    return [...filteredFlights].sort((a, b) => {
      let comparison = String(getValue(a, sort.key)).localeCompare(String(getValue(b, sort.key)), "ru");
      if (sort.key === "date" && comparison === 0) comparison = (a.departureTime || "").localeCompare(b.departureTime || "");
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [filteredFlights, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedFlights.length / perPage));
  const paginatedFlights = useMemo(() => {
    const start = (currentPage - 1) * perPage;
    return sortedFlights.slice(start, start + perPage);
  }, [sortedFlights, currentPage]);

  const handleSort = (key: FlightsSortKey) => {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));
    setCurrentPage(1);
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    setCurrentPage(1);
  };

  const sortArrow = (key: FlightsSortKey) => (sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "");

  if (!flights.length) {
    return (
      <div className="events-analytics-empty">
        <p>Нет данных о рейсах.</p>
      </div>
    );
  }

  return (
    <div className="flights-view">
      <div className="flights-view-controls">
        <label className="flights-view-search">
          <span>Поиск</span>
          <input
            placeholder="Номер рейса, аэропорт или ФИО/табельный пилота"
            value={search}
            onChange={(event) => handleSearch(event.target.value)}
          />
        </label>
        <div className="flights-view-count">
          <span>Найдено рейсов</span>
          <strong>{sortedFlights.length.toLocaleString("ru-RU")}</strong>
        </div>
      </div>

      {sortedFlights.length === 0 ? (
        <p className="events-analytics-empty-filter">Рейсы по запросу не найдены.</p>
      ) : (
        <div className="table-shell">
          <table className="flights-view-table">
            <thead>
              <tr>
                <th onClick={() => handleSort("date")} className={sort.key === "date" ? "active" : ""}>Дата {sortArrow("date")}</th>
                <th onClick={() => handleSort("flightNumber")} className={sort.key === "flightNumber" ? "active" : ""}>Рейс {sortArrow("flightNumber")}</th>
                <th onClick={() => handleSort("route")} className={sort.key === "route" ? "active" : ""}>Маршрут {sortArrow("route")}</th>
                <th onClick={() => handleSort("departureTime")} className={sort.key === "departureTime" ? "active" : ""}>Вылет {sortArrow("departureTime")}</th>
                <th onClick={() => handleSort("arrivalTime")} className={sort.key === "arrivalTime" ? "active" : ""}>Посадка {sortArrow("arrivalTime")}</th>
                <th onClick={() => handleSort("board")} className={sort.key === "board" ? "active" : ""}>Борт {sortArrow("board")}</th>
                <th onClick={() => handleSort("aircraftType")} className={sort.key === "aircraftType" ? "active" : ""}>Тип ВС {sortArrow("aircraftType")}</th>
                <th>События</th>
              </tr>
            </thead>
            <tbody>
              {paginatedFlights.map((flight, index) => {
                const eventColor = worstEventColor(flight.events);
                const stripeStyle = eventColor ? { boxShadow: `inset 4px 0 0 ${COLOR_STYLES[eventColor].text}` } : undefined;
                const captain = flight.crew.find((member) => member.role === "КВС");
                const copilot = flight.crew.find((member) => member.role === "2П");
                return (
                  <tr key={`${flight.key}-${index}`} className="flights-view-row" onClick={() => setSelectedFlight(flight)}>
                    <td style={stripeStyle}>{formatFlightDate(flight.date)}</td>
                    <td className="flights-view-flight-cell">
                      <strong>{flight.flightNumber || "—"}</strong>
                      <div className="flights-view-crew">
                        {captain && <span>КВС: {shortenPilotName(captain.name)} · {captain.code}</span>}
                        {copilot && <span>2П: {shortenPilotName(copilot.name)} · {copilot.code}</span>}
                        {!captain && !copilot && <span className="flights-view-crew-empty">Экипаж не указан</span>}
                      </div>
                    </td>
                    <td className="route-cell">
                      <span className="route-content">
                        <span className="route-departure">{flight.departure}</span>
                        <span className="route-arrow">→</span>
                        <span className="route-arrival">{flight.arrival}</span>
                      </span>
                    </td>
                    <td>{flight.departureTime || "—"}</td>
                    <td>{flight.arrivalTime || "—"}</td>
                    <td>{flight.board || "—"}</td>
                    <td>{flight.aircraftType}</td>
                    <td>
                      {eventColor ? (
                        <span
                          className="event-flight-badge"
                          title={summarizeEventColors(flight.events, COLOR_LABELS)}
                          style={{ background: COLOR_STYLES[eventColor].bg, color: COLOR_STYLES[eventColor].text, borderColor: COLOR_STYLES[eventColor].border }}
                        >
                          {flight.events.length}
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button className="pagination-button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1}>← Назад</button>
          <span className="pagination-info">Страница {currentPage} из {totalPages}</span>
          <button className="pagination-button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage === totalPages}>Вперёд →</button>
        </div>
      )}

      {selectedFlight && <FlightDetailCard flight={selectedFlight} onClose={() => setSelectedFlight(null)} />}
    </div>
  );
}
