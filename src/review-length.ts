import MarkdownIt from 'markdown-it';
import { decodeHTML } from 'entities';
import { REVIEW_REQUIRED_CHARACTERS, type ReviewLength } from '../shared/review-length';

const markdown = new MarkdownIt({html: false, linkify: false});
const text = (v: unknown): string => typeof v === 'string' ? v : '';
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};

/** Strip markup before decoding so entity names and HTML attributes cannot inflate the count. */
export function effectiveCharacters(value: unknown): number {
  const plain = text(value)
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<\/?[a-z][a-z0-9:-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/gi, '')
    .replace(/\{\{[\s\S]*?\}\}|\$\{[^}]*\}/g, '');
  let count = 0;
  const countText = (s: string) => { for (const ch of s.normalize('NFC')) if (/[\p{L}\p{N}]/u.test(ch)) count++; };
  for (const token of markdown.parse(plain, {})) {
    if (token.type === 'inline') {
      for (const child of token.children ?? []) {
        if (child.type === 'text') countText(child.content);
        else if (child.type === 'code_inline') countText(decodeHTML(child.content));
        // image alt text, URLs, delimiter tokens and all markup are excluded.
      }
    } else if (token.type === 'code_block' || token.type === 'fence') countText(decodeHTML(token.content));
  }
  return count;
}

export function reviewLength(settings: Record<string, unknown>): ReviewLength {
  const persona = effectiveCharacters(record(settings.document).roleDetailDesc);
  const books = Array.isArray(settings.worldbooks) ? settings.worldbooks : settings.worldbook ? [settings.worldbook] : [];
  let constantWorldbook = 0;
  for (const book of books) {
    const entries = record(book).entries;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const e = record(entry);
      if (e.isEnabled !== false && e.isConstant === true) constantWorldbook += effectiveCharacters(e.content);
    }
  }
  const total = persona + constantWorldbook;
  return {persona, constantWorldbook, total, required: REVIEW_REQUIRED_CHARACTERS,
    remaining: Math.max(0, REVIEW_REQUIRED_CHARACTERS-total), eligible: total >= REVIEW_REQUIRED_CHARACTERS,
    welcome: effectiveCharacters(record(settings.greetings).welcome)};
}
