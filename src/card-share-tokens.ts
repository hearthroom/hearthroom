/**
 * 分享回流（原語 2）：分享者在卡內主動產生一條帶平台短碼的連結，朋友從那條連結回應卡片宣告過的投票
 * （share: true），分享者讀得到匿名彙總。設計：docs/studio/tasks/2026-10-25-card-share-context/design.md §7。
 *
 *   - 短碼放在分享連結的 ?share=~XXXXXXXX：「~」開頭的值是平台短碼，卡片自己的情境碼不會用到它。
 *     朋友開卡時遊玩頁先把短碼解回原本的情境碼，卡片讀 sdk.share.context 的方式不變。
 *   - 分享者是誰只存在 owner_member_id，只用來授權他讀自己的結果，從不回傳。
 *   - 隱私（E4）：回應未滿 3 人只給總數；各選項人數每天最多更新一次。總數即時（design §7.7）。
 *   - owner 允許卡片拿回流數字解鎖卡內內容（E5）；平台的邀請獎勵照常並存，這裡不碰任何獎勵事件。
 */
import { localDay, type CardState } from "./card-state";
import { HttpError, type Env } from "./types";

export const TOKEN_RE = /^~[A-Z0-9]{8}$/;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** 短碼 90 天後失效：情境碼送不到、也不再收回應。 */
export const TOKEN_TTL_MS = 90 * 86_400_000;
/** 每位會員每張卡每天最多產生幾條。 */
export const TOKENS_PER_DAY = 20;
/** 回應滿這麼多人才給各選項人數。 */
export const RESULT_THRESHOLD = 3;

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "~" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * 產生（或取回）一條短碼。同一位分享者、同一張卡、同一個情境碼與投票，在效期內回同一條——
 * 卡片在每次畫分享圖時都呼叫也不會一直長新碼。
 */
export async function mintToken(env: Env, state: CardState, ownerId: string, context: string, pollKey: string, now: number): Promise<{ token: string; expiresAt: number }> {
  const poll = state.decl.polls[pollKey];
  if (!poll || !poll.share) throw new HttpError(400, "not_declared");
  const existing = await env.DB.prepare("SELECT token, expires_at FROM card_share_tokens WHERE owner_member_id=? AND card_id=? AND ns=? AND context=? AND poll_key=? AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .bind(ownerId, state.cardId, state.ns, context, pollKey, now).first<{ token: string; expires_at: number }>();
  if (existing) return { token: existing.token, expiresAt: existing.expires_at };
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM card_share_tokens WHERE owner_member_id=? AND card_id=? AND created_at > ?")
    .bind(ownerId, state.cardId, now - 86_400_000).first<{ n: number }>();
  if ((today?.n ?? 0) >= TOKENS_PER_DAY) throw new HttpError(429, "limit_reached");
  for (let i = 0; i < 5; i++) {
    const token = newToken();
    const r = await env.DB.prepare("INSERT OR IGNORE INTO card_share_tokens (token, card_id, ns, owner_member_id, context, poll_key, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(token, state.cardId, state.ns, ownerId, context, pollKey, now, now + TOKEN_TTL_MS).run();
    if (r.meta.changes) return { token, expiresAt: now + TOKEN_TTL_MS };
  }
  throw new HttpError(503, "token_unavailable");
}

export interface TokenRow { token: string; card_id: number; ns: string; owner_member_id: string; context: string; poll_key: string; created_at: number; expires_at: number }

/** 這張卡上、還在效期內的短碼；別張卡的、過期的、壞的一律當沒有。 */
export async function tokenFor(env: Env, cardId: number, token: string, now: number): Promise<TokenRow | null> {
  if (!TOKEN_RE.test(token)) return null;
  const row = await env.DB.prepare("SELECT * FROM card_share_tokens WHERE token = ?").bind(token).first<TokenRow>();
  return row && row.card_id === cardId && row.expires_at > now ? row : null;
}

export interface TokenResult { context: string; pollKey: string; total: number; counts: Record<string, number> | null; updatedAt: string | null; expiresAt: number }

/** 各選項的人數（即時，只給快照用）。 */
async function liveCounts(env: Env, row: TokenRow, options: string[]): Promise<{ counts: Record<string, number>; total: number }> {
  const rows = await env.DB.prepare("SELECT option, value FROM card_state_totals WHERE card_id=? AND ns=? AND scope=? AND key=? AND period=''")
    .bind(row.card_id, row.ns, `share:${row.token}`, row.poll_key).all<{ option: string; value: number }>();
  const counts: Record<string, number> = Object.fromEntries(options.map((o) => [o, 0]));
  for (const r of rows.results) if (r.option in counts) counts[r.option] = Math.max(0, r.value);
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/**
 * 分享者自己在這張卡上發出去的短碼與結果（最新的 50 條）。總數即時；各選項人數只在回應滿 3 人時給，
 * 而且當天第一次讀時照一張快照，之後當天都回那一張（updatedAt 只到日期）。
 */
export async function ownerResults(env: Env, state: CardState, ownerId: string, now: number): Promise<TokenResult[]> {
  const rows = await env.DB.prepare("SELECT * FROM card_share_tokens WHERE owner_member_id=? AND card_id=? AND ns=? ORDER BY created_at DESC LIMIT 50")
    .bind(ownerId, state.cardId, state.ns).all<TokenRow>();
  const day = localDay(now);
  const out: TokenResult[] = [];
  for (const row of rows.results) {
    const options = state.decl.polls[row.poll_key]?.options ?? [];
    const live = await liveCounts(env, row, options);
    let snap = await env.DB.prepare("SELECT counts, total FROM card_share_snapshots WHERE token=? AND day=?").bind(row.token, day).first<{ counts: string; total: number }>();
    if (!snap) {
      snap = { counts: JSON.stringify(live.counts), total: live.total };
      await env.DB.prepare("INSERT OR IGNORE INTO card_share_snapshots (token, day, counts, total) VALUES (?, ?, ?, ?)").bind(row.token, day, snap.counts, snap.total).run();
    }
    const shown = snap.total >= RESULT_THRESHOLD;
    out.push({ context: row.context, pollKey: row.poll_key, total: live.total, counts: shown ? (JSON.parse(snap.counts) as Record<string, number>) : null, updatedAt: shown ? day : null, expiresAt: row.expires_at });
  }
  return out;
}
