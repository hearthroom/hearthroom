/**
 * 桌寵蘇綺（設定集「桌寵」各節，2026-10-13）：
 *   - 骨架：四套造型共用一副，後面疊上的同名部件取代前面的；頭轉、頭髮彎、眼珠夾在眼白裡都是頂點算出來的
 *   - 照顧：故事是她的飯——在別處聊過天就算餵過；一天最多加一次好感；連續天數；她不會死、不會走（算法在 shared/，排程也用同一份）
 *   - 嚮導：除了玩卡與沙盒每頁都有用途；語言前綴不影響對到哪一頁；每一頁的文案五種語言都齊
 *   - 圖：綁定檔裡列到的每一張貼圖都在
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compose, Rig, type PetSkeleton, type PetSkin } from "../src/pet/puppet";
import { feed, levelOf, LEVELS, visit } from "../../shared/suki-care";
import { GUIDES, guideFor } from "../src/pet/guides";

const dir = resolve("public/mascot/pet");
const skeleton: PetSkeleton = JSON.parse(readFileSync(resolve(dir, "skeleton.json"), "utf8"));
const day: PetSkin = JSON.parse(readFileSync(resolve(dir, "skin-day.json"), "utf8"));

describe("骨架與部件", () => {
  it("綁定檔列到的貼圖都在", () => {
    expect(day.parts.filter((p) => !existsSync(resolve(dir, p.tex))).map((p) => p.tex)).toEqual([]);
    expect(existsSync(resolve(dir, "hit.png"))).toBe(true);
  });

  it("後面疊上的同名部件取代前面的，新的物理跟著帶進來", () => {
    const imp: PetSkin = { parts: [{ ...day.parts.find((p) => p.id === "body")!, tex: "imp-body.webp" }], physics: [{ param: "Tail", drive: { BodyZ: -2 }, stiffness: 20, damping: 3, limit: 20 }] };
    const model = compose(skeleton, day, imp);
    expect(model.parts.filter((p) => p.id === "body")).toHaveLength(1);
    expect(model.parts.find((p) => p.id === "body")!.tex).toBe("imp-body.webp");
    expect(model.physics!.some((p) => p.param === "Tail")).toBe(true);
    expect(model.parts.length).toBe(day.parts.length);
  });

  it("轉頭時瀏海比臉動得多、後髮往反方向；不轉頭時頂點就在原位", () => {
    const rig = new Rig(compose(skeleton, day));
    const part = (id: string) => rig.model.parts.find((p) => p.id === id)!;
    const meanX = (id: string) => { const v = rig.vertices(part(id)); let s = 0; for (let i = 0; i < v.length; i += 2) s += v[i]; return s / (v.length / 2); };
    const rest = { face: meanX("face"), fronthair: meanX("fronthair"), backhair: meanX("backhair") };
    const [x, , w] = part("face").rect;
    expect(rest.face).toBeGreaterThan(x); expect(rest.face).toBeLessThan(x + w);
    rig.params.AngleX = 1;
    const dFace = meanX("face") - rest.face, dFront = meanX("fronthair") - rest.fronthair, dBack = meanX("backhair") - rest.backhair;
    expect(dFace).toBeGreaterThan(0);
    expect(dFront).toBeGreaterThan(dFace);
    expect(dBack).toBeLessThan(0);
  });

  it("馬尾越靠尾端彎得越多，根部不動", () => {
    const rig = new Rig(compose(skeleton, day));
    const pony = rig.model.parts.find((p) => p.id === "ponytail")!;
    const before = Float32Array.from(rig.vertices(pony));
    rig.params.Ponytail = 12;
    const after = rig.vertices(pony);
    const [cols, rows] = pony.grid!;
    const shift = (row: number) => { let s = 0; for (let i = 0; i <= cols; i++) { const k = (row * (cols + 1) + i) * 2; s += Math.hypot(after[k] - before[k], after[k + 1] - before[k + 1]); } return s / (cols + 1); };
    expect(shift(rows)).toBeGreaterThan(shift(Math.floor(rows / 2)));
    expect(shift(0)).toBeLessThan(shift(rows) * 0.2);
  });

  it("被推一下的鐘擺會擺回來，不會越擺越大", () => {
    const rig = new Rig(compose(skeleton, day));
    rig.kick("Ponytail", 300);
    let peak = 0;
    for (let i = 0; i < 600; i++) { rig.step(1 / 60); peak = Math.max(peak, Math.abs(rig.params.Ponytail)); }
    expect(peak).toBeGreaterThan(1);
    expect(Math.abs(rig.params.Ponytail)).toBeLessThan(0.5);
  });

  it("眼珠只畫在眼白裡；閉眼與表情預設看不到", () => {
    const rig = new Rig(compose(skeleton, day));
    expect(rig.model.parts.find((p) => p.id === "iris")!.clipTo).toBe("eyewhite");
    for (const id of ["eyeclosed", "mouthopen", "expr-happy", "expr-dizzy"]) expect(rig.opacity(rig.model.parts.find((p) => p.id === id)!)).toBe(0);
    rig.params.Expr_happy = 1;
    expect(rig.opacity(rig.model.parts.find((p) => p.id === "expr-happy")!)).toBe(1);
  });
});

describe("照顧與羈絆（網站與排程共用的算法）", () => {
  const TPE = -480, H = 3_600_000;
  const at = (d: number, h: number) => Date.UTC(2026, 9, d, h - 8);
  it("每天第一次來是簽到 +1；那天聊了故事再 +1；同一天再來、再聊都不重複加", () => {
    const a = visit(null, at(13, 21), at(13, 20), TPE);
    expect(a.news.map((n) => n.kind)).toEqual(expect.arrayContaining(["checkIn", "fed"]));
    expect(a.state.fullness).toBe(1);
    expect(a.state.affection).toBe(2);
    const b = visit(a.state, at(13, 23), at(13, 22), TPE);
    expect(b.state.affection).toBe(2);
    expect(b.news.map((n) => n.kind)).not.toContain("checkIn");
    const c = visit(b.state, at(14, 9), null, TPE);
    expect(c.state.affection).toBe(3);
    expect(c.news.find((n) => n.kind === "checkIn")).toMatchObject({ days: 2 });
  });
  it("一天沒聊會餓；她不會死，飽足度最低就是 0", () => {
    const a = visit(null, at(13, 21), at(13, 20), TPE);
    const b = visit(a.state, at(18, 21), null, TPE);
    expect(b.news.map((n) => n.kind)).toContain("hungry");
    expect(b.state.fullness).toBe(0);
  });
  it("連續天數：隔天來 +1；斷了從 1 重來並說好久不見", () => {
    let s = visit(null, at(1, 21), null, TPE).state;
    for (let d = 2; d <= 7; d++) s = visit(s, at(d, 21), null, TPE).state;
    expect(s.streak).toBe(7);
    const back = visit(s, at(12, 21), null, TPE);
    expect(back.state.streak).toBe(1);
    expect(back.news.find((n) => n.kind === "missed")).toMatchObject({ days: 5 });
  });
  it("好感度等級照門檻算，升級會通知", () => {
    expect(levelOf(0)).toBe(0);
    expect(levelOf(LEVELS[2])).toBe(2);
    const s = visit(null, at(13, 21), null, TPE).state;
    s.affection = LEVELS[1] - 1; // 今天已經簽到過，聊故事這一分讓她升級
    expect(feed(s, at(13, 22), at(13, 22), TPE).map((n) => n.kind)).toContain("levelUp");
    void H;
  });
});

describe("每一頁的嚮導", () => {
  const locales = ["zh-Hant", "zh-Hans", "en", "ja", "ko"].map((l) => [l, JSON.parse(readFileSync(resolve("src/locales", `${l}.json`), "utf8")) as Record<string, string>] as const);

  it("語言前綴與結尾斜線不影響對到哪一頁", () => {
    expect(guideFor("/")?.id).toBe("board");
    expect(guideFor("/en")?.id).toBe("board");
    expect(guideFor("/ja/mine/")?.id).toBe("mine");
    expect(guideFor("/cards/42")?.id).toBe("card");
    expect(guideFor("/cards/abc/edit")?.id).toBe("editor");
    expect(guideFor("/create")?.id).toBe("editor");
    expect(guideFor("/review/cases")?.id).toBe("review");
    expect(guideFor("/zh-Hans/me/badges")?.id).toBe("badges");
  });

  it("每一頁的開場與問答五種語言都有", () => {
    const missing: string[] = [];
    for (const g of GUIDES) {
      const keys = [`mascot.pet.guide.${g.id}.hello`];
      for (let i = 1; i <= g.topics; i++) keys.push(`mascot.pet.guide.${g.id}.q${i}`, `mascot.pet.guide.${g.id}.a${i}`);
      for (const [l, m] of locales) for (const k of keys) if (!m[k]) missing.push(`${l} ${k}`);
    }
    expect(missing).toEqual([]);
  });

  it("台詞裡的佔位符在每種語言都一樣", () => {
    const zh = locales[0][1];
    const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    const bad: string[] = [];
    for (const k of Object.keys(zh).filter((k) => k.startsWith("mascot.pet."))) for (const [l, m] of locales) if (holes(m[k] ?? "") !== holes(zh[k])) bad.push(`${l} ${k}`);
    expect(bad).toEqual([]);
  });
});
