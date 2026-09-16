import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { formatMetric, metricDefinitions, type FlightMetricKey, type MultiHistogramBin, type PilotSummary, type StatisticRow, type StatDimension, statDimensionLabels } from "./flight-data";
import { comparisonRangeSvg, normalizedDistributionSvg, pilotProfileSvg, pilotProfileLegendSvg, type ChartSeries, type PilotProfileAxis } from "./histogram";

export type StatisticReport = {
  generatedAt: Date;
  sourceFile: string;
  aircraftFilter: string;
  airportFilter: string;
  dimension: StatDimension;
  minimumFlights: number;
  metric: FlightMetricKey;
  metricLabel: string;
  metricUnit: string;
  reportMetrics: FlightMetricKey[];
  selectedIds: string[];
  rows: StatisticRow[];
  bins: MultiHistogramBin[];
  series: ChartSeries[];
  baselineLabel: string;
};

const NAVY = "#183964";
const RED = "#d52238";
const INK = "#14243a";
const MUTED = "#667580";
const stamp = (date: Date) => date.toISOString().slice(0, 10);
const metricMeta = (key: FlightMetricKey) => metricDefinitions.find((item) => item.key === key)!;
const deltaText = (value: number | null, key: FlightMetricKey, withUnit = false) => value === null ? "—" : `${value > 0 ? "+" : ""}${formatMetric(value, key, withUnit)}`;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const excelHeader = (row: import("exceljs").Row) => {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF183964" } };
  row.alignment = { vertical: "middle", wrapText: true };
};

