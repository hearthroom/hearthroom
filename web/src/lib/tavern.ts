/**
 * 酒館角色卡（Character Card V2 / V3）與本站草稿之間的雙向轉換。
 *
 * 載體有三種，這裡支援兩種：
 *   - PNG：資料在 tEXt chunk（`ccv3` 優先於 `chara`，兩者都是 base64 的 JSON）
 *   - JSON：裸卡，或是外面包一層 `{spec, data}`
 *   - CHARX（.charx，V3 的 zip 封裝）**不支援**——它需要一整套 zip 讀取，而野生的卡
 *     絕大多數是前兩種。遇到就明確告訴使用者，不要假裝讀失敗。
 *
 * 兩邊的欄位不是一一對應，這是這個檔案的全部難處。**對不上的欄位一律進報告**，
 * 不靜默丟掉：作者匯入一張卡之後如果不知道次要關鍵詞沒了，他會以為卡壞了。
 *
 * 一個好消息：`{{char}}` / `{{user}}` 兩邊都認，原樣帶過去就會動。
 */

import { isPng, readTextChunk, replaceTextChunks, base64FromUtf8, utf8FromBase64 } from "./png-chunks";
import type { RoleDraft, TalkExampleEntry, WorldbookEntryDraft } from "./role-draft";
import { makeDraft } from "./role-draft";

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
  extensions?: Record<string, unknown>;
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
  worldbook: { name: string; description: string; entries: WorldbookEntryDraft[] } | null;
  /** 沒能帶過來的東西。畫面必須原樣列給作者看。 */
  dropped: DropNote[];
  /** 卡片自帶的立繪（PNG 匯入時才有），拿去當頭像與背景的預設值。 */
  image: Blob | null;
  spec: string;
}

/** 本站一張卡最多幾個標籤。多的丟掉並進報告，不靜默截斷。 */
export const TAGS_MAX = 10;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => text(v)).filter(Boolean) : [];

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
    return { spec: "chara_card_v1", spec_version: "1.0", data: obj as TavernCardData };
  }
  throw new Error("tavern_invalid");
}

/** 從檔案讀出一張卡。副檔名不可信，看實際位元組。 */
export async function parseTavernFile(file: File): Promise<{ card: TavernCard; image: Blob | null }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPng(bytes)) {
    // V3 優先：同一張圖常常兩個 chunk 都在，而 ccv3 才是新的那份。
    const raw = readTextChunk(bytes, "ccv3") ?? readTextChunk(bytes, "chara");
    if (!raw) throw new Error("tavern_no_metadata");
    return { card: unwrap(JSON.parse(utf8FromBase64(raw))), image: new Blob([bytes], { type: "image/png" }) };
  }
  if (file.name.toLowerCase().endsWith(".charx")) throw new Error("tavern_charx_unsupported");
  return { card: unwrap(JSON.parse(new TextDecoder().decode(bytes))), image: null };
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
  if (personality) parts.push(`${labels.personality}\n${personality}`);
  if (scenario) parts.push(`${labels.scenario}\n${scenario}`);
  return parts.join("\n\n");
}

/** 酒館的條目 → 本站的條目。 */
export function bookEntriesToDrafts(entries: TavernBookEntry[]): WorldbookEntryDraft[] {
  return entries
    .map((entry, index) => ({
      // 條目要有名字才找得回來。酒館這兩個欄位常常都空，那就用第一個關鍵詞。
      name: (text(entry.name) || text(entry.comment) || list(entry.keys)[0] || `#${index + 1}`).slice(0, 20),
      content: text(entry.content),
      keywords: list(entry.keys),
      secondaryKeywords: list(entry.secondary_keys),
      isEnabled: entry.enabled !== false,
      isConstant: entry.constant === true,
    }))
    .filter((e) => e.content);
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
        keys: list(row.keys ?? row.key),
        secondary_keys: list(row.secondary_keys ?? row.keysecondary),
        content: text(row.content),
        name: text(row.name),
        comment: text(row.comment),
        enabled: row.enabled === undefined ? row.disable !== true : row.enabled !== false,
        constant: row.constant === true,
        position: typeof row.position === "string" ? row.position : undefined,
        case_sensitive: row.case_sensitive === true || row.caseSensitive === true,
      })),
  };
}

/** 從檔案讀一本世界書：酒館的世界書檔，或一張卡（只取它的 book）。 */
export async function parseWorldbookFile(
  file: File,
): Promise<{ name: string; entries: WorldbookEntryDraft[]; dropped: DropNote[] }> {
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
  return { name: text(book.name), entries: bookEntriesToDrafts(entries), dropped: bookEntryDrops(entries) };
}

