import { sign } from "../src/community/crypto";
import { env, createExecutionContext } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import app from "../src/index";
import {
  makeMember,
  resetDb,
  whoAmI,
  bearer,
  restoreUpstream,
  rolesOnMainSite,
} from "./helpers";
import {
  beginLink,
  acceptIdentity,
  completeLink,
  setPreferences,
} from "../src/community/service";
import type { Env } from "../src/types";
import { afterEach } from "vitest";
const e = () =>
  ({
    ...env,
    COMMUNITY_ENABLED: "true",
    COMMUNITY_SITE_URL: "https://hearthroom.club",
    COMMUNITY_GUILD_ID: "123456789012345678",
    COMMUNITY_BRIDGE_KEY: "a".repeat(64),
    DISCORD_CLIENT_ID: "223456789012345678",
    DISCORD_CLIENT_SECRET: "test",
  }) as Env;
beforeEach(resetDb);
afterEach(restoreUpstream);
it("honors publication suspension in Discord previews and website report card context", async () => {
  const m = await makeMember(1);
  whoAmI(1);
  rolesOnMainSite({ roleId: "moderated-card", authorNumId: 1 });
  const published = await app.fetch(new Request("https://hearthroom.club/v1/cards", {
    method: "POST", headers: { ...bearer(), "Content-Type": "application/json" },
    body: JSON.stringify({ roleId: "moderated-card", nsfw: false }),
  }), e(), createExecutionContext());
  expect(published.status).toBe(201);
  const preview = async () => {
    const path = "/internal/community/card", time = String(Date.now()), nonce = crypto.randomUUID();
    const body = JSON.stringify({ guild: e().COMMUNITY_GUILD_ID, card: "100001" });
    return app.fetch(new Request("https://hearthroom.club" + path, { method: "POST", body, headers: {
      "X-Community-Time": time, "X-Community-Nonce": nonce,
      "X-Community-Signature": await sign(e().COMMUNITY_BRIDGE_KEY!, "POST", path, time, nonce, body),
    } }), e(), createExecutionContext());
  };
  expect((await preview()).status).toBe(200);
  const nonce = "x".repeat(40), start = await beginLink(e(), m, nonce);
  await completeLink(e(), m, await acceptIdentity(e(), start.state, { id: "423456789012345678", name: "QA" }), nonce);
  await setPreferences(e(), m, { caseAccess: true });
  await env.DB.prepare("UPDATE cards SET public_blocked=1 WHERE source_role_id='moderated-card'").run();
  expect((await preview()).status).toBe(404);
  const report = await app.fetch(new Request("https://hearthroom.club/v1/me/community/cases", {
    method: "POST", headers: { ...bearer(), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", requestId: crypto.randomUUID(), title: "Report", body: "Details", category: "bug", card: "100001" }),
  }), e(), createExecutionContext());
  expect(report.status).toBe(404);
});
it("requires member authentication and makes member responses private", async () => {
  whoAmI(null);
  expect(
    (
      await app.fetch(
        new Request("https://hearthroom.club/v1/me/community"),
        e(),
        createExecutionContext(),
      )
    ).status,
  ).toBe(401);
  await makeMember(1);
  whoAmI(1);
  const r = await app.fetch(
    new Request("https://hearthroom.club/v1/me/community", {
      headers: bearer(),
    }),
    e(),
    createExecutionContext(),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("Cache-Control")).toContain("no-store");
});
it("publishes only opted-in badges; never returns the Discord account or private progress", async () => {
  const m = await makeMember(1);
  const nonce = "x".repeat(40);
  const start = await beginLink(e(), m, nonce);
  await completeLink(
    e(),
    m,
    await acceptIdentity(e(), start.state, {
      id: "423456789012345678",
      name: "Secret Discord name",
    }),
    nonce,
  );
  await env.DB.prepare(
    "INSERT INTO community_awards VALUES(?,'first_work','approved-work',?)",
  )
    .bind(m, Date.now())
    .run();
  let r = await app.fetch(
    new Request("https://hearthroom.club/v1/community/members/aaaaaaab"),
    e(),
    createExecutionContext(),
  );
  expect(await r.json()).toEqual({ badges: [] });
  await setPreferences(e(), m, { publicBadges: true });
  r = await app.fetch(
    new Request("https://hearthroom.club/v1/community/members/aaaaaaab"),
    e(),
    createExecutionContext(),
  );
  expect(await r.json()).toEqual({ badges: ["first_work"] });
});
it("requires explicit linked case access before creating website case work", async () => {
  await makeMember(1);
  whoAmI(1);
  const r = await app.fetch(
    new Request("https://hearthroom.club/v1/me/community/cases", {
      method: "POST",
      headers: { ...bearer(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", requestId: crypto.randomUUID() }),
    }),
    e(),
    createExecutionContext(),
  );
  expect(r.status).toBe(403);
});
it("revokes old case leases and cached reads immediately when access is withdrawn", async () => {
  const m = await makeMember(1);
  whoAmI(1);
  const nonce = "x".repeat(40),
    start = await beginLink(e(), m, nonce);
  await completeLink(
    e(),
    m,
    await acceptIdentity(e(), start.state, {
      id: "423456789012345678",
      name: "QA",
    }),
    nonce,
  );
  await setPreferences(e(), m, { caseAccess: true });
  const request = async (path: string, method = "POST", body: unknown = {}) =>
    app.fetch(
      new Request("https://hearthroom.club" + path, {
        method,
        headers: { ...bearer(), "Content-Type": "application/json" },
        ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      }),
      e(),
      createExecutionContext(),
    );
  const created = await request("/v1/me/community/cases", "POST", {
    action: "list",
    requestId: crypto.randomUUID(),
  });
  expect(created.status).toBe(200);
  const job = (await created.json()) as { id: string };
  expect(
    (await request("/v1/me/community/cases/" + job.id, "GET")).status,
  ).toBe(200);
  const bridge = async (op: string, input: Record<string, unknown>) => {
    const path = "/internal/community/" + op,
      time = String(Date.now()),
      nonce = crypto.randomUUID(),
      body = JSON.stringify({ guild: e().COMMUNITY_GUILD_ID, ...input });
    return app.fetch(
      new Request("https://hearthroom.club" + path, {
        method: "POST",
        body,
        headers: {
          "X-Community-Time": time,
          "X-Community-Nonce": nonce,
          "X-Community-Signature": await sign(
            e().COMMUNITY_BRIDGE_KEY!,
            "POST",
            path,
            time,
            nonce,
            body,
          ),
        },
      }),
      e(),
      createExecutionContext(),
    );
  };
  const leaseResponse = await bridge("case-lease", { id: job.id });
  expect(leaseResponse.status).toBe(200);
  const lease = (await leaseResponse.json()) as { lease: string; user: string };
  expect(lease.user).toBe("423456789012345678");
  await setPreferences(e(), m, { caseAccess: false });
  expect(
    (await bridge("case-check", { id: job.id, lease: lease.lease })).status,
  ).toBe(409);
  expect(
    (await request("/v1/me/community/cases/" + job.id, "GET")).status,
  ).toBe(403);
});
