import { formatMetric, type FlightMetricKey, type HistogramBin, type StatisticRow, type StatDimension, statDimensionLabels } from "./flight-data";
import { comparisonHistogramSvg, distributionHistogramSvg, toComparisonBars, windowedBars } from "./histogram";

export type StatisticReport = {
  generatedAt: Date;
  sourceFile: string;
  aircraftFilter: string;
  airportFilter: string;
  dimension: StatDimension;
  metric: FlightMetricKey;
  metricLabel: string;
  metricUnit: string;
  selectedId: string;
  rows: StatisticRow[];
  bins: HistogramBin[];
  overallAverage: number | null;
};

const stamp = (date: Date) => date.toISOString().slice(0, 10);

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
  const sheet = workbook.addWorksheet("Статистика");
  const selected = report.rows.find((row) => row.id === report.selectedId);
  const header = ["Объект", "Деталь", "Рейсов", "Мин.", "Среднее", "Макс.", "К среднему выборки", "Выбран"];
  sheet.addRows([
    ["Flight Analytics — статистический отчёт"],
    [`Файл: ${report.sourceFile || "без имени"}`],
    [`Сформирован: ${report.generatedAt.toLocaleString("ru-RU")}`],
    [`Разрез: ${statDimensionLabels[report.dimension]}`],
    [`Показатель: ${report.metricLabel}, ${report.metricUnit}`],
    [`Фильтры: тип ВС — ${report.aircraftFilter || "все"}, аэропорт — ${report.airportFilter || "все"}`],
    [`Выбранный объект: ${selected ? `${selected.label} ${selected.subtitle}`.trim() : "—"}`],
    [`Среднее по сравниваемым группам: ${formatMetric(report.overallAverage, report.metric, true)}`],
    [],
    header,
  ]);
  for (const row of report.rows) {
    const avg = row.metrics[report.metric];
    const delta = avg !== null && report.overallAverage !== null ? avg - report.overallAverage : null;
    sheet.addRow([
      row.label,
      row.subtitle,
      row.flights,
      row.minMetrics[report.metric],
      avg,
      row.maxMetrics[report.metric],
      delta,
      row.id === report.selectedId ? "да" : "",
    ]);
  }
  sheet.getRow(1).font = { bold: true, size: 14, color: { argb: "FF183964" } };
  const headerRow = sheet.getRow(10);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF183964" } };
  sheet.columns = [
    { width: 28 }, { width: 28 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 20 }, { width: 12 },
  ];
  report.rows.forEach((row, index) => {
    if (row.id !== report.selectedId) return;
    sheet.getRow(11 + index).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8DDE1" } };
  });
  const binsSheet = workbook.addWorksheet("Распределение");
  binsSheet.addRow(["От", "До", "Выбранный объект", "Остальные"]);
  binsSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  binsSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF183964" } };
  for (const bin of report.bins) binsSheet.addRow([bin.from, bin.to, bin.selected, bin.others]);
  binsSheet.columns = [{ width: 14 }, { width: 14 }, { width: 20 }, { width: 14 }];
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([new Uint8Array(buffer as ArrayBuffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `flight-analytics-statistika-${stamp(report.generatedAt)}.xlsx`);
}

export function printStatisticPdf(report: StatisticReport) {
  const selected = report.rows.find((row) => row.id === report.selectedId);
  const bars = windowedBars(toComparisonBars(report.rows, report.metric, report.selectedId));
  const comparison = comparisonHistogramSvg(bars, report.metric);
  const distribution = distributionHistogramSvg(report.bins, report.metric);
  const rows = report.rows.map((row) => {
    const avg = row.metrics[report.metric];
    const delta = avg !== null && report.overallAverage !== null ? avg - report.overallAverage : null;
    const mark = row.id === report.selectedId ? " class=\"picked\"" : "";
    return `<tr${mark}><th>${row.label}${row.subtitle ? `<small>${row.subtitle}</small>` : ""}</th><td>${row.flights}</td><td>${formatMetric(row.minMetrics[report.metric], report.metric)}</td><td>${formatMetric(avg, report.metric)}</td><td>${formatMetric(row.maxMetrics[report.metric], report.metric)}</td><td>${formatMetric(delta, report.metric)}</td></tr>`;
  }).join("");
  const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"/><title>Статистика Flight Analytics</title>
    <style>
      body { margin: 24px; color: #14243a; font-family: Arial, Helvetica, sans-serif; }
      h1 { margin: 0; font-size: 22px; } .meta { color: #667580; font-size: 12px; line-height: 1.55; }
      .callout { margin: 16px 0; padding: 14px 16px; border: 1px solid #f0c8ce; border-radius: 12px; background: #fff5f6; }
      .charts { display: grid; gap: 18px; } svg { max-width: 100%; height: auto; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; } th, td { padding: 8px; border-bottom: 1px solid #e5e9ea; text-align: right; }
      th:first-child { text-align: left; } thead th { background: #183964; color: white; } tr.picked td, tr.picked th { background: #f8dde1; }
      small { display: block; color: #74818a; font-weight: 400; }
      @page { size: A4 landscape; margin: 12mm; }
    </style></head><body>
      <h1>Flight Analytics — статистический отчёт</h1>
      <p class="meta">${report.sourceFile || "файл без имени"} · ${report.generatedAt.toLocaleString("ru-RU")}<br/>
      ${statDimensionLabels[report.dimension]} · ${report.metricLabel} (${report.metricUnit}) · тип ВС: ${report.aircraftFilter || "все"} · аэропорт: ${report.airportFilter || "все"}</p>
      <div class="callout"><strong>${selected ? `${selected.label} ${selected.subtitle}`.trim() : "Объект не выбран"}</strong><br/>
      среднее ${formatMetric(selected?.metrics[report.metric] ?? null, report.metric, true)}, среднее групп ${formatMetric(report.overallAverage, report.metric, true)}</div>
      <div class="charts">${comparison}${distribution}</div>
      <table><thead><tr><th>Объект</th><th>Рейсов</th><th>Мин.</th><th>Среднее</th><th>Макс.</th><th>К среднему</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  const cleanup = () => iframe.remove();
  iframe.contentWindow?.addEventListener("afterprint", cleanup);
  window.setTimeout(() => iframe.contentWindow?.print(), 80);
}
