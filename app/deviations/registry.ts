/// <reference types="vite/client" />
// Загрузка матрицы отклонений в приложение. Все файлы config/deviations/*.json
// попадают в бандл автоматически — чтобы добавить тип ВС, код менять не нужно.
import { buildDeviationMatrix, type DeviationMatrix } from "./config.ts";
import { parseDetachmentConfig, type DetachmentConfig } from "./detachments.ts";
import detachmentsData from "../../config/detachments.json";

const configModules = import.meta.glob("../../config/deviations/*.json", { eager: true, import: "default" }) as Record<string, unknown>;

export const deviationMatrix: DeviationMatrix = buildDeviationMatrix(
  Object.entries(configModules)
    .filter(([path]) => !path.endsWith("/schema.json"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, data]) => ({ source: path.slice(path.lastIndexOf("/") + 1), data })),
);

// Лётные отряды → базы для сводной таблицы отклонений.
export const detachmentConfig: DetachmentConfig = parseDetachmentConfig(detachmentsData);
