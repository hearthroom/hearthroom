import { siteRootOf } from '../../../shared/site-hosts';
/**
 * 舞台（Moonstage）的宿主接線。
 *
 * 對話畫布是 stage/（Moonstage 的 fork）當套件打進來的：`moonstage/stage`。它不認識本站的
 * 登入、路由、語系、對話框，全靠這裡把本站的東西接給它——token 從 session 拿、確認框走
 * ConfirmDialog（站規：不用原生彈窗）、導頁走 vue-router、語系跟站台同步、文案只補站台沒有的 key。
 *
 * 套件只裝一次（installMoonStage 內部也擋重複），畫布元件由 PlayPage 掛在自己的路由裡。
 * 播放器與字典使用動態 import，只在遊玩路由預載，不增加其他頁面的初始下載量。
 */
import type { App, Component } from "vue";
import { preloadStage } from "./stage-preload";
export { preloadStage } from "./stage-preload";
import { reactive } from "vue";
import type { Router } from "vue-router";
import { recordConversation } from '@/lib/library';
import { apiBaseOf, currentProvider, type ProviderId } from '@/lib/provider';
import type { Me } from '@/lib/api';
import { UPSTREAM_API } from "@/lib/config";
import { deleteCardSave, fetchCardSaves, putCardSave } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { useAppearance } from "@/lib/appearance";
import { loginPath } from "@/lib/login-return";
import { dropManagedToken } from "@/lib/managed-auth";
import { restorePersisted } from "@/lib/oauth";
import { forgetVerifiedAccount } from "@/lib/connections";
import { applyLocale, i18n } from "@/lib/i18n";
import { isPlayHost } from "@/lib/site";
import { isStandalone } from "@/lib/pwa";
import { onStageSignOut, stageStorageScope } from "@/lib/stage-storage";
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
  provider?: ProviderId;
  accessToken?: () => Promise<string | null>;
  player?: Me | null;
  /** 目前所在頁的完整路徑，登入後要回到這裡。 */
  currentPath: () => string;
  currentRoleId?: () => string;
  /** 站台的 locale 前綴工具（/zh-Hans/...）。 */
  lp: (path: string) => string;
}

let stagePromise: Promise<Component> | null = null;

/**
 * 舞台被供應商拒絕時問一次：手上這張 token 是不是已經被換掉了。
 * 託管模式會重用 token 幾分鐘（managed-auth.ts），另一台設備換綁後這裡拿的可能是舊的。
 * 丟掉快取再拿一次：拿到另一張回 true（呼叫端重新載入即可），同一張或拿不到回 false（真的要重新登入）。
 */
export async function recoverRejectedToken(provider: ProviderId, accessToken: () => Promise<string | null>): Promise<boolean> {
  const rejected = restorePersisted(provider)?.accessToken;
  dropManagedToken(provider, rejected);
  forgetVerifiedAccount(provider);
  const fresh = await accessToken().catch(() => null);
  return !!fresh && !!rejected && fresh !== rejected;
}

/**
 * 新版沙箱卡的殼在哪裡。正式站每張卡一個子網域 `c<roleId>.hearthroom.club`（Worker 出殼頁、
 * 補 CSP）；本機開發或別的主機上沒有那些子網域，退回不透明 origin 載同源的 /sandbox/index.html
 * （前端 build 會把上游的殼複製到 web/public/sandbox/）。
 */
