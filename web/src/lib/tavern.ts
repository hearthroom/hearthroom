/**
 * 酒館角色卡（Character Card V2 / V3）與本站草稿之間的雙向轉換。
 *
 * 載體三種都收：
 *   - PNG：資料在 tEXt chunk（`ccv3` 優先於 `chara`，兩者都是 base64 的 JSON）
 *   - JSON：裸卡，或是外面包一層 `{spec, data}`
 *   - CHARX（.charx，V3 的 zip 封裝）：根目錄的 card.json 是卡，`embeded://` 指向包裡的素材；
 *     只取主頭像與主背景，其餘素材（表情差分、音效…）本站沒地方放，進報告。
 *
 * V3 比 V2 多的東西怎麼落：
 *   - nickname、creator、character_version、source、多語言 creator_notes、建立／修改時間
 *     → 草稿的 nickname 與 cardMeta（上游有欄位，匯出時原樣還回去）
 *   - 世界書 use_regex → 關鍵詞包成 `/key/i`，上游本來就認這種寫法
 *   - 世界書修飾詞（@@activate 那些）→ 常駐／停用／補關鍵詞三個有對應，其餘剝掉並進報告；
 *     插入位置、深度、機率這些我們刻意不做（它們會讓每一輪的提示詞不一樣，打爆快取）
 *   - group_only_greetings → 併進備選開場白（本站沒有群聊，但開場白本身還是能用），進報告
 *
 * 兩邊的欄位不是一一對應，這是這個檔案的全部難處。**對不上的欄位一律進報告**，
 * 不靜默丟掉：作者匯入一張卡之後如果不知道次要關鍵詞沒了，他會以為卡壞了。
 *
 * 一個好消息：`{{char}}` / `{{user}}` 兩邊都認，原樣帶過去就會動。
 */

import { isPng, readTextChunk, replaceTextChunks, base64FromUtf8, utf8FromBase64 } from "./png-chunks";
import type { CardMeta, RoleDraft, TalkExampleEntry, WorldbookEntryDraft, WorldbookMatchOptions } from "./role-draft";
import { makeDraft } from "./role-draft";
import { rulesFromTavern, rulesToTavern, type RegexRuleSet } from "./regex-rules";
import { unzipSync } from "fflate";

export interface TavernBookEntry {
  keys?: string[];
  secondary_keys?: string[];
  content?: string;
  name?: string;
  comment?: string;
  enabled?: boolean;
  constant?: boolean;
  insertion_order?: number;
  priority?: number;
  position?: string;
  case_sensitive?: boolean;
  selective?: boolean;
  match_whole_words?: boolean;
  selective_logic?: number;
  /** V3：關鍵詞是正規表示式。 */
  use_regex?: boolean;
}

export interface TavernBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  entries?: TavernBookEntry[];
}

export interface TavernCardData {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  group_only_greetings?: string[];
  character_book?: TavernBook;
  tags?: string[];
  creator?: string;
  character_version?: string;
  nickname?: string;
  /** V3 */
  source?: string[];
  creator_notes_multilingual?: Record<string, string>;
  creation_date?: number;
  modification_date?: number;
  assets?: TavernAsset[];
  extensions?: Record<string, unknown>;
}

export interface TavernAsset {
  type?: string;
  uri?: string;
  name?: string;
  ext?: string;
}

export interface TavernCard {
  spec: string;
  spec_version: string;
  data: TavernCardData;
}

/** 一條「這個欄位沒地方放」的紀錄。i18n key + 參數，翻譯留給畫面。 */
export interface DropNote {
  key: string;
  params?: Record<string, string | number>;
}

export interface ImportResult {
  draft: RoleDraft;
  /** 卡裡帶的世界書。要另外建一本再綁定，所以跟草稿分開。 */
  worldbook: { name: string; description: string; format: "tavern"; entries: WorldbookEntryDraft[] } | null;
  /** 沒能帶過來的東西。畫面必須原樣列給作者看。 */
  dropped: DropNote[];
  /** 卡片自帶的立繪（PNG 匯入時才有），拿去當頭像與背景的預設值。 */
  image: Blob | null;
  /** V3 卡帶的主背景（CHARX 內嵌或 data: URI）。沒有就不給。 */
  background?: Blob | null;
  spec: string;
  /** 酒館卡 extensions.regex_scripts 落成的正則規則。沒有就是 null。 */
  regex: RegexRuleSet | null;
}

