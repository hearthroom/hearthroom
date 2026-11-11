import { describe, expect, it } from 'vitest';
import { canonicalAsset, hasAsset } from '../src/card-transfer-resources';

describe('card CSS review snapshot', () => {
  it('retains card CSS and its hidden hint even without display rules', () => {
    const asset = canonicalAsset({ cardCss: '.canvas-root { color:red }', cardCssDialect: 'fengyue' });
    expect(asset).toMatchObject({ cardCss: '.canvas-root { color:red }', cardCssDialect: 'fengyue' });
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
