/**
 * 頭像裁切：在主頁上原地拖、縮放，存之前在瀏覽器裡切成正方形再上傳。
 *
 * 伺服器原本只會從正中間切 512×512，臉不在中間就被切掉（owner 2026-10-19）。
 * 動圖（GIF、APNG、動態 WebP）不在這裡裁——畫進 canvas 只剩第一格，照舊原檔上傳。
 *
 * 取景模型：正方形取景框邊長 viewport，圖片先等比縮到剛好蓋滿框（短邊＝viewport），再乘 zoom；
 * (x, y) 是圖片中心相對框中心的位移，單位是框裡的像素。
 */
export interface CropFrame { width: number; height: number; viewport: number; zoom: number; x: number; y: number }

const scaleOf = (f: CropFrame) => (f.viewport / Math.min(f.width, f.height)) * Math.max(1, f.zoom);

/** 把位移限制在圖片仍然蓋滿取景框的範圍內。 */
export function clampPan(f: CropFrame): { x: number; y: number } {
  const scale = scaleOf(f);
  const maxX = Math.max(0, (f.width * scale - f.viewport) / 2);
  const maxY = Math.max(0, (f.height * scale - f.viewport) / 2);
  const clamp = (v: number, m: number) => Math.min(m, Math.max(-m, v)) + 0;
  return { x: clamp(f.x, maxX), y: clamp(f.y, maxY) };
}

/** 取景框對應到原圖上的正方形（原圖像素）。 */
export function cropRect(f: CropFrame): { sx: number; sy: number; size: number } {
  const scale = scaleOf(f);
  const { x, y } = clampPan(f);
  const size = f.viewport / scale;
  const sx = (f.width * scale / 2 - f.viewport / 2 - x) / scale;
  const sy = (f.height * scale / 2 - f.viewport / 2 - y) / scale;
  return { sx: Math.round(sx), sy: Math.round(sy), size: Math.round(size) };
}

const has = (bytes: Uint8Array, text: string) => {
  const needle = [...text].map((c) => c.charCodeAt(0));
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

/** 會動的圖：GIF 一律算；PNG 有 acTL（APNG）、WebP 有 ANIM 才算。只看檔頭一段。 */
export async function isAnimatedImage(file: Blob): Promise<boolean> {
  if (file.type === 'image/gif' || file.type === 'image/apng') return true;
  if (file.type !== 'image/png' && file.type !== 'image/webp') return false;
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  return file.type === 'image/png' ? has(head, 'acTL') : has(head, 'ANIM');
}

/** 照取景框切出 size×size 的 WebP（瀏覽器不支援 WebP 輸出就退回 PNG）。 */
export async function cropAvatar(file: File, frame: CropFrame, size = 512): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const rect = cropRect({ ...frame, width: bitmap.width, height: bitmap.height });
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, rect.sx, rect.sy, rect.size, rect.size, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    const out = blob && blob.type === 'image/webp' ? blob : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!out) throw new Error('encode failed');
    return new File([out], out.type === 'image/webp' ? 'avatar.webp' : 'avatar.png', { type: out.type });
  } finally {
    bitmap.close();
  }
}
