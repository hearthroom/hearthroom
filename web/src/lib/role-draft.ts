/**
 * 角色卡草稿：編輯器手上那份，跟上游的寫入 payload 之間隔一層。
 *
 * 為什麼不直接編輯上游回來的物件：上游的角色詳情是給「讀」用的形狀（標籤是物件陣列、
 * 對話示例是一段 JSON 字串、開場白與備選開場白分屬兩個端點），照那個形狀寫表單，
 * 每個欄位都得在畫面裡再解一次。草稿是表單的形狀，進出各轉一次，轉換邏輯只有這一份。
 */

export interface TalkExampleEntry {
  roleType: "user" | "ai";
  content: string;
}

export interface WorldbookEntryDraft {
  /** 上游已存在的條目才有。新加的是空的，送出時 op=create。 */
  entryId?: string;
  name: string;
  content: string;
  keywords: string[];
  /** AND 門：非空時，關鍵詞命中之外還要有其中一個出現才觸發。對應酒館卡的 secondary_keys。 */
  secondaryKeywords: string[];
  isEnabled: boolean;
  isConstant: boolean;
  /**
   * 條目分類。上游召回時照分類給加成（規則最高、人物次之、地點與物品再次），
   * 也照分類算每輪能帶進去幾條。留空的話上游建立時一律當成「自訂」——那是加成最低的一檔。
   */
  category?: string;
  /**
   * 這條要掃哪一邊的對話：both（都掃，預設）／user_only（只掃玩家說的）／
   * ai_only（只掃角色說的）。空字串當 both。
   */
  triggerRegion?: string;
  /** 酒館格式的書才有：大小寫、整詞、次要關鍵詞邏輯（0 任一／1 不是全部／2 都不／3 全部）。 */
  matchOptions?: WorldbookMatchOptions;
  /** 上游統計的「被帶進對話幾次」。只讀，新條目沒有。 */
  activationCount?: number;
}

export interface WorldbookMatchOptions {
  selective?: boolean;
  scanDepth?: number;
  order?: number;
  groupId?: string;
  groupOrder?: number;
  extensions?: Record<string, unknown>;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  selectiveLogic: number;
}

/**
 * 角色卡 V3 附帶的資料：不進提示詞，只為了匯出時原樣還回去（上游 cardMeta）。
 * 欄位名是本站的駝峰寫法；酒館那邊的底線寫法在 tavern.ts 對回去。
 */
export interface CardMeta {
  creator?: string;
  characterVersion?: string;
  source?: string[];
  /** 語言碼 → 該語言的作者說明。roleDesc 存的是跟卡片語區對上的那一份。 */
  creatorNotesMultilingual?: Record<string, string>;
  /** 秒級 Unix 時間。 */
  creationDate?: number;
  modificationDate?: number;
}

/** 別名跟角色名同一個上限（上游 nickname 是 70 字）。 */
export const NICKNAME_MAX = 70;

export interface RoleDraft {
  roleName: string;
  /** 角色自稱／別名：{{char}} 展開成這個；空＝用角色名。角色卡 V3 的 nickname。 */
  nickname: string;
  /** 角色卡語區。建立之後就定了，編輯時不出現。 */
  language: string;
  /** 玩家在這張卡裡的稱呼，對應 {{user}}。 */
  userName: string;
  /** 性別：man / women / other，空字串＝未設定。拼法是站內既有的，不能改。 */
  roleSex: string;
  roleDesc: string;
  roleTag: string[];
  roleBackground: string;
  /** 橫式背景（選填）：舞台在橫向螢幕優先用它，沒有就退回直式的 roleBackground。 */
  roleBackgroundLandscape: string;
  roleDetailDesc: string;
  roleWelcome: string;
  /** 備選開場白：換一個開場，但仍是同一場故事。 */
  alternates: string[];
  /** 開場選項：玩家可以挑的第一句話。 */
  prologue: string[];
  talkExample: TalkExampleEntry[];
  roleOutputContract: string;
  jailbreak: string;
  cardMeta: CardMeta;
  /** 世界模式的成員；null＝普通單卡。世界觀是 roleDetailDesc、世界級世界書是綁卡的那本，都不在這裡。 */
  world: WorldDraft | null;
}

