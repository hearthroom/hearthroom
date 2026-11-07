// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';
import { applyLocale, i18n, LOCALE_CODES } from '../src/lib/i18n';
import { readChunks, writeChunks } from '../src/lib/png-chunks';

vi.mock('../src/lib/work-visibility-capability', async () => {
  const { ref } = await import('vue');
  return { useWorkVisibilityCapability: () => ref(true) };
});

vi.mock('../src/lib/work-visibility', async (original) => ({
  ...(await original<typeof import('../src/lib/work-visibility')>()),
  fetchWorkVisibility: vi.fn(async () => ({
    cardId: null,
    workVisibility: {
      access: 'private',
      effectiveAccess: 'owner',
      review: 'none',
      update: 'none',
      everPublic: false,
      revisionState: 'unknown',
      restorable: false,
      restoreReason: 'no_approval',
      draftChanged: false,
      restriction: 'none',
      policyRevision: '1',
      approvalRevision: '0',
      actions: ['set_private', 'set_unlisted', 'submit_review'],
      syncState: 'complete',
    },
  })),
  changeWorkVisibility: vi.fn(),
  fetchVisibilityOperation: vi.fn(),
}));

vi.mock('../src/lib/share-ref', async (original) => ({
  ...(await original<typeof import('../src/lib/share-ref')>()),
  currentReferralCode: async () => null,
  ownReferralCode: async () => null,
}));

vi.mock('../src/lib/authoring-platforms', () => ({
  saveCopies: vi.fn(async () => []),
  savedDistributionTargets: async () => [],
}));

const api = vi.hoisted(() => ({
  fetchCardDeletion: vi.fn(async (): Promise<{ deletion: unknown }> => ({ deletion: null })),
  registerCardIdentity: vi.fn(async () => ({ id: '100021', num: 100021, provider: 'harbor', sourceRoleId: 'r1' })),
  fetchCard: vi.fn(async () => ({ id: '100021', num: 100021, provider: 'harbor', sourceRoleId: 'r1', roleId: 'frozen-r1' })),
  createRole: vi.fn(async () => ({ roleId: 'r1' })),
  patchRoleDocument: vi.fn(async () => ({})),
  patchRoleWelcome: vi.fn(async () => ({})),
  unpublishRole: vi.fn(async () => ({})),
  createWorldbook: vi.fn(async () => 'wb1'),
  patchWorldbookDocument: vi.fn(async () => ({})),
  reorderWorldbookEntries: vi.fn(async () => {}),
  unbindWorldbook: vi.fn(async () => {}),
  findWorldbookByName: vi.fn(async () => null),
  deleteWorldbook: vi.fn(async () => {}),
  fetchWorldbookEntries: vi.fn(async () => [
    { entryId: 'e1', name: '黑麥鎮', content: '北境小鎮與山脈地形。'.repeat(30), keywords: ['黑麥鎮'], secondaryKeywords: [], isEnabled: true, isConstant: true, category: 'location' },
    { entryId: 'e2', name: '採石場', content: '廢棄採石場與遺跡。'.repeat(25), keywords: ['採石場'], secondaryKeywords: ['排水渠'], isEnabled: true, isConstant: false },
  ]),
  fetchRoleValidation: vi.fn(async () => ({ status: 'ok', blockers: [], warnings: [] })),
  fetchDraftState: vi.fn(async () => ({ status: 'unlisted', draftChanged: false })),
  fetchRoleDetail: vi.fn(async () => ({
    roleName: '測試角色 Alpha',
    roleDetailDesc: '角色設定內容，包含背景與性格描述。'.repeat(40),
    roleWelcome: '開場白內容',
  })),
  fetchRoleWorldbooks: vi.fn(async () => [{ worldbookId: 'wb-bound', name: '北境設定', description: '常駐與觸發條目', entryCount: 2 }]),
  fetchMyWorldbooks: vi.fn(async () => [
    { worldbookId: 'wb9', name: '北境設定', description: '舊描述', entryCount: 2, iconUrl: 'https://img.test/wb.png', visibility: 'private', tags: '北境,懸疑' },
  ]),
  submitRoleForReview: vi.fn(async () => ({})),
  registerCard: vi.fn(async () => ({ status: 'pending' })),
  fetchFandoms: vi.fn(async () => []),
  beginCardEdit: vi.fn(async () => ({ resubmit: false })),
  fetchRatingDraft: vi.fn(async () => null),
  saveRatingDraft: vi.fn(async () => {}),
  deleteRole: vi.fn(async () => {}),
  unregisterCard: vi.fn(async () => {}),
  uploadImage: vi.fn(async () => 'https://img.test/avatar.png'),
  fetchAuthorAsset: vi.fn(async () => ({ rules: [], mountTrigger: '', mountLayer: '', pageMode: 'classic', status: 'none', version: 0 })),
  saveAuthorAsset: vi.fn(async (_roleId: string, body: { version: number }) => ({ ...body, status: 'passed', version: body.version + 1 })),
}));

