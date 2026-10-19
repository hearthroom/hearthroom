/**
 * 主頁資料頭的原地編輯（取代原本把頁面拉長的內嵌表單）。
 * 原 community-profile-edit 的保證全部保留：不收網址、取消不存、失敗不丟字、動圖原檔上傳、壞檔擋下、打賞連結的引導與檢查；
 * 再加上：靜態圖先進原地裁切、封面只送目錄裡的場景。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, toRaw, type App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '../src/lib/i18n';
const fixture = vi.hoisted(() => ({ save: vi.fn(), session: { me: {}, displayName: 'Author', avatarUrl: '', wallet: null, profile: { handle: 'author01', memberSince: 0, displayName: 'Author', bio: 'Existing bio', avatarUrl: '', cover: '', tipLinks: [] as string[], identities: [] }, accessToken: async () => 'test' } as any }));
vi.mock('../src/lib/session', () => ({ useSession: () => fixture.session }));
vi.mock('../src/lib/api', async (original) => ({ ...(await original<object>()), updateSiteProfile: fixture.save }));
import ProfileHero from '../src/components/profile/ProfileHero.vue';

let app: App, el: HTMLDivElement;
const settle = async () => { for (let i = 0; i < 4; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
const buttons = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === text);
const saveButton = () => buttons(i18n.global.t('profile.save'))[0]!;
beforeEach(async () => {
  vi.clearAllMocks();
  fixture.session.profile = { ...fixture.session.profile, bio: 'Existing bio', cover: '', tipLinks: [] };
  el = document.createElement('div'); document.body.append(el);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:p(.*)*', component: { template: '<div/>' } }] });
  app = createApp(ProfileHero, { community: null, badges: null, author: null }).use(i18n).use(router);
  app.mount(el); await settle();
  buttons(i18n.global.t('profile.editProfile'))[0]!.click(); await settle();
});
afterEach(() => { app.unmount(); el.remove(); vi.restoreAllMocks(); });

it('edits in place: name and bio fields, a file picker, the cover scenes, and a floating save bar', () => {
  expect(el.querySelector('input[type=url]')).toBeNull();
  expect(el.querySelector('input[type=file]')).not.toBeNull();
  expect(el.querySelector('textarea')?.value).toBe('Existing bio');
  expect(el.querySelectorAll('[role=radiogroup] [role=radio]').length).toBeGreaterThan(3);
  expect(el.querySelector('.savebar')).not.toBeNull();
});

it('discard does not upload or save a profile', async () => {
  buttons(i18n.global.t('profile.discard'))[0]!.click(); await settle();
  expect(fixture.save).not.toHaveBeenCalled();
  expect(el.querySelector('.savebar')).toBeNull();
});

it('keeps edits visible after a failed save', async () => {
  fixture.save.mockRejectedValue(new Error('unavailable'));
  saveButton().click(); await settle();
  expect(el.querySelector('[role=alert]')).not.toBeNull();
  expect(el.querySelector('textarea')?.value).toBe('Existing bio');
});

it('sends the chosen scene as the cover', async () => {
  fixture.save.mockResolvedValue(fixture.session.profile);
  el.querySelector<HTMLButtonElement>('[role=radio][data-cover="sakura"]')!.click(); await settle();
  saveButton().click(); await settle();
  expect(fixture.save.mock.calls[0][1].cover).toBe('sakura');
});

const pick = async (selected: File) => {
  const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [selected], configurable: true });
  input.dispatchEvent(new Event('change')); await settle();
};

it.each([['image/gif', 'GIF89a'], ['image/apng', '\x89PNGacTL']])('uploads animated %s untouched instead of cropping it', async (type, head) => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:avatar-test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  fixture.save.mockResolvedValue(fixture.session.profile);
  const selected = new File([head, new Uint8Array(1024)], 'avatar', { type });
  await pick(selected);
  expect(el.querySelector('.cropper')).toBeNull();
  expect(el.querySelector('.hero__face')?.getAttribute('src')).toBe('blob:avatar-test');
  saveButton().click(); await settle();
  expect(toRaw(fixture.save.mock.calls[0][1].avatar) === selected).toBe(true);
  create.mockRestore();
});

it('opens the in-place cropper for a still image and does not save until it is applied', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:still');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  await pick(new File([new Uint8Array(64)], 'avatar.jpg', { type: 'image/jpeg' }));
  expect(el.querySelector('.cropper')).not.toBeNull();
  expect(saveButton().disabled).toBe(true);
  expect(fixture.save).not.toHaveBeenCalled();
});

it.each([['image/gif', 10 * 1024 * 1024 + 1], ['image/svg+xml', 32]])('rejects invalid avatar %s (%i bytes) without submitting it', async (type, size) => {
  await pick(new File([new Uint8Array(size)], 'avatar', { type }));
  expect(el.querySelector('[role=alert]')?.textContent).toContain('10 MB');
  expect(el.querySelector('.cropper')).toBeNull();
  expect(fixture.save).not.toHaveBeenCalled();
});

// 打賞連結：先選平台再填；只打帳號名也行，送出前組成那個平台的個人頁網址
const tipInputs = () => [...el.querySelectorAll<HTMLInputElement>('input[id^=tip-link-]')];
const type = async (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input')); await settle(); };
const openPicker = async () => { el.querySelector<HTMLButtonElement>('.tips-field__add')?.click(); await settle(); };
const pickPlatform = async (name: string) => { await openPicker(); [...el.querySelectorAll<HTMLButtonElement>('.tips-pick__item')].find((b) => b.textContent!.includes(name))!.click(); await settle(); };
it('keeps the platform list folded until asked, then lists what each is for and guides filling the chosen one', async () => {
  fixture.save.mockResolvedValue(fixture.session.profile);
  expect(el.querySelector('.tips-pick')).toBeNull();
  await openPicker();
  const items = [...el.querySelectorAll('.tips-pick__item')];
  expect(items).toHaveLength(7);
  expect(items[0].textContent).toContain('pixiv FANBOX');
  await pickPlatform('Ko-fi');
  expect(el.querySelector('.tips-row__caution')).not.toBeNull();
  await type(tipInputs()[0], 'nightferry');
  saveButton().click(); await settle();
  expect(fixture.save.mock.calls[0][1].tipLinks).toEqual(['https://ko-fi.com/nightferry']);
});
it('blocks saving while a tip link is unrecognized', async () => {
  await pickPlatform('pixiv FANBOX');
  await type(tipInputs()[0], 'https://paypal.me/nightferry');
  expect(tipInputs()[0].getAttribute('aria-invalid')).toBe('true');
  saveButton().click(); await settle();
  expect(fixture.save).not.toHaveBeenCalled();
  expect(el.querySelector('[role=alert]')).not.toBeNull();
});
