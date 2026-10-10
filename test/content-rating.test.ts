import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateRating, RATING_QUESTIONNAIRE_VERSION, RATING_TOPICS, RATING_OTHER, LOCALES } from "../shared/content-rating";
import { bearer, identities, makeReviewer, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite } from "./helpers";

// 分級作者自評（owner 2026-10-10）：一般／成人二選一換成台灣遊戲分級五級的問卷。
// 計分只在伺服器；成人旗標＝限制級；舊的一般卡沒有級別，照樣在一般區，下次送審一定要補問卷。
const v = RATING_QUESTIONNAIRE_VERSION;
const GENERAL = { version: v, topics: {}, other: "other.none" };
const TEEN = { version: v, topics: { romance: "romance.dating", violence: "violence.bloody", language: "language.mild" }, other: "other.none" };
const ADULT = { version: v, topics: { sex: "sex.explicit", tobacco_alcohol: "tobacco_alcohol.shown" }, other: "other.none" };

describe("計分", () => {
  it("取所有答案裡最高的級別，情節名稱照級別由高到低排，戀愛交友只計分不列名", () => {
    expect(evaluateRating(GENERAL)).toEqual({ rating: "G", descriptors: [], answers: GENERAL });
    const teen = evaluateRating(TEEN);
    expect(teen.rating).toBe("PG15");
    expect(teen.descriptors).toEqual(["violence", "language"]);
    expect(evaluateRating(ADULT)).toMatchObject({ rating: "R", descriptors: ["sex", "tobacco_alcohol"] });
    expect(evaluateRating({ version: v, topics: { romance: "romance.dating" }, other: "other.none" })).toMatchObject({ rating: "PG12", descriptors: [] });
    expect(evaluateRating({ version: v, topics: {}, other: "other.under6" }).rating).toBe("P");
  });

  it("描寫使用毒品一律是限制級，不看呈現角度（第 5 條第 3 款）", () => {
    expect(evaluateRating({ version: v, topics: { drugs: "drugs.use" }, other: "other.none" }).rating).toBe("R");
  });

  it("答案存成固定順序，同一份答案不論鍵的順序都是同一串", () => {
    const a = evaluateRating({ version: v, topics: { language: "language.mild", violence: "violence.bloody", romance: "romance.dating" }, other: "other.none" });
    expect(JSON.stringify(a.answers)).toBe(JSON.stringify(evaluateRating(TEEN).answers));
  });

  it("形狀不對、選項不屬於那一類、舊版本，都不收", () => {
    for (const bad of [null, "R", {}, { version: v, topics: [], other: "other.none" }, { version: v, topics: {}, other: "other.nope" }, { version: v, topics: { sex: "violence.cruel" }, other: "other.none" }, { version: v, topics: { gambling: "x" }, other: "other.none" }]) {
      expect(() => evaluateRating(bad), JSON.stringify(bad)).toThrow("rating_answers_invalid");
    }
    expect(() => evaluateRating({ ...GENERAL, version: v - 1 })).toThrow("rating_version_outdated");
  });

  it("每個選項都有五種語言的文字", () => {
    for (const o of [...RATING_TOPICS.flatMap((t) => t.options), ...RATING_OTHER.options]) for (const l of LOCALES) expect(o.text[l], `${o.id} ${l}`).toBeTruthy();
  });
});

describe("問卷與試算 API", () => {
  beforeEach(resetDb);
  it("題目定義公開給 CLI 與 AI 讀，帶每個選項的級別", async () => {
    const res = await SELF.fetch("https://c.test/v1/rating/questionnaire?locale=ja");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ version: v, locale: "ja" });
    expect(body.topics.find((t: any) => t.id === "sex").options[2]).toEqual({ id: "sex.explicit", rating: "R", text: expect.stringContaining("全裸") });
    expect(res.headers.get("cache-control")).toContain("public");
    // 沒指定語言：照請求語言回，不進共用快取
    const byHeader = await SELF.fetch("https://c.test/v1/rating/questionnaire", { headers: { "Accept-Language": "ko" } });
    expect(byHeader.headers.get("cache-control")).toContain("private");
  });

  it("試算只算不寫，壞答案回 400 並說明原因", async () => {
    const ok = await SELF.fetch("https://c.test/v1/rating/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(TEEN) });
    expect(await ok.json()).toEqual({ rating: "PG15", descriptors: ["violence", "language"], answers: evaluateRating(TEEN).answers });
    const bad = await SELF.fetch("https://c.test/v1/rating/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...GENERAL, version: 0 }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toBe("rating_version_outdated");
  });
});

