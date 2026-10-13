/**
 * 蘇綺的照顧與召回（設定集「拓麻歌子與 QQ 寵物的枯れた技術水平思考」）。
 *
 * - 狀態存在帳號裡（suki_states），網站上的她與排程用同一套算法（shared/suki-care.ts）。
 * - 「餵食」不另外記：站上的對話紀錄（member_conversations）就是她吃過的故事。
 * - 召回不另開管道：寫一列 community_notifications，推播（dispatchPush）與 Discord 私訊
 *   照原本的規則送——有訂推播的才推、綁了 Discord 且開了私訊的才私訊。
 * - 召回預設關閉，要本人打開；一天最多一則（事件鍵帶日期），兩週以上沒來就不再吵。
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireMember } from "./members";
import { HttpError, type Env } from "./types";
import { localDay, recallDue, visit, type SukiState } from "../shared/suki-care";

type Row = { member_id: string; state: string; recall: number; tz_offset: number; last_seen: number; last_recall: number };

export const sukiRoutes = new Hono<{ Bindings: Env }>();

async function count(db: D1Database, operation: string, outcome: string, n = 1): Promise<void> {
  await db.prepare("INSERT INTO suki_metrics(operation,outcome,value) VALUES(?,?,?) ON CONFLICT(operation,outcome) DO UPDATE SET value=value+excluded.value")
    .bind(operation, outcome, n).run().catch(() => { console.warn("Suki metric unavailable"); });
}

const tzOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 14 * 60 ? Math.round(v) : 0);

async function lastStory(db: D1Database, member: string): Promise<number | null> {
  const row = await db.prepare("SELECT MAX(updated_at) AS at FROM member_conversations WHERE member_id=?").bind(member).first<{ at: number | null }>();
  return row?.at ?? null;
}

sukiRoutes.get("/v1/me/suki", async (c) => {
  const member = await requireMember(c);
  c.header("Cache-Control", "private, no-store");
  const row = await c.env.DB.prepare("SELECT state,recall FROM suki_states WHERE member_id=?").bind(member.id).first<Pick<Row, "state" | "recall">>();
  return c.json({ state: row ? (JSON.parse(row.state) as SukiState) : null, recall: !!row?.recall });
});

/** 打開網站：算時間流逝、連續天數、有沒有聊過故事；回傳新狀態與她要說的事 */
sukiRoutes.post("/v1/me/suki/visit", bodyLimit({ maxSize: 512 }), async (c) => {
  const member = await requireMember(c);
  c.header("Cache-Control", "private, no-store");
  const input = (await c.req.json().catch(() => ({}))) as { tzOffset?: unknown };
  const tz = tzOf(input.tzOffset);
  const now = Date.now();
  const row = await c.env.DB.prepare("SELECT state,recall FROM suki_states WHERE member_id=?").bind(member.id).first<Pick<Row, "state" | "recall">>();
  const { state, news } = visit(row ? (JSON.parse(row.state) as SukiState) : null, now, await lastStory(c.env.DB, member.id), tz);
  await c.env.DB.prepare(`INSERT INTO suki_states(member_id,state,tz_offset,last_seen,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(member_id) DO UPDATE SET state=excluded.state,tz_offset=excluded.tz_offset,last_seen=excluded.last_seen,updated_at=excluded.updated_at`)
    .bind(member.id, JSON.stringify(state), tz, now, now).run();
  await count(c.env.DB, "visit", "success");
  return c.json({ state, news, recall: !!row?.recall });
});

sukiRoutes.patch("/v1/me/suki", bodyLimit({ maxSize: 256 }), async (c) => {
  const member = await requireMember(c);
  c.header("Cache-Control", "private, no-store");
  const input = (await c.req.json().catch(() => null)) as { recall?: unknown } | null;
  if (typeof input?.recall !== "boolean") throw new HttpError(400, "invalid_arguments");
  const now = Date.now();
  await c.env.DB.prepare(`INSERT INTO suki_states(member_id,state,recall,last_seen,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(member_id) DO UPDATE SET recall=excluded.recall,updated_at=excluded.updated_at`)
    .bind(member.id, JSON.stringify(visit(null, now, null, 0).state), input.recall ? 1 : 0, now, now).run();
  await count(c.env.DB, input.recall ? "recall_on" : "recall_off", "success");
  return c.json({ recall: input.recall });
});

/**
 * 排程：每小時跑一次。該叫的人寫一列通知；有玩過、在榜上的卡就寄明信片（帶那張卡），
 * 沒有就說肚子餓了。回傳寄了幾則。
 */
export async function sukiRecall(env: Env, now = Date.now()): Promise<number> {
  const rows = (await env.DB.prepare(
    // 關掉站內通知的人也不叫（跟其他通知同一個總開關）
    `SELECT s.member_id,s.state,s.recall,s.tz_offset,s.last_seen,s.last_recall FROM suki_states s
     WHERE s.recall=1 AND s.last_seen BETWEEN ? AND ?
     AND NOT EXISTS (SELECT 1 FROM community_preferences p WHERE p.member_id=s.member_id AND p.notifications=0) LIMIT 500`,
  ).bind(now - 14 * 86_400_000, now - 20 * 3_600_000).all<Row>()).results;
  let sent = 0;
  for (const row of rows) {
    const state = JSON.parse(row.state) as SukiState;
    if (!recallDue(state, row.last_seen, row.last_recall, now, row.tz_offset)) continue;
    // 明信片：最近玩過、而且在榜上的那張卡
    const card = await env.DB.prepare(`SELECT cn.num AS num, c.id AS id FROM member_conversations r
      JOIN cards c ON c.provider=r.provider AND (c.source_role_id=r.role_id OR c.approved_hosted_role_id=r.role_id)
      JOIN card_numbers cn ON cn.provider=c.provider AND cn.source_role_id=c.source_role_id
      WHERE r.member_id=? AND c.status='approved' AND COALESCE(c.public_blocked,0)=0 AND c.rating IS NOT 'R'
      ORDER BY r.updated_at DESC LIMIT 1`).bind(row.member_id).first<{ num: number; id: string }>().catch(async () => {
      // 查卡失敗就退回「餓了」，但要記下來：不然明信片壞掉了也看不出來
      await count(env.DB, "recall", "card_error");
      return null;
    });
    const variant = card ? "postcard" : "hungry";
    const day = localDay(now, row.tz_offset);
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO community_notifications(event_key,member_id,kind,path,created_at,card_id,extra)
      VALUES(?,?,?,?,?,?,?)`).bind(`suki:${row.member_id}:${day}`, row.member_id, "suki_recall", card ? `/cards/${card.num}` : "/", now,
      card ? card.id : null, JSON.stringify({ variant })).run();
    await env.DB.prepare("UPDATE suki_states SET last_recall=? WHERE member_id=?").bind(now, row.member_id).run();
    if (result.meta.changes) { sent++; await count(env.DB, "recall", "sent"); }
  }
  return sent;
}
