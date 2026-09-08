import { SELF, createScheduledController, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { buildSearchText } from "../src/upstream";
import { HttpError } from "../src/types";
import { upstream } from "../src/upstream";
import { mainSiteDown, makeMember, resetDb, restoreUpstream, role, rolesOnMainSite, testHandle } from "./helpers";

/** 直接寫庫，才能精確控制註冊時間與趨勢窗口。 */
async function seed(f: {
  id: string;
  roleId?: string;
  zone?: "zh" | "en" | "ja" | "ko" | "all";
  welcome?: string;
  authorName?: string;
  authorNumId?: number;
  name?: string;
  nameEn?: string;
  nameJa?: string;
  desc?: string;
  tags?: string[];
  talkNum?: number;
  talkPrev?: number;
  followNum?: number;
  registeredAt?: number;
}) {
  const r = role({
    roleId: f.roleId ?? `role-${f.id}`,
    zone: f.zone,
    welcome: f.welcome,
    authorNumId: f.authorNumId,
    authorName: f.authorName,
    name: f.name,
    nameEn: f.nameEn,
    nameJa: f.nameJa,
    desc: f.desc,
    tags: f.tags,
    talkNum: f.talkNum,
    followNum: f.followNum,
  });
  await env.DB.prepare(
    `INSERT INTO cards (id, source_role_id, zone, author_num_id, author_name, author_avatar, names, summaries,
       avatar_url, background_url, slug, tags, talk_num, follow_num, talk_num_prev, search_text,
       registered_at, last_synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      f.id, r.roleId, r.zone, r.authorNumId, r.authorName, r.authorAvatar,
      JSON.stringify(r.names), JSON.stringify(r.summaries), r.avatarUrl, r.backgroundUrl, r.slug,
      JSON.stringify(r.tags), r.talkNum, r.followNum, f.talkPrev ?? r.talkNum,
      buildSearchText(r), f.registeredAt ?? Date.now(), 0,
    )
    .run();
}

const list = async (query = "") => {
  const res = await SELF.fetch(`https://c.test/v1/cards${query}`);
  return { status: res.status, body: (await res.json()) as { items: any[]; total: number | null; hasNext: boolean } };
};
const ids = (b: { items: any[] }) => b.items.map((i) => i.id);

beforeEach(async () => {
  await resetDb();
  rolesOnMainSite();
});
afterEach(restoreUpstream);

describe("搜尋", () => {
  beforeEach(async () => {
    await seed({ id: "a", name: "夜行偵探事務所", desc: "民國推理", tags: ["推理", "民國"] });
    await seed({ id: "b", name: "修仙宗門紀事", desc: "東方玄幻", tags: ["修仙"] });
    await seed({ id: "c", name: "Cyber Noir", nameEn: "Cyber Noir Detective", desc: "neon city", tags: ["scifi"] });
    await seed({ id: "d", name: "夜想曲", nameJa: "ノクターン", tags: ["音楽"] });
  });

  it("中文三字以上走 FTS", async () => {
    expect(ids((await list("?q=夜行偵探")).body)).toEqual(["a"]);
  });

  it("中文兩字走 LIKE fallback（trigram 這裡沒轍）", async () => {
    expect(ids((await list("?q=修仙")).body)).toEqual(["b"]);
  });

  it("英文", async () => {
    expect(ids((await list("?q=noir")).body)).toEqual(["c"]);
  });

  it("日文假名——一個索引涵蓋四個語言版本", async () => {
    expect(ids((await list("?q=ノクターン")).body)).toEqual(["d"]);
  });

  it("搜得到標籤", async () => {
    expect(ids((await list("?q=推理")).body)).toContain("a");
  });

  it("FTS 語法字元不會炸掉查詢", async () => {
    for (const q of ['"OR 1=1--', "a* NEAR b", '""""']) {
      expect((await list(`?q=${encodeURIComponent(q)}`)).status).toBe(200);
    }
  });

  it("標籤鍵展開成五語名稱：繁體卡標的「調教&強迫」用 key=training 也找得到；不是鍵的字照字面過濾", async () => {
    await seed({ id: "t1", name: "調教卡", tags: ["調教&強迫"] });
    await seed({ id: "t2", name: "训练卡", tags: ["调教&强迫"] });
    expect(ids((await list("?tag=training")).body).sort()).toEqual(["t1", "t2"]);
    expect(ids((await list("?tag=%E4%BF%AE%E4%BB%99")).body)).toEqual(["b"]);
  });

  it("可以用標籤過濾", async () => {
    expect(ids((await list("?tag=修仙")).body)).toEqual(["b"]);
  });
});

describe("排名", () => {
  const now = Date.now();
  const DAY = 86400_000;

  beforeEach(async () => {
    // 老神卡累積量大但這個窗口沒動靜；新卡累積量小但正在被聊。
    await seed({ id: "old", talkNum: 50_000, talkPrev: 50_000, registeredAt: now - 300 * DAY });
    await seed({ id: "rising", talkNum: 900, talkPrev: 400, registeredAt: now - 10 * DAY });
    // 半天前上榜：正好壓在 24h 邊界上會因為請求時的 now 比 seed 時晚而掉出日榜
    await seed({ id: "fresh", talkNum: 20, talkPrev: 18, registeredAt: now - 0.5 * DAY });
  });

  // 榜的口徑照魅魔島（owner 2026-09-07）：日／週／月榜只看上榜時間在窗口內的卡、按累積對話數排；
  // 最熱是全部卡的累積對話數；最新按上榜時間；推薦隨機。舊的「同步窗口增量」不再當排序鍵，只給前端顯示。
  it("hot 是累積對話數（最熱）；top 是舊名字，當同義詞", async () => {
    expect(ids((await list("?sort=hot")).body)).toEqual(["old", "rising", "fresh"]);
    expect(ids((await list("?sort=top")).body)).toEqual(["old", "rising", "fresh"]);
  });

  it("day／week／month 只列上榜時間在窗口內的卡，窗口內按累積對話數排", async () => {
    expect(ids((await list("?sort=day")).body)).toEqual(["fresh"]);
    expect(ids((await list("?sort=week")).body)).toEqual(["fresh"]);
    expect(ids((await list("?sort=month")).body)).toEqual(["rising", "fresh"]);
  });

  it("random 回全部的卡、順序不固定，而且不進快取（每次來都重抽）", async () => {
    const a = await SELF.fetch("https://c.test/v1/cards?sort=random");
    const b = await SELF.fetch("https://c.test/v1/cards?sort=random");
    expect(a.headers.get("X-Cache")).toBe("miss");
    expect(b.headers.get("X-Cache")).toBe("miss");
    expect(ids((await a.json()) as { items: any[] }).sort()).toEqual(["fresh", "old", "rising"]);
  });

  it("new 看登記時間", async () => {
    expect(ids((await list("?sort=new")).body)).toEqual(["fresh", "rising", "old"]);
  });

  it("回應帶出 trending（同步窗口增量）供前端顯示，跟排序鍵無關", async () => {
    const { body } = await list("?sort=month");
    expect(body.items.map((i: any) => [i.id, i.trending])).toEqual([["rising", 500], ["fresh", 2]]);
  });

  it("分頁", async () => {
    const p1 = await list("?sort=new&limit=2");
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.total).toBe(3);
    expect(ids((await list("?sort=new&limit=2&offset=2")).body)).toEqual(["old"]);
  });

  it("limit 有上限，擋住一次撈全庫", async () => {
    const res = await SELF.fetch("https://c.test/v1/cards?limit=99999");
    expect(((await res.json()) as any).limit).toBe(100);
  });
});

describe("語言解析", () => {
  beforeEach(() => seed({ id: "a", name: "夜行偵探", nameEn: "Night Detective", desc: "民國推理" }));

  it("依 lang 參數回對應語言，並附上原始多語", async () => {
    const zh = (await list("?lang=zh")).body.items[0];
    expect(zh.name).toBe("夜行偵探");
    const en = (await list("?lang=en")).body.items[0];
    expect(en.name).toBe("Night Detective");
    expect(en.names.zh).toBe("夜行偵探");
  });

  it("缺該語言版本時退回中文，不會變空白", async () => {
    expect((await list("?lang=ko")).body.items[0].name).toBe("夜行偵探");
  });
});

describe("每小時同步", () => {
  it("內容與熱度以上游為準，作者不必回來重新登記", async () => {
    await seed({ id: "a", name: "舊名字", talkNum: 100, talkPrev: 100 });
    rolesOnMainSite({ roleId: "role-a", name: "上游已改名", talkNum: 350 });

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);

    const card = (await list()).body.items[0];
    expect(card.name).toBe("上游已改名");
    expect(card.talkNum).toBe(350);
    // 上一輪的 100 挪進 prev，趨勢窗口 = 一個同步周期。
    expect(card.trending).toBe(250);
  });

  it("同步後搜尋跟著改名走", async () => {
    await seed({ id: "a", name: "舊名字" });
    rolesOnMainSite({ roleId: "role-a", name: "全新標題" });

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(ids((await list("?q=全新標題")).body)).toEqual(["a"]);
    expect((await list("?q=舊名字")).body.items).toHaveLength(0);
  });

  it("單張卡失敗不會拖垮整批", async () => {
    await seed({ id: "good", name: "同步得到" });
    await seed({ id: "gone", roleId: "role-unreachable", name: "上游已刪" });
    rolesOnMainSite({ roleId: "role-good", name: "更新成功" });

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);

    const names = (await list()).body.items.map((i) => i.name).sort();
    expect(names).toContain("更新成功");
    // 上游不刪卡，所以讀不到一律當成暫時性的：保留原樣，下一輪仍排在最前面重試。
    expect(names).toContain("上游已刪");
  });
});