/** 本站一張卡最多幾個標籤。多的丟掉並進報告，不靜默截斷。 */
export const TAGS_MAX = 10;
/** 上游一條世界書條目的內容上限（字元）。超過的條目在匯入時拆成幾條，同一組關鍵詞，不丟字。 */
export const ENTRY_CONTENT_MAX = 3000;

/**
 * 把一段太長的內容拆成幾段，儘量在換行處切，每段都在上限內。
 * 拆成幾條同關鍵詞的條目，命中時一起進上下文，跟一條大的效果相同；不拆的話上游直接拒收整批。
 */
export function splitEntryContent(content: string, max = ENTRY_CONTENT_MAX): string[] {
  const chars = [...content];
  if (chars.length <= max) return [content];
  // 留一點餘裕給名字後綴與換行
  const budget = max - 40;
  const out: string[] = [];
  let current = "";
  for (const para of content.split("\n")) {
    let piece = para;
    const candidate = current ? `${current}\n${piece}` : piece;
    if ([...candidate].length <= budget) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    current = "";
    while ([...piece].length > budget) {
      const pieceChars = [...piece];
      out.push(pieceChars.slice(0, budget).join(""));
      piece = pieceChars.slice(budget).join("");
    }
    current = piece;
  }
  if (current) out.push(current);
  return out;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => text(v)).filter(Boolean) : [];

/**
 * 關鍵詞欄位三種寫法都收：陣列（酒館）、JSON 字串 `'["a","b"]'`（MMD 的世界書匯出就是
 * 這樣存的，用戶回報「匯入不帶關鍵詞」的原因）、逗號分隔的純字串（舊工具）。
 */
/** 卡內 book 的條目把酒館專屬欄位放在 extensions 底下。 */
const ext = (row: Record<string, unknown>): Record<string, unknown> =>
  row.extensions && typeof row.extensions === "object" ? (row.extensions as Record<string, unknown>) : {};
const numberOr = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const keyList = (value: unknown): string[] => {
  if (Array.isArray(value)) return list(value);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return list(parsed);
  } catch {
    /* 不是 JSON：當逗號分隔 */
  }
  return value.split(/[,，]/).map((k) => k.trim()).filter(Boolean);
};

/** V2 之前的卡是平的（沒有 data 包一層），還在野外流通，所以兩種都收。 */
function unwrap(raw: unknown): TavernCard {
  if (!raw || typeof raw !== "object") throw new Error("tavern_invalid");
  const obj = raw as Record<string, unknown>;
  if (obj.data && typeof obj.data === "object") {
    return {
      spec: text(obj.spec) || "chara_card_v2",
      spec_version: text(obj.spec_version) || "2.0",
      data: obj.data as TavernCardData,
    };
  }
  if (typeof obj.name === "string" || typeof obj.first_mes === "string") {
    // 野外也有「標了 spec 卻沒包 data」的平鋪 V3 卡：欄位照 V1 的位置讀，spec 照它自己說的報
    return { spec: text(obj.spec) || "chara_card_v1", spec_version: text(obj.spec_version) || "1.0", data: obj as TavernCardData };
  }
  throw new Error("tavern_invalid");
}

export interface ParsedTavernFile {
  card: TavernCard;
  image: Blob | null;
  /** V3 主背景（CHARX 內嵌或 data: URI）。 */
  background: Blob | null;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const isZip = (bytes: Uint8Array): boolean => ZIP_MAGIC.every((b, i) => bytes[i] === b);

const IMAGE_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif" };
const mimeForExt = (ext: string): string => IMAGE_MIME[ext.toLowerCase().replace(/^\./, "")] ?? "application/octet-stream";

/** V3 的 assets 裡挑「某一類的主要那一個」：name 是 main 的優先，沒有就取第一個。 */
export function mainAsset(assets: TavernAsset[] | undefined, type: string): TavernAsset | null {
  const ofType = (assets ?? []).filter((a) => a && a.type === type && text(a.uri));
  return ofType.find((a) => text(a.name).toLowerCase() === "main") ?? ofType[0] ?? null;
}

/** data: URI → Blob；不是 data: 或解不開就 null。只認圖片。 */
export function blobFromDataUri(uri: string): Blob | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(uri.trim());
  if (!match) return null;
  try {
    const bin = atob(match[2].replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return new Blob([out], { type: match[1].toLowerCase() });
  } catch {
    return null;
  }
}

/**
 * 從 CHARX 讀卡。card.json 在根目錄；素材用 `embeded://路徑`（規格就是這個拼法）指向包裡的檔案。
 * 只取 icon／background 的主要那一個；沒有 icon 但包裡有圖也不猜，頭像讓作者自己選。
 */
function parseCharx(bytes: Uint8Array): ParsedTavernFile {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("tavern_invalid");
  }
  const cardFile = files["card.json"];
  if (!cardFile) throw new Error("tavern_no_metadata");
  const card = unwrap(JSON.parse(new TextDecoder().decode(cardFile)));
  const embedded = (asset: TavernAsset | null): Blob | null => {
    const uri = text(asset?.uri);
    if (!uri) return null;
    if (uri.startsWith("data:")) return blobFromDataUri(uri);
    const match = /^embeded:\/\/(.+)$/.exec(uri);
    if (!match) return null;
    const data = files[match[1]];
    // slice() 拿到一塊型別上確定是 ArrayBuffer 的緩衝區（zip 解出來的視圖可能共用底層緩衝）
    return data ? new Blob([data.slice().buffer], { type: mimeForExt(text(asset?.ext) || match[1].split(".").pop() || "") }) : null;
  };
  return {
    card,
    image: embedded(mainAsset(card.data?.assets, "icon")),
    background: embedded(mainAsset(card.data?.assets, "background")),
  };
}

