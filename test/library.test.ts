import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from "cloudflare:test";
import { beforeEach, afterEach, expect, it } from "vitest";
import { resetDb, identities, identitiesFor, rolesOnMainSite, bearer, restoreUpstream } from "./helpers";
import { emptyCommunity } from '../src/connections';

let cardId = "";
let handle = "";
const request = (path: string, token = "fan", method = "GET") => SELF.fetch(`https://c.test/v1/${path}`, { method, headers: bearer(token) });
const body = async (r: Response) => await r.json() as any;
beforeEach(async () => {
  await resetDb();
  identities({ author: 10001, fan: 20001, other: 20002 });
  rolesOnMainSite({ roleId: "library-role", authorNumId: 10001 });
  const r = await approveFixtureResponse(await SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { ...bearer("author"), "Content-Type": "application/json" }, body: JSON.stringify({operationId:crypto.randomUUID(),...({ roleId: "library-role", nsfw: false })}) }));
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
  expect(await emptyCommunity(env.DB, fan!.id)).toBe(false);
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
  await env.DB.prepare("UPDATE cards SET nsfw=1 WHERE id=?").bind(cardId).run();
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
  identitiesFor({ lunatalk: {fan:20001,other:20002}, harbor: {fan:20001} });
  const put = (token: string, provider: string, roleId: string, conversationId: string) => SELF.fetch('https://c.test/v1/me/conversations', {
    method: 'PUT', headers: { ...bearer(token), 'X-Provider': provider, 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId, conversationId }),
  });
  expect((await put('', 'lunatalk', 'library-role', 'chat-1')).status).toBe(401);
  expect((await put('fan', 'lunatalk', 'library-role', 'chat-1')).status).toBe(200);
  expect((await put('fan', 'lunatalk', 'library-role', 'chat-2')).status).toBe(200);
  const me = await env.DB.prepare("SELECT member_id AS id FROM member_identities WHERE external_id='20001'").first<{id:string}>();
  await env.DB.prepare("INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES('harbor','20001',?,1)").bind(me!.id).run();
  expect((await put('fan', 'harbor', 'another-role', 'chat-3')).status).toBe(200);
  const response = await request('me/conversations');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const rows = (await body(response)).conversations;
  expect(rows).toHaveLength(2);
  expect(rows.find((r: any) => r.conversationId === 'chat-2').provider).toBe('lunatalk');
  expect(rows.find((r: any) => r.conversationId === 'chat-3').provider).toBe('harbor');
  expect(rows.find((r: any) => r.conversationId === 'chat-2').roleName).not.toBe('');
  expect(rows.map((r: any) => r.conversationId)).toEqual(expect.arrayContaining(['chat-2','chat-3']));
  expect((await body(await request('me/conversations','other'))).conversations).toEqual([]);
  expect(await emptyCommunity(env.DB, me!.id)).toBe(false);
  const viaHarbor = await SELF.fetch('https://c.test/v1/me/conversations',{headers:{...bearer('fan'),'X-Provider':'harbor'}});
  expect((await body(viaHarbor)).conversations).toHaveLength(2);
  expect((await put('fan','lunatalk','','')).status).toBe(400);
  const metrics = await (await SELF.fetch('https://c.test/metrics')).text();
  expect(metrics).toContain('operation="conversations_put",outcome="success"');
  expect(metrics).not.toContain('chat-2');
});
