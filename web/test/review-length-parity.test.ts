/**
 * 編輯器的送審字數＝送審檢查的字數。
 *
 * 編輯器把草稿（角色設定＋卡綁的那本世界書條目）交給 draftReviewLength；送審時 Worker 把讀回的設定
 * 投影成 { document, worldbooks } 再交給 reviewLength。兩邊必須逐字相同，作者才不會在編輯器看到
 * 一個數字、送審時被告知另一個數字。這裡在瀏覽器環境（happy-dom）裡逐類對拍。
 */
import { expect, it } from "vitest";
import { draftReviewLength } from "../src/lib/draft-review-length";
import { reviewLength } from "../../src/review-length";
import type { WorldbookEntryDraft } from "../src/lib/role-draft";

const entry = (content: string, extra: Partial<WorldbookEntryDraft> = {}): WorldbookEntryDraft => ({
  name: "", content, keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: true, semanticRecall: true, category: "custom", ...extra,
} as WorldbookEntryDraft);

/** Worker 送審投影的形狀（review-snapshot projectForReview）。 */
const asSubmitted = (persona: string, entries: WorldbookEntryDraft[]) => reviewLength({
  document: { roleDetailDesc: persona },
  worldbooks: [{ entries: entries.map((e, i) => ({ entryId: String(i), content: e.content, isEnabled: e.isEnabled !== false, isConstant: e.isConstant === true })) }],
});

const CASES: Array<[string, string, number]> = [
  ["標點與空白", "中 文，。！「」…… ABC def 123 １２３\n\t— + - _ ~", 14],
  ["HTML 標籤、屬性、樣式與 script", '<div class="hp" style="color:red">真<b>字</b></div><!-- 註解 --><style>.x{color:red}</style><script>alert("不算")</script>', 2],
  ["模板變數", "{{char}}看著{{user}}，${time}說：好", 4],
  ["emoji", "笑😀 1️⃣ 🇹🇼 👩🏽‍💻 ❤️ 心", 2],
  ["程式碼區塊", "```js\nconst 甲 = 1;\n```\n行內 `a<b>` 結束", 12],
  ["圖片與連結網址", "![圖說](https://img.test/a.png) [連結文字](https://example.test/path)", 4],
  ["未閉合標記後還有合法標記", '<cfg rule=，設定\n背景\n<section>內容</section>', 13],
];

it.each(CASES)("counts %s the same way as the review check", (_name, text, expected) => {
  const editor = draftReviewLength(text, []);
  expect(editor?.persona).toBe(expected);
  expect(editor).toEqual(asSubmitted(text, []));
});

it("adds only enabled always-on entries and matches the submitted total", () => {
  const entries = [
    entry("常駐條目，計入。"),
    entry("停用的常駐條目", { isEnabled: false }),
    entry("非常駐條目", { isConstant: false }),
    entry("<p>常駐 HTML</p> {{user}}"),
  ];
  const editor = draftReviewLength("角色設定", entries);
  expect(editor).toMatchObject({ persona: 4, constantWorldbook: 6 + 6, total: 16, required: 3001, remaining: 2985, eligible: false });
  expect(editor).toEqual(asSubmitted("角色設定", entries));
});

it("reaches eligibility at the same boundary as the review check", () => {
  for (const n of [3000, 3001]) {
    const editor = draftReviewLength("字".repeat(n - 1), [entry("常")]);
    expect(editor).toEqual(asSubmitted("字".repeat(n - 1), [entry("常")]));
    expect(editor?.eligible).toBe(n >= 3001);
  }
});

it("keeps interrupted markup content in both persona and always-on entries", () => {
  const persona='<cfg rule=，\n'+'字'.repeat(2000)+'\n<section>後</section>';
  const entries=[entry('<cfg rule=，\n'+'常'.repeat(1000)+'\n<section>後</section>')];
  const editor=draftReviewLength(persona,entries);
  expect(editor).toMatchObject({persona:2008,constantWorldbook:1008,total:3016,eligible:true,remaining:0});
  expect(editor).toEqual(asSubmitted(persona,entries));
});