describe("榜單邊緣快取", () => {
  const hdr = async (query = "") => {
    const res = await SELF.fetch(`https://c.test/v1/cards${query}`);
    return { cache: res.headers.get("X-Cache"), body: (await res.json()) as any };
  };

  beforeEach(() => seed({ id: "a", name: "被快取的卡", talkNum: 100, talkPrev: 50 }));

  it("第二次同樣的請求命中快取", async () => {
    expect((await hdr()).cache).toBe("miss");
    expect((await hdr()).cache).toBe("hit");
  });

  it("命中時回的內容跟第一次一樣", async () => {
    const first = await hdr();
    const second = await hdr();
    expect(second.body.items.map((i: any) => i.id)).toEqual(first.body.items.map((i: any) => i.id));
  });

  it("不同查詢條件各自快取，不會互相汙染", async () => {
    await seed({ id: "b", name: "另一張", talkNum: 10, talkPrev: 5 });
    const hot = await hdr("?sort=hot");
    const nw = await hdr("?sort=new");
    expect(hot.cache).toBe("miss");
    expect(nw.cache).toBe("miss");
    // 兩個排序各自獨立命中，證明鍵有涵蓋查詢字串
    expect((await hdr("?sort=hot")).cache).toBe("hit");
    expect((await hdr("?sort=new")).cache).toBe("hit");
  });

  it("榜單是公開資料，可以進共用快取", async () => {
    const res = await SELF.fetch("https://c.test/v1/cards");
    expect(res.headers.get("Cache-Control")).toContain("public");
  });
});

