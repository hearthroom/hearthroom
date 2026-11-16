import { hasPresetTag } from './tag-catalog';

export function hasPublicationOpening(input: { welcome?: unknown; alternates?: unknown; prologue?: unknown; openingPage?: unknown }): boolean {
  const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  const list = (value: unknown) => Array.isArray(value) && value.some(text);
  return text(input.welcome) || list(input.alternates) || list(input.prologue) || text(input.openingPage);
}

export function missingPublicationFields(settings: Record<string, unknown>): string[] {
  const document = (settings.document ?? {}) as Record<string, unknown>;
  const greetings = (settings.greetings ?? {}) as Record<string, unknown>;
  const asset = (settings.authorAsset ?? {}) as Record<string, unknown>;
  let tags: unknown = document.roleTag;
  if (typeof tags === 'string') {
    try { tags = JSON.parse(tags); } catch { tags = []; }
  }
  const missing: string[] = [];
  if (typeof document.roleName !== 'string' || !document.roleName.trim()) missing.push('roleName');
  const tagNames = Array.isArray(tags) ? tags.map(tag => {
    if (typeof tag === 'string') return tag;
    const entry = tag as {text?: unknown; tagName?: unknown} | null;
    const name = entry?.text || entry?.tagName;
    return typeof name === 'string' ? name : '';
  }) : [];
  if (!hasPresetTag(tagNames)) missing.push('presetTag');
  if (typeof document.roleDetailDesc !== 'string' || !document.roleDetailDesc.trim()) missing.push('roleDetailDesc');
  if (!hasPublicationOpening({ ...greetings, openingPage: asset.openingPage })) missing.push('opening');
  return missing;
}

export function isPublicationRefusal(code: unknown): boolean {
  return code === 'cover_required' || code === 'publication_fields_required';
}

const publicationFieldNames = new Set(['roleName','roleBackground','presetTag','roleDetailDesc','roleWelcome','prologue','opening']);

/** Error receipts retain only bounded field names from the publication contract. */
export function publicationRefusalDetail(value: unknown): Record<string,unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const detail = value as {missing?: unknown; field?: unknown};
  if (Array.isArray(detail.missing)) {
    const missing = detail.missing.filter((field): field is string => typeof field === 'string' && publicationFieldNames.has(field));
    return {missing: [...new Set(missing)]};
  }
  if (detail.field === 'roleBackground') return {field: 'roleBackground'};
  return undefined;
}
