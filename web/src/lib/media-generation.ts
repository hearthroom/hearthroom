import { ApiError, describeApiError } from "./api";
import { apiBaseOf, type ProviderId } from "./provider";

/**
 * 以登入身分生成圖片（Harbor /open/v1/generations），只扣購買點數，要 media.generate 授權；
 * 存進資源庫另外要 role.write。錯誤是 OpenAI 信封 {error:{type,code,message}}，
 * 丟出的 ApiError.code 取 error.code，沒有就取 error.type，畫面按 status 與 code 說話。
 */
export interface GenerationModel {
  id: string;
  name: string;
  /** 每張最低價；有幾檔價（依尺寸）時畫面寫「起」。 */
  credits: number;
  priced: number;
  sizes: string[];
  maxImages: number;
}
export interface GenerationTask {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  urls: string[];
  code?: string;
}
/** 存到哪裡：真的資料夾給 folderIds，只以路徑存在的夾給 directory，根目錄不給。 */
export type SaveTarget = { folderIds?: string[]; directory?: string };

const POLL_MS = 3000;

function task(raw: Record<string, any>): GenerationTask {
  return {
    id: String(raw.id ?? ""),
    status: raw.status ?? "in_progress",
    urls: (raw.data ?? []).map((d: { url: string }) => d.url).filter(Boolean),
    ...(raw.error?.code ? { code: String(raw.error.code) } : {}),
  };
}

export function generationClient(provider: ProviderId, credentials: (rejectedToken?: string) => Promise<string | null>) {
  const base = `${apiBaseOf(provider)}/open/v1/generations`;
  async function call(path: string, init: RequestInit = {}) {
    const token = await credentials();
    if (!token) throw new ApiError(401, describeApiError(401, ""));
    const send = (bearer: string) => fetch(base + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${bearer}` } });
    let r = await send(token);
    if (r.status === 401) {
      const renewed = await credentials(token);
      if (renewed && renewed !== token) r = await send(renewed);
    }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = String(body.error?.code || body.error?.type || "");
      throw new ApiError(r.status, describeApiError(r.status, ""), code);
    }
    return { status: r.status, body };
  }
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    call(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  return {
    async models(): Promise<GenerationModel[]> {
      const { body } = await call("/models");
      return (body.data ?? [])
        .filter((m: any) => m.type === "image" && m.capabilities?.sizes?.length)
        .map((m: any) => {
          const prices = Object.values(m.pricing?.credits ?? {}).map(Number).filter(Number.isFinite);
          return {
            id: String(m.id),
            name: String(m.name || m.id),
            credits: prices.length ? Math.min(...prices) : 0,
            priced: prices.length,
            sizes: m.capabilities.sizes.map(String),
            maxImages: Math.max(1, Number(m.capabilities.max_images) || 1),
          };
        })
        .sort((a: GenerationModel, b: GenerationModel) => a.credits - b.credits);
    },
    /** 同一個 key 重送是同一個任務、只扣一次；換一次生成就換一個 key。 */
    async create(input: { model: string; prompt: string; size: string; n: number }, idempotencyKey: string): Promise<GenerationTask> {
      const { status, body } = await post("/images", input, { "Idempotency-Key": idempotencyKey });
      // 200 是等到了結果（任務在 harbor 底下）；202 回的就是任務本身，要接著查。
      return status === 200 ? { ...task(body.harbor ?? {}), status: "completed", urls: task(body).urls } : task(body);
    },
    async get(id: string): Promise<GenerationTask> {
      return task((await call(`/${encodeURIComponent(id)}`)).body);
    },
    /** 一直查到完成或失敗；aborted() 為真就停（頁面關了）。 */
    async wait(first: GenerationTask, aborted: () => boolean, delay = POLL_MS): Promise<GenerationTask> {
      let t = first;
      while (t.status !== "completed" && t.status !== "failed" && !aborted()) {
        await new Promise((r) => setTimeout(r, delay));
        if (aborted()) break;
        t = await this.get(t.id);
      }
      return t;
    },
    /** 冪等：存過的任務回同一批檔案。 */
    async save(id: string, target: SaveTarget): Promise<string[]> {
      const { body } = await post(`/${encodeURIComponent(id)}/save`, target);
      return (body.asset_ids ?? []).map(String);
    },
  };
}
export type GenerationClient = ReturnType<typeof generationClient>;
