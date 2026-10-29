/** 把一個檔案交給瀏覽器下載。 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 檔名裡作業系統不收的字換掉。 */
export const safeFileName = (name: string, fallback: string) => (name || fallback).replace(/[/\\?%*:|"<>]/g, "_").slice(0, 60);
