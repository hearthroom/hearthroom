let installToken: string | undefined;
/** 隨機安裝識別不含帳號或裝置資訊；儲存不可用時，同一頁的請求仍共用一個值。 */
export function deviceToken(): string {
  if (installToken) return installToken;
  const key = "hr.rewards.device";
  try {
    const saved = localStorage.getItem(key);
    if (saved && /^[A-Za-z0-9_.-]{16,128}$/.test(saved)) return (installToken = saved);
  } catch { /* 儲存被封鎖，改用本頁的隨機值。 */ }
  installToken = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem(key, installToken); } catch { /* 保留記憶體中的值。 */ }
  return installToken;
}

