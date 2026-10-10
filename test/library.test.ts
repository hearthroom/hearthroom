import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from "cloudflare:test";
import { beforeEach, afterEach, expect, it } from "vitest";
import { ratingBody, resetDb, identities, identitiesFor, rolesOnMainSite, mainSiteDown, bearer, restoreUpstream } from "./helpers";

let cardId = "";
let handle = "";
const request = (path: string, token = "fan", method = "GET") => SELF.fetch(`https://c.test/v1/${path}`, { method, headers: bearer(token) });
const body = async (r: Response) => await r.json() as any;
beforeEach(async () => {
  await resetDb();
  identities({ author: 10001, fan: 20001, other: 20002 });
  rolesOnMainSite({ roleId: "library-role", authorNumId: 10001 });
  const r = await approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { ...bearer("author"), "Content-Type": "application/json" }, body: JSON.stringify({operationId:crypto.randomUUID(),...({ roleId: "library-role", ...ratingBody(false) })}) }));
  cardId = (await body(r)).id;
  handle = (await body(await request("me", "author"))).handle;
});
afterEach(restoreUpstream);

it('can save a card hosted by another provider using its community ID', async () => {
  await env.DB.prepare("UPDATE cards SET provider='harbor' WHERE id=?").bind(cardId).run();
  expect((await request(`me/favorites/${cardId}`, 'fan', 'PUT')).status).toBe(200);
  expect((await body(await request('me/favorites'))).items.map((c: any) => c.id)).toEqual([cardId]);
});

it("saves cards durably, idempotently, and only for the authenticated member", async () => {
  expect((await request(`me/favorites/${cardId}`, "", "PUT")).status).toBe(401);
  for (let i = 0; i < 2; i++) expect((await request(`me/favorites/${cardId}`, "fan", "PUT")).status).toBe(200);
  const r = await request("me/favorites");
  expect(r.headers.get("Cache-Control")).toContain("no-store");
  expect((await body(r)).items.map((c: any) => c.id)).toEqual([cardId]);
  expect((await body(await request("me/favorites", "other"))).items).toEqual([]);
  expect((await body(await request(`me/favorites/${cardId}`))).active).toBe(true);
  expect((await body(await request(`me/favorites/${cardId}`))).count).toBe(1);
  const fan = await env.DB.prepare("SELECT member_id AS id FROM member_identities WHERE external_id='20001'").first<{id:string}>();
  await request(`me/favorites/${cardId}`, "fan", "DELETE");
  expect((await body(await request("me/favorites"))).items).toEqual([]);
});

it("follows authors and builds a private feed of their approved cards", async () => {
  expect((await request(`me/following/${handle}`, "fan", "PUT")).status).toBe(200);
  expect((await body(await request("me/following"))).items[0].handle).toBe(handle);
  expect((await body(await request("me/feed"))).items.map((c: any) => c.id)).toEqual([cardId]);
  expect((await body(await request("me/feed", "other"))).items).toEqual([]);
  await env.DB.prepare("UPDATE cards SET status='needs_review' WHERE id=?").bind(cardId).run();
  expect((await body(await request("me/feed"))).items).toEqual([]);
  await request(`me/following/${handle}`, "fan", "DELETE");
  expect((await body(await request("me/following"))).items).toEqual([]);
});

it("does not reveal adult or unavailable cards and rejects unknown targets", async () => {
  expect((await request("me/favorites/missing", "fan", "PUT")).status).toBe(404);
  expect((await request("me/following/zzzzzzzz", "fan", "PUT")).status).toBe(404);
  await request(`me/favorites/${cardId}`, "fan", "PUT");
  await env.DB.prepare("UPDATE cards SET rating='R' WHERE id=?").bind(cardId).run();
  expect((await body(await request("me/favorites"))).items).toEqual([]);
  expect((await request(`me/favorites/${cardId}`, "other", "PUT")).status).toBe(404);
  expect((await request(`me/favorites/${cardId}`, "fan", "DELETE")).status).toBe(200);
});

