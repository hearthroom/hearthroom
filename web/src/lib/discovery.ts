/** Repeated tag parameters preserve literal tags (including commas) and old single-tag links. */
export function selectedTags(value: string | null | (string | null)[] | undefined): string[] {
  return [...new Set((Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === "string" && !!v.trim()).map(v => v.trim()))];
}
export function toggleTag(tags: string[], tag: string): string[] {
  return tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
}
