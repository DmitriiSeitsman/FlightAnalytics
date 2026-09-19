// База рейса для сводной таблицы: лётный отряд командира → Москва или Санкт-Петербург.
// Соответствие взято из CrewPlannerWeb (database/migrations/015_normalized_flight_organization.sql),
// где структура отрядов заведена нормально, и вынесено в config/detachments.json.
// В выгрузке поле Letnie_Otryady — пара «отряд КВС, отряд 2П»; база берётся по первому.

export const flightBases = ["МСК", "СПБ"] as const;
export type FlightBase = (typeof flightBases)[number];
export type Detachment = { id: string; prefix: string; base: FlightBase };
export type DetachmentConfig = { detachments: Detachment[]; source: string | null };

export function parseDetachmentConfig(raw: unknown): DetachmentConfig {
  const issues: string[] = [];
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  if (!record) throw new Error("config/detachments.json: ожидался объект");
  const list = Array.isArray(record.detachments) ? record.detachments : [];
  if (list.length === 0) issues.push("detachments: пустой список отрядов");
  const detachments: Detachment[] = [];
  list.forEach((item, index) => {
    const entry = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : null;
    const id = typeof entry?.id === "string" ? entry.id : "";
    const prefix = typeof entry?.prefix === "string" ? entry.prefix : "";
    const base = entry?.base;
    if (!id || !prefix) issues.push(`detachments[${index}]: нужны непустые id и prefix`);
    else if (base !== "МСК" && base !== "СПБ") issues.push(`detachments[${index}].base: ожидалось «МСК» или «СПБ», получено ${String(base)}`);
    else detachments.push({ id, prefix, base });
  });
  if (issues.length > 0) throw new Error(`config/detachments.json не прошёл проверку:\n${issues.map((issue) => `  • ${issue}`).join("\n")}`);
  return { detachments, source: typeof record.source === "string" ? record.source : null };
}

// «ЛО4 RRJ-95 - АЭ 1,ЛО4 RRJ-95 - АЭ 6» → отряд командира, «ЛО4».
export function commanderDetachment(letnieOtryady: string): string | null {
  const first = (letnieOtryady ?? "").split(",")[0] ?? "";
  const compact = first.replace(/\s+/g, "").toUpperCase();
  const match = compact.match(/^ЛО\d+/);
  return match ? match[0] : null;
}

export function baseOfDetachment(letnieOtryady: string, config: DetachmentConfig): FlightBase | null {
  const detachment = commanderDetachment(letnieOtryady);
  if (!detachment) return null;
  return config.detachments.find((item) => item.prefix.replace(/\s+/g, "").toUpperCase() === detachment)?.base ?? null;
}