it("exports durable low-cardinality metrics for successful and denied operations", async () => {
  await request(`me/favorites/${cardId}`, "fan", "PUT");
  await request(`me/favorites/${cardId}`, "", "PUT");
  const metrics = await SELF.fetch('https://c.test/metrics');
  const text = await metrics.text();
  expect(text).toContain('hearthroom_library_requests_total{operation="favorites_put",outcome="success"} 1');
  expect(text).toContain('hearthroom_library_requests_total{operation="favorites_put",outcome="denied"} 1');
  expect(text).not.toContain(cardId);
  expect(text).not.toContain(handle);
});


it('owns the recent conversation index across connected issuers, with private member isolation', async () => {
  identitiesFor({ harbor: {fan:20001,other:20002} });
  const put = (token: string, provider: string, roleId: string, conversationId: string) => SELF.fetch('https://c.test/v1/me/conversations', {
    method: 'PUT', headers: { ...bearer(token), 'X-Provider': provider, 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId, conversationId }),
  });
  expect((await put('', 'harbor', 'library-role', 'chat-1')).status).toBe(401);
  expect((await put('fan', 'harbor', 'library-role', 'chat-1')).status).toBe(200);
  expect((await put('fan', 'harbor', 'library-role', 'chat-2')).status).toBe(200);
  const me = await env.DB.prepare("SELECT member_id AS id FROM member_identities WHERE external_id='20001'").first<{id:string}>();
  expect((await put('fan', 'harbor', 'another-role', 'chat-3')).status).toBe(200);
  const response = await request('me/conversations');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const rows = (await body(response)).conversations;
  expect(rows).toHaveLength(2);
  expect(rows.find((r: any) => r.conversationId === 'chat-2').provider).toBe('harbor');
  expect(rows.find((r: any) => r.conversationId === 'chat-3').provider).toBe('harbor');
  expect(rows.find((r: any) => r.conversationId === 'chat-2').cardNumber).toBeGreaterThan(100000);
  expect(rows.find((r: any) => r.conversationId === 'chat-2').roleName).not.toBe('');
  expect(rows.map((r: any) => r.conversationId)).toEqual(expect.arrayContaining(['chat-2','chat-3']));
  expect((await body(await request('me/conversations','other'))).conversations).toEqual([]);
  const viaHarbor = await SELF.fetch('https://c.test/v1/me/conversations',{headers:{...bearer('fan'),'X-Provider':'harbor'}});
  expect((await body(viaHarbor)).conversations).toHaveLength(2);
  expect((await put('fan','harbor','','')).status).toBe(400);
  const metrics = await (await SELF.fetch('https://c.test/metrics')).text();
  expect(metrics).toContain('operation="conversations_put",outcome="success"');
  expect(metrics).not.toContain('chat-2');
});

it('resumes a conversation only for its member and exact provider', async () => {
  await SELF.fetch('https://c.test/v1/me/conversations', {method:'PUT',headers:{...bearer('fan'),'Content-Type':'application/json'},body:JSON.stringify({roleId:'library-role',conversationId:'resume-fixture'})});
  const ok=await request('me/conversations/resume-fixture?provider=harbor');
  expect(ok.status).toBe(200);
  expect(await body(ok)).toMatchObject({provider:'harbor',roleId:'library-role',cardNumber:expect.any(Number)});
  expect((await request('me/conversations/resume-fixture?provider=lunatalk')).status).toBe(400);
  expect((await request('me/conversations/resume-fixture?provider=harbor','other')).status).toBe(404);
});

it('lists one row per card after the member played more than one approved version of it', async () => {
  const put = (roleId: string, conversationId: string) => SELF.fetch('https://c.test/v1/me/conversations', {
    method: 'PUT', headers: { ...bearer('fan'), 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId, conversationId }),
  });
  await put('library-role', 'old-version-chat');
  await env.DB.prepare("UPDATE cards SET approved_hosted_role_id='library-role-v2' WHERE id=?").bind(cardId).run();
  await put('library-role-v2', 'new-version-chat');
  await put('another-role', 'other-card-chat');
  await env.DB.prepare("UPDATE member_conversations SET updated_at=CASE role_id WHEN 'library-role' THEN 1000 WHEN 'library-role-v2' THEN 3000 ELSE 2000 END").run();
  const rows = (await body(await request('me/conversations'))).conversations;
  expect(rows.map((r: any) => r.conversationId)).toEqual(['new-version-chat', 'other-card-chat']);
});

