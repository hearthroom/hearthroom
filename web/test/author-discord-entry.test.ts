import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, h, nextTick, ref, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { applyLocale, i18n, LOCALE_CODES } from "../src/lib/i18n";
import { siteLinksKey, type FooterContext } from "../src/lib/site-links";
import { useSession } from "../src/lib/session";
import { lastShown } from "../src/lib/mine-memory";
import AuthorDiscordEntry from "../src/components/AuthorDiscordEntry.vue";
import MyCardsPage from "../src/pages/MyCardsPage.vue";
import CardEditorPage from "../src/pages/CardEditorPage.vue";

const trackCalls = vi.hoisted(() => [] as Array<[string, Record<string, unknown> | undefined]>);
vi.mock("../src/lib/track", () => ({
  track: (ev: string, opts?: Record<string, unknown>) => {
    trackCalls.push([ev, opts]);
  },
  currentSurface: () => "mine",
  setSurface: () => {},
}));

vi.mock("../src/lib/work-visibility-capability", async () => {
  const { ref } = await import("vue");
  return { useWorkVisibilityCapability: () => ref(true) };
});

vi.mock("../src/lib/work-visibility", async (original) => ({
  ...(await original<typeof import("../src/lib/work-visibility")>()),
  fetchWorkVisibility: vi.fn(async () => ({ workVisibility: null })),
  changeWorkVisibility: vi.fn(),
  fetchVisibilityOperation: vi.fn(),
}));

vi.mock("../src/lib/share-ref", async (original) => ({
  ...(await original<typeof import("../src/lib/share-ref")>()),
  currentReferralCode: async () => null,
  ownReferralCode: async () => null,
}));

vi.mock("../src/lib/connections", async (original) => ({
  ...(await original<typeof import("../src/lib/connections")>()),
  accountToken: vi.fn(async () => "tok-harbor"),
  connectAccount: vi.fn(),
}));

vi.mock("../src/lib/distribution", async (original) => ({
  ...(await original<typeof import("../src/lib/distribution")>()),
  copies: vi.fn(async () => []),
  synchronize: vi.fn(),
}));

vi.mock("../src/lib/provider-switch", () => ({
  availableProviders: async () => [{ id: "harbor", name: "HarperHarbor" }],
}));

vi.mock("../src/lib/authoring-platforms", () => ({
  saveCopies: vi.fn(async () => []),
  savedDistributionTargets: async () => [],
}));

vi.mock("../src/lib/use-image-generation", async () => {
  const { ref } = await import("vue");
  return {
    useImageGeneration: () => ({
      imageGen: ref(null),
      generator: async () => ({ create: vi.fn(), wait: vi.fn(), save: vi.fn() }),
      probeGeneration: async () => {},
      markReauthorizing: () => {},
    }),
  };
});

vi.mock("../src/lib/api", async (original) => ({
  ...(await original<typeof import("../src/lib/api")>()),
  fetchMeAt: async () => ({ email: "author@example.test" }),
  fetchMyCards: vi.fn(async () => ({
    items: [],
    total: 0,
    registeredTotal: 0,
    hasNext: false,
    page: 1,
    pageSize: 24,
    quota: { used: 0, limit: 3, weekStart: 0, weekEnd: 9999999999999 },
  })),
  fetchMyWorldbooks: vi.fn(async () => []),
  fetchFandoms: vi.fn(async () => []),
}));

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await nextTick();
};

function makeFooterCtx(discordInvite: string | null) {
  const inviteRef = ref(discordInvite);
  return {
    inviteRef,
    ctx: computed<FooterContext>(() => ({
      repoUrl: "https://github.com/hearthroom/hearthroom",
      license: "AGPL-3.0",
      discordInvite: inviteRef.value,
      showDownloadEntry: false,
      canInstallSite: false,
      routeLine: null,
    })),
  };
}