export function sandboxOptions(hostname: string, session: Pick<Session, 'accessToken'>, provider: ProviderId = currentProvider()) {
  // 卡片 App 網域（play.<站台>）也在同一個 zone 底下，殼子網域一樣用得到
  const root = siteRootOf(hostname);
  const production = !!root;
  const token = () => session.accessToken();
  const withToken = async <T>(fn: (t: string) => Promise<T>): Promise<T> => {
    const t = await token();
    if (!t) throw new Error("not signed in");
    return fn(t);
  };
  // 只保留這次啟動的一份存檔；握手消耗後不再快取。憑證、卡片及期限都要吻合。
  type Prefetch = { roleId: string; token: string; started: number; value: ReturnType<typeof fetchCardSaves> };
  let pending: Prefetch | null = null;
  let generation = 0;
  const invalidate = () => { generation++; pending = null; };
  const prefetch = async (roleId: string): Promise<void> => {
    const version = ++generation;
    pending = null;
    try {
      const t = await token();
      if (!t || version !== generation) return;
      const entry = { roleId, token: t, started: Date.now(), value: fetchCardSaves(roleId, t, provider) };
      pending = entry;
      try { await entry.value; }
      catch { if (pending === entry) pending = null; }
    } catch { /* 預取失敗由握手正常讀取重試，不以空存檔啟動。 */ }
  };
  // 子網域標籤：瀏覽器把主機名一律小寫，postMessage 的 origin 也是小寫，這裡先小寫才對得上；
  // 不合 DNS 標籤（只許 a-z 0-9 -，最長 62）的 roleId 退回同站 opaque 殼，不硬湊一個連不上的主機名。
  const label = (roleId: string): string | null => {
    const l = String(roleId).toLowerCase();
    return production && /^[a-z0-9-]{1,62}$/.test(l) ? l : null;
  };
  return {
    prefetch,
    shellUrl: (roleId: string) => { const l = label(roleId); return l ? `https://c${l}.${root}/sandbox/` : "/sandbox/"; },
    origin: (roleId: string) => { const l = label(roleId); return l ? `https://c${l}.${root}` : "null"; },
    saves: {
      load: (roleId: string) => withToken((t) => {
        const entry = pending;
        invalidate();
        return entry && entry.roleId === roleId && entry.token === t && Date.now() - entry.started < 30_000
          ? entry.value : fetchCardSaves(roleId, t, provider);
      }),
      set: (roleId: string, key: string, value: unknown) => { invalidate(); return withToken((t) => putCardSave(roleId, key, value, t, provider)); },
      remove: (roleId: string, key: string) => { invalidate(); return withToken((t) => deleteCardSave(roleId, key, t, provider)); },
    },
  };
}

/** 載入並安裝舞台套件，回畫布元件。重複呼叫共用同一個 Promise。 */
export function ensureStage(deps: StageDeps): Promise<Component> {
  if (stagePromise) return stagePromise;
  stagePromise = (async () => {
    const provider = deps.provider ?? currentProvider();
    const accessToken = deps.accessToken ?? (() => deps.session.accessToken());
    const sandbox = sandboxOptions(window.location.hostname, { accessToken }, provider);
    let recovering = false;
    const initialRoleId = deps.currentRoleId?.();
    if (initialRoleId) void sandbox.prefetch(initialRoleId);
    // 套件的 CSS 之後再蓋站台的接線（styles/stage.css）：畫布的變數改接站台的 token，深淺與主題才跟得上
    const stage = await preloadStage();
    const host = stage.browserHost({
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
    const player = deps.player === undefined ? deps.session.me : deps.player;
    // 作者規則快取綁在這個帳號上（雜湊，不是帳號 ID）；沒登入就不存。登出時由 stage-storage 叫舞台清掉。
    const storageScope = await stageStorageScope(provider, player);
    host.events.on('conversationActivity', async (payload: unknown) => {
      const activity = payload as { roleId?: unknown; conversationId?: unknown } | null;
      const conversationId = activity?.conversationId;
      const path = deps.currentPath().split('?')[0] || '';
      const roleId = deps.currentRoleId?.() ?? path.match(/\/play\/([^/]+)\/?$/)?.[1];
      if (typeof conversationId !== 'string' || !conversationId || !roleId || activity?.roleId !== decodeURIComponent(roleId)) return;
      try {
        const token = await accessToken();
        if (!token) throw new Error('unauthorized');
        await recordConversation(token, provider, decodeURIComponent(roleId), conversationId);
      } catch { pushStageToast(i18n.global.t('library.recordFailed'), 'error'); }
    });
    await stage.installMoonStage(deps.app, {
      host,
      auth: {
        getAccessToken: accessToken,
        onUnauthorized: () => {
          if (recovering) return;
          recovering = true;
          void recoverRejectedToken(provider, accessToken).then((replaced) => {
            if (replaced) { window.location.reload(); return; }
            recovering = false;
            void deps.router.push(deps.lp(loginPath(deps.currentPath())));
          });
        },
        // 畫布送訊息前看的是「有沒有登入的人」；這頁本來就要登入才進得來（meta.auth）
        user: player
          ? { id: String(player.accountNumId), nickName: player.nickName, avatar: player.avatar }
          : undefined,
        storageScope,
      },
      api: { base: provider === currentProvider() ? UPSTREAM_API : apiBaseOf(provider) },
      i18n: i18n.global,
      sandbox,
    });
    onStageSignOut(() => stage.clearAuthorRuleStorage?.());
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
