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
    };
    storage: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
    nav: { back(): void; toEntry(): void; toLogin(returnTo?: string): void };
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
      };
      api: { base: string };
      i18n?: StageI18n;
    },
  ): Promise<void>;
  export function mergeStageMessages(i18n: StageI18n): void;
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
}
declare module "stage-canvas/style-scope" {
  export type CardFormat = "mmd" | "tavern";
  export function normalizeCardFormat(raw: unknown): CardFormat;
  export function scopeCardHtml(html: string, format: CardFormat, scope?: string): string;
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
  readonly VITE_LUNATALK_API_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
