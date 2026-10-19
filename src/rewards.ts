/**
 * 綺夢社這一側的應用獎勵（簽到、任務、新手七日）。規則、進度與發點都在 Harbor；
 * 這裡只放 Harbor 不該知道、或拿不到的東西（任務 2026-10-19-checkin-hearthroom-experience）：
 *   - 新手七日的桌寵提示今天彈過了沒（ui.md §15.6）
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requireMember } from "./members";
import { HttpError, type Env } from "./types";

export const rewardRoutes = new Hono<{ Bindings: Env }>();

/** 業務日：台北 04:00 換日（Harbor 獎勵方案的 timezone 與 dayStartHour），YYYY-MM-DD。 */
export function businessDay(now: number): string {
  return new Date(now + (8 - 4) * 3_600_000).toISOString().slice(0, 10);
}

rewardRoutes.get("/v1/me/checkin/prompt", async (c) => {
  const member = await requireMember(c);
  c.header("Cache-Control", "private, no-store");
  const day = businessDay(Date.now());
  const row = await c.env.DB.prepare("SELECT shown_day, later_day FROM checkin_prompts WHERE member_id=?").bind(member.id).first<{ shown_day: string | null; later_day: string | null }>();
  return c.json({ day, shown: row?.shown_day === day, later: row?.later_day === day });
});

rewardRoutes.post("/v1/me/checkin/prompt", bodyLimit({ maxSize: 256 }), async (c) => {
  const member = await requireMember(c);
  c.header("Cache-Control", "private, no-store");
  const input = (await c.req.json().catch(() => null)) as { kind?: unknown } | null;
  if (input?.kind !== "shown" && input?.kind !== "later") throw new HttpError(400, "invalid_arguments");
  const now = Date.now();
  const day = businessDay(now);
  // 按了「晚點再說」也代表今天彈過了
  await c.env.DB.prepare(`INSERT INTO checkin_prompts(member_id, shown_day, later_day, updated_at) VALUES(?,?,?,?)
    ON CONFLICT(member_id) DO UPDATE SET shown_day=excluded.shown_day, later_day=COALESCE(excluded.later_day, CASE WHEN checkin_prompts.later_day=excluded.shown_day THEN checkin_prompts.later_day END), updated_at=excluded.updated_at`)
    .bind(member.id, day, input.kind === "later" ? day : null, now).run();
  const row = await c.env.DB.prepare("SELECT later_day FROM checkin_prompts WHERE member_id=?").bind(member.id).first<{ later_day: string | null }>();
  return c.json({ day, shown: true, later: row?.later_day === day });
});
