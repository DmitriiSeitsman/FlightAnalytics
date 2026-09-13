"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatFlightDate, formatMetric, metricDefinitions, normalizeFlightDate, worstEventColor, summarizeEventColors, type Flight, type FlightMetricKey, type PilotSummary } from "./flight-data";
import { PilotRadarChart, type PilotRadarAxis } from "./histogram";
import { COLOR_LABELS, COLOR_STYLES } from "./events-analytics";
import { FlightDetailCard } from "./flight-detail-card";

interface PilotCardProps {
  pilot: PilotSummary;
  flights: Flight[];
  onClose: () => void;
}

type FlightSortKey = "date" | "flightNumber" | "route" | "departureTime" | "arrivalTime" | "board" | FlightMetricKey;
type SortDirection = "asc" | "desc";

type PilotCardTab = "stats" | "flights";

export function PilotCard({ pilot, flights, onClose }: PilotCardProps) {
  const [tab, setTab] = useState<PilotCardTab>("stats");
  const [selectedFlight, setSelectedFlight] = useState<Flight | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<FlightMetricKey>("landingNy");
  const [flightSearch, setFlightSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [flightSort, setFlightSort] = useState<{ key: FlightSortKey; direction: SortDirection }>({ key: "date", direction: "desc" });

  const pilotFlights = useMemo(() => 
    flights.filter((flight) => 
      flight.crew.some((member) => member.code === pilot.code && member.role === pilot.role && flight.aircraftType === pilot.aircraftType)
    ), [flights, pilot]
  );

  const dateRange = useMemo(() => {
    const dates = pilotFlights.map((flight) => normalizeFlightDate(flight.date)).filter((date): date is string => Boolean(date));
    if (dates.length === 0) return { min: "", max: "", displayMin: "", displayMax: "" };
    const sorted = [...dates].sort();
    const [firstYear, firstMonth] = sorted[0].split("-").map(Number);
    const [lastYear, lastMonth] = sorted[sorted.length - 1].split("-").map(Number);
    const min = `${String(firstYear).padStart(4, "0")}-${String(firstMonth).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(lastYear, lastMonth, 0)).getUTCDate();
    const max = `${String(lastYear).padStart(4, "0")}-${String(lastMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return {
      min,
      max,
      displayMin: formatFlightDate(min),
      displayMax: formatFlightDate(max),
    };
  }, [pilotFlights]);

  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current && dateRange.min) {
      setDateFrom(dateRange.min);
      setDateTo(dateRange.max);
      initialized.current = true;
    }
  }, [dateRange.min, dateRange.max]);

  const filteredFlights = useMemo(() => {
    return pilotFlights.filter((flight) => {
      const matchesSearch = !flightSearch || 
        flight.flightNumber?.toLowerCase().includes(flightSearch.toLowerCase()) ||
        flight.board?.toLowerCase().includes(flightSearch.toLowerCase()) ||
        `${flight.departure} ${flight.arrival}`.toLowerCase().includes(flightSearch.toLowerCase());
      
      const flightDateForCompare = normalizeFlightDate(flight.date) ?? "";
      const matchesDateFrom = !dateFrom || flightDateForCompare >= dateFrom;
      const matchesDateTo = !dateTo || flightDateForCompare <= dateTo;
      
      return matchesSearch && matchesDateFrom && matchesDateTo;
    });
  }, [pilotFlights, flightSearch, dateFrom, dateTo]);

  const sortedFlights = useMemo(() => {
    return [...filteredFlights].sort((a, b) => {
      const getValue = (flight: Flight, key: FlightSortKey) => {
        if (key === "date") return normalizeFlightDate(flight.date) ?? flight.date ?? "";
        if (key === "flightNumber") return flight.flightNumber || "";
        if (key === "route") return `${flight.departure} ${flight.arrival}`;
        if (key === "departureTime") return flight.departureTime || "";
        if (key === "arrivalTime") return flight.arrivalTime || "";
        if (key === "board") return flight.board || "";
        return flight.metrics[key as FlightMetricKey];
      };

      const aVal = getValue(a, flightSort.key);
      const bVal = getValue(b, flightSort.key);
      
      let comparison = 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal), "ru");
      }
      
      return flightSort.direction === "asc" ? comparison : -comparison;
    });
  }, [filteredFlights, flightSort]);

  const formatDate = (dateStr: string) => {
    return formatFlightDate(dateStr);
  };

  const formatTime = (timeStr: string) => {
    if (!timeStr) return "—";
    return timeStr;
  };

  const flightEventsTitle = (flight: Flight) => summarizeEventColors(flight.events, COLOR_LABELS);

  const handleSort = (key: FlightSortKey) => {
    setFlightSort(current => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  };

  const radarAxes = useMemo<PilotRadarAxis[]>(() => metricDefinitions.map((item) => ({
    key: item.key,
    label: item.shortLabel,
    unit: item.unit,
    digits: item.digits,
    pilotMin: pilot.minMetrics[item.key],
    pilotMax: pilot.maxMetrics[item.key],
    pilotAvg: pilot.metrics[item.key],
    typeAvg: pilot.typeMetrics[item.key],
  })), [pilot]);

  const pilotAverage = pilot.metrics[selectedMetric];
  const typeAverage = pilot.typeMetrics[selectedMetric];
  const delta = pilotAverage !== null && typeAverage !== null ? pilotAverage - typeAverage : null;

  return (
    <>
    <div className="pilot-card-overlay">
      <button type="button" className="pilot-card-backdrop" onClick={onClose} aria-label="Закрыть карточку пилота" />
      <div className="pilot-card" role="dialog" aria-modal="true" aria-labelledby="pilot-card-title">
        <div className="pilot-card-header">
          <div>
            <h2 id="pilot-card-title">{pilot.name}</h2>
            <div className="pilot-card-meta">
              <span className="pilot-card-role">{pilot.role}</span>
              <span className="pilot-card-code">Табельный №: {pilot.code}</span>
              <span className="pilot-card-aircraft">{pilot.aircraftType}</span>
            </div>
          </div>
          <button className="pilot-card-close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        <div className="pilot-card-tabs">
          <button type="button" className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>Статистика</button>
          <button type="button" className={tab === "flights" ? "active" : ""} onClick={() => setTab("flights")}>Рейсы пилота ({pilotFlights.length})</button>
        </div>

        {/* Statistics Summary */}
        {tab === "stats" && <div className="pilot-card-stats-summary">
          <div className="pilot-card-stats-header">
            <div>
              <span>Сводная статистика</span>
              <strong>Сравнение со средним по типу ВС</strong>
            </div>
            <select 
              value={selectedMetric} 
              onChange={(e) => setSelectedMetric(e.target.value as FlightMetricKey)}
              className="pilot-card-metric-select"
              aria-label="Показатель статистики"
            >
              {metricDefinitions.map((item) => (
                <option value={item.key} key={item.key}>{item.label}</option>
              ))}
            </select>
          </div>
          
          <div className="pilot-card-stats-grid">
            <article className="pilot-card-stat-card is-primary">
              <span>Пилот</span>
              <strong>{pilot.name}</strong>
              <dl>
                <div><dt>Среднее</dt><dd>{formatMetric(pilotAverage, selectedMetric, true)}</dd></div>
                <div><dt>Минимум</dt><dd>{formatMetric(pilot.minMetrics[selectedMetric], selectedMetric, true)}</dd></div>
                <div><dt>Максимум</dt><dd>{formatMetric(pilot.maxMetrics[selectedMetric], selectedMetric, true)}</dd></div>
                <div><dt>Медиана</dt><dd>{formatMetric(pilot.medianMetrics[selectedMetric], selectedMetric, true)}</dd></div>
              </dl>
            </article>
            
            <article className="pilot-card-stat-card">
              <span>Тип ВС</span>
              <strong>{pilot.aircraftType}</strong>
              <dl>
                <div><dt>Среднее</dt><dd>{formatMetric(typeAverage, selectedMetric, true)}</dd></div>
                <div><dt>Отклонение</dt><dd className={delta !== null && delta > 0 ? "positive" : delta !== null && delta < 0 ? "negative" : ""}>
                  {delta === null ? "—" : `${delta > 0 ? "+" : ""}${formatMetric(delta, selectedMetric, true)}`}
                </dd></div>
              </dl>
            </article>
          </div>

          <article className="chart-card pilot-card-radar">
            <div className="chart-head">
              <div><span>Все показатели</span><h2>Профиль пилота</h2></div>
              <ul className="chart-legend">
                <li><i className="pilot-radar-legend-pilot" />{pilot.name}</li>
                <li><i className="pilot-radar-legend-type" />Среднее по типу ВС</li>
              </ul>
            </div>
            <p className="note">Каждая ось — свой показатель: центр — минимум пилота, край — его максимум. Если среднее по типу ВС выходит за пределы этого диапазона, значение подписано за пределами круга.</p>
            <PilotRadarChart axes={radarAxes} selectedMetric={selectedMetric} pilotLabel={pilot.name} baselineLabel="Среднее по типу ВС" />
          </article>
        </div>}

        {/* Flight Filters */}
        {tab === "flights" && <div className="pilot-card-flights-panel">
        <div className="pilot-card-filters">
          <div className="pilot-card-filter">
            <label htmlFor="pilot-flight-search"><span>Поиск рейса</span></label>
            <input 
              id="pilot-flight-search"
              placeholder="Номер рейса, борт или маршрут" 
              value={flightSearch} 
              onChange={(e) => setFlightSearch(e.target.value)} 
            />
          </div>
          <div className="pilot-card-filter">
            <label htmlFor="pilot-flight-date-from"><span>С</span></label>
            <input 
              id="pilot-flight-date-from"
              type="date" 
              value={dateFrom} 
              min={dateRange.min}
              max={dateRange.max}
              onChange={(e) => setDateFrom(e.target.value)} 
            />
          </div>
          <div className="pilot-card-filter">
            <label htmlFor="pilot-flight-date-to"><span>По</span></label>
            <input 
              id="pilot-flight-date-to"
              type="date" 
              value={dateTo} 
              min={dateRange.min}
              max={dateRange.max}
              onChange={(e) => setDateTo(e.target.value)} 
            />
          </div>
          <div className="pilot-card-filter-info">
            <span>Найдено рейсов</span>
            <strong>{sortedFlights.length}</strong>
          </div>
        </div>
        
        {dateRange.displayMin && dateRange.displayMax && (
          <div className="pilot-card-date-range">
            <span>Доступный период: </span>
            <strong>{dateRange.displayMin} — {dateRange.displayMax}</strong>
          </div>
        )}

        {/* Flights Table */}
        <div className="pilot-card-flights">
          <h3>Рейсы пилота</h3>
          {sortedFlights.length === 0 ? (
            <p className="pilot-card-empty">Нет данных о рейсах</p>
          ) : (
            <div className="pilot-card-flights-table">
              <table>
                <thead>
                  <tr>
                    <th onClick={() => handleSort("date")} className={flightSort.key === "date" ? "active" : ""}>
                      Дата {flightSort.key === "date" && (flightSort.direction === "asc" ? "↑" : "↓")}
                    </th>
                    <th onClick={() => handleSort("flightNumber")} className={flightSort.key === "flightNumber" ? "active" : ""}>
                      Рейс {flightSort.key === "flightNumber" && (flightSort.direction === "asc" ? "↑" : "↓")}
                    </th>
                    <th onClick={() => handleSort("route")} className={flightSort.key === "route" ? "active" : ""}>
                      Маршрут {flightSort.key === "route" && (flightSort.direction === "asc" ? "↑" : "↓")}
                    </th>
                    <th onClick={() => handleSort("departureTime")} className={flightSort.key === "departureTime" ? "active" : ""}>
                      Вылет {flightSort.key === "departureTime" && (flightSort.direction === "asc" ? "↑" : "↓")}
                    </th>
                    <th onClick={() => handleSort("arrivalTime")} className={flightSort.key === "arrivalTime" ? "active" : ""}>
                      Посадка {flightSort.key === "arrivalTime" && (flightSort.direction === "asc" ? "↑" : "↓")}
                    </th>
                    <th onClick={() => handleSort("board")} className={flightSort.key === "board" ? "active" : ""}>
                      Борт {flightSort.key === "board" && (flightSort.direction === "asc" ? "↑" : "↓")}
                    </th>
                    <th>События</th>
                    {metricDefinitions.map((metric) => (
                      <th 
                        key={metric.key} 
                        onClick={() => handleSort(metric.key)}
                        className={flightSort.key === metric.key ? "active" : ""}
                      >
                        {metric.shortLabel} {flightSort.key === metric.key && (flightSort.direction === "asc" ? "↑" : "↓")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedFlights.map((flight, index) => {
                    const eventColor = worstEventColor(flight.events);
                    const stripeStyle = eventColor ? { boxShadow: `inset 4px 0 0 ${COLOR_STYLES[eventColor].text}` } : undefined;
                    return (
                    <tr key={`${flight.key}-${index}`} className="pilot-card-flight-row" onClick={() => setSelectedFlight(flight)}>
                      <td style={stripeStyle}>{formatDate(flight.date)}</td>
                      <td>{flight.flightNumber || "—"}</td>
                      <td className="route-cell">
                        <span className="route-content">
                          <span className="route-departure">{flight.departure}</span>
                          <span className="route-arrow">→</span>
                          <span className="route-arrival">{flight.arrival}</span>
                        </span>
                      </td>
                      <td>{formatTime(flight.departureTime)}</td>
                      <td>{formatTime(flight.arrivalTime)}</td>
                      <td>{flight.board || "—"}</td>
                      <td>
                        {eventColor ? (
                          <span
                            className="event-flight-badge"
                            title={flightEventsTitle(flight)}
                            style={{ background: COLOR_STYLES[eventColor].bg, color: COLOR_STYLES[eventColor].text, borderColor: COLOR_STYLES[eventColor].border }}
                          >
                            {flight.events.length}
                          </span>
                        ) : "—"}
                      </td>
                      {metricDefinitions.map((metric) => (
                        <td key={metric.key}>{formatMetric(flight.metrics[metric.key], metric.key, true)}</td>
                      ))}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>}
      </div>
    </div>
    {selectedFlight && <FlightDetailCard flight={selectedFlight} onClose={() => setSelectedFlight(null)} />}
    </>
  );
}
