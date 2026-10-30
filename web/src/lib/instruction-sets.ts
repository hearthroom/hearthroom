/**
 * 長期指令組（「我的」→ 長期指令）：玩家把常用的長期指令存成幾組，遊玩時在畫布選給一張卡或一個存檔。
 *
 * 這裡只管組本身（列表、新增或修改、刪除）。卡片的「新存檔自動帶上」只在畫布設定，網頁只顯示有幾張卡在用
 * （任務 2026-10-31-long-term-instructions ui.md §5）。上限（組數、條數、字數、名稱長度）都取伺服器回傳的值。
 *
 * 錯誤碼是上游長期指令那一套大寫碼；單條不合規則時 detail.index 指出第幾條（從 0 起）。共用的 json() 會把
 * detail.index 丟掉，所以這裡自己讀錯誤信封，畫面才能把原因放在那一條底下。
 */
import { ApiError, authHeaders, json } from "./api";
import { UPSTREAM_API } from "./config";
import { i18n } from "./i18n";

export interface InstructionSet {
  presetId: string;
  title: string;
  items: string[];
  /** 有幾張卡讓新存檔自動帶上這組。 */
  cardCount: number;
  lastUpdateTime: string;
}

export interface InstructionLimits { maxCount: number; maxItems: number; maxLength: number; maxTitle: number }
export interface InstructionSetList extends InstructionLimits { list: InstructionSet[] }

/** 伺服器沒帶上限時才用（舊回應）；有帶一律照伺服器。 */
const FALLBACK: InstructionLimits = { maxCount: 20, maxItems: 10, maxLength: 200, maxTitle: 40 };

export class InstructionSetError extends ApiError {
  /** 單條不合規則時是第幾條（從 0 起）；其他錯誤沒有。 */
  constructor(status: number, message: string, code: string, readonly index?: number) {
    super(status, message, code);
  }
}

async function read<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  const body = (await res.clone().json().catch(() => ({}))) as { error?: unknown; detail?: { index?: unknown } };
  const code = typeof body.error === "string" ? body.error : "";
  if (code.startsWith("DIRECTIVE_")) {
    const index = typeof body.detail?.index === "number" ? body.detail.index : undefined;
    throw new InstructionSetError(res.status, i18n.global.t("instructions.error.save"), code, index);
  }
  return json<T>(res);
}

const limit = (v: unknown, fallback: number) => (typeof v === "number" && v > 0 ? v : fallback);

function setOf(raw: Partial<InstructionSet>): InstructionSet {
  return {
    presetId: String(raw.presetId ?? ""),
    title: String(raw.title ?? ""),
    items: Array.isArray(raw.items) ? raw.items.map(String) : [],
    cardCount: typeof raw.cardCount === "number" ? raw.cardCount : 0,
    lastUpdateTime: String(raw.lastUpdateTime ?? ""),
  };
}

export async function listInstructionSets(token: string): Promise<InstructionSetList> {
  const raw = await read<Partial<InstructionSetList> & { list?: Partial<InstructionSet>[] }>(
    await fetch(`${UPSTREAM_API}/open/v1/player/directive-presets`, { headers: authHeaders(token) }),
  );
  return {
    list: (raw.list ?? []).map(setOf),
    maxCount: limit(raw.maxCount, FALLBACK.maxCount),
    maxItems: limit(raw.maxItems, FALLBACK.maxItems),
    maxLength: limit(raw.maxLength, FALLBACK.maxLength),
    maxTitle: limit(raw.maxTitle, FALLBACK.maxTitle),
  };
}

/** 沒有 presetId 是新增；有就是改那一組。名稱與每一條先去掉前後空白再送。 */
export async function saveInstructionSet(token: string, input: { presetId?: string; title: string; items: string[] }): Promise<InstructionSet> {
  const body: Record<string, unknown> = { title: input.title.trim(), items: input.items.map((s) => s.trim()) };
  if (input.presetId) body.presetId = input.presetId;
  const raw = await read<{ preset?: Partial<InstructionSet> }>(
    await fetch(`${UPSTREAM_API}/open/v1/player/directive-preset/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify(body),
    }),
  );
  return setOf(raw.preset ?? {});
}

export async function deleteInstructionSet(token: string, presetId: string): Promise<void> {
  await read<unknown>(
    await fetch(`${UPSTREAM_API}/open/v1/player/directive-preset/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ presetId }),
    }),
  );
}

// ---- 輸入檢查：與伺服器同一套規則，讓伺服器的錯誤只是後備 ----

/** 字數照伺服器算法（Unicode 字元），不是 JS 的 UTF-16 長度：emoji 算一個字。 */
export const charCount = (s: string): number => Array.from(s).length;

export type ItemProblem = "empty" | "tooLong" | "chars";
export type TitleProblem = "empty" | "tooLong";

export function itemProblem(text: string, maxLength: number): ItemProblem | null {
  const v = text.trim();
  if (!v) return "empty";
  if (charCount(v) > maxLength) return "tooLong";
  if (/[<>]/.test(v)) return "chars";
  return null;
}

export function titleProblem(title: string, maxTitle: number): TitleProblem | null {
  const v = title.trim();
  if (!v) return "empty";
  if (charCount(v) > maxTitle) return "tooLong";
  return null;
}

export interface SetCheck { title: TitleProblem | null; items: (ItemProblem | null)[]; count: "none" | "tooMany" | null; ok: boolean }

export function checkInstructionSet(title: string, items: string[], limits: Pick<InstructionLimits, "maxItems" | "maxLength" | "maxTitle">): SetCheck {
  const t = titleProblem(title, limits.maxTitle);
  const each = items.map((s) => itemProblem(s, limits.maxLength));
  const count = items.length === 0 ? "none" : items.length > limits.maxItems ? "tooMany" : null;
  return { title: t, items: each, count, ok: !t && !count && each.every((p) => p === null) };
}

/** 伺服器的單條錯誤碼 → 畫面上那一條的原因。 */
export function itemProblemOfCode(code: string): ItemProblem | null {
  return code === "DIRECTIVE_EMPTY" ? "empty" : code === "DIRECTIVE_TOO_LONG" ? "tooLong" : code === "DIRECTIVE_INVALID_CHARS" ? "chars" : null;
}

/** 刪除確認的後果句：有卡在用就講幾張卡會受影響，沒有就只講既有存檔不受影響。 */
export function deleteConsequence(cardCount: number): { key: "instructions.delete.body.used" | "instructions.delete.body.unused"; n: number } {
  return cardCount > 0 ? { key: "instructions.delete.body.used", n: cardCount } : { key: "instructions.delete.body.unused", n: 0 };
}
