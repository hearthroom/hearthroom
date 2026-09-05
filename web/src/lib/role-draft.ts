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
  isEnabled: boolean;
  isConstant: boolean;
}

export interface RoleDraft {
  roleName: string;
  /** 角色卡語區。建立之後就定了，編輯時不出現。 */
  language: string;
  /** 玩家在這張卡裡的稱呼，對應 {{user}}。 */
  userName: string;
  roleDesc: string;
  roleTag: string[];
  roleAvatar: string;
  roleBackground: string;
  roleDetailDesc: string;
  roleWelcome: string;
  /** 備選開場白：換一個開場，但仍是同一場故事。 */
  alternates: string[];
  /** 開場選項：玩家可以挑的第一句話。 */
  prologue: string[];
  talkExample: TalkExampleEntry[];
  roleOutputContract: string;
  jailbreak: string;
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
  language,
  userName: "",
  roleDesc: "",
  roleTag: [],
  roleAvatar: "",
  roleBackground: "",
  roleDetailDesc: "",
  roleWelcome: "",
  alternates: [],
  prologue: [],
  talkExample: [],
  roleOutputContract: "",
  jailbreak: "",
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
 * 欄位上限。這份只是「還沒問過上游時的保守預設」——真正的上限跟著卡片語區走，
 * 由 GET /role/validate 的 tokenBudget.limits 回來覆蓋。寫死在前端會在某些語區給錯提示。
 */
export const FALLBACK_LIMITS: Record<string, number> = {
  roleName: 60,
  roleDesc: 500,
  roleDetailDesc: 20000,
  roleWelcome: 4000,
  roleOutputContract: 4000,
  jailbreak: 4000,
};

export interface FieldLimits {
  roleDescMaxChars?: number;
  roleDetailDescMaxChars?: number;
  roleWelcomeMaxChars?: number;
  roleOutputContractMaxChars?: number;
  jailbreakMaxChars?: number;
}

export function resolveLimits(remote: FieldLimits | null): Record<string, number> {
  if (!remote) return { ...FALLBACK_LIMITS };
  return {
    ...FALLBACK_LIMITS,
    ...(remote.roleDescMaxChars ? { roleDesc: remote.roleDescMaxChars } : {}),
    ...(remote.roleDetailDescMaxChars ? { roleDetailDesc: remote.roleDetailDescMaxChars } : {}),
    ...(remote.roleWelcomeMaxChars ? { roleWelcome: remote.roleWelcomeMaxChars } : {}),
    ...(remote.roleOutputContractMaxChars ? { roleOutputContract: remote.roleOutputContractMaxChars } : {}),
    ...(remote.jailbreakMaxChars ? { jailbreak: remote.jailbreakMaxChars } : {}),
  };
}

/** 上游把標籤存成物件陣列，也可能是純字串陣列（看是哪條路寫的）。兩種都要吃得下。 */
function readTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((tag) => (typeof tag === "string" ? tag : String((tag as { text?: string; tagName?: string })?.text ?? (tag as { tagName?: string })?.tagName ?? "")))
    .map((tag) => tag.trim())
    .filter(Boolean);
}

/** 對話示例在上游是一段 JSON 字串。解不開就當空的——半個示例比沒有更糟。 */
function readTalkExample(raw: unknown): TalkExampleEntry[] {
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

/** 上游的角色詳情 → 草稿。 */
export function draftFromRoleDetail(raw: Record<string, unknown>, fallbackLanguage: string): RoleDraft {
  const draft = makeDraft(str(raw.language) || fallbackLanguage);
  draft.roleName = str(raw.roleName);
  draft.userName = str(raw.userName);
  draft.roleDesc = str(raw.roleDesc);
  draft.roleTag = readTags(raw.roleTag);
  draft.roleAvatar = str(raw.roleAvatar);
  draft.roleBackground = str(raw.roleBackground);
  draft.roleDetailDesc = str(raw.roleDetailDesc);
  draft.roleWelcome = str(raw.roleWelcome);
  draft.alternates = strList(raw.roleWelcomeAlternates ?? raw.alternates);
  draft.prologue = strList(raw.rolePrologue ?? raw.prologue);
  draft.talkExample = readTalkExample(raw.talkExample);
  draft.roleOutputContract = str(raw.roleOutputContract);
  draft.jailbreak = str(raw.jailbreak);
  return draft;
}

/** document 端點收的欄位表。只有指針有值的欄位會被寫。 */
export interface RoleDocumentFields {
  roleName?: string;
  roleDesc?: string;
  roleTag?: string[];
  userName?: string;
  roleAvatar?: string;
  roleBackground?: string;
  roleDetailDesc?: string;
  talkExample?: TalkExampleEntry[];
  roleOutputContract?: string;
  jailbreak?: string;
}

const TEXT_FIELDS = [
  "roleName",
  "roleDesc",
  "userName",
  "roleAvatar",
  "roleBackground",
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
  if (!original || JSON.stringify(draft.roleTag) !== JSON.stringify(original.roleTag)) patch.roleTag = draft.roleTag;
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
