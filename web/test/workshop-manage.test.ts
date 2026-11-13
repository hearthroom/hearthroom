import { afterEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, reactive, type App } from "vue";
import { i18n } from "../src/lib/i18n";
import type { CardWorkshopState } from "../src/lib/card-workshop";
import type { Selection, UsageSummary } from "../src/lib/workshop";

const api = vi.hoisted(() => ({ saveSelection: vi.fn(), fetchSelection: vi.fn(), fetchUsageSummary: vi.fn(), saveContextTier: vi.fn() }));
vi.mock("../src/lib/workshop", async (original) => ({ ...(await original<object>()), ...api }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, accessToken: async () => "tok" }) }));
import ManageDialog from "../src/components/workshop/ManageDialog.vue";

let app: App | undefined;
const settle = async () => { for (let i = 0; i < 6; i++) { await nextTick(); await Promise.resolve(); } };
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); });

const row = (workshopId: string, enabled = true, residentChars = 300) => ({ workshopId, enabled, name: `擴充${workshopId}`, coverUrl: "", kinds: ["lore" as const], residentChars, availability: "open" as const });
const usage = (over: Partial<UsageSummary> = {}): UsageSummary => ({
  baseConstantChars: 3800, enabledWorkshopConstantChars: 600, totalConstantChars: 4400, items: [],
  currentContextTier: 2, currentContextTokens: 32000, recommendedContextTier: 2, recommendedContextTokens: 32000,
  currentTierSufficient: true, requestFits: true, highestAvailableTokens: 128000, recommendationReason: "ok", ...over,
});
function mount(selection: Selection, u: UsageSummary) {
  const state = reactive<CardWorkshopState>({ roleId: "r1", selection, usage: u, status: "ready", busy: false });
  const root = document.createElement("div"); document.body.append(root);
  app = createApp({ render: () => h(ManageDialog, { state }) }); app.use(i18n); app.mount(root);
  return state;
}
const switchButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("切換到"));

it("shows no switch button when the current tier is enough, and marks no row", async () => {
  i18n.global.locale.value = "zh-Hant";
  mount({ revision: 1, items: [row("a"), row("b")] }, usage());
  await settle();
  expect(document.body.textContent).toContain("目前 32K，夠用");
  expect(switchButton()).toBeUndefined();
  expect(document.body.textContent).not.toContain("改為關鍵詞觸發");
});

it("over capacity: offers the recommended tier and flags only the top-most enabled row", async () => {
  mount({ revision: 1, items: [row("off", false), row("a"), row("b")] }, usage({ requestFits: false, currentTierSufficient: false, recommendedContextTier: 4, recommendedContextTokens: 128000 }));
  await settle();
  expect(switchButton()?.textContent).toContain("128K");
  const flagged = [...document.querySelectorAll("[data-ws-row]")].filter((r) => r.textContent?.includes("改為關鍵詞觸發")).map((r) => r.getAttribute("data-ws-row"));
  expect(flagged).toEqual(["a"]);
});

it("switching saves the context tier first, then re-reads the summary", async () => {
  const state = mount({ revision: 1, items: [row("a")] }, usage({ currentTierSufficient: false, recommendedContextTier: 3, recommendedContextTokens: 64000 }));
  api.saveContextTier.mockResolvedValue({});
  api.fetchUsageSummary.mockResolvedValue(usage({ currentContextTier: 3, currentContextTokens: 64000, recommendedContextTier: 3, recommendedContextTokens: 64000 }));
  await settle();
  switchButton()!.click();
  await settle();
  expect(api.saveContextTier).toHaveBeenCalledWith("r1", 3, "tok");
  expect(api.saveContextTier.mock.invocationCallOrder[0]).toBeLessThan(api.fetchUsageSummary.mock.invocationCallOrder[0]!);
  expect(state.usage?.currentContextTokens).toBe(64000);
});

it("moving a row keeps focus on the same control of that row", async () => {
  mount({ revision: 1, items: [row("a"), row("b"), row("c")] }, usage());
  api.saveSelection.mockImplementation(async (_r: string, s: Selection) => ({ revision: s.revision + 1, items: s.items }));
  api.fetchUsageSummary.mockResolvedValue(usage());
  await settle();
  const up = document.querySelector<HTMLButtonElement>('[data-ws-row="c"] [data-move=up]')!;
  up.focus(); up.click();
  await settle();
  const order = [...document.querySelectorAll("[data-ws-row]")].map((r) => r.getAttribute("data-ws-row"));
  expect(order).toEqual(["a", "c", "b"]);
  expect(document.activeElement).toBe(document.querySelector('[data-ws-row="c"] [data-move=up]'));
  expect(api.saveSelection.mock.calls[0]![1].items.map((i: { workshopId: string }) => i.workshopId)).toEqual(["a", "c", "b"]);
});

it("a stale revision re-reads the list and applies the same move again", async () => {
  mount({ revision: 1, items: [row("a"), row("b")] }, usage());
  const { ApiError } = await import("../src/lib/api");
  api.saveSelection.mockRejectedValueOnce(new ApiError(409, "stale", "selection_stale")).mockImplementation(async (_r: string, s: Selection) => ({ revision: 9, items: s.items }));
  api.fetchSelection.mockResolvedValue({ revision: 5, items: [row("a"), row("b"), row("x")] });
  api.fetchUsageSummary.mockResolvedValue(usage());
  await settle();
  document.querySelector<HTMLButtonElement>('[data-ws-row="b"] [data-move=up]')!.click();
  await settle();
  const retried = api.saveSelection.mock.calls[1]![1];
  expect(retried.revision).toBe(5);
  expect(retried.items.map((i: { workshopId: string }) => i.workshopId)).toEqual(["b", "a", "x"]);
});
