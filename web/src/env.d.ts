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
      toast(text: string, kind?: "info" | "success" | "error" | "warning"): void;
      confirm(options: { title?: string; content: string; confirmText?: string; cancelText?: string }): Promise<boolean>;
      loading(on: boolean): void;
      /** 對話頁頂欄的實際底色，塗到系統狀態列；null＝離開對話頁，還原。 */
      themeColor?(color: string | null): void;
    };
    storage: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
    nav: { back(): void; toEntry(): void; toLogin(returnTo?: string): void; canBack?(): boolean };
    locale: { get(): string; set(locale: string): void };
    clipboard: { write(text: string): Promise<void> };
    events: { on(name: string, fn: (payload: unknown) => void): () => void; emit(name: string, payload?: unknown): void };
    scrollTo(el: Element | null, options?: { offset?: number }): void;
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
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
