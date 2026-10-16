import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { i18n } from "../src/lib/i18n";
import AdultConsentDialog from "../src/components/AdultConsentDialog.vue";
import { saveAdult } from "../src/lib/adult-consent";
import { ADULT_CONSENT_VERSION } from "../../shared/adult-consent";

vi.mock("../src/lib/session", () => ({ useSession: () => ({}) }));
vi.mock("../src/lib/adult-consent", () => ({
  viewerAdult: () => ({ ageVerified: false }), underageLocked: () => false, saveAdult: vi.fn(async () => {}),
}));
let app: ReturnType<typeof createApp>;
let root: HTMLElement;
const input = (part: string) => document.querySelector<HTMLInputElement>(`input[autocomplete="bday-${part}"]`)!;
const confirm = () => document.querySelector<HTMLButtonElement>('.dlg button[type="submit"]')!;
async function enter(year: string, month: string, day: string) {
  for (const [part, value] of [["year", year], ["month", month], ["day", day]]) {
    expect(input(part), `direct ${part} input`).not.toBeNull();
    input(part).value = value; input(part).dispatchEvent(new Event("input"));
  }
  const agree = document.querySelector<HTMLInputElement>('.dlg input[type="checkbox"]')!;
  agree.checked = true; agree.dispatchEvent(new Event("change"));
  await nextTick();
}
beforeEach(async () => {
  vi.clearAllMocks(); i18n.global.locale.value = "zh-Hant";
  root = document.createElement("div"); document.body.append(root);
  app = createApp(AdultConsentDialog).use(i18n); app.mount(root); await nextTick();
});
afterEach(() => { app?.unmount(); root?.remove(); });
describe("direct birthdate entry", () => {
  it("has three labelled text fields with numeric keyboards and no calendar", () => {
    expect(document.querySelector('input[type="date"]')).toBeNull();
    for (const part of ["year", "month", "day"]) {
      expect(input(part)?.type).toBe("text");
      expect(input(part)?.inputMode).toBe("numeric");
      expect(input(part)?.labels?.length).toBe(1);
    }
    expect(document.activeElement).toBe(input("year"));
  });
  it("accepts single-digit month/day and sends the existing ISO birthdate only on confirmation", async () => {
    await enter("1990", "1", "2");
    expect(confirm().disabled).toBe(false);
    expect(saveAdult).not.toHaveBeenCalled();
    confirm().click(); await nextTick();
    expect(saveAdult).toHaveBeenCalledWith(expect.anything(), { showNsfw: true, birthdate: "1990-01-02", consentVersion: ADULT_CONSENT_VERSION });
  });
  it("accepts a valid leap day", async () => {
    await enter("2000", "2", "29"); expect(confirm().disabled).toBe(false);
  });
  it.each([["2001", "2", "29"], ["2000", "2", "30"], ["1990", "13", "1"], ["1990", "1", "0"], ["abcd", "1", "1"], [String(new Date().getUTCFullYear() + 1), "1", "1"]])("rejects invalid or future date %s/%s/%s without sending", async (year, month, day) => {
    await enter(year, month, day);
    expect(confirm().disabled).toBe(true);
    document.querySelector('form.dlg')!.dispatchEvent(new Event("submit", { cancelable: true }));
    await nextTick(); expect(saveAdult).not.toHaveBeenCalled();
  });
});
