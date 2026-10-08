/**
 * 沙箱卡的存檔（sdk.save.*）：每個成員、每張卡、每個 key 一列。
 *
 * 規則跟殼那一側一致（殼先擋、這裡再擋一次，直接打 API 的也守得住）：
 *   - key 只許 [A-Za-z0-9_-]{1,64}（400 key_invalid）
 *   - 單值 JSON 序列化後 ≤ 64 KB（400 value_too_large）
 *   - 每張卡最多 10 個 key（400 saves_full）；覆寫既有 key 不算新增
 *
 * 「每張卡」是卡本身，不是某一版：每次過審都換一個新的託管 roleId，玩家下次進來拿的是新的那個。
 * 存檔若跟著 roleId 走，每次更新玩家的設定、收藏、看過的版本全都歸零（卡的更新公告也就永遠不跳）。
 * 所以先把 roleId 對回卡（原稿、任一版託管、任一副本都算同一張），寫到 `card:<卡號>` 這一份；
 * 讀的時候連同這張卡以前各版留下的列一起讀，同一個 key 取最新的——舊玩家的存檔不用遷移就接得上。
 */
import { getPublicCard } from "./cards";
import { HttpError } from "./types";

export const SAVE_KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SAVE_MAX_KEYS = 10;
export const SAVE_MAX_VALUE_BYTES = 64 * 1024;

export function assertSaveKey(key: string): void {
  if (!SAVE_KEY_RE.test(key)) throw new HttpError(400, "key_invalid");
}

/** 一張卡的存檔落在哪：寫入的那一份（key），與讀取時一併算進來的所有舊 roleId（ids，含 key 本身）。 */
export interface SaveScope { key: string; ids: string[] }

export async function saveScope(db: D1Database, roleId: string): Promise<SaveScope> {
  const card = await getPublicCard(db, roleId).catch(() => null);
  if (!card) return { key: roleId, ids: [roleId] };
  const key = `card:${card.id}`;
  const rows = await db
    .prepare(`SELECT hosted_revision_id AS id FROM hosting_versions WHERE card_id = ?
      UNION SELECT r.hosted_revision_id FROM hosting_replicas r JOIN hosting_versions v ON r.version_id = v.version_id WHERE v.card_id = ?`)
    .bind(card.id, card.id)
    .all<{ id: string | null }>();
  const ids = new Set<string>([key, roleId]);
  for (const v of [card.source_role_id, card.approved_hosted_role_id, ...rows.results.map((r) => r.id)]) if (v) ids.add(String(v));
  return { key, ids: [...ids].slice(0, 90) };
}

const inList = (n: number) => new Array(n).fill("?").join(",");

export async function listSaves(db: D1Database, memberId: string, roleId: string): Promise<Record<string, unknown>> {
  const scope = await saveScope(db, roleId);
  const rows = await db
    .prepare(`SELECT key, value FROM card_saves WHERE member_id = ? AND role_id IN (${inList(scope.ids.length)}) ORDER BY key, updated_at`)
    .bind(memberId, ...scope.ids)
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
  const scope = await saveScope(db, roleId);
  const existing = await db
    .prepare(`SELECT COUNT(DISTINCT key) AS n, MAX(key = ?) AS has FROM card_saves WHERE member_id = ? AND role_id IN (${inList(scope.ids.length)})`)
    .bind(key, memberId, ...scope.ids)
    .first<{ n: number; has: number | null }>();
  if (!(existing?.has ?? 0) && (existing?.n ?? 0) >= SAVE_MAX_KEYS) throw new HttpError(400, "saves_full");
  await db
    .prepare(
      `INSERT INTO card_saves (member_id, role_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (member_id, role_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(memberId, scope.key, key, text, now)
    .run();
}

export async function removeSave(db: D1Database, memberId: string, roleId: string, key: string): Promise<void> {
  assertSaveKey(key);
  // 刪掉這張卡每一版的這個 key，否則舊版留下的那列會在下次讀取時「復活」
  const scope = await saveScope(db, roleId);
  await db.prepare(`DELETE FROM card_saves WHERE member_id = ? AND role_id IN (${inList(scope.ids.length)}) AND key = ?`).bind(memberId, ...scope.ids, key).run();
}
