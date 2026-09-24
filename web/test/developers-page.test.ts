import { createApp, nextTick } from 'vue';
import { createI18n } from 'vue-i18n';
import { describe, expect, it } from 'vitest';
import spec from '../../docs/community-openapi.json';
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
  it('renders community routes and schemas without service integration material', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(DevelopersPage);
    app.use(createI18n({ legacy: false, locale: 'en', messages: { en: {
      'developers.title': 'Developer docs', 'developers.toc': 'On this page',
      'developers.source': 'View OpenAPI on GitHub',
    } } }));
    try {
      app.mount(el);
      await nextTick();
      const article = el.querySelector('.doc-body')!;
      expect(article.textContent).toContain('Hearthroom Community API');
      expect(article.textContent).not.toMatch(/HarperHarbor|\bHarbor\b|LunaTalk|provider contract|item content|\/open\/v1/i);
      expect(el.querySelector('.toc__source')?.getAttribute('href')).toContain('/docs/community-openapi.json');
      const endpoint = el.querySelector('#get-v1-cards')?.closest('article');
      expect(endpoint).not.toBeNull();
      (endpoint!.querySelector('h3') as HTMLElement).click();
      await nextTick();
      expect(endpoint!.querySelector('.ep__body')?.textContent).toContain('hasNext');
      expect(endpoint!.querySelector('.ep__body')?.textContent).toContain('offset');
      for (const a of el.querySelectorAll<HTMLAnchorElement>('.toc__link')) {
        expect(el.querySelector(a.getAttribute('href')!), a.textContent ?? '').not.toBeNull();
      }
    } finally { app.unmount(); el.remove(); }
  });
});
