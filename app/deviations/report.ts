// Приложение № 5 инструкции — таблица учёта Отклонений 4 уровня (стр. 37).
// Бланк воспроизводится кодом, а не берётся картинкой из PDF: так в него попадают
// данные, а колонки «Причина», «Выводы» и «Подпись» остаются пустыми под руку.
import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { formatFlightDate } from "../flight-data.ts";
import { commanderDetachment } from "./detachments.ts";
import { measuredValue } from "./presentation.ts";
import type { DeviationEntry } from "./summary.ts";

export type Level4Row = {
  index: number;
  dateTime: string;
  flightNumber: string;
  nature: string;
  details: string;
};

export type Level4Report = {
  generatedAt: Date;
  detachment: string | null;
  aircraftTypes: string[];
  periodFrom: string | null;
  periodTo: string | null;
  rows: Level4Row[];
};

export const REPORT_COLUMNS = [
  "№ п/п",
  "Дата, время полёта",
  "Номер рейса",
  "Характер Отклонения 4 уровня",
  "Причина, вызвавшая Отклонение 4 уровня",
  "Выводы и рекомендации",
  "Подпись ком. ЛО",
];

function period(dates: string[]): { from: string | null; to: string | null } {
  const sorted = dates.filter(Boolean).sort();
  return { from: sorted[0] ?? null, to: sorted[sorted.length - 1] ?? null };
}

// Одно отклонение на рейс и норматив: проверка органов управления пишется
// отдельным событием на каждую поверхность, в таблице учёта это одна строка.
export function buildLevel4Report(entries: DeviationEntry[], options: { detachment?: string | null; generatedAt?: Date } = {}): Level4Report {
  const detachment = options.detachment ?? null;
  const chosen = new Map<string, DeviationEntry>();
  for (const entry of entries) {
    if (entry.classification.level !== 4) continue;
    if (detachment && commanderDetachment(entry.flight.detachment ?? "") !== detachment.replace(/\s+/g, "")) continue;
    const key = `${entry.flight.key}:${entry.classification.rule.key}`;
    if (!chosen.has(key)) chosen.set(key, entry);
  }
  const sorted = [...chosen.values()].sort((left, right) => {
    const byDate = (left.flight.date ?? "").split(".").reverse().join("").localeCompare((right.flight.date ?? "").split(".").reverse().join(""));
    return byDate !== 0 ? byDate : (left.flight.departureTime ?? "").localeCompare(right.flight.departureTime ?? "");
  });

  const rows: Level4Row[] = sorted.map((entry, index) => {
    const measured = measuredValue(entry.classification);
    return {
      index: index + 1,
      dateTime: [formatFlightDate(entry.flight.date), entry.flight.departureTime].filter(Boolean).join(", "),
      flightNumber: entry.flight.flightNumber || "—",
      nature: [entry.classification.rule.name.ru, measured].filter(Boolean).join(" · "),
      details: [`${entry.flight.departure} \u2013 ${entry.flight.arrival}`, entry.flight.aircraftType, entry.flight.board].filter(Boolean).join(", "),
    };
  });

  const dates = period(sorted.map((entry) => (entry.flight.date ?? "").split(".").reverse().join("-")));
  return {
    generatedAt: options.generatedAt ?? new Date(),
    detachment,
    aircraftTypes: [...new Set(sorted.map((entry) => entry.flight.aircraftType))].sort(),
    periodFrom: dates.from,
    periodTo: dates.to,
    rows,
  };
}

// И pdfmake, и exceljs приезжают то модулем, то объектом в default — зависит от сборки.
const unwrap = <T,>(module: unknown): T => ((module as { default?: T }).default ?? module) as T;

const humanDate = (iso: string | null) => (iso ? iso.split("-").reverse().join(".") : "____________");
const fileStamp = (date: Date) => date.toISOString().slice(0, 10);

function headerLines(report: Level4Report): { unit: string; period: string } {
  const types = report.aircraftTypes.length > 0 ? report.aircraftTypes.join(", ") : "___";
  return {
    unit: `ЛЁТНЫЙ ОТРЯД ${report.detachment ?? "_____"} тип ВС ${types}`,
    period: `За период с ${humanDate(report.periodFrom)} по ${humanDate(report.periodTo)}`,
  };
}

