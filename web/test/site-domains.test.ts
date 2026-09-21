import cors from '../../deploy/harperharbor-assets-cors.json';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { isPlayHost, playAppUrl } from '../src/lib/site';
import wrangler from '../../wrangler.toml?raw';
import deployWorkflow from '../../.github/workflows/deploy.yml?raw';
afterEach(() => vi.unstubAllGlobals());
describe('official domain families', () => {
  for (const root of ['hearthroom.club', 'sukisuki.ai', 'sukisuki.chat']) {
    it(`keeps card apps on ${root} and deploys the matching routes`, () => {
      vi.stubGlobal('location', { hostname: root, origin: `https://${root}` });
      expect(playAppUrl('card-1', 'en')).toBe(`https://play.${root}/card-1/?lang=en`);
      expect(isPlayHost(`play.${root}`)).toBe(true);
      expect(isPlayHost(`play.${root}.evil.test`)).toBe(false);
      expect(wrangler).toContain(`pattern = "${root}", custom_domain = true`);
      expect(wrangler).toContain(`pattern = "*.${root}/*", zone_name = "${root}"`);
    });
  }
});

it('allows media reads and signed uploads from every official app origin without a wildcard', () => {
 const rule=cors.rules[0];
 for(const root of ['hearthroom.club','sukisuki.ai','sukisuki.chat'])
  for(const prefix of ['', 'www.', 'play.', 'playground.'])
   expect(rule.allowed.origins).toContain(`https://${prefix}${root}`);
 expect(rule.allowed.origins).not.toContain('*');
 expect(rule.allowed.origins).not.toContain('null');
 expect(rule.allowed.origins).not.toContain('https://sukisuki.club');
 expect(rule.allowed.methods).toEqual(['GET','HEAD','PUT']);
});

it('packages the pinned Playground sandbox before the combined deployment', () => {
 const build=deployWorkflow.indexOf('npm run build:h5:prod');
 const copy=deployWorkflow.indexOf('node scripts/copy-playground-sandbox.mjs');
 expect(build).toBeGreaterThan(-1);
 expect(copy).toBeGreaterThan(build);
 expect(copy).toBeLessThan(deployWorkflow.indexOf('npx wrangler deploy --cwd stage'));
});
