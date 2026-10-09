/**
 * 資源庫的檔案型別：上傳前宣稱什麼型別、歸哪一類、檔案挑選器要放哪些副檔名。
 *
 * 宣稱的型別要是資源庫認得的那個寫法：直傳的意向只認標準型別（application/x-javascript、
 * video/x-m4v 會被當成不支援），而 JS 與 JSON 沒有魔術位元組，伺服器只在宣稱了才收。
 * 瀏覽器給的 file.type 常是空的（.mjs、.wasm）或別名，所以副檔名認得就以副檔名為準。
 */

/** 副檔名 → 標準型別。.mov 也列著：用來在上傳前認出它、請作者改傳 MP4，不在挑選器上提供。 */
const EXTENSION_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
};

const ALIASES: Record<string, string> = {
  "application/javascript": "text/javascript",
  "application/x-javascript": "text/javascript",
  "text/x-javascript": "text/javascript",
  "video/x-m4v": "video/mp4",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "application/ogg": "audio/ogg",
  "image/jpg": "image/jpeg",
};

const LABELS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/gif": "GIF",
  "image/webp": "WebP",
  "image/svg+xml": "SVG",
  "video/mp4": "MP4",
  "video/webm": "WebM",
  "audio/mpeg": "MP3",
  "audio/wav": "WAV",
  "audio/ogg": "OGG",
  "font/woff": "WOFF",
  "font/woff2": "WOFF2",
  "font/ttf": "TTF",
  "font/otf": "OTF",
  "text/javascript": "JS",
  "application/wasm": "WASM",
  "application/json": "JSON",
};

export const QUICKTIME = "video/quicktime";

const extensionOf = (name: string) => /\.[^./\\]+$/.exec(name)?.[0].toLowerCase() ?? "";

/** 上傳時宣稱的型別。 */
export function canonicalType(file: { name: string; type: string }): string {
  const named = EXTENSION_TYPES[extensionOf(file.name)];
  if (named) return named;
  const declared = file.type.split(";")[0]!.trim().toLowerCase();
  return ALIASES[declared] ?? (declared || "application/octet-stream");
}

/** 資源庫的分類，跟伺服器一致：JS、WASM 是 code，JSON 是 data，其餘看型別前綴。認不出來回空字串。 */
export function kindOf(type: string): string {
  if (type === "text/javascript" || type === "application/wasm") return "code";
  if (type === "application/json") return "data";
  const prefix = type.split("/")[0]!;
  return ["image", "video", "audio", "font"].includes(prefix) ? prefix : "";
}

export function formatLabel(type: string): string {
  return LABELS[type] ?? type.split("/")[1]?.toUpperCase() ?? type;
}

/**
 * 檔案挑選器的 accept。型別旁邊一定放副檔名：挑選器多半照作業系統的型別判斷，
 * .mjs、.wasm 這類它說不出型別的檔會變灰、選不到。
 */
export function acceptFor(formats: string[], kind: string): string {
  if (!formats.length) {
    if (kind === "all") return "";
    if (kind === "font") return ".woff,.woff2,.ttf,.otf";
    if (kind === "code") return ".js,.mjs,.wasm";
    if (kind === "data") return ".json";
    return kind + "/*";
  }
  const picked = formats.filter((f) => kind === "all" || kindOf(f) === kind);
  const extensions = Object.entries(EXTENSION_TYPES)
    .filter(([, type]) => picked.includes(type))
    .map(([ext]) => ext);
  return [...picked, ...extensions].join(",");
}
