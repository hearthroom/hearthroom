import { SELF, env } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  resetDb,
  identitiesFor,
  rolesOnProviders,
  restoreUpstream,
  role,
} from "./helpers";
import { upsertCard } from "../src/cards";
import { transfers } from "../src/card-sync";
import { resolveMember } from '../src/members';
import { upstream } from '../src/upstream';

beforeEach(async () => {
  await resetDb();
  identitiesFor({
    lunatalk: { source: 11 },
    harbor: { target: 22, other: 33 },
  });
  rolesOnProviders({
    lunatalk: [{ roleId: "source", authorNumId: 11 }],
    harbor: [{ roleId: "copy", authorNumId: 22 }],
  });
  await upsertCard(
    env.DB,
    role({ roleId: "source", authorNumId: 11 }),
    Date.now(),
    { status: "approved" }
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  restoreUpstream();
});
const request = (path: string, body: unknown) =>
  SELF.fetch(`https://c.test${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer source",
      "X-Provider": "lunatalk",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
const connect = () =>
  request("/v1/me/connections", { provider: "harbor", token: "target" });
const input = {
  sourceProvider: "lunatalk",
  sourceRoleId: "source",
  sourceToken: "source",
  targetProvider: "harbor",
  targetToken: "target",
};
it("requires a verified connection before accessing card content", async () => {
  const read = vi.spyOn(transfers, "read");
  expect((await request("/v1/me/card-sync", input)).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
  await connect();
  expect(
    (await request("/v1/me/card-sync", { ...input, targetToken: "other" }))
      .status
  ).toBe(403);
  expect(read).not.toHaveBeenCalled();
});
it("does not infer missing issuers and rejects malformed payloads", async () => {
  expect(
    (await request("/v1/me/card-sync", { ...input, targetProvider: "" })).status
  ).toBe(400);
  expect((await request("/v1/me/card-sync", null)).status).toBe(400);
  expect((await request("/v1/me/card-sync", {...input,recreateMissing:"yes"})).status).toBe(400);
  expect((await request("/v1/me/connections", null)).status).toBe(400);
});
it("lists each available copy once and separates storage from play capability", async () => {
  await env.DB.prepare(
    "INSERT INTO works VALUES ('work','member','lunatalk','source',1)"
  ).run();
  await env.DB.prepare(
    "INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES ('work','harbor',22,'copy','synced',1)"
  ).run();
  const result = (await (
    await SELF.fetch("https://c.test/v1/cards/source/platforms")
  ).json()) as any;
  expect(result.platforms).toEqual([
    { provider: "lunatalk", roleId: "source", playable: true },
    { provider: "harbor", roleId: "copy", playable: true },
  ]);
});
it("never advertises failed copies or adult cards to unauthenticated readers", async () => {
  await env.DB.prepare(
    "INSERT INTO works VALUES ('work','member','lunatalk','source',1)"
  ).run();
  await env.DB.prepare(
    "INSERT INTO work_copies(work_id,provider,external_id,role_id,status,updated_at) VALUES ('work','harbor',22,'copy','failed',1)"
  ).run();
  expect(
    (
      (await (
        await SELF.fetch("https://c.test/v1/cards/source/platforms")
      ).json()) as any
    ).platforms
  ).toHaveLength(1);
  await env.DB.prepare(
    "UPDATE cards SET nsfw=1 WHERE source_role_id='source'"
  ).run();
  expect(
    (await SELF.fetch("https://c.test/v1/cards/source/platforms")).status
  ).toBe(403);
});

it('uses the same community adult setting through either linked login, independently of the play service', async () => {
  expect((await connect()).status).toBe(200);
  const member = await resolveMember(env.DB, 'lunatalk', 11, Date.now());
  await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=1 WHERE id=?').bind(member).run();
  await env.DB.prepare("UPDATE cards SET nsfw=1 WHERE source_role_id='source'").run();
  const card = await env.DB.prepare("SELECT id FROM cards WHERE source_role_id='source'").first<{id:string}>();
  const fetchMe = vi.spyOn(upstream, 'fetchMe');
  const read = (provider: string, token: string) => SELF.fetch(`https://c.test/v1/cards/${card!.id}/platforms?nsfw=1`, {
    headers: { 'X-Provider': provider, Authorization: `Bearer ${token}` },
  });
  for (const [provider, token] of [['harbor', 'target'], ['lunatalk', 'source']]) {
    fetchMe.mockClear();
    const response = await read(provider, token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({platforms:[{provider:'lunatalk',roleId:'source',playable:true}]});
    expect(fetchMe).toHaveBeenCalledTimes(1);
    expect(fetchMe.mock.calls[0].slice(1)).toEqual([token, provider]);
  }
  await env.DB.prepare('UPDATE members SET show_nsfw=0 WHERE id=?').bind(member).run();
  expect((await read('harbor', 'target')).status).toBe(403);
  await env.DB.prepare('UPDATE members SET show_nsfw=1,age_verified_at=NULL WHERE id=?').bind(member).run();
  expect((await read('harbor', 'target')).status).toBe(403);
});

it('attempts version distribution even when mutable draft synchronization fails',async()=>{
 await connect();
 const hosted=await import('../src/hosting-distribution');
 const sync=await import('../src/card-sync');
 vi.spyOn(sync,'syncCard').mockRejectedValue(new Error('draft changed'));
 const distribute=vi.spyOn(hosted,'distributeWorkVersions').mockResolvedValue();
 const configured=env as typeof env & {HOSTING_SERVICE_KEY?:string};
 const prior=configured.HOSTING_SERVICE_KEY;configured.HOSTING_SERVICE_KEY='test';
 try {await request('/v1/me/card-sync',input);expect(distribute).toHaveBeenCalledTimes(1)}
 finally {configured.HOSTING_SERVICE_KEY=prior}
});