describe("查詢成本", () => {
  beforeEach(async () => {
    for (let i = 0; i < 30; i++) {
      await seed({ id: `c${i}`, name: `卡 ${i}`, tags: i < 5 ? ["推理"] : ["其他"], talkNum: 100 - i, talkPrev: 90 - i });
    }
  });

  it("未篩選時給精確總數", async () => {
    const { body } = await list("");
    expect(body.total).toBe(30);
    expect(body.hasNext).toBe(true);
  });

  /** 有篩選又還有下一頁時不數總數：那種 COUNT 常常比排序本身還貴，而使用者只需要知道還有沒有。 */
  it("有篩選且還有下一頁時不給總數，但 hasNext 準確", async () => {
    const { body } = await list("?tag=其他&limit=5");
    expect(body.total).toBeNull();
    expect(body.hasNext).toBe(true);
    expect(body.items).toHaveLength(5);
  });

  it("翻到最後一頁時總數免費算得出來", async () => {
    const { body } = await list("?tag=推理");
    expect(body.hasNext).toBe(false);
    expect(body.total).toBe(5);
  });

  it("hasNext 在剛好整除時不會多報一頁", async () => {
    const exact = await list("?tag=推理&limit=5");
    expect(exact.body.items).toHaveLength(5);
    expect(exact.body.hasNext).toBe(false);
  });
});

