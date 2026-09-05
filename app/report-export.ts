import { formatMetric, type FlightMetricKey, type MultiHistogramBin, type StatisticRow, type StatDimension, statDimensionLabels } from "./flight-data";
import { comparisonRangeSvg, normalizedDistributionSvg, type ChartSeries } from "./histogram";

export type StatisticReport = {
  generatedAt: Date;
  sourceFile: string;
  aircraftFilter: string;
  airportFilter: string;
  dimension: StatDimension;
  metric: FlightMetricKey;
  metricLabel: string;
  metricUnit: string;
  selectedIds: string[];
  rows: StatisticRow[];
  bins: MultiHistogramBin[];
  series: ChartSeries[];
  baselineLabel: string;
};

const stamp = (date: Date) => date.toISOString().slice(0, 10);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadStatisticExcel(report: StatisticReport) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flight Analytics";
  const sheet = workbook.addWorksheet("Сравнение");
  const header = ["Объект", "Деталь", "Рейсов", "Мин.", "Медиана", "Среднее", "Макс.", report.baselineLabel, "Отклонение", "Основной"];
  sheet.addRows([
    ["Flight Analytics — сравнительный отчёт"],
    [`Файл: ${report.sourceFile || "без имени"}`],
    [`Сформирован: ${report.generatedAt.toLocaleString("ru-RU")}`],
    [`Разрез: ${statDimensionLabels[report.dimension]}`],
    [`Показатель: ${report.metricLabel}, ${report.metricUnit}`],
    [`Фильтры: тип ВС — ${report.aircraftFilter || "все"}, аэропорт — ${report.airportFilter || "все"}`],
    [`Участники: ${report.rows.map((row) => row.label).join(", ") || "—"}`],
    [`Базовая линия: ${report.baselineLabel}${report.dimension === "pilots" ? " рассчитывается отдельно для каждого типа ВС" : ""}`],
    [],
    header,
  ]);
  for (const row of report.rows) {
    const average = row.metrics[report.metric];
    const baseline = row.baselineMetrics[report.metric];
    const delta = average !== null && baseline !== null ? average - baseline : null;
    sheet.addRow([
      row.label,
      row.subtitle,
      row.flights,
      row.minMetrics[report.metric],
      row.medianMetrics[report.metric],
      average,
      row.maxMetrics[report.metric],
      baseline,
      delta,
      row.id === report.selectedIds[0] ? "да" : "",
    ]);
  }
  sheet.getRow(1).font = { bold: true, size: 14, color: { argb: "FF183964" } };
  const headerRow = sheet.getRow(10);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF183964" } };
  sheet.columns = [
    { width: 28 }, { width: 30 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 22 }, { width: 15 }, { width: 11 },
  ];
  report.rows.forEach((row, index) => {
    const color = report.series[index]?.color.replace("#", "").toUpperCase() ?? "183964";
    sheet.getCell(11 + index, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
    sheet.getCell(11 + index, 1).font = { color: { argb: "FFFFFFFF" }, bold: true };
  });

  const binsSheet = workbook.addWorksheet("Распределение");
  const distributionHeader = ["От", "До", ...report.series.flatMap((item) => [`${item.label}: рейсов`, `${item.label}: доля`])];
  binsSheet.addRow(distributionHeader);
  binsSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  binsSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF183964" } };
  const totals = Object.fromEntries(report.series.map((item) => [item.id, report.bins.reduce((sum, bin) => sum + (bin.counts[item.id] ?? 0), 0)]));
  for (const bin of report.bins) binsSheet.addRow([
    bin.from,
    bin.to,
    ...report.series.flatMap((item) => {
      const count = bin.counts[item.id] ?? 0;
      return [count, totals[item.id] ? count / totals[item.id] : 0];
    }),
  ]);
  binsSheet.columns = distributionHeader.map((_, index) => ({ width: index < 2 ? 14 : 22 }));
  for (let column = 4; column <= distributionHeader.length; column += 2) binsSheet.getColumn(column).numFmt = "0.0%";
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([new Uint8Array(buffer as ArrayBuffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `flight-analytics-sravnenie-${stamp(report.generatedAt)}.xlsx`);
}

export function printStatisticPdf(report: StatisticReport) {
  const comparison = comparisonRangeSvg(report.rows, report.metric, report.series, report.baselineLabel);
  const distribution = normalizedDistributionSvg(report.bins, report.metric, report.series);
  const legend = report.series.map((item) => `<span><i style="background:${item.color}"></i>${escapeHtml(item.label)}</span>`).join("");
  const rows = report.rows.map((row, index) => {
    const average = row.metrics[report.metric];
    const baseline = row.baselineMetrics[report.metric];
    const delta = average !== null && baseline !== null ? average - baseline : null;
    return `<tr${index === 0 ? " class=\"picked\"" : ""}><th><i style="background:${report.series[index]?.color}"></i>${escapeHtml(row.label)}${row.subtitle ? `<small>${escapeHtml(row.subtitle)}</small>` : ""}</th><td>${row.flights}</td><td>${formatMetric(row.minMetrics[report.metric], report.metric)}</td><td>${formatMetric(row.medianMetrics[report.metric], report.metric)}</td><td>${formatMetric(average, report.metric)}</td><td>${formatMetric(row.maxMetrics[report.metric], report.metric)}</td><td>${formatMetric(baseline, report.metric)}</td><td>${formatMetric(delta, report.metric)}</td></tr>`;
  }).join("");
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>Сравнение Flight Analytics</title>
    <style>
      body { margin: 24px; color: #14243a; font-family: Arial, Helvetica, sans-serif; }
      h1 { margin: 0; font-size: 22px; } h2 { margin: 16px 0 6px; font-size: 14px; }
      .meta { color: #667580; font-size: 11px; line-height: 1.55; }
      .notice { margin: 12px 0; padding: 10px 12px; border: 1px solid #d7dde1; border-radius: 9px; background: #f6f8f9; font-size: 10px; }
      .legend { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0; font-size: 9px; font-weight: 700; }
      .legend span { display: inline-flex; align-items: center; gap: 5px; } .legend i, th>i { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 50%; }
      .charts { display: grid; gap: 8px; } svg { max-width: 100%; height: auto; }
      table { width: 100%; border-collapse: collapse; font-size: 9px; } th, td { padding: 6px; border-bottom: 1px solid #e5e9ea; text-align: right; }
      th:first-child { text-align: left; } thead th { background: #183964; color: white; } tr.picked td, tr.picked th { background: #fff2f4; }
      small { display: block; margin-top: 2px; color: #74818a; font-weight: 400; }
      @page { size: A4 landscape; margin: 10mm; }
    </style></head><body>
      <h1>Flight Analytics — сравнительный отчёт</h1>
      <p class="meta">${escapeHtml(report.sourceFile || "файл без имени")} · ${report.generatedAt.toLocaleString("ru-RU")}<br/>
      ${escapeHtml(statDimensionLabels[report.dimension])} · ${escapeHtml(report.metricLabel)} (${escapeHtml(report.metricUnit)}) · тип ВС: ${escapeHtml(report.aircraftFilter || "все")} · аэропорт: ${escapeHtml(report.airportFilter || "все")}</p>
      <div class="notice">${escapeHtml(report.baselineLabel)}${report.dimension === "pilots" ? " рассчитывается отдельно для типа ВС каждого пилота." : "."} Распределение показано в процентах от числа рейсов участника.</div>
      <div class="legend">${legend}</div>
      <div class="charts"><h2>Среднее, минимум–максимум и базовая линия</h2>${comparison}<h2>Распределение рейсов, %</h2>${distribution}</div>
      <table><thead><tr><th>Объект</th><th>Рейсов</th><th>Мин.</th><th>Медиана</th><th>Среднее</th><th>Макс.</th><th>${escapeHtml(report.baselineLabel)}</th><th>Отклонение</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) { iframe.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => iframe.remove();
  iframe.contentWindow?.addEventListener("afterprint", cleanup);
  window.setTimeout(() => iframe.contentWindow?.print(), 80);
}
