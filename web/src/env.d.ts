/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

/** 舞台套件（stage/ 子模組 build 出來的 moonstage/stage）；套件本身沒帶型別，這裡宣告本站用到的表面。 */
declare module "moonstage/stage" {
  import type { App, Component } from "vue";
  export interface StageHost {
    ui: {
      toast(text: string, kind?: "info" | "success" | "error" | "warning", durationMs?: number): void;
      confirm(options: { title?: string; content: string; confirmText?: string; cancelText?: string }): Promise<boolean>;
      loading(on: boolean): void;
      /** 對話頁頂欄的實際底色，塗到系統狀態列；null＝離開對話頁，還原。 */
      themeColor?(color: string | null): void;
      /** 對話頁第一次畫出內容：收掉蓋在上面的載入畫面（lib/stage-ready）。 */
      contentReady?(): void;
      availableCredits?(): number | null;
      creditsActions?(shortfall: { needed: number; available: number; minimum?: number } | null): { title?: string; body?: string; links: Array<{ id: string; label: string; href: string }> } | null;
    };
    storage: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
    nav: { back(): void; toEntry(): void; toConversations?(): void; toLogin(returnTo?: string): void; canBack?(): boolean };
    locale: { get(): string; set(locale: string): void };
    clipboard: { write(text: string): Promise<void> };
    events: { on(name: string, fn: (payload: unknown) => void): () => void; emit(name: string, payload?: unknown): void };
    scrollTo(el: Element | null, options?: { offset?: number }): void;
    /** 對話頁頁首的收藏與評論（lib/play-social.ts）；social() 回 null 兩顆都不畫。 */
    card?: {
      social(roleId: string): Promise<{ favorite: boolean; favorited: boolean; comments: boolean } | null>;
      setFavorite(roleId: string, on: boolean): Promise<boolean>;
      openComments(roleId: string): void;
    };
    /** 卡內分享情境（lib/play-share.ts）：情境碼、分享連結、誰打得開；不給就是沒有分享連結。 */
    share?: {
      read(roleId: string): { enabled: boolean; context: string | null; url: string; audience: "author" | "link" | "public" | null; poll?: { key: string; options: string[] } } | null;
      onChange?(fn: () => void): () => void;
      qr?(text: string): Promise<{ size: number; path: string }>;
    };
    /** 卡片的共用狀態與分享回流（lib/play-shared.ts）：舞台驗過參數、補上 roleId 才叫；錯誤丟 { code, data? }。 */
    shared?: {
      read(roleId: string, keys: string[]): Promise<unknown>;
      vote(roleId: string, key: string, option: string): Promise<unknown>;
      add(roleId: string, key: string, delta: number): Promise<unknown>;
      leaderboard(roleId: string, key: string, limit: number): Promise<unknown>;
      tallyLink(roleId: string, context: string, pollKey: string): Promise<unknown>;
      respond(roleId: string, option: string): Promise<unknown>;
      results(roleId: string): Promise<unknown>;
    };
  }
  export interface StageI18n {
    getLocaleMessage(locale: string): Record<string, unknown>;
    mergeLocaleMessage(locale: string, message: Record<string, unknown>): void;
  }
  export function browserHost(overrides?: Partial<StageHost>): StageHost;
  export function installMoonStage(
    app: App,
    options: {
      host: StageHost;
      auth: {
        getAccessToken(): Promise<string | null>;
        onUnauthorized(): void;
        user?: { id: string; nickName?: string; avatar?: string };
        /** 作者規則快取的帳號範圍：不可逆雜湊（lib/stage-storage.ts），沒給就不存。 */
        storageScope?: string | null;
      };
      api: { base: string };
      i18n?: StageI18n;
      /** 新版沙箱卡：殼位址、origin、存檔落地（上游 src/host/sandbox-host.ts）。 */
      sandbox?: {
        shellUrl(roleId: string): string;
        origin(roleId: string): string;
        saves?: {
          load(roleId: string): Promise<Record<string, unknown>>;
          set(roleId: string, key: string, value: unknown): Promise<void>;
          remove(roleId: string, key: string): Promise<void>;
        };
      };
    },
  ): Promise<void>;
  export function mergeStageMessages(i18n: StageI18n): void;
  /** 刪掉這個 origin 上的作者規則快取、之後只用記憶體，並叫開著的沙箱卡也清掉（登出用）。 */
  export function clearAuthorRuleStorage(): Promise<void>;
  export const MoonStage: Component;
}
declare module "moonstage/stage.css";

