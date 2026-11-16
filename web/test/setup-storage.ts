import { beforeEach } from 'vitest';
import { resetManagedAuthForTest } from '../src/lib/managed-auth';
// Existing suites exercise an unconfigured self-hosted deployment explicitly.
beforeEach(()=>resetManagedAuthForTest(false));
// Node 26 起，執行環境自己帶了一個 globalThis.localStorage；沒給 --localstorage-file
// 時它讀不到也寫不進去。而這個測試環境的 window 也沒有自己的 Storage，於是程式裡
// 每一處「存一下再讀回來」（選了哪一家供應商、成人閘門、登入憑證）在測試裡都靜默
// 失效——整套測試會紅得像產品壞了，其實只是儲存不見了。
//
// 這裡補一份最小的 Storage，行為跟瀏覽器一致：存得進去、讀得回來、清得掉。
const STORAGE_METHODS = new Set<PropertyKey>([
  "length",
  "clear",
  "getItem",
  "key",
  "removeItem",
  "setItem",
]);

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  const base: Storage = {
    get length() { return data.size; },
    clear() { data.clear(); },
    getItem(key: string) { return data.has(key) ? data.get(key)! : null; },
    key(index: number) { return [...data.keys()][index] ?? null; },
    removeItem(key: string) { data.delete(String(key)); },
    setItem(key: string, value: string) { data.set(String(key), String(value)); },
  };
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === "symbol" || STORAGE_METHODS.has(prop) || prop in Object.prototype) {
        const val = Reflect.get(target, prop, target);
        return typeof val === "function" ? val.bind(target) : val;
      }
      return data.has(prop) ? data.get(prop) : undefined;
    },
    set(target, prop, value) {
      if (typeof prop === "symbol" || STORAGE_METHODS.has(prop)) {
        return Reflect.set(target, prop, value);
      }
      data.set(prop, String(value));
      return true;
    },
    deleteProperty(_target, prop) {
      if (typeof prop === "string" && !STORAGE_METHODS.has(prop)) {
        data.delete(prop);
      }
      return true;
    },
    has(target, prop) {
      if (typeof prop === "symbol" || STORAGE_METHODS.has(prop) || prop in Object.prototype) {
        return Reflect.has(target, prop);
      }
      return data.has(prop);
    },
    ownKeys() {
      return [...data.keys()];
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === "string" && data.has(prop)) {
        return { value: data.get(prop), writable: true, enumerable: true, configurable: true };
      }
      return undefined;
    },
  });
}

function usable(candidate: unknown): boolean {
  try {
    const store = candidate as Storage | undefined;
    if (!store) return false;
    store.setItem("__probe__", "1");
    const ok = store.getItem("__probe__") === "1" && Object.keys(store).includes("__probe__");
    store.removeItem("__probe__");
    return ok;
  } catch {
    return false;
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  if (usable((globalThis as Record<string, unknown>)[name])) continue;
  const store = createMemoryStorage();
  Object.defineProperty(globalThis, name, { value: store, configurable: true, writable: true });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, { value: store, configurable: true, writable: true });
  }
}

// 埋點用 navigator.sendBeacon 送出（lib/track）。瀏覽器的 sendBeacon 只是排隊、不回 Promise；
// happy-dom 的版本底層是一個 fetch，連不上（測試裡沒有 localhost:3000）時那個 Promise 的失敗沒人接，
// 變成「未處理的拒絕」，整套測試因此不定期紅在不相干的檔案上（updates、play-loading，2026-10-11）。
// 這裡換成照瀏覽器語義的空實現：收下、回 true，不真的發請求。
if (typeof navigator !== 'undefined') {
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, writable: true, value: () => true });
}
