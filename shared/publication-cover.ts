/** Portrait slot only: landscape and link-preview images never replace it. */
export function hasPublicationCover(portrait: unknown): boolean {
  return typeof portrait === 'string' && portrait.trim().length > 0;
}
