import "./lib/community-return";
import { currentProvider, setProvider } from "./lib/provider";
import { useProviderUpstream } from "./lib/config";
import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { i18n } from "./lib/i18n";
import { router } from "./router";
import { installChunkReload } from "./lib/chunk-reload";
// 要在任何 await 之前 import：beforeinstallprompt 發得很早，監聽器在模組頂層
import { registerServiceWorker, startInstallPrompt } from "./lib/pwa";
import { startTracking } from "./lib/track";
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
installChunkReload(router);
registerServiceWorker();
void resolveUpstream().finally(() => {
  createApp(App).use(createPinia()).use(i18n).use(router).mount("#app");
  startTracking();
  startInstallPrompt();
});
