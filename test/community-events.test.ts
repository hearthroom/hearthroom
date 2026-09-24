import {approveFixtureResponse} from './hosted-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  resetDb,
  identities,
  rolesOnMainSite,
  restoreUpstream,
  bearer,
  makeMember,
} from "./helpers";
import { setPreferences } from "../src/community/service";
import type { Env } from "../src/types";
beforeEach(resetDb);
afterEach(restoreUpstream);
it("notifies followers only after the sealed version is approved, once per work revision", async () => {
  const author = await makeMember(10001),
    fan = await makeMember(20001);
  identities({ author: 10001 });
  rolesOnMainSite({ roleId: "new-work", authorNumId: 10001 });
  await setPreferences(env as Env, fan, { notifications: true });
  await env.DB.prepare("INSERT INTO member_follows VALUES(?,?,?)")
    .bind(fan, author, Date.now())
    .run();
  const r = await SELF.fetch("https://c.test/v1/cards", {
    method: "POST",
    headers: { ...bearer("author"), "Content-Type": "application/json" },
    body: JSON.stringify({operationId:crypto.randomUUID(),...({ roleId: "new-work", nsfw: false })}),
  });
  expect(r.status).toBe(201);
  const notifications = () =>
    env.DB.prepare(
      "SELECT id FROM community_notifications WHERE member_id=? AND kind='followed_work'",
    )
      .bind(fan)
      .all<{ id: string }>();
  expect((await notifications()).results).toHaveLength(0);
  await approveFixtureResponse(r);
  expect((await notifications()).results).toHaveLength(1);
  await env.DB.prepare(
    "UPDATE cards SET last_synced_at=last_synced_at+1 WHERE source_role_id='new-work'",
  ).run();
  expect((await notifications()).results).toHaveLength(1);
  expect((await notifications()).results[0].id).toMatch(/^[a-f0-9]{32}$/);
  await env.DB.prepare("UPDATE cards SET public_blocked=1,reviewed_hash='blocked-revision' WHERE source_role_id='new-work'").run();
  expect((await notifications()).results).toHaveLength(1);
});
it("awards the first approved work once and creates one private review-result notification", async () => {
  const { reviewOn, reviewOff, reviewUpstream, makeReviewer } = await import(
    "./helpers"
  );
  const author = await makeMember(10001);
  await setPreferences(env as Env, author, { notifications: true });
  identities({ author: 10001, reviewer: 20001, secondReviewer: 30001 });
  await makeReviewer(20001);
  await makeReviewer(30001);
  rolesOnMainSite({ roleId: "reviewed-work", authorNumId: 10001 });
  reviewUpstream();
  reviewOn();
  try {
    const submitted = await SELF.fetch("https://c.test/v1/cards", {
      method: "POST",
      headers: { ...bearer("author"), "Content-Type": "application/json" },
      body: JSON.stringify({operationId:crypto.randomUUID(),...({ roleId: "reviewed-work", nsfw: false })}),
    });
    expect(submitted.status).toBe(201);
    const row = await env.DB.prepare(
      "SELECT s.id FROM review_submissions s JOIN cards c ON c.id=s.card_id WHERE c.source_role_id='reviewed-work'",
    ).first<{ id: string }>();
    const generations=new Map<string,string>();
    const act = async(action:string,body={},token='reviewer')=>{
      const res=await SELF.fetch('https://c.test/v1/review/'+row!.id+'/'+action,{method:'POST',headers:{...bearer(token),'Content-Type':'application/json'},body:JSON.stringify({...body,...(action==='claim'?{}:{generation:generations.get(token)})})});
      if(action==='claim'&&res.ok)generations.set(token,(await res.clone().json() as any).generation);
      return res;
    };
    expect((await act("claim")).status).toBe(200);
    expect(await env.DB.prepare("SELECT badge FROM community_awards WHERE member_id=?").bind(author).first()).toBeNull();
    const decision = await act("stamp", { verdict: "approve" });
    expect(decision.status).toBe(200);
    expect(await decision.json()).toMatchObject({ status: "approved" });
    expect(
      (
        await env.DB.prepare(
          "SELECT badge FROM community_awards WHERE member_id=?",
        )
          .bind(author)
          .all()
      ).results,
    ).toEqual([{ badge: "first_work" }]);
    // Simulate a decision from before community awards existed, then replay the backfill.
    await env.DB.prepare("DELETE FROM community_awards WHERE member_id=?").bind(author).run();
    const backfill = env.TEST_MIGRATIONS.find(m => m.name.includes("0028_community_award_backfill"));
    expect(backfill).toBeDefined();
    for (let i=0;i<2;i++) for (const query of backfill!.queries) await env.DB.prepare(query).run();
    expect(await env.DB.prepare("SELECT badge FROM community_awards WHERE member_id=?").bind(author).first()).toEqual({badge:"first_work"});
    await env.DB.prepare(
      "UPDATE review_submissions SET status='approved' WHERE id=?",
    )
      .bind(row!.id)
      .run();
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM community_awards WHERE member_id=?",
      )
        .bind(author)
        .first<{ n: number }>())!.n,
    ).toBe(1);
    expect(
      (await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM community_notifications WHERE member_id=? AND kind='review_result'",
      )
        .bind(author)
        .first<{ n: number }>())!.n,
    ).toBe(1);
  } finally {
    reviewOff();
  }
});
