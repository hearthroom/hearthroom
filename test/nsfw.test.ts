/**
 * 成人內容（owner 2026-09-08）：本站自己的分級，不讀供應商的。
 *
 *   - 作者提交時必須宣告；在榜的卡改了宣告視同內容變了，要重審。
 *   - 預設全站不展示：榜單、標籤、作者榜、單一作者頁、卡片頁、分享預覽都當它不存在。
 *   - 成員驗過年齡並開了開關才看得到；開了的回應不進邊緣快取、也不從快取拿。
 *   - 審核人要驗過年齡才能領成人內容的單。
 */
import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { boardCache } from "../src/index";
import { bearer, envWithAssets, identities, makeMember, makeReviewer, resetDb, restoreUpstream, reviewUpstream, rolesOnMainSite, testHandle, upstreamHashes } from "./helpers";

const AUTHOR = 10001;
const VIEWER = 40004;
const REVIEWER = 20001;

beforeEach(async () => {
  await resetDb();
  upstreamHashes.clear();
  boardCache.namespace = `board-${Math.random()}`;
  identities({ "author-token": AUTHOR, "viewer-token": VIEWER, "rev-token": REVIEWER });
  rolesOnMainSite(
    { roleId: "role-safe", authorNumId: AUTHOR, name: "白天的卡" },
    { roleId: "role-adult", authorNumId: AUTHOR, name: "深夜的卡" },
  );
});
afterEach(restoreUpstream);

const submit = (roleId: string, body: Record<string, unknown>, token = "author-token") =>
  SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify({ roleId, ...body }) });
const settings = (body: Record<string, unknown>, token = "viewer-token") =>
  SELF.fetch("https://c.test/v1/me/settings", { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;
const ids = (b: { items: { roleId: string }[] }) => b.items.map((i) => i.roleId).sort();

/** 沒配審核機器人：登記即上榜，最快把兩張卡放上去 */
async function listTwo() {
  expect((await submit("role-safe", { nsfw: false })).status).toBe(201);
  expect((await submit("role-adult", { nsfw: true })).status).toBe(201);
}
const adultBirthdate = () => { const d = new Date(); return `${d.getUTCFullYear() - 20}-01-01`; };
const minorBirthdate = () => { const d = new Date(); return `${d.getUTCFullYear() - 15}-01-01`; };

describe("提交時的宣告", () => {
  it("沒宣告不收", async () => {
    const res = await submit("role-safe", {});
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("nsfw_required");
  });

  it("宣告寫進卡片；沒開開關的人看榜、看標籤、看作者頁、看單卡、看分享預覽都當它不存在", async () => {
    await listTwo();
    expect(ids(await json(await SELF.fetch("https://c.test/v1/cards?zone=all&a=1")))).toEqual(["role-safe"]);
    const adult = await env.DB.prepare("SELECT id, nsfw FROM cards WHERE source_role_id = 'role-adult'").first<{ id: string; nsfw: number }>();
    expect(adult?.nsfw).toBe(1);
    // 沒登入／沒開：403 adult_content，內容一個欄位都不給（前端據此畫登入或驗年齡的門）
    const anon = await SELF.fetch(`https://c.test/v1/cards/${adult!.id}`);
    expect(anon.status).toBe(403);
    const anonBody = await json(anon);
    expect(anonBody.error).toBe("adult_content");
    expect(anonBody.name).toBeUndefined();
    expect((await SELF.fetch(`https://c.test/v1/cards/${adult!.id}?nsfw=1`, { headers: bearer("viewer-token") })).status).toBe(403);
    // 作者頁只算一般內容
    const me = await json(await SELF.fetch("https://c.test/v1/me", { headers: bearer() }));
    expect((await json(await SELF.fetch(`https://c.test/v1/authors/${me.handle}`))).cardCount).toBe(1);
    // 分享預覽：抓取器沒有身分，成人內容回沒有卡片資訊的殼（200，前端畫門），不洩漏標題
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`https://c.test/cards/${adult!.id}`), envWithAssets(), ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("深夜的卡");
  });
});

describe("成人內容開關與年齡驗證", () => {
  it("沒生日開不了；未滿 18 回 403 且什麼都不存；滿 18 才開，之後關掉再開不用再填", async () => {
    await makeMember(VIEWER);
    let res = await settings({ showNsfw: true });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("birthdate_required");

    res = await settings({ showNsfw: true, birthdate: minorBirthdate() });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("underage");
    const row = await env.DB.prepare("SELECT show_nsfw, age_verified_at FROM members WHERE id = ?").bind(`member-${VIEWER}`).first<any>();
    expect(row).toMatchObject({ show_nsfw: 0, age_verified_at: null });

    expect((await settings({ showNsfw: true, birthdate: "not-a-date" })).status).toBe(400);

    res = await settings({ showNsfw: true, birthdate: adultBirthdate() });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ showNsfw: true, ageVerified: true });
    // 生日不落庫：成員表只有驗證時間
    const cols = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(`member-${VIEWER}`).first<Record<string, unknown>>();
    expect(Object.keys(cols!)).not.toContain("birthdate");
    expect(cols!.age_verified_at).toBeGreaterThan(0);

    expect(await json(await settings({ showNsfw: false }))).toEqual({ showNsfw: false, ageVerified: true });
    expect(await json(await settings({ showNsfw: true }))).toEqual({ showNsfw: true, ageVerified: true });
    const me = await json(await SELF.fetch("https://c.test/v1/me", { headers: bearer("viewer-token") }));
    expect(me).toMatchObject({ showNsfw: true, ageVerified: true });
  });

  it("開了的人看得到：榜單、單卡、作者頁都帶成人內容，而且回應不進快取", async () => {
    await listTwo();
    await makeMember(VIEWER);
    await settings({ showNsfw: true, birthdate: adultBirthdate() });
    const list = await SELF.fetch("https://c.test/v1/cards?zone=all&nsfw=1&b=1", { headers: bearer("viewer-token") });
    expect(list.headers.get("Cache-Control")).toBe("private, no-store");
    expect(list.headers.get("X-Cache")).toBe("bypass");
    const body = await json(list);
    expect(ids(body)).toEqual(["role-adult", "role-safe"]);
    expect(body.items.find((i: any) => i.roleId === "role-adult").nsfw).toBe(true);

    const adult = await env.DB.prepare("SELECT id FROM cards WHERE source_role_id = 'role-adult'").first<{ id: string }>();
    const detail = await SELF.fetch(`https://c.test/v1/cards/${adult!.id}?nsfw=1`, { headers: bearer("viewer-token") });
    expect(detail.status).toBe(200);
    expect(detail.headers.get("Cache-Control")).toBe("private, no-store");

    const me = await json(await SELF.fetch("https://c.test/v1/me", { headers: bearer() }));
    expect((await json(await SELF.fetch(`https://c.test/v1/authors/${me.handle}?nsfw=1`, { headers: bearer("viewer-token") }))).cardCount).toBe(2);
    // 標籤列與作者榜永遠只算一般內容（它們走公開快取）
    const authors = await json(await SELF.fetch("https://c.test/v1/authors?zone=all&c=1"));
    expect(authors.items[0].cardCount).toBe(1);
  });

  it("?nsfw=1 但 token 不對：當沒開，回一般內容；之後匿名同一個網址拿到的也是一般內容、不是別人的快取", async () => {
    await listTwo();
    const bad = await SELF.fetch("https://c.test/v1/cards?zone=all&nsfw=1&d=1", { headers: bearer("nobody-token") });
    expect(bad.status).toBe(200);
    expect(ids(await json(bad))).toEqual(["role-safe"]);
    const anon = await SELF.fetch("https://c.test/v1/cards?zone=all&nsfw=1&d=1");
    expect(ids(await json(anon))).toEqual(["role-safe"]);
    // 開了的人打同一個網址：拿到成人內容而不是剛剛進快取的那份
    await makeMember(VIEWER);
    await settings({ showNsfw: true, birthdate: adultBirthdate() });
    const ok = await SELF.fetch("https://c.test/v1/cards?zone=all&nsfw=1&d=1", { headers: bearer("viewer-token") });
    expect(ids(await json(ok))).toEqual(["role-adult", "role-safe"]);
  });
});