describe("hot_score 衍生欄位", () => {
  it("由資料庫維護，寫入時不必自己算", async () => {
    await seed({ id: "a", talkNum: 900, talkPrev: 400 });
    const row = (await env.DB.prepare("SELECT hot_score FROM cards WHERE id='a'").first()) as any;
    expect(row.hot_score).toBe(500);
  });

  it("同步更新 talk_num 之後自動跟著變，不可能漂移", async () => {
    await seed({ id: "a", roleId: "role-a", talkNum: 100, talkPrev: 100 });
    rolesOnMainSite({ roleId: "role-a", talkNum: 350 });

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);

    const row = (await env.DB.prepare("SELECT hot_score, talk_num, talk_num_prev FROM cards WHERE id='a'").first()) as any;
    expect(row.talk_num).toBe(350);
    expect(row.talk_num_prev).toBe(100);
    expect(row.hot_score).toBe(250);
  });

  it("欄位算出來的增量會帶到回應的 trending；排序鍵已改成累積量（owner 2026-09-07），不再看它", async () => {
    await seed({ id: "cold", talkNum: 50_000, talkPrev: 50_000 });
    await seed({ id: "rising", talkNum: 900, talkPrev: 400 });
    const items = (await list("?sort=hot")).body.items;
    expect(items.map((i: any) => i.id)).toEqual(["cold", "rising"]);
    expect(items.find((i: any) => i.id === "rising").trending).toBe(500);
  });
});

