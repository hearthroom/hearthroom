import catalog from '../../../docs/developers/catalog.json';
import englishOverview from '../../../docs/developers.md?raw';
import type { OpenApiDocument } from './openapi';

export const DEVELOPER_LOCALES = ['zh-Hans', 'zh-Hant', 'en', 'ja', 'ko'] as const;
export type DeveloperLocale = typeof DEVELOPER_LOCALES[number];
export type DocumentationDictionary = Record<string, string>;
const ids = new Map(Object.entries(catalog).map(([id, text]) => [text, id]));

/** Only prose is translated. Examples, enums, defaults, identifiers and JSON keys stay intact. */
export function isDocumentationText(path: string[], value: string): boolean {
  if (path.some(part => ['example', 'examples', 'enum', 'default'].includes(part))) return false;
  if (['description', 'summary', 'title'].includes(path.at(-1) ?? '')) return true;
  if (path[0] === 'x-auth-notes') return !path.includes('guestReadableRoutes');
  if (path[0] === 'x-error-envelope') return path.includes('codes') || path.at(-1) === 'emittedBy';
  if (path[0] === 'x-scrub') return !path.includes('removedKeys');
  if (path.includes('x-websocket')) return path.includes('newStreamFlow') || path.at(-1) === 'framing'
    || (path.includes('serverFrames') && path.includes('data') && value.includes(' '));
  return false;
}

export function mapDocumentation<T>(source: T, translate: (text: string) => string, path: string[] = []): T {
  if (typeof source === 'string') return (isDocumentationText(path, source) ? translate(source) : source) as T;
  if (Array.isArray(source)) return source.map((value, index) => mapDocumentation(value, translate, [...path, String(index)])) as T;
  if (source && typeof source === 'object') return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, mapDocumentation(value, translate, [...path, key])])) as T;
  return source;
}

export function documentationStrings(doc: OpenApiDocument): string[] {
  const strings = new Set<string>();
  mapDocumentation(doc, text => { if (text.trim()) strings.add(text); return text; });
  for (const tag of doc.tags ?? []) strings.add(tag.name);
  for (const item of Object.values(doc.paths)) for (const op of Object.values(item)) for (const tag of op.tags ?? []) strings.add(tag);
  strings.add('Other');
  return [...strings];
}

export function documentTranslator(dictionary: DocumentationDictionary): (text: string) => string {
  return text => dictionary[ids.get(text) ?? ''] ?? text;
}

export interface DeveloperCopy { locale: DeveloperLocale; dictionary: DocumentationDictionary; overview: string }
export const ENGLISH_DEVELOPER_COPY: DeveloperCopy = { locale: 'en', dictionary: catalog, overview: englishOverview };
const dictionaries = import.meta.glob('../../../docs/developers/locales/*.json', { import: 'default' });
const overviews = import.meta.glob('../../../docs/developers/{zh-Hans,zh-Hant,ja,ko}.md', { query: '?raw', import: 'default' });
const cached = new Map<DeveloperLocale, DeveloperCopy>([['en', ENGLISH_DEVELOPER_COPY]]);
export function developerLocale(code: string): DeveloperLocale {
  if (DEVELOPER_LOCALES.includes(code as DeveloperLocale)) return code as DeveloperLocale;
  if (/^zh-(TW|HK|Hant)/i.test(code)) return 'zh-Hant';
  if (/^zh/i.test(code)) return 'zh-Hans';
  if (/^ja/i.test(code)) return 'ja';
  if (/^ko/i.test(code)) return 'ko';
  return 'en';
}
export async function loadDeveloperCopy(code: string): Promise<DeveloperCopy> {
  const locale = developerLocale(code), hit = cached.get(locale);
  if (hit) return hit;
  const [dictionary, overview] = await Promise.all([
    dictionaries[`../../../docs/developers/locales/${locale}.json`]?.(),
    overviews[`../../../docs/developers/${locale}.md`]?.(),
  ]);
  if (!dictionary || typeof overview !== 'string') throw new Error('Developer documentation locale unavailable');
  const copy = { locale, dictionary: dictionary as DocumentationDictionary, overview };
  cached.set(locale, copy);
  return copy;
}

/** UI copy is passed down so standalone reference/schema consumers also have a usable English default. */
export const ENGLISH_API_COPY = {
  noAuth: 'no auth', link: 'Link to this endpoint', deprecated: 'Deprecated.', parameters: 'Parameters',
  name: 'Name', location: 'In', type: 'Type', constraints: 'Constraints', description: 'Description',
  field: 'Field', required: 'required', requestBody: 'Request body', responses: 'Responses', notes: 'Notes',
  security: 'Security schemes', unverified: 'unverified', arrayOf: 'array of', oneOf: 'one of', anyOf: 'any of',
  length: 'len', defaultValue: 'default', nullable: 'nullable', websocket: 'WebSocket protocol',
  authNotes: 'Authentication notes', errorEnvelope: 'Error responses', scrub: 'Response field filtering',
};
export type ApiDocCopy = typeof ENGLISH_API_COPY;
export function apiDocCopy(t: (key: string) => string): ApiDocCopy {
  return Object.fromEntries(Object.keys(ENGLISH_API_COPY).map(key => [key, t(`developers.api.${key}`)])) as ApiDocCopy;
}
export function extensionTitle(key: string, copy: ApiDocCopy): string {
  const known: Record<string, string> = { 'x-websocket': copy.websocket, 'x-auth-notes': copy.authNotes, 'x-error-envelope': copy.errorEnvelope, 'x-scrub': copy.scrub, 'x-unverified': copy.unverified };
  return known[key] ?? key;
}