/** 從檔案讀出一張卡。副檔名不可信，看實際位元組。 */
export async function parseTavernFile(file: File): Promise<ParsedTavernFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPng(bytes)) {
    // V3 優先：同一張圖常常兩個 chunk 都在，而 ccv3 才是新的那份。
    const raw = readTextChunk(bytes, "ccv3") ?? readTextChunk(bytes, "chara");
    if (!raw) throw new Error("tavern_no_metadata");
    const card = unwrap(JSON.parse(utf8FromBase64(raw)));
    // PNG 卡的頭像就是這張圖；V3 的 assets 若另外帶了 data: 的背景也收
    const bg = mainAsset(card.data?.assets, "background");
    return { card, image: new Blob([bytes], { type: "image/png" }), background: bg ? blobFromDataUri(text(bg.uri)) : null };
  }
  if (isZip(bytes)) return parseCharx(bytes);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("tavern_invalid");
  }
  const card = unwrap(raw);
  const icon = mainAsset(card.data?.assets, "icon");
  const bg = mainAsset(card.data?.assets, "background");
  return { card, image: icon ? blobFromDataUri(text(icon.uri)) : null, background: bg ? blobFromDataUri(text(bg.uri)) : null };
}

/**
 * `mes_example` 拆成一問一答。
 *
 * 酒館的格式是 `<START>` 分段、每行 `{{user}}:` 或 `{{char}}:` 開頭。續行屬於上一句。
 * 拆不出任何一輪時回空陣列，讓呼叫端把原文整段丟進報告——那多半是作者自己寫的自由格式，
 * 硬拆只會產生一堆語意錯誤的對話示例。
 */
export function parseMesExample(raw: string): TalkExampleEntry[] {
  const entries: TalkExampleEntry[] = [];
  let current: TalkExampleEntry | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^<\s*START\s*>$/i.test(trimmed)) {
      current = null;
      continue;
    }
    const match = /^\{\{(user|char)\}\}\s*:\s*(.*)$/i.exec(trimmed);
    if (match) {
      current = { roleType: match[1].toLowerCase() === "user" ? "user" : "ai", content: match[2].trim() };
      entries.push(current);
      continue;
    }
    if (current) current.content = `${current.content}\n${trimmed}`.trim();
  }
  return entries.filter((e) => e.content);
}

/** 反向：本站的對話示例寫回酒館格式。 */
export function formatMesExample(entries: TalkExampleEntry[]): string {
  if (!entries.length) return "";
  return `<START>\n${entries.map((e) => `{{${e.roleType === "user" ? "user" : "char"}}}: ${e.content}`).join("\n")}`;
}

/**
 * description / personality / scenario 三段拼成角色設定。
 *
 * 本站沒有這三個分開的欄位，但把它們直接連起來會讓 AI 讀不出邊界，所以加小標題。
 * 只有一段時不加標題——那是最常見的情況，加了反而多一行雜訊。
 */