export async function downloadStatisticExcel(report: StatisticReport) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flight Analytics";
  workbook.created = report.generatedAt;

  const info = workbook.addWorksheet("Параметры отчёта");
  info.addRows([
    ["Flight Analytics — сравнительный отчёт"],
    ["Исходный файл", report.sourceFile || "без имени"],
    ["Сформирован", report.generatedAt.toLocaleString("ru-RU")],
    ["Разрез", statDimensionLabels[report.dimension]],
    ["Тип ВС", report.aircraftFilter || "все"],
    ["Аэропорт", report.airportFilter || "все"],
    ["Минимум рейсов", report.dimension === "pilots" ? report.minimumFlights : "не применяется"],
    ["Участники", report.rows.map((row) => `${row.label}${row.subtitle ? ` (${row.subtitle})` : ""}`).join("; ") || "—"],
    ["Показатели", report.reportMetrics.map((key) => metricMeta(key).label).join("; ")],
    ["Базовая линия", `${report.baselineLabel}${report.dimension === "pilots" ? " рассчитывается отдельно для каждого типа ВС" : ""}`],
  ]);
  info.getRow(1).font = { bold: true, size: 15, color: { argb: "FF183964" } };
  info.getColumn(1).width = 24;
  info.getColumn(2).width = 100;
  for (let row = 2; row <= 10; row += 1) info.getCell(row, 1).font = { bold: true, color: { argb: "FF183964" } };
  info.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });

  report.reportMetrics.forEach((key, metricIndex) => {
    const meta = metricMeta(key);
    const sheetName = `${metricIndex + 1}. ${meta.shortLabel}`.replace(/[\\/*?:[\]]/g, " ").slice(0, 31);
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow([`${meta.label}, ${meta.unit}`]);
    sheet.addRow([`Фильтры: тип ВС — ${report.aircraftFilter || "все"}; аэропорт — ${report.airportFilter || "все"}`]);
    sheet.addRow([]);
    sheet.addRow(["Объект", "Деталь", "Рейсов", "Мин.", "Медиана", "Среднее", "Макс.", report.baselineLabel, "Отклонение", "Основной"]);
    excelHeader(sheet.getRow(4));
    report.rows.forEach((row, index) => {
      const average = row.metrics[key];
      const baseline = row.baselineMetrics[key];
      const delta = average !== null && baseline !== null ? average - baseline : null;
      sheet.addRow([row.label, row.subtitle, row.flights, row.minMetrics[key], row.medianMetrics[key], average, row.maxMetrics[key], baseline, delta, index === 0 ? "да" : ""]);
      const color = report.series[index]?.color.replace("#", "").toUpperCase() ?? "183964";
      sheet.getCell(5 + index, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color}` } };
      sheet.getCell(5 + index, 1).font = { color: { argb: "FFFFFFFF" }, bold: true };
    });
    sheet.getRow(1).font = { bold: true, size: 14, color: { argb: "FF183964" } };
    sheet.columns = [{ width: 28 }, { width: 31 }, { width: 10 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 23 }, { width: 15 }, { width: 11 }];
    sheet.views = [{ state: "frozen", ySplit: 4, xSplit: 1 }];
  });

  const binsSheet = workbook.addWorksheet(`Распределение ${metricMeta(report.metric).shortLabel}`.slice(0, 31));
  binsSheet.addRow([`Детальный график: ${report.metricLabel}, ${report.metricUnit}`]);
  const distributionHeader = ["От", "До", ...report.series.flatMap((item) => [`${item.label}: рейсов`, `${item.label}: доля`])];
  binsSheet.addRow(distributionHeader);
  excelHeader(binsSheet.getRow(2));
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
  downloadBlob(new Blob([new Uint8Array(buffer as ArrayBuffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `flight-analytics-report-${stamp(report.generatedAt)}.xlsx`);
}

const pdfHeaderCell = (text: string): TableCell => ({ text, bold: true, color: "#ffffff", fillColor: NAVY, margin: [3, 4, 3, 4] });
const pdfBodyCell = (text: string | number, options: Partial<TableCell> = {}): TableCell => ({ text, margin: [3, 2.5, 3, 2.5], ...options });

export function buildStatisticPdfDocument(report: StatisticReport): TDocumentDefinitions {
  const metricSections: Content[] = report.reportMetrics.flatMap((key, metricIndex): Content[] => {
    const meta = metricMeta(key);
    const body: TableCell[][] = [
      ["Объект", "Рейсов", "Мин.", "Медиана", "Среднее", "Макс.", report.baselineLabel, "Откл."].map(pdfHeaderCell),
      ...report.rows.map((row, rowIndex): TableCell[] => {
        const average = row.metrics[key];
        const baseline = row.baselineMetrics[key];
        const delta = average !== null && baseline !== null ? average - baseline : null;
        return [
          pdfBodyCell(`${row.label}${row.subtitle ? `\n${row.subtitle}` : ""}`, { bold: true, color: report.series[rowIndex]?.color ?? NAVY, fillColor: rowIndex === 0 ? "#fff2f4" : undefined }),
          pdfBodyCell(row.flights),
          pdfBodyCell(formatMetric(row.minMetrics[key], key)),
          pdfBodyCell(formatMetric(row.medianMetrics[key], key)),
          pdfBodyCell(formatMetric(average, key), { bold: true }),
          pdfBodyCell(formatMetric(row.maxMetrics[key], key)),
          pdfBodyCell(formatMetric(baseline, key)),
          pdfBodyCell(deltaText(delta, key), { color: delta === null ? MUTED : INK, bold: delta !== null }),
        ];
      }),
    ];
    return [
      { text: `${meta.label}, ${meta.unit}`, style: "metricTitle", pageBreak: metricIndex > 0 && metricIndex % 2 === 0 ? "before" : undefined },
      { table: { headerRows: 1, dontBreakRows: true, widths: [150, 42, "*", "*", "*", "*", 76, 56], body }, layout: "lightHorizontalLines", margin: [0, 0, 0, 10] },
    ];
  });
  const comparison = comparisonRangeSvg(report.rows, report.metric, report.series, report.baselineLabel, 760);
  const distribution = normalizedDistributionSvg(report.bins, report.metric, report.series, 760, 230);
  const participants = report.rows.map((row, index) => ({ text: `${index === 0 ? "Основной: " : ""}${row.label}${row.subtitle ? ` · ${row.subtitle}` : ""}`, color: report.series[index]?.color ?? NAVY, bold: index === 0, margin: [0, 2, 0, 2] }));

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [30, 30, 30, 34],
    info: { title: "Flight Analytics — сравнительный отчёт", subject: report.reportMetrics.map((key) => metricMeta(key).label).join(", "), creator: "Flight Analytics" },
    defaultStyle: { font: "Roboto", fontSize: 8, color: INK },
    footer: (currentPage, pageCount) => ({ text: `Flight Analytics · ${currentPage} / ${pageCount}`, alignment: "right", color: MUTED, fontSize: 7, margin: [0, 8, 30, 0] }),
    styles: {
      title: { fontSize: 19, bold: true, color: NAVY },
      eyebrow: { fontSize: 7, bold: true, color: RED, characterSpacing: 1.1 },
      sectionTitle: { fontSize: 13, bold: true, color: NAVY, margin: [0, 13, 0, 6] },
      metricTitle: { fontSize: 10, bold: true, color: NAVY, margin: [0, 8, 0, 4] },
      metaLabel: { fontSize: 7, bold: true, color: MUTED },
      metaValue: { fontSize: 9, bold: true, color: INK },
    },
    content: [
      { text: "АНАЛИТИКА ЛЁТНЫХ ДАННЫХ", style: "eyebrow" },
      { text: "Flight Analytics — сравнительный отчёт", style: "title", margin: [0, 4, 0, 12] },
      {
        columns: [
          { width: "*", stack: [{ text: "ИСХОДНЫЙ ФАЙЛ", style: "metaLabel" }, { text: report.sourceFile || "без имени", style: "metaValue", margin: [0, 2, 0, 8] }, { text: "РАЗРЕЗ", style: "metaLabel" }, { text: statDimensionLabels[report.dimension], style: "metaValue", margin: [0, 2, 0, 0] }] },
          { width: "*", stack: [{ text: "ФИЛЬТР ПО ТИПУ ВС", style: "metaLabel" }, { text: report.aircraftFilter || "Все типы", style: "metaValue", margin: [0, 2, 0, 8] }, { text: "ФИЛЬТР ПО АЭРОПОРТУ", style: "metaLabel" }, { text: report.airportFilter || "Все аэропорты", style: "metaValue" }] },
          { width: "*", stack: [{ text: "СФОРМИРОВАН", style: "metaLabel" }, { text: report.generatedAt.toLocaleString("ru-RU"), style: "metaValue", margin: [0, 2, 0, 8] }, { text: "БАЗОВАЯ ЛИНИЯ", style: "metaLabel" }, { text: `${report.baselineLabel}${report.dimension === "pilots" ? ` отдельно по типу ВС · минимум ${report.minimumFlights} рейс.` : ""}`, style: "metaValue" }] },
        ],
        columnGap: 18,
        margin: [0, 0, 0, 10],
      },
      { text: "Участники сравнения", style: "sectionTitle" },
      { columns: participants, columnGap: 10, margin: [0, 0, 0, 5] },
      { text: `Показатели отчёта: ${report.reportMetrics.map((key) => metricMeta(key).label).join("; ")}`, color: MUTED, fontSize: 8, margin: [0, 4, 0, 8] },
      ...metricSections,
      { text: `Подробные графики · ${report.metricLabel}, ${report.metricUnit}`, style: "sectionTitle", pageBreak: "before" },
      { text: `Точка — среднее, линия — минимум–максимум, ромб — ${report.baselineLabel.toLocaleLowerCase("ru-RU")}.`, color: MUTED, fontSize: 8, margin: [0, 0, 0, 5] },
      ...(comparison ? [{ svg: comparison, width: 730, alignment: "center" } as Content] : []),
      { text: "Распределение рейсов, %", style: "metricTitle", margin: [0, 7, 0, 3] },
      ...(distribution ? [{ svg: distribution, width: 730, alignment: "center" } as Content] : []),
      { text: "Доли нормализованы по количеству заполненных значений каждого участника.", color: MUTED, fontSize: 7, margin: [0, 5, 0, 0] },
    ],
  };
}

export async function downloadStatisticPdf(report: StatisticReport) {
  const [pdfMakeModule, pdfFontsModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const pdfMake = (pdfMakeModule as typeof pdfMakeModule & { default?: typeof pdfMakeModule }).default ?? pdfMakeModule;
  const fonts = (pdfFontsModule as typeof pdfFontsModule & { default?: typeof pdfFontsModule }).default ?? pdfFontsModule;
  pdfMake.addVirtualFileSystem(fonts);
  await new Promise<void>((resolve, reject) => {
    try {
      pdfMake.createPdf(buildStatisticPdfDocument(report)).download(`flight-analytics-report-${stamp(report.generatedAt)}.pdf`, resolve);
    } catch (error) {
      reject(error);
    }
  });
}

export type PilotReport = {
  generatedAt: Date;
  pilot: PilotSummary;
  profileAxes: PilotProfileAxis[];
  selectedMetric: FlightMetricKey;
  flightsInScope: number;
  aircraftFilter: string;
  airportFilter: string;
  avatarDataUrl: string;
};

const reportLabel = (text: string): Content => ({ text, fontSize: 7, bold: true, color: MUTED, characterSpacing: 0.6, margin: [0, 0, 0, 2] });
const reportValue = (text: string, options: Partial<Content> = {}): Content => ({ text, fontSize: 10, bold: true, color: INK, margin: [0, 0, 0, 7], ...options } as Content);

export function buildPilotReportPdfDocument(dossier: PilotReport): TDocumentDefinitions {
  const { pilot } = dossier;
  const profile = pilotProfileSvg(dossier.profileAxes, dossier.selectedMetric);

  const headerCell = (text: string, options: Partial<TableCell> = {}): TableCell => ({ text, bold: true, fontSize: 7, color: "#687985", fillColor: "#f3f6f7", alignment: "center", margin: [2, 3, 2, 3], ...options });
  const groupCell = (text: string, span: number, color: string, fill: string): TableCell => ({ text, colSpan: span, bold: true, fontSize: 7, color, fillColor: fill, alignment: "center", margin: [2, 3, 2, 3] });

  const tableBody: TableCell[][] = [
    [
      headerCell("Показатель", { rowSpan: 2, alignment: "left" }),
      groupCell("Пилот", 4, "#a8182b", "#fdf1f3"), {}, {}, {},
      groupCell(`Тип ВС · ${pilot.aircraftType}`, 3, NAVY, "#edf2fa"), {}, {},
      headerCell("Разница", { rowSpan: 2 }),
    ],
    [
      {},
      headerCell("Мин"), headerCell("Среднее"), headerCell("Макс"), headerCell("Медиана"),
      headerCell("Мин"), headerCell("Среднее"), headerCell("Макс"),
      {},
    ],
    ...metricDefinitions.map((item): TableCell[] => {
      const own = pilot.metrics[item.key];
      const baseline = pilot.typeMetrics[item.key];
      const delta = own !== null && baseline !== null ? own - baseline : null;
      const selected = item.key === dossier.selectedMetric;
      const fill = selected ? "#fdeef0" : undefined;
      const cell = (value: number | null, options: Partial<TableCell> = {}): TableCell =>
        ({ text: formatMetric(value, item.key), alignment: "right", fillColor: fill, margin: [3, 2.5, 3, 2.5], ...options });
      return [
        { text: `${item.label}, ${item.unit}`, bold: true, color: selected ? RED : INK, fillColor: fill, margin: [3, 2.5, 3, 2.5] },
        cell(pilot.minMetrics[item.key]),
        cell(own, { bold: true }),
        cell(pilot.maxMetrics[item.key]),
        cell(pilot.medianMetrics[item.key]),
        cell(pilot.typeMinMetrics[item.key]),
        cell(baseline, { bold: true }),
        cell(pilot.typeMaxMetrics[item.key]),
        { text: deltaText(delta, item.key), alignment: "right", bold: true, fillColor: fill, margin: [3, 2.5, 3, 2.5] },
      ];
    }),
  ];

  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [30, 30, 30, 34],
    info: { title: `Карточка пилота — ${pilot.name}`, subject: `Табельный № ${pilot.code}`, creator: "Flight Analytics" },
    defaultStyle: { font: "Roboto", fontSize: 8, color: INK },
    footer: (currentPage, pageCount) => ({ text: `Flight Analytics · карточка пилота · ${currentPage} / ${pageCount}`, alignment: "right", color: MUTED, fontSize: 7, margin: [0, 8, 30, 0] }),
    styles: {
      title: { fontSize: 18, bold: true, color: NAVY },
      eyebrow: { fontSize: 7, bold: true, color: RED, characterSpacing: 1.1 },
      sectionTitle: { fontSize: 12, bold: true, color: NAVY, margin: [0, 10, 0, 5] },
    },
    content: [
      { text: "АНАЛИТИКА ЛЁТНЫХ ДАННЫХ", style: "eyebrow" },
      { text: "Карточка пилота", style: "title", margin: [0, 3, 0, 10] },
      {
        columns: [
          {
            width: "auto",
            stack: [
              { image: dossier.avatarDataUrl, width: 82, alignment: "center", margin: [0, 0, 0, 14] },
              reportLabel("ТАБЕЛЬНЫЙ НОМЕР"),
              reportValue(pilot.code),
              reportLabel("ФАМИЛИЯ, ИМЯ, ОТЧЕСТВО"),
              reportValue(pilot.name),
              reportLabel("ДОЛЖНОСТЬ"),
              reportValue(pilot.position === "КВС" ? "Командир воздушного судна" : "Второй пилот", { color: NAVY }),
              reportLabel("РОЛЬ В ЭКИПАЖЕ"),
              reportValue(pilot.role),
              reportLabel("ТИП ВС"),
              reportValue(pilot.aircraftType),
              reportLabel("РЕЙСОВ В ВЫБОРКЕ"),
              reportValue(String(dossier.flightsInScope), { margin: [0, 0, 0, 0] }),
            ],
          },
          {
            width: "*",
            stack: [
              { text: "Профиль по всем показателям", style: "sectionTitle", margin: [0, 0, 0, 3] },
              { svg: pilotProfileLegendSvg(), width: 516, margin: [0, 0, 0, 7] },
              ...(profile ? [{ svg: profile, width: 516 } as Content] : [{ text: "Нет данных для профиля.", color: MUTED } as Content]),
            ],
          },
        ],
        columnGap: 22,
      },
      { text: "Показатели пилота и типа ВС", style: "sectionTitle" },
      {
        table: { headerRows: 2, dontBreakRows: true, widths: [152, "*", "*", "*", "*", "*", "*", "*", 50], body: tableBody },
        layout: "lightHorizontalLines",
      },
      {
        text: `Фильтры выборки: тип ВС — ${dossier.aircraftFilter || "все"}; аэропорт — ${dossier.airportFilter || "все"}. Сформировано ${dossier.generatedAt.toLocaleString("ru-RU")}.`,
        color: MUTED,
        fontSize: 7,
        margin: [0, 10, 0, 0],
      },
    ],
  };
}

export async function downloadPilotReportPdf(dossier: PilotReport) {
  const [pdfMakeModule, pdfFontsModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const pdfMake = (pdfMakeModule as typeof pdfMakeModule & { default?: typeof pdfMakeModule }).default ?? pdfMakeModule;
  const fonts = (pdfFontsModule as typeof pdfFontsModule & { default?: typeof pdfFontsModule }).default ?? pdfFontsModule;
  pdfMake.addVirtualFileSystem(fonts);
  const safeName = dossier.pilot.name.replace(/\s+/g, "-").toLocaleLowerCase("ru-RU");
  await new Promise<void>((resolve, reject) => {
    try {
      pdfMake.createPdf(buildPilotReportPdfDocument(dossier)).download(`pilot-card-${dossier.pilot.code}-${safeName}-${stamp(dossier.generatedAt)}.pdf`, resolve);
    } catch (error) {
      reject(error);
    }
  });
}
