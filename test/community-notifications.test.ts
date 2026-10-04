import { approveFixtureResponse } from './hosted-fixture';
import { SELF, env, createExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import app from '../src/index';
import { sign } from '../src/community/crypto';
import { bearer, identities, makeMember, resetDb, restoreUpstream, rolesOnMainSite } from './helpers';
import { setPreferences } from '../src/community/service';
import type { Env } from '../src/types';

// 通知要說得出「誰」「哪張卡」，而且沒有明確關閉就要送（migration 0047）。
const AUTHOR = 10001, FAN = 20001, OTHER = 20002;
const settings = () => ({ ...env, COMMUNITY_ENABLED: 'true', COMMUNITY_SITE_URL: 'https://sukisuki.ai', COMMUNITY_GUILD_ID: '123456789012345678', COMMUNITY_BRIDGE_KEY: 'a'.repeat(64) }) as Env;
async function bridge(op: string, value: Record<string, unknown> = {}) {
 const path = '/internal/community/' + op, time = String(Date.now()), nonce = crypto.randomUUID(), body = JSON.stringify({ guild: settings().COMMUNITY_GUILD_ID, ...value });
 return app.fetch(new Request('https://sukisuki.ai' + path, { method: 'POST', body, headers: { 'X-Community-Time': time, 'X-Community-Nonce': nonce, 'X-Community-Signature': await sign(settings().COMMUNITY_BRIDGE_KEY!, 'POST', path, time, nonce, body) } }), settings(), createExecutionContext());
}
const json = async (r: Response) => (await r.json()) as any;
const api = (path: string, token: string, init: RequestInit = {}) => SELF.fetch('https://c.test/v1/me/community/notifications' + path, { ...init, headers: { 'Content-Type': 'application/json', ...bearer(token), ...(init.headers ?? {}) } });
let cardId = '';
let author = '', fan = '', other = '';
beforeEach(async () => {
 await resetDb();
 identities({ author: AUTHOR, fan: FAN, other: OTHER });
 rolesOnMainSite({ roleId: 'role-1', authorNumId: AUTHOR, name: '雨夜書店', nameEn: 'Rainy Bookshop', nameJa: '雨夜の本屋' });
 author = await makeMember(AUTHOR); fan = await makeMember(FAN); other = await makeMember(OTHER);
 await env.DB.prepare('UPDATE members SET display_name=? WHERE id=?').bind('小雨', fan).run();
 const res = await approveFixtureResponse(await SELF.fetch('https://c.test/v1/cards', { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer('author') }, body: JSON.stringify({ operationId: crypto.randomUUID(), roleId: 'role-1', nsfw: false }) }));
 cardId = (await json(res)).id;
});
afterEach(() => restoreUpstream());
const say = async (token: string, content: string, extra: Record<string, unknown> = {}) =>
 (await json(await SELF.fetch(`https://c.test/v1/cards/${cardId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(token) }, body: JSON.stringify({ content, ...extra }) }))).commentId as string;
const like = (token: string, id: string) => SELF.fetch(`https://c.test/v1/comments/${id}/like`, { method: 'PUT', headers: bearer(token) });
async function linkDiscord(member: string) {
 await env.DB.prepare('INSERT INTO community_subjects(discord_id) VALUES(?)').bind('323456789012345678').run();
 await env.DB.prepare("INSERT INTO discord_links(member_id,discord_id,name,state,version,created_at) VALUES(?,?,?,?,?,?)").bind(member, '323456789012345678', 'Author', 'active', 'v1', Date.now()).run();
}
const rows = (member: string, kind: string) => env.DB.prepare('SELECT * FROM community_notifications WHERE member_id=? AND kind=? ORDER BY created_at').bind(member, kind).all<Record<string, unknown>>();

it('tells the author who replied and which card, and names the card in their language', async () => {
 const root = await say('author', '歡迎留言');
 await say('fan', '回你一句', { rootId: root, parentId: root });
 const stored = (await rows(author, 'comment_reply')).results;
 expect(stored).toHaveLength(1);
 expect(stored[0]).toMatchObject({ actor_id: fan, card_id: Number(cardId), path: '/cards/' + cardId });
 // Registering the card already produced its own "approved" notice, so pick the reply by kind.
 const list = await json(await api('?lang=en', 'author'));
 expect(list.items.map((n: any) => n.kind)).toEqual(['comment_reply', 'review_result']);
 expect(list.items[0]).toMatchObject({ kind: 'comment_reply', path: '/cards/' + cardId, read_at: null, actor: { name: '小雨' }, card: { id: Number(cardId), name: 'Rainy Bookshop' }, extra: { comment: expect.any(String) } });
 expect(list.items[0].actor.handle).toMatch(/^[a-j]{8}$/);
 expect(JSON.stringify(list)).not.toContain(fan);
 expect((await json(await api('?lang=ja', 'author'))).items[0].card.name).toBe('雨夜の本屋');
});
it('sends by default, honours an explicit opt-out, and never notifies yourself', async () => {
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM community_preferences').first<{ n: number }>()).toEqual({ n: 0 });
 const root = await say('author', '頂樓');
 await say('author', '自己回自己', { rootId: root, parentId: root });
 expect((await rows(author, 'comment_reply')).results).toHaveLength(0);
 await setPreferences(env as Env, author, { notifications: false });
 await say('fan', '關掉之後', { rootId: root, parentId: root });
 expect((await rows(author, 'comment_reply')).results).toHaveLength(0);
 await setPreferences(env as Env, author, { notifications: true });
 await say('other', '再打開', { rootId: root, parentId: root });
 expect((await rows(author, 'comment_reply')).results).toHaveLength(1);
 // Turning on Discord DMs alone must not create a row that reads as "notifications off".
 await setPreferences(env as Env, fan, { discordDm: true });
 expect(await env.DB.prepare('SELECT notifications,like_notifications FROM community_preferences WHERE member_id=?').bind(fan).first()).toEqual({ notifications: 1, like_notifications: 1 });
});
it('points followers at the new card itself and records the author', async () => {
 await env.DB.prepare('INSERT INTO member_follows VALUES(?,?,?)').bind(fan, author, Date.now()).run();
 rolesOnMainSite({ roleId: 'role-2', authorNumId: AUTHOR, name: '第二張', nameEn: 'Second' });
 const res = await approveFixtureResponse(await SELF.fetch('https://c.test/v1/cards', { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer('author') }, body: JSON.stringify({ operationId: crypto.randomUUID(), roleId: 'role-2', nsfw: false }) }));
 const second = (await json(res)).id;
 const stored = (await rows(fan, 'followed_work')).results;
 expect(stored).toHaveLength(1);
 expect(stored[0]).toMatchObject({ path: '/cards/' + second, card_id: Number(second), actor_id: author, author_id: author });
 const list = await json(await api('?lang=zh-Hant', 'fan'));
 expect(list.items[0]).toMatchObject({ kind: 'followed_work', card: { id: Number(second), name: '第二張' } });
 expect(list.items[0].actor.handle).toBe((await env.DB.prepare('SELECT handle FROM members WHERE id=?').bind(author).first<{ handle: string }>())!.handle);
});
it('aggregates likes per comment per day, skips self-likes, and keeps them off Discord', async () => {
 const root = await say('author', '被讚的留言');
 await like('author', root);
 expect((await rows(author, 'comment_like')).results).toHaveLength(0);
 expect((await like('fan', root)).status).toBe(204);
 expect((await like('other', root)).status).toBe(204);
 const stored = (await rows(author, 'comment_like')).results;
 expect(stored).toHaveLength(1);
 expect(stored[0]).toMatchObject({ actor_id: other, card_id: Number(cardId), delivered: 1, read_at: null });
 expect(JSON.parse(stored[0].extra as string)).toEqual({ comment: root, count: 2 });
 await setPreferences(env as Env, author, { discordDm: true });
 await linkDiscord(author);
 const pending = await json(await bridge('pending'));
 expect(JSON.stringify(pending)).not.toContain(stored[0].id);
 expect((await bridge('notification', { id: stored[0].id })).status).toBe(404);
 const list = await json(await api('?lang=en', 'author'));
 expect(list.items[0]).toMatchObject({ kind: 'comment_like', extra: { count: 2 }, actor: { name: expect.any(String) } });
 await setPreferences(env as Env, author, { likeNotifications: false });
 const another = await say('author', '第二則');
 await like('fan', another);
 expect((await rows(author, 'comment_like')).results).toHaveLength(1);
});
it('summarises unread counts, remembers the interface language for Discord, and marks everything read', async () => {
 const root = await say('author', '頂樓');
 await say('fan', '一', { rootId: root, parentId: root });
 await say('other', '二', { rootId: root, parentId: root });
 // Two replies plus the "approved" notice from registering the card.
 expect(await json(await api('/summary?lang=ja', 'author'))).toEqual({ unread: 3 });
 expect(await env.DB.prepare('SELECT locale FROM members WHERE id=?').bind(author).first()).toEqual({ locale: 'ja' });
 await api('/summary?lang=xx', 'author');
 expect(await env.DB.prepare('SELECT locale FROM members WHERE id=?').bind(author).first()).toEqual({ locale: 'ja' });
 await setPreferences(env as Env, author, { discordDm: true });
 await linkDiscord(author);
 const id = (await rows(author, 'comment_reply')).results[0].id;
 const delivered = await json(await bridge('notification', { id }));
 expect(delivered).toEqual({ kind: 'comment_reply', path: '/cards/' + cardId, discord_id: '323456789012345678', locale: 'ja' });
 expect((await api('/read-all', 'author', { method: 'POST' })).status).toBe(200);
 expect(await json(await api('/summary', 'author'))).toEqual({ unread: 0 });
 expect((await json(await api('', 'author'))).items.every((n: any) => n.read_at)).toBe(true);
});
it('carries the card and the verdict on review results', async () => {
 const { reviewOn, reviewOff, reviewUpstream, makeReviewer } = await import('./helpers');
 identities({ author: AUTHOR, reviewer: 30001 });
 await makeReviewer(30001);
 rolesOnMainSite({ roleId: 'reviewed', authorNumId: AUTHOR, name: '送審卡', nameEn: 'Reviewed' });
 reviewUpstream(); reviewOn();
 try {
  const submitted = await SELF.fetch('https://c.test/v1/cards', { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer('author') }, body: JSON.stringify({ operationId: crypto.randomUUID(), roleId: 'reviewed', nsfw: false }) });
  expect(submitted.status).toBe(201);
  const row = await env.DB.prepare("SELECT s.id,s.card_id FROM review_submissions s JOIN cards c ON c.id=s.card_id WHERE c.source_role_id='reviewed'").first<{ id: string; card_id: number }>();
  await env.DB.prepare("UPDATE review_submissions SET status='rejected',decided_at=? WHERE id=?").bind(Date.now(), row!.id).run();
  // The first card's approval left its own notice; this one belongs to the rejected card.
  const stored = (await rows(author, 'review_result')).results.filter(r => r.card_id === row!.card_id);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ path: '/mine', card_id: row!.card_id });
  const list = await json(await api('?lang=en', 'author'));
  expect(list.items.find((n: any) => n.card?.id === row!.card_id)).toMatchObject({ kind: 'review_result', path: '/mine', card: { id: row!.card_id, name: 'Reviewed' }, extra: { status: 'rejected' }, actor: null });
  expect(list.items.find((n: any) => n.card?.id === Number(cardId))).toMatchObject({ kind: 'review_result', extra: { status: 'approved' } });
 } finally { reviewOff(); }
});