function joinPersona(data: TavernCardData, labels: { personality: string; scenario: string }): string {
  const parts: string[] = [];
  const description = text(data.description);
  const personality = text(data.personality);
  const scenario = text(data.scenario);
  if (description) parts.push(description);
  // MMD 匯出的卡把同一段人設逐字寫進 description 與 personality（2026-09-11 兩張用戶的卡都是）；
  // 照三段拼會讓一萬字的人設變兩萬，直接撞上限——用戶說「字數全被算成角色字數」。
  if (personality && personality !== description) parts.push(`${labels.personality}\n${personality}`);
  if (scenario && scenario !== description && scenario !== personality) parts.push(`${labels.scenario}\n${scenario}`);
  return parts.join("\n\n");
}

/**
 * V3 的修飾詞：條目內容開頭一行一個 `@@name value`，`@@@name` 是「上一個認不得時的備胎」。
 * 讀法照 SillyTavern：從第一行起連續的 `@@` 行都是修飾詞，遇到第一行正文就停；
 * 備胎行只在前一個修飾詞認不得時才算數。
 *
 * 有落點的三個：activate（常駐）、dont_activate（停用）、additional_keys（補進關鍵詞）。
 * 其餘（depth、position、role、probability、sticky、exclude_keys…）剝掉並回報——它們控制的是
 * 「放在提示詞的哪裡、多常放」，本站刻意不做這一層。
 */
export const KNOWN_DECORATORS = ["activate", "dont_activate", "additional_keys"] as const;

export interface ParsedDecorators {
  content: string;
  activate: boolean;
  dontActivate: boolean;
  additionalKeys: string[];
  /** 剝掉但沒對應的修飾詞名字（去重）。 */
  unsupported: string[];
}

export function parseDecorators(raw: string): ParsedDecorators {
  const out: ParsedDecorators = { content: raw, activate: false, dontActivate: false, additionalKeys: [], unsupported: [] };
  if (!raw.startsWith("@@")) return out;
  const lines = raw.split("\n");
  let fallbacked = false;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("@@")) break;
    const isFallback = line.startsWith("@@@");
    if (isFallback && !fallbacked) continue;
    const body = (isFallback ? line.slice(3) : line.slice(2)).trim();
    const match = /^([a-z_]+)\s*(.*)$/i.exec(body);
    const name = match ? match[1].toLowerCase() : "";
    const value = match ? match[2].trim() : "";
    if (name === "activate") out.activate = true;
    else if (name === "dont_activate") out.dontActivate = true;
    else if (name === "additional_keys") out.additionalKeys.push(...value.split(",").map((k) => k.trim()).filter(Boolean));
    else {
      // 認不得：下一行若是 @@@ 備胎就讓它接手；備胎也認不得就一起進報告
      if (name && !out.unsupported.includes(name)) out.unsupported.push(name);
      fallbacked = true;
      continue;
    }
    fallbacked = false;
  }
  out.content = lines.slice(i).join("\n");
  return out;
}

/**
 * V3 的 use_regex：整條的關鍵詞都是正規表示式。上游本來就認 `/pattern/flags` 這種寫法
 * （不分大小寫加 i），所以包起來就好；作者已經寫成 `/…/` 的不重包。
 */
export function regexKey(key: string, caseSensitive: boolean): string {
  if (/^\/.+\/[a-z]*$/.test(key)) return key;
  return `/${key}/${caseSensitive ? "" : "i"}`;
}

const entryKeywords = (entry: TavernBookEntry, raw: string[]): string[] =>
  entry.use_regex === true ? raw.map((k) => regexKey(k, entry.case_sensitive === true)) : raw;

/** 酒館的條目 → 本站的條目。 */
export function bookEntriesToDrafts(entries: TavernBookEntry[]): WorldbookEntryDraft[] {
  const drafts: WorldbookEntryDraft[] = [];
  entries.forEach((entry, index) => {
    const decorated = parseDecorators(text(entry.content));
    const content = decorated.content.trim();
    if (!content) return;
    // 條目要有名字才找得回來。酒館這兩個欄位常常都空，那就用第一個關鍵詞。
    const baseName = text(entry.name) || text(entry.comment) || keyList(entry.keys)[0] || `#${index + 1}`;
    const keywords = entryKeywords(entry, [...keyList(entry.keys), ...decorated.additionalKeys]);
    const parts = splitEntryContent(content);
    parts.forEach((part, i) => {
      const name = parts.length === 1 ? baseName.slice(0, 20) : `${[...baseName].slice(0, 14).join("")} (${i + 1}/${parts.length})`;
      drafts.push({
        name,
        content: part,
        keywords,
        secondaryKeywords: entryKeywords(entry, keyList(entry.secondary_keys)),
        isEnabled: entry.enabled !== false && !decorated.dontActivate,
        isConstant: entry.constant === true || decorated.activate,
        matchOptions: entryMatchOptions(entry),
      });
    });
  });
  return drafts;
}

