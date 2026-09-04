import { createRouter, createWebHistory } from "vue-router";
import { useSession } from "./lib/session";

const routes = [
  { path: "/", component: () => import("./pages/BoardPage.vue") },
  { path: "/cards/:id", component: () => import("./pages/CardPage.vue") },
  { path: "/cards/:roleId/edit", component: () => import("./pages/EditCardPage.vue"), meta: { auth: true } },
  { path: "/authors/:accountNumId", component: () => import("./pages/AuthorPage.vue") },
  { path: "/mine", component: () => import("./pages/MyCardsPage.vue"), meta: { auth: true } },
  { path: "/create", component: () => import("./pages/CreateCardPage.vue"), meta: { auth: true } },
  { path: "/auth/callback", component: () => import("./pages/CallbackPage.vue") },
  { path: "/:pathMatch(.*)*", component: () => import("./pages/NotFoundPage.vue") },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.beforeEach(async (to) => {
  if (!to.meta.auth) return true;
  const session = useSession();
  await session.restore();
  if (session.me) return true;
  // 登入後回到原本想去的頁，不要一律丟回首頁。
  await session.login(to.fullPath);
  return false;
});
