import { moderationMetrics } from "./moderation";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { listCards, toCard, type CardRow } from "./cards";
import { upstream } from "./upstream";
import { libraryAllowsNsfw, memberByHandle, memberHiddenTags, memberNsfw, requireMember } from "./members";
import { tagNamesFor } from "../shared/tag-catalog";
import { HttpError, pickLocale, type Env, type Localized } from "./types";

export const libraryRoutes = new Hono<{ Bindings: Env }>();
libraryRoutes.use('/v1/me/*', async (c, next) => {
  const match = /^\/v1\/me\/(favorites|following|feed|conversations)(?:\/[^/]+)?$/.exec(c.req.path);
  if (!match || !['GET', 'PUT', 'DELETE'].includes(c.req.method)) return next();
  c.header('Cache-Control', 'private, no-store');
  await next();
  const operation = `${match[1]}_${c.req.method.toLowerCase()}`;
  const outcome = c.res.status < 400 ? 'success' : c.res.status < 500 ? 'denied' : 'error';
  c.executionCtx.waitUntil(c.env.DB.prepare('INSERT INTO library_metrics(operation,outcome,value) VALUES(?,?,1) ON CONFLICT(operation,outcome) DO UPDATE SET value=value+1').bind(operation,outcome).run().catch(() => { console.warn('Library request metric unavailable'); }));
});

