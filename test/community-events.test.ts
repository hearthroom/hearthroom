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
it("notifies followers on a public release even when this deployment has no review gate, once per work revision", async () => {
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
    body: JSON.stringify({ roleId: "new-work", nsfw: false }),
  });
  expect(r.status).toBe(201);
  const notifications = () =>
    env.DB.prepare(
      "SELECT id FROM community_notifications WHERE member_id=? AND kind='followed_work'",
    )
      .bind(fan)
      .all<{ id: string }>();
  expect((await notifications()).results).toHaveLength(1);
  await env.DB.prepare(
    "UPDATE cards SET last_synced_at=last_synced_at+1 WHERE source_role_id='new-work'",
  ).run();
  expect((await notifications()).results).toHaveLength(1);
  expect((await notifications()).results[0].id).toMatch(/^[a-f0-9]{32}$/);
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
      body: JSON.stringify({ roleId: "reviewed-work", nsfw: false }),
    });
    expect(submitted.status).toBe(201);
    const row = await env.DB.prepare(
      "SELECT id FROM review_submissions WHERE source_role_id='reviewed-work'",
    ).first<{ id: string }>();
    const act = (action: string, body = {}, token = "reviewer") =>
      SELF.fetch("https://c.test/v1/review/" + row!.id + "/" + action, {
        method: "POST",
        headers: { ...bearer(token), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await act("claim")).status).toBe(200);
    expect((await act("stamp", { verdict: "approve" })).status).toBe(200);
    expect(await env.DB.prepare("SELECT badge FROM community_awards WHERE member_id=?").bind(author).first()).toBeNull();
    expect((await act("claim", {}, "secondReviewer")).status).toBe(200);
    const decision = await act("stamp", { verdict: "approve" }, "secondReviewer");
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