vi.mock('../src/lib/api', async (original) => ({
  ...api,
  ApiError: (await original<typeof import('../src/lib/api')>()).ApiError,
}));
vi.mock('../src/lib/session', () => ({
  useSession: () => ({
    profile: { memberId: 'm1', displayName: 'Ada', identities: [{ provider: 'harbor', externalId: '7' }] },
    accessToken: async () => 'tok',
    me: { accountNumId: 7, nickName: '作者', avatar: '' },
  }),
}));
vi.mock('../src/lib/track', () => ({ track: () => {}, currentSurface: () => 'create', setSurface: () => {} }));
vi.mock('../src/lib/use-image-generation', async () => {
  const { ref } = await import('vue');
  return {
    useImageGeneration: () => ({
      imageGen: ref(null),
      generator: async () => ({ create: vi.fn(), wait: vi.fn(), save: vi.fn() }),
      probeGeneration: async () => {},
      markReauthorizing: () => {},
    }),
  };
});

import CardEditorPage from '../src/pages/CardEditorPage.vue';

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  await nextTick();
};

function collectComponentStyles(): string {
  const files = [
    'src/styles/tokens.css',
    'src/styles/base.css',
    'src/pages/CardEditorPage.vue',
    'src/components/editor/WorldbookEditor.vue',
    'src/components/editor/WorldbookEntriesDialog.vue',
    'src/components/editor/FieldText.vue',
  ];
  return files
    .map((file) => {
      const src = readFileSync(file, 'utf8');
      if (file.endsWith('.css')) return src;
      return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    })
    .join('\n');
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Crop top-left (0, 0) -> (cropW, cropH) from a 8-bit RGB/RGBA PNG. */
function cropPngTopLeft(pngBytes: Uint8Array, cropW: number, cropH: number): Uint8Array {
  const chunks = readChunks(pngBytes);
  const ihdr = chunks.find((c) => c.type === 'IHDR')!;
  const view = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const srcW = view.getUint32(0);
  const srcH = view.getUint32(4);
  const colorType = ihdr.data[9];
  const bpp = colorType === 6 ? 4 : 3;
  const idatTotal = chunks.filter((c) => c.type === 'IDAT').reduce((n, c) => n + c.data.length, 0);
  const idat = new Uint8Array(idatTotal);
  let offset = 0;
  for (const c of chunks) {
    if (c.type === 'IDAT') {
      idat.set(c.data, offset);
      offset += c.data.length;
    }
  }
  const raw = inflateSync(idat);
  const stride = srcW * bpp;
  const rawStride = stride + 1;
  const pixels = new Uint8Array(srcH * stride);
  for (let y = 0; y < srcH; y++) {
    const filter = raw[y * rawStride];
    const rowIn = y * rawStride + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const byte = raw[rowIn + x];
      const left = x >= bpp ? pixels[rowOut + x - bpp] : 0;
      const up = y > 0 ? pixels[rowOut - stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? pixels[rowOut - stride + x - bpp] : 0;
      pixels[rowOut + x] =
        filter === 0
          ? byte
          : filter === 1
            ? (byte + left) & 0xff
            : filter === 2
              ? (byte + up) & 0xff
              : filter === 3
                ? (byte + ((left + up) >> 1)) & 0xff
                : (byte + paeth(left, up, upLeft)) & 0xff;
    }
  }
  const outStride = cropW * bpp;
  const outRaw = new Uint8Array(cropH * (outStride + 1));
  for (let y = 0; y < cropH; y++) {
    outRaw[y * (outStride + 1)] = 0;
    outRaw.set(pixels.subarray(y * stride, y * stride + outStride), y * (outStride + 1) + 1);
  }
  const newIhdr = ihdr.data.slice();
  const newView = new DataView(newIhdr.buffer, newIhdr.byteOffset, newIhdr.byteLength);
  newView.setUint32(0, cropW);
  newView.setUint32(4, cropH);
  return writeChunks([
    { type: 'IHDR', data: newIhdr },
    { type: 'IDAT', data: new Uint8Array(deflateSync(outRaw)) },
    { type: 'IEND', data: new Uint8Array(0) },
  ]);
}

describe('card editor word count layout across 5 locales, phone & desktop, light & dark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ enabled: false })));
  });

  it('renders without horizontal overflow or control overlap in Chrome at 390px and 1440px across all 5 locales', async () => {
    const chrome =
      process.env.CHROME_BIN ||
      ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
    expect(chrome, 'Chrome is required for responsive geometry').toBeTruthy();

    const styles = collectComponentStyles();
    const locales = [...LOCALE_CODES];
    const htmlByLocale: Record<string, { editorHtml: string; dialogHtml: string }> = {};

    for (const loc of locales) {
      await applyLocale(loc);

      const host = document.createElement('div');
      document.body.appendChild(host);
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/cards/:roleId/edit', component: CardEditorPage }],
      });
      await router.push('/cards/r1/edit');
      await router.isReady();
      const app = createApp({ render: () => h(RouterView) });
      app.use(createPinia()).use(router).use(i18n);
      app.mount(host);
      await flush();

      const editorHtml = host.innerHTML;

      // Open WorldbookEntriesDialog to capture its rendered DOM too
      const manageBtn = host.querySelector<HTMLButtonElement>('[data-section="worldbook"] .wb__entries-head button');
      expect(manageBtn).toBeTruthy();
      manageBtn!.click();
      await flush();
      const dialogEl = document.body.querySelector('.wbd');
      expect(dialogEl).toBeTruthy();
      const dialogHtml = dialogEl!.outerHTML;

      app.unmount();
      host.remove();
      htmlByLocale[loc] = { editorHtml, dialogHtml };
    }

    const dir = mkdtempSync(join(tmpdir(), 'editor-word-count-layout-'));
    const shotsDir = process.env.CAPTURE_SHOTS_DIR;
    if (shotsDir) mkdirSync(shotsDir, { recursive: true });

    try {
      const frames: string[] = [];
      for (const loc of locales) {
        for (const width of [390, 1440]) {
          for (const mode of ['light', 'dark'] as const) {
            const { editorHtml, dialogHtml } = htmlByLocale[loc];
            const doc = `<!doctype html><html lang="${loc}" data-mode="${mode}"><head><meta charset="utf-8"><style>${styles}</style></head><body><main class="container">${editorHtml}</main><div id="dialog-mount">${dialogHtml}</div></body></html>`;
            const escaped = doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            frames.push(
              `<iframe data-loc="${loc}" data-width="${width}" data-mode="${mode}" style="border:0;width:${width}px;height:900px" srcdoc="${escaped}" onload="
                const d = this.contentDocument;
                const topbar = d.querySelector('.topbar');
                const side = d.querySelector('.side');
                const topCount = d.querySelector('[data-card-constant-count]');
                const wbHead = d.querySelector('[data-section=worldbook] .wb__entries-head');
                const wbTotal = d.querySelector('[data-section=worldbook] [data-worldbook-total]');
                const wbBtn = wbHead.querySelector('button');
                const dlgHead = d.querySelector('.wbd__head');
                const dlgTotal = d.querySelector('[data-worldbook-dialog-total]');
                const dlgBtn = dlgHead.querySelector('button');
                const tr = topbar.getBoundingClientRect();
                const sr = side.getBoundingClientRect();
                const tcr = topCount.getBoundingClientRect();
                const whr = wbHead.getBoundingClientRect();
                const wtr = wbTotal.getBoundingClientRect();
                const wbr = wbBtn.getBoundingClientRect();
                const dhr = dlgHead.getBoundingClientRect();
                const dtr = dlgTotal.getBoundingClientRect();
                const dbr = dlgBtn.getBoundingClientRect();
                const overlaps = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
                window.results.push({
                  loc: '${loc}',
                  width: ${width},
                  mode: '${mode}',
                  topCountVisible: tcr.width > 0 && tcr.height > 0,
                  topCountInBounds: tcr.right <= tr.right + 1 && tcr.left >= tr.left - 1,
                  topNavOverlap: overlaps(sr, tcr),
                  wbTotalVisible: wtr.width > 0 && wtr.height > 0,
                  wbTotalInBounds: wtr.right <= whr.right + 1 && wtr.left >= whr.left - 1,
                  wbButtonOverlap: overlaps(wtr, wbr),
                  dlgTotalVisible: dtr.width > 0 && dtr.height > 0,
                  dlgTotalInBounds: dtr.right <= dhr.right + 1 && dtr.left >= dhr.left - 1,
                  dlgButtonOverlap: overlaps(dtr, dbr)
                });
                document.querySelector('#result').textContent = JSON.stringify(window.results);
              "></iframe>`,
            );
          }
        }
      }

      const fixture = join(dir, 'fixture.html');
      writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><script>window.results=[]</script>${frames.join('')}<pre id="result"></pre>`);
      const run = spawnSync(
        chrome!,
        [
          '--headless=new',
          '--no-sandbox',
          '--no-first-run',
          '--no-default-browser-check',
          `--user-data-dir=${join(dir, 'profile')}`,
          '--dump-dom',
          '--virtual-time-budget=2000',
          `file://${fixture}`,
        ],
        { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
      );
      expect(run.error, run.stderr).toBeUndefined();
      expect(run.status, run.stderr).toBe(0);
      const json = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
      expect(json, 'Expected geometry results from Chrome').toBeTruthy();
      const results = JSON.parse(json!) as Array<Record<string, unknown>>;
      expect(results).toHaveLength(locales.length * 2 * 2);
      for (const row of results) {
        const label = `${row.loc} ${row.width}px ${row.mode}`;
        expect(row.topCountVisible, `${label}: topCountVisible`).toBe(true);
        expect(row.topCountInBounds, `${label}: topCountInBounds`).toBe(true);
        expect(row.topNavOverlap, `${label}: topNavOverlap`).toBe(false);
        expect(row.wbTotalVisible, `${label}: wbTotalVisible`).toBe(true);
        expect(row.wbTotalInBounds, `${label}: wbTotalInBounds`).toBe(true);
        expect(row.wbButtonOverlap, `${label}: wbButtonOverlap`).toBe(false);
        expect(row.dlgTotalVisible, `${label}: dlgTotalVisible`).toBe(true);
        expect(row.dlgTotalInBounds, `${label}: dlgTotalInBounds`).toBe(true);
        expect(row.dlgButtonOverlap, `${label}: dlgButtonOverlap`).toBe(false);
      }

      if (shotsDir) {
        const shotCases: Array<{ name: string; loc: string; width: number; height: number; mode: 'light' | 'dark'; view: 'top' | 'worldbook' | 'dialog' }> = [
          { name: 'editor-top-desktop-dark-zh-Hant.png', loc: 'zh-Hant', width: 1440, height: 900, mode: 'dark', view: 'top' },
          { name: 'editor-top-desktop-light-zh-Hant.png', loc: 'zh-Hant', width: 1440, height: 900, mode: 'light', view: 'top' },
          { name: 'editor-top-phone-dark-zh-Hant.png', loc: 'zh-Hant', width: 390, height: 844, mode: 'dark', view: 'top' },
          { name: 'editor-top-phone-light-en.png', loc: 'en', width: 390, height: 844, mode: 'light', view: 'top' },
          { name: 'editor-worldbook-desktop-dark-zh-Hant.png', loc: 'zh-Hant', width: 1440, height: 900, mode: 'dark', view: 'worldbook' },
          { name: 'editor-worldbook-phone-dark-en.png', loc: 'en', width: 390, height: 844, mode: 'dark', view: 'worldbook' },
          { name: 'editor-dialog-desktop-dark-zh-Hant.png', loc: 'zh-Hant', width: 1440, height: 900, mode: 'dark', view: 'dialog' },
          { name: 'editor-dialog-phone-light-ja.png', loc: 'ja', width: 390, height: 844, mode: 'light', view: 'dialog' },
        ];
        for (const sc of shotCases) {
          const { editorHtml, dialogHtml } = htmlByLocale[sc.loc];
          const extraCss =
            sc.view === 'worldbook'
              ? `.pane:not([data-section="worldbook"]) { display: none !important; }`
              : '';
          const bodyHtml =
            sc.view === 'dialog'
              ? `<main class="container">${editorHtml}</main>${dialogHtml}`
              : `<main class="container">${editorHtml}</main>`;
          const innerDoc = `<!doctype html><html lang="${sc.loc}" data-mode="${sc.mode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}\n${extraCss}</style></head><body>${bodyHtml}</body></html>`;
          const escapedInner = innerDoc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
          const shotHtmlFile = join(dir, `${sc.name}.html`);
          writeFileSync(
            shotHtmlFile,
            `<!doctype html><html style="margin:0;padding:0;overflow:hidden"><body style="margin:0;padding:0;overflow:hidden;background:#000"><iframe style="border:0;width:${sc.width}px;height:${sc.height}px;display:block" srcdoc="${escapedInner}"></iframe></body></html>`,
          );
          const rawPng = join(dir, `raw-${sc.name}`);
          const outPng = join(shotsDir, sc.name);
          const winW = Math.max(sc.width, 500);
          const winH = sc.height + 160;
          const shotRun = spawnSync(
            chrome!,
            [
              '--headless=new',
              '--no-sandbox',
              '--no-first-run',
              '--no-default-browser-check',
              '--hide-scrollbars',
              '--force-device-scale-factor=1',
              `--user-data-dir=${join(dir, 'shot-profile-' + sc.name)}`,
              `--window-size=${winW},${winH}`,
              `--screenshot=${rawPng}`,
              `file://${shotHtmlFile}`,
            ],
            { encoding: 'utf8', timeout: 20000 },
          );
          expect(shotRun.status, shotRun.stderr).toBe(0);
          const cropped = cropPngTopLeft(readFileSync(rawPng), sc.width, sc.height);
          writeFileSync(outPng, cropped);
          expect(existsSync(outPng), `Expected screenshot ${outPng}`).toBe(true);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await applyLocale('zh-Hant');
    }
  }, 60000);
});
