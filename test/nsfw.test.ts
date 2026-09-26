import {approveFixtureResponse} from './hosted-fixture';
/**
 * 成人內容（owner 2026-09-08）：本站自己的分級，不讀供應商的。
 *
 *   - 作者提交時必須宣告；在榜的卡改了宣告視同內容變了，要重審。
 *   - 預設全站不展示：榜單、標籤、作者榜、單一作者頁、卡片頁、分享預覽都當它不存在。
 *   - 成員驗過年齡並開了開關才看得到；權限每次驗，內部快取按內容分級隔離。
 *   - 審核人要驗過年齡才能領成人內容的單。
 */
import { SELF, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { boardCache } from "../src/index";
import { upstream } from "../src/upstream";
import { ADULT_CONSENT_VERSION } from "../shared/adult-consent";
import { vi } from "vitest";
import { bearer, envWithAssets, identities, makeMember, makeReviewer, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite, testHandle, recordD1 } from "./helpers";

const AUTHOR = 10001;
const VIEWER = 40004;
const REVIEWER = 20001;

beforeEach(async () => {
  await resetDb();
  boardCache.namespace = `board-${Math.random()}`;
  identities({ "author-token": AUTHOR, "viewer-token": VIEWER, "rev-token": REVIEWER });
  rolesOnMainSite(
    { roleId: "role-safe", authorNumId: AUTHOR, name: "白天的卡" },
    { roleId: "role-adult", authorNumId: AUTHOR, name: "深夜的卡" },
  );
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

const submit = (roleId: string, body: Record<string, unknown>, token = "author-token") =>
  SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify({operationId:crypto.randomUUID(),...({ roleId, ...body })}) });
const settings = (body: Record<string, unknown>, token = "viewer-token") =>
  SELF.fetch("https://c.test/v1/me/settings", { method: "POST", headers: { "Content-Type": "application/json", ...bearer(token) }, body: JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;
const ids = (b: { items: { sourceRoleId: string }[] }) => b.items.map((i) => i.sourceRoleId).sort();

/** 透過正式封存與審核流程建立兩張公開測試卡。 */
async function listTwo() {
  expect((await approveFixtureResponse(await submit("role-safe", { nsfw: false }))).status).toBe(201);
  expect((await approveFixtureResponse(await submit("role-adult", { nsfw: true }))).status).toBe(201);
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

describe("榜單權限與快取", () => {
  it("成人榜單重用結果，但每次仍驗權限，關閉或失效立即只剩一般內容", async () => {
    await listTwo();
    await makeMember(VIEWER);
    await settings({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    const url = "https://c.test/v1/cards?zone=all&nsfw=1";
    const first = await SELF.fetch(url, { headers: bearer("viewer-token") });
    expect(first.headers.get("X-Cache")).toBe("miss");
    expect(ids(await json(first))).toEqual(["role-adult", "role-safe"]);
    const second = await SELF.fetch(url, { headers: bearer("viewer-token") });
    expect(second.headers.get("X-Cache")).toBe("hit");
    expect(second.headers.get("Cache-Control")).toBe("private, no-store");
    expect(second.headers.get("Server-Timing")).toContain("access;dur=");
    expect(second.headers.get("Server-Timing")).toContain("moderation;dur=");
    expect(second.headers.get("Server-Timing")).toContain("cache;dur=");
    expect(second.headers.get("Server-Timing")).not.toContain("query;dur=");
    expect(ids(await json(second))).toEqual(["role-adult", "role-safe"]);
    expect(ids(await json(await SELF.fetch(url)))).toEqual(["role-safe"]);
    expect(ids(await json(await SELF.fetch(url, { headers: bearer("invalid") })))).toEqual(["role-safe"]);
    await settings({ showNsfw: false });
    expect(ids(await json(await SELF.fetch(url, { headers: bearer("viewer-token") })))).toEqual(["role-safe"]);
  });

  it("暖成人榜單只有兩次 D1 讀取，不重新排序，也不快取上游身分", async () => {
    await listTwo();
    await makeMember(VIEWER);
    await settings({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    const req = new Request("https://c.test/v1/cards?nsfw=1", { headers: bearer("viewer-token") });
    const warm = createExecutionContext();
    await worker.fetch(req.clone(), env, warm);
    await waitOnExecutionContext(warm);
    const { queries, db } = recordD1(env.DB);
    const measured = { ...env, DB: db };
    // The proxy is a new database binding: warm its one-time schema check too.
    await worker.fetch(new Request('https://c.test/v1/providers'), measured, createExecutionContext());
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('pragma_table_info');
    queries.length = 0;
    const identity = vi.spyOn(upstream, "fetchMe");
    const ctx = createExecutionContext();
    const result = await worker.fetch(req.clone(), measured, ctx);
    await waitOnExecutionContext(ctx);
    expect(result.headers.get("X-Cache")).toBe("hit");
    expect(queries).toHaveLength(2);
    expect(queries.every(sql => sql.trim().startsWith("SELECT"))).toBe(true);
    expect(identity).toHaveBeenCalledTimes(1);
  });

  it("觀看榜單不更新會員資料", async () => {
    await listTwo();
    await makeMember(VIEWER);
    await settings({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    await env.DB.prepare("UPDATE members SET display_name=NULL WHERE id=?").bind(`member-${VIEWER}`).run();
    await env.DB.exec("CREATE TRIGGER board_no_member_write BEFORE UPDATE ON members BEGIN SELECT RAISE(ABORT, 'read only'); END;");
    try {
      const result = await SELF.fetch("https://c.test/v1/cards?nsfw=1", { headers: bearer("viewer-token") });
      expect(ids(await json(result))).toEqual(["role-adult", "role-safe"]);
    } finally { await env.DB.exec("DROP TRIGGER board_no_member_write"); }
  });
});

describe("成人內容開關與年齡驗證", () => {
  it("沒生日開不了；未滿 18 回 403 且什麼都不存；滿 18 才開，之後關掉再開不用再填", async () => {
    await makeMember(VIEWER);
    let res = await settings({ showNsfw: true, consentVersion: ADULT_CONSENT_VERSION });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("birthdate_required");

    res = await settings({ showNsfw: true, birthdate: minorBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("underage");
    const row = await env.DB.prepare("SELECT show_nsfw, age_verified_at, adult_consent_version FROM members WHERE id = ?").bind(`member-${VIEWER}`).first<any>();
    expect(row).toMatchObject({ show_nsfw: 0, age_verified_at: null, adult_consent_version: null });

    expect((await settings({ showNsfw: true, birthdate: "not-a-date", consentVersion: ADULT_CONSENT_VERSION })).status).toBe(400);

    res = await settings({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ showNsfw: true, ageVerified: true, adultConsent: true, hiddenTags: [] });
    // 生日不落庫：成員表只有驗證時間；同意記版本與時間
    const cols = await env.DB.prepare("SELECT * FROM members WHERE id = ?").bind(`member-${VIEWER}`).first<Record<string, unknown>>();
    expect(Object.keys(cols!)).not.toContain("birthdate");
    expect(cols!.age_verified_at).toBeGreaterThan(0);
    expect(cols!.adult_consent_version).toBe(ADULT_CONSENT_VERSION);
    expect(cols!.adult_consented_at).toBeGreaterThan(0);

    // 關掉再開：年齡與同意都留著，不必再帶
    expect(await json(await settings({ showNsfw: false }))).toEqual({ showNsfw: false, ageVerified: true, adultConsent: true, hiddenTags: [] });
    expect(await json(await settings({ showNsfw: true }))).toEqual({ showNsfw: true, ageVerified: true, adultConsent: true, hiddenTags: [] });
    const me = await json(await SELF.fetch("https://c.test/v1/me", { headers: bearer("viewer-token") }));
    expect(me).toMatchObject({ showNsfw: true, ageVerified: true, adultConsent: true, hiddenTags: [] });
  });

  it("沒同意聲明開不了：只帶生日回 400 consent_required，年齡也不記", async () => {
    await makeMember(VIEWER);
    let res = await settings({ showNsfw: true, birthdate: adultBirthdate() });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("consent_required");
    res = await settings({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION - 1 });
    expect((await json(res)).error).toBe("consent_required");
    const row = await env.DB.prepare("SELECT show_nsfw, age_verified_at, adult_consent_version FROM members WHERE id = ?").bind(`member-${VIEWER}`).first<any>();
    expect(row).toMatchObject({ show_nsfw: 0, age_verified_at: null, adult_consent_version: null });
  });

  it("驗過年齡但同意的是舊版聲明：視同沒開，看不到成人卡；重新同意（不必再填生日）才打開", async () => {
    await listTwo();
    await makeMember(VIEWER);
    await env.DB.prepare("UPDATE members SET show_nsfw = 1, age_verified_at = 1, adult_consent_version = NULL WHERE id = ?").bind(`member-${VIEWER}`).run();

    const me = await json(await SELF.fetch("https://c.test/v1/me", { headers: bearer("viewer-token") }));
    expect(me).toMatchObject({ showNsfw: false, ageVerified: true, adultConsent: false });
    const list = await json(await SELF.fetch("https://c.test/v1/cards?zone=all&nsfw=1", { headers: bearer("viewer-token") }));
    expect(ids(list)).toEqual(["role-safe"]);

    let res = await settings({ showNsfw: true });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("consent_required");

    res = await settings({ showNsfw: true, consentVersion: ADULT_CONSENT_VERSION });
    expect(await json(res)).toEqual({ showNsfw: true, ageVerified: true, adultConsent: true, hiddenTags: [] });
    const after = await json(await SELF.fetch("https://c.test/v1/cards?zone=all&nsfw=1&b=2", { headers: bearer("viewer-token") }));
    expect(ids(after)).toEqual(["role-adult", "role-safe"]);
  });

  it("不想看的類型：只收目錄裡的鍵、去重排序；存在成員上、/v1/me 帶回；不動成人開關；兩樣都沒給回 400", async () => {
    await makeMember(VIEWER);
    let res = await settings({ hiddenTags: ["womens-fiction", "r18g", "womens-fiction"] });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ showNsfw: false, ageVerified: false, adultConsent: false, hiddenTags: ["r18g", "womens-fiction"] });
    const me = await json(await SELF.fetch("https://c.test/v1/me", { headers: bearer("viewer-token") }));
    expect(me.hiddenTags).toEqual(["r18g", "womens-fiction"]);

    res = await settings({ hiddenTags: ["no-such-key"] });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("unknown_tag");
    expect((await settings({ hiddenTags: "r18g" })).status).toBe(400);
    expect((await settings({})).status).toBe(400);
    // 沒動成人開關；清空也行
    expect(await json(await settings({ hiddenTags: [] }))).toEqual({ showNsfw: false, ageVerified: false, adultConsent: false, hiddenTags: [] });
    // 開成人開關時隱藏名單留著
    await settings({ hiddenTags: ["r18g"] });
    expect(await json(await settings({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION }))).toEqual({ showNsfw: true, ageVerified: true, adultConsent: true, hiddenTags: ["r18g"] });
  });

  it("開了的人看得到：榜單、單卡、作者頁都帶成人內容，而且回應禁止瀏覽器共用快取", async () => {
    await listTwo();
    await makeMember(VIEWER);
    await settings({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    const list = await SELF.fetch("https://c.test/v1/cards?zone=all&nsfw=1&b=1", { headers: bearer("viewer-token") });
    expect(list.headers.get("Cache-Control")).toBe("private, no-store");
    expect(list.headers.get("X-Cache")).toBe("miss");
    const body = await json(list);
    expect(ids(body)).toEqual(["role-adult", "role-safe"]);
    expect(body.items.find((i: any) => i.sourceRoleId === "role-adult").nsfw).toBe(true);

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
    await settings({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION });
    const ok = await SELF.fetch("https://c.test/v1/cards?zone=all&nsfw=1&d=1", { headers: bearer("viewer-token") });
    expect(ids(await json(ok))).toEqual(["role-adult", "role-safe"]);
  });
});

describe("審核", () => {
  beforeEach(() => {
    reviewUpstream();
    reviewOn();
  });
  afterEach(() => { reviewOff(); });

  it("佇列與詳情帶著作者的宣告；沒驗年齡的審核人領不了成人內容的單", async () => {
    await makeReviewer(REVIEWER);
    expect((await submit("role-adult", { nsfw: true })).status).toBe(201);
    const q = await json(await SELF.fetch("https://c.test/v1/review/queue", { headers: bearer("rev-token") }));
    expect(q.items[0].nsfw).toBe(true);
    const claim = await SELF.fetch(`https://c.test/v1/review/${q.items[0].id}/claim`, { method: "POST", headers: bearer("rev-token") });
    expect(claim.status).toBe(403);
    expect((await json(claim)).error).toBe("age_verification_required");
    // 驗過年齡（不必開展示開關）就能領
    await settings({ showNsfw: true, birthdate: adultBirthdate(), consentVersion: ADULT_CONSENT_VERSION }, "rev-token");
    await settings({ showNsfw: false }, "rev-token");
    expect((await SELF.fetch(`https://c.test/v1/review/${q.items[0].id}/claim`, { method: "POST", headers: bearer("rev-token") })).status).toBe(200);
    const detail = await json(await SELF.fetch(`https://c.test/v1/review/${q.items[0].id}/detail`, { headers: bearer("rev-token") }));
    expect(detail.submission.nsfw).toBe(true);
  });

  it("內容分級跟著版本；待審版本不可改寫，已公開分級保留到新版本核准", async () => {
    const first=await submit("role-safe",{nsfw:true}); expect(first.status).toBe(201);
    expect((await submit("role-safe",{nsfw:false})).status).toBe(409);
    await approveFixtureResponse(first);
    const res=await submit("role-safe",{nsfw:false});expect(res.status).toBe(200);
    expect(await env.DB.prepare("SELECT status,nsfw FROM cards WHERE source_role_id='role-safe'").first()).toEqual({status:'approved',nsfw:1});
    expect(await env.DB.prepare("SELECT kind,nsfw FROM review_submissions WHERE status='pending'").first()).toEqual({kind:'re',nsfw:0});
    await approveFixtureResponse(res);
    expect(await env.DB.prepare("SELECT status,nsfw FROM cards WHERE source_role_id='role-safe'").first()).toEqual({status:'approved',nsfw:0});
  });
});
