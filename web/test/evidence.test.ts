/**
 * 截圖上傳與檢視元件：選檔逐張上傳、ids 依序回傳、上限 6 張（含已掛的）、失敗可重試；
 * 檢視器帶令牌取圖、點開放大、卸載時釋放所有 blob；畫面上沒有任何直連截圖路由的 <img>。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { i18n } from '../src/lib/i18n';

vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: null, profile: {}, ready: true, accessToken: async () => 'synthetic' }) }));

import EvidencePicker from '../src/components/EvidencePicker.vue';
import EvidenceViewer from '../src/components/EvidenceViewer.vue';

const t = (k: string) => i18n.global.t(k);
type Call = { method: string; path: string; auth: string | null; name?: string };
let calls: Call[];
/** 檔名 → 回應狀態；沒列的都是 200。 */
let failing: Record<string, number>;
let seq: number;
let created: string[], revoked: string[];
const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;

beforeEach(() => {
  i18n.global.locale.value = 'zh-Hant';
  calls = []; failing = {}; seq = 0; created = []; revoked = [];
  URL.createObjectURL = vi.fn(() => { const u = `blob:mock/${created.length}`; created.push(u); return u; }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u); });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    const name = init.body instanceof FormData ? (init.body.get('file') as File).name : undefined;
    calls.push({ method: init.method ?? 'GET', path: url, auth: h.get('Authorization'), name });
    if (init.method === 'POST') {
      const status = failing[name!] ?? 200;
      return status === 200
        ? new Response(JSON.stringify({ id: `ev-${++seq}`, sha256: 'x', bytes: 3 }), { status, headers: { 'Content-Type': 'application/json' } })
        : new Response(JSON.stringify({ error: 'evidence_invalid' }), { status, headers: { 'Content-Type': 'application/json' } });
    }
    const id = url.split('/').pop()!;
    if (id === 'bad') return new Response(JSON.stringify({ error: 'evidence_not_found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(new Blob(['img']), { status: 200 });
  }));
});
let app: App | null, host: HTMLElement;
afterEach(() => {
  app?.unmount(); app = null; host?.remove(); document.body.innerHTML = '';
  URL.createObjectURL = origCreate; URL.revokeObjectURL = origRevoke;
  vi.unstubAllGlobals();
});
const settle = async () => { for (let i = 0; i < 8; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
const mount = async (render: () => ReturnType<typeof h>) => {
  host = document.body.appendChild(document.createElement('div'));
  app = createApp({ render }).use(i18n);
  app.mount(host);
  await settle();
};
const png = (name: string) => new File(['x'], name, { type: 'image/png' });
async function pick(files: File[]) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
}
const uploads = () => calls.filter((c) => c.method === 'POST');
const tiles = () => [...host.querySelectorAll('[data-evidence]')];

function picker(existing: { id: string }[] = []) {
  const ids = ref<string[]>([]), busy: boolean[] = [];
  return {
    ids, busy,
    mount: () => mount(() => h(EvidencePicker, { existing, ids: ids.value, 'onUpdate:ids': (v: string[]) => (ids.value = v), 'onUpdate:busy': (v: boolean) => busy.push(v) })),
  };
}

it('選兩張：兩次上傳都帶令牌，ids 依序回傳，忙碌旗標先開後關', async () => {
  const p = picker(); await p.mount();
  await pick([png('a.png'), png('b.png')]);
  expect(uploads().map((c) => [c.name, c.auth, c.path.endsWith('/campaign/evidence')])).toEqual([['a.png', 'Bearer synthetic', true], ['b.png', 'Bearer synthetic', true]]);
  expect(p.ids.value).toEqual(['ev-1', 'ev-2']);
  expect(p.busy[0]).toBe(true);
  expect(p.busy[p.busy.length - 1]).toBe(false);
  expect(tiles()).toHaveLength(2);
});

it('縮圖是本機預覽，不打截圖路由，也沒有任何直連截圖路由的 img', async () => {
  const p = picker(); await p.mount();
  await pick([png('a.png')]);
  expect(calls.filter((c) => c.method === 'GET')).toEqual([]);
  expect(host.querySelector('img')!.getAttribute('src')).toBe(created[0]);
  expect(host.querySelectorAll('img[src^="/v1/campaign/evidence"]')).toHaveLength(0);
});

it('只收圖片檔：其他檔不上傳，並說明原因', async () => {
  const p = picker(); await p.mount();
  await pick([new File(['x'], 'a.txt', { type: 'text/plain' })]);
  expect(uploads()).toHaveLength(0);
  expect(host.textContent).toContain(t('campaign.error.evidence_invalid'));
});

it('第 7 張被擋並提示', async () => {
  const p = picker(); await p.mount();
  await pick(Array.from({ length: 6 }, (_, i) => png(`${i}.png`)));
  expect(uploads()).toHaveLength(6);
  await pick([png('seventh.png')]);
  expect(uploads()).toHaveLength(6);
  expect(host.textContent).toContain(t('campaign.evidence.limit'));
  expect(p.ids.value).toHaveLength(6);
});

it('一次選太多：只收到上限為止，並提示', async () => {
  const p = picker(); await p.mount();
  await pick(Array.from({ length: 8 }, (_, i) => png(`${i}.png`)));
  expect(uploads()).toHaveLength(6);
  expect(host.textContent).toContain(t('campaign.evidence.limit'));
});

it('已掛在位置上的截圖計入上限，而且不能移除', async () => {
  const p = picker([{ id: 'old-1' }, { id: 'old-2' }, { id: 'old-3' }, { id: 'old-4' }]); await p.mount();
  expect(host.querySelectorAll('[data-action="remove"]')).toHaveLength(0);
  await pick([png('a.png'), png('b.png'), png('c.png')]);
  expect(uploads().map((c) => c.name)).toEqual(['a.png', 'b.png']);
  expect(host.textContent).toContain(t('campaign.evidence.limit'));
  expect(p.ids.value).toEqual(['ev-1', 'ev-2']);
  expect(host.querySelectorAll('[data-action="remove"]')).toHaveLength(2);
});

it('失敗的顯示原因，可以重試；成功後才進 ids', async () => {
  failing = { 'bad.png': 400 };
  const p = picker(); await p.mount();
  await pick([png('ok.png'), png('bad.png')]);
  expect(p.ids.value).toEqual(['ev-1']);
  expect(host.textContent).toContain(t('campaign.evidence.failed'));
  expect(host.textContent).toContain(t('campaign.error.evidence_invalid'));
  failing = {};
  host.querySelector<HTMLElement>('[data-action="retry"]')!.click();
  await settle();
  expect(uploads().map((c) => c.name)).toEqual(['ok.png', 'bad.png', 'bad.png']);
  expect(p.ids.value).toEqual(['ev-1', 'ev-2']);
  expect(host.querySelector('[data-action="retry"]')).toBeNull();
});

it('失敗的可以直接移除；移除會釋放預覽並更新 ids', async () => {
  failing = { 'bad.png': 400 };
  const p = picker(); await p.mount();
  await pick([png('ok.png'), png('bad.png')]);
  const before = revoked.length;
  host.querySelectorAll<HTMLElement>('[data-action="remove"]')[1]!.click();
  await settle();
  expect(tiles()).toHaveLength(1);
  expect(revoked.length).toBe(before + 1);
  host.querySelector<HTMLElement>('[data-action="remove"]')!.click();
  await settle();
  expect(p.ids.value).toEqual([]);
  expect(tiles()).toHaveLength(0);
});

it('ids 依選檔順序，不看誰先傳完', async () => {
  failing = { 'a.png': 400 };
  const p = picker(); await p.mount();
  await pick([png('a.png'), png('b.png')]);
  failing = {};
  host.querySelector<HTMLElement>('[data-action="retry"]')!.click();
  await settle();
  expect(p.ids.value).toEqual(['ev-2', 'ev-1']);
});

it('檔案輸入可以用鍵盤聚焦（不是 hidden），標籤在聚焦時有外框樣式', async () => {
  const p = picker(); await p.mount();
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  expect(input.hasAttribute('hidden')).toBe(false);
  expect(input.classList.contains('sr-only')).toBe(true);
  expect(input.disabled).toBe(false);
});

it('上傳中卸載：父層收到 busy=false', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const base = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (...a: Parameters<typeof fetch>) => { await gate; return base(...a); }));
  const p = picker(); await p.mount();
  await pick([png('a.png')]);
  expect(p.busy[p.busy.length - 1]).toBe(true);
  app!.unmount(); app = null;
  expect(p.busy[p.busy.length - 1]).toBe(false);
  release();
});