export interface WorldCharacterDraft {
  /** 穩定代號：小寫英數、底線、連字號；訊息裡的發言者區塊與 @ 都用它指人。 */
  id: string;
  name: string;
  avatar: string;
  sex: string;
  /** 所有人都知道的側寫（世界層與其他角色看得到）。 */
  profile: string;
  /** 角色自己的完整設定，只進它自己的上下文。 */
  description: string;
  /** 角色私有世界書（作者自己的 worldbook id），空＝沒有。 */
  lorebookId: string;
}

export interface WorldDraft {
  maxSpeakers: number;
  strictness: "" | "lenient" | "balanced" | "strict";
  characters: WorldCharacterDraft[];
}

export const WORLD_LIMITS = { characters: 12, maxSpeakers: 3, name: 60, profile: 600, description: 60000 } as const;
export const WORLD_STRICTNESS = ["balanced", "lenient", "strict"] as const;

export const makeWorldCharacter = (): WorldCharacterDraft => ({ id: "", name: "", avatar: "", sex: "", profile: "", description: "", lorebookId: "" });
export const makeWorld = (): WorldDraft => ({ maxSpeakers: 2, strictness: "balanced", characters: [makeWorldCharacter()] });

const WORLD_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * 從名字生代號：拉丁字母與數字留下、其餘丟掉；中文名生不出東西就用 c1、c2…；撞名補數字。
 * 代號一旦存過就別再改：舊訊息裡的發言者區塊與延後的後果都靠它指人。
 */
