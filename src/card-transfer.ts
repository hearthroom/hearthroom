import { upstreamSyncError, syncStep } from "./sync-error";
import { readBooks, writeBooks, type TransferProgress } from "./card-transfer-resources";
import {
  imageReference,
  registerImageReference,
  MEDIA_FIELDS,
  type CardMedia,
} from "./card-media";
import { apiBaseOf, type ProviderId } from "./providers";
import { HttpError, type Env } from "./types";

/**
 * 跨站搬運走的是兩家共用的供應方契約（docs/openapi.json）：建卡、document、welcome、
 * author-asset、worldbook、publish 在兩家是同一組路由與同一組欄位，所以這裡沒有
 * 供應商分支。搬的範圍：文字四欄、封面網址（只搬引用不搬位元組）、契約欄位、
 * 開場白備選與序章、綁定的世界書（整本條目）、作者資產（正則規則與功能欄）。
 * 不搬：目標站自己翻的多語譯文。
 */
export interface TransferEntry {
  name: string;
  content: string;
  keywords: string[];
  secondaryKeywords: string[];
  matchOptions?: unknown;
  isEnabled: boolean;
  isConstant: boolean;
  category: string;
  triggerRegion: string;
}
export interface TransferWorldbook {
  /** 來源站的世界書 id；只用來對照目標站那一本（work_copies.worldbooks），不進雜湊。 */
  sourceId: string;
  metadata?: Record<string, any>;
  name: string;
  entries: TransferEntry[];
}
export interface TransferAsset {
  rules: unknown[];
  mountTrigger: string;
  mountLayer: string;
  pageMode: string;
}
export interface TransferCard {
  name: string;
  summary: string;
  description: string;
  greeting: string;
  language: string;
  media?: CardMedia;
  fields?: Record<string, unknown>;
  translations?: Record<string,{name:string;summary:string;description:string;greeting:string}>;
  welcome?: { alternates: string[]; prologue: string[] };
  worldbooks?: TransferWorldbook[];
  /** null＝來源沒有作者資產（目標若有要拿掉）；undefined＝沒讀（測試的假來源）。 */
  authorAsset?: TransferAsset | null;
}
export interface TransferRead {
  card: TransferCard;
  public: boolean;
  pending?: boolean;
}
/** 來源世界書 id → 目標世界書 id。再同步時據此覆寫那一本，而不是每次多建一本。 */
export type WorldbookMap = Record<string, string>;

