import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routePatterns, matchRoute, spotlightKeys, validateEntry, loadEntries } from "./entries.mjs";

const ROUTER = `
const pages: RouteRecordRaw[] = [
  { path: "", component: BoardPage },
  { path: "search", component: () => import("./pages/SearchPage.vue") },
  { path: "cards/:id", component: () => import("./pages/CardPage.vue") },
  { path: "me/notifications", component: () => import("./pages/NotificationsPage.vue"), meta: { auth: true } },
  { path: "updates", component: () => import("./pages/UpdatesPage.vue") },
  { path: ":pathMatch(.*)*", component: () => import("./pages/NotFoundPage.vue") },
];
const playPages: RouteRecordRaw[] = [
  { path: "/:roleId([^/]+)", component: () => import("./pages/PlayPage.vue") },
];
`;
const SPOTLIGHTS = `export const SPOTLIGHT_KEYS = [\n  "header.bell",\n  "menu.updates",\n] as const;`;
const ctx = { routes: routePatterns(ROUTER), spotlights: spotlightKeys(SPOTLIGHTS) };

const five = (s) => ({ "zh-Hant": s.zh, "zh-Hans": s.hans ?? s.zh, en: s.en, ja: s.ja, ko: s.ko });
const good = () => ({
  tier: "feature",
  try: "/me/notifications",
  spotlight: ["header.bell"],
  title: five({ zh: "通知鈴鐺會告訴你誰回覆了你。", hans: "通知铃铛会告诉你谁回复了你。", en: "The bell now tells you who replied to you.", ja: "ベルの通知で返信をくれた人がわかります。", ko: "종 알림으로 누가 답글을 달았는지 알 수 있습니다." }),
});

test("router patterns come from the site pages list only, without the catch-all", () => {
  assert.deepEqual(ctx.routes, ["", "search", "cards/:id", "me/notifications", "updates"]);
  assert.ok(matchRoute("/", ctx.routes));
  assert.ok(matchRoute("/cards/123", ctx.routes));
  assert.ok(matchRoute("/me/notifications#push", ctx.routes));
  assert.ok(matchRoute("/search?q=x", ctx.routes));
  assert.ok(!matchRoute("/nowhere", ctx.routes));
  assert.ok(!matchRoute("/cards", ctx.routes));
});

test("spotlight keys are read from the shared registry", () => {
  assert.deepEqual([...ctx.spotlights], ["header.bell", "menu.updates"]);
});

test("a well-formed entry has no errors", () => {
  assert.deepEqual(validateEntry("2026-10-04-notifications", good(), ctx), []);
});

test("ids follow the dated slug shape", () => {
  assert.match(validateEntry("notifications", good(), ctx).join(), /id/);
  assert.match(validateEntry("2026-10-04-Notifications", good(), ctx).join(), /id/);
  assert.match(validateEntry("2026-10-04-" + "a".repeat(60), good(), ctx).join(), /id/);
});

test("every locale is required, single-line and trimmed", () => {
  const missing = good(); delete missing.title.ko;
  assert.match(validateEntry("2026-10-04-a", missing, ctx).join(), /title\.ko/);
  const multi = good(); multi.title.en = "One.\nTwo.";
  assert.match(validateEntry("2026-10-04-a", multi, ctx).join(), /title\.en/);
  const padded = good(); padded.title.ja = " ベル。";
  assert.match(validateEntry("2026-10-04-a", padded, ctx).join(), /title\.ja/);
});

test("titles and bodies are one sentence", () => {
  const two = good(); two.title["zh-Hant"] = "通知上線了。誰回覆你都看得到。";
  assert.match(validateEntry("2026-10-04-a", two, ctx).join(), /one sentence/);
  const twoEn = good(); twoEn.title.en = "Notifications are here. See who replied.";
  assert.match(validateEntry("2026-10-04-a", twoEn, ctx).join(), /one sentence/);
  const version = good(); version.title.en = "The CLI v0.2.0 signs you in with a code.";
  assert.deepEqual(validateEntry("2026-10-04-a", version, ctx), []);
  const body = good(); body.body = five({ zh: "預設開啟。可以關掉。", en: "On by default.", ja: "最初からオンです。", ko: "기본으로 켜져 있습니다." });
  assert.match(validateEntry("2026-10-04-a", body, ctx).join(), /body\.zh-Hant.*one sentence/);
});

test("length budgets differ per language", () => {
  const long = good(); long.title["zh-Hant"] = "通".repeat(41);
  assert.match(validateEntry("2026-10-04-a", long, ctx).join(), /title\.zh-Hant.*40/);
  const okKo = good(); okKo.title.ko = "가".repeat(60);
  assert.deepEqual(validateEntry("2026-10-04-a", okKo, ctx), []);
  const longBody = good(); longBody.body = five({ zh: "通".repeat(81), en: "a", ja: "あ", ko: "가" });
  assert.match(validateEntry("2026-10-04-a", longBody, ctx).join(), /body\.zh-Hant.*80/);
});

