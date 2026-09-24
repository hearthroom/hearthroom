import { describe, expect, it } from 'vitest';
import catalog from '../../docs/developers/catalog.json';
import community from '../../docs/community-openapi.json';
import integration from '../../docs/integration-openapi.json';
import { documentationStrings, documentTranslator, mapDocumentation, developerLocale } from '../src/lib/developer-docs';
import type { OpenApiDocument } from '../src/lib/openapi';

const specs = [community, integration] as unknown as OpenApiDocument[];
describe('developer documentation localization boundaries', () => {
  it('keeps the English catalog synchronized with every displayed reference string', () => {
    const actual = new Set(specs.flatMap(documentationStrings));
    expect([...new Set(Object.values(catalog))].sort()).toEqual([...actual].sort());
    expect(Object.keys(catalog).length).toBe(actual.size);
  });
  it('translates prose, extension notes and labels without translating wire data or examples', () => {
    const fixture = {
      info: { title: 'API' }, tags: [{ name: 'Cards', description: 'Browse' }],
      paths: { '/open/v1/role': { get: { operationId: 'readCard', tags: ['Cards'], summary: 'Read', security: [{ userToken: ['role.read'] }],
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Card' }, example: { description: 'Read', name: 'Cards' } } } } },
      } } },
      components: { schemas: { Card: { type: 'object', properties: { description: { type: 'string', description: 'Text', enum: ['Read'], default: 'Read', example: 'Read' } } } } },
      'x-auth-notes': { bearerResolution: ['Validate'], guestReadableRoutes: ['GET /open/v1/role'] },
      'x-websocket': { description: 'Stream', url: 'GET /open/v1/conversation/ws', serverFrames: { framing: 'Frame', events: { done: { data: '[DONE]', description: 'Finished' } } } },
    };
    const result = mapDocumentation(fixture, text => `譯：${text}`);
    expect(result.info.title).toBe('譯：API');
    expect(result.tags[0].name).toBe('Cards');
    expect(result.paths['/open/v1/role'].get.operationId).toBe('readCard');
    expect(result.paths['/open/v1/role'].get.security).toEqual(fixture.paths['/open/v1/role'].get.security);
    expect(result.paths['/open/v1/role'].get.responses['200'].content['application/json'].example).toEqual({ description: 'Read', name: 'Cards' });
    expect(result.components.schemas.Card.properties.description).toEqual({ type: 'string', description: '譯：Text', enum: ['Read'], default: 'Read', example: 'Read' });
    expect(result['x-auth-notes'].bearerResolution).toEqual(['譯：Validate']);
    expect(result['x-auth-notes'].guestReadableRoutes).toEqual(['GET /open/v1/role']);
    expect(result['x-websocket'].serverFrames.events.done.data).toBe('[DONE]');
    expect(result['x-websocket'].serverFrames.events.done.description).toBe('譯：Finished');
    expect(fixture.info.title).toBe('API');
  });
  it('maps requested regional languages without changing existing site URL locale codes', () => {
    expect(['zh-CN','zh-TW','en-US','ja-JP','ko-KR'].map(developerLocale)).toEqual(['zh-Hans','zh-Hant','en','ja','ko']);
  });
  it('looks up stable translation IDs and has an honest English fallback for unknown future prose', () => {
    const [id, text] = Object.entries(catalog)[0]!;
    const translate = documentTranslator({ [id]: '譯文' });
    expect(translate(text)).toBe('譯文');
    expect(translate('A future field')).toBe('A future field');
  });
});
