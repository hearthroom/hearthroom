/**
 * 遊戲模式的世界配置：作者替自己的卡存一份（PUT）、遊戲頁公開讀（GET）、作者可清掉（DELETE）。
 *
 * 擁有權跟登記卡片同一套：拿作者的 token 問上游「你是誰」，再拿 roleId 問上游這張卡的作者是誰，
 * 兩個對得上才能寫。讀是公開的——遊戲頁本來就對遊客開放第一幕。
 * 配置的形狀由 shared/game-spec.ts 驗，前端編輯器用同一份規則。
 */
import type { Hono } from "hono";
import { GAME_SPEC_MAX_BYTES, validateGameSpec } from "../shared/game-spec";
import { note, type Pending } from "./analytics";
import { type Env, HttpError } from "./types";
import { upstream } from "./upstream";

type App = Hono<{ Bindings: Env; Variables: { ev: Pending } }>;

const ROLE_ID = /^[0-9a-f-]{8,64}$/i;

export async function getGameSpec(db: D1Database, roleId: string): Promise<{ spec: string; updatedAt: number } | null> {
  const row = await db.prepare("SELECT spec, updated_at FROM game_worlds WHERE role_id = ?").bind(roleId).first<{ spec: string; updated_at: number }>();
  return row ? { spec: row.spec, updatedAt: row.updated_at } : null;
}

export function gameRoutes(app: App): void {
  app.get("/v1/cards/:roleId/game", async (c) => {
    const roleId = c.req.param("roleId");
    if (!ROLE_ID.test(roleId)) throw new HttpError(404, "no game config");
    const row = await getGameSpec(c.env.DB, roleId);
    if (!row) throw new HttpError(404, "no game config");
    note(c, { event: "game_spec_read", subject: roleId });
    // 作者存檔後玩家很快就要看到；60 秒的邊緣快取夠擋住熱門卡的重複讀
    return new Response(JSON.stringify({ roleId, spec: JSON.parse(row.spec), updatedAt: row.updatedAt }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  });

  app.put("/v1/cards/:roleId/game", async (c) => {
    const roleId = c.req.param("roleId");
    if (!ROLE_ID.test(roleId)) throw new HttpError(400, "bad roleId");
    const me = await requireAuthor(c);
    const role = await upstream.fetchRole(c.env, roleId);
    if (role.authorNumId !== me.accountNumId) throw new HttpError(403, "not the author of this card");
    const text = await c.req.text();
    if (text.length > GAME_SPEC_MAX_BYTES * 2) throw new HttpError(400, "spec too large");
    const body = (() => { try { return JSON.parse(text) as { spec?: unknown }; } catch { return null; } })();
    const v = validateGameSpec(body?.spec);
    if (!v.ok) return c.json({ error: "invalid spec", errors: v.errors }, 400);
    const now = Date.now();
    await c.env.DB.prepare(
      "INSERT INTO game_worlds (role_id, author_num_id, spec, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(role_id) DO UPDATE SET author_num_id = excluded.author_num_id, spec = excluded.spec, updated_at = excluded.updated_at",
    ).bind(roleId, me.accountNumId, JSON.stringify(v.spec), now).run();
    note(c, { event: "game_spec_save", subject: roleId });
    return c.json({ roleId, spec: v.spec, updatedAt: now });
  });

  app.delete("/v1/cards/:roleId/game", async (c) => {
    const roleId = c.req.param("roleId");
    if (!ROLE_ID.test(roleId)) throw new HttpError(400, "bad roleId");
    const me = await requireAuthor(c);
    const role = await upstream.fetchRole(c.env, roleId);
    if (role.authorNumId !== me.accountNumId) throw new HttpError(403, "not the author of this card");
    await c.env.DB.prepare("DELETE FROM game_worlds WHERE role_id = ?").bind(roleId).run();
    note(c, { event: "game_spec_delete", subject: roleId });
    return c.json({ ok: true });
  });
}

async function requireAuthor(c: { env: Env; req: { header: (k: string) => string | undefined } }) {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer) throw new HttpError(401, "missing bearer token");
  return await upstream.fetchMe(c.env, bearer);
}