export function buildLevel4PdfDocument(report: Level4Report): TDocumentDefinitions {
  const lines = headerLines(report);
  // Пустой бланк печатается с семью строками — как в инструкции.
  const body = report.rows.length > 0
    ? report.rows.map((row) => [
        { text: String(row.index), alignment: "center" as const },
        { text: row.dateTime },
        { text: row.flightNumber },
        { text: [{ text: row.nature }, { text: `\n${row.details}`, fontSize: 7, color: "#667580" }] },
        { text: "" },
        { text: "" },
        { text: "" },
      ])
    : Array.from({ length: 7 }, () => REPORT_COLUMNS.map(() => ({ text: " " })));

  const content: Content[] = [
    { text: "Приложение № 5", alignment: "right", fontSize: 10, bold: true, margin: [0, 0, 0, 10] },
    { text: "АО «Авиакомпания «Россия»", alignment: "center", fontSize: 11, bold: true },
    { text: lines.unit, alignment: "center", fontSize: 11, bold: true, margin: [0, 0, 0, 18] },
    { text: "ТАБЛИЦА", alignment: "center", fontSize: 11, bold: true },
    { text: "Учёта Отклонений 4 уровня по результатам обработки полётной информации", alignment: "center", fontSize: 11, bold: true, margin: [0, 0, 0, 14] },
    { text: lines.period, alignment: "center", fontSize: 10, margin: [0, 0, 0, 14] },
    {
      table: {
        headerRows: 1,
        widths: [28, 62, 42, "*", "*", 74, 52],
        body: [REPORT_COLUMNS.map((title) => ({ text: title, bold: true, fontSize: 9 })), ...body],
      },
      layout: {
        hLineColor: () => "#000000",
        vLineColor: () => "#000000",
        hLineWidth: () => 0.7,
        vLineWidth: () => 0.7,
        paddingTop: () => 6,
        paddingBottom: () => 6,
      },
      fontSize: 9,
    },
  ];

  return {
    pageSize: "A4",
    pageMargins: [36, 36, 36, 40],
    defaultStyle: { fontSize: 9, color: "#14243a" },
    content,
    footer: () => ({
      text: `Сформировано ${report.generatedAt.toLocaleString("ru-RU")} · Flight Analytics`,
      fontSize: 7,
      color: "#667580",
      margin: [36, 8, 36, 0],
    }),
  };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// pdfmake раздаётся и как CommonJS, и как ESM: у сборки по-разному лежит default.
type PdfMakeLike = {
  addVirtualFileSystem: (fonts: unknown) => void;
  createPdf: (document: TDocumentDefinitions) => { download: (name: string, callback?: () => void) => void };
};

export async function downloadLevel4Pdf(report: Level4Report) {
  const [pdfMakeModule, pdfFontsModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  const pdfMake = unwrap<PdfMakeLike>(pdfMakeModule);
  const fonts = unwrap<unknown>(pdfFontsModule);
  pdfMake.addVirtualFileSystem(fonts);
  await new Promise<void>((resolve, reject) => {
    try {
      pdfMake.createPdf(buildLevel4PdfDocument(report)).download(`otkloneniya-4-urovnya-${fileStamp(report.generatedAt)}.pdf`, resolve);
    } catch (error) {
      reject(error);
    }
  });
}

// Книга собирается отдельно от скачивания: так её можно проверить в тестах.
export async function buildLevel4Workbook(report: Level4Report) {
  // В браузерной сборке exceljs лежит в самом модуле, в node — в default.
  const ExcelJS = unwrap<typeof import("exceljs")>(await import("exceljs"));
  const lines = headerLines(report);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flight Analytics";
  workbook.created = report.generatedAt;
  const sheet = workbook.addWorksheet("Отклонения 4 уровня");
  sheet.columns = [
    { width: 7 }, { width: 18 }, { width: 12 }, { width: 46 }, { width: 34 }, { width: 28 }, { width: 18 },
  ];

  const title = (text: string, bold = true) => {
    const row = sheet.addRow([text]);
    sheet.mergeCells(`A${row.number}:G${row.number}`);
    row.getCell(1).alignment = { horizontal: "center" };
    row.getCell(1).font = { bold, size: 12 };
    return row;
  };
  title("АО «Авиакомпания «Россия»");
  title(lines.unit);
  sheet.addRow([]);
  title("ТАБЛИЦА");
  title("Учёта Отклонений 4 уровня по результатам обработки полётной информации");
  title(lines.period, false);
  sheet.addRow([]);

  const header = sheet.addRow(REPORT_COLUMNS);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 34;

  for (const row of report.rows) {
    sheet.addRow([row.index, row.dateTime, row.flightNumber, `${row.nature}\n${row.details}`, "", "", ""]);
  }
  if (report.rows.length === 0) for (let index = 0; index < 7; index += 1) sheet.addRow([index + 1, "", "", "", "", "", ""]);

  const first = header.number;
  for (let number = first; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      if (number > first) cell.alignment = { vertical: "top", wrapText: true };
    });
  }

  return workbook;
}

export async function downloadLevel4Excel(report: Level4Report) {
  const workbook = await buildLevel4Workbook(report);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `otkloneniya-4-urovnya-${fileStamp(report.generatedAt)}.xlsx`);
}
