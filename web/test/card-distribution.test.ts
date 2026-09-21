import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { useSession } from "../src/lib/session";
import CardPlatforms from "../src/components/CardPlatforms.vue";
import CardSyncPanel from "../src/components/CardSyncPanel.vue";
const mocks = vi.hoisted(() => ({
  platforms: vi.fn(),
  sync: vi.fn(),
  copies: vi.fn(),
  token: vi.fn(),
  balance: vi.fn(),
}));
vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api")>()),
  fetchCardPlatforms: mocks.platforms,
}));
vi.mock("../src/lib/connections", () => ({
  accountToken: mocks.token,
  connectedBalance: mocks.balance,
  connectAccount: vi.fn(),
}));
vi.mock("../src/lib/provider-switch", () => ({
  availableProviders: async () => [
    { id: "lunatalk", name: "LunaTalk" },
    { id: "harbor", name: "HarperHarbor" },
  ],
}));
vi.mock("../src/lib/distribution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/distribution")>()),
  synchronize: mocks.sync,
  copies: mocks.copies,
}));
let app: App | undefined;
let root: HTMLElement;
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await nextTick();
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.copies.mockResolvedValue([]);
  mocks.balance.mockResolvedValue(20);
  mocks.token.mockResolvedValue("fixture");
});
afterEach(() => {
  app?.unmount();
  root?.remove();
});
async function mount(component: any, props: any) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div/>" } }],
  });
  await router.push("/");
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSession();
  session.me = { accountNumId: 11, nickName: "fixture", avatar: "" };
  session.profile = {
    identities: [
      { provider: "lunatalk", externalId: 11 },
      { provider: "harbor", externalId: 22 },
    ],
  } as any;
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(component, props).use(pinia).use(i18n).use(router);
  app.mount(root);
  await settle();
}
it("disables stored-only providers and never offers a play action for them", async () => {
  mocks.platforms.mockResolvedValue([
    { provider: "harbor", roleId: "copy", playable: false },
  ]);
  await mount(CardPlatforms, { cardId: "community-card", provider: "harbor" });
  expect(
    root.querySelector<HTMLInputElement>("input[type=radio]")?.disabled
  ).toBe(true);
  expect(root.textContent).toContain(i18n.global.t("linked.storedOnly"));
  expect(root.querySelector("button.btn--primary")).toBeNull();
  expect(mocks.balance).not.toHaveBeenCalled();
});
it("selects a playable copy when the displayed card belongs to a storage-only provider", async () => {
  mocks.platforms.mockResolvedValue([
    { provider: "harbor", roleId: "copy", playable: false },
    { provider: "lunatalk", roleId: "original", playable: true },
  ]);
  await mount(CardPlatforms, { cardId: "community-card", provider: "harbor" });
  expect(mocks.platforms).toHaveBeenCalledWith('community-card');
  expect(
    root.querySelector<HTMLInputElement>("input[value=lunatalk]")?.checked
  ).toBe(true);
  expect(
    root.querySelector<HTMLButtonElement>("button.btn--primary")?.disabled
  ).toBe(false);
});
it("supports retry after a target failure without sending platform content ratings", async () => {
  await mount(CardSyncPanel, {
    roleId: "original",
    provider: "lunatalk",
    initialOpen: true,
  });
  // 已綁定的目標站預設勾選，不必再點
  expect(root.querySelector<HTMLInputElement>("input[value=harbor]")!.checked).toBe(true);
  expect(root.querySelector(".option input")).toBeNull();
  const button = () =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === i18n.global.t("linked.sync")
    )!;
  mocks.sync.mockRejectedValueOnce(new Error("sync_upstream_failed"));
  button().click();
  await settle();
  expect(root.querySelector(".notice--error")).not.toBeNull();
  mocks.sync.mockResolvedValueOnce({
    provider: "harbor",
    roleId: "copy",
    status: "synced",
  });
  button().click();
  await settle();
  expect(mocks.sync).toHaveBeenCalledTimes(2);
  expect(mocks.sync).toHaveBeenLastCalledWith("original","lunatalk","harbor",false);
  expect(root.querySelector(".notice--error")).toBeNull();
  expect(root.textContent).toContain(i18n.global.t("linked.status.synced"));
});

it("pre-selects connected hosting destinations for synchronization", async () => {
  await mount(CardSyncPanel, { roleId: "original", provider: "lunatalk", initialOpen: true });
  const harbor = root.querySelector<HTMLInputElement>("input[value=harbor]")!;
  expect(harbor.checked).toBe(true);
  // 來源那家沒有勾選框
  expect(root.querySelector("input[value=lunatalk]")).toBeNull();
  // 作者取消一家後，同步就不送那家
  harbor.click();
  await settle();
  expect(harbor.checked).toBe(false);
});

it('offers explicit private-copy recovery for a persisted missing target',async()=>{
 expect(i18n.global.te('linked.recreateCopy')).toBe(true);
 mocks.copies.mockResolvedValue([{provider:'harbor',roleId:'deleted',status:'failed',error:JSON.stringify({error:'sync_resource_missing',detail:{provider:'harbor',step:'read',upstreamStatus:404,upstreamCode:'role_not_found'}})}]);
 await mount(CardSyncPanel,{roleId:'original',provider:'lunatalk',initialOpen:true});
 const recovery=[...root.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===i18n.global.t('linked.recreateCopy'));
 expect(recovery).toBeDefined();
 expect(mocks.sync).not.toHaveBeenCalled();
 expect(root.querySelector('.option input')).toBeNull();
 mocks.sync.mockResolvedValueOnce({provider:'harbor',roleId:'new-copy',status:'synced'});
 recovery!.click();
 await settle();
 expect(mocks.sync).toHaveBeenLastCalledWith('original','lunatalk','harbor',false,false,true);
 expect(root.querySelector('.notice--error')).toBeNull();
 expect(root.textContent).not.toContain(i18n.global.t('linked.recreateCopy'));
});
