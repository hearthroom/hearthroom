import { auditStmt, type ActorKind } from "./audit";
import { HttpError } from "./types";

/**
 * 本站運營設定（開業活動設計 §2.1）。沒設的鍵＝那一條規則不啟用；程式不替站方選預設數字。
 * 計畫 4 會在這裡加活動相關的鍵。
 */
export interface CommunitySettings {
  commentNewAccountDays: number | null;
  commentMaxLinks: number | null;
  commentReportFoldThreshold: number | null;
}
const KEYS: Record<keyof CommunitySettings, { min: number; max: number }> = {
  commentNewAccountDays: { min: 0, max: 365 },
  commentMaxLinks: { min: 0, max: 20 },
  commentReportFoldThreshold: { min: 1, max: 100 },
};

export async function readSettings(db: D1Database): Promise<CommunitySettings> {
  const rows = await db.prepare("SELECT key, value FROM community_settings").all<{ key: string; value: string }>();
  const out: CommunitySettings = { commentNewAccountDays: null, commentMaxLinks: null, commentReportFoldThreshold: null };
  for (const r of rows.results) if (Object.hasOwn(KEYS, r.key)) out[r.key as keyof CommunitySettings] = Number(JSON.parse(r.value));
  return out;
}

export async function writeSettings(db: D1Database, patch: Partial<CommunitySettings>, actor: { memberId: string; kind: ActorKind }, operationId: string, now: number): Promise<CommunitySettings> {
  const before = await readSettings(db);
  const writes: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(patch) as [keyof CommunitySettings, number | null][]) {
    const rule = Object.hasOwn(KEYS, key) ? KEYS[key] : undefined;
    if (!rule) throw new HttpError(400, "invalid_settings");
    if (value === null) { writes.push(db.prepare("DELETE FROM community_settings WHERE key = ?").bind(key)); continue; }
    if (!Number.isInteger(value) || value < rule.min || value > rule.max) throw new HttpError(400, "invalid_settings");
    writes.push(db.prepare("INSERT INTO community_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at").bind(key, JSON.stringify(value), actor.memberId, now));
  }
  if (!writes.length) return before;
  writes.push(auditStmt(db, { subjectKind: "community_settings", subjectId: "comment", actorMemberId: actor.memberId, actorKind: actor.kind, action: "update", before, after: { ...before, ...patch }, operationId, now }));
  await db.batch(writes);
  return readSettings(db);
}
