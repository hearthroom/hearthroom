import "./lib/community-return";
import { currentProvider, setProvider } from "./lib/provider";
import { useProviderUpstream } from "./lib/config";
import { createPinia } from "pinia";
import { createApp } from "vue";
import { watch } from "vue";
import MaintenanceNotice from "./components/MaintenanceNotice.vue";
import { createMaintenanceMonitor } from "./lib/maintenance";
import { applyLocale, LOCALE_CODES, SOURCE_LOCALE } from "./lib/i18n";
import { useAppearance } from "./lib/appearance";
import { i18n } from "./lib/i18n";

import { installChunkReload } from "./lib/chunk-reload";
// 要在任何 await 之前 import：beforeinstallprompt 發得很早，監聽器在模組頂層
import { registerServiceWorker, startInstallPrompt } from "./lib/pwa";
import { startTracking } from "./lib/track";
import { startGa4, decorateGa4Checkout } from "./lib/ga4";
import { resolveUpstream } from "./lib/config";
import "./styles/base.css";

// 先問清楚該打哪個上游再掛頁面：第一個上游請求（登入態、卡片）不能打到被擋的網域
// 部署後舊分頁的懶載入區塊會 404：整頁重載一次到目標頁，別讓按鈕沒反應
// The community login is stable. Play URLs choose a service inside PlayPage.
// Existing authoring routes still carry their asset's issuer for the editor.
const authoring = /\/cards\/[^/]+\/edit\/?$/.test(location.pathname);
const selectedProvider = authoring ? new URLSearchParams(location.search).get('provider') : null;
setProvider(selectedProvider === 'harbor' ? selectedProvider : currentProvider());
useProviderUpstream();

registerServiceWorker();
async function startSite() {
  if (started) return;
  started = true;
  if (document.querySelector('meta[name="hearthroom-maintenance-shell"][content="sandbox"]')) { location.reload(); return; }
  const [{ default: App }, { router }] = await Promise.all([import('./App.vue'), import('./router')]);
  installChunkReload(router);
  await resolveUpstream();
  void startGa4();
  document.addEventListener("click", decorateGa4Checkout, true);
  document.addEventListener("auxclick", decorateGa4Checkout, true);
  createApp(App).use(createPinia()).use(i18n).use(router).mount("#app");
  startTracking();
  startInstallPrompt();

}
let started = false;
const maintenance = createMaintenanceMonitor(fetch, !!document.querySelector('meta[name="hearthroom-maintenance-shell"]'));
const noticeRoot = document.createElement('div');
noticeRoot.id = 'maintenance-root';
document.body.append(noticeRoot);
useAppearance().init();
const prefix = location.pathname.split('/')[1];
const queryLocale = new URLSearchParams(location.search).get('lang');
const initialLocale = LOCALE_CODES.includes(prefix) ? prefix : queryLocale && LOCALE_CODES.includes(queryLocale) ? queryLocale : SOURCE_LOCALE;
void applyLocale(initialLocale).then(async () => {
  createApp(MaintenanceNotice, { monitor: maintenance }).use(i18n).mount(noticeRoot);
  await maintenance.check();
  // A failed status request does not block an otherwise healthy site. Once the
  // switch is observed on, failed checks keep the notice closed to interaction.
  if (!maintenance.state.value.enabled) void startSite();
  watch(() => maintenance.state.value.enabled, enabled => { if (!enabled) void startSite(); });
  maintenance.start();
});
window.addEventListener('pagehide', () => maintenance.stop());
window.addEventListener('pageshow', () => maintenance.start());
