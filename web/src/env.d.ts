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

interface ImportMetaEnv {
  readonly VITE_LUNATALK_API_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
