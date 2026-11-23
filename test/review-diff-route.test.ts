import {legacyPolicyFixture} from './work-policy-fixture';
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ratingBody, bearer, identities, makeReviewer, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite } from "./helpers";
import { upstream } from "../src/upstream";

// 審卡 V2 第二批：更新差異讀的是舊版的私有設定。舊版是限制級時，未驗年齡的審核員不能讀，
// 就算這次送審改成一般分級、領得到這張單也一樣（code-review 2026-11-23）。
const AUTHOR = 10001, REVIEWER = 20001;
beforeEach(async () => {
  await resetDb(); legacyPolicyFixture();
  identities({ "author-token": AUTHOR, "rev": REVIEWER });
  rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR });
  reviewUpstream(); reviewOn();
});
afterEach(() => { restoreUpstream(); reviewOff(); vi.restoreAllMocks(); });

const submit = async (adult: boolean) => SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { "Content-Type": "application/json", ...bearer("author-token") }, body: JSON.stringify({ roleId: "role-1", ...ratingBody(adult), operationId: crypto.randomUUID() }) });
const pendingId = async () => (await env.DB.prepare("SELECT id FROM review_submissions WHERE status='pending' ORDER BY submitted_at DESC LIMIT 1").first<{ id: string }>())!.id;
const act = async (id: string, action: string, body: Record<string, unknown> = {}) => SELF.fetch(`https://c.test/v1/review/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer("rev") }, body: JSON.stringify(body) });

it("舊版是限制級：未驗年齡的審核員讀不到差異；驗過年齡就讀得到", async () => {
  const reviewerId = await makeReviewer(REVIEWER);
  await env.DB.prepare("UPDATE members SET age_verified_at=? WHERE id=?").bind(Date.now(), reviewerId).run();
  expect((await submit(true)).status).toBe(201);
  const first = await pendingId();
  const g = ((await (await act(first, "claim")).json()) as { generation: string }).generation;
  expect((await act(first, "stamp", { verdict: "approve", generation: g })).status).toBe(200);
  // 更新改成一般分級
  expect([200, 201]).toContain((await submit(false)).status);
  const update = await pendingId();
  expect(update).not.toBe(first);
  await env.DB.prepare("UPDATE members SET age_verified_at=NULL WHERE id=?").bind(reviewerId).run();
  expect((await act(update, "claim")).status).toBe(200);
  vi.spyOn(upstream, "readSealedForReview");
  const denied = await SELF.fetch(`https://c.test/v1/review/${update}/diff`, { headers: bearer("rev") });
  expect(denied.status).toBe(403);
  expect(((await denied.json()) as { error: string }).error).toBe("age_verification_required");
  expect(upstream.readSealedForReview).not.toHaveBeenCalled();
  await env.DB.prepare("UPDATE members SET age_verified_at=? WHERE id=?").bind(Date.now(), reviewerId).run();
  const ok = await SELF.fetch(`https://c.test/v1/review/${update}/diff`, { headers: bearer("rev") });
  expect(ok.status).toBe(200);
});
