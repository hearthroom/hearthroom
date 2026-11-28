import { parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { RE2JS } from "re2js";

export interface OpeningRule {
  name?: unknown;
  find?: unknown;
  replace?: unknown;
  enabled?: unknown;
  promptOnly?: unknown;
  targets?: unknown;
  trimStrings?: unknown;
}

export const MAX_OPENING_MARKUP = 262_144;
const MAX_MARKUP = MAX_OPENING_MARKUP;
const MAX_GREETING = 32_768;
const MAX_RULES = 20;
const MAX_PATTERN = 512;
const MAX_MATCHES = 512;
const MAX_EXCERPT = 3_000;
const SLASH_FORM = /^\/([\s\S]+)\/([a-zA-Z]*)$/;
const BLOCK = /^(address|article|aside|blockquote|button|dd|div|dl|dt|fieldset|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|section|table|tr|ul)$/;
const CONTROL = /^(a|button|input|select|textarea|summary)$/;
const HIDDEN = /^(head|noscript|script|style|template)$/;

type Node = DefaultTreeAdapterTypes.ChildNode;

const PREVIEW_TAG = /^(a|article|aside|b|blockquote|br|button|caption|code|dd|details|div|dl|dt|em|fieldset|figure|figcaption|footer|h[1-6]|header|hr|i|img|input|label|legend|li|main|nav|ol|option|p|pre|section|select|small|span|strong|style|summary|table|tbody|td|textarea|th|thead|tr|u|ul)$/;
const PREVIEW_ATTR = /^(alt|aria-label|checked|class|colspan|disabled|height|hidden|id|open|placeholder|role|rowspan|selected|style|title|type|value|width|data-[\w-]+)$/;

/** The reviewer takes a static, offline screenshot. Preserve presentation while removing active HTML. */
export function openingPreviewDocument(markup: string) {
  const fragment = parseFragment(markup.slice(0, MAX_MARKUP));
  const parents: (DefaultTreeAdapterTypes.DocumentFragment | DefaultTreeAdapterTypes.Element)[] = [fragment];
  while (parents.length) {
    const parent = parents.pop()!;
    parent.childNodes = parent.childNodes.filter((node) => {
      if ("value" in node) return true;
      if (!("tagName" in node) || node.namespaceURI !== "http://www.w3.org/1999/xhtml" || !PREVIEW_TAG.test(node.tagName)) return false;
      node.attrs = node.attrs.filter(({ name, value }) => PREVIEW_ATTR.test(name)
        || (node.tagName === "img" && name === "src" && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(value)));
      parents.push(node);
      return true;
    });
  }
  const policy = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:12px;background:#fff;color:#161616;font:16px system-ui;white-space:pre-line;overflow-wrap:anywhere}img{max-width:100%}</style>${serialize(fragment)}`;
}

function openingObservations(visible: string) {
  let visibleCharacters = 0;
  for (const character of visible) if (!/\s/u.test(character)) visibleCharacters++;
  const tail = visible.slice(-160).split("\n").pop() ?? "";
  return {
    visibleCharacters,
    startsWithFragmentPunctuation: /^[,，、;；:：。.!！?？]/u.test(visible),
    endsWithAssistantQuestionPattern: /^(?:請問)?(?:你)?(?:要不要|想不想|需要(?:我)?|想要我|希望我|要我)(?:幫你|為你)?(?:續寫|繼續|接著寫|調整|修改|改寫|補充).*[？?]$/u.test(tail)
      || /^(?:would you like|do you want|shall i|should i) (?:me to )?(?:continue|revise|rewrite|expand)\b.*\?$/i.test(tail),
  };
}

export function openingMarkup(html: string, budget = MAX_EXCERPT) {
  const capped = html.slice(0, MAX_MARKUP);
  const structure = { headings: 0, controls: 0, sections: 0, media: 0, characterIntro: false, statusPanel: false };
  let dynamic = false;
  const pieces: string[] = [];
  const stack: (Node | string)[] = parseFragment(capped).childNodes.reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node === "string") { pieces.push(node); continue; }
    if ("value" in node) { pieces.push(node.value); continue; }
    if (!("tagName" in node)) continue;
    const { attrs, tagName } = node;
    if (tagName === "script" || attrs.some(({ name }) => name.startsWith("on"))) dynamic = true;
    if (HIDDEN.test(tagName) || attrs.some(({ name, value }) =>
      name === "hidden" || (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(value)))) continue;
    const attr = (key: string) => attrs.find(({ name }) => name === key)?.value ?? "";
    if (/^h[1-6]$/.test(tagName)) structure.headings++;
    if (CONTROL.test(tagName) || /^(button|tab|link)$/.test(attr("role"))) structure.controls++;
    if (/^(article|aside|main|section)$/.test(tagName)) structure.sections++;
    if (/^(audio|canvas|iframe|img|svg|video)$/.test(tagName)) structure.media++;
    if (/^(canvas|iframe)$/.test(tagName)) dynamic = true;
    const label = [attr("id"), attr("class"), attr("aria-label"), attr("data-section")].join(" ");
    structure.characterIntro ||= /character[-_ ]?(intro|bio|profile)|角色介紹|角色介绍/i.test(label);
    structure.statusPanel ||= /status[-_ ]?(bar|panel|board)|狀態欄|状态栏/i.test(label);
    const block = BLOCK.test(tagName);
    if (block || tagName === "br") pieces.push("\n");
    if (tagName === "img" && attr("alt")) pieces.push(attr("alt"));
    if (block) stack.push("\n");
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]);
  }
  const full = pieces.join("").replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  structure.characterIntro ||= /角色介紹|角色介绍|人物介紹|人物介绍|character (intro|bio|profile)/i.test(full);
  structure.statusPanel ||= /狀態欄|状态栏|狀態面板|状态面板|status (bar|panel)/i.test(full);
  const inputClipped = capped.length !== html.length;
  const clipped = full.length > budget || inputClipped;
  return { text: full.slice(0, budget) + (full.length > budget ? "…[截斷]" : ""), chars: full.length, structure, dynamic, clipped, inputClipped, observations: openingObservations(full) };
}