describe("審核", () => {
  beforeEach(() => {
    reviewUpstream();
    (env as { REVIEW_BOT_KEY?: string }).REVIEW_BOT_KEY = "lsk_test";
  });
  afterEach(() => { delete (env as { REVIEW_BOT_KEY?: string }).REVIEW_BOT_KEY; });

  it("佇列與詳情帶著作者的宣告；沒驗年齡的審核人領不了成人內容的單", async () => {
    await makeReviewer(REVIEWER);
    expect((await submit("role-adult", { nsfw: true })).status).toBe(201);
    const q = await json(await SELF.fetch("https://c.test/v1/review/queue", { headers: bearer("rev-token") }));
    expect(q.items[0].nsfw).toBe(true);
    const claim = await SELF.fetch(`https://c.test/v1/review/${q.items[0].id}/claim`, { method: "POST", headers: bearer("rev-token") });
    expect(claim.status).toBe(403);
    expect((await json(claim)).error).toBe("age_verification_required");
    // 驗過年齡（不必開展示開關）就能領
    await settings({ showNsfw: true, birthdate: adultBirthdate() }, "rev-token");
    await settings({ showNsfw: false }, "rev-token");
    expect((await SELF.fetch(`https://c.test/v1/review/${q.items[0].id}/claim`, { method: "POST", headers: bearer("rev-token") })).status).toBe(200);
    const detail = await json(await SELF.fetch(`https://c.test/v1/review/${q.items[0].id}/detail`, { headers: bearer("rev-token") }));
    expect(detail.submission.nsfw).toBe(true);
  });

  it("在榜的卡改了宣告：視同內容變了，離榜重審；排隊中的單改宣告只更新單子", async () => {
    await makeReviewer(REVIEWER);
    await makeMember(20002);
    await submit("role-safe", { nsfw: false });
    // 排隊中改宣告：同一張單，宣告跟著最新的
    await submit("role-safe", { nsfw: true });
    let subs = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(nsfw) AS nsfw FROM review_submissions").first<any>();
    expect(subs).toMatchObject({ n: 1, nsfw: 1 });
    // 直接把它標成過審（兩章的流程另有測試），再改回一般內容
    await env.DB.batch([
      env.DB.prepare("UPDATE review_submissions SET status = 'approved', decided_at = 1"),
      env.DB.prepare("UPDATE cards SET status = 'approved', reviewed_hash = 'sha256:role-safe-v1', nsfw = 1"),
    ]);
    const res = await submit("role-safe", { nsfw: false });
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe("needs_review");
    subs = await env.DB.prepare("SELECT COUNT(*) AS n FROM review_submissions WHERE status = 'pending' AND kind = 're' AND nsfw = 0").first<any>();
    expect(subs.n).toBe(1);
    const card = await env.DB.prepare("SELECT status, nsfw FROM cards WHERE source_role_id = 'role-safe'").first<any>();
    expect(card).toEqual({ status: "needs_review", nsfw: 0 });
  });
});
