/**
 * HarperHarbor 供應商模式。
 *
 * 建置時帶 VITE_PROVIDER=harbor，本站就改接 HarperHarbor 的 Provider。它對社群站維持了伺服器端
 * 直接綁定的那幾條舊形狀（/open/v1/me、/role/detail、/role/mine），其餘寫入面走它的新設計：
 *   建卡 /roles、改文字 /roles/{id}/locales（一個語區一整行）、封面 /roles/{id}/assets（資產編號，不是網址）、
 *   上傳 /media/uploads → 直傳 → /media/{id}/complete、公開 /roles/{id}/visibility + /submit。
 * 這個檔只做形狀轉換；呼叫端（api.ts）照舊拿到原本的回傳型別，畫面不必知道接的是哪一家。
 *
 * 對話、世界書、正則、遊戲、評論、圖庫、人設、送審前檢查、刪卡 —— Provider 還沒有，
 * FEATURES 把它們在畫面上收起來，而不是讓按鈕按了才報錯。
 */
import { UPSTREAM_API } from "./config";
import { ApiError } from "./api";
import type { Wallet, ScoreRecordPage } from "./api";
import type { RoleDocumentFields } from "./role-draft";

export { HARBOR, FEATURES } from "./provider";

/** 本站自報的建卡來源；Provider 記在卡上，「我的卡片」與登記只認這種卡。 */
const ORIGIN = "hearthroom";

const url = (path: string) => `${UPSTREAM_API}/open/v1${path}`;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const jsonInit = (token: string, body: unknown, method = "POST"): RequestInit => ({
  method, headers: { ...bearer(token), "Content-Type": "application/json" }, body: JSON.stringify(body),
});

async function read<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error || `HTTP ${res.status}`, body.error ?? "");
  }
  // 受理類回應（204、送審的 202）沒有 body，別硬解析成 JSON
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function harborCreateRole(draft: { roleName: string; language?: string }, token: string): Promise<{ roleId?: string }> {
  const created = await read<{ id?: string }>(await fetch(url("/roles"), jsonInit(token, {
    origin_locale: draft.language || "zh-Hant", name: draft.roleName, origin: ORIGIN,
  })));
  return { roleId: created.id };
}

/**
 * 上傳過的圖：網址 → 資產編號。卡片欄位存的是網址，Provider 收的是編號，
 * 所以只認得「這一頁這次傳上去的圖」。換頁就忘，這是刻意的：舊網址本來就在卡上，不必再送。
 */
const uploaded = new Map<string, string>();

export async function harborUploadImage(file: File, token: string, onProgress?: (fraction: number) => void): Promise<string> {
  const intent = await read<{ assetId: string; upload: { url: string; method: string; headers: Record<string, string> } }>(
    await fetch(url("/media/uploads"), jsonInit(token, { contentType: file.type, byteSize: file.size })),
  );
  // 簽名綁著型別與大小；Content-Length 由瀏覽器自己算，手動設反而會被擋。
  const headers = { ...intent.upload.headers };
  delete headers["Content-Length"];
  const put = await fetch(intent.upload.url, { method: intent.upload.method, headers, body: file });
  if (!put.ok) throw new ApiError(put.status, `upload failed (${put.status})`);
  const asset = await read<{ id: string; url: string }>(await fetch(url(`/media/${encodeURIComponent(intent.assetId)}/complete`), { method: "POST", headers: bearer(token) }));
  uploaded.set(asset.url, asset.id);
  onProgress?.(1);
  return asset.url;
}

type Origin = { language: string; roleName: string; roleDesc: string; roleDetailDesc: string; roleWelcome: string };

/**
 * 存文字與封面。Provider 的語區是整行覆寫：只送改了的欄位會把其餘清空，
 * 所以先讀目前的原文，把改動併進去再整行送。封面另走一條，只送換過的那張。
 */
export async function harborSaveDocument(
  roleId: string,
  fields: RoleDocumentFields & { roleWelcome?: string },
  token: string,
): Promise<void> {
  const covers: Record<string, string> = {};
  for (const [field, key] of [["roleAvatar", "avatar"], ["roleBackground", "background"], ["roleBackgroundLandscape", "backgroundLandscape"]] as const) {
    const value = fields[field];
    if (value === undefined) continue;
    if (value === "") { covers[key] = ""; continue; }
    const assetId = uploaded.get(value);
    if (!assetId) throw new ApiError(400, "this image was not uploaded from this page; upload it again");
    covers[key] = assetId;
  }
  const textKeys = ["roleName", "roleDesc", "roleDetailDesc", "roleWelcome"] as const;
  if (textKeys.some((k) => fields[k] !== undefined)) {
    const current = await read<Partial<Origin>>(await fetch(url(`/role/detail?roleId=${encodeURIComponent(roleId)}`), { headers: bearer(token) }));
    const pick = (k: (typeof textKeys)[number]) => fields[k] ?? current[k] ?? "";
    await read(await fetch(url(`/roles/${encodeURIComponent(roleId)}/locales`), jsonInit(token, {
      locale: current.language, name: pick("roleName"), summary: pick("roleDesc"),
      description: pick("roleDetailDesc"), greeting: pick("roleWelcome"),
    })));
  }
  if (Object.keys(covers).length) {
    await read(await fetch(url(`/roles/${encodeURIComponent(roleId)}/assets`), jsonInit(token, covers)));
  }
}

/** 公開：設為公開並送平台審核。分級由作者宣告，審核人對照內容決定採不採信。 */
export async function harborPublish(roleId: string, mature: boolean, token: string): Promise<void> {
  await read(await fetch(url(`/roles/${encodeURIComponent(roleId)}/visibility`), jsonInit(token, { visibility: "public" })));
  await read(await fetch(url(`/roles/${encodeURIComponent(roleId)}/submit`), jsonInit(token, { content_rating: mature ? "mature" : "general" })));
}

type OpenWallet = { available: number; permanent: number; expiring: number; reserved: number; ledger: { id: string; at: string; reason: string; amount: number }[] };

export async function harborWallet(token: string): Promise<Wallet> {
  const w = await read<OpenWallet>(await fetch(url("/me/wallet"), { headers: bearer(token) }));
  return { score: w.permanent, tempScore: w.expiring, plans: [] };
}

/** Provider 只給本站自己那份最近的流水，不分頁。 */
export async function harborScoreRecords(token: string): Promise<ScoreRecordPage> {
  const w = await read<OpenWallet>(await fetch(url("/me/wallet"), { headers: bearer(token) }));
  const records = w.ledger.map((e, i) => ({
    id: i + 1, record: e.reason, recordType: e.amount >= 0 ? "add" : "sub", score: Math.abs(e.amount), createTime: e.at,
  }));
  return { total: records.length, pages: 1, hasNextPage: false, records };
}
