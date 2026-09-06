/**
 * 真實酒館卡的特徵化探針。第三方卡不入庫（授權不明），所以這支測試只在指定目錄時才跑：
 *
 *   REAL_CARDS_DIR=/path/to/cards npx vitest run test/real-cards.probe.test.ts
 *
 * 目錄裡放 .json / .png 的卡。每張卡走完整條匯入 → 匯出 → 再匯入，檢查不變量並印出摘要，
 * 讀者看摘要就知道哪一張的哪個欄位沒帶過來。沒有目錄時整個 describe 跳過，不影響可信集。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { draftToTavern, parseTavernFile, tavernToDraft } from "../src/lib/tavern";

const dir = process.env.REAL_CARDS_DIR;
const LABELS = { personality: "【性格】", scenario: "【場景】" };

describe.skipIf(!dir)("真實酒館卡探針", () => {
  const files = dir ? readdirSync(dir).filter((f) => /\.(json|png)$/i.test(f)) : [];
  for (const name of files) {
    it(name, async () => {
      const bytes = readFileSync(join(dir!, name));
      const file = new File([bytes as unknown as BlobPart], name);
      let parsed;
      try {
        parsed = await parseTavernFile(file);
      } catch (err) {
        // 世界書檔、非卡片 JSON 會走到這裡：印出來就好，那不是匯入器的錯
        process.stdout.write(`${name}: not a card (${err instanceof Error ? err.message : err})\n`);
        return;
      }
      const result = tavernToDraft(parsed.card, { language: "zh-Hant", labels: LABELS, image: parsed.image });
      const d = result.draft;
      const entries = result.worldbook?.entries ?? [];
      process.stdout.write(
        `${name}: spec=${result.spec} name=${JSON.stringify(d.roleName)} detail=${[...d.roleDetailDesc].length} welcome=${[...d.roleWelcome].length}` +
          ` alts=${d.alternates.length} talk=${d.talkExample.length} tags=${d.roleTag.length} contract=${d.roleOutputContract.length} jb=${d.jailbreak.length}` +
          ` book=${entries.length} secondary=${entries.filter((e) => e.secondaryKeywords.length).length} constant=${entries.filter((e) => e.isConstant).length}` +
          ` disabled=${entries.filter((e) => !e.isEnabled).length} image=${result.image ? "yes" : "no"}\n  dropped: ${result.dropped.map((n) => n.key.replace("import.drop.", "") + (n.params ? JSON.stringify(n.params) : "")).join(", ") || "-"}\n`,
      );

      // 不變量：有名字、有人設；條目一律有內容與名字；標籤不超過十個
      expect(d.roleName.length).toBeGreaterThan(0);
      expect(d.roleDetailDesc.length).toBeGreaterThan(0);
      expect(d.roleTag.length).toBeLessThanOrEqual(10);
      for (const entry of entries) {
        expect(entry.content.trim().length).toBeGreaterThan(0);
        expect(entry.name.length).toBeGreaterThan(0);
        expect(entry.name.length).toBeLessThanOrEqual(20);
      }
      // mes_example 拆不出就進報告，拆得出就一定有輪次——兩者不能同時為空又沒報告
      if (parsed.card.data.mes_example?.trim()) {
        expect(d.talkExample.length > 0 || result.dropped.some((n) => n.key === "import.drop.mesExample")).toBe(true);
      }
      // 匯出再匯入要穩定：第二次的草稿跟第一次一樣（次要關鍵詞、常駐、備選開場白都要撐得住往返）
      const again = tavernToDraft(draftToTavern(d, entries), { language: "zh-Hant", labels: LABELS });
      expect(again.draft.roleName).toBe(d.roleName);
      expect(again.draft.roleWelcome).toBe(d.roleWelcome);
      expect(again.draft.alternates).toEqual(d.alternates);
      expect(again.draft.talkExample).toEqual(d.talkExample);
      expect(again.draft.roleTag).toEqual(d.roleTag);
      expect((again.worldbook?.entries ?? []).map((e) => [e.keywords, e.secondaryKeywords, e.isConstant, e.isEnabled, e.content])).toEqual(
        entries.map((e) => [e.keywords, e.secondaryKeywords, e.isConstant, e.isEnabled, e.content]),
      );
    });
  }
});
