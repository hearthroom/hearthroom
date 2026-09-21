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
  communityView,
  ingestXP,
  unlink,
} from "../src/community/service";
import type { Env } from "../src/types";
import { afterEach, vi } from "vitest";
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
    "INSERT INTO community_awards(member_id,badge,source,created_at) VALUES(?,'first_work','approved-work',?)",
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
  expect(await r.json()).toEqual({ badges: ["discord_linked", "first_work"] });
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

it("shows an active link badge and publishes level only with separate consent", async () => {
  const m = await makeMember(1), nonce = "x".repeat(40), user = "423456789012345678";
  const start = await beginLink(e(), m, nonce);
  await completeLink(e(), m, await acceptIdentity(e(), start.state, {id:user,name:"Private name"}), nonce);
  expect((await communityView(e(), m)).badges).toEqual(["discord_linked"]);
  const pub = async () => (await app.fetch(new Request("https://hearthroom.club/v1/community/members/aaaaaaab"),e(),createExecutionContext())).json();
  expect(await pub()).toEqual({badges:[]});
  await setPreferences(e(), m, {publicBadges:true});
  expect(await pub()).toEqual({badges:["discord_linked"]});
  await setPreferences(e(), m, {publicLevel:true});
  expect(await pub()).toEqual({badges:["discord_linked"],level:0});
  const now=Date.now();
  for(let i=0;i<10;i++) await ingestXP({...e(),COMMUNITY_XP_CHANNELS:"323456789012345678"}, {id:String(523456789012345678n+BigInt(i)),user,channel:"323456789012345678",time:now-i*61000},now);
  expect(await pub()).toEqual({badges:["discord_linked"],level:1});
  await setPreferences(e(), m, {publicBadges:false});
  expect(await pub()).toEqual({badges:[],level:1});
  await setPreferences(e(), m, {publicLevel:false});
  expect(await pub()).toEqual({badges:[]});
  await setPreferences(e(), m, {publicBadges:true,publicLevel:true});
  await unlink(e(),m);
  expect(await pub()).toEqual({badges:[]});
  expect((await communityView(e(),m)).badges).toEqual([]);
});

it.each(['sukisuki.ai','sukisuki.chat'])('returns Discord linking to the initiating %s origin after validating state', async root => {
 const m=await makeMember(1); whoAmI(1);
 const started=await app.fetch(new Request(`https://${root}/v1/me/community/link`, {method:'POST',headers:{...bearer(),'Content-Type':'application/json'},body:JSON.stringify({nonce:'n'.repeat(40)})}),e(),createExecutionContext());
 expect(started.status).toBe(200);
 const {url}=await started.json() as {url:string};
 const authorize=new URL(url), state=authorize.searchParams.get('state')!;
 expect(authorize.searchParams.get('redirect_uri')).toBe('https://hearthroom.club/v1/community/discord/callback');
 const {discordOAuth}=await import('../src/community/routes');
 const identify=vi.spyOn(discordOAuth,'identify').mockResolvedValue({id:'423456789012345678',name:'QA'});
 try {
  const changed=state+'~https://evil.test';
  const denied=await app.fetch(new Request(`https://hearthroom.club/v1/community/discord/callback?state=${encodeURIComponent(changed)}&code=synthetic`),e(),createExecutionContext());
  expect(denied.headers.get('location')).toBe('https://hearthroom.club/me#discord_error=expired');
  expect(identify).not.toHaveBeenCalled();
  const callback=await app.fetch(new Request(`https://hearthroom.club/v1/community/discord/callback?state=${encodeURIComponent(state)}&code=synthetic`),e(),createExecutionContext());
  expect(callback.headers.get('location')).toMatch(new RegExp(`^https://${root.replaceAll('.', '\\.')}/me#discord_receipt=`));
 } finally {identify.mockRestore();}
});

it('returns a cancelled Discord authorization to the original official origin', async () => {
 const m=await makeMember(1), started=await beginLink(e(),m,'n'.repeat(40),'https://sukisuki.chat');
 const response=await app.fetch(new Request(`https://hearthroom.club/v1/community/discord/callback?state=${encodeURIComponent(started.state)}&error=access_denied`),e(),createExecutionContext());
 expect(response.headers.get('location')).toBe('https://sukisuki.chat/me#discord_error=oauth');
 await expect(beginLink(e(),m,'n'.repeat(40),'https://sukisuki.chat.evil.test')).rejects.toThrow('community_input');
});
