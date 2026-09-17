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
