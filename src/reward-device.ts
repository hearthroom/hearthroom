import type { Env } from "./types";

/**
 * 裝置安裝識別（X-Device-Token，來自瀏覽器 localStorage 的 hr.rewards.device）的 HMAC 雜湊與關聯紀錄。
 * 只存帶金鑰的雜湊（v1:<64-hex>），絕不存原值；每帳號上限 20 筆、90 天未見於排程清理（對齊 Harbor）。
 */
export const VALID_DEVICE_TOKEN = /^[A-Za-z0-9_.-]{16,128}$/;
export const MAX_DEVICES_PER_MEMBER = 20;
export const DEVICE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 驗證 X-Device-Token 並轉成帶前綴的 HMAC 雜湊；缺標頭、格式不合或未設定金鑰回 null（退回帳號計）。 */
export async function hashDeviceToken(env: Pick<Env, "REWARD_DEVICE_SECRET">, raw: string | null | undefined): Promise<string | null> {
  const secret = env.REWARD_DEVICE_SECRET?.trim();
  const token = raw?.trim();
  if (!secret || !token || !VALID_DEVICE_TOKEN.test(token)) return null;
  return `v1:${await hmacSha256Hex(secret, `card-quota:${token}`)}`;
}

/** 記錄帳號與裝置的關聯：既有列滿 1 小時才更新 last_seen（節省 D1 寫入），新列受每帳號 20 筆上限保護。 */
export async function recordRewardDevice(db: D1Database, memberId: string, deviceHash: string | null, now = Date.now()): Promise<void> {
  if (!deviceHash) return;
  const eligible = await db
    .prepare("SELECT 1 FROM members m WHERE m.id = ? AND m.account_class = 'normal' AND NOT EXISTS (SELECT 1 FROM legacy_account_fence f WHERE f.member_id = m.id)")
    .bind(memberId)
    .first();
  if (!eligible) return;
  const existing = await db
    .prepare("SELECT last_seen FROM reward_devices WHERE device_hash = ? AND member_id = ?")
    .bind(deviceHash, memberId)
    .first<{ last_seen: number }>();
  if (existing) {
    if (now - existing.last_seen >= TOUCH_INTERVAL_MS) {
      await db
        .prepare("UPDATE reward_devices SET last_seen = ? WHERE device_hash = ? AND member_id = ? AND last_seen < ?")
        .bind(now, deviceHash, memberId, now)
        .run();
    }
    return;
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO reward_devices (device_hash, member_id, first_seen, last_seen)
       SELECT ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM reward_devices WHERE member_id = ?) < ?`,
    )
    .bind(deviceHash, memberId, now, now, memberId, MAX_DEVICES_PER_MEMBER)
    .run();
}

/** 清理超過 90 天未再出現的裝置關聯。 */
export async function trimRewardDevices(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare("DELETE FROM reward_devices WHERE last_seen < ?").bind(now - DEVICE_RETENTION_MS).run();
}
