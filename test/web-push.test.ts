import { approveFixtureResponse } from './hosted-fixture';
import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { bearer, identities, makeMember, resetDb, restoreUpstream, rolesOnMainSite } from './helpers';
import { dispatchPush, pushLine, saveSubscription, type PushSender } from '../src/community/push';
import type { Env } from '../src/types';

// 瀏覽器推播：訂閱綁在會員上，派送只推還沒推過的通知，壞掉的訂閱自己清掉。
const AUTHOR = 10001, FAN = 20001;
const PUB = 'BPtnWqq9-GEcvvu8iLFiek-R2e0irBqzECbuvs8OeAYhRAk832IDbJh2f10ssltIXg5-Bb26zvc4R6JwK_Si0ro';
const sub = (n = 1) => ({ endpoint: `https://push.example/endpoint-${n}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
const json = async (r: Response) => (await r.json()) as any;
const api = (method: string, token: string, body?: unknown, query = '') => SELF.fetch('https://c.test/v1/me/push/subscription' + query, { method, headers: { 'Content-Type': 'application/json', ...bearer(token) }, body: body === undefined ? undefined : JSON.stringify(body) });
let cardId = '', author = '', fan = '';
const configured = () => ({ ...env, PUSH_VAPID_PUBLIC_KEY: PUB, PUSH_VAPID_PRIVATE_KEY: 'x'.repeat(43), PUSH_VAPID_SUBJECT: 'mailto:test@example.com' }) as Env;
beforeEach(async () => {
 await resetDb();
 identities({ author: AUTHOR, fan: FAN });
 rolesOnMainSite({ roleId: 'role-1', authorNumId: AUTHOR, name: '雨夜書店', nameEn: 'Rainy Bookshop' });
 author = await makeMember(AUTHOR); fan = await makeMember(FAN);
 await env.DB.prepare('UPDATE members SET display_name=? WHERE id=?').bind('小雨', fan).run();
 const res = await approveFixtureResponse(await SELF.fetch('https://c.test/v1/cards', { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer('author') }, body: JSON.stringify({ operationId: crypto.randomUUID(), roleId: 'role-1', nsfw: false }) }));
 cardId = (await json(res)).id;
});
afterEach(() => restoreUpstream());
const say = async (token: string, content: string, extra: Record<string, unknown> = {}) =>
 (await json(await SELF.fetch(`https://c.test/v1/cards/${cardId}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(token) }, body: JSON.stringify({ content, ...extra }) }))).commentId as string;

it('exposes the public key only when fully configured, and refuses subscriptions otherwise', async () => {
 expect(await json(await SELF.fetch('https://c.test/v1/push/config'))).toEqual({ enabled: false, publicKey: null });
 expect((await api('PUT', 'author', sub())).status).toBe(503);
 (env as unknown as Record<string, string>).PUSH_VAPID_PUBLIC_KEY = PUB; (env as unknown as Record<string, string>).PUSH_VAPID_PRIVATE_KEY = 'x'.repeat(43); (env as unknown as Record<string, string>).PUSH_VAPID_SUBJECT = 'mailto:test@example.com';
 try {
  expect(await json(await SELF.fetch('https://c.test/v1/push/config'))).toEqual({ enabled: true, publicKey: PUB });
  expect((await api('PUT', 'author', sub())).status).toBe(200);
  expect((await api('PUT', 'author', { endpoint: 'http://insecure.example/x', keys: sub().keys })).status).toBe(400);
  expect(await json(await api('GET', 'author', undefined, '?endpoint=' + encodeURIComponent(sub().endpoint)))).toEqual({ subscribed: true });
  expect(await json(await api('GET', 'fan', undefined, '?endpoint=' + encodeURIComponent(sub().endpoint)))).toEqual({ subscribed: false });
  // The same browser signing in as someone else takes the endpoint with it.
  expect((await api('PUT', 'fan', sub())).status).toBe(200);
  expect(await env.DB.prepare('SELECT member_id FROM push_subscriptions WHERE endpoint=?').bind(sub().endpoint).first()).toEqual({ member_id: fan });
  expect((await api('DELETE', 'fan', { endpoint: sub().endpoint })).status).toBe(200);
  expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first()).toEqual({ n: 0 });
 } finally { delete (env as unknown as Record<string, unknown>).PUSH_VAPID_PUBLIC_KEY; delete (env as unknown as Record<string, unknown>).PUSH_VAPID_PRIVATE_KEY; delete (env as unknown as Record<string, unknown>).PUSH_VAPID_SUBJECT; }
});
it('pushes each new notification once to every subscribed browser in its language, then settles it', async () => {
 const e = configured();
 await saveSubscription(e, author, { ...sub(1), locale: 'en' });
 await saveSubscription(e, author, { ...sub(2), locale: 'ja' });
 await saveSubscription(e, fan, { ...sub(3), locale: 'ko' });
 const root = await say('author', '頂樓');
 await say('fan', '回你', { rootId: root, parentId: root });
 const sent: { endpoint: string; body: string; path: string; tag: string }[] = [];
 const fake: PushSender = async (s, data) => { sent.push({ endpoint: s.endpoint, body: data.body, path: data.path, tag: data.tag }); return 201; };
 // The approval notice and the reply, each to the author's two browsers; nothing for the fan.
 expect(await dispatchPush(e, fake)).toBe(4);
 expect(sent.map(s => s.endpoint).sort()).toEqual([sub(1).endpoint, sub(1).endpoint, sub(2).endpoint, sub(2).endpoint]);
 const reply = sent.filter(s => s.path === '/cards/' + cardId);
 expect(reply.map(s => s.body).sort()).toEqual(['小雨 replied to your comment on “Rainy Bookshop”', '小雨 さんが『雨夜書店』へのコメントに返信しました'].sort());
 expect(sent.filter(s => s.path === '/mine').map(s => s.body).sort()).toEqual(['“Rainy Bookshop” passed review', '『雨夜書店』が審査を通過しました'].sort());
 expect(await dispatchPush(e, fake)).toBe(0);
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM community_notifications WHERE push_at IS NULL').first()).toEqual({ n: 0 });
});
it('drops gone subscriptions at once and failing ones after repeated errors, without blocking other members', async () => {
 const e = configured();
 await saveSubscription(e, author, { ...sub(1), locale: 'en' });
 await saveSubscription(e, author, { ...sub(2), locale: 'en' });
 const root = await say('author', '頂樓');
 await say('fan', '一', { rootId: root, parentId: root });
 const gone: PushSender = async s => (s.endpoint === sub(1).endpoint ? 410 : 500);
 await dispatchPush(e, gone);
 // Two notices were pending (the approval and the reply), so the surviving browser already failed twice.
 expect((await env.DB.prepare('SELECT endpoint,failures FROM push_subscriptions ORDER BY endpoint').all()).results).toEqual([{ endpoint: sub(2).endpoint, failures: 2 }]);
 for (let i = 0; i < 4; i++) { await say('fan', 'again ' + i, { rootId: root, parentId: root }); await dispatchPush(e, async () => { throw new Error('offline'); }); }
 expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first()).toEqual({ n: 0 });
});
it('words every kind in every language and falls back to a generic line', () => {
 const base = { extra: null, actor_name: '小雨', actor_handle: 'abcdefgh', card_names: JSON.stringify({ zh: '雨夜書店', en: 'Rainy Bookshop', ja: '', ko: '' }) };
 expect(pushLine({ ...base, kind: 'comment_like', extra: JSON.stringify({ count: 3 }) }, 'zh-Hant')).toBe('小雨 和另外 2 人讚了你在「雨夜書店」的留言');
 expect(pushLine({ ...base, kind: 'review_result', extra: JSON.stringify({ status: 'rejected' }) }, 'ko')).toBe('「雨夜書店」이(가) 이번 심사를 통과하지 못했습니다'.replace('「雨夜書店」', '“雨夜書店”'));
 expect(pushLine({ ...base, kind: 'followed_work' }, 'zh-Hans')).toBe('小雨 发布或更新了「雨夜書店」');
 expect(pushLine({ kind: 'registration_pack', extra: null, actor_name: null, actor_handle: null, card_names: null }, 'en')).toBe('You received extra registrations');
 expect(pushLine({ kind: 'something_else', extra: null, actor_name: null, actor_handle: null, card_names: null }, 'ja')).toBe('新しいお知らせがあります');
});
