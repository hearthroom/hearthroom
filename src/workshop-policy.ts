export type WorkshopPolicyMode = "closed" | "self" | "open";
export interface WorkshopPolicyRow { access_mode?: string | null; allow_new?: number; revision?: number }

export function effectiveWorkshopPolicy(row?: WorkshopPolicyRow | null): WorkshopPolicyMode {
  if (row?.access_mode != null) return row.access_mode === "open" || row.access_mode === "self" ? row.access_mode : "closed";
  return row?.allow_new === 1 && (row.revision ?? 0) > 1 ? "open" : "closed";
}

export function policyAllowsAuthor(mode: WorkshopPolicyMode, byCardAuthor: boolean): boolean {
  return mode === "open" || (mode === "self" && byCardAuthor);
}

export const readWorkshopPolicy = async (db: D1Database, cardId: number) => {
  const row = await db.prepare("SELECT work_id, access_mode, allow_new, revision FROM workshop_policies WHERE card_id = ? ORDER BY updated_at DESC LIMIT 1")
    .bind(cardId).first<WorkshopPolicyRow & { work_id: string }>();
  return { mode: effectiveWorkshopPolicy(row), workId: row?.work_id };
};