describe("送審與上架", () => {
  const AUTHOR = 10001;
  beforeEach(async () => {
    await resetDb();
    identities({ "author-token": AUTHOR, "rev-a": 20001, stranger: 30003 });
    rolesOnMainSite({ roleId: "role-1", authorNumId: AUTHOR }, { roleId: "role-2", authorNumId: AUTHOR });
    reviewUpstream();
    reviewOn();
  });
  afterEach(() => {
    restoreUpstream();
    reviewOff();
  });

  const post = (body: Record<string, unknown>) =>
    SELF.fetch("https://c.test/v1/cards", { method: "POST", headers: { "Content-Type": "application/json", ...bearer() }, body: JSON.stringify({ operationId: crypto.randomUUID(), ...body }) });
  const approve = async (roleId: string) => {
    // 限制級的單要驗過年齡的審核人才能領
    const reviewer = await makeReviewer(20001);
    await env.DB.prepare("UPDATE members SET age_verified_at = 1 WHERE id = ?").bind(reviewer).run();
    const sub = (await env.DB.prepare("SELECT id FROM review_submissions WHERE source_role_id LIKE ? AND status='pending'").bind("%").first<{ id: string }>())!;
    const claim = await SELF.fetch(`https://c.test/v1/review/${sub.id}/claim`, { method: "POST", headers: bearer("rev-a") });
    const { generation } = (await claim.json()) as { generation: string };
    const res = await SELF.fetch(`https://c.test/v1/review/${sub.id}/stamp`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer("rev-a") }, body: JSON.stringify({ verdict: "approve", note: "", generation }) });
    expect(res.status, roleId).toBe(200);
  };
  const card = (roleId: string) => env.DB.prepare("SELECT rating, rating_descriptors, status FROM cards WHERE source_role_id = ?").bind(roleId).first<{ rating: string | null; rating_descriptors: string | null; status: string }>();

  it("沒有問卷不收；只送成人勾選也不收", async () => {
    for (const body of [{ roleId: "role-1" }, { roleId: "role-1", nsfw: false }, { roleId: "role-1", nsfw: true }]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as any).error).toBe("rating_required");
    }
    const outdated = await post({ roleId: "role-1", ratingAnswers: { ...GENERAL, version: 0 } });
    expect(((await outdated.json()) as any).error).toBe("rating_version_outdated");
  });

  it("輔15 的卡過審後在一般區，卡片帶級別與情節名稱", async () => {
    expect((await post({ roleId: "role-1", ratingAnswers: TEEN })).status).toBe(201);
    const sub = await env.DB.prepare("SELECT rating, rating_descriptors, rating_answers FROM review_submissions").first<any>();
    expect(sub).toMatchObject({ rating: "PG15", rating_descriptors: '["violence","language"]' });
    expect(JSON.parse(sub.rating_answers)).toEqual(evaluateRating(TEEN).answers);
    await approve("role-1");
    expect(await card("role-1")).toMatchObject({ rating: "PG15", status: "approved" });
    const board = (await (await SELF.fetch("https://c.test/v1/cards")).json()) as { items: any[] };
    expect(board.items).toHaveLength(1);
    expect(board.items[0]).toMatchObject({ rating: "PG15", ratingDescriptors: ["violence", "language"] });
    expect(board.items[0]).not.toHaveProperty("nsfw");
  });

  it("限制級就是成人卡：一般區看不到", async () => {
    await post({ roleId: "role-1", ratingAnswers: ADULT });
    await approve("role-1");
    expect(await card("role-1")).toMatchObject({ rating: "R" });
    const board = (await (await SELF.fetch("https://c.test/v1/cards")).json()) as { items: any[] };
    expect(board.items).toHaveLength(0);
  });

  it("同一個 operation 重試時答案不同就拒絕", async () => {
    const operationId = crypto.randomUUID();
    expect((await post({ roleId: "role-1", ratingAnswers: GENERAL, operationId })).status).toBe(201);
    expect((await post({ roleId: "role-1", ratingAnswers: GENERAL, operationId })).status).toBe(200);
    expect((await post({ roleId: "role-1", ratingAnswers: TEEN, operationId })).status).toBe(409);
  });

  it("改卡時帶回上一版的答案給作者確認", async () => {
    await post({ roleId: "role-1", ratingAnswers: TEEN });
    const res = await SELF.fetch("https://c.test/v1/cards/role-1/edit", { method: "POST", headers: bearer() });
    expect(await res.json()).toEqual({ resubmit: true, ratingAnswers: evaluateRating(TEEN).answers });
  });

  it("審核頁看得到級別、情節名稱和作者的每題答案", async () => {
    await post({ roleId: "role-1", ratingAnswers: TEEN });
    await makeReviewer(20001);
    const sub = (await env.DB.prepare("SELECT id FROM review_submissions").first<{ id: string }>())!;
    await SELF.fetch(`https://c.test/v1/review/${sub.id}/claim`, { method: "POST", headers: bearer("rev-a") });
    const detail = (await (await SELF.fetch(`https://c.test/v1/review/${sub.id}/detail`, { headers: bearer("rev-a") })).json()) as any;
    expect(detail.submission).toMatchObject({ rating: "PG15", ratingDescriptors: ["violence", "language"], ratingAnswers: evaluateRating(TEEN).answers });
  });

  it("評級缺失的舊一般卡照樣在一般區，級別是空的", async () => {
    await post({ roleId: "role-1", ratingAnswers: GENERAL });
    await approve("role-1");
    await env.DB.prepare("UPDATE cards SET rating = NULL, rating_descriptors = NULL").run();
    const board = (await (await SELF.fetch("https://c.test/v1/cards")).json()) as { items: any[] };
    expect(board.items[0]).toMatchObject({ rating: null, ratingDescriptors: [] });
  });

  it("作者可以先存評測草稿，只有自己讀得到", async () => {
    const put = await SELF.fetch("https://c.test/v1/cards/role-1/rating-draft", { method: "PUT", headers: { "Content-Type": "application/json", ...bearer() }, body: JSON.stringify(TEEN) });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ rating: "PG15" });
    const mine = (await (await SELF.fetch("https://c.test/v1/cards/role-1/rating-draft", { headers: bearer() })).json()) as any;
    expect(mine).toEqual({ answers: evaluateRating(TEEN).answers, rating: "PG15", descriptors: ["violence", "language"] });
    // 草稿以「誰存的」為鍵：別人讀同一張卡只會讀到他自己的（沒有）
    const other = (await (await SELF.fetch("https://c.test/v1/cards/role-1/rating-draft", { headers: bearer("stranger") })).json()) as any;
    expect(other).toEqual({ answers: null });
    const none = (await (await SELF.fetch("https://c.test/v1/cards/role-2/rating-draft", { headers: bearer() })).json()) as any;
    expect(none).toEqual({ answers: null });
  });
});