/** 舞台的簡繁字形轉換出口（跟對話頁同一套規則與字典）；本站只拿來轉卡片標題。 */
declare module "moonstage/display-script" {
  export type ScriptDirection = "none" | "s2t" | "t2s";
  export function directionForLocale(locale: string | null | undefined): ScriptDirection;
  export function createDisplayScriptConverter(direction: ScriptDirection): (text: string) => string;
  export function convertPlainText(text: string, convert: (text: string) => string): string;
}

/**
 * 舞台的規則引擎（stage/src/pages/canvas/canvas-rule-engine.ts 等，vite alias 指過去）。
 * 型別在這裡自己宣告、只宣告本站用到的表面：舞台的 tsconfig 沒開嚴格模式，讓 vue-tsc 讀它的原始檔會報不是本站的錯。
 */
declare module "stage-canvas/rule-engine" {
  export function applyTavernRules(
    text: string,
    rules: unknown[],
    options?: { macros?: { char?: string; user?: string }; variants?: unknown },
  ): { html: string; rollbacks: { ruleId: string; reason: string }[] };
  /** Same result, computed in a Web Worker so a slow author regex never blocks the page. */
  export function applyTavernRulesAsync(
    text: string,
    rules: unknown[],
    options?: { macros?: { char?: string; user?: string }; variants?: unknown },
  ): Promise<{ html: string; rollbacks: { ruleId: string; reason: string }[] }>;
}
declare module "stage-canvas/style-scope" {
  export type CardFormat = "mmd" | "tavern";
  export function normalizeCardFormat(raw: unknown): CardFormat;
  export function scopeCardHtml(html: string, format: CardFormat, scope?: string): string;
}
/** 舞台作者規則快取（聊天原文＋套完的 HTML）的資料庫名與刪除（stage/src/common/author-rules/store.ts）。 */
declare module "stage-author-rules/store" {
  export const AUTHOR_RULE_DB_NAME: string;
  export function deleteAuthorRuleStore(options?: { factory?: IDBFactory | null; name?: string; timeoutMs?: number }): Promise<boolean>;
}
declare module "stage-canvas/platform-defaults" {
  export function stripUnknownTags(html: string): string;
}
/** 舞台的顯示層替換引擎（stage/src/utils/display-rule-engine.js，純 JS）；只宣告本站經由 canvas-rule-engine 間接用到的表面。 */
declare module "@/utils/display-rule-engine.js" {
  export function applyDisplayRules(html: string, rules: unknown[], options?: unknown): { html: string; rollbacks: { ruleId: string; reason: string }[] };
  export function classifyPattern(find: string): unknown;
  export function hasCrossLineRule(rules: unknown[]): boolean;
  export const DISPLAY_RULE_MIN_BUDGET: number;
  export const ROLLBACK_BAD_REGEX: string;
  export const ROLLBACK_EMPTY_MATCH: string;
  export const ROLLBACK_VOLUME: string;
}

interface ImportMetaEnv {
  readonly VITE_HARBOR_API_BASE?: string;
  /** 1＝開「我的預設」（上游 API 上線前只在本機與預覽環境開） */
  readonly VITE_PRESETS?: string;
  readonly VITE_HARBOR_API_TRANSPORT?: string;
  readonly VITE_HARBOR_PROXY_HOSTS?: string;
  /** 綺夢社在 Harbor 的應用租戶 slug（應用獎勵的 /apps/{app}/…）；預設 hearthroom。 */
  readonly VITE_HARBOR_APP?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
