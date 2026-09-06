/**
 * 舞台（Moonstage）的宿主接線。
 *
 * 對話畫布是 stage/（Moonstage 的 fork）當套件打進來的：`moonstage/stage`。它不認識本站的
 * 登入、路由、語系、對話框，全靠這裡把本站的東西接給它——token 從 session 拿、確認框走
 * ConfirmDialog（站規：不用原生彈窗）、導頁走 vue-router、語系跟站台同步、文案只補站台沒有的 key。
 *
 * 套件只裝一次（installMoonStage 內部也擋重複），畫布元件由 PlayPage 掛在自己的路由裡。
 * 套件很大（3 MB），所以整個 import 都是動態的：不走 /play 的人一個位元組都不會下載。
 */
import type { App, Component } from "vue";
import { reactive } from "vue";
import type { Router } from "vue-router";
import { UPSTREAM_API } from "@/lib/config";
import { confirmDialog } from "@/lib/confirm";
import { applyLocale, i18n } from "@/lib/i18n";
import type { useSession } from "@/lib/session";

type Session = ReturnType<typeof useSession>;

/** 舞台丟出來的提示；PlayPage 畫在畫布上方，幾秒後自動消失。 */
export const stageToasts = reactive<{ list: { id: number; text: string; kind: string }[] }>({ list: [] });
let toastSeq = 0;
export function pushStageToast(text: string, kind = "info"): void {
  if (!text) return;
  const id = ++toastSeq;
  stageToasts.list.push({ id, text, kind });
  setTimeout(() => { stageToasts.list = stageToasts.list.filter((t) => t.id !== id); }, 2800);
}

export interface StageDeps {
  app: App;
  router: Router;
  session: Session;
  /** 目前所在頁的完整路徑，登入後要回到這裡。 */
  currentPath: () => string;
  /** 站台的 locale 前綴工具（/zh-Hans/...）。 */
  lp: (path: string) => string;
}

let stagePromise: Promise<Component> | null = null;

/** 載入並安裝舞台套件，回畫布元件。重複呼叫共用同一個 Promise。 */
export function ensureStage(deps: StageDeps): Promise<Component> {
  if (stagePromise) return stagePromise;
  stagePromise = (async () => {
    const [stage] = await Promise.all([import("moonstage/stage"), import("moonstage/stage.css")]);
    const host = stage.browserHost({
      ui: {
        toast: (text, kind) => pushStageToast(text, kind),
        confirm: (o) => confirmDialog({ title: o.title, message: o.content, confirmText: o.confirmText, cancelText: o.cancelText }),
        loading: () => {},
      },
      nav: {
        back: () => { if (window.history.length > 1) deps.router.back(); else deps.router.push(deps.lp("/")); },
        toEntry: () => { deps.router.push(deps.lp("/")); },
        toLogin: (returnTo) => { void deps.session.login(returnTo || deps.currentPath()); },
      },
      locale: {
        get: () => i18n.global.locale.value,
        set: (code) => { void applyLocale(code); },
      },
    });
    await stage.installMoonStage(deps.app, {
      host,
      auth: {
        getAccessToken: () => deps.session.accessToken(),
        onUnauthorized: () => { void deps.session.login(deps.currentPath()); },
        // 畫布送訊息前看的是「有沒有登入的人」；這頁本來就要登入才進得來（meta.auth）
        user: deps.session.me
          ? { id: String(deps.session.me.accountNumId), nickName: deps.session.me.nickName, avatar: deps.session.me.avatar }
          : undefined,
      },
      api: { base: UPSTREAM_API },
      i18n: i18n.global,
    });
    return stage.MoonStage;
  })();
  stagePromise.catch(() => { stagePromise = null; });
  return stagePromise;
}

/** 切語言後站台會整份換掉該語言的文案表，舞台的 key 要再補一次。 */
export async function remergeStageMessages(): Promise<void> {
  if (!stagePromise) return;
  const stage = await import("moonstage/stage");
  stage.mergeStageMessages(i18n.global);
}