describe("AuthorDiscordEntry across MyCardsPage and CardEditorPage", () => {
  let app: App | null = null;
  let root: HTMLElement | null = null;

  beforeEach(async () => {
    trackCalls.length = 0;
    lastShown.clear();
    await applyLocale("zh-Hant");
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    root?.remove();
    root = null;
    vi.unstubAllGlobals();
  });

  it("provides label and hint copy across all 5 locales", async () => {
    for (const loc of LOCALE_CODES) {
      await applyLocale(loc);
      const label = i18n.global.t("authorDiscord.label");
      const hint = i18n.global.t("authorDiscord.hint");
      expect(label, `${loc} label`).not.toBe("authorDiscord.label");
      expect(hint, `${loc} hint`).not.toBe("authorDiscord.hint");
      expect(label.toLowerCase()).toContain("discord");
      expect(hint.length).toBeGreaterThan(12);
    }
  });

  it("renders in MyCardsPage header actions when invite is present, tracks my-cards on click, and hides when invite is null", async () => {
    const { inviteRef, ctx } = makeFooterCtx("https://discord.gg/sukisuki");
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/:pathMatch(.*)*", component: MyCardsPage }],
    });
    await router.push("/mine");
    const pinia = createPinia();
    setActivePinia(pinia);
    const session = useSession();
    session.me = { accountNumId: 11, nickName: "Fixture", avatar: "" };
    session.profile = { identities: [{ provider: "harbor", externalId: 22 }] } as any;

    root = document.createElement("div");
    document.body.append(root);
    app = createApp({ render: () => h(RouterView) })
      .use(pinia)
      .use(i18n)
      .use(router)
      .provide(siteLinksKey, ctx);
    app.mount(root);
    await settle();

    const actions = root.querySelector(".head .head__actions")!;
    const pill = actions.querySelector(".onboard__pill")!;
    const create = actions.querySelector('a[href$="/create"]')!;
    const discord = actions.querySelector<HTMLAnchorElement>("[data-author-discord]")!;

    expect(discord).not.toBeNull();
    expect(discord.getAttribute("href")).toBe("https://discord.gg/sukisuki");
    expect(discord.getAttribute("target")).toBe("_blank");
    expect(discord.querySelector("svg")).not.toBeNull();
    expect(discord.textContent).toContain(i18n.global.t("authorDiscord.label"));
    expect(discord.textContent).toContain(i18n.global.t("authorDiscord.hint"));
    expect(pill.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(create.compareDocumentPosition(discord) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    discord.addEventListener("click", (e) => e.preventDefault());
    discord.click();
    expect(trackCalls).toContainEqual(["cta", { detail: "discord", subject: "my-cards" }]);

    inviteRef.value = null;
    await settle();
    expect(root.querySelector("[data-author-discord]")).toBeNull();
  });

  it("renders in CardEditorPage header when invite is fetched from /community/config, tracks editor on click, and hides when invite is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/community/config")) {
          return Response.json({ invite: "https://discord.gg/authors" });
        }
        return Response.json({ enabled: false });
      }),
    );

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/create", component: CardEditorPage }],
    });
    await router.push("/create");
    await router.isReady();
    const pinia = createPinia();
    setActivePinia(pinia);
    const session = useSession();
    session.me = { accountNumId: 11, nickName: "Fixture", avatar: "" };
    session.profile = { memberId: "m1", displayName: "Fixture", identities: [{ provider: "harbor", externalId: "22" }] } as any;
    session.accessToken = async () => "tok-harbor";

    root = document.createElement("div");
    document.body.append(root);
    app = createApp({ render: () => h(RouterView) })
      .use(pinia)
      .use(i18n)
      .use(router);
    app.mount(root);
    await settle();

    const discord = root.querySelector<HTMLAnchorElement>(".head [data-author-discord]")!;
    expect(discord).not.toBeNull();
    expect(discord.getAttribute("href")).toBe("https://discord.gg/authors");
    expect(discord.querySelector("svg")).not.toBeNull();
    expect(discord.textContent).toContain(i18n.global.t("authorDiscord.label"));
    expect(discord.textContent).toContain(i18n.global.t("authorDiscord.hint"));

    discord.addEventListener("click", (e) => e.preventDefault());
    discord.click();
    expect(trackCalls).toContainEqual(["cta", { detail: "discord", subject: "editor" }]);

    app.unmount();
    root.remove();

    // When /community/config returns null invite, entry is hidden
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ invite: null, enabled: false })),
    );
    root = document.createElement("div");
    document.body.append(root);
    const comp = createApp(AuthorDiscordEntry, { where: "editor" }).use(i18n);
    app = comp;
    comp.mount(root);
    await settle();
    expect(root.querySelector("[data-author-discord]")).toBeNull();
  });

  it("renders without horizontal overflow or control overlap in Chrome at 390px and 1440px across all 5 locales", async () => {
    const chrome =
      process.env.CHROME_BIN ||
      ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
    expect(chrome, "Chrome is required for responsive geometry").toBeTruthy();

    const readCss = (files: string[]) =>
      files
        .map((file) => {
          const src = readFileSync(file, "utf8");
          if (file.endsWith(".css")) return src;
          return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
            .map((m) => m[1].replace(/:deep\(([^)]+)\)/g, "$1"))
            .join("\n");
        })
        .join("\n");

    const mineStyles = readCss([
      "src/styles/tokens.css",
      "src/styles/base.css",
      "src/pages/MyCardsPage.vue",
      "src/components/AgentOnboard.vue",
      "src/components/AuthorDiscordEntry.vue",
      "src/components/CommunityIcon.vue",
    ]);
    const editorStyles = readCss([
      "src/styles/tokens.css",
      "src/styles/base.css",
      "src/pages/CardEditorPage.vue",
      "src/components/AuthorDiscordEntry.vue",
      "src/components/CommunityIcon.vue",
      "src/components/editor/ImportPanel.vue",
      "src/components/editor/FieldText.vue",
    ]);

    const { ctx } = makeFooterCtx("https://discord.gg/sukisuki");
    const htmlByLocale: Record<string, { mineHtml: string; editorDesktopHtml: string; editorPhoneHtml: string }> = {};

    for (const loc of LOCALE_CODES) {
      await applyLocale(loc);

      const mineHost = document.createElement("div");
      document.body.appendChild(mineHost);
      const mineRouter = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: "/:pathMatch(.*)*", component: MyCardsPage }],
      });
      await mineRouter.push("/mine");
      const pinia1 = createPinia();
      setActivePinia(pinia1);
      const s1 = useSession();
      s1.me = { accountNumId: 11, nickName: "Fixture", avatar: "" };
      s1.profile = { identities: [{ provider: "harbor", externalId: 22 }] } as any;
      const mineApp = createApp({ render: () => h(RouterView) })
        .use(pinia1)
        .use(i18n)
        .use(mineRouter)
        .provide(siteLinksKey, ctx);
      mineApp.mount(mineHost);
      await settle();
      const mineHtml = mineHost.innerHTML;
      mineApp.unmount();
      mineHost.remove();

      const renderEditorAt = async (innerWidth: number) => {
        Object.defineProperty(window, "innerWidth", { value: innerWidth, configurable: true, writable: true });
        const edHost = document.createElement("div");
        document.body.appendChild(edHost);
        const edRouter = createRouter({
          history: createMemoryHistory(),
          routes: [{ path: "/create", component: CardEditorPage }],
        });
        await edRouter.push("/create");
        await edRouter.isReady();
        const pinia2 = createPinia();
        setActivePinia(pinia2);
        const s2 = useSession();
        s2.me = { accountNumId: 11, nickName: "Fixture", avatar: "" };
        s2.profile = { memberId: "m1", displayName: "Fixture", identities: [{ provider: "harbor", externalId: "22" }] } as any;
        s2.accessToken = async () => "tok-harbor";
        const edApp = createApp({ render: () => h(RouterView) })
          .use(pinia2)
          .use(i18n)
          .use(edRouter)
          .provide(siteLinksKey, ctx);
        edApp.mount(edHost);
        await settle();
        const edSnap = edHost.cloneNode(true) as HTMLElement;
        edSnap.querySelectorAll("iframe").forEach((frame) => {
          frame.removeAttribute("src");
          frame.setAttribute("srcdoc", "<!doctype html><body></body>");
        });
        const html = edSnap.innerHTML;
        edApp.unmount();
        edHost.remove();
        return html;
      };

      const editorDesktopHtml = await renderEditorAt(1440);
      const editorPhoneHtml = await renderEditorAt(390);
      Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true, writable: true });

      htmlByLocale[loc] = { mineHtml, editorDesktopHtml, editorPhoneHtml };
    }

    const dir = mkdtempSync(join(tmpdir(), "author-discord-layout-"));
    const shotsDir = process.env.CAPTURE_SHOTS_DIR;
    if (shotsDir) mkdirSync(shotsDir, { recursive: true });

    try {
      const frames: string[] = [];
      for (const loc of LOCALE_CODES) {
        for (const width of [390, 1440]) {
          for (const mode of ["light", "dark"] as const) {
            const { mineHtml, editorDesktopHtml, editorPhoneHtml } = htmlByLocale[loc];
            const editorHtml = width === 390 ? editorPhoneHtml : editorDesktopHtml;
            for (const [surface, html, css] of [
              ["mine", mineHtml, mineStyles],
              ["editor", editorHtml, editorStyles],
            ] as const) {
              const doc = `<!doctype html><html lang="${loc}" data-mode="${mode}"><head><meta charset="utf-8"><style>${css}</style></head><body><main class="container">${html}</main></body></html>`;
              const escaped = doc.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
              frames.push(
                `<iframe style="border:0;width:${width}px;height:900px" srcdoc="${escaped}" onload="
                  const d = this.contentDocument;
                  const head = d.querySelector('.head');
                  const entry = d.querySelector('[data-author-discord]');
                  const hr = head.getBoundingClientRect();
                  const er = entry.getBoundingClientRect();
                  const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
                  let siblingOverlap = false;
                  let buttonsCompact = true;
                  if ('${surface}' === 'mine') {
                    const pill = d.querySelector('.onboard__pill').getBoundingClientRect();
                    const create = d.querySelector('.head__create').getBoundingClientRect();
                    const title = d.querySelector('.head__title').getBoundingClientRect();
                    siblingOverlap = overlaps(er, pill) || overlaps(er, create) || overlaps(er, title);
                    if (${width} >= 600) buttonsCompact = (create.left - pill.right) <= 16;
                  } else {
                    const copy = d.querySelector('.head__text').getBoundingClientRect();
                    siblingOverlap = overlaps(er, copy);
                  }
                  window.results.push({
                    loc: '${loc}',
                    width: ${width},
                    mode: '${mode}',
                    surface: '${surface}',
                    visible: er.width > 0 && er.height >= 36,
                    inBounds: er.left >= hr.left - 1 && er.right <= hr.right + 1,
                    siblingOverlap,
                    buttonsCompact
                  });
                  document.querySelector('#result').textContent = JSON.stringify(window.results);
                "></iframe>`,
              );
            }
          }
        }
      }

      const fixture = join(dir, "fixture.html");
      writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><script>window.results=[]</script>${frames.join("")}<pre id="result"></pre>`);
      const run = spawnSync(
        chrome!,
        [
          "--headless=new",
          "--no-sandbox",
          "--no-first-run",
          "--no-default-browser-check",
          `--user-data-dir=${join(dir, "profile")}`,
          "--dump-dom",
          "--virtual-time-budget=2000",
          `file://${fixture}`,
        ],
        { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
      );
      expect(run.error, run.stderr).toBeUndefined();
      expect(run.status, run.stderr).toBe(0);
      const json = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
      expect(json, "Expected geometry results from Chrome").toBeTruthy();
      const results = JSON.parse(json!) as Array<Record<string, unknown>>;
      expect(results).toHaveLength(LOCALE_CODES.length * 2 * 2 * 2);
      for (const row of results) {
        const label = `${row.surface} ${row.loc} ${row.width}px ${row.mode}`;
        expect(row.visible, `${label}: visible`).toBe(true);
        expect(row.inBounds, `${label}: inBounds`).toBe(true);
        expect(row.siblingOverlap, `${label}: siblingOverlap`).toBe(false);
        expect(row.buttonsCompact, `${label}: buttonsCompact`).toBe(true);
      }

      if (shotsDir) {
        const shotCases: Array<{ name: string; loc: string; width: number; height: number; mode: "light" | "dark"; surface: "mine" | "editor" }> = [
          { name: "mine-desktop-dark-zh-Hant.png", loc: "zh-Hant", width: 1440, height: 700, mode: "dark", surface: "mine" },
          { name: "mine-desktop-light-en.png", loc: "en", width: 1440, height: 700, mode: "light", surface: "mine" },
          { name: "mine-phone-dark-zh-Hant.png", loc: "zh-Hant", width: 390, height: 700, mode: "dark", surface: "mine" },
          { name: "mine-phone-light-ja.png", loc: "ja", width: 390, height: 700, mode: "light", surface: "mine" },
          { name: "editor-desktop-dark-zh-Hant.png", loc: "zh-Hant", width: 1440, height: 700, mode: "dark", surface: "editor" },
          { name: "editor-desktop-light-en.png", loc: "en", width: 1440, height: 700, mode: "light", surface: "editor" },
          { name: "editor-phone-dark-zh-Hant.png", loc: "zh-Hant", width: 390, height: 700, mode: "dark", surface: "editor" },
          { name: "editor-phone-light-ko.png", loc: "ko", width: 390, height: 700, mode: "light", surface: "editor" },
        ];
        for (const sc of shotCases) {
          const html = sc.surface === "mine" ? htmlByLocale[sc.loc].mineHtml : sc.width === 390 ? htmlByLocale[sc.loc].editorPhoneHtml : htmlByLocale[sc.loc].editorDesktopHtml;
          const css = sc.surface === "mine" ? mineStyles : editorStyles;
          const innerDoc = `<!doctype html><html lang="${sc.loc}" data-mode="${sc.mode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="container">${html}</main></body></html>`;
          const escapedInner = innerDoc.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          const shotHtmlFile = join(dir, `${sc.name}.html`);
          writeFileSync(
            shotHtmlFile,
            `<!doctype html><html style="margin:0;padding:0;overflow:hidden"><body style="margin:0;padding:0;overflow:hidden;background:#000"><iframe style="border:0;width:${sc.width}px;height:${sc.height}px;display:block" srcdoc="${escapedInner}"></iframe></body></html>`,
          );
          const outPng = join(shotsDir, sc.name);
          const shotRun = spawnSync(
            chrome!,
            [
              "--headless=new",
              "--no-sandbox",
              "--no-first-run",
              "--no-default-browser-check",
              "--hide-scrollbars",
              "--force-device-scale-factor=1",
              `--user-data-dir=${join(dir, "shot-profile-" + sc.name)}`,
              `--window-size=${Math.max(sc.width, 500)},${sc.height + 160}`,
              `--screenshot=${outPng}`,
              `file://${shotHtmlFile}`,
            ],
            { encoding: "utf8", timeout: 20000 },
          );
          expect(shotRun.status, shotRun.stderr).toBe(0);
          expect(existsSync(outPng), `Expected screenshot ${outPng}`).toBe(true);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await applyLocale("zh-Hant");
    }
  }, 60000);
});
