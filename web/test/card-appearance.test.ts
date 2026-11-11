import { describe, expect, it } from 'vitest';
import { APPEARANCE_FIELDS, readAppearance, writeAppearance } from '../src/lib/card-appearance';
import { CARD_APPEARANCE_VARIABLES, splitCardAppearanceCss } from '../../stage/src/common/card-appearance';

describe('managed card appearance leaves author CSS intact', () => {
  it('round trips the eight visible settings and preserves custom source bytes', () => {
    const values = Object.fromEntries(APPEARANCE_FIELDS.map(f => [f.id, f.kind === 'font' ? 'system-ui, sans-serif' : '#123456']));
    const custom = '\n/* original */\n#ai-chat-input { color: red !important; }\n';
    const css = writeAppearance(values, custom);
    expect(css).toContain('/* lt-card-appearance:start */');
    expect(readAppearance(css)).toEqual({ values, customCss: custom });
  });
  it('does not interpret ordinary author variables as managed settings', () => {
    const css = '.canvas-root { --lt-canvas-bg: #000; }';
    expect(readAppearance(css)).toEqual({ values: {}, customCss: css });
  });
  it('preserves malformed managed-looking source and unknown declarations', () => {
    for (const css of ['/* lt-card-appearance:start */\n.canvas-root{--other: red;}\n/* lt-card-appearance:end */', '/* lt-card-appearance:start */\n.canvas-root{color:red}\n/* lt-card-appearance:end */']) {
      expect(readAppearance(css)).toEqual({ values: {}, customCss: css });
    }
  });
  it('clearing all settings removes only the generated block', () => {
    expect(writeAppearance({}, '.mes { color:red }')).toBe('.mes { color:red }');
    const parsed = readAppearance(writeAppearance({ aiBg: '#123456' }, '/* keep */'));
    expect(writeAppearance({}, parsed.customCss)).toBe('/* keep */');
  });
  it('uses the exact Stage variable contract and emits a block Stage recognizes under legacy hints', () => {
    expect(APPEARANCE_FIELDS.map(f => f.variable)).toEqual([...CARD_APPEARANCE_VARIABLES]);
    const css = writeAppearance({ aiBg: '#123456', font: 'system-ui, sans-serif' }, '#ai-send-button{color:red}');
    const split = splitCardAppearanceCss(css);
    expect(split.variables).toEqual(['--lt-canvas-bubble-ai-bg', '--lt-canvas-font']);
    expect(split.appearance).toContain('.canvas-root');
    expect(split.css).toContain('#ai-send-button{color:red}');
  });
});
