import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createI18n } from 'vue-i18n';
import zhHant from '../src/locales/zh-Hant.json';
import zhHans from '../src/locales/zh-Hans.json';
import en from '../src/locales/en.json';
import ja from '../src/locales/ja.json';
import ko from '../src/locales/ko.json';
import { agentSetupUrl, cliSiteUrl } from '../src/lib/agent-setup';
import AgentOnboard from '../src/components/AgentOnboard.vue';
import GuidePage from '../src/pages/GuidePage.vue';

const tracked = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/track', () => ({ track: tracked, setSurface: () => {}, currentSurface: () => 'direct' }));

/**
 * 寫卡的兩條路：交給 AI Agent（一顆按鈕複製設定指令，指令叫 Agent 去讀 /agent-setup.md，
 * Agent 再裝 Hearthroom CLI 與寫卡技能自己操作），或在網頁編輯器自己手寫。
 * CLI 是給 Agent 用的介面，不另外當一條路。/guide 開頭讓人挑一種照著做，「我的卡片」放同一顆按鈕。
 */
const LOCALES = { 'zh-Hant': zhHant, 'zh-Hans': zhHans, en, ja, ko } as Record<string, Record<string, string>>;

let app: App | undefined;
let root: HTMLElement;
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await nextTick(); };

async function mount(component: object, locale = 'en', props: Record<string, unknown> = {}, search = '') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:locale(zh-Hans|en|ja|ko)/:pathMatch(.*)*', component: { template: '<div />' } }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }] });
  await router.push((locale === 'zh-Hant' ? '/guide' : `/${locale}/guide`) + search);
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(component, props).use(router).use(createI18n({ legacy: false, locale, fallbackLocale: 'en', messages: LOCALES }));
  app.mount(root);
  await settle();
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(writeText) }, configurable: true });
  return navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
}

afterEach(() => { app?.unmount(); app = undefined; root?.remove(); });

describe('where the setup prompt and the tools live', () => {
  it('points the agent at /agent-setup.md on the domain the reader is on', () => {
    expect(agentSetupUrl('https://sukisuki.chat')).toBe('https://sukisuki.chat/agent-setup.md');
    expect(agentSetupUrl()).toBe(`${location.origin}/agent-setup.md`);
  });

  it('links the CLI site of the same domain family, falling back to the primary one', () => {
    expect(cliSiteUrl('www.hearthroom.club')).toBe('https://cli.hearthroom.club/');
    expect(cliSiteUrl('sukisuki.chat')).toBe('https://cli.sukisuki.chat/');
    expect(cliSiteUrl('localhost')).toBe('https://cli.sukisuki.ai/');
  });
});

describe('the agent button', () => {
  it('copies a prompt in the reader’s language that sends the agent to the setup file', async () => {
    const write = stubClipboard(async () => {});
    await mount(AgentOnboard, 'zh-Hant', { from: 'mine' });
    root.querySelector<HTMLButtonElement>('.onboard__pill')!.click();
    await settle();
    const copied = write.mock.calls[0]![0] as string;
    expect(copied).toContain(`${location.origin}/agent-setup.md`);
    expect(copied).toContain('酒館角色卡');
    const pop = document.querySelector('.onboard__pop')!;
    expect(pop.textContent).toContain(zhHant['onboard.copied']);
    expect(pop.textContent).toContain(copied);
    expect(tracked).toHaveBeenLastCalledWith('agent_onboard', expect.objectContaining({ detail: 'onboard_copied', subject: 'mine', ok: true }));
  });

  it('shows the prompt to copy by hand when the clipboard is unavailable', async () => {
    stubClipboard(async () => { throw new Error('denied'); });
    await mount(AgentOnboard, 'en', { from: 'guide' });
    root.querySelector<HTMLButtonElement>('.onboard__pill')!.click();
    await settle();
    const pop = document.querySelector('.onboard__pop')!;
    expect(pop.textContent).toContain(en['onboard.copyFailed']);
    expect(tracked).toHaveBeenLastCalledWith('agent_onboard', expect.objectContaining({ detail: 'onboard_manual', subject: 'guide', ok: false }));
    expect(pop.textContent).toContain(`${location.origin}/agent-setup.md`);
  });

  it('closes with Escape and links to the full steps unless it sits inside them', async () => {
    stubClipboard(async () => {});
    await mount(AgentOnboard, 'en', { from: 'mine' });
    root.querySelector<HTMLButtonElement>('.onboard__pill')!.click();
    await settle();
    expect(document.querySelector('.onboard__pop a')?.getAttribute('href')).toBe('/en/guide#start');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(document.querySelector('.onboard__pop')).toBeNull();
    app!.unmount(); root.remove();
    await mount(AgentOnboard, 'en', { from: 'guide', stepsLink: false });
    root.querySelector<HTMLButtonElement>('.onboard__pill')!.click();
    await settle();
    expect(document.querySelector('.onboard__pop a')).toBeNull();
  });
});

