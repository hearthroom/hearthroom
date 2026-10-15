import { auditStmt, auditStmtIfChanged } from "./audit";
import { isReviewAgent, isReviewer } from "./members";
import { bumpOp } from "./ops-metrics";
import { HttpError, type Env } from "./types";

/**
 * 分享活動的截圖（開業活動設計 §3.5、§9.3）。整個 Worker 只有這個檔案碰 env.EVIDENCE（測試會掃 src/ 檢查）。
 *
 * 截圖是私人資料：放在私有 bucket，沒有公開路由，只有上傳者本人與審核員讀得到。
 * 流程：先上傳拿 id（placement_id NULL）→ 提交時 attachEvidence 掛到位置 → 24 小時內沒掛就由排程刪掉；
 * 掛上的在活動的發獎截止＋保留天數之後刪物件、留索引列（purged_at），稽核與重複比對（sha256）還查得到。
 */

export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
const FORMATS = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_PIXELS = 40_000_000;
const DAY = 86_400_000;
/** 未掛上的截圖留多久。attachEvidence 也拿它當界線：快被清掉的不能再掛，免得排程刪了物件、列卻剛掛上。 */
const UNATTACHED_TTL = DAY;
const UPLOADS_PER_DAY = 60;
const PER_PLACEMENT = 6;
const SWEEP = 50;
const NOT_ATTACHABLE = "evidence_not_attachable";

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** 上傳一張截圖。原檔不轉檔：審核要看原圖，sha256 也要對原檔算才比得出重複。 */
export async function uploadEvidence(env: Env, memberId: string, file: unknown, now: number): Promise<{ id: string; sha256: string; bytes: number }> {
  if (!(file instanceof File) || !file.size || file.size > EVIDENCE_MAX_BYTES) throw new HttpError(400, "evidence_invalid");
  if (!env.IMAGES || !env.EVIDENCE) throw new HttpError(503, "evidence_unavailable");
  // 先擋一次省下讀檔與驗證；真正的上限在下面的條件式 INSERT，並發的上傳才越不過去。
  const recent = await env.DB.prepare("SELECT count(*) AS n FROM share_evidence WHERE member_id = ? AND created_at > ?").bind(memberId, now - DAY).first<{ n: number }>();
  if ((recent?.n ?? 0) >= UPLOADS_PER_DAY) throw new HttpError(429, "evidence_rate_limited");
  const bytes = await file.arrayBuffer();
  let format: string;
  try {
    const info = await env.IMAGES.info(new Response(bytes).body!);
    if (!FORMATS.has(info.format) || !("width" in info) || info.width * info.height > MAX_PIXELS) throw new Error("invalid image");
    format = info.format;
  } catch {
    throw new HttpError(400, "evidence_invalid");
  }
  const id = crypto.randomUUID(), key = `evidence/${id}`, sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  // 先寫索引列再存物件：物件存失敗就刪列，不會有指向空物件的列；反過來列寫失敗會留下沒人管的物件。
  const inserted = await env.DB.prepare(
    "INSERT INTO share_evidence (id, member_id, r2_key, sha256, bytes, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE (SELECT count(*) FROM share_evidence WHERE member_id = ?2 AND created_at > ?7) < ?8",
  ).bind(id, memberId, key, sha256, bytes.byteLength, now, now - DAY, UPLOADS_PER_DAY).run();
  if (!inserted.meta.changes) throw new HttpError(429, "evidence_rate_limited");
  try {
    await env.EVIDENCE.put(key, bytes, { httpMetadata: { contentType: format } });
  } catch {
    await env.DB.prepare("DELETE FROM share_evidence WHERE id = ?").bind(id).run();
    throw new HttpError(503, "evidence_unavailable");
  }
  return { id, sha256, bytes: bytes.byteLength };
}

/**
 * 讀一張截圖。本人或審核員（含 AI 帳號）；其他人一律 404，不透露存不存在。審核員每次讀都先寫稽核再出檔。
 * viewer 為 null 表示訪客。
 */
export async function readEvidence(env: Env, viewer: string | null, id: string, now: number): Promise<R2ObjectBody> {
  const row = await env.DB.prepare("SELECT member_id, r2_key, purged_at FROM share_evidence WHERE id = ?").bind(id).first<{ member_id: string; r2_key: string; purged_at: number | null }>();
  if (!row || !viewer) throw new HttpError(404, "evidence_not_found");
  const own = row.member_id === viewer;
  if (!own && !(await isReviewer(env.DB, viewer))) throw new HttpError(404, "evidence_not_found");
  if (row.purged_at !== null) throw new HttpError(410, "evidence_purged");
  if (!env.EVIDENCE) throw new HttpError(503, "evidence_unavailable");
  if (!own) {
    const kind = (await isReviewAgent(env.DB, viewer)) ? "ai" : "human";
    await auditStmt(env.DB, { subjectKind: "share_evidence", subjectId: id, actorMemberId: viewer, actorKind: kind, action: "evidence_view", operationId: crypto.randomUUID(), now }).run();
  }
  const obj = await env.EVIDENCE.get(row.r2_key);
  if (!obj) throw new HttpError(404, "evidence_not_found");
  return obj;
}