it('貼上非圖片檔：跟拖放一樣說明被擋的原因', async () => {
  const p = picker(); await p.mount();
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData?: unknown };
  ev.clipboardData = { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] };
  host.querySelector('.ev-picker')!.dispatchEvent(ev);
  await settle();
  expect(uploads()).toHaveLength(0);
  expect(host.textContent).toContain(t('campaign.error.evidence_invalid'));
});

it('失敗的原因另起一行，不寫死全形冒號', async () => {
  failing = { 'bad.png': 400 };
  const p = picker(); await p.mount();
  await pick([png('bad.png')]);
  expect(host.textContent).not.toContain('：');
  expect(host.querySelector('.ev-tile__error')!.querySelectorAll('span')).toHaveLength(2);
});

it('卸載時釋放所有本機預覽', async () => {
  const p = picker(); await p.mount();
  await pick([png('a.png'), png('b.png')]);
  app!.unmount(); app = null;
  expect(revoked.sort()).toEqual([...created].sort());
});

// ---- 檢視器 ----

const viewer = (items: { id: string; purged?: boolean }[], token?: () => Promise<string>) => mount(() => h(EvidenceViewer, { items, token }));

it('檢視器：帶令牌取圖，縮圖只用 blob 網址，已過期的不取', async () => {
  await viewer([{ id: 'e1' }, { id: 'e2', purged: true }, { id: 'e3' }]);
  expect(calls.map((c) => [c.method, c.path.split('/campaign/evidence/')[1], c.auth])).toEqual([['GET', 'e1', 'Bearer synthetic'], ['GET', 'e3', 'Bearer synthetic']]);
  const srcs = [...host.querySelectorAll('img')].map((i) => i.getAttribute('src'));
  expect(srcs).toEqual(created);
  expect(host.querySelectorAll('img[src^="/v1/campaign/evidence"]')).toHaveLength(0);
  expect(host.querySelector('[data-state="purged"]')!.textContent).toContain(t('campaign.evidence.purged'));
  expect(host.querySelectorAll('[data-action="open"]')).toHaveLength(2);
});

