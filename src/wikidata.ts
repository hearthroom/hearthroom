import { HttpError } from "./types";
import { searchForm } from "./search-text";

/**
 * 原作的來源：Wikidata。每部作品一個固定編號（Q 開頭），底下有各語言的正式名、別名與一句說明，
 * 動畫、遊戲、漫畫、小說、劇都有，社群自己在更新——站方不用維護目錄，港澳台與大陸譯名的對應它已經有。
 * 這裡只做兩件事：按字找候選（給作者點）、按編號取整筆（選定後存進本站，之後不再依賴對方）。
 * 呼叫透過這個物件轉發，測試整包換掉。
 */
export interface FandomCandidate { id: string; label: string; description: string }
export interface FandomEntity {
  qid: string;
  /** {語言: 正式名}，語言鍵是 Wikidata 的（zh-hant、zh-tw、zh-hk、zh-hans、zh-cn、zh、ja、en、ko） */
  labels: Record<string, string>;
  aliases: Record<string, string[]>;
  descriptions: Record<string, string>;
}

const API = "https://www.wikidata.org/w/api.php";
const UA = "Hearthroom/1.0 (https://hearthroom.club; community role-card board)";
export const ENTITY_LANGUAGES = ["zh", "zh-hans", "zh-hant", "zh-tw", "zh-hk", "zh-cn", "ja", "en", "ko"];
/**
 * 候選搜尋要問哪幾組（字, 語言）。Wikidata 的搜尋只比對該語言的名字與別名，不做繁簡轉換：
 * 「星鐵」在 zh-tw 找不到（那邊只有「星穹鐵道」），「星铁」在 zh 才有。所以繁體原文問 zh-tw，
 * 轉成簡體再問 zh，日文、英文照原文問；有韓文字才問 ko。同一組字與語言只問一次。
 */
export function searchPlan(q: string): { text: string; language: string }[] {
  const simplified = searchForm(q);
  const plan = [
    { text: q, language: "zh-tw" },
    { text: simplified || q, language: "zh" },
    { text: q, language: "ja" },
    { text: q, language: "en" },
    ...(/[\p{Script=Hangul}]/u.test(q) ? [{ text: q, language: "ko" }] : []),
  ];
  const seen = new Set<string>();
  return plan.filter((p) => { const k = `${p.language}\n${p.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
export const QID = /^Q[1-9]\d{0,11}$/;

async function call(params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `${API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new HttpError(502, "fandom_lookup_failed");
  return (await res.json()) as Record<string, unknown>;
}

export const wikidata = {
  /** 按字找候選：幾種語言同時搜，同一個編號只留第一次出現的那筆（名字與說明就用那個語言的）。 */
  async search(q: string, limit = 8): Promise<FandomCandidate[]> {
    const results = await Promise.all(
      searchPlan(q).map(({ text, language }) =>
        call({ action: "wbsearchentities", search: text, language, uselang: language, type: "item", limit: String(limit) })
          .then((body) => (body.search as { id: string; label?: string; description?: string }[] | undefined) ?? [])
          .catch(() => []),
      ),
    );
    const seen = new Map<string, FandomCandidate>();
    for (const list of results) for (const hit of list) if (!seen.has(hit.id)) seen.set(hit.id, { id: hit.id, label: hit.label ?? hit.id, description: hit.description ?? "" });
    return [...seen.values()].slice(0, limit);
  },

  /** 按編號取整筆。沒有這個編號就是 404。 */
  async entity(qid: string): Promise<FandomEntity> {
    if (!QID.test(qid)) throw new HttpError(400, "fandom_invalid");
    const body = await call({ action: "wbgetentities", ids: qid, props: "labels|aliases|descriptions", languages: ENTITY_LANGUAGES.join("|") });
    const raw = (body.entities as Record<string, Record<string, unknown>> | undefined)?.[qid];
    if (!raw || raw.missing !== undefined) throw new HttpError(404, "fandom_not_found");
    const text = (m: unknown) => Object.fromEntries(Object.entries((m as Record<string, { value: string }>) ?? {}).map(([k, v]) => [k, v.value]));
    const lists = (m: unknown) => Object.fromEntries(Object.entries((m as Record<string, { value: string }[]>) ?? {}).map(([k, v]) => [k, v.map((x) => x.value)]));
    return { qid, labels: text(raw.labels), aliases: lists(raw.aliases), descriptions: text(raw.descriptions) };
  },
};

/** 一筆原作在索引裡的樣子：所有語言的正式名與別名正規化後用空白接起來（查「HSR」「崩铁」「スターレイル」都中）。 */
export function entitySearchText(e: FandomEntity): string {
  return [...new Set([...Object.values(e.labels), ...Object.values(e.aliases).flat()].map(searchForm).filter(Boolean))].join(" ");
}

/** 看的人的語言 → 試哪些 Wikidata 語言鍵。zh 不分繁簡時先繁後簡（站的原文是繁體）。 */
const LABEL_ORDER: Record<string, string[]> = {
  "zh-Hant": ["zh-hant", "zh-tw", "zh-hk", "zh", "zh-hans", "zh-cn", "en", "ja"],
  "zh-Hans": ["zh-hans", "zh-cn", "zh", "zh-hant", "zh-tw", "zh-hk", "en", "ja"],
  zh: ["zh-hant", "zh-tw", "zh-hk", "zh", "zh-hans", "zh-cn", "en", "ja"],
  ja: ["ja", "en", "zh-hant", "zh"],
  ko: ["ko", "en", "ja", "zh-hant", "zh"],
  en: ["en", "ja", "zh-hant", "zh"],
};
export function fandomLabel(labels: Record<string, string>, lang: string): string {
  for (const key of LABEL_ORDER[lang] ?? LABEL_ORDER.en!) if (labels[key]) return labels[key]!;
  return Object.values(labels)[0] ?? "";
}
