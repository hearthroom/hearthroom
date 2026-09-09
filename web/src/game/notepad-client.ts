/**
 * 手帳與記憶：開放 API v1 既有端點，跟舞台聊天頁讀寫同一份資料。
 * 面板本體複用舞台的 canvas-notepad / canvas-memory 元件，這裡只負責資料。
 */

const headers = (token: string, lang: string) => ({ "content-type": "application/json", authorization: `Bearer ${token}`, language: lang });

export class ApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) { super(`${status}`); }
  /** 伺服器回的文案 key（分享碼那組錯誤各有各的下一步，直接翻 key） */
  get messageKey(): string { return typeof this.body.messageKey === "string" ? this.body.messageKey : ""; }
  get reason(): string { return String(this.body.error || this.body.message || this.status); }
}

async function call<T = Record<string, unknown>>(base: string, token: string, lang: string, path: string, init?: { method?: string; body?: unknown; query?: Record<string, string> }): Promise<T> {
  const q = init?.query ? `?${new URLSearchParams(init.query)}` : "";
  const res = await fetch(`${base}/open/v1${path}${q}`, { method: init?.method || (init?.body ? "POST" : "GET"), headers: headers(token, lang), body: init?.body ? JSON.stringify(init.body) : undefined });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const asText = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export interface Notepad { content: string; maxLength: number; discountThreshold: number }
export async function fetchNotepad(base: string, token: string, lang: string, conversationId: string): Promise<Notepad> {
  const r = await call(base, token, lang, "/conversation/notepad", { query: { conversationId } });
  const maxLength = Number(r.maxLength), discountThreshold = Number(r.discountThreshold);
  return { content: asText(r.content), maxLength: maxLength > 0 ? maxLength : 10000, discountThreshold: discountThreshold > 0 ? discountThreshold : 2000 };
}
export const saveNotepad = (base: string, token: string, lang: string, conversationId: string, content: string) =>
  call(base, token, lang, "/conversation/notepad/save", { body: { conversationId, content } });

export interface NotepadTemplate { templateId: string; title: string }
export async function fetchTemplates(base: string, token: string, lang: string): Promise<NotepadTemplate[]> {
  const r = await call(base, token, lang, "/notepad/templates");
  const list = Array.isArray(r.list) ? (r.list as Record<string, unknown>[]) : [];
  return list.map((row) => ({ templateId: asText(row.templateId), title: asText(row.title) })).filter((row) => row.templateId);
}
export async function fetchTemplate(base: string, token: string, lang: string, templateId: string): Promise<string> {
  return asText((await call(base, token, lang, "/notepad/template", { query: { templateId } })).content);
}
export const saveTemplate = (base: string, token: string, lang: string, title: string, content: string) => call(base, token, lang, "/notepad/template/save", { body: { title, content } });
export const deleteTemplate = (base: string, token: string, lang: string, templateId: string) => call(base, token, lang, "/notepad/template/delete", { body: { templateId } });
export async function shareTemplate(base: string, token: string, lang: string, templateId: string): Promise<string> {
  return asText((await call(base, token, lang, "/notepad/template/share", { body: { templateId } })).code);
}
export const revokeShare = (base: string, token: string, lang: string, code: string) => call(base, token, lang, "/notepad/template/share/revoke", { body: { code } });
export async function previewShareCode(base: string, token: string, lang: string, code: string): Promise<{ title: string; content: string }> {
  const r = await call(base, token, lang, "/share/preview", { query: { code } });
  return { title: asText(r.title), content: asText(r.content) };
}
export const importShareCode = (base: string, token: string, lang: string, code: string) => call(base, token, lang, "/share/import", { body: { code } });

/** 這個帳號聊過的其他卡（抄手帳的來源） */
export interface NotepadSource { key: string; conversationId: string; name: string }
export async function fetchNotepadSources(base: string, token: string, lang: string, excludeRoleId: string): Promise<NotepadSource[]> {
  const r = await call(base, token, lang, "/conversation/list", { query: { pageNum: "1", pageSize: "50" } });
  const list = Array.isArray(r.conversations) ? (r.conversations as Record<string, unknown>[]) : [];
  return list
    .map((row) => { const key = asText(row.conversationRoleId || row.roleId); return { key, conversationId: asText(row.conversationId), name: asText(row.roleName || row.conversationName) || key }; })
    .filter((row) => row.key && row.conversationId && row.key !== excludeRoleId);
}

const memoryPath = (conversationId: string, atomId?: string) => `/conversation/memory/${encodeURIComponent(conversationId)}/atoms${atomId ? `/${encodeURIComponent(atomId)}` : ""}`;
export const fetchMemoryAtoms = (base: string, token: string, lang: string, conversationId: string) => call<unknown>(base, token, lang, memoryPath(conversationId));
export const deleteMemoryAtom = (base: string, token: string, lang: string, conversationId: string, atomId: string) => call<unknown>(base, token, lang, memoryPath(conversationId, atomId), { method: "DELETE" });