describe('the guide page', () => {
  beforeEach(() => { stubClipboard(async () => {}); });

  it('opens with one title and the two ways to start, the agent first and selected', async () => {
    await mount(GuidePage, 'en');
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('h1')!.textContent).toBe(en['guide.title']);
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.textContent).toContain(en['guide.start.agent.tab']);
    const agent = root.querySelector('[role="tabpanel"]')!;
    expect(agent.querySelector('.onboard__pill')).not.toBeNull();
    // Agent 用的是 CLI 與寫卡技能：兩個都連得到
    expect(agent.querySelector('a[href^="https://cli."]')).not.toBeNull();
    expect(agent.querySelector('a[href="https://github.com/hearthroom/skills"]')).not.toBeNull();
  });

  // 兩種寫法下面接的內容不同：交給 AI Agent 的人要知道怎麼指揮它，參考細節 Agent 自己會讀
  // （/guide.md、llms.txt、寫卡技能）；自己手寫的人才需要逐欄的參考。
  it('shows how to direct the agent under the agent path, not the field reference', async () => {
    await mount(GuidePage, 'en');
    const headings = [...root.querySelectorAll('h2')].map(h => h.textContent);
    expect(headings).toContain('What your agent can do');
    expect(headings).toContain('Credits and boundaries');
    expect(headings).not.toContain('Card fields');
  });

  it('switches to the web editor with its own next steps and the field reference', async () => {
    await mount(GuidePage, 'en');
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[1]!.click();
    await settle();
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    const web = root.querySelector('[role="tabpanel"]')!;
    expect(web.querySelector('a[href="/en/create"]')).not.toBeNull();
    const headings = [...root.querySelectorAll('h2')].map(h => h.textContent);
    expect(headings).toContain('Card fields');
    expect(headings).not.toContain('What your agent can do');
    // 「各欄位怎麼寫」指向參考的第一節，不論語言都要找得到
    const field = web.querySelector<HTMLAnchorElement>('a[href^="#"]')!;
    expect(root.querySelector(field.getAttribute('href')!)).not.toBeNull();
    // 選了哪一種寫在網址上，連結分享出去看到的是同一種
    expect(new URLSearchParams(location.search).get('way')).toBe('web');
  });

  it('opens on the web editor when the link asks for it', async () => {
    await mount(GuidePage, 'en', {}, '?way=web');
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect([...root.querySelectorAll('h2')].map(h => h.textContent)).toContain('Card fields');
  });

  it('lists the start section first in the contents, and every entry resolves, on both paths', async () => {
    for (const locale of Object.keys(LOCALES)) {
      for (const search of ['', '?way=web']) {
        await mount(GuidePage, locale, {}, search);
        const links = [...root.querySelectorAll<HTMLAnchorElement>('.toc__link')];
        expect(links[0]!.getAttribute('href'), locale).toBe('#start');
        expect(links.length, `${locale}${search}`).toBeGreaterThan(3);
        for (const a of links) expect(root.querySelector(a.getAttribute('href')!), `${locale}${search} ${a.textContent}`).not.toBeNull();
        app!.unmount(); root.remove(); app = undefined;
      }
    }
  });
});

describe('copy for the new entry points', () => {
  it('exists in all five languages', () => {
    const keys = Object.keys(en).filter(k => k.startsWith('onboard.') || k.startsWith('guide.start.') || ['guide.lead', 'mine.empty.title', 'mine.empty.body'].includes(k));
    expect(keys.length).toBeGreaterThan(20);
    for (const [locale, messages] of Object.entries(LOCALES)) for (const k of keys) expect(messages[k], `${locale} ${k}`).toBeTruthy();
  });

  it('says character card the way each language says it, and keeps the URL placeholder', () => {
    expect(zhHant['onboard.prompt']).toContain('酒館角色卡');
    expect(zhHans['onboard.prompt']).toContain('酒馆角色卡');
    for (const messages of Object.values(LOCALES)) expect(messages['onboard.prompt']).toContain('{url}');
  });
});
