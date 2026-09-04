import { SELF, createScheduledController, createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { buildSearchText } from "../src/upstream";
import { mainSiteDown, resetDb, restoreUpstream, role, rolesOnMainSite } from "./helpers";

/** 直接寫庫，才能精確控制註冊時間與趨勢窗口。 */
async function seed(f: {
  id: string;
  roleId?: string;
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
    authorNumId: f.authorNumId,
    name: f.name,
    nameEn: f.nameEn,
    nameJa: f.nameJa,
    desc: f.desc,
    tags: f.tags,
    talkNum: f.talkNum,
    followNum: f.followNum,
  });
  await env.DB.prepare(
    `INSERT INTO cards (id, source_role_id, author_num_id, author_name, author_avatar, names, summaries,
       avatar_url, background_url, slug, tags, talk_num, follow_num, talk_num_prev, search_text,
       registered_at, last_synced_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      f.id, r.roleId, r.authorNumId, r.authorName, r.authorAvatar,
      JSON.stringify(r.names), JSON.stringify(r.summaries), r.avatarUrl, r.backgroundUrl, r.slug,
      JSON.stringify(r.tags), r.talkNum, r.followNum, f.talkPrev ?? r.talkNum,
      buildSearchText(r), f.registeredAt ?? Date.now(), 0,
    )
    .run();
}

const list = async (query = "") => {
  const res = await SELF.fetch(`https://c.test/v1/cards${query}`);
  return { status: res.status, body: (await res.json()) as { items: any[]; total: number } };
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
    await seed({ id: "fresh", talkNum: 20, talkPrev: 18, registeredAt: now - 1 * DAY });
  });

  it("hot 看的是這個同步窗口的對話增量，不是累積量", async () => {
    expect(ids((await list("?sort=hot")).body)).toEqual(["rising", "fresh", "old"]);
  });

  it("top 看累積量", async () => {
    expect(ids((await list("?sort=top")).body)).toEqual(["old", "rising", "fresh"]);
  });

  it("new 看登記時間", async () => {
    expect(ids((await list("?sort=new")).body)).toEqual(["fresh", "rising", "old"]);
  });

  it("回應帶出 trending 數字供前端顯示", async () => {
    const { body } = await list("?sort=hot");
    expect(body.items[0].trending).toBe(500);
    expect(body.items[2].trending).toBe(0);
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