/**
 * 酒館的匹配選項。上游會照這些規則做字面命中；缺省照酒館全域預設：不分大小寫、不整詞、
 * 次要關鍵詞「任一出現」。
 */
export function entryMatchOptions(entry: TavernBookEntry): WorldbookMatchOptions {
  const logic = Number(entry.selective_logic ?? 0);
  return {
    caseSensitive: entry.case_sensitive === true,
    matchWholeWords: entry.match_whole_words === true,
    selectiveLogic: Number.isInteger(logic) && logic >= 0 && logic <= 3 ? logic : 0,
  };
}

/** 匯入報告用：有幾條因為太長被拆開。 */
export function countSplitEntries(entries: TavernBookEntry[]): number {
  return entries.filter((entry) => [...parseDecorators(text(entry.content)).content.trim()].length > ENTRY_CONTENT_MAX).length;
}

/**
 * 酒館「世界書檔」（World Info，匯出成獨立的 JSON）→ 卡片規格裡的 character_book 形狀。
 *
 * 兩種格式的欄位名不一樣：世界書檔用 `key` / `keysecondary` / `disable`，卡裡的 book 用
 * `keys` / `secondary_keys` / `enabled`；entries 在世界書檔裡是以 uid 為鍵的物件，不是陣列。
 * 統一成卡片那一種，後面的轉換與報告就只有一套。
 */
export function worldInfoToBook(raw: unknown): TavernBook | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  // 傳進來的是一張卡：直接拿它的世界書
  if (obj.data && typeof obj.data === "object") {
    const book = (obj.data as TavernCardData).character_book;
    return book && Array.isArray(book.entries) ? book : null;
  }
  const entries = obj.entries;
  if (!entries || typeof entries !== "object") return null;
  const rows = (Array.isArray(entries) ? entries : Object.values(entries)) as Record<string, unknown>[];
  return {
    name: text(obj.name),
    description: text(obj.description),
    entries: rows
      .filter((row) => row && typeof row === "object")
      .map((row) => ({
        keys: keyList(row.keys ?? row.key),
        secondary_keys: keyList(row.secondary_keys ?? row.keysecondary),
        content: text(row.content),
        name: text(row.name),
        comment: text(row.comment),
        enabled: row.enabled === undefined ? row.disable !== true : row.enabled !== false,
        constant: row.constant === true,
        position: typeof row.position === "string" ? row.position : undefined,
        case_sensitive: row.case_sensitive === true || row.caseSensitive === true || ext(row).case_sensitive === true,
        match_whole_words: row.matchWholeWords === true || ext(row).match_whole_words === true,
        selective_logic: numberOr(row.selectiveLogic ?? ext(row).selectiveLogic ?? ext(row).selective_logic, 0),
        use_regex: row.use_regex === true || ext(row).use_regex === true,
      })),
  };
}

/** 從檔案讀一本世界書：酒館的世界書檔，或一張卡（只取它的 book）。 */
export async function parseWorldbookFile(
  file: File,
): Promise<{ name: string; format: "tavern"; entries: WorldbookEntryDraft[]; dropped: DropNote[] }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw: unknown;
  if (isPng(bytes)) {
    const chunk = readTextChunk(bytes, "ccv3") ?? readTextChunk(bytes, "chara");
    if (!chunk) throw new Error("tavern_no_metadata");
    raw = JSON.parse(utf8FromBase64(chunk));
  } else {
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error("tavern_invalid");
    }
  }
  const book = worldInfoToBook(raw);
  if (!book) throw new Error("worldbook_invalid");
  const entries = book.entries ?? [];
  const dropped = bookEntryDrops(entries);
  const split = countSplitEntries(entries);
  if (split) dropped.push({ key: "import.split.entries", params: { n: split, max: ENTRY_CONTENT_MAX } });
  return { name: text(book.name), format: "tavern", entries: bookEntriesToDrafts(entries), dropped };
}

/**
 * 一本世界書 → 酒館的「世界書檔」（World Info）。
 *
 * 為什麼是這個形狀而不是卡裡的 character_book：獨立的世界書檔在酒館那邊才是可以直接匯入的
 * 東西，欄位名也不一樣（key／keysecondary／disable，entries 是以 uid 為鍵的物件）。
 * parseWorldbookFile 兩種都吃得下，所以匯出的檔案自己也讀得回來。
 *
 * 只寫我們真的有的欄位。插入位置、掃描深度、機率那些酒館欄位這裡沒有對應的東西，
 * 與其填一個假的預設值讓對方以為作者設過，不如不寫。
 */