async function request(
  env: Env,
  p: ProviderId,
  token: string,
  path: string,
  body?: unknown,
  method?: string
) {
  return fetch(`${apiBaseOf(env, p)}/open/v1${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "HearthRoom/1.0",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // Workers supports manual/follow only. Non-2xx is rejected below; never forward tokens to redirects.
    redirect: "manual",
    signal: AbortSignal.timeout(20000),
  }).catch(() => { throw new HttpError(502,"sync_network_failed",{provider:p,step:syncStep(path)}); });
}
async function parse(r: Response, p: ProviderId, path: string) {
  if (r.status === 204 || r.status === 202) return {};
  const text = await r.text();
  try {
    const value = text ? JSON.parse(text) : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, any>;
  } catch {
    throw new HttpError(502, "sync_invalid_response", {provider:p,step:syncStep(path),upstreamStatus:r.status});
  }
}
async function call(
  env: Env,
  p: ProviderId,
  token: string,
  path: string,
  body?: unknown,
  method?: string
) {
  const r = await request(env, p, token, path, body, method);
  if (!r.ok) throw await upstreamSyncError(r,p,path);
  return parse(r,p,path);
}
/** 404＝這一項在那邊不存在（例如還沒有作者資產），不是失敗。 */
async function callOptional(env: Env, p: ProviderId, token: string, path: string) {
  const r = await request(env, p, token, path);
  if (r.status === 404) return null;
  if (!r.ok) throw await upstreamSyncError(r,p,path);
  return parse(r,p,path);
}
const text = (v: unknown) => (typeof v === "string" ? v : "");
/** 字串陣列：上游有時給 JSON 字串、有時給陣列；空白項丟掉。 */
const strings = (v: unknown): string[] => {
  let parsed: unknown = v;
  if (typeof v === "string") {
    if (!v.trim()) return [];
    try {
      parsed = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];
};
/**
 * 條目收斂成兩家讀回都一樣的形狀：關鍵詞去空白、預設值歸零。雜湊比對是「來源讀一次、
 * 目標讀一次」，任何一邊多一個預設值就永遠對不上，同步會一直報 readback mismatch。
 */
function normalizeEntry(e: Record<string, any>): TransferEntry {
  const words = (v: unknown) => strings(v).map((s) => s.trim()).filter(Boolean);
  const category = text(e.category);
  const region = text(e.triggerRegion);
  return {
    name: text(e.name).trim(),
    content: text(e.content),
    keywords: words(e.keywords),
    secondaryKeywords: words(e.secondaryKeywords),
    ...(e.matchOptions && typeof e.matchOptions === "object" ? { matchOptions: e.matchOptions } : {}),
    isEnabled: e.isEnabled !== false,
    isConstant: e.isConstant === true,
    category: category === "custom" ? "" : category,
    triggerRegion: region === "both" ? "" : region,
  };
}
async function readWorldbooks(env: Env, p: ProviderId, token: string, roleId: string): Promise<TransferWorldbook[]> {
  const books = await readBooks((path,body,method)=>call(env,p,token,path,body,method),roleId);
  return books.map(b=>({sourceId:b.sourceId,name:String(b.metadata.name),metadata:b.metadata,entries:b.entries.map(normalizeEntry)})).sort((a,b)=>a.name.localeCompare(b.name));
}
function normalizeAsset(a: Record<string, any> | null): TransferAsset | null {
  if (!a) return null;
  const asset = {
    rules: Array.isArray(a.rules) ? a.rules : [],
    mountTrigger: text(a.mountTrigger),
    mountLayer: text(a.mountLayer),
    pageMode: text(a.pageMode),
  };
  return asset.rules.length || asset.mountTrigger || asset.pageMode ? asset : null;
}
async function read(
  env: Env,
  p: ProviderId,
  token: string,
  id: string,
  owner: number
): Promise<TransferRead> {
  const r = await call(
    env,
    p,
    token,
    `/role/detail?roleId=${encodeURIComponent(id)}`
  );
  if (Number(r.accountNumId) !== owner)
    throw new HttpError(403, "sync_not_owner");
  if (!("roleDetailDesc" in r))
    throw new HttpError(409, "sync_private_content_unavailable");
  // Transfer the common text and image contract. Reject richer fields that cannot be preserved.
  for (const key of [
    "roleSpeech",
  ]) {
    const v = r[key];
    if (
      (typeof v === "string" && v.trim() && v !== "[]" && v !== "{}") ||
      (Array.isArray(v) && v.length) || (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length)
    )
      throw new HttpError(409, "sync_unsupported_content");
  }
  const translations:NonNullable<TransferCard['translations']>={};
  for(const [language,suffix] of [['en','En'],['ja','Ja'],['ko','Ko']]) {
   if(language===text(r.language))continue;
   const name=text(r['roleName'+suffix]);
   if(name) {
    if(!('roleDetailDesc'+suffix in r))throw new HttpError(409,'sync_private_content_unavailable');
    translations[language]={name,summary:text(r['roleDesc'+suffix]),description:text(r['roleDetailDesc'+suffix]),greeting:text(r['roleWelcome'+suffix])};
   }
  }
  const fields: Record<string, unknown> = {};
  for (const key of ["roleOutputContract", "userName", "nickname", "roleSex", "roleType"]) fields[key] = text(r[key]);
  // Accept older responses, but write the current shared public field.
  fields.customInstructions = text(r.customInstructions) || text(r.jailbreak);
  const list = (v: unknown): unknown[] => {
    if (v == null || v === '') return [];
    try { const parsed = typeof v === 'string' ? JSON.parse(v) : v; if (Array.isArray(parsed)) return parsed; } catch {}
    throw new HttpError(409,'sync_unsupported_content');
  };
  if(r.cardMeta && (typeof r.cardMeta==='object'||typeof r.cardMeta==='string')) {
   try {const meta=typeof r.cardMeta==='string'?JSON.parse(r.cardMeta):r.cardMeta;if(meta&&Object.keys(meta).length)fields.cardMeta=meta;}catch{throw new HttpError(409,'sync_unsupported_content')}
  }
  fields.roleTag = list(r.roleTag).map((tag: any) => {
    if (typeof tag === "string") return tag;
    const name = tag && (text(tag.text) || text(tag.tagName));
    if (!name) throw new HttpError(409, "sync_unsupported_content");
    return name;
  });
  fields.talkExample = list(r.talkExample).map((v:any) => {
    if (!v || typeof v.roleType !== 'string' || typeof v.content !== 'string') throw new HttpError(409,'sync_unsupported_content');
    return {roleType:v.roleType,content:v.content};
  });
  const media: CardMedia = {};
  for (const field of MEDIA_FIELDS) {
    const key = `role${field[0].toUpperCase()}${field.slice(1)}`;
    if (text(r[key])) media[field] = imageReference(env, p, text(r[key]));
  }
  const welcome = {
    alternates: strings(r.welcomeAlternates ?? r.roleWelcomeAlternates ?? r.alternates),
    prologue: strings(r.rolePrologue ?? r.prologue),
  };
  const worldbooks = await readWorldbooks(env, p, token, id);
  const authorAsset = normalizeAsset(await callOptional(env, p, token, `/role/author-asset?roleId=${encodeURIComponent(id)}`));
  return {
    card: {
      fields,
      ...(Object.keys(translations).length?{translations}:{}),
      ...(Object.keys(media).length ? { media } : {}),
      name: text(r.roleName),
      summary: text(r.roleDesc),
      description: text(r.roleDetailDesc),
      greeting: text(r.roleWelcome),
      language: text(r.language) || "zh",
      welcome,
      worldbooks,
      authorAsset,
    },
    public: p === "lunatalk" && r.roleVisibility === "public",
    pending: p === "lunatalk" && r.reviewStatus === "pending",
  };
}
async function create(
  env: Env,
  p: ProviderId,
  token: string,
  c: TransferCard,
  key: string
): Promise<string> {
  const r = await call(env, p, token, "/role", {
    roleName: c.name,
    language: c.language,
    origin: "hearthroom",
    idempotencyKey: key,
  });
  const id = r.roleId;
  if (typeof id !== "string" || !id)
    throw new HttpError(502, "sync_create_unconfirmed");
  return id;
}
/**
 * 把一張卡的內容寫進目標站的 `id`。`books` 是上一次的世界書對照，回傳這一次的（多了新建的那幾本）。
 * checkpoint 在每個階段之後呼叫，讓呼叫端記下目標的版本，中途斷掉能安全重試。
 */
async function update(
  env: Env,
  p: ProviderId,
  token: string,
  id: string,
  c: TransferCard,
  checkpoint?: () => Promise<void>,
  progress: TransferProgress | WorldbookMap = {books:{}},
  saveProgress: () => Promise<void> = async()=>{}
): Promise<WorldbookMap> {
  const images: Record<string, string> = {};
  for (const field of MEDIA_FIELDS)
    images[field] = c.media?.[field]
      ? await registerImageReference(env, p, token, c.media[field]!, id)
      : "";
  await call(env, p, token, `/role/${encodeURIComponent(id)}/document`, {
    fields: {
      roleName: c.name,
      roleDesc: c.summary,
      roleDetailDesc: c.description,
      roleWelcome: c.greeting,
      roleAvatar: images.avatar,
      roleBackground: images.background,
      roleBackgroundLandscape: images.backgroundLandscape,
      ...(c.fields ?? {}),
    },
  });
  await checkpoint?.();
  if (c.welcome)
    await call(env, p, token, `/role/${encodeURIComponent(id)}/welcome`, {
      roleWelcome: c.greeting,
      alternates: c.welcome.alternates,
      prologue: c.welcome.prologue,
    }, "PATCH");
  if (c.authorAsset !== undefined) {
    // 整份覆寫帶樂觀鎖：版本要先從目標讀。
    const current = await callOptional(env, p, token, `/role/author-asset?roleId=${encodeURIComponent(id)}`);
    if (c.authorAsset)
      await call(env, p, token, `/role/${encodeURIComponent(id)}/author-asset`, { ...c.authorAsset, version: Number(current?.version) || 0 }, "PUT");
    else if (normalizeAsset(current))
      await call(env, p, token, `/role/${encodeURIComponent(id)}/author-asset`, undefined, "DELETE");
  }
  for(const [locale,content] of Object.entries(c.translations??{})) {
   if(p==='harbor')await call(env,p,token,`/roles/${encodeURIComponent(id)}/locales`,{locale,...content,source:'human',source_locale:c.language});
   else {
    const suffix=({en:'En',ja:'Ja',ko:'Ko'} as Record<string,string>)[locale];
    await call(env,p,token,`/role/${encodeURIComponent(id)}/document`,{fields:{['roleName'+suffix]:content.name,['roleDesc'+suffix]:content.summary,['roleDetailDesc'+suffix]:content.description,['roleWelcome'+suffix]:content.greeting}});
   }
   await checkpoint?.();
  }
  const state:TransferProgress = typeof progress.books==='object' ? progress as TransferProgress : {books:Object.fromEntries(Object.entries(progress).map(([sourceId,id])=>[sourceId,{id,status:'created' as const}]))};
  await writeBooks((path,body,method)=>call(env,p,token,p==='harbor'&&path==='/worldbook'?path+'?roleId='+encodeURIComponent(id):path,body,method),id,
    (c.worldbooks??[]).map(b=>({sourceId:b.sourceId,metadata:b.metadata??{name:b.name,language:c.language},entries:b.entries})),state,saveProgress,async()=>{await checkpoint?.()},p==='harbor'?'prepend-batches':'whole-book');
  if(p==='harbor')await call(env,p,token,`/role/${encodeURIComponent(id)}/visibility`,{visibility:'unlisted'});
  return Object.fromEntries(Object.entries(state.books).filter(([,v])=>v.id).map(([k,v])=>[k,v.id!]));
}
async function publish(
  env: Env,
  p: ProviderId,
  token: string,
  id: string
) {
  await call(env, p, token, `/role/${encodeURIComponent(id)}/publish`, {
    userConfirmed: true,
    confirmationSummary: "Publish my synchronized HearthRoom character card.",
  });
}
async function unpublish(env:Env,p:ProviderId,token:string,id:string) {
 await call(env,p,token,`/role/${encodeURIComponent(id)}/visibility`,{visibility:p==='harbor'?'unlisted':'private'});
}
export const transfers = { read, create, update, publish, unpublish };