describe("同步並發", () => {
  /** 換掉上游讀取，讓它可以觀測同時有幾個請求在飛，並且慢到看得出串／並行的差別。 */
  function trackingUpstream(delayMs = 5) {
    const state = { inFlight: 0, peak: 0, done: 0 };
    upstream.fetchRole = async (_env, roleId) => {
      state.inFlight++;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise((r) => setTimeout(r, delayMs));
      state.inFlight--;
      state.done++;
      if (roleId === "role-bad") throw new HttpError(502, "upstream boom");
      return role({ roleId, name: `同步過的 ${roleId}` });
    };
    return state;
  }

  async function runSync() {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController(), env, ctx);
    await waitOnExecutionContext(ctx);
  }

  it("同時飛在天上的請求不只一個，也不超過上限", async () => {
    for (let i = 0; i < 20; i++) await seed({ id: `s${i}`, roleId: `role-${i}` });
    const state = trackingUpstream();

    await runSync();

    expect(state.done).toBe(20);
    expect(state.peak).toBeGreaterThan(1);
    // 上限來自 wrangler.toml 的 SYNC_CONCURRENCY，刻意壓在個位數：不是把上游打滿。
    expect(state.peak).toBeLessThanOrEqual(Number(env.SYNC_CONCURRENCY));
  });

  it("每一筆都會被處理到，不會因為並發而漏掉", async () => {
    for (let i = 0; i < 15; i++) await seed({ id: `s${i}`, roleId: `role-${i}`, name: "舊名字" });
    trackingUpstream(1);

    await runSync();

    const rows = await env.DB.prepare("SELECT names FROM cards").all();
    expect(rows.results).toHaveLength(15);
    expect(rows.results.every((r: any) => r.names.includes("同步過的"))).toBe(true);
  });

  it("中間有一筆失敗，其餘照樣完成", async () => {
    await seed({ id: "good1", roleId: "role-1" });
    await seed({ id: "bad", roleId: "role-bad", name: "讀不到" });
    await seed({ id: "good2", roleId: "role-2" });
    trackingUpstream(1);

    await runSync();

    const names = (await list()).body.items.map((i: any) => i.name).sort();
    expect(names.filter((n: string) => n.startsWith("同步過的"))).toHaveLength(2);
    // 失敗的那張維持原樣留在榜上，下一輪重試。
    expect(names).toContain("讀不到");
  });

  it("同步順手補上還沒有成員列的作者（0005 之前登記、之後沒再登入的人）", async () => {
    await seed({ id: "old1", roleId: "role-old1", authorNumId: 4242 });
    await seed({ id: "old2", roleId: "role-old2", authorNumId: 4242 });
    await makeMember(5151);
    await seed({ id: "known", roleId: "role-known", authorNumId: 5151 });
    rolesOnMainSite(
      { roleId: "role-old1", authorNumId: 4242 },
      { roleId: "role-old2", authorNumId: 4242 },
      { roleId: "role-known", authorNumId: 5151 },
    );
    await runSync();
    const ids = await env.DB.prepare("SELECT provider, external_id, member_id FROM member_identities ORDER BY external_id").all<{ provider: string; external_id: string; member_id: string }>();
    expect(ids.results.map((r) => [r.provider, r.external_id])).toEqual([["lunatalk", "4242"], ["lunatalk", "5151"]]);
    const members = await env.DB.prepare("SELECT handle FROM members").all<{ handle: string }>();
    expect(members.results).toHaveLength(2);
    expect(members.results.every((m) => /^[a-z]{8}$/.test(m.handle))).toBe(true);
    // 兩張卡同一個作者只建一個成員；之後列表就帶得出公開 ID
    const { body } = await list("?zone=all");
    const byRole = Object.fromEntries(body.items.map((i: any) => [i.roleId, i.author.handle]));
    expect(byRole["role-old1"]).toBe(byRole["role-old2"]);
    expect(byRole["role-old1"]).toMatch(/^[a-z]{8}$/);
  });

  it("批次比並發上限小時不會開多餘的工作者", async () => {
    await seed({ id: "only", roleId: "role-1" });
    const state = trackingUpstream();
    await runSync();
    expect(state.peak).toBe(1);
  });
});

describe("語區", () => {
  beforeEach(async () => {
    await seed({ id: "zh1", zone: "zh", talkNum: 10, talkPrev: 0 });
    await seed({ id: "en1", zone: "en", talkNum: 99, talkPrev: 0 });
    await seed({ id: "ja1", zone: "ja" });
    await seed({ id: "any", zone: "all", talkNum: 5, talkPrev: 0 });
  });

  it("不帶 zone 就是中文區，不做混語言總榜", async () => {
    const { body } = await list();
    expect(ids(body).sort()).toEqual(["any", "zh1"]);
    expect(body.total).toBe(2);
  });

  it("每區只列自己的卡，all 的卡每區都有", async () => {
    expect(ids((await list("?zone=en")).body)).toEqual(["en1", "any"]);
    expect(ids((await list("?zone=ja")).body).sort()).toEqual(["any", "ja1"]);
    expect(ids((await list("?zone=ko")).body)).toEqual(["any"]);
  });

  it("不認得的 zone 退回中文區", async () => {
    expect(ids((await list("?zone=fr")).body).sort()).toEqual(["any", "zh1"]);
  });

  it("搜尋也限定在語區內", async () => {
    await seed({ id: "en2", zone: "en", name: "霧港偵探" });
    await seed({ id: "zh2", zone: "zh", name: "霧港偵探" });
    expect(ids((await list("?zone=en&q=霧港偵探")).body)).toEqual(["en2"]);
  });

  it("作者主頁跨語區列全部作品；作者條件是本站的公開 ID", async () => {
    await makeMember(10001);
    const { body } = await list(`?author=${testHandle(10001)}&zone=ko`);
    expect(body.items).toHaveLength(4);
    expect(body.items.every((i: any) => i.author.handle === testHandle(10001))).toBe(true);
    // 拿上游數字 ID 來問：不是公開 ID，空榜
    expect((await list("?author=10001")).body.items).toEqual([]);
  });

  it("回應帶 zone，前端才能在跨語區的清單上標語言", async () => {
    const { body } = await list("?zone=en");
    expect(body.items.map((i) => i.zone)).toEqual(["en", "all"]);
  });
});