/**
 * 把截圖掛到位置，放進呼叫端提交的同一個 db.batch（位置的 INSERT 要排在前面）。
 * 只掛本人上傳、還沒掛上、沒刪除、未滿 24 小時的；掛完每個位置最多 6 張。任何一張不符整批失敗——
 * batch 外層用 attachFailed 轉成 400 evidence_not_attachable。
 * 守門語句：條件不成立時 json_extract 收到壞路徑而報錯，錯誤訊息帶著這個代碼，batch 整個回滾。
 */
export function attachEvidence(db: D1Database, memberId: string, placementId: string, ids: string[], now = Date.now()): D1PreparedStatement[] {
  if (!ids.length) return [];
  if (ids.length > PER_PLACEMENT || new Set(ids).size !== ids.length || ids.some((x) => typeof x !== "string")) throw new HttpError(400, NOT_ATTACHABLE);
  const list = JSON.stringify(ids);
  return [
    db.prepare(
      `SELECT json_extract('{}', IIF(
         (SELECT count(*) FROM share_evidence WHERE id IN (SELECT value FROM json_each(?1)) AND member_id = ?2 AND placement_id IS NULL AND purged_at IS NULL AND created_at > ?5) = ?3
         AND (SELECT count(*) FROM share_evidence WHERE placement_id = ?4) + ?3 <= ?6, '$', '${NOT_ATTACHABLE}'))`,
    ).bind(list, memberId, ids.length, placementId, now - UNATTACHED_TTL, PER_PLACEMENT),
    db.prepare("UPDATE share_evidence SET placement_id = ?3 WHERE id IN (SELECT value FROM json_each(?1)) AND member_id = ?2 AND placement_id IS NULL AND purged_at IS NULL").bind(list, memberId, placementId),
  ];
}

/** attachEvidence 所在的 batch 失敗時用：守門語句的錯轉成 400，其他錯照原樣拋。 */
export function attachFailed(e: unknown): never {
  throw e instanceof Error && e.message.includes(NOT_ATTACHABLE) ? new HttpError(400, NOT_ATTACHABLE) : e;
}

/**
 * 每小時：(a) 未掛上超過 24 小時的，刪物件再刪列；(b) 活動發獎截止＋保留天數已過的，刪物件、成功才填 purged_at 並寫系統稽核。
 * 各最多 50 筆；物件刪除失敗整批留到下次。稽核的 operation_id 是 purge-<id>，且只在 purged_at 剛從 NULL 改掉時寫，重跑不會多一筆。
 */
export async function campaignMaintenance(env: Env, now: number): Promise<void> {
  const bucket = env.EVIDENCE;
  if (!bucket) return;
  const db = env.DB;

  const stale = (await db.prepare("SELECT id, r2_key FROM share_evidence WHERE placement_id IS NULL AND created_at <= ? LIMIT ?").bind(now - UNATTACHED_TTL, SWEEP).all<{ id: string; r2_key: string }>()).results;
  if (stale.length && (await bucket.delete(stale.map((r) => r.r2_key)).then(() => true, () => false))) {
    await db.prepare("DELETE FROM share_evidence WHERE id IN (SELECT value FROM json_each(?)) AND placement_id IS NULL").bind(JSON.stringify(stale.map((r) => r.id))).run();
  }

  const expired = (await db.prepare(
    `SELECT e.id, e.r2_key FROM share_evidence e
       JOIN share_placements p ON p.id = e.placement_id
       JOIN share_contents s ON s.id = p.content_id
       JOIN campaigns c ON c.id = s.campaign_id
     WHERE e.purged_at IS NULL AND c.payout_deadline IS NOT NULL AND c.payout_deadline + c.evidence_retention_days * ? < ? LIMIT ?`,
  ).bind(DAY, now, SWEEP).all<{ id: string; r2_key: string }>()).results;
  if (!expired.length) return;
  if (!(await bucket.delete(expired.map((r) => r.r2_key)).then(() => true, () => false))) {
    await bumpOp(db, "campaign", "purge", "error");
    return;
  }
  try {
    await db.batch(expired.flatMap((r) => [
      db.prepare("UPDATE share_evidence SET purged_at = ? WHERE id = ? AND purged_at IS NULL").bind(now, r.id),
      auditStmtIfChanged(db, { subjectKind: "share_evidence", subjectId: r.id, actorMemberId: null, actorKind: "system", action: "purge", operationId: `purge-${r.id}`, now }),
    ]));
  } catch (e) {
    // 物件已經刪了、列還沒標：下一輪再選到時刪除不存在的 key 照樣成功，就會補上 purged_at 與稽核。
    await bumpOp(db, "campaign", "purge", "error");
    throw e;
  }
  await bumpOp(db, "campaign", "purge", "success", expired.length);
}