test("dashes, exclamation marks and internal words are rejected", () => {
  for (const [locale, text] of [["zh-Hant", "通知上線——快來看。"], ["en", "Notifications are here!"], ["zh-Hant", "通知上線了！"], ["en", "The cache is faster now."], ["zh-Hant", "後端改好了。"], ["en", "We changed the backend."]]) {
    const e = good(); e.title[locale] = text;
    assert.notDeepEqual(validateEntry("2026-10-04-a", e, ctx), [], text);
  }
  const fine = good(); fine.title.en = "Card imports read JSON and PNG files, and the API docs list every field.";
  assert.deepEqual(validateEntry("2026-10-04-a", fine, ctx), []);
});

test("tier, try and spotlight are checked", () => {
  const tier = good(); tier.tier = "major";
  assert.match(validateEntry("2026-10-04-a", tier, ctx).join(), /tier/);
  const noTry = good(); delete noTry.try;
  assert.match(validateEntry("2026-10-04-a", noTry, ctx).join(), /try/);
  const fix = good(); fix.tier = "fix"; delete fix.try; delete fix.spotlight;
  assert.deepEqual(validateEntry("2026-10-04-a", fix, ctx), []);
  const prefixed = good(); prefixed.try = "/en/me/notifications";
  assert.match(validateEntry("2026-10-04-a", prefixed, ctx).join(), /try/);
  const unknown = good(); unknown.try = "/nowhere";
  assert.match(validateEntry("2026-10-04-a", unknown, ctx).join(), /try/);
  const external = good(); external.try = "https://example.com/";
  assert.match(validateEntry("2026-10-04-a", external, ctx).join(), /try/);
  const spot = good(); spot.spotlight = ["nav.nowhere"];
  assert.match(validateEntry("2026-10-04-a", spot, ctx).join(), /spotlight/);
  const aud = good(); aud.audience = "admins";
  assert.match(validateEntry("2026-10-04-a", aud, ctx).join(), /audience/);
});

test("optional fields keep their shapes", () => {
  const e = good();
  Object.assign(e, { audience: "authors", reports: ["hk:0123456789abcdef01234567"], announce: 2, draft: true, live: "2026-10-01" });
  assert.deepEqual(validateEntry("2026-10-04-a", e, ctx), []);
  for (const [k, v] of [["reports", ["1234"]], ["announce", 0], ["announce", 1.5], ["draft", "yes"], ["live", "2026-13-01"], ["live", "yesterday"], ["extra", 1]]) {
    const bad = good(); bad[k] = v;
    assert.match(validateEntry("2026-10-04-a", bad, ctx).join(), new RegExp(k), `${k}=${JSON.stringify(v)}`);
  }
});

test("loading a directory collects entries sorted by id and reports bad files by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "updates-"));
  writeFileSync(join(dir, "2026-10-04-b.json"), JSON.stringify(good()));
  writeFileSync(join(dir, "2026-10-03-a.json"), JSON.stringify({ ...good(), tier: "fix" }));
  writeFileSync(join(dir, "README.md"), "# guide");
  mkdirSync(join(dir, "nested"));
  const ok = loadEntries(dir, ctx);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.entries.map((e) => e.id), ["2026-10-03-a", "2026-10-04-b"]);
  assert.equal(ok.entries[1].announce, 1);
  assert.equal(ok.entries[1].audience, "everyone");
  writeFileSync(join(dir, "2026-10-05-broken.json"), "{");
  writeFileSync(join(dir, "notes.txt"), "x");
  const bad = loadEntries(dir, ctx);
  assert.match(bad.errors.join("\n"), /2026-10-05-broken\.json/);
  assert.match(bad.errors.join("\n"), /notes\.txt/);
});

test("the bundle keeps a year of entries and its build id follows the content", async () => {
  const { buildModule } = await import("./build.mjs");
  const entry = (id, live = null) => ({ id, tier: "fix", audience: "everyone", try: null, spotlight: [], reports: [], announce: 1, draft: false, live, title: {}, body: null });
  const a = buildModule([entry("2024-01-01-old"), entry("2026-10-04-a"), entry("2026-10-05-b", "2025-01-01")], "2026-10-05");
  assert.equal(a.count, 2);
  assert.doesNotMatch(a.source, /2024-01-01-old/);
  assert.match(a.source, /2026-10-04-a/);
  const b = buildModule([entry("2026-10-04-a")], "2026-10-05");
  const c = buildModule([entry("2026-10-04-a")], "2026-10-06");
  const build = (s) => s.match(/UPDATES_BUILD = "([0-9a-f]+)"/)[1];
  assert.equal(build(b.source), build(c.source));
  assert.notEqual(build(a.source), build(b.source));
});
