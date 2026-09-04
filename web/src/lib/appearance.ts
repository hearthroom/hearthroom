import { computed, ref } from "vue";

/**
 * 外觀：深淺模式與主題。
 *
 * 狀態就是 <html> 上的兩個屬性——data-mode 是實際生效的深或淺，data-theme 是主題。
 * index.html 的 inline script 在第一次繪製前用同樣的鍵讀 localStorage 先寫好屬性，
 * 這裡接手之後負責：跟著系統切換、把選擇存回去、同步瀏覽器的 theme-color。
 *
 * 偏好存本機而不是進網址：外觀是「我的螢幕」的事，分享連結給別人時不該把我的
 * 深色模式一起塞給他（語言則相反，見 router.ts）。
 */

export type Mode = "system" | "light" | "dark";

export const MODES: Mode[] = ["system", "light", "dark"];

/** 主題清單。名字是翻譯鍵的一部分；swatch 是選單上那個色點，跟 themes.css 的 --accent 一致。 */
export const THEMES: { id: string; swatch: string; swatchDark: string }[] = [
  { id: "coral", swatch: "#ef4f6f", swatchDark: "#ef4f6f" },
  { id: "amber", swatch: "#b9711a", swatchDark: "#d48a2a" },
  { id: "violet", swatch: "#7048e8", swatchDark: "#8b6cf0" },
  { id: "ocean", swatch: "#147f96", swatchDark: "#2aa5c0" },
  { id: "forest", swatch: "#23875f", swatchDark: "#35a878" },
  { id: "sepia", swatch: "#b0512c", swatchDark: "#cf6a42" },
  { id: "ink", swatch: "#17171c", swatchDark: "#f2f2f5" },
];
export const DEFAULT_THEME = "coral";

const MODE_KEY = "taproom.mode";
const THEME_KEY = "taproom.theme";

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => {
  try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* 無痕模式：這次不記 */ }
};

const isMode = (v: unknown): v is Mode => v === "system" || v === "light" || v === "dark";
const isTheme = (v: unknown): v is string => THEMES.some((t) => t.id === v);

const mode = ref<Mode>(isMode(read(MODE_KEY)) ? (read(MODE_KEY) as Mode) : "system");
const theme = ref<string>(isTheme(read(THEME_KEY)) ? (read(THEME_KEY) as string) : DEFAULT_THEME);

const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
const systemDark = ref(media?.matches ?? false);
media?.addEventListener("change", (e) => { systemDark.value = e.matches; apply(); });

/** 實際生效的深或淺。 */
export const resolvedMode = computed<"light" | "dark">(() =>
  mode.value === "system" ? (systemDark.value ? "dark" : "light") : mode.value,
);

function apply(): void {
  const d = document.documentElement;
  d.dataset.mode = resolvedMode.value;
  if (theme.value === DEFAULT_THEME) delete d.dataset.theme;
  else d.dataset.theme = theme.value;
  // 瀏覽器的視窗外框（手機的網址列）跟著紙的顏色走，不然深色頁面頂著一條白
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(d).getPropertyValue("--bg").trim() || meta.content;
}

export function useAppearance() {
  return {
    mode: computed(() => mode.value),
    theme: computed(() => theme.value),
    resolvedMode,
    setMode(m: Mode) {
      mode.value = m;
      write(MODE_KEY, m === "system" ? null : m);
      apply();
    },
    setTheme(t: string) {
      if (!isTheme(t)) return;
      theme.value = t;
      write(THEME_KEY, t === DEFAULT_THEME ? null : t);
      apply();
    },
    /** 掛載時呼叫一次：inline script 已經寫過屬性，這裡補 theme-color 與系統監聽。 */
    init: apply,
  };
}