export function worldbookToExport(name: string, entries: WorldbookEntryDraft[]) {
  const rows: Record<string, unknown> = {};
  entries.forEach((entry, index) => {
    const secondary = entry.secondaryKeywords ?? [];
    rows[String(index)] = {
      uid: index,
      key: entry.keywords,
      keysecondary: secondary,
      comment: entry.name,
      content: entry.content,
      constant: entry.isConstant,
      // 酒館的 AND 門要同時寫 keysecondary 與 selective；只寫前者的話對方當成沒有次要詞
      selective: secondary.length > 0,
      selectiveLogic: entry.matchOptions?.selectiveLogic ?? 0,
      caseSensitive: entry.matchOptions?.caseSensitive ?? false,
      matchWholeWords: entry.matchOptions?.matchWholeWords ?? false,
      disable: !entry.isEnabled,
      order: index,
      extensions: {},
    };
  });
  return { name, entries: rows };
}

/** 條目層面沒地方放的欄位。每一個都要出現在報告裡。 */
export function bookEntryDrops(entries: TavernBookEntry[]): DropNote[] {
  // 次要關鍵詞、大小寫、整詞、次要邏輯現在都有落點（上游的酒館匹配規則），不再進報告。
  const counts = { position: 0, decorators: 0 };
  const names = new Set<string>();
  for (const entry of entries) {
    if (text(entry.position)) counts.position++;
    const unsupported = parseDecorators(text(entry.content)).unsupported;
    if (unsupported.length) {
      counts.decorators++;
      unsupported.forEach((n) => names.add(`@@${n}`));
    }
  }
  const notes: DropNote[] = [];
  if (counts.position) notes.push({ key: "import.drop.position", params: { n: counts.position } });
  if (counts.decorators) notes.push({ key: "import.drop.decorators", params: { n: counts.decorators, names: [...names].join(", ") } });
  return notes;
}

export interface ImportLabels {
  personality: string;
  scenario: string;
}

/**
 * 把一張酒館卡攤成草稿。
 *
 * language 由呼叫端給（介面語言），卡片本身沒有這個欄位——酒館的卡不分語區。
 */
