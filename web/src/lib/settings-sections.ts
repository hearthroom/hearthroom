/**
 * 使用者設定的各區（任務 2026-11-03-settings-ia，規格 docs/studio/tasks/2026-11-03-settings-ia/ui.md §2）。
 * 網址是 /settings/<區>；第一層列表照這裡的順序與分群畫。「通知」是另一整頁，列在列表裡但不是設定的區。
 */
export const SETTINGS_SECTIONS = ["profile", "play", "content", "appearance", "links", "help"] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const isSettingsSection = (v: unknown): v is SettingsSection =>
  typeof v === "string" && (SETTINGS_SECTIONS as readonly string[]).includes(v);

/** 改版前的設定頁是一整頁，靠 # 捲到某一區；榜單、搜尋、舊書籤還帶著這些 # */
export const LEGACY_SETTINGS_HASH: Record<string, SettingsSection> = {
  "#hidden": "content",
  "#leaderboard-privacy": "profile",
};
