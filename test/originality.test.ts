import { describe, expect, it } from "vitest";
import { K, MAX_PRINTS, MIN_RUN, W, coveredRuns, fingerprints, printHashes, toUnits } from "../src/originality";

const values = (text: string, names: string[] = []) => toUnits(text, names).map((u) => u.value);

describe("toUnits", () => {
  it("counts each CJK character and each Latin word as one unit, dropping punctuation and spacing", () => {
    expect(values("她說：「Hello, world!」 好。")).toEqual(["她", "说", "hello", "world", "好"]);
  });

  it("folds full-width, case and traditional characters so trivial rewrites still match", () => {
    expect(values("ＡＢＣ 學習")).toEqual(values("abc 学习"));
  });

  it("replaces the card's own names with one placeholder so renaming a copy does not hide it", () => {
    expect(values("艾琳是騎士", ["艾琳"])).toEqual(values("露娜是騎士", ["露娜"]));
    expect(values("{{char}} 愛 {{user}}")).toEqual(values("{{user}} 愛 {{char}}"));
  });

  it("keeps original offsets so matches can be highlighted in the author's text", () => {
    const text = "  艾琳，Knight！";
    const us = toUnits(text, ["艾琳"]);
    expect(us.map((u) => text.slice(u.start, u.end))).toEqual(["艾琳", "Knight"]);
  });

  it("ignores single-character names that would erase ordinary words", () => {
    expect(values("你好", ["你"])).toEqual(["你", "好"]);
  });
});

describe("fingerprints", () => {
  const corpus = "月光落在古老的城牆上守夜的少女握緊長劍她發誓要守護這座城市直到最後一刻絕不退縮也絕不背叛同伴";

  it("always finds a shared run of at least K + W - 1 units, wherever it sits", () => {
    const run = [...corpus].slice(0, K + W - 1).join("");
    for (let pad = 0; pad < 9; pad++) {
      const a = fingerprints(toUnits("甲".repeat(pad) + run + "乙丙丁"));
      const b = fingerprints(toUnits("戊己".repeat(pad) + run));
      const shared = a.filter((f) => b.some((g) => g.hash === f.hash));
      expect(shared.length, `pad ${pad}`).toBeGreaterThan(0);
    }
  });

  it("selects far fewer fingerprints than positions", () => {
    const us = toUnits(corpus.repeat(4) + "尾");
    const fs = fingerprints(us);
    expect(fs.length).toBeLessThan((us.length - K + 1) / 2);
    expect(fs.every((f) => Number.isSafeInteger(f.hash))).toBe(true);
  });

  it("returns nothing for text shorter than one k-gram", () => {
    expect(fingerprints(toUnits("太短"))).toEqual([]);
  });
});

describe("coveredRuns", () => {
  it("merges overlapping matched k-grams and drops runs shorter than MIN_RUN", () => {
    // 兩個 k-gram 相接成一段；另一個孤立的 k-gram 太短，不算
    const runs = coveredRuns([0, 5, 40], 100);
    expect(runs).toEqual([[0, 5 + K]]);
    expect(5 + K).toBeGreaterThanOrEqual(MIN_RUN);
  });

  it("clamps runs to the text length", () => {
    expect(coveredRuns([0, 6], 13)).toEqual([[0, 13]]);
  });
});

describe("printHashes", () => {
  it("caps the hash list so the D1 parameter stays well under its 2 MB string limit, keeping the earliest text", () => {
    let x = 7;
    const text = Array.from({ length: 450_000 }, () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return String.fromCodePoint(0x4e00 + (x % 20000)); }).join("");
    const prints = fingerprints(toUnits(text));
    expect(prints.length).toBeGreaterThan(MAX_PRINTS);
    const hashes = printHashes(prints);
    expect(hashes.length).toBe(MAX_PRINTS);
    expect(JSON.stringify(hashes).length).toBeLessThan(1_200_000);
    expect(hashes[0]).toBe(prints[0].hash);
  });
});