export function openingRules(rules: OpeningRule[], budget = MAX_EXCERPT, preview = false) {
  const applicable = rules.filter((r) => r.enabled !== false && r.promptOnly !== true
    && (!Array.isArray(r.targets) || r.targets.includes("ai")) && typeof r.find === "string" && r.find.trim());
  const compiled: { regex: RE2JS; replace: string; sticky: boolean; trims: string[] }[] = [];
  for (const rule of applicable.slice(0, MAX_RULES)) {
    const find = String(rule.find).trim().replace(/^`|`$/g, "");
    const replace = typeof rule.replace === "string" ? rule.replace : "";
    if (!find || find.length > MAX_PATTERN || replace.length > MAX_MARKUP) continue;
    const slash = SLASH_FORM.exec(find);
    const flags = slash?.[2] ?? "";
    const source = slash ? slash[1].replaceAll("[^]", "[\\s\\S]") : RE2JS.quote(find);
    try {
      const regex = RE2JS.compile(source, (flags.includes("i") ? RE2JS.CASE_INSENSITIVE : 0)
        | (flags.includes("m") ? RE2JS.MULTILINE : 0) | (flags.includes("s") ? RE2JS.DOTALL : 0));
      if (slash && regex.test("")) continue;
      compiled.push({ regex, replace, sticky: flags.includes("y"), trims: Array.isArray(rule.trimStrings)
        ? rule.trimStrings.filter((s): s is string => typeof s === "string" && !!s).slice(0, 20) : [] });
    } catch { /* Unsupported patterns leave the evidence partial. */ }
  }
  const skipped = applicable.length - compiled.length;
  // The play surface may match locale-specific Han variants.
  const localeSensitive = applicable.some((rule) => /\p{Script=Han}/u.test(String(rule.find)));
  return (input: string, names: { char: string; user: string }) => {
    let current = input.slice(0, MAX_GREETING);
    let incomplete = current.length !== input.length || skipped > 0 || localeSensitive;
    let hits = 0;
    for (const { regex, replace, sticky, trims } of compiled) {
      const matcher = regex.matcher(current);
      const parts: string[] = [];
      let end = 0, count = 0, length = 0;
      while (matcher.find()) {
        const start = matcher.start();
        if (sticky && start !== end) break;
        if (++count > MAX_MATCHES) { incomplete = true; break; }
        const capture = (key: string | number) => {
          if (typeof key === "number" ? key > regex.groupCount() : !Object.hasOwn(regex.namedGroups(), key)) return undefined;
          let value = matcher.group(key) ?? "";
          for (const trim of trims) value = value.split(trim).join("");
          return value;
        };
        const expanded = replace.replace(/\$([1-9]\d?|<[^>]+>)/g, (token, group: string) => {
          if (group.startsWith("<")) return capture(group.slice(1, -1)) ?? token;
          return capture(Number(group)) ?? (group.length === 2 && Number(group[0]) <= regex.groupCount()
            ? capture(Number(group[0])) + group[1] : token);
        });
        length += start - end + expanded.length;
        const nextEnd = matcher.end();
        if (length + current.length - nextEnd > MAX_MARKUP) { incomplete = true; break; }
        parts.push(current.slice(end, start), expanded);
        end = nextEnd;
      }
      if (!count || count > MAX_MATCHES || length + current.length - end > MAX_MARKUP) continue;
      if (/\{\{random:{1,2}/i.test(replace)) incomplete = true;
      hits += count;
      current = parts.join("") + current.slice(end);
    }
    current = current.replace(/\{\{\s*(char|user)\s*\}\}/gi, (token, key: string) => names[key.toLowerCase() as keyof typeof names] || token);
    const view = openingMarkup(current, budget);
    return { ...view, hits, skipped, coverage: incomplete || view.clipped || view.dynamic ? "partial" as const : "complete" as const,
      previewHtml: preview ? openingPreviewDocument(current) : undefined };
  };
}
