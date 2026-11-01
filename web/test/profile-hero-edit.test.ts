/**
 * 主頁資料頭的原地編輯（取代原本把頁面拉長的內嵌表單）。
 * 原 community-profile-edit 的保證全部保留：不收網址、取消不存、失敗不丟字、動圖原檔上傳、壞檔擋下、打賞連結的引導與檢查；
 * 再加上：靜態圖先進原地裁切、封面只送目錄裡的場景。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, toRaw, type App } from 'vue';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { i18n } from '../src/lib/i18n';
const fixture = vi.hoisted(() => ({ save: vi.fn(), confirm: vi.fn(), session: { me: {}, displayName: 'Author', avatarUrl: '', wallet: null, profile: { handle: 'author01', memberSince: 0, displayName: 'Author', bio: 'Existing bio', avatarUrl: '', cover: '', tipLinks: [] as string[], identities: [] }, accessToken: async () => 'test' } as any }));
vi.mock('../src/lib/session', () => ({ useSession: () => fixture.session }));
vi.mock('../src/lib/api', async (original) => ({ ...(await original<object>()), updateSiteProfile: fixture.save }));
vi.mock('../src/lib/confirm', () => ({ confirmDialog: fixture.confirm }));
import ProfileHero from '../src/components/profile/ProfileHero.vue';

// 頂部取消／保存在不在視窗內：happy-dom 沒有版面，用替身決定，預設在視窗內
const observed = vi.hoisted(() => ({ callbacks: [] as ((entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void)[] }));
class FakeObserver { constructor(cb: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void) { observed.callbacks.push(cb); } observe() {} disconnect() {} unobserve() {} }
const topActionsInView = async (inView: boolean) => { observed.callbacks.forEach((cb) => cb([{ isIntersecting: inView, intersectionRatio: inView ? 1 : 0 }])); await settle(); };

let router: Router;
let app: App, el: HTMLDivElement;
const settle = async () => { for (let i = 0; i < 4; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); } };
const buttons = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === text);
const saveButton = () => buttons(i18n.global.t('profile.save'))[0]!;
beforeEach(async () => {
  vi.clearAllMocks();
  observed.callbacks.length = 0;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  fixture.session.profile = { ...fixture.session.profile, bio: 'Existing bio', cover: '', tipLinks: [] };
  el = document.createElement('div'); document.body.append(el);
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/me', component: ProfileHero, props: { community: null, badges: null, author: null } }, { path: '/elsewhere', component: { template: '<div/>' } }] });
  await router.push('/me');
  app = createApp({ render: () => h(RouterView) }).use(i18n).use(router);
  app.mount(el); await settle();
  buttons(i18n.global.t('profile.editProfile'))[0]!.click(); await settle();
});
afterEach(() => { app.unmount(); el.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const nameInput = () => el.querySelector<HTMLInputElement>('input[autocomplete=nickname]')!;
const topCancel = () => el.querySelector<HTMLButtonElement>('.hero__actions--editing .btn:not(.btn--primary)')!;
const topSave = () => el.querySelector<HTMLButtonElement>('.hero__actions--editing .btn--primary')!;

it('edits in place: name and bio fields, a file picker, the cover scenes, and no bottom bar before any change', () => {
  expect(el.querySelector('input[type=url]')).toBeNull();
  expect(el.querySelector('input[type=file]')).not.toBeNull();
  expect(el.querySelector('textarea')?.value).toBe('Existing bio');
  expect(el.querySelectorAll('[role=radiogroup] [role=radio]').length).toBeGreaterThan(3);
  expect(document.querySelector('.savebar')).toBeNull();
});

it('moves keyboard focus to the name field when editing starts', () => {
  expect(document.activeElement).toBe(nameInput());
});

it('cancel without changes leaves editing at once, without asking or saving', async () => {
  topCancel().click(); await settle();
  expect(fixture.confirm).not.toHaveBeenCalled();
  expect(fixture.save).not.toHaveBeenCalled();
  expect(el.querySelector('.hero__actions--editing')).toBeNull();
});

it('keeps save disabled until something changes, and marks unsaved changes beside the buttons', async () => {
  expect(topSave().disabled).toBe(true);
  expect(el.querySelector('.hero__unsaved')).toBeNull();
  await type(nameInput(), 'Edited');
  expect(topSave().disabled).toBe(false);
  expect(el.querySelector('.hero__actions--editing .hero__unsaved')?.textContent).toContain(i18n.global.t('profile.unsaved'));
});

it('asks before cancelling changes; declining keeps them, confirming drops them without saving', async () => {
  await type(nameInput(), 'Edited');
  fixture.confirm.mockResolvedValue(false);
  topCancel().click(); await settle();
  expect(fixture.confirm).toHaveBeenCalledTimes(1);
  expect(fixture.confirm.mock.calls[0][0]).toMatchObject({ danger: true, confirmText: i18n.global.t('profile.discardConfirm'), cancelText: i18n.global.t('profile.keepEditing') });
  expect(nameInput().value).toBe('Edited');
  fixture.confirm.mockResolvedValue(true);
  topCancel().click(); await settle();
  expect(el.querySelector('.hero__actions--editing')).toBeNull();
  expect(fixture.save).not.toHaveBeenCalled();
});

it('shows the bottom bar only with changes while the top buttons are out of view', async () => {
  await topActionsInView(false);
  expect(document.querySelector('.savebar')).toBeNull();
  await type(nameInput(), 'Edited');
  expect(document.body.querySelector(':scope > .savebar')).not.toBeNull();
  await topActionsInView(true);
  expect(document.querySelector('.savebar')).toBeNull();
});

it('keeps edits visible after a failed save and brings the error into view', async () => {
  const scrolled = vi.fn(), original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scrolled;
  try {
    fixture.save.mockRejectedValue(new Error('unavailable'));
    await type(el.querySelector<HTMLTextAreaElement>('textarea')! as unknown as HTMLInputElement, 'New bio');
    saveButton().click(); await settle();
    expect(el.querySelector('[role=alert]')).not.toBeNull();
    expect(el.querySelector('textarea')?.value).toBe('New bio');
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' });
  } finally { Element.prototype.scrollIntoView = original; }
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
  expect(buttons(i18n.global.t('profile.save')).every((b) => b.disabled)).toBe(true);
  expect(fixture.save).not.toHaveBeenCalled();
  // 裁切區的退出只放棄這張圖，和頂部「取消」（放棄整次編輯）分開命名
  expect(el.querySelector('.cropper')?.textContent).toContain(i18n.global.t('profile.crop.cancel'));
  buttons(i18n.global.t('profile.crop.cancel'))[0]!.click(); await settle();
  expect(el.querySelector('.cropper')).toBeNull();
  expect(el.querySelector('.hero__actions--editing')).not.toBeNull();
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


it('keeps save and cancel beside the editing fields', () => {
  expect(topSave().textContent).toBe(i18n.global.t('profile.save'));
  expect(topCancel().textContent).toBe(i18n.global.t('dialog.cancel'));
});
it('shares pending and blank-name disabled states across both save controls', async () => {
  await topActionsInView(false);
  await type(el.querySelector<HTMLInputElement>('input[autocomplete=nickname]')!, '');
  expect(buttons(i18n.global.t('profile.save'))).toHaveLength(2);
  expect(buttons(i18n.global.t('profile.save')).every((b) => b.disabled)).toBe(true);
  await type(el.querySelector<HTMLInputElement>('input[autocomplete=nickname]')!, 'Edited');
  fixture.save.mockImplementation(() => new Promise(() => {}));
  saveButton().click(); await settle();
  expect(buttons(i18n.global.t('community.saving'))).toHaveLength(2);
  expect(buttons(i18n.global.t('community.saving')).every((b) => b.disabled)).toBe(true);
  expect(buttons(i18n.global.t('dialog.cancel'))[0]!.disabled).toBe(true);
});
it('warns before closing a page with a changed cover, and stops warning after cancellation', async () => {
  el.querySelector<HTMLButtonElement>('[data-cover=sakura]')!.click(); await settle();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fixture.confirm.mockResolvedValue(true);
  topCancel().click(); await settle();
  const clean = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  expect(fixture.save).not.toHaveBeenCalled();
});

it('keeps edits through a same-page tab change, and asks before leaving the page', async () => {
  await type(el.querySelector<HTMLInputElement>('input[autocomplete=nickname]')!, 'Edited');
  await router.push('/me?tab=saved'); await settle();
  expect(fixture.confirm).not.toHaveBeenCalled();
  expect(router.currentRoute.value.query.tab).toBe('saved');
  expect(el.querySelector<HTMLInputElement>('input[autocomplete=nickname]')!.value).toBe('Edited');
  fixture.confirm.mockResolvedValue(false);
  await router.push('/elsewhere');
  expect(router.currentRoute.value.path).toBe('/me');
  expect(el.querySelector<HTMLInputElement>('input[autocomplete=nickname]')!.value).toBe('Edited');
  fixture.confirm.mockResolvedValue(true);
  await router.push('/elsewhere'); await settle();
  expect(router.currentRoute.value.path).toBe('/elsewhere');
});

it('saves all changes from the bottom save control too', async () => {
  fixture.save.mockResolvedValue(fixture.session.profile);
  await topActionsInView(false);
  await type(el.querySelector<HTMLInputElement>('input[autocomplete=nickname]')!, 'Edited');
  el.querySelector<HTMLButtonElement>('[data-cover=sakura]')!.click(); await settle();
  document.querySelector<HTMLButtonElement>('.savebar .btn--primary')!.click(); await settle();
  expect(fixture.save).toHaveBeenCalledTimes(1);
  expect(fixture.save.mock.calls[0][1]).toMatchObject({ displayName: 'Edited', cover: 'sakura' });
  expect(document.querySelector('.savebar')).toBeNull();
});
