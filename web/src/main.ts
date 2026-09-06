import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { i18n } from "./lib/i18n";
import { router } from "./router";
import { startTracking } from "./lib/track";
import { resolveUpstream } from "./lib/config";
import "./styles/base.css";

// 先問清楚該打哪個上游再掛頁面：第一個上游請求（登入態、卡片）不能打到被擋的網域
void resolveUpstream().finally(() => {
  createApp(App).use(createPinia()).use(i18n).use(router).mount("#app");
  startTracking();
});
