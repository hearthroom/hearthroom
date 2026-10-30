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
  /** 同一模型分線路上架時的線路名（已照 language 在地化）；同名的幾個模型靠它分得出來。 */
  laneName?: string;
  /** 每張最低價；有幾檔價（依尺寸）時畫面寫「起」。 */
  credits: number;
  priced: number;
  sizes: string[];
  maxImages: number;
  /** 一次最多帶幾張參考圖（資源庫裡本人的圖）；0 是這個模型不收參考圖。 */
  maxReferences: number;
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
  async function call(path: string, init: RequestInit = {}, prefix = base) {
    const token = await credentials();
    if (!token) throw new ApiError(401, describeApiError(401, ""));
    const send = (bearer: string) => fetch(prefix + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${bearer}` } });
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
    /** language：頁面目前的語言（zh-Hant／zh-Hans／en／ja／ko），線路名照它回。 */
    async models(language?: string): Promise<GenerationModel[]> {
      const { body } = await call("/models" + (language ? `?${new URLSearchParams({ language })}` : ""));
      return (body.data ?? [])
        .filter((m: any) => m.type === "image" && m.capabilities?.sizes?.length)
        .map((m: any) => {
          const prices = Object.values(m.pricing?.credits ?? {}).map(Number).filter(Number.isFinite);
          return {
            id: String(m.id),
            name: String(m.name || m.id),
            ...(m.lane_name ? { laneName: String(m.lane_name) } : {}),
            credits: prices.length ? Math.min(...prices) : 0,
            priced: prices.length,
            sizes: m.capabilities.sizes.map(String),
            maxImages: Math.max(1, Number(m.capabilities.max_images) || 1),
            maxReferences: Math.max(0, Number(m.capabilities.max_reference_images) || 0),
          };
        })
        .sort((a: GenerationModel, b: GenerationModel) => a.credits - b.credits);
    },
    /** 同一個 key 重送是同一個任務、只扣一次；換一次生成就換一個 key。images 是參考圖（本人資源庫的網址）。 */
    async create(input: { model: string; prompt: string; size: string; n: number; images?: string[] }, idempotencyKey: string): Promise<GenerationTask> {
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
    /**
     * 存好的檔案在資源庫的網址（編輯器要直接填進欄位）。Harbor 存檔時檔名帶任務 id 前八碼，
     * 用它搜尋，再按 asset id 對上；找不到的就少一個，畫面請作者去資源庫挑。
     */
    async savedUrls(id: string, assetIds: string[]): Promise<string[]> {
      const q = new URLSearchParams({ scope: "all", kind: "image", q: id.slice(0, 8), pageSize: "20" });
      const { body } = await call(`/list?${q}`, {}, `${apiBaseOf(provider)}/open/v1/image`);
      const list: { id: unknown; imageUrl?: string }[] = body.data?.imageList ?? [];
      return assetIds.map((a) => list.find((i) => String(i.id) === a)?.imageUrl ?? "").filter(Boolean);
    },
  };
}
export type GenerationClient = ReturnType<typeof generationClient>;
