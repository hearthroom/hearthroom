/**
 * PNG 的 tEXt chunk 讀寫。
 *
 * 角色卡以 PNG 分發是這個生態的事實標準：卡片的 JSON 用 base64 塞在 tEXt chunk 裡
 * （關鍵字 `chara` 是 V2、`ccv3` 是 V3），圖片本身照常顯示。所以一張卡看起來就是一張
 * 立繪，拖進哪個工具都能還原設定——匯入匯出都得在瀏覽器裡自己拆裝 chunk。
 *
 * 自己寫而不是裝 png-chunks-extract + png-chunk-text：這兩個套件加起來做的事就是
 * 下面這一百行，而 CRC 表本來就是照抄規格的常數。
 */

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

/** CRC-32（IEEE 802.3），PNG 規格 §5.5 指定的那一個。表在首次使用時算出來。 */
let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const ascii = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * 拆出所有 chunk。長度欄位是不可信的輸入，每一步都要對著實際 buffer 長度檢查——
 * 一個宣稱 4GB 的 chunk 不該讓瀏覽器去配一段 4GB 的記憶體。
 */
export function readChunks(bytes: Uint8Array): PngChunk[] {
  if (!isPng(bytes)) throw new Error("not_png");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: PngChunk[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const end = at + 12 + length;
    if (length > bytes.length || end > bytes.length) throw new Error("png_truncated");
    const type = ascii(bytes.subarray(at + 4, at + 8));
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at = end;
    if (type === "IEND") break;
  }
  return chunks;
}

export function writeChunks(chunks: PngChunk[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + 12 + c.data.length, SIGNATURE.length);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  out.set(SIGNATURE, 0);
  let at = SIGNATURE.length;
  for (const chunk of chunks) {
    view.setUint32(at, chunk.data.length);
    // CRC 蓋的是「型別 + 資料」，不含長度欄位——所以先把兩者連著寫進去再算。
    for (let i = 0; i < 4; i++) out[at + 4 + i] = chunk.type.charCodeAt(i);
    out.set(chunk.data, at + 8);
    view.setUint32(at + 8 + chunk.data.length, crc32(out.subarray(at + 4, at + 8 + chunk.data.length)));
    at += 12 + chunk.data.length;
  }
  return out;
}

/** tEXt 的內容是 `關鍵字\0Latin-1 文字`。 */
export function decodeText(data: Uint8Array): { keyword: string; text: string } {
  const nul = data.indexOf(0);
  if (nul < 0) return { keyword: "", text: "" };
  return { keyword: ascii(data.subarray(0, nul)), text: ascii(data.subarray(nul + 1)) };
}

export function encodeText(keyword: string, text: string): PngChunk {
  const data = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i++) data[i] = keyword.charCodeAt(i);
  data[keyword.length] = 0;
  for (let i = 0; i < text.length; i++) data[keyword.length + 1 + i] = text.charCodeAt(i);
  return { type: "tEXt", data };
}

/**
 * 讀出指定關鍵字的 tEXt 內容（大小寫不敏感：野生的卡兩種寫法都有）。
 * 找不到回 null，讓呼叫端決定那是「這不是角色卡」還是「換另一個關鍵字再找」。
 */
export function readTextChunk(bytes: Uint8Array, keyword: string): string | null {
  const want = keyword.toLowerCase();
  for (const chunk of readChunks(bytes)) {
    if (chunk.type !== "tEXt") continue;
    const text = decodeText(chunk.data);
    if (text.keyword.toLowerCase() === want) return text.text;
  }
  return null;
}

/**
 * 換掉（或加上）一組 tEXt。舊的同名 chunk 一律先移除：留著的話讀取端多半取第一個，
 * 於是匯出的卡帶著舊資料，而且看起來完全正常。
 */
export function replaceTextChunks(bytes: Uint8Array, entries: { keyword: string; text: string }[]): Uint8Array {
  const drop = new Set(entries.map((e) => e.keyword.toLowerCase()));
  const kept = readChunks(bytes).filter(
    (c) => !(c.type === "tEXt" && drop.has(decodeText(c.data).keyword.toLowerCase())),
  );
  const iend = kept.findIndex((c) => c.type === "IEND");
  const at = iend < 0 ? kept.length : iend;
  kept.splice(at, 0, ...entries.map((e) => encodeText(e.keyword, e.text)));
  return writeChunks(kept);
}

/**
 * UTF-8 ⇄ base64，中間隔一層 Latin-1。
 *
 * `btoa` 只吃 0–255 的碼位，直接餵中文會丟 InvalidCharacterError；而 tEXt 本來就只
 * 裝得下 Latin-1。所以整條路是「UTF-8 位元組 → 每位元組一個字元 → base64」，
 * 兩端必須用同一套轉換，否則非 ASCII 的卡在來回一趟之後會變成亂碼。
 */
export function base64FromUtf8(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

export function utf8FromBase64(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
