/** 編輯器只管理明確標記的外觀區塊，其餘 CSS 保留作者原文。 */
export const CARD_CSS_MAX_BYTES = 512 * 1024;
export const APPEARANCE_FIELDS = [
  { id: 'aiBg', variable: '--lt-canvas-bubble-ai-bg', kind: 'color' },
  { id: 'userBg', variable: '--lt-canvas-bubble-user-bg', kind: 'color' },
  { id: 'bubbleText', variable: '--lt-canvas-bubble-fg', kind: 'color' },
  { id: 'inputBg', variable: '--lt-canvas-composer-field-bg', kind: 'color' },
  { id: 'sendBg', variable: '--lt-canvas-send-bg', kind: 'color' },
  { id: 'accent', variable: '--lt-canvas-accent', kind: 'color' },
  { id: 'font', variable: '--lt-canvas-font', kind: 'font' },
  { id: 'background', variable: '--lt-canvas-bg', kind: 'color' },
] as const;

const START = '/* lt-card-appearance:start */';
const END = '/* lt-card-appearance:end */';
const BLOCK = /^\/\* lt-card-appearance:start \*\/\r?\n\.canvas-root\s*\{([^{}]*)\}\r?\n\/\* lt-card-appearance:end \*\//gm;
const byVariable = new Map<string, string>(APPEARANCE_FIELDS.map(f => [f.variable, f.id]));

export function readAppearance(css: string): { values: Record<string, string>; customCss: string } {
  for (const match of css.matchAll(BLOCK)) {
    const values: Record<string, string> = {};
    let valid = true;
    for (const raw of match[1].split(';')) {
      if (!raw.trim()) continue;
      const at = raw.indexOf(':');
      const id = byVariable.get(raw.slice(0, at).trim());
      const value = raw.slice(at + 1).trim();
      if (at < 0 || !id || !value || /[{}]|\/\*/.test(value) || id in values) { valid = false; break; }
      values[id] = value;
    }
    if (!valid) continue;
    const before = css.slice(0, match.index);
    let after = css.slice((match.index ?? 0) + match[0].length);
    if (after.startsWith('\n\n')) after = after.slice(2);
    return { values, customCss: before + after };
  }
  return { values: {}, customCss: css };
}

export function writeAppearance(values: Record<string, string>, customCss: string): string {
  const declarations = APPEARANCE_FIELDS.flatMap(field => {
    const value = (values[field.id] ?? '').trim();
    return value && !/[;{}]|\/\*/.test(value) ? [`  ${field.variable}: ${value};`] : [];
  });
  if (!declarations.length) return customCss;
  const managed = `${START}\n.canvas-root {\n${declarations.join('\n')}\n}\n${END}`;
  return managed + (customCss ? '\n\n' + customCss : '');
}
