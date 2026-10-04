/**
 * 更新說明（updates/*.json）的讀取與驗證。
 *
 * 建置時（build.mjs）與測試共用這一份：任何一條不合格，建置就失敗，說明不會帶著錯字或斷掉的連結上線。
 * 這裡只檢查機器判斷得了的事：格式、五種語言齊不齊、是不是一句話、長度、明顯的內部字眼、
 * 「去試試」連到的頁面存不存在。文案寫得好不好，仍然是寫的人的責任（見 updates/README.md）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const LOCALES = ["zh-Hant", "zh-Hans", "en", "ja", "ko"];
export const TIERS = ["highlight", "feature", "fix"];
export const AUDIENCES = ["everyone", "authors"];
const FIELDS = new Set(["tier", "audience", "try", "spotlight", "reports", "announce", "draft", "live", "title", "body"]);
const ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_MAX = 64;

/** 每種語言一句標題的字數上限；說明是兩倍。中文字、假名、韓文字一個算一個。 */
export const TITLE_BUDGET = { "zh-Hant": 40, "zh-Hans": 40, ja: 50, ko: 60, en: 120 };

/**
 * 使用者看不到、也不需要知道的字。只收「一出現就幾乎一定是在講實作」的那些；
 * API、JSON 這類開發者與作者本來就會看到的字不在這裡。
 */
const INTERNAL_LATIN = ["cache", "commit", "commits", "endpoint", "backend", "frontend", "payload", "schema", "migration", "fallback", "timeout", "D1", "Worker", "KV", "Redis", "MySQL", "SQL", "PR", "repo", "branch", "deploy", "deployed"];
const INTERNAL_CJK = ["快取", "後端", "前端", "后端", "缓存", "欄位", "字段", "部署", "介面呼叫"];
const FORBIDDEN_MARKS = ["—", "――", "！", "!"];

const latinWord = new RegExp(`(?<![A-Za-z0-9])(?:${INTERNAL_LATIN.join("|")})(?![A-Za-z0-9])`, "i");

/** 句尾符號：中日文的句號與問號一律算；英文的句點與問號後面接空白或結尾才算（v0.2.0、e.g 不算）。 */
const SENTENCE_END = /[。．？]|[.?](?=\s|$)/g;

/** web/src/router.ts 裡站台頁面（pages 陣列）的路徑樣式，不含最後的萬用 404。 */
export function routePatterns(routerSource) {
  const start = routerSource.indexOf("const pages");
  if (start < 0) throw new Error("router: pages list not found");
  const end = routerSource.indexOf("\n];", start);
  const block = routerSource.slice(start, end < 0 ? undefined : end);
  return [...block.matchAll(/\bpath:\s*"([^"]*)"/g)].map((m) => m[1]).filter((p) => !p.startsWith(":pathMatch"));
}

