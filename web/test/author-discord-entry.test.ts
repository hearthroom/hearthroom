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

describe("AuthorDiscordEntry (.btn--discord + .join__hint) across MyCardsPage and CardEditorPage", () => {
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

  it("uses community.join for button label, removes authorDiscord.label, and sets finalized 5-locale authorDiscord.hint", async () => {
    const expectedHints: Record<string, string> = {
      "zh-Hant": "在 Discord 裡獲取寫卡資源，和其他作者進行交流，遇到問題也能直接回饋。",
      "zh-Hans": "在 Discord 里获取写卡资源，和其他作者进行交流，遇到问题也能直接反馈。",
      en: "Discord has card-writing resources and other authors, and you can report problems to the team directly.",
      ja: "Discord には作成の資料があり、作者同士の交流や、問題の運営への直接報告もできます。",
      ko: "Discord에서 카드 제작 자료를 찾고, 다른 작가와 교류하고, 문제는 운영팀에 바로 제보할 수 있어요.",
    };
    for (const loc of LOCALE_CODES) {
      await applyLocale(loc);
      expect(i18n.global.te("authorDiscord.label"), `${loc} authorDiscord.label removed`).toBe(false);
      const joinLabel = i18n.global.t("community.join");
      const hint = i18n.global.t("authorDiscord.hint");
      expect(joinLabel.toLowerCase()).toContain("discord");
      expect(hint, `${loc} hint`).toBe(expectedHints[loc]);
    }

    const tokensCss = readFileSync("src/styles/tokens.css", "utf8");
    expect(tokensCss).toMatch(/--discord:\s*#5865f2/i);
    expect(tokensCss).toMatch(/--discord:\s*#8a93ff/i);

    const baseCss = readFileSync("src/styles/base.css", "utf8");
    expect(baseCss).toContain(".btn--discord");
  });

  it("renders in MyCardsPage .head__text below quota, links aria-describedby, tracks my-cards on click, and hides when invite is null", async () => {
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

    const headText = root.querySelector(".head .head__text")!;
    const actions = root.querySelector(".head .head__actions")!;
    const quota = headText.querySelector(".quota")!;
    const joinGroup = headText.querySelector<HTMLElement>("[data-author-discord]")!;
    expect(joinGroup).not.toBeNull();
    expect(actions.querySelector("[data-author-discord]")).toBeNull();
    expect(quota.compareDocumentPosition(joinGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const btn = joinGroup.querySelector<HTMLAnchorElement>("a.btn.btn--discord")!;
    const hint = joinGroup.querySelector<HTMLParagraphElement>("p.join__hint")!;
    expect(btn).not.toBeNull();
    expect(hint).not.toBeNull();
    expect(btn.getAttribute("href")).toBe("https://discord.gg/sukisuki");
    expect(btn.getAttribute("target")).toBe("_blank");
    expect(btn.getAttribute("aria-describedby")).toBe("author-discord-hint-my-cards");
    expect(hint.getAttribute("id")).toBe("author-discord-hint-my-cards");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.textContent?.trim()).toBe(i18n.global.t("community.join"));
    expect(hint.textContent?.trim()).toBe(i18n.global.t("authorDiscord.hint"));

    btn.addEventListener("click", (e) => e.preventDefault());
    btn.click();
    expect(trackCalls).toContainEqual(["cta", { detail: "discord", subject: "my-cards" }]);

    inviteRef.value = null;
    await settle();
    expect(root.querySelector("[data-author-discord]")).toBeNull();
    expect(root.querySelector(".join__hint")).toBeNull();
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

    const joinGroup = root.querySelector<HTMLElement>(".head [data-author-discord]")!;
    expect(joinGroup).not.toBeNull();
    const btn = joinGroup.querySelector<HTMLAnchorElement>("a.btn.btn--discord")!;
    const hint = joinGroup.querySelector<HTMLParagraphElement>("p.join__hint")!;
    expect(btn).not.toBeNull();
    expect(hint).not.toBeNull();
    expect(btn.getAttribute("href")).toBe("https://discord.gg/authors");
    expect(btn.getAttribute("aria-describedby")).toBe("author-discord-hint-editor");
    expect(hint.getAttribute("id")).toBe("author-discord-hint-editor");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.textContent?.trim()).toBe(i18n.global.t("community.join"));
    expect(hint.textContent?.trim()).toBe(i18n.global.t("authorDiscord.hint"));

    btn.addEventListener("click", (e) => e.preventDefault());
    btn.click();
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
    expect(root.querySelector(".join__hint")).toBeNull();
  });

  it("renders finalized C button + A hint layout and geometry in Chrome at 390px and 1440px across all 5 locales and light/dark modes", async () => {
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
                  const btn = entry.querySelector('a.btn.btn--discord');
                  const hint = entry.querySelector('p.join__hint');
                  const svg = btn.querySelector('svg');
                  const hr = head.getBoundingClientRect();
                  const er = entry.getBoundingClientRect();
                  const br = btn.getBoundingClientRect();
                  const htr = hint.getBoundingClientRect();
                  const sr = svg.getBoundingClientRect();
                  const svgColor = d.defaultView.getComputedStyle(svg).color;
                  const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
                  let siblingOverlap = false;
                  let layoutOk = false;
                  let btnHeightOk = false;
                  if ('${surface}' === 'mine') {
                    const pill = d.querySelector('.onboard__pill').getBoundingClientRect();
                    const create = d.querySelector('.head__create').getBoundingClientRect();
                    const title = d.querySelector('.head__title').getBoundingClientRect();
                    const quota = d.querySelector('.quota').getBoundingClientRect();
                    const search = d.querySelector('.tools__search').getBoundingClientRect();
                    siblingOverlap = overlaps(er, pill) || overlaps(er, create) || overlaps(er, title) || overlaps(br, htr);
                    if (${width} >= 600) {
                      btnHeightOk = Math.round(br.height) === 36;
                      layoutOk = (create.left - pill.right) <= 16 && br.top >= quota.bottom - 1 && htr.left >= br.right + 8;
                    } else {
                      btnHeightOk = Math.round(br.height) === 44;
                      layoutOk = Math.abs(br.width - hr.width) <= 2 && br.top >= pill.bottom - 1 && htr.top >= br.bottom - 1 && search.top >= htr.bottom - 1;
                    }
                  } else {
                    const copy = d.querySelector('.head__text').getBoundingClientRect();
                    siblingOverlap = overlaps(er, copy) || overlaps(br, htr);
                    btnHeightOk = Math.round(br.height) === 36;
                    if (${width} >= 761) {
                      layoutOk = er.width <= 320.5 && er.left >= copy.right - 1 && htr.top >= br.bottom - 1 && br.width < er.width;
                    } else {
                      layoutOk = er.top >= copy.bottom - 1 && htr.top >= br.bottom - 1 && br.width < er.width - 20;
                    }
                  }
                  window.results.push({
                    loc: '${loc}',
                    width: ${width},
                    mode: '${mode}',
                    surface: '${surface}',
                    visible: er.width > 0 && br.height >= 36 && htr.height > 0,
                    inBounds: er.left >= hr.left - 1 && er.right <= hr.right + 1,
                    icon18: Math.round(sr.width) === 18 && Math.round(sr.height) === 18,
                    svgColor,
                    siblingOverlap,
                    btnHeightOk,
                    layoutOk
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
        expect(row.icon18, `${label}: icon18`).toBe(true);
        expect(row.svgColor, `${label}: svgColor`).toBe(row.mode === "light" ? "rgb(88, 101, 242)" : "rgb(138, 147, 255)");
        expect(row.siblingOverlap, `${label}: siblingOverlap`).toBe(false);
        expect(row.btnHeightOk, `${label}: btnHeightOk`).toBe(true);
        expect(row.layoutOk, `${label}: layoutOk`).toBe(true);
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