describe("上線前的送審紀錄", () => {
  beforeEach(resetDb);
  afterEach(restoreUpstream);
  // 部署前開始、還沒封存成功的那一筆沒有問卷答案；同一個 operation 重試時要接著做，不能當成「答案不同」
  it("沒有問卷答案的舊 operation 重試時接著完成，並補上答案", async () => {
    const { submitHosted } = await import("../src/hosting");
    const { makeMember, role, GENERAL_RATING } = await import("./helpers");
    rolesOnMainSite({ roleId: "legacy-op", authorNumId: 10001 });
    reviewUpstream();
    const memberId = await makeMember(10001);
    const me = role({ roleId: "legacy-op", authorNumId: 10001 });
    const operationId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO works VALUES (?,?,?,?,?)").bind("w-legacy", memberId, "harbor", "legacy-op", 1).run();
    await env.DB.prepare("INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,created_at,state) VALUES (?,?,?,?,?,?,?,'failed')")
      .bind("v-legacy", "w-legacy", memberId, operationId, "legacy-op", "harbor", 1).run();
    const receipt = await submitHosted(env, { memberId, account: 10001, role: me, token: "author", rating: GENERAL_RATING, operationId, now: Date.now() });
    expect(receipt.versionId).toBe("v-legacy");
    const sub = await env.DB.prepare("SELECT rating FROM review_submissions").first<{ rating: string }>();
    expect(sub?.rating).toBe("G");
  });
});

// 0057：舊的成人旗標整個拿掉，成人內容只剩 rating = 'R' 一種說法
it("舊的 nsfw 欄位已經刪除", async () => {
  for (const table of ["cards", "review_submissions", "hosting_versions", "moderation_cases"]) {
    const cols = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    expect(cols.results.map((c) => c.name), table).not.toContain("nsfw");
    expect(cols.results.map((c) => c.name), table).toContain("rating");
  }
});
