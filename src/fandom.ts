import { searchForm } from "./search-text";
import { HttpError } from "./types";
import { entitySearchText, fandomLabel, QID, wikidata, type FandomEntity } from "./wikidata";

/** 原作名稱的長度上限：作品名很少超過二十幾個字，六十夠放副標題。 */
export const FANDOM_MAX = 60;

/**
 * 作者送審或審核人修改時給的原作名稱：去頭尾空白、連續空白併成一個；太長、含網址、含換行的不收。
 * 不是字串（沒給）回 undefined，呼叫端當「不改」；空字串回 ""，當「沒有原作」。
 */
export function normalizeFandom(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  if (/[\r\n]/.test(raw) || /:\/\//.test(raw)) throw new HttpError(400, "fandom_invalid");
  const text = raw.replace(/\s+/g, " ").trim();
  if ([...text].length > FANDOM_MAX) throw new HttpError(400, "fandom_invalid");
  return text;
}

/** 自由文字的篩選鍵：跟搜尋同一個正規化，繁簡、大小寫、標點不同的寫法是同一個原作。 */
export const fandomKey = (fandom: string): string => searchForm(fandom);

/** 編號型的鍵 */
export const entityKey = (qid: string): string => `wd:${qid}`;

/** 一張卡的原作，解析好的樣子：要寫進 public_role、cards、moderation_state 的那幾個值。 */
export interface ResolvedFandom {
  /** 顯示用的原文：編號型是繁中正式名（沒有就其他語言），自由文字就是作者打的 */
  fandom: string;
  qid: string | null;
  key: string;
  /** 進名稱欄索引的字：編號型是所有語言的名字與別名 */
  search: string;
}

/**
 * 把送進來的「編號」或「文字」解析成要存的值。編號優先：有編號就去 Wikidata 取整筆、存進本站副本；
 * 只有文字就當自由文字。兩個都沒有＝沒有原作。
 */
export async function resolveFandom(db: D1Database, input: { fandom?: unknown; fandomId?: unknown }): Promise<ResolvedFandom | undefined> {
  const text = normalizeFandom(input.fandom);
  const id = typeof input.fandomId === "string" ? input.fandomId.trim() : undefined;
  if (id === undefined && text === undefined) return undefined;
  if (id) {
    if (!QID.test(id)) throw new HttpError(400, "fandom_invalid");
    const entity = await rememberEntity(db, id);
    return { fandom: fandomLabel(entity.labels, "zh-Hant") || text || id, qid: id, key: entityKey(id), search: entitySearchText(entity) };
  }
  const fandom = text ?? "";
  return { fandom, qid: null, key: fandom ? fandomKey(fandom) : "", search: fandom ? searchForm(fandom) : "" };
}

/** 本站已經有副本就直接用，沒有才去抓。副本不自動更新（作品名不太會變）。 */
export async function rememberEntity(db: D1Database, qid: string): Promise<FandomEntity> {
  const row = await db.prepare("SELECT labels, aliases, descriptions FROM fandom_entities WHERE qid=?").bind(qid).first<{ labels: string; aliases: string; descriptions: string }>();
  if (row) return { qid, labels: JSON.parse(row.labels), aliases: JSON.parse(row.aliases), descriptions: JSON.parse(row.descriptions) };
  const entity = await wikidata.entity(qid);
  // OR IGNORE 而不是 REPLACE：cards.fandom_qid 有外鍵指著這一列，REPLACE 會先刪再插，被引用時就撞約束
  await db.prepare("INSERT OR IGNORE INTO fandom_entities(qid,labels,aliases,descriptions,search_text,fetched_at) VALUES (?,?,?,?,?,?)")
    .bind(qid, JSON.stringify(entity.labels), JSON.stringify(entity.aliases), JSON.stringify(entity.descriptions), entitySearchText(entity), Date.now()).run();
  return entity;
}