describe("搜尋：相關度與全文", () => {
  beforeEach(async () => {
    await seed({ id: "hot", name: "無關的熱門卡", talkNum: 9999, talkPrev: 0 });
    await seed({ id: "once", name: "霧港", desc: "霧港偵探的故事", talkNum: 1 });
    await seed({ id: "many", name: "霧港偵探", desc: "霧港偵探 霧港偵探 霧港偵探", tags: ["霧港偵探"], talkNum: 1 });
    await seed({ id: "welcome", name: "別的名字", desc: "別的簡介", welcome: "你走進了霧港偵探事務所。", talkNum: 1 });
  });

  it("relevance 把最相關的排最前，熱門但無關的卡不會霸榜", async () => {
    const { body } = await list("?q=霧港偵探&sort=relevance");
    expect(ids(body)[0]).toBe("many");
    expect(ids(body)).not.toContain("hot");
  });

  it("開場白也搜得到", async () => {
    const { body } = await list("?q=偵探事務所");
    expect(ids(body)).toEqual(["welcome"]);
  });

  it("zone=all 跨語區搜", async () => {
    await seed({ id: "en", zone: "en", name: "霧港偵探 EN" });
    expect(ids((await list("?q=霧港偵探&zone=zh")).body)).not.toContain("en");
    expect(ids((await list("?q=霧港偵探&zone=all")).body)).toContain("en");
  });
});

describe("熱門標籤", () => {
  it("按出現次數排，只算這一區", async () => {
    await seed({ id: "a", tags: ["推理", "民國"] });
    await seed({ id: "b", tags: ["推理"] });
    await seed({ id: "c", zone: "en", tags: ["mystery"] });
    const res = await SELF.fetch("https://c.test/v1/tags?zone=zh");
    const body = (await res.json()) as { items: { tag: string; n: number }[] };
    expect(body.items).toEqual([{ tag: "推理", n: 2 }, { tag: "民國", n: 1 }]);
  });
});

describe("作者榜", () => {
  beforeEach(async () => {
    await seed({ id: "a1", authorNumId: 1, authorName: "甲", talkNum: 100, talkPrev: 50 });
    await seed({ id: "a2", authorNumId: 1, authorName: "甲", talkNum: 50, talkPrev: 50 });
    await seed({ id: "b1", authorNumId: 2, authorName: "乙", talkNum: 500, talkPrev: 500 });
    await seed({ id: "c1", authorNumId: 3, authorName: "丙", zone: "en", talkNum: 9999 });
  });
  const authors = async (q = "") => {
    const res = await SELF.fetch(`https://c.test/v1/authors${q}`);
    return ((await res.json()) as { items: { accountNumId: number; cardCount: number; talkTotal: number; trending: number }[] }).items;
  };

  it("預設按累積對話排，數字是登記在本站的作品加總", async () => {
    const items = await authors();
    expect(items.map((a) => [a.accountNumId, a.cardCount, a.talkTotal])).toEqual([[2, 1, 500], [1, 2, 150]]);
  });

  it("hot 按這個窗口的增量排", async () => {
    const items = await authors("?sort=hot");
    expect(items[0]!.accountNumId).toBe(1);
    expect(items[0]!.trending).toBe(50);
  });

  it("只算這一區；zone=all 才把英文區的作者算進來", async () => {
    expect((await authors()).map((a) => a.accountNumId)).not.toContain(3);
    expect((await authors("?zone=all"))[0]!.accountNumId).toBe(3);
  });

  it("可以按名字搜", async () => {
    expect((await authors("?q=乙")).map((a) => a.accountNumId)).toEqual([2]);
  });
});
