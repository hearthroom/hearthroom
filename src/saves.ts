/**
 * 沙箱卡的存檔（sdk.save.*）：每個成員、每張卡、每個 key 一列。
 *
 * 規則跟殼那一側一致（殼先擋、這裡再擋一次，直接打 API 的也守得住）：
 *   - key 只許 [A-Za-z0-9_-]{1,64}（400 key_invalid）
 *   - 單值 JSON 序列化後 ≤ 64 KB（400 value_too_large）
 *   - 每張卡最多 10 個 key（400 saves_full）；覆寫既有 key 不算新增
 */
import { HttpError } from "./types";

export const SAVE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SAVE_MAX_KEYS = 10;
export const SAVE_MAX_VALUE_BYTES = 64 * 1024;

export function assertSaveKey(key: string): void {
  if (!SAVE_KEY_RE.test(key)) throw new HttpError(400, "key_invalid");
}

export async function listSaves(db: D1Database, memberId: string, roleId: string): Promise<Record<string, unknown>> {
  const rows = await db
    .prepare("SELECT key, value FROM card_saves WHERE member_id = ? AND role_id = ? ORDER BY key")
    .bind(memberId, roleId)
    .all<{ key: string; value: string }>();
  const out: Record<string, unknown> = {};
  for (const r of rows.results) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* 壞列跳過：不讓一筆壞資料把整張卡的存檔弄掛 */ }
  }
  return out;
}

export async function putSave(db: D1Database, memberId: string, roleId: string, key: string, value: unknown, now: number): Promise<void> {
  assertSaveKey(key);
  let text: string;
  try {
    text = JSON.stringify(value === undefined ? null : value);
  } catch {
    throw new HttpError(400, "value_invalid");
  }
  if (new TextEncoder().encode(text).length > SAVE_MAX_VALUE_BYTES) throw new HttpError(400, "value_too_large");
  const existing = await db
    .prepare("SELECT COUNT(*) AS n, SUM(key = ?) AS has FROM card_saves WHERE member_id = ? AND role_id = ?")
    .bind(key, memberId, roleId)
    .first<{ n: number; has: number | null }>();
  if (!(existing?.has ?? 0) && (existing?.n ?? 0) >= SAVE_MAX_KEYS) throw new HttpError(400, "saves_full");
  await db
    .prepare(
      `INSERT INTO card_saves (member_id, role_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (member_id, role_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(memberId, roleId, key, text, now)
    .run();
}

export async function removeSave(db: D1Database, memberId: string, roleId: string, key: string): Promise<void> {
  assertSaveKey(key);
  await db.prepare("DELETE FROM card_saves WHERE member_id = ? AND role_id = ? AND key = ?").bind(memberId, roleId, key).run();
}
