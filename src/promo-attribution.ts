import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import links from '../config/promo-links.json';
import { emit } from './analytics';
import { requireMember } from './members';
import { bumpOp } from './ops-metrics';
import { HttpError, type Env } from './types';

const CAMPAIGN = /^[a-z0-9][a-z0-9-]{0,63}$/;
// Register campaigns in the existing operational link table, including direct links.
// A finite allowlist keeps arbitrary query strings and personal data out of AE.
const campaigns = new Set(Object.values(links).flatMap(target => {
  try {
    const values = new URL(target, 'https://sukisuki.ai').searchParams.getAll('utm_campaign');
    return values.length === 1 && CAMPAIGN.test(values[0]!) ? values : [];
  } catch { return []; }
}));

export function promoCampaign(url: URL): string {
  const values = url.searchParams.getAll('utm_campaign');
  const value = values[0] ?? '';
  return values.length === 1 && CAMPAIGN.test(value) && campaigns.has(value) ? value : '';
}

// ---- 逐篇歸因（任務 2026-11-25-post-attribution）---------------------------------
// 貼文代號就是上面登記的 utm_campaign。瀏覽器在沒登入時記下最後一次點的代號與點擊時間，
// 登入後送一次；只有點了之後才建立的新帳號會寫一列（比照推薦碼與活動分享碼的時鐘誤差與 30 天）。
// 每人一列、寫了不改。首聊時間由開聊那一批寫入補上（library.ts）。回應只有結論，不含成員 id。

export const isPromoCampaign = (value: unknown): value is string => typeof value === 'string' && CAMPAIGN.test(value) && campaigns.has(value);

const DAY = 86_400_000;
const CLOCK_SLACK = 10 * 60_000;
const WINDOW = 30 * DAY;

export type PromoBindResult = { bound: true } | { bound: false; reason: 'unknown' | 'existing' | 'not_new' | 'excluded' };

export async function bindPromoAttribution(db: D1Database, member: { id: string; accountClass?: string }, body: Record<string, unknown>, now: number): Promise<PromoBindResult> {
  const { campaign, firstSeenAt } = body;
  if (typeof campaign !== 'string' || !CAMPAIGN.test(campaign)) throw new HttpError(400, 'invalid_arguments');
  if (typeof firstSeenAt !== 'number' || !Number.isSafeInteger(firstSeenAt) || firstSeenAt > now + CLOCK_SLACK || firstSeenAt < now - WINDOW) {
    throw new HttpError(400, 'invalid_arguments');
  }
  if (!campaigns.has(campaign)) return { bound: false, reason: 'unknown' };
  // 測試帳號不產生推廣成效
  if (member.accountClass === 'test') return { bound: false, reason: 'excluded' };
  const row = await db.prepare('SELECT m.created_at AS registered_at, EXISTS (SELECT 1 FROM promo_attributions WHERE member_id = m.id) AS existing FROM members m WHERE m.id = ?')
    .bind(member.id).first<{ registered_at: number; existing: number }>();
  if (!row) return { bound: false, reason: 'unknown' };
  if (row.existing) return { bound: false, reason: 'existing' };
  if (row.registered_at < firstSeenAt - CLOCK_SLACK) return { bound: false, reason: 'not_new' };
  // 主鍵是成員：並發的兩次只有一次寫得進去
  const res = await db.prepare('INSERT OR IGNORE INTO promo_attributions (member_id, campaign, first_seen_at, registered_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(member.id, campaign, firstSeenAt, row.registered_at, now).run();
  return res.meta.changes ? { bound: true } : { bound: false, reason: 'existing' };
}

export const promoRoutes = new Hono<{ Bindings: Env }>();

promoRoutes.post('/v1/me/promo-attribution', bodyLimit({ maxSize: 512, onError: (c) => c.json({ error: 'invalid_arguments' }, 400) }), async (c) => {
  const member = await requireMember(c);
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_arguments');
  const now = Date.now();
  const result = await bindPromoAttribution(c.env.DB, member, body, now);
  await bumpOp(c.env.DB, 'promo_attribution', 'bind', result.bound ? 'bound' : result.reason);
  if (result.bound) emit(c.env, c.executionCtx, { event: 'promo_signup', subject: body.campaign as string, outcome: 'ok', client: 'server' });
  return c.json(result, 200, { 'Cache-Control': 'private, no-store' });
});
