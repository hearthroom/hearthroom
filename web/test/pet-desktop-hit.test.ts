// @vitest-environment node
import { expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { silhouettePath } from '../src/pet/placement';

it('passes clipped transparent areas to page links while keeping the peek and menu interactive', () => {
  const chrome = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  expect(chrome, 'Chrome is required for actual pointer hit testing').toBeTruthy();
  const source = readFileSync('src/components/SukiPet.vue', 'utf8');
  const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const pixels = new Uint8Array(10 * 10 * 4);
  for (let y = 0; y < 10; y++) for (let x = 4; x < 6; x++) pixels[(y * 10 + x) * 4 + 3] = 255;
  const path = silhouettePath(pixels, 10, 10, { sx: 10, sy: 10, mirror: false, step: 1, gap: 0 });
  const dir = mkdtempSync(join(tmpdir(), 'pet-desktop-hit-'));
  try {
    for (const mobile of [false, true]) {
      const file = join(dir, `${mobile}.html`);
      writeFileSync(file, `<style>${styles}</style><a id="under" href="#destination" style="position:fixed;left:20px;top:100px;width:100px;height:100px">Underlying card</a><div class="suki-pet suki-pet--tucked ${mobile ? 'suki-pet--mobile' : ''}" style="transform:translate(20px,100px)"><div id="hit" class="suki-pet__hit" style='width:100px;height:100px;clip-path:path("${path}")'></div><div class="suki-pet__menu" style="left:130px;top:0;bottom:auto;width:100px"><button id="menu">Pet menu</button></div></div><pre id="result"></pre><script>const row={transparent:document.elementFromPoint(30,150)?.id,opaque:document.elementFromPoint(70,150)?.id,menu:document.elementFromPoint(185,120)?.id};document.body.insertAdjacentHTML('beforeend','<header class="header"><div role="menu"></div></header>');row.headerOpenTarget=document.elementFromPoint(70,150)?.id;document.querySelector('#result').textContent=JSON.stringify(row);</script>`);
      const run = spawnSync(chrome!, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(dir, 'profile-' + mobile)}`, '--dump-dom', `file://${file}`], { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
      expect(run.error, run.stderr).toBeUndefined(); expect(run.status, run.stderr).toBe(0);
      const json = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
      expect(json, run.stdout).toBeTruthy();
      const row = JSON.parse(json!);
      expect(row.transparent, `mobile=${mobile}: transparent root must not swallow links`).toBe('under');
      expect(row.opaque, `mobile=${mobile}: painted peek remains interactive`).toBe('hit');
      expect(row.menu, `mobile=${mobile}: menu remains interactive`).toBe('menu');
      expect(row.headerOpenTarget, `mobile=${mobile}: a hidden peek cannot catch clicks behind the header menu`).toBe('under');
    }
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
}, 60000);
