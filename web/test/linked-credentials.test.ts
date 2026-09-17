import { beforeEach, expect, it } from "vitest";
import { currentProvider, setProvider } from "../src/lib/provider";
import { persist, restorePersisted, forgetSession } from "../src/lib/oauth";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setProvider("lunatalk");
});
it("keeps issuer credentials separate while switching and restores the original account", () => {
  persist({ accessToken: "luna", expiresAt: Date.now() + 60000 });
  setProvider("harbor");
  expect(restorePersisted()).toBeNull();
  persist({ accessToken: "harbor", expiresAt: Date.now() + 60000 });
  setProvider("lunatalk");
  expect(restorePersisted()?.accessToken).toBe("luna");
  setProvider("harbor");
  expect(restorePersisted()?.accessToken).toBe("harbor");
});
it("reads another connected account without changing the active issuer", () => {
  persist({ accessToken: "luna", expiresAt: Date.now() + 60000 });
  setProvider("harbor");
  persist({ accessToken: "harbor", expiresAt: Date.now() + 60000 });
  setProvider("lunatalk");
  expect(restorePersisted("harbor")?.accessToken).toBe("harbor");
  expect(currentProvider()).toBe("lunatalk");
  forgetSession("harbor");
  expect(restorePersisted()?.accessToken).toBe("luna");
});
it("keeps this tab on its chosen provider when another tab switches", () => {
  persist({ accessToken: "luna", expiresAt: Date.now() + 60000 });
  localStorage.setItem("hearthroom.provider", "harbor");
  localStorage.setItem(
    "hearthroom.oauth.access",
    JSON.stringify({
      accessToken: "other-tab-harbor",
      expiresAt: Date.now() + 60000,
    })
  );
  expect(currentProvider()).toBe("lunatalk");
  expect(restorePersisted()?.accessToken).toBe("luna");
  setProvider("harbor");
  expect(restorePersisted()?.accessToken).toBe("other-tab-harbor");
  setProvider("lunatalk");
  expect(restorePersisted()?.accessToken).toBe("luna");
});