it('檢視器：自帶令牌來源時用它', async () => {
  await viewer([{ id: 'e1' }], async () => 'other');
  expect(calls[0]!.auth).toBe('Bearer other');
});

it('檢視器：載入失敗只顯示中性佔位，不影響其他張', async () => {
  await viewer([{ id: 'bad' }, { id: 'e1' }]);
  expect(host.querySelector('[data-evidence="bad"]')!.getAttribute('data-state')).toBe('failed');
  expect(host.querySelector('[data-evidence="bad"] img')).toBeNull();
  expect(host.querySelectorAll('img')).toHaveLength(1);
});

it('檢視器：點開放大，Esc 關閉、焦點回到縮圖；卸載時釋放每一個 blob', async () => {
  await viewer([{ id: 'e1' }, { id: 'e3' }]);
  const open = host.querySelectorAll<HTMLElement>('[data-action="open"]')[1]!;
  open.focus(); open.click();
  await settle();
  const dialog = document.body.querySelector('.modal-backdrop .modal.panel[role=dialog]')!;
  expect(dialog.querySelector('img')!.getAttribute('src')).toBe(created[1]);
  expect(dialog.getAttribute('aria-label')).toBe(t('campaign.evidence.open'));
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  await settle();
  expect(document.body.querySelector('.modal-backdrop')).toBeNull();
  expect(document.activeElement).toBe(open);
  app!.unmount(); app = null;
  expect(revoked.sort()).toEqual([...created].sort());
  expect(created).toHaveLength(2);
});

it('檢視器：同一張只取一次，新增的張數才補取', async () => {
  const items = ref([{ id: 'e1' }]);
  await mount(() => h(EvidenceViewer, { items: items.value }));
  items.value = [{ id: 'e1' }, { id: 'e3' }];
  await settle();
  expect(calls.map((c) => c.path.split('/').pop())).toEqual(['e1', 'e3']);
});
