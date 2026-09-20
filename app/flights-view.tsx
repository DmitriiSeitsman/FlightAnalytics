"use client";

import { useMemo, useState } from "react";
import { formatFlightDate, normalizeFlightDate, shortenPilotName, summarizeFlights, worstEventColor, summarizeEventColors, type Flight } from "./flight-data";
import { COLOR_LABELS, COLOR_STYLES } from "./events-analytics";
import { FlightDetailCard, type FlightTypeSummary } from "./flight-detail-card";

interface FlightsViewProps {
  flights: Flight[];
  positions?: Map<string, "КВС" | "2П">;
  onSelectPilot?: (code: string, aircraftType: string) => void;
}

type FlightsSortKey = "date" | "flightNumber" | "route" | "departureTime" | "arrivalTime" | "board" | "aircraftType";
type SortDirection = "asc" | "desc";

// Заголовок-кнопка: стрелка всегда на месте и не дёргает ширину колонки при сортировке.
function SortHeader({ label, columnKey, sort, onSort, left }: { label: string; columnKey: FlightsSortKey; sort: { key: FlightsSortKey; direction: SortDirection }; onSort: (key: FlightsSortKey) => void; left?: boolean }) {
  const active = sort.key === columnKey;
  return (
    <th scope="col" className={left ? "is-left" : undefined} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={`data-sort${active ? " is-active" : ""}${active && sort.direction === "asc" ? " is-asc" : ""}`} onClick={() => onSort(columnKey)}>
        <span>{label}</span>
        <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true"><path d="M1 1.3 L5 4.7 L9 1.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </th>
  );
}

export function FlightsView({ flights, positions, onSelectPilot }: FlightsViewProps) {
  // Диапазоны по типам ВС для полос в карточке рейса: считаем один раз на всю выборку.
  const typeSummaries = useMemo(
    () => new Map<string, FlightTypeSummary>(summarizeFlights(flights, "aircraftType").map((item) => [item.label, item])),
    [flights],
  );
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
          <table className="data-table flights-view-table">
            <thead>
              <tr>
                <SortHeader label="Дата" columnKey="date" sort={sort} onSort={handleSort} left />
                <SortHeader label="Рейс" columnKey="flightNumber" sort={sort} onSort={handleSort} left />
                <SortHeader label="Маршрут" columnKey="route" sort={sort} onSort={handleSort} left />
                <SortHeader label="Вылет" columnKey="departureTime" sort={sort} onSort={handleSort} />
                <SortHeader label="Посадка" columnKey="arrivalTime" sort={sort} onSort={handleSort} />
                <SortHeader label="Борт" columnKey="board" sort={sort} onSort={handleSort} left />
                <SortHeader label="Тип ВС" columnKey="aircraftType" sort={sort} onSort={handleSort} left />
                <th scope="col" className="is-left">Экипаж</th>
                <th scope="col" className="is-center">События</th>
              </tr>
            </thead>
            <tbody>
              {paginatedFlights.map((flight, index) => {
                const eventColor = worstEventColor(flight.events);
                const stripeStyle = eventColor ? { boxShadow: `inset 4px 0 0 ${COLOR_STYLES[eventColor].text}` } : undefined;
                const captain = flight.crew.find((member) => member.role === "CM1");
                const copilot = flight.crew.find((member) => member.role === "CM2");
                const dash = <span className="is-muted">—</span>;
                return (
                  <tr
                    key={`${flight.key}-${index}`}
                    className="flights-view-row"
                    tabIndex={0}
                    aria-label={`Рейс ${flight.flightNumber || ""} ${formatFlightDate(flight.date)}, ${flight.departure} — ${flight.arrival}`}
                    onClick={() => setSelectedFlight(flight)}
                    onKeyDown={(keyEvent) => {
                      if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
                      keyEvent.preventDefault();
                      setSelectedFlight(flight);
                    }}
                  >
                    <th scope="row" className="is-left flights-date-cell" style={stripeStyle} title={eventColor ? summarizeEventColors(flight.events, COLOR_LABELS) : undefined}>
                      {formatFlightDate(flight.date)}
                    </th>
                    <td className="is-left flights-number-cell"><strong>{flight.flightNumber || "—"}</strong></td>
                    <td className="is-left route-cell">
                      <span className="route-content">
                        <span className="route-departure">{flight.departure}</span>
                        <span className="route-arrow" aria-hidden="true">→</span>
                        <span className="route-arrival">{flight.arrival}</span>
                      </span>
                    </td>
                    <td>{flight.departureTime || dash}</td>
                    <td>{flight.arrivalTime || dash}</td>
                    <td className="is-left flights-board-cell">{flight.board || dash}</td>
                    <td className="is-left">{flight.aircraftType || dash}</td>
                    <td className="is-left flights-crew-cell">
                      {captain && <span><i>КВС</i>{shortenPilotName(captain.name)}<b>{captain.code}</b></span>}
                      {copilot && <span><i className="is-second">2П</i>{shortenPilotName(copilot.name)}<b>{copilot.code}</b></span>}
                      {!captain && !copilot && <span className="flights-view-crew-empty">Экипаж не указан</span>}
                    </td>
                    <td className="is-center">
                      {eventColor ? (
                        <span
                          className="event-flight-badge"
                          title={summarizeEventColors(flight.events, COLOR_LABELS)}
                          style={{ background: COLOR_STYLES[eventColor].bg, color: COLOR_STYLES[eventColor].text, borderColor: COLOR_STYLES[eventColor].border }}
                        >
                          {flight.events.length}
                        </span>
                      ) : dash}
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

      {selectedFlight && <FlightDetailCard
        flight={selectedFlight}
        onClose={() => setSelectedFlight(null)}
        positions={positions}
        typeSummary={typeSummaries.get(selectedFlight.aircraftType)}
        onSelectPilot={onSelectPilot && ((code, type) => { setSelectedFlight(null); onSelectPilot(code, type); })}
      />}
    </div>
  );
}
