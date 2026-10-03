/**
 * 原作（fandom）：作者送審時填，過審投影到卡上；榜單可篩、搜尋得到、原作清單與搜尋建議列得出。
 */
import { env, SELF, createScheduledController, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { bearer, identities, makeMember, makeReviewer, resetDb, restoreUpstream, role, rolesOnMainSite } from "./helpers";
import { beginHostedEdit, hostGateway, submitHosted } from "../src/hosting";
import { claim, pendingSubmissionOf, stamp } from "../src/review";
import { getCard } from "../src/cards";
import { upstream } from "../src/upstream";
import { resolveFandom } from "../src/fandom";
import { wikidata, type FandomEntity } from "../src/wikidata";

beforeEach(resetDb);
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

async function author(roleId: string, f: Parameters<typeof role>[0] = { roleId }) {
  const memberId = await makeMember(10001);
  const draft = role({ ...f, roleId, authorNumId: 10001 });
  vi.spyOn(hostGateway, "seal").mockImplementation(async (_env, _token, _id, workId, versionId) => ({ workId, versionId, hostedRevisionId: "sealed-" + versionId }));
  vi.spyOn(hostGateway, "read").mockImplementation(async (_env, _token, id) => ({ ...draft, roleId: id }));
  const snapshot = { document: { roleDetailDesc: "fixture" }, hashes: { card: "", welcome: "", worldbook: "", authorAsset: "", content: "" } } as never;
  vi.spyOn(upstream, "readForReview").mockResolvedValue(snapshot);
  vi.spyOn(upstream, "readSealedForReview").mockResolvedValue(snapshot);
  const submit = async (opts: { nsfw?: boolean; fandom?: string; fandomId?: string } = {}) =>
    submitHosted(env, { memberId, account: 10001, role: draft, token: "fixture", nsfw: opts.nsfw ?? false, fandom: await resolveFandom(env.DB, opts), operationId: crypto.randomUUID(), now: Date.now() });
  const pending = async () => (await pendingSubmissionOf(env.DB, (await getCard(env.DB, roleId, "harbor"))!.id))!;
  const approve = async () => {
    const s = await pending();
    for (const reviewer of s.kind === "first" ? ["a", "b"] : ["c"]) {
      await claim(env.DB, s.id, reviewer, Date.now());
      if ((await stamp(env.DB, { submissionId: s.id, memberId: reviewer, verdict: "approve", note: "", now: Date.now() })).submission.status !== "pending") break;
    }
  };
  return { memberId, draft, submit, pending, approve };
}

const list = async (query: string) => (await (await SELF.fetch(`https://c.test/v1/cards${query}`)).json()) as { items: { roleId: string; fandom?: string; name: string }[] };
const roleIds = (b: { items: { roleId: string }[] }) => b.items.map((i) => i.roleId).sort();

describe("原作欄位", () => {
  it("送審時填的原作，過審後在卡上、可篩（繁簡互通）、搜得到、原作清單列得出", async () => {
    const a = await author("fan-a", { roleId: "fan-a", name: "桐人的日常" });
    await a.submit({ fandom: "刀劍神域" });
    await a.approve();
    const b = await author("fan-b", { roleId: "fan-b", name: "另一張" });
    await b.submit({ fandom: "刀剑神域" });
    await b.approve();
    const c = await author("fan-c", { roleId: "fan-c", name: "沒原作" });
    await c.submit();
    await c.approve();

    const card = (await (await SELF.fetch("https://c.test/v1/cards/sealed-" + (await getCard(env.DB, "fan-a", "harbor"))!.approved_version_id)).json()) as { fandom?: string };
    expect(card.fandom).toBe("刀劍神域");
    expect(roleIds(await list("?fandom=刀剑神域"))).toEqual(["sealed-" + (await getCard(env.DB, "fan-a", "harbor"))!.approved_version_id, "sealed-" + (await getCard(env.DB, "fan-b", "harbor"))!.approved_version_id].sort());
    expect(roleIds(await list("?fandom=sao"))).toHaveLength(2);
    expect(roleIds(await list("?q=刀劍神域"))).toHaveLength(2);
    expect(roleIds(await list("?q=刀劍神域 桐人"))).toHaveLength(1);

    const fandoms = (await (await SELF.fetch("https://c.test/v1/fandoms?zone=zh")).json()) as { items: { fandom: string; n: number }[] };
    expect(fandoms.items).toEqual([{ key: "刀剑神域", fandom: "刀劍神域", n: 2 }]);
  });

  it("原作要合理：太長、含網址、含換行的不收；空字串＝沒有", async () => {
    const a = await author("fan-bad");
    await expect(a.submit({ fandom: "x".repeat(61) })).rejects.toThrow("fandom_invalid");
    await expect(a.submit({ fandom: "https://example.com" })).rejects.toThrow("fandom_invalid");
    await expect(a.submit({ fandom: "a\nb" })).rejects.toThrow("fandom_invalid");
    await a.submit({ fandom: "  原神   同人 " });
    await a.approve();
    expect((await getCard(env.DB, "fan-bad", "harbor"))!.fandom).toBe("原神 同人");
  });

  it("每小時同步從上游重寫名稱時不會把原作從索引裡洗掉", async () => {
    const a = await author("fan-sync", { roleId: "fan-sync", name: "舊名" });
    await a.submit({ fandom: "崩壞三" });
    await a.approve();
    const hosted = (await getCard(env.DB, "fan-sync", "harbor"))!.approved_hosted_role_id!;
    rolesOnMainSite({ roleId: hosted, name: "新名" });
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);
    expect((await list("")).items[0]!.name).toBe("新名");
    expect(roleIds(await list("?q=崩坏三"))).toEqual([hosted]);
    expect((await list("?fandom=崩壞三")).items[0]!.fandom).toBe("崩壞三");
  });

  it("審核中改卡要重送時，原作跟著上一版走", async () => {
    const a = await author("fan-edit");
    await a.submit({ fandom: "原神" });
    await a.approve();
    await a.submit({ fandom: "原神" });
    expect(await beginHostedEdit(env.DB, a.memberId, "fan-edit", Date.now())).toEqual({ resubmit: true, nsfw: false, fandom: "原神" });
  });

  it("審核人可以改原作，留稽核；過審後上的是改過的", async () => {
    const a = await author("fan-rev");
    await a.submit({ fandom: "崩铁" });
    identities({ "rev-token": 20001 });
    const reviewer = await makeReviewer(20001);
    await claim(env.DB, (await a.pending()).id, reviewer, Date.now());
    const s = await a.pending(); // 領單後 generation 會變，拿新的
    const res = await SELF.fetch(`https://c.test/v1/review/${s.id}/tags`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer("rev-token") }, body: JSON.stringify({ tags: ["同人"], fandom: "崩壞：星穹鐵道", generation: s.claim_generation }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: ["同人"], fandom: "崩壞：星穹鐵道" });
    const detailRes = await SELF.fetch(`https://c.test/v1/review/${s.id}/detail`, { headers: bearer("rev-token") });
    const detail = (await detailRes.json()) as { card: { fandom?: string } };
    expect(detailRes.status).toBe(200);
    expect(detail.card.fandom).toBe("崩壞：星穹鐵道");
    // 單在這位審核人手上：他先蓋章，第二個章由另一位來
    if ((await stamp(env.DB, { submissionId: s.id, memberId: reviewer, verdict: "approve", note: "", now: Date.now() })).submission.status === "pending") {
      await claim(env.DB, s.id, "b", Date.now());
      await stamp(env.DB, { submissionId: s.id, memberId: "b", verdict: "approve", note: "", now: Date.now() });
    }
    expect((await getCard(env.DB, "fan-rev", "harbor"))!.fandom).toBe("崩壞：星穹鐵道");
    const audit = await env.DB.prepare("SELECT action, before_value, after_value FROM moderation_events WHERE action='fandom'").first<{ action: string; before_value: string; after_value: string }>();
    expect(audit).toEqual({ action: "fandom", before_value: "崩铁", after_value: "崩壞：星穹鐵道" });
  });
});