/** 條目層面沒地方放的欄位。每一個都要出現在報告裡。 */
function bookEntryDrops(entries: TavernBookEntry[]): DropNote[] {
  // 次要關鍵詞現在有對應的落點（本站條目的 AND 門），不再進報告。
  const counts = { position: 0, caseSensitive: 0 };
  for (const entry of entries) {
    if (text(entry.position)) counts.position++;
    if (entry.case_sensitive) counts.caseSensitive++;
  }
  const notes: DropNote[] = [];
  if (counts.position) notes.push({ key: "import.drop.position", params: { n: counts.position } });
  if (counts.caseSensitive) notes.push({ key: "import.drop.caseSensitive", params: { n: counts.caseSensitive } });
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
  options: { language: string; labels: ImportLabels; image?: Blob | null },
): ImportResult {
  const data = card.data ?? {};
  const dropped: DropNote[] = [];
  const draft = makeDraft(options.language);

  draft.roleName = text(data.name);
  draft.roleDesc = text(data.creator_notes);
  draft.roleDetailDesc = joinPersona(data, options.labels);
  draft.roleWelcome = text(data.first_mes);
  draft.alternates = list(data.alternate_greetings);
  draft.roleOutputContract = text(data.system_prompt);
  draft.jailbreak = text(data.post_history_instructions);
  const tags = list(data.tags);
  draft.roleTag = tags.slice(0, TAGS_MAX);
  if (tags.length > TAGS_MAX) dropped.push({ key: "import.drop.tags", params: { n: tags.length - TAGS_MAX } });

  const example = text(data.mes_example);
  if (example) {
    const parsed = parseMesExample(example);
    if (parsed.length) draft.talkExample = parsed;
    else dropped.push({ key: "import.drop.mesExample" });
  }

  // 只有這幾個是「本站真的沒有對應概念」。有對應但形狀不同的（例如三段人設）不算丟。
  if (text(data.creator)) dropped.push({ key: "import.drop.creator", params: { name: text(data.creator) } });
  if (text(data.character_version)) dropped.push({ key: "import.drop.version" });
  if (text(data.nickname)) dropped.push({ key: "import.drop.nickname", params: { name: text(data.nickname) } });
  if (list(data.group_only_greetings).length) dropped.push({ key: "import.drop.groupGreetings" });
  // 正則腳本（狀態欄、美化面板）單獨點名：那是酒館卡最常見、也最容易被誤以為「壞了」的一種擴展。
  const extensions = Object.keys(data.extensions ?? {});
  const regex = Array.isArray(data.extensions?.regex_scripts) ? (data.extensions!.regex_scripts as unknown[]).length : 0;
  if (regex) dropped.push({ key: "import.drop.regex", params: { n: regex } });
  const rest = extensions.filter((k) => k !== "regex_scripts").length;
  if (rest) dropped.push({ key: "import.drop.extensions", params: { n: rest } });

  let worldbook: ImportResult["worldbook"] = null;
  const book = data.character_book;
  const bookEntries = Array.isArray(book?.entries) ? book!.entries! : [];
  if (bookEntries.length) {
    worldbook = {
      name: text(book?.name) || draft.roleName || "",
      description: text(book?.description),
      entries: bookEntriesToDrafts(bookEntries),
    };
    dropped.push(...bookEntryDrops(bookEntries));
    if (book?.scan_depth || book?.token_budget || book?.recursive_scanning) {
      dropped.push({ key: "import.drop.bookSettings" });
    }
  }

  return { draft, worldbook, dropped, image: options.image ?? null, spec: card.spec };
}

/**
 * 反向：草稿寫成一張 V2 卡。
 *
 * 匯出固定用 V2 而不是 V3：V2 是所有客戶端都讀得懂的那一版，而本站沒有任何一個欄位
 * 需要 V3 才裝得下。多帶一份 V3 只會讓兩份資料有機會不一致。
 */
export function draftToTavern(
  draft: RoleDraft,
  worldbookEntries: WorldbookEntryDraft[] = [],
  meta: { creator?: string } = {},
): TavernCard {
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
    creator: meta.creator ?? "",
    character_version: "",
    extensions: {},
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
  return { spec: "chara_card_v2", spec_version: "2.0", data };
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

/** 把卡寫進一張 PNG 的 tEXt。圖是作者自己的頭像，所以匯出的卡看起來就是那張立繪。 */
export function embedIntoPng(imageBytes: Uint8Array, card: TavernCard): Uint8Array {
  const encoded = base64FromUtf8(JSON.stringify(card));
  return replaceTextChunks(imageBytes, [{ keyword: "chara", text: encoded }]);
}
