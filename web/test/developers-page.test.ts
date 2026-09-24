import { createApp, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { describe, expect, it, vi } from 'vitest';
import en from '../src/locales/en.json';
import spec from '../../docs/community-openapi.json';
import integrationSpec from '../../docs/integration-openapi.json';
import sourceSpec from '../../docs/openapi.json';
import { groupByTag, type OpenApiDocument } from '../src/lib/openapi';
import DevelopersPage from '../src/pages/DevelopersPage.vue';

// The public page must describe the community's API, including the expandable reference.
describe('community developer documentation', () => {
  it('keeps every schema and collapsed description within the community contract', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths).every(path => path.startsWith('/v1/'))).toBe(true);
    expect(JSON.stringify(spec)).not.toMatch(/HarperHarbor|\bHarbor\b|LunaTalk|provider contract|item content|\/open\/v1/i);
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const value = node as Record<string, unknown>;
      if (typeof value.$ref === 'string') {
        expect(value.$ref).toMatch(/^#\/components\/schemas\//);
        expect(spec.components.schemas).toHaveProperty(value.$ref.split('/').at(-1)!);
      }
      Object.values(value).forEach(walk);
    };
    walk(spec);
  });
  it('retains the complete integration wire contract without vendor descriptions', () => {
    const protocol = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(protocol);
      if (!node || typeof node !== 'object') return node;
      return Object.fromEntries(Object.entries(node).filter(([key]) => !['description', 'summary', 'x-harperharbor'].includes(key)).map(([key, value]) => [key, protocol(value)]));
    };
    expect(protocol(integrationSpec.paths)).toEqual(protocol(sourceSpec.paths));
    expect(protocol(integrationSpec.components)).toEqual(protocol(sourceSpec.components));
    // operationId is a stable client identifier, not reader-facing prose.
    const publicText = JSON.stringify(integrationSpec, (key, value) => key === 'operationId' ? undefined : value);
    expect(publicText).not.toMatch(/HarperHarbor|\bHarbor\b|LunaTalk|Lunarhub|x-harperharbor|hh_live_/i);
  });
  it('renders both community and neutral integration contracts', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(DevelopersPage);
    app.use(createI18n({ legacy: false, locale: 'en', messages: { en } }));
    try {
      app.mount(el);
      await nextTick();
      await vi.waitFor(() => expect(el.querySelector('.doc-body')).not.toBeNull());
      const article = el.querySelector('.doc-body')!;
      expect(article.textContent).toContain('Hearthroom Community API');
      expect(article.textContent).toContain('Service integration API');
      expect(article.textContent).toContain('/open/v1/conversation/start');
      expect(article.textContent).toContain('/open/v1/conversation/ws-ticket');
      expect(article.textContent).not.toMatch(/HarperHarbor|\bHarbor\b|LunaTalk|item content/i);
      expect(el.querySelector('.toc__source')?.getAttribute('href')).toContain('/docs/community-openapi.json');
      const endpoint = el.querySelector('#community-get-v1-cards')?.closest('article');
      expect(endpoint).not.toBeNull();
      (endpoint!.querySelector('h3') as HTMLElement).click();
      await nextTick();
      expect(endpoint!.querySelector('.ep__body')?.textContent).toContain('hasNext');
      expect(endpoint!.querySelector('.ep__body')?.textContent).toContain('offset');
      const operations = [spec, integrationSpec].flatMap(doc => groupByTag(doc as unknown as OpenApiDocument).flatMap(group => group.endpoints));
      expect(el.querySelectorAll('h3.ep__head')).toHaveLength(operations.length);
      const ids = [...el.querySelectorAll('[id]')].map(e => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      const ticket = el.querySelector('#integration-post-conversation-ws-ticket')?.closest('article');
      (ticket!.querySelector('h3') as HTMLElement).click();
      await nextTick();
      expect(ticket!.textContent).toContain('clientChatFrame');
      expect(el.querySelector('a[href$="/docs/integration-openapi.json"]')).not.toBeNull();
      for (const a of el.querySelectorAll<HTMLAnchorElement>('.toc__link')) {
        expect(el.querySelector(a.getAttribute('href')!), a.textContent ?? '').not.toBeNull();
      }
    } finally { app.unmount(); el.remove(); }
  });
});
