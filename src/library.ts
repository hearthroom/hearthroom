import { Hono } from "hono";
import { listCards, toCard } from "./cards";
import { memberByHandle, memberHiddenTags, memberNsfw, requireMember } from "./members";
import { tagNamesFor } from "../shared/tag-catalog";
import { HttpError, type Env } from "./types";

export const libraryRoutes = new Hono<{ Bindings: Env }>();
libraryRoutes.use('/v1/me/*', async (c, next) => {
  const match = /^\/v1\/me\/(favorites|following|feed)(?:\/[^/]+)?$/.exec(c.req.path);
  if (!match || !['GET', 'PUT', 'DELETE'].includes(c.req.method)) return next();
  c.header('Cache-Control', 'private, no-store');
  await next();
  const operation = `${match[1]}_${c.req.method.toLowerCase()}`;
  const outcome = c.res.status < 400 ? 'success' : c.res.status < 500 ? 'denied' : 'error';
  try {
    await c.env.DB.prepare('INSERT INTO library_metrics(operation,outcome,value) VALUES(?,?,1) ON CONFLICT(operation,outcome) DO UPDATE SET value=value+1').bind(operation,outcome).run();
  } catch { console.warn('Library request metric unavailable'); }
});

libraryRoutes.get('/metrics', async c => {
  const rows = await c.env.DB.prepare('SELECT operation,outcome,value FROM library_metrics ORDER BY operation,outcome').all<{ operation: string; outcome: string; value: number }>();
  const lines = rows.results.filter(r => /^(favorites|following|feed)_(get|put|delete)$/.test(r.operation) && /^(success|denied|error)$/.test(r.outcome))
    .map(r => `hearthroom_library_requests_total{operation="${r.operation}",outcome="${r.outcome}"} ${r.value}`);
  return c.text('# HELP hearthroom_library_requests_total Community library requests.\n# TYPE hearthroom_library_requests_total counter\n' + lines.join('\n') + '\n', 200, { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' });
});
const kinds = ["favorites", "following"] as const;
const offsetOf = (raw?: string) => Math.min(100000, Math.max(0, Math.floor(Number(raw) || 0)));

for (const kind of kinds) {
  const table = kind === "favorites" ? "member_favorites" : "member_follows";
  const column = kind === "favorites" ? "card_id" : "author_id";
  libraryRoutes.on(["GET", "PUT", "DELETE"], `/v1/me/${kind}/:target`, async c => {
    c.header("Cache-Control", "private, no-store");
    const member = await requireMember(c);
    const raw = c.req.param("target")!;
    const target = kind === "favorites" ? raw : await memberByHandle(c.env.DB, raw);
    if (!target) throw new HttpError(404, "not_found");
    if (c.req.method !== "DELETE" && kind === "favorites") {
      const card = await c.env.DB.prepare('SELECT status,nsfw FROM cards WHERE id=?').bind(target).first<{status:string; nsfw:number}>();
      const access = await memberNsfw(c.env.DB, member.id);
      if (!card || card.status !== "approved" || (card.nsfw && !(access.showNsfw && access.ageVerifiedAt))) throw new HttpError(404, "not_found");
    }
    if (c.req.method === "PUT") {
      await c.env.DB.prepare(`INSERT OR IGNORE INTO ${table}(member_id,${column},created_at) VALUES(?,?,?)`).bind(member.id, target, Date.now()).run();
    } else if (c.req.method === "DELETE") {
      await c.env.DB.prepare(`DELETE FROM ${table} WHERE member_id=? AND ${column}=?`).bind(member.id, target).run();
    }
    const row = await c.env.DB.prepare(`SELECT 1 FROM ${table} WHERE member_id=? AND ${column}=?`).bind(member.id, target).first();
    const count = kind === "favorites" ? await c.env.DB.prepare("SELECT COUNT(*) AS n FROM member_favorites WHERE card_id=?").bind(target).first<{ n: number }>() : null;
    return c.json({ active: !!row, ...(count ? { count: count.n } : {}) });
  });
}

for (const kind of ["favorites", "feed"] as const) {
  libraryRoutes.get(`/v1/me/${kind}`, async c => {
    c.header("Cache-Control", "private, no-store");
    const member = await requireMember(c);
    const access = await memberNsfw(c.env.DB, member.id);
    const hidden = await memberHiddenTags(c.env.DB, member.id);
    const offset = offsetOf(c.req.query("offset"));
    const limit = 24;
    const result = await listCards(c.env.DB, {
      ...(kind === "favorites" ? { favoritedBy: member.id } : { followedBy: member.id }),
      sort: "new", limit, offset,
      allowNsfw: access.showNsfw && !!access.ageVerifiedAt,
      excludeTags: hidden.flatMap(k => tagNamesFor(k) ?? []),
    });
    return c.json({ items: result.rows.map(row => toCard(row, c.req.query("lang") || "zh-Hant")), hasNext: result.hasNext, total: result.total, offset, limit });
  });
}

libraryRoutes.get("/v1/me/following", async c => {
  c.header("Cache-Control", "private, no-store");
  const member = await requireMember(c);
  const offset = offsetOf(c.req.query("offset"));
  const result = await c.env.DB.prepare(`SELECT m.handle, COALESCE(m.display_name,m.handle) AS name, m.avatar_url AS avatar, m.bio
    FROM member_follows f JOIN members m ON m.id=f.author_id WHERE f.member_id=? ORDER BY f.created_at DESC,m.handle LIMIT 25 OFFSET ?`).bind(member.id, offset).all();
  return c.json({ items: result.results.slice(0,24), hasNext: result.results.length > 24, offset, limit: 24 });
});