it('keeps adult cards a member already played or saved after they turn adult content off; only discovery follows the switch', async () => {
  identitiesFor({ harbor: { fan: 20001 } });
  await request(`me/favorites/${cardId}`, 'fan', 'PUT');
  await request(`me/following/${handle}`, 'fan', 'PUT');
  await SELF.fetch('https://c.test/v1/me/conversations', { method: 'PUT', headers: { ...bearer('fan'), 'X-Provider': 'harbor', 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId: 'library-role', conversationId: 'adult-chat' }) });
  await env.DB.prepare("UPDATE cards SET rating='R' WHERE id=?").bind(cardId).run();
  const fan = await env.DB.prepare("SELECT member_id AS id FROM member_identities WHERE external_id='20001'").first<{ id: string }>();
  const library = async () => ({
    conversation: (await body(await request('me/conversations'))).conversations[0],
    favorites: (await body(await request('me/favorites'))).items.map((c: any) => c.id),
    favorite: await body(await request(`me/favorites/${cardId}`)),
    feed: (await body(await request('me/feed'))).items.map((c: any) => c.id),
  });

  // Opted in once (age verified, current statement agreed), then switched off.
  await env.DB.prepare('UPDATE members SET show_nsfw=0,age_verified_at=1,adult_consent_version=1 WHERE id=?').bind(fan!.id).run();
  const off = await library();
  expect(off.conversation.roleName).not.toBe('');
  expect(off.conversation.roleAvatar).not.toBe('');
  expect(off.favorites).toEqual([cardId]);
  expect(off.favorite.active).toBe(true);
  expect(off.feed).toEqual([]);

  // Never opted in: the library does not reveal adult cards.
  await env.DB.prepare('UPDATE members SET show_nsfw=0,age_verified_at=NULL,adult_consent_version=NULL WHERE id=?').bind(fan!.id).run();
  const never = await library();
  expect(never.conversation.roleName).toBe('');
  expect(never.favorites).toEqual([]);
});

it('names a conversation with a card that is not on the board from its host, like the card page does', async () => {
  identitiesFor({ harbor: { fan: 20001 } });
  rolesOnMainSite({ roleId: 'library-role', authorNumId: 10001 }, { roleId: 'unlisted-role', name: '天道非要我成仙' }, { roleId: 'withdrawn-role', name: '已下架' });
  const put = (roleId: string, conversationId: string) => SELF.fetch('https://c.test/v1/me/conversations', {
    method: 'PUT', headers: { ...bearer('fan'), 'X-Provider': 'harbor', 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId, conversationId }),
  });
  // Opening a share link gives the card a number; nothing else about it is kept here.
  await env.DB.prepare("INSERT INTO card_numbers(provider,source_role_id) VALUES('harbor','unlisted-role'),('harbor','withdrawn-role')").run();
  await env.DB.prepare("INSERT INTO moderation_state(provider,source_role_id,public_blocked) VALUES('harbor','withdrawn-role',1)").run();
  await put('unlisted-role', 'unlisted-chat');
  await put('withdrawn-role', 'withdrawn-chat');
  await put('gone-role', 'gone-chat');
  const rows = (await body(await request('me/conversations'))).conversations;
  const by = (id: string) => rows.find((r: any) => r.conversationId === id);
  expect(by('unlisted-chat')).toMatchObject({ roleName: '天道非要我成仙', roleAvatar: 'https://assets.harperharbor.com/bg.png' });
  expect(by('gone-chat').roleName).toBe('');
  expect(by('withdrawn-chat').roleName).toBe('');

  // The host being down leaves the row untitled instead of failing the whole list.
  mainSiteDown();
  const down = await request('me/conversations?pageNum=1&lang=en');
  expect(down.status).toBe(200);
  expect((await body(down)).conversations).toHaveLength(3);
});