export function tavernToDraft(
  card: TavernCard,
  options: { language: string; labels: ImportLabels; image?: Blob | null; background?: Blob | null },
): ImportResult {
  const data = card.data ?? {};
  const dropped: DropNote[] = [];
  const draft = makeDraft(options.language);

  draft.roleName = text(data.name);
  draft.nickname = text(data.nickname);
  draft.cardMeta = cardMetaFromTavern(data);
  // V3 的多語言作者說明：有跟卡片語區對上的就用那份，沒有才用 creator_notes；整份留在 cardMeta 匯出用。
  draft.roleDesc = multilingualNote(data.creator_notes_multilingual, options.language) || text(data.creator_notes);
  draft.roleDetailDesc = joinPersona(data, options.labels);
  draft.roleWelcome = text(data.first_mes);
  draft.alternates = list(data.alternate_greetings);
  // 群聊專用開場白：本站沒有群聊，但開場白本身照樣能開場，併進備選開場白並告知
  const groupGreetings = list(data.group_only_greetings);
  if (groupGreetings.length) {
    draft.alternates.push(...groupGreetings);
    dropped.push({ key: "import.note.groupGreetings", params: { n: groupGreetings.length } });
  }
  draft.roleOutputContract = text(data.system_prompt);
  draft.jailbreak = text(data.post_history_instructions);
  const tags = list(data.tags);
  draft.roleTag = tags.slice(0, TAGS_MAX);
  if (tags.length > TAGS_MAX) dropped.push({ key: "import.drop.tags", params: { n: tags.length - TAGS_MAX } });

  const example = text(data.mes_example);
  if (example) {
    const parsed = parseMesExample(example);
    if (parsed.length) draft.talkExample = parsed;
    else if (!draft.roleOutputContract && [...example].length <= 2000) {
      // MMD 的卡把「創作要求／輸出協議」寫在 mes_example 裡（不是對話）；卡沒有自己的
      // 輸出要求、又放得下（輸出要求上限 2000 字，見 role-draft）時就收到那一格，
      // 不然作者的規則整段消失（2026-09-11 兩張用戶的卡，各 700／925 字）。
      draft.roleOutputContract = example;
      dropped.push({ key: "import.note.mesExampleAsContract" });
    } else dropped.push({ key: "import.drop.mesExample" });
  }

  // V3 素材：只收主頭像與主背景（由 parseTavernFile 取出）；表情差分、使用者頭像、音效這些本站沒地方放
  const otherAssets = (data.assets ?? []).filter((a) => {
    if (!a || !text(a.uri)) return false;
    if (text(a.uri) === "ccdefault:") return false;
    return a !== mainAsset(data.assets, "icon") && a !== mainAsset(data.assets, "background");
  }).length;
  if (otherAssets) dropped.push({ key: "import.drop.assets", params: { n: otherAssets } });
  // 正則腳本（狀態欄、美化面板）現在有落點：直接變成這張卡的正則規則，不進報告。
  const extensions = Object.keys(data.extensions ?? {});
  const regexRules = rulesFromTavern(data.extensions?.regex_scripts);
  // 酒館卡：規則裡的 <style> 是酒館寫法，聊天頁要照酒館的方式落地（訊息層前綴）。
  const regex: RegexRuleSet | null = regexRules.length ? { version: 1, rules: regexRules, statusbar: "", lowered: false, format: "tavern" } : null;
  const rest = extensions.filter((k) => k !== "regex_scripts").length;
  if (rest) dropped.push({ key: "import.drop.extensions", params: { n: rest } });

  let worldbook: ImportResult["worldbook"] = null;
  const book = data.character_book;
  const bookEntries = Array.isArray(book?.entries) ? book!.entries! : [];
  if (bookEntries.length) {
    worldbook = {
      name: text(book?.name) || draft.roleName || "",
      description: text(book?.description),
      format: "tavern",
      entries: bookEntriesToDrafts(bookEntries),
    };
    dropped.push(...bookEntryDrops(bookEntries));
    const split = countSplitEntries(bookEntries);
    if (split) dropped.push({ key: "import.split.entries", params: { n: split, max: ENTRY_CONTENT_MAX } });
    if (book?.scan_depth || book?.token_budget || book?.recursive_scanning) {
      dropped.push({ key: "import.drop.bookSettings" });
    }
  }

  return { draft, worldbook, dropped, image: options.image ?? null, background: options.background ?? null, spec: card.spec, regex };
}

/**
 * 多語言作者說明挑哪一份：V3 的鍵是 ISO 639-1（en／ja／ko／zh），本站語區是 zh-Hant 這種 BCP 47。
 * 先找完全相同的，再找語言碼相同的（zh-Hant → zh、zh-TW、zh-Hant-TW）。
 */
export function multilingualNote(notes: Record<string, string> | undefined, language: string): string {
  if (!notes || typeof notes !== "object") return "";
  const want = language.toLowerCase();
  const base = want.split("-")[0];
  let fallback = "";
  for (const [lang, note] of Object.entries(notes)) {
    const key = lang.toLowerCase();
    if (key === want) return text(note);
    if (!fallback && key.split("-")[0] === base) fallback = text(note);
  }
  return fallback;
}

const positiveInt = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** V3 的附帶欄位 → 本站的 cardMeta（底線寫法 → 駝峰）。空的不放，草稿裡才不會多一堆空鍵。 */
export function cardMetaFromTavern(data: TavernCardData): CardMeta {
  const meta: CardMeta = {};
  if (text(data.creator)) meta.creator = text(data.creator);
  if (text(data.character_version)) meta.characterVersion = text(data.character_version);
  const source = list(data.source);
  if (source.length) meta.source = source;
  if (data.creator_notes_multilingual && typeof data.creator_notes_multilingual === "object") {
    const notes: Record<string, string> = {};
    for (const [lang, note] of Object.entries(data.creator_notes_multilingual)) {
      if (lang.trim() && text(note)) notes[lang.trim()] = text(note);
    }
    if (Object.keys(notes).length) meta.creatorNotesMultilingual = notes;
  }
  if (positiveInt(data.creation_date)) meta.creationDate = positiveInt(data.creation_date);
  if (positiveInt(data.modification_date)) meta.modificationDate = positiveInt(data.modification_date);
  return meta;
}

/**
 * 反向：草稿寫成一張 V3 卡。
 *
 * V3 是 V2 的超集：V2 的欄位一個不少，多出來的 nickname、creator、source 那些是本站現在有落點的
 * 東西，不寫回去等於作者匯進來又匯出去就丟了。PNG 匯出時兩個 chunk 都寫（見 embedIntoPng）：
 * 只認 V2 的客戶端讀 chara，認 V3 的讀 ccv3，兩份由同一份草稿產生，不會不一致。
 */
