// Node 26 起，執行環境自己帶了一個 globalThis.localStorage；沒給 --localstorage-file
// 時它讀不到也寫不進去。而這個測試環境的 window 也沒有自己的 Storage，於是程式裡
// 每一處「存一下再讀回來」（選了哪一家供應商、成人閘門、登入憑證）在測試裡都靜默
// 失效——整套測試會紅得像產品壞了，其實只是儲存不見了。
//
// 這裡補一份最小的 Storage，行為跟瀏覽器一致：存得進去、讀得回來、清得掉。
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.has(key) ? this.data.get(key)! : null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

function usable(candidate: unknown): boolean {
  try {
    const store = candidate as Storage | undefined;
    if (!store) return false;
    store.setItem("__probe__", "1");
    const ok = store.getItem("__probe__") === "1";
    store.removeItem("__probe__");
    return ok;
  } catch {
    return false;
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  if (usable((globalThis as Record<string, unknown>)[name])) continue;
  const store = new MemoryStorage();
  Object.defineProperty(globalThis, name, { value: store, configurable: true, writable: true });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, { value: store, configurable: true, writable: true });
  }
}