/** 站內路徑（可帶 ?query 與 #hash）對不對得上某個路由。 */
export function matchRoute(path, patterns) {
  if (typeof path !== "string" || !path.startsWith("/")) return false;
  const bare = path.replace(/[?#].*$/, "").replace(/^\/+|\/+$/g, "");
  const parts = bare === "" ? [] : bare.split("/");
  return patterns.some((pattern) => {
    const want = pattern === "" ? [] : pattern.split("/");
    if (want.length !== parts.length) return false;
    return want.every((seg, i) => (seg.startsWith(":") ? parts[i] !== "" : seg === parts[i]));
  });
}

/** shared/update-spotlights.ts 裡登記的鍵。 */
export function spotlightKeys(source) {
  const start = source.indexOf("SPOTLIGHT_KEYS");
  const end = source.indexOf("]", start);
  if (start < 0 || end < 0) throw new Error("spotlights: SPOTLIGHT_KEYS not found");
  return new Set([...source.slice(start, end).matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

const LOCALE_PREFIX = /^\/(?:zh-Hans|zh-Hant|en|ja|ko)(?:\/|$)/;

function checkText(errors, field, value, budget) {
  if (typeof value !== "string" || !value) return errors.push(`${field}: required`);
  if (value !== value.trim()) errors.push(`${field}: leading or trailing whitespace`);
  if (/[\r\n]/.test(value)) errors.push(`${field}: must be a single line`);
  const ends = [...value.matchAll(SENTENCE_END)];
  if (ends.length > 1 || (ends.length === 1 && ends[0].index + ends[0][0].length !== value.length))
    errors.push(`${field}: must be one sentence`);
  const length = Array.from(value).length;
  if (length > budget) errors.push(`${field}: ${length} characters, limit ${budget}`);
  for (const mark of FORBIDDEN_MARKS) if (value.includes(mark)) errors.push(`${field}: contains "${mark}"`);
  const word = value.match(latinWord);
  if (word) errors.push(`${field}: internal term "${word[0]}"`);
  for (const term of INTERNAL_CJK) if (value.includes(term)) errors.push(`${field}: internal term "${term}"`);
}

function checkLocalized(errors, name, value, scale) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return errors.push(`${name}: must be an object with ${LOCALES.join(", ")}`);
  for (const key of Object.keys(value)) if (!LOCALES.includes(key)) errors.push(`${name}.${key}: unknown locale`);
  for (const locale of LOCALES) checkText(errors, `${name}.${locale}`, value[locale], TITLE_BUDGET[locale] * scale);
}

function validDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 回傳錯誤訊息陣列；空陣列表示合格。 */
export function validateEntry(id, entry, ctx) {
  const errors = [];
  if (!ID.test(id) || id.length > ID_MAX || !validDate(id.slice(0, 10))) errors.push(`id "${id}": use YYYY-MM-DD-slug in lowercase, at most ${ID_MAX} characters`);
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [...errors, "entry: must be a JSON object"];
  for (const key of Object.keys(entry)) if (!FIELDS.has(key)) errors.push(`${key}: unknown field`);
  if (!TIERS.includes(entry.tier)) errors.push(`tier: one of ${TIERS.join(", ")}`);
  if (entry.audience !== undefined && !AUDIENCES.includes(entry.audience)) errors.push(`audience: one of ${AUDIENCES.join(", ")}`);
  if (entry.try === undefined) {
    if (entry.tier !== "fix") errors.push("try: required for highlight and feature entries");
  } else if (typeof entry.try !== "string" || !entry.try.startsWith("/") || entry.try.startsWith("//") || LOCALE_PREFIX.test(entry.try) || !matchRoute(entry.try, ctx.routes)) {
    errors.push(`try: "${entry.try}" must be a site path without a language prefix that matches a page in web/src/router.ts`);
  }
  if (entry.spotlight !== undefined) {
    if (!Array.isArray(entry.spotlight) || !entry.spotlight.length) errors.push("spotlight: a non-empty list of keys");
    else for (const key of entry.spotlight) if (!ctx.spotlights.has(key)) errors.push(`spotlight: "${key}" is not in shared/update-spotlights.ts`);
  }
  if (entry.reports !== undefined && (!Array.isArray(entry.reports) || !entry.reports.length || entry.reports.some((r) => typeof r !== "string" || !/^hk:[0-9a-f]{24}$/.test(r))))
    errors.push("reports: a list of hk:<24 hex case id>");
  if (entry.announce !== undefined && (!Number.isInteger(entry.announce) || entry.announce < 1)) errors.push("announce: a positive integer");
  if (entry.draft !== undefined && typeof entry.draft !== "boolean") errors.push("draft: true or false");
  if (entry.live !== undefined && !validDate(entry.live)) errors.push("live: a YYYY-MM-DD date");
  checkLocalized(errors, "title", entry.title, 1);
  if (entry.body !== undefined) checkLocalized(errors, "body", entry.body, 2);
  return errors;
}

/** 讀整個目錄。README 之外的非 JSON 檔也算錯：放錯地方的說明不會上線，寫的人要知道。 */
export function loadEntries(dir, ctx) {
  const entries = [];
  const errors = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === "README.md" || statSync(join(dir, name)).isDirectory()) continue;
    if (!name.endsWith(".json")) {
      errors.push(`${name}: only YYYY-MM-DD-slug.json files belong in updates/`);
      continue;
    }
    const id = name.slice(0, -5);
    let raw;
    try {
      raw = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (e) {
      errors.push(`${name}: invalid JSON (${e.message})`);
      continue;
    }
    const problems = validateEntry(id, raw, ctx);
    if (problems.length) {
      errors.push(...problems.map((p) => `${name}: ${p}`));
      continue;
    }
    entries.push({
      id,
      tier: raw.tier,
      audience: raw.audience ?? "everyone",
      try: raw.try ?? null,
      spotlight: raw.spotlight ?? [],
      reports: (raw.reports ?? []).map((r) => r.slice(3)),
      announce: raw.announce ?? 1,
      draft: raw.draft ?? false,
      live: raw.live ?? null,
      title: raw.title,
      body: raw.body ?? null,
    });
  }
  return { entries, errors };
}

/** 從倉庫根目錄讀出驗證需要的兩份清單。 */
export function repoContext(root) {
  return {
    routes: routePatterns(readFileSync(join(root, "web/src/router.ts"), "utf8")),
    spotlights: spotlightKeys(readFileSync(join(root, "shared/update-spotlights.ts"), "utf8")),
  };
}