export function draftToTavern(
  draft: RoleDraft,
  worldbookEntries: WorldbookEntryDraft[] = [],
  meta: { creator?: string; regex?: RegexRuleSet | null; now?: number } = {},
): TavernCard {
  const cardMeta = draft.cardMeta ?? {};
  const data: TavernCardData = {
    name: draft.roleName,
    description: draft.roleDetailDesc,
    personality: "",
    scenario: "",
    first_mes: draft.roleWelcome,
    mes_example: formatMesExample(draft.talkExample),
    creator_notes: draft.roleDesc,
    system_prompt: draft.roleOutputContract,
    post_history_instructions: draft.jailbreak,
    alternate_greetings: draft.alternates,
    tags: draft.roleTag,
    creator: cardMeta.creator ?? meta.creator ?? "",
    character_version: cardMeta.characterVersion ?? "",
    // 正則規則寫回酒館認得的位置，別的客戶端拿到卡就能用同一套顯示規則
    extensions: meta.regex?.rules.length ? { regex_scripts: rulesToTavern(meta.regex.rules) } : {},
    // V3
    nickname: draft.nickname ?? "",
    group_only_greetings: [],
    source: cardMeta.source ?? [],
    // 本站的簡介就是卡片語區那一份作者說明；其他語言的照匯入時的原樣還回去
    creator_notes_multilingual: { ...(cardMeta.creatorNotesMultilingual ?? {}), ...(draft.roleDesc ? { [draft.language.split("-")[0]]: draft.roleDesc } : {}) },
    creation_date: cardMeta.creationDate ?? Math.floor((meta.now ?? Date.now()) / 1000),
    modification_date: Math.floor((meta.now ?? Date.now()) / 1000),
    // PNG 匯出時卡就嵌在頭像那張圖裡：ccdefault: 依規格指向這張圖本身
    assets: [{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }],
  };
  if (worldbookEntries.length) {
    data.character_book = {
      name: draft.roleName,
      entries: worldbookEntries.map((entry, index) => ({
        keys: entry.keywords,
        // 酒館的 AND 門要同時寫 secondary_keys 與 selective；只寫前者的話客戶端當成沒有次要詞
        secondary_keys: entry.secondaryKeywords ?? [],
        selective: (entry.secondaryKeywords ?? []).length > 0,
        content: entry.content,
        name: entry.name,
        enabled: entry.isEnabled,
        constant: entry.isConstant,
        insertion_order: index,
        extensions: {},
      })) as TavernBookEntry[],
    };
  }
  return { spec: "chara_card_v3", spec_version: "3.0", data };
}

/** V3 卡 → 只認 V2 的客戶端讀的那一份：拿掉 V3 才有的鍵，spec 改回 V2。 */
export function toV2Card(card: TavernCard): TavernCard {
  const { nickname: _n, group_only_greetings: _g, source: _s, creator_notes_multilingual: _m, creation_date: _c, modification_date: _d, assets: _a, ...v2 } = card.data;
  return { spec: "chara_card_v2", spec_version: "2.0", data: v2 };
}

/**
 * 匯出時要抓頭像的位元組。同源（或 data:/blob:）直接抓；上游圖片主機沒開 CORS，
 * 走本站 Worker 的同源代抓。
 */
export function imageFetchUrl(src: string, origin: string): string {
  if (!src) return src;
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;
  try {
    const url = new URL(src, origin);
    if (url.origin === origin) return src;
    return `/v1/image?u=${encodeURIComponent(url.toString())}`;
  } catch {
    return src;
  }
}

/**
 * 把卡寫進一張 PNG 的 tEXt。圖是作者自己的頭像，所以匯出的卡看起來就是那張立繪。
 * 兩個 chunk 都寫：`chara` 放 V2（所有客戶端都讀得懂），`ccv3` 放 V3（認 V3 的優先讀它）。
 */
export function embedIntoPng(imageBytes: Uint8Array, card: TavernCard): Uint8Array {
  const v3 = card.spec === "chara_card_v3" ? card : null;
  const v2 = v3 ? toV2Card(v3) : card;
  const chunks = [{ keyword: "chara", text: base64FromUtf8(JSON.stringify(v2)) }];
  if (v3) chunks.push({ keyword: "ccv3", text: base64FromUtf8(JSON.stringify(v3)) });
  return replaceTextChunks(imageBytes, chunks);
}