export function worldCharacterId(name: string, taken: Iterable<string>, fallbackIndex: number): string {
  const used = new Set(taken);
  let base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  if (!base || !/^[a-z0-9]/.test(base)) base = `c${fallbackIndex}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function readWorld(raw: unknown): WorldDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const list = Array.isArray(w.characters) ? w.characters : [];
  const characters: WorldCharacterDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const id = str(c.id);
    if (!WORLD_ID_RE.test(id)) continue;
    characters.push({ id, name: str(c.name), avatar: str(c.avatar), sex: str(c.sex), profile: str(c.profile), description: str(c.description), lorebookId: str(c.lorebookId) });
  }
  if (!characters.length) return null;
  const speakers = Number(w.maxSpeakers);
  const strictness = str(w.strictness);
  return {
    maxSpeakers: Number.isInteger(speakers) && speakers >= 1 && speakers <= WORLD_LIMITS.maxSpeakers ? speakers : 2,
    strictness: (WORLD_STRICTNESS as readonly string[]).includes(strictness) ? (strictness as WorldDraft["strictness"]) : "balanced",
    characters,
  };
}

/** 存檔時送給上游的整包（缺代號的成員在這裡補上）。 */
export function worldPayload(world: WorldDraft): Record<string, unknown> {
  const taken: string[] = [];
  const characters = world.characters.map((c, i) => {
    const id = WORLD_ID_RE.test(c.id) ? c.id : worldCharacterId(c.name, taken, i + 1);
    taken.push(id);
    const out: Record<string, unknown> = { id, name: c.name.trim(), profile: c.profile, description: c.description };
    if (c.avatar.trim()) out.avatar = c.avatar.trim();
    if (c.sex) out.sex = c.sex;
    if (c.lorebookId) out.lorebookId = c.lorebookId;
    return out;
  });
  return { version: 1, maxSpeakers: world.maxSpeakers, strictness: world.strictness || "balanced", characters };
}

/** 成員清單有沒有動過（含開關世界模式本身）。 */
export function worldChanged(draft: RoleDraft, original: RoleDraft | null): boolean {
  if (!original) return draft.world !== null;
  return JSON.stringify(draft.world) !== JSON.stringify(original.world);
}

/** 存檔前的本地檢查：回第一個問題的成員索引與原因；null＝沒問題。 */
export function worldProblem(world: WorldDraft | null): { index: number; reason: "name" | "tooMany" | "profile" | "description" } | null {
  if (!world) return null;
  if (world.characters.length > WORLD_LIMITS.characters) return { index: WORLD_LIMITS.characters, reason: "tooMany" };
  for (let i = 0; i < world.characters.length; i++) {
    const c = world.characters[i];
    if (!c.name.trim() || [...c.name.trim()].length > WORLD_LIMITS.name) return { index: i, reason: "name" };
    if ([...c.profile].length > WORLD_LIMITS.profile) return { index: i, reason: "profile" };
    if ([...c.description].length > WORLD_LIMITS.description) return { index: i, reason: "description" };
  }
  return null;
}

export const LANGUAGES = [
  { value: "zh-Hant", label: "繁體中文" },
  { value: "zh-Hans", label: "简体中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
] as const;

export const makeDraft = (language: string): RoleDraft => ({
  roleName: "",
  nickname: "",
  language,
  userName: "",
  roleSex: "",
  roleDesc: "",
  roleTag: [],
  roleBackground: "",
  roleBackgroundLandscape: "",
  roleDetailDesc: "",
  roleWelcome: "",
  alternates: [],
  prologue: [],
  talkExample: [],
  roleOutputContract: "",
  jailbreak: "",
  cardMeta: {},
  world: null,
});

/**
 * 送審前一定要有的東西。跟上游 validate_role 的阻斷項對齊，但在本地先算一次——
 * 作者不該填到最後一步才知道第一步漏了什麼。上游仍是最終權威。
 */
export const REQUIRED_FIELDS = ["roleName", "roleWelcome", "roleDetailDesc"] as const;

export function missingRequired(draft: RoleDraft): string[] {
  return REQUIRED_FIELDS.filter((key) => !String(draft[key] ?? "").trim());
}

/**
 * 欄位上限。這份只是「還沒問過上游時的預設」——真正的上限由 GET /role/validate 的
 * tokenBudget.limits 回來覆蓋。新卡還沒有 roleId、問不到上游，所以這張表要跟上游的
 * 語區表一致（server LimitsForRoleLanguage）：英文卡預算大得多，中文卡的額外指示只有 500。
 * 寫成一個數會在建卡頁顯示 4000、存成卡後變 500 這種前後矛盾。
 */
export function fallbackLimits(language = ""): Record<string, number> {
  const lang = language.toLowerCase();
  const base = { roleName: 60, roleOutputContract: 2000 };
  if (lang.startsWith("en")) return { ...base, roleDesc: 2500, roleDetailDesc: 50000, roleWelcome: 10000, jailbreak: 1500 };
  return { ...base, roleDesc: 500, roleDetailDesc: 10000, roleWelcome: 8000, jailbreak: lang.startsWith("zh") ? 500 : 1500 };
}

export interface FieldLimits {
  roleDescMaxChars?: number;
  roleDetailDescMaxChars?: number;
  roleWelcomeMaxChars?: number;
  roleOutputContractMaxChars?: number;
  customInstructionsMaxChars?: number; jailbreakMaxChars?: number;
}

export function resolveLimits(remote: FieldLimits | null, language = ""): Record<string, number> {
  const fallback = fallbackLimits(language);
  if (!remote) return fallback;
  return {
    ...fallback,
    ...(remote.roleDescMaxChars ? { roleDesc: remote.roleDescMaxChars } : {}),
    ...(remote.roleDetailDescMaxChars ? { roleDetailDesc: remote.roleDetailDescMaxChars } : {}),
    ...(remote.roleWelcomeMaxChars ? { roleWelcome: remote.roleWelcomeMaxChars } : {}),
    ...(remote.roleOutputContractMaxChars ? { roleOutputContract: remote.roleOutputContractMaxChars } : {}),
    ...((remote.customInstructionsMaxChars ?? remote.jailbreakMaxChars) ? { jailbreak: (remote.customInstructionsMaxChars ?? remote.jailbreakMaxChars)! } : {}),
  };
}

/**
 * 上游把標籤存成物件陣列，也可能是純字串陣列（看是哪條路寫的）；有些欄位拿到的是那個陣列
 * 序列化後的字串。三種都要吃得下，最後才退到「逗號分隔的純文字」。
 */
export function readTags(raw: unknown): string[] {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    if (text.startsWith("[")) {
      try {
        return readTags(JSON.parse(text));
      } catch {
        /* 不是 JSON，往下當純文字 */
      }
    }
    return text.split(/[,，、]/).map((t) => t.trim()).filter(Boolean);
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((tag) => (typeof tag === "string" ? tag : String((tag as { text?: string; tagName?: string })?.text ?? (tag as { tagName?: string })?.tagName ?? "")))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** 對話示例在上游是一段 JSON 字串。解不開就當空的——半個示例比沒有更糟。 */
export function readTalkExample(raw: unknown): TalkExampleEntry[] {
  if (Array.isArray(raw)) return raw as TalkExampleEntry[];
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        roleType: entry?.roleType === "user" ? "user" : "ai",
        content: String(entry?.content ?? "").trim(),
      }))
      .filter((entry) => entry.content) as TalkExampleEntry[];
  } catch {
    return [];
  }
}

const str = (raw: unknown): string => (typeof raw === "string" ? raw : "");
const strList = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.map((v) => str(v).trim()).filter(Boolean) : [];

const numOr0 = (raw: unknown): number => (typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0);

/**
 * 上游的 cardMeta：物件，或（舊回應、分享詳情）一段 JSON 字串。壞掉的一律當空——
 * 這份資料不影響卡片能不能用，讀不出來不該讓整張卡讀不出來。
 */
export function readCardMeta(raw: unknown): CardMeta {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const o = obj as Record<string, unknown>;
  const meta: CardMeta = {};
  if (str(o.creator).trim()) meta.creator = str(o.creator).trim();
  if (str(o.characterVersion).trim()) meta.characterVersion = str(o.characterVersion).trim();
  const source = strList(o.source);
  if (source.length) meta.source = source;
  if (o.creatorNotesMultilingual && typeof o.creatorNotesMultilingual === "object" && !Array.isArray(o.creatorNotesMultilingual)) {
    const notes: Record<string, string> = {};
    for (const [lang, note] of Object.entries(o.creatorNotesMultilingual as Record<string, unknown>)) {
      if (lang.trim() && str(note).trim()) notes[lang.trim()] = str(note).trim();
    }
    if (Object.keys(notes).length) meta.creatorNotesMultilingual = notes;
  }
  if (numOr0(o.creationDate)) meta.creationDate = numOr0(o.creationDate);
  if (numOr0(o.modificationDate)) meta.modificationDate = numOr0(o.modificationDate);
  return meta;
}

/** 上游的角色詳情 → 草稿。 */
export function draftFromRoleDetail(raw: Record<string, unknown>, fallbackLanguage: string): RoleDraft {
  const draft = makeDraft(str(raw.language) || fallbackLanguage);
  draft.roleName = str(raw.roleName);
  draft.nickname = str(raw.nickname);
  draft.cardMeta = readCardMeta(raw.cardMeta);
  draft.userName = str(raw.userName);
  draft.roleSex = str(raw.roleSex);
  draft.roleDesc = str(raw.roleDesc);
  draft.roleTag = readTags(raw.roleTag);
  draft.roleBackground = str(raw.roleBackground) || str(raw.roleAvatar);
  draft.roleBackgroundLandscape = str(raw.roleBackgroundLandscape);
  draft.roleDetailDesc = str(raw.roleDetailDesc);
  draft.roleWelcome = str(raw.roleWelcome);
  draft.alternates = strList(raw.roleWelcomeAlternates ?? raw.alternates);
  draft.prologue = strList(raw.rolePrologue ?? raw.prologue);
  draft.talkExample = readTalkExample(raw.talkExample);
  draft.roleOutputContract = str(raw.roleOutputContract);
  draft.jailbreak = str(raw.customInstructions ?? raw.jailbreak);
  draft.world = readWorld(raw.world);
  return draft;
}

/** document 端點收的欄位表。只有指針有值的欄位會被寫。 */
export interface RoleDocumentFields {
  roleName?: string;
  roleDesc?: string;
  roleTag?: string[];
  userName?: string;
  roleSex?: string;
  roleAvatar?: string;
  roleBackground?: string;
  roleBackgroundLandscape?: string;
  roleDetailDesc?: string;
  talkExample?: TalkExampleEntry[];
  roleOutputContract?: string;
  jailbreak?: string;
  nickname?: string;
  cardMeta?: CardMeta;
}

const TEXT_FIELDS = [
  "roleName",
  "nickname",
  "roleDesc",
  "userName",
  "roleSex",
  "roleBackground",
  "roleBackgroundLandscape",
  "roleDetailDesc",
  "roleOutputContract",
  "jailbreak",
] as const;

/**
 * 只挑出真的改過的欄位。
 *
 * 整包送會出事的兩個場合：載入失敗留下的空字串會把作者的內容洗掉；沒動過的欄位每次
 * 都重寫一次，會讓上游的「改了什麼」記錄失去意義。所以逐欄比對，一個都不多送。
 *
 * roleWelcome 不在這裡：它跟備選開場白、開場選項一起走另一條路，那三個要一起判斷。
 */
export function documentPatch(draft: RoleDraft, original: RoleDraft | null): RoleDocumentFields {
  const patch: RoleDocumentFields = {};
  for (const key of TEXT_FIELDS) {
    if (!original || draft[key] !== original[key]) patch[key] = draft[key];
  }
  // Keep the protocol avatar alias in sync, including explicit clearing.
  // Harbor treats this wire field as a portrait alias; there is no separate draft slot.
  if (patch.roleBackground !== undefined) patch.roleAvatar = patch.roleBackground;
  if (!original || JSON.stringify(draft.roleTag) !== JSON.stringify(original.roleTag)) patch.roleTag = draft.roleTag;
  // 新卡沒有附帶資料就不送：上游本來就是空的，送一個 {} 只是多一次寫入
  if (original ? JSON.stringify(draft.cardMeta) !== JSON.stringify(original.cardMeta) : Object.keys(draft.cardMeta).length > 0) {
    patch.cardMeta = draft.cardMeta;
  }
  if (!original || JSON.stringify(draft.talkExample) !== JSON.stringify(original.talkExample)) {
    // 空陣列送過去會被服務層當成 invalid_talk_example 擋掉，而作者清空示例是合理操作。
    // 沒有東西可送時就不送——清空對話示例目前只能在原站做。
    if (draft.talkExample.length) patch.talkExample = draft.talkExample;
  }
  return patch;
}

export const hasAnyField = (patch: RoleDocumentFields): boolean => Object.keys(patch).length > 0;

/** 開場白那一組有沒有動過。三個欄位任一變了就得整組重送。 */
export function welcomeChanged(draft: RoleDraft, original: RoleDraft | null): boolean {
  if (!original) return Boolean(draft.roleWelcome.trim());
  return (
    draft.roleWelcome !== original.roleWelcome ||
    JSON.stringify(draft.alternates) !== JSON.stringify(original.alternates) ||
    JSON.stringify(draft.prologue) !== JSON.stringify(original.prologue)
  );
}

export const cloneDraft = (draft: RoleDraft): RoleDraft => JSON.parse(JSON.stringify(draft)) as RoleDraft;

/** 標籤輸入框：只認頓號與逗號。英文標籤裡有空白（slice of life），拆了就變三個沒意義的字。 */
export const parseTags = (raw: string): string[] =>
  raw.split(/[、,，]+/).map((tag) => tag.trim()).filter(Boolean);

export const formatTags = (tags: string[]): string => tags.join("、");