/** 假的 Wikidata：只認得星穹鐵道這一筆 */
const HSR: FandomEntity = {
  qid: "Q108896777",
  labels: { en: "Honkai: Star Rail", ja: "崩壊:スターレイル", zh: "崩坏：星穹铁道", "zh-tw": "崩壞：星穹鐵道", "zh-hant": "崩壞：星穹鐵道", "zh-hans": "崩坏：星穹铁道", ko: "붕괴: 스타레일" },
  aliases: { en: ["Star Rail", "HSR"], "zh-hant": ["星穹鐵道", "崩鐵"], "zh-hans": ["星穹铁道", "崩铁", "星铁"], ja: ["スターレイル"] },
  descriptions: { "zh-tw": "2023 年電子遊戲", en: "2023 video game" },
};
function fakeWikidata() {
  vi.spyOn(wikidata, "search").mockImplementation(async (q) => (/星|崩|rail|hsr/i.test(q) ? [{ id: HSR.qid, label: HSR.labels["zh-tw"]!, description: HSR.descriptions["zh-tw"]! }] : []));
  vi.spyOn(wikidata, "entity").mockImplementation(async (qid) => { if (qid !== HSR.qid) throw new Error("fandom_not_found"); return structuredClone(HSR); });
}

describe("原作對到 Wikidata", () => {
  it("送審帶編號：卡上是照看的人語言出的名字，各地譯名、縮寫都篩得到、搜得到；清單帶鍵與各語言名", async () => {
    fakeWikidata();
    const a = await author("wd-a", { roleId: "wd-a", name: "三月七的日常" });
    await a.submit({ fandomId: "Q108896777" });
    await a.approve();
    const b = await author("wd-b", { roleId: "wd-b", name: "自由文字的" });
    await b.submit({ fandom: "崩铁" });
    await b.approve();
    const hosted = (await getCard(env.DB, "wd-a", "harbor"))!.approved_hosted_role_id!;
    const zh = (await (await SELF.fetch(`https://c.test/v1/cards/${hosted}?lang=zh`)).json()) as { fandom: string; fandomKey: string; fandomLabels: Record<string, string> };
    expect(zh.fandom).toBe("崩壞：星穹鐵道");
    expect(zh.fandomKey).toBe("wd:Q108896777");
    expect(zh.fandomLabels["zh-hans"]).toBe("崩坏：星穹铁道");
    expect(((await (await SELF.fetch(`https://c.test/v1/cards/${hosted}?lang=en`)).json()) as { fandom: string }).fandom).toBe("Honkai: Star Rail");
    // 篩選：鍵、簡體別名、英文縮寫、日文都到同一張；自由文字那張靠它自己的鍵（別名表）也在
    expect(roleIds(await list("?fandom=wd:Q108896777"))).toEqual([hosted]);
    for (const f of ["星铁", "HSR", "スターレイル", "崩壞：星穹鐵道"]) expect(roleIds(await list(`?fandom=${encodeURIComponent(f)}`)), f).toContain(hosted);
    // 搜尋：作品的別名進了名稱欄
    expect(roleIds(await list("?q=hsr"))).toEqual([hosted]);
    expect(roleIds(await list("?q=スターレイル"))).toEqual([hosted]);
    const fandoms = (await (await SELF.fetch("https://c.test/v1/fandoms?zone=zh&lang=en")).json()) as { items: { key: string; fandom: string; labels?: Record<string, string>; n: number }[] };
    expect(fandoms.items.map((x) => [x.key, x.fandom, x.n])).toEqual([["wd:Q108896777", "Honkai: Star Rail", 1], ["崩铁", "崩铁", 1]]);
    expect(fandoms.items[0]!.labels?.ja).toBe("崩壊:スターレイル");
    // 副本存了，之後不再問 Wikidata
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM fandom_entities").first<{ n: number }>())!.n).toBe(1);
    expect(vi.mocked(wikidata.entity)).toHaveBeenCalledTimes(1);
  });

  it("候選查詢走 Wikidata，空字串不問；假編號不收", async () => {
    fakeWikidata();
    const res = (await (await SELF.fetch("https://c.test/v1/fandom-lookup?q=%E6%98%9F%E9%90%B5")).json()) as { items: { id: string; label: string; description: string }[] };
    expect(res.items).toEqual([{ id: "Q108896777", label: "崩壞：星穹鐵道", description: "2023 年電子遊戲" }]);
    expect(((await (await SELF.fetch("https://c.test/v1/fandom-lookup?q=")).json()) as { items: unknown[] }).items).toEqual([]);
    const a = await author("wd-bad");
    await expect(a.submit({ fandomId: "Q9999" })).rejects.toThrow("fandom_not_found");
    await expect(a.submit({ fandomId: "not-a-qid" })).rejects.toThrow("fandom_invalid");
  });

  it("每小時同步後作品別名還在索引裡", async () => {
    fakeWikidata();
    const a = await author("wd-sync", { roleId: "wd-sync", name: "舊名" });
    await a.submit({ fandomId: "Q108896777" });
    await a.approve();
    const hosted = (await getCard(env.DB, "wd-sync", "harbor"))!.approved_hosted_role_id!;
    rolesOnMainSite({ roleId: hosted, name: "新名" });
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(roleIds(await list("?q=hsr"))).toEqual([hosted]);
    expect((await list("?q=新名")).items[0]!.fandom).toBe("崩壞：星穹鐵道");
  });

  it("管理員過審後改原作：直接生效、留稽核，作者再送審也不會蓋掉", async () => {
    fakeWikidata();
    const a = await author("wd-mod", { roleId: "wd-mod", name: "沒填原作的" });
    await a.submit();
    await a.approve();
    identities({ "mgr-token": 30001 });
    const manager = await makeReviewer(30001);
    await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(manager).run();
    const card = (await getCard(env.DB, "wd-mod", "harbor"))!;
    const res = await SELF.fetch(`https://c.test/v1/moderation/cards/${card.id}/fandom`, { method: "POST", headers: { "Content-Type": "application/json", ...bearer("mgr-token") }, body: JSON.stringify({ fandomId: "Q108896777", reason: "作者沒填", operationId: crypto.randomUUID() }) });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(roleIds(await list("?fandom=wd:Q108896777"))).toEqual([card.approved_hosted_role_id]);
    expect(roleIds(await list("?q=hsr"))).toEqual([card.approved_hosted_role_id]);
    const audit = await env.DB.prepare("SELECT before_value, after_value FROM moderation_events WHERE action='fandom'").first<{ before_value: string; after_value: string }>();
    expect(audit!.before_value).toBe("");
    expect(JSON.parse(audit!.after_value).qid).toBe("Q108896777");
    // 作者改卡重送（沒填原作）再過審：站方的優先
    await a.submit();
    await a.approve();
    expect((await getCard(env.DB, "wd-mod", "harbor"))!.fandom_key).toBe("wd:Q108896777");
  });
});

describe("搜尋建議", () => {
  it("列標籤、原作、卡名；只給一般內容", async () => {
    const a = await author("sug-a", { roleId: "sug-a", name: "崩壞三 琪亞娜", tags: ["崩壞", "同人"] });
    await a.submit({ fandom: "崩壞三" });
    await a.approve();
    const b = await author("sug-b", { roleId: "sug-b", name: "崩壞 成人卡", tags: ["崩壞"] });
    await b.submit({ fandom: "崩壞三", nsfw: true });
    await b.approve();
    const res = await SELF.fetch("https://c.test/v1/suggest?zone=zh&q=崩坏");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tags: { tag: string }[]; fandoms: { fandom: string }[]; cards: { num: number; name: string }[] };
    expect(body.tags.map((t) => t.tag)).toEqual(["崩壞"]);
    expect(body.fandoms.map((f) => f.fandom)).toEqual(["崩壞三"]);
    expect(body.cards.map((c) => c.name)).toEqual(["崩壞三 琪亞娜"]);
    expect(((await (await SELF.fetch("https://c.test/v1/suggest?zone=zh&q=")).json()) as { cards: unknown[] }).cards).toEqual([]);
  });
});