libraryRoutes.get('/metrics', async c => {
  const rows = await c.env.DB.prepare('SELECT operation,outcome,value FROM library_metrics ORDER BY operation,outcome').all<{ operation: string; outcome: string; value: number }>();
  const lines = rows.results.filter(r => /^(favorites|following|feed|conversations)_(get|put|delete)$/.test(r.operation) && /^(success|denied|error)$/.test(r.outcome))
    .map(r => `hearthroom_library_requests_total{operation="${r.operation}",outcome="${r.outcome}"} ${r.value}`);
  const community = await c.env.DB.prepare('SELECT operation,outcome,value FROM community_metrics').all<{operation:string;outcome:string;value:number}>();
  const communityLines=community.results.filter(r=>/^(member|bridge|oauth|media|badge_read|badge_write|badge_admin)$/.test(r.operation)&&/^(success|denied|error)$/.test(r.outcome)).map(r=>`hearthroom_community_requests_total{operation="${r.operation}",outcome="${r.outcome}"} ${r.value}`);
  lines.push('# HELP hearthroom_community_requests_total Community integration requests.','# TYPE hearthroom_community_requests_total counter',...communityLines);
  return c.text('# HELP hearthroom_library_requests_total Community library requests.\n# TYPE hearthroom_library_requests_total counter\n' + lines.join('\n') + '\n' + await moderationMetrics(c.env.DB), 200, { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' });
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
      const card = await c.env.DB.prepare('SELECT status,nsfw,public_blocked FROM cards WHERE id=?').bind(target).first<{status:string; nsfw:number; public_blocked:number}>();
      const access = await memberNsfw(c.env.DB, member.id);
      // 看自己已經收藏的那一張照收藏區的規則；新收藏還是要現在開著成人內容才行（卡片頁本身也要）
      const allowed = c.req.method === "GET" ? libraryAllowsNsfw(access) : access.showNsfw && !!access.ageVerifiedAt;
      if (!card || card.status !== "approved" || card.public_blocked || (card.nsfw && !allowed)) throw new HttpError(404, "not_found");
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
      // 收藏是自己的東西，照收藏區的規則；關注動態是在發現新卡，跟著開關走
      allowNsfw: kind === "favorites" ? libraryAllowsNsfw(access) : access.showNsfw && !!access.ageVerifiedAt,
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

// The caller records a session only after the player opens it successfully. These
// are private pointers owned by the community member, never imported chat bodies.
libraryRoutes.put('/v1/me/conversations', bodyLimit({ maxSize: 2048 }), async c => {
  const member = await requireMember(c);
  const body = await c.req.json().catch(() => null) as { roleId?: unknown; conversationId?: unknown } | null;
  const valid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  if (!valid(body?.roleId) || !valid(body?.conversationId)) throw new HttpError(400, 'invalid_arguments');
  const now = Date.now();
  await c.env.DB.prepare(`INSERT INTO member_conversations(member_id,provider,role_id,conversation_id,created_at,updated_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(member_id,provider,role_id) DO UPDATE SET conversation_id=excluded.conversation_id,updated_at=excluded.updated_at`)
    .bind(member.id, member.provider, body.roleId, body.conversationId, now, now).run();
  return c.json({ saved: true });
});

libraryRoutes.get('/v1/me/conversations', async c => {
  const member = await requireMember(c);
  const access = await memberNsfw(c.env.DB, member.id);
  const page = Math.min(4000, Math.max(1, Math.floor(Number(c.req.query('pageNum')) || 1)));
  // 紀錄一個版本一列；作者更新後玩家玩到新版，同一張卡就有好幾列。續玩一律開目前的版本，
  // 所以每張卡只列最近的那一列。對不到卡號的紀錄各自成一列。
  const rows = await c.env.DB.prepare(`SELECT * FROM (SELECT c.*, cn.num AS cardNumber, r.provider AS conversationProvider, r.role_id AS conversationRoleId,
    r.conversation_id AS conversationId, r.created_at AS createdAt, r.updated_at AS updatedAt,
    COALESCE(w.source_role_id,c.source_role_id,r.role_id) AS hostRoleId, ms.public_blocked AS moderationBlocked,
    ROW_NUMBER() OVER (PARTITION BY COALESCE('n'||cn.num,'r'||r.role_id) ORDER BY r.updated_at DESC,r.role_id) AS cardRank FROM member_conversations r
    LEFT JOIN work_copies cp ON cp.provider=r.provider AND cp.role_id=r.role_id
    LEFT JOIN hosting_replicas hr ON hr.provider=r.provider AND hr.hosted_revision_id=r.role_id
    LEFT JOIN hosting_versions hv ON hv.version_id=hr.version_id
    LEFT JOIN works w ON w.id=COALESCE(hv.work_id,cp.work_id)
    LEFT JOIN cards c ON c.provider=COALESCE(w.source_provider,r.provider) AND (c.source_role_id=COALESCE(w.source_role_id,r.role_id) OR c.approved_hosted_role_id=r.role_id)
    LEFT JOIN card_numbers cn ON cn.provider=COALESCE(w.source_provider,r.provider)
      AND cn.source_role_id=COALESCE(w.source_role_id,c.source_role_id,r.role_id)
    LEFT JOIN moderation_state ms ON ms.provider=COALESCE(w.source_provider,r.provider)
      AND ms.source_role_id=COALESCE(w.source_role_id,c.source_role_id,r.role_id)
    WHERE r.member_id=? AND r.provider='harbor') WHERE cardRank=1 ORDER BY updatedAt DESC,conversationRoleId LIMIT 25 OFFSET ?`)
    .bind(member.id, (page - 1) * 24).all<CardRow & { cardNumber: number | null; conversationProvider: string; conversationRoleId: string; conversationId: string; createdAt: number; updatedAt: number; hostRoleId: string; moderationBlocked: number | null }>();
  const lang = c.req.query('lang') || 'zh-Hant';
  return c.json({ conversations: await Promise.all(rows.results.slice(0,24).map(async row => {
    const visible = !row.public_blocked && !row.moderationBlocked && (!row.nsfw || libraryAllowsNsfw(access));
    const card = row.id && row.status === 'approved' && visible ? toCard(row, lang) : null;
    // 不在榜上的卡（只靠分享連結玩、還在審、沒登記）這裡只有卡號，名字跟卡片頁一樣去託管平台拿
    const hosted = !card && visible ? await hostedTitle(c.env, row.hostRoleId) : null;
    return { provider: row.conversationProvider, cardNumber: row.cardNumber, conversationRoleId: row.conversationRoleId, conversationId: row.conversationId,
      roleName: card?.name || (hosted ? pickLocale(hosted.names, lang) : ''), roleAvatar: card?.avatarUrl || hosted?.avatarUrl || '',
      lastChatTime: new Date(Number(row.updatedAt)).toISOString(), createTime: new Date(Number(row.createdAt)).toISOString() };
  })), hasNextPage: rows.results.length > 24 });
});

/**
 * 不在榜上的卡的名字與封面，從託管平台讀。每張卡快取十分鐘：清單每次開都要列，
 * 不必每次都問上游；作者改名晚幾分鐘出現沒關係。讀不到（刪了、上游掛了）就留空，
 * 前端顯示「未命名對話」，整張清單不跟著失敗。
 */
async function hostedTitle(env: Env, roleId: string): Promise<{ names: Localized; avatarUrl: string } | null> {
  const key = new Request(`https://library-title.internal/harbor/${encodeURIComponent(roleId)}`);
  try {
    const cache = await caches.open('library-titles');
    const hit = await cache.match(key);
    if (hit) return await hit.json();
    const role = await upstream.fetchRole(env, roleId, 'harbor');
    const title = { names: role.names, avatarUrl: role.backgroundUrl || role.avatarUrl || '' };
    await cache.put(key, new Response(JSON.stringify(title), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=600' } }));
    return title;
  } catch {
    return null;
  }
}

/** Resume the member's recorded host revision after public URLs switch to card numbers. */
libraryRoutes.get('/v1/me/conversations/:conversationId', async c => {
  const member = await requireMember(c);
  const provider = c.req.query('provider');
  if (provider !== 'harbor') throw new HttpError(400, 'invalid_provider');
  const row = await c.env.DB.prepare(`SELECT r.provider,r.role_id AS roleId,cn.num AS cardNumber
    FROM member_conversations r
    LEFT JOIN work_copies cp ON cp.provider=r.provider AND cp.role_id=r.role_id
    LEFT JOIN hosting_replicas hr ON hr.provider=r.provider AND hr.hosted_revision_id=r.role_id
    LEFT JOIN hosting_versions hv ON hv.version_id=hr.version_id
    LEFT JOIN works w ON w.id=COALESCE(hv.work_id,cp.work_id)
    LEFT JOIN cards c ON c.provider=COALESCE(w.source_provider,r.provider) AND (c.source_role_id=COALESCE(w.source_role_id,r.role_id) OR c.approved_hosted_role_id=r.role_id)
    LEFT JOIN card_numbers cn ON cn.provider=COALESCE(w.source_provider,r.provider) AND cn.source_role_id=COALESCE(w.source_role_id,c.source_role_id,r.role_id)
    WHERE r.member_id=? AND r.provider=? AND r.conversation_id=? LIMIT 1`)
    .bind(member.id,provider,c.req.param('conversationId')).first<{provider:string;roleId:string;cardNumber:number|null}>();
  if (!row) throw new HttpError(404, 'not_found');
  return c.json(row);
});
