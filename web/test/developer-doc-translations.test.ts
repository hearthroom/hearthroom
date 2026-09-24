import { createApp, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';
import catalog from '../../docs/developers/catalog.json';
import englishOverview from '../../docs/developers.md?raw';
import community from '../../docs/community-openapi.json';
import integration from '../../docs/integration-openapi.json';
import { DEVELOPER_LOCALES, documentTranslator, loadDeveloperCopy, mapDocumentation, isDocumentationText } from '../src/lib/developer-docs';
import DevelopersPage from '../src/pages/DevelopersPage.vue';

const uiMessages = import.meta.glob('../src/locales/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, string>>;
const codeSpans = (text: string) => [...text.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`]+)`/g)].map(match => match[1]).sort();
const numbers = (text: string) => new Set(text.match(/\d+(?:\.\d+)*/g) ?? []);
const identifiers = (text: string) => text.match(/(?<![A-Za-z0-9_])[a-z]+(?:[A-Z][A-Za-z0-9]*)+\b|\b[a-z]+(?:_[a-z0-9]+)+\b/g) ?? [];
const codeBlocks = (text: string) => [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]);

// Classify against the canonical English source: translated CJK prose need not contain spaces.
function stripProse(node: unknown, source: unknown = node, path: string[] = []): unknown {
  if (typeof source === 'string' && isDocumentationText(path, source)) return '';
  if (Array.isArray(node)) return node.map((value, index) => stripProse(value, (source as unknown[])[index], [...path, String(index)]));
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, stripProse(value, (source as Record<string, unknown>)[key], [...path, key])]));
  return node;
}

describe.each(DEVELOPER_LOCALES)('%s developer documentation', locale => {
  it('ships a complete translation with unchanged code spans and numeric constraints', async () => {
    const copy = await loadDeveloperCopy(locale);
    expect(copy.locale).toBe(locale);
    expect(Object.keys(copy.dictionary).sort()).toEqual(Object.keys(catalog).sort());
    for (const [id, source] of Object.entries(catalog)) {
      const translated = copy.dictionary[id]!;
      expect(translated.trim(), id).not.toBe('');
      expect(codeSpans(translated), id).toEqual(codeSpans(source));
      for (const number of numbers(source)) expect(numbers(translated).has(number), `${id}: ${number}`).toBe(true);
      for (const identifier of identifiers(source)) expect(translated, id).toContain(identifier);
      expect(translated, id).not.toMatch(/HarperHarbor|\bHarbor\b|LunaTalk|Lunarhub/i);
    }
    expect(codeBlocks(copy.overview)).toEqual(codeBlocks(englishOverview));
    expect(codeSpans(copy.overview)).toEqual(codeSpans(englishOverview));
    expect(copy.overview).not.toMatch(/HarperHarbor|\bHarbor\b|LunaTalk|Lunarhub/i);
    for (const source of [community, integration]) {
      const localized = mapDocumentation(source, documentTranslator(copy.dictionary));
      // Erasing prose from both leaves identical paths, schema constraints, scopes,
      // examples, protocol extension fields, identifiers and stable tag anchors.
      expect(stripProse(localized, source)).toEqual(stripProse(source));
    }
  });
  it('renders both references, localized controls and all endpoint/contents links', async () => {
    const copy = await loadDeveloperCopy(locale), t = documentTranslator(copy.dictionary);
    const ui = uiMessages[`../src/locales/${locale}.json`]!;
    const el = document.createElement('div'); document.body.appendChild(el);
    const app = createApp(DevelopersPage);
    app.use(createI18n({ legacy: false, locale, messages: { [locale]: ui } }));
    try {
      app.mount(el); await nextTick();
      await vi.waitFor(() => expect(el.querySelector('.doc-body')).not.toBeNull());
      expect(el.querySelector('#community-api')?.textContent).toBe(t(community.info.title));
      expect(el.querySelector('#integration-api')?.textContent).toBe(t(integration.info.title));
      expect(el.querySelectorAll('h3.ep__head')).toHaveLength(136);
      const heading = el.querySelector<HTMLElement>('#community-get-v1-cards')!;
      expect(heading.textContent).toContain(t(community.paths['/v1/cards'].get.summary));
      heading.click(); await nextTick();
      const body = heading.closest('article')!.querySelector('.ep__body')!;
      expect(body.textContent).toContain(ui['developers.api.parameters']);
      expect(body.textContent).toContain('hasNext');
      expect(body.textContent).toContain(t(community.paths['/v1/cards'].get.description));
      const ticket = el.querySelector<HTMLElement>('#integration-post-conversation-ws-ticket')!;
      ticket.click(); await nextTick();
      expect(ticket.closest('article')?.textContent).toContain(ui['developers.api.websocket']);
      expect(ticket.closest('article')?.textContent).toContain('clientChatFrame');
      const ids = [...el.querySelectorAll('[id]')].map(node => node.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const link of el.querySelectorAll<HTMLAnchorElement>('.toc__link')) {
        expect(document.getElementById(link.getAttribute('href')!.slice(1)), link.textContent ?? '').not.toBeNull();
      }
    } finally { app.unmount(); el.remove(); }
  });
});
