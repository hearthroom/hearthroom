import { describe, expect, it } from 'vitest';
import { canonicalAsset, hasAsset } from '../src/card-transfer-resources';
import api from '../docs/integration-openapi.json';

describe('card CSS review snapshot', () => {
  it('publishes the card-only version on every author-asset schema without widening rule dialects', () => {
    let fields = 0;
    for (const schema of Object.values(api.components.schemas)) {
      for (const [name, field] of Object.entries((schema as any).properties ?? {})) {
        if (name === 'cardCssDialect') { expect((field as any).enum).toContain('fengyue-v2'); fields++; }
        if (name === 'cssDialect') expect((field as any).enum).not.toContain('fengyue-v2');
      }
    }
    expect(fields).toBe(4);
  });
  it.each(['fengyue', 'fengyue-v2'])('retains card CSS and hidden %s hint even without display rules', (dialect) => {
    const asset = canonicalAsset({ cardCss: '.canvas-root { color:red }', cardCssDialect: dialect });
    expect(asset).toMatchObject({ cardCss: '.canvas-root { color:red }', cardCssDialect: dialect });
    expect(hasAsset(asset)).toBe(true);
  });
  it('does not change legacy asset hashes for absent or empty CSS', () => {
    expect(canonicalAsset({ rules: [] })).toEqual(canonicalAsset({ rules: [], cardCss: '', cardCssDialect: '' }));
  });
  it('retains an explicit clear when a legacy carrier is present so review cannot revive it', () => {
    const asset = canonicalAsset({ rules: [{ id: 'hearthroom-fengyue-inner-css', find: '/([\\s\\S])$/', replace: '$1<style>.x{color:red}</style>', enabled: true }], cardCss: '' });
    expect(asset).toHaveProperty('cardCss', '');
  });
});
