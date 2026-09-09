/**
 * 遊戲頁的設定：模型／線路／思考深度、玩家人設、長期指令。都是開放 API v1 既有端點，
 * 跟舞台聊天頁讀寫同一份資料——在遊戲裡選的模型，回到對話頁也是那個。
 */

const headers = (token: string, lang: string) => ({ "content-type": "application/json", authorization: `Bearer ${token}`, language: lang });
const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as T;
};

export type PersonaMode = "name_only" | "global" | "custom";
export interface RoleSettings {
  personaMode: PersonaMode | "";
  userName: string;
  userSex: "man" | "women" | "other" | "";
  userDefine: string;
  selectModel: string;
  context: number;
  thinkingDepth: string;
  sandboxLevel: string;
  jailbreak: string;
}
export interface RoleSettingsBundle { settings: RoleSettings; globalPersona: { userName?: string; userSex?: string; userDefine?: string } }

const asText = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export async function fetchRoleSettings(base: string, token: string, lang: string, roleId: string): Promise<RoleSettingsBundle> {
  const q = new URLSearchParams({ roleId });
  const raw = await json<Record<string, unknown>>(await fetch(`${base}/open/v1/player/role-settings?${q}`, { headers: headers(token, lang) }));
  const ctx = Number(raw.context);
  const gp = (raw.globalPersona && typeof raw.globalPersona === "object" ? raw.globalPersona : {}) as Record<string, unknown>;
  return {
    settings: {
      personaMode: asText(raw.personaMode) as RoleSettings["personaMode"],
      userName: asText(raw.userName), userSex: asText(raw.userSex) as RoleSettings["userSex"], userDefine: asText(raw.userDefine),
      selectModel: asText(raw.selectModel), context: Number.isFinite(ctx) && ctx > 0 ? ctx : 1, thinkingDepth: asText(raw.thinkingDepth),
      sandboxLevel: asText(raw.sandboxLevel), jailbreak: asText(raw.jailbreak),
    },
    globalPersona: { userName: asText(gp.userName), userSex: asText(gp.userSex), userDefine: asText(gp.userDefine) },
  };
}

/** 只送改了的欄位；動到人設三欄時把 personaMode 一起帶上（伺服器對缺模式的舊客戶端會推定成「單獨設置」） */
export async function saveRoleSettings(base: string, token: string, lang: string, roleId: string, before: RoleSettings, after: RoleSettings): Promise<{ ok: true } | { ok: false; reason: string }> {
  const changed: Partial<RoleSettings> = {};
  for (const k of Object.keys(after) as (keyof RoleSettings)[]) if (after[k] !== before[k]) (changed as Record<string, unknown>)[k] = after[k];
  if (!Object.keys(changed).length) return { ok: true };
  if (!("personaMode" in changed) && ("userName" in changed || "userSex" in changed || "userDefine" in changed) && after.personaMode) changed.personaMode = after.personaMode;
  const res = await fetch(`${base}/open/v1/player/role-settings/save`, { method: "POST", headers: headers(token, lang), body: JSON.stringify({ roleId, ...changed }) });
  if (res.ok) return { ok: true };
  const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return { ok: false, reason: String(body.error || body.message || res.status) };
}

export interface Directive { sourceId: string; text: string; origin?: string; status?: string }
export interface DirectiveList { list: Directive[]; maxCount: number; maxLength: number }

const readDirectives = (raw: Record<string, unknown>): DirectiveList => {
  const list = Array.isArray(raw.list) ? (raw.list as Record<string, unknown>[]) : [];
  const maxCount = Number(raw.maxCount), maxLength = Number(raw.maxLength);
  return {
    list: list.filter((r) => r && r.sourceId).map((r) => ({ sourceId: String(r.sourceId), text: asText(r.text), origin: asText(r.origin), status: asText(r.status) })),
    maxCount: Number.isFinite(maxCount) && maxCount > 0 ? maxCount : 10,
    maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : 200,
  };
};

export async function fetchDirectives(base: string, token: string, lang: string, conversationId: string): Promise<DirectiveList> {
  const q = new URLSearchParams({ conversationId });
  return readDirectives(await json<Record<string, unknown>>(await fetch(`${base}/open/v1/conversation/directives?${q}`, { headers: headers(token, lang) })));
}
export async function addDirective(base: string, token: string, lang: string, conversationId: string, text: string): Promise<DirectiveList> {
  return readDirectives(await json<Record<string, unknown>>(await fetch(`${base}/open/v1/conversation/directive/add`, { method: "POST", headers: headers(token, lang), body: JSON.stringify({ conversationId, text }) })));
}
export async function updateDirective(base: string, token: string, lang: string, conversationId: string, sourceId: string, text: string): Promise<DirectiveList> {
  return readDirectives(await json<Record<string, unknown>>(await fetch(`${base}/open/v1/conversation/directive/update`, { method: "POST", headers: headers(token, lang), body: JSON.stringify({ conversationId, sourceId, text }) })));
}
export async function deleteDirective(base: string, token: string, lang: string, conversationId: string, sourceId: string): Promise<DirectiveList> {
  return readDirectives(await json<Record<string, unknown>>(await fetch(`${base}/open/v1/conversation/directive/delete`, { method: "POST", headers: headers(token, lang), body: JSON.stringify({ conversationId, sourceId }) })));
}
