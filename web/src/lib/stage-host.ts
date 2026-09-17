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
import { currentProvider } from "@/lib/provider";
import { UPSTREAM_API } from "@/lib/config";
import { deleteCardSave, fetchCardSaves, putCardSave } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { useAppearance } from "@/lib/appearance";
import { loginPath } from "@/lib/login-return";
import { applyLocale, i18n } from "@/lib/i18n";
import { isPlayHost } from "@/lib/site";
import { isStandalone } from "@/lib/pwa";
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

/** 本站的正本主機；殼子網域只在它底下才存在（Worker 的萬用路由與 DNS 都掛在這個 zone）。 */
const SITE_HOST = "hearthroom.club";

/**
 * 新版沙箱卡的殼在哪裡。正式站每張卡一個子網域 `c<roleId>.hearthroom.club`（Worker 出殼頁、
 * 補 CSP）；本機開發或別的主機上沒有那些子網域，退回不透明 origin 載同源的 /sandbox/index.html
 * （前端 build 會把上游的殼複製到 web/public/sandbox/）。
 */
export function sandboxOptions(hostname: string, session: Session) {
  // 卡片 App 網域（play.<站台>）也在同一個 zone 底下，殼子網域一樣用得到
  const production = hostname === SITE_HOST || hostname === `www.${SITE_HOST}` || hostname === `play.${SITE_HOST}`;
  const token = () => session.accessToken();
  const withToken = async <T>(fn: (t: string) => Promise<T>): Promise<T> => {
    const t = await token();
    if (!t) throw new Error("not signed in");
    return fn(t);
  };
  // 子網域標籤：瀏覽器把主機名一律小寫，postMessage 的 origin 也是小寫，這裡先小寫才對得上；
  // 不合 DNS 標籤（只許 a-z 0-9 -，最長 62）的 roleId 退回同站 opaque 殼，不硬湊一個連不上的主機名。
  const label = (roleId: string): string | null => {
    const l = String(roleId).toLowerCase();
    return production && /^[a-z0-9-]{1,62}$/.test(l) ? l : null;
  };
  return {
    shellUrl: (roleId: string) => { const l = label(roleId); return l ? `https://c${l}.${SITE_HOST}/sandbox/` : "/sandbox/"; },
    origin: (roleId: string) => { const l = label(roleId); return l ? `https://c${l}.${SITE_HOST}` : "null"; },
    saves: {
      load: (roleId: string) => withToken((t) => fetchCardSaves(roleId, t)),
      set: (roleId: string, key: string, value: unknown) => withToken((t) => putCardSave(roleId, key, value, t)),
      remove: (roleId: string, key: string) => withToken((t) => deleteCardSave(roleId, key, t)),
    },
  };
}

/** 載入並安裝舞台套件，回畫布元件。重複呼叫共用同一個 Promise。 */
export function ensureStage(deps: StageDeps): Promise<Component> {
  if (stagePromise) return stagePromise;
  stagePromise = (async () => {
    // 套件的 CSS 之後再蓋站台的接線（styles/stage.css）：畫布的變數改接站台的 token，深淺與主題才跟得上
    const [stage] = await Promise.all([import("moonstage/stage"), import("moonstage/stage.css"), import("@/styles/stage.css")]);
    const host = stage.browserHost({
      ...(currentProvider() === "harbor" ? {capabilities:{
        actions:["copy"], panels:["model","persona","export","bottom"],
        personaModes:["name_only","custom"], assist:false, preferences:false, agentMode:false,
      }} : {}),
      ui: {
        toast: (text, kind) => pushStageToast(text, kind),
        confirm: (o) => confirmDialog({ title: o.title, message: o.content, confirmText: o.confirmText, cancelText: o.cancelText }),
        loading: () => {},
        // 手機的系統狀態列跟著頁面的 theme-color 塗色：對話頁上塗成舞台頂欄的實際底色（作者換配色會再叫），
        // 離開對話頁（null）還原成站台自己的底色（lib/appearance.ts）
        themeColor: (color) => {
          const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
          if (color && meta) meta.content = color;
          else useAppearance().init();
        },
      },
      nav: {
        // 卡片 App 網域上沒有站台可回：App 的入口就是這張卡自己（/<roleId>/），回到它就是「回到起點」
        back: () => {
          if (window.history.length > 1) { deps.router.back(); return; }
          deps.router.push(isPlayHost() ? deps.currentPath().split("?")[0] : deps.lp("/"));
        },
        toEntry: () => { deps.router.push(isPlayHost() ? deps.currentPath().split("?")[0] : deps.lp("/")); },
        // 從主畫面圖示開進來的獨立卡片 App：沒有上一頁，舞台（頁首與沙箱殼的頁首）都不畫返回鍵
        canBack: () => !(isPlayHost() && isStandalone()),
        toLogin: (returnTo) => { void deps.router.push(deps.lp(loginPath(returnTo || deps.currentPath()))); },
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
        onUnauthorized: () => { void deps.router.push(deps.lp(loginPath(deps.currentPath()))); },
        // 畫布送訊息前看的是「有沒有登入的人」；這頁本來就要登入才進得來（meta.auth）
        user: deps.session.me
          ? { id: String(deps.session.me.accountNumId), nickName: deps.session.me.nickName, avatar: deps.session.me.avatar }
          : undefined,
      },
      api: { base: UPSTREAM_API },
      i18n: i18n.global,
      sandbox: sandboxOptions(window.location.hostname, deps.session),
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
