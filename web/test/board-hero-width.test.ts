// @vitest-environment node
import { expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

it('keeps the hero at the original page width while the feed uses wide screens', () => {
  const chrome = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
  expect(chrome, 'Chrome is required for responsive geometry').toBeTruthy();
  const board = readFileSync('src/pages/BoardPage.vue', 'utf8');
  const carousel = readFileSync('src/components/BoardCarousel.vue', 'utf8');
  const styles = [readFileSync('src/styles/tokens.css', 'utf8'), readFileSync('src/styles/base.css', 'utf8'), ...[board, carousel].flatMap(s => [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]))].join('\n');
  // Read the real ancestor classes: a wrapper omitted from the Vue template must fail too.
  const parent = board.slice(board.indexOf('<template>'), board.indexOf('<BoardCarousel'));
  const wrapped = /class="board-hero"/.test(parent);
  const dir = mkdtempSync(join(tmpdir(), 'board-hero-width-'));
  try {
    for (const width of [390, 640, 641, 768, 1079, 1440, 1920, 2560]) for (const enabled of width >= 640 && width < 1080 ? [false, true] : [false]) {
      const file = join(dir, `fixture-${width}-${enabled}.html`);
      const content = `<style>${styles}</style><div class="page board-page ${enabled ? 'board-page--pet-enabled' : ''}">${wrapped ? '<div class="board-hero">' : ''}<div class="carousel carousel--on"><div class="carousel__track"><div class="carousel__slide carousel__slide--on carousel__slide--poster"><a class="carousel__card carousel__card--poster"><img class="carousel__img"></a></div></div></div>${wrapped ? '</div>' : ''}<div class="board-main"></div></div><pre id="result"></pre><script>const r=e=>e.getBoundingClientRect();const hero=r(document.querySelector('.carousel'));const img=document.querySelector('img');document.querySelector('#result').textContent=JSON.stringify({width:hero.width,left:hero.left,feed:r(document.querySelector('.board-main')).width,fit:getComputedStyle(img).objectFit,height:r(img).height});</script>`;
      writeFileSync(file, `<iframe style="width:${width}px;height:900px;border:0"></iframe><pre id="result"></pre><script>const f=document.querySelector('iframe');f.contentDocument.open();f.contentDocument.write(${JSON.stringify(content).replaceAll('</script>', '<\\/script>')});f.contentDocument.close();document.querySelector('#result').textContent=f.contentDocument.querySelector('#result').textContent;</script>`);
      const run = spawnSync(chrome!, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(dir, 'profile-' + width + '-' + enabled)}`, `--window-size=${width},900`, '--dump-dom', `file://${file}`], { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
      expect(run.error, run.stderr).toBeUndefined();
      expect(run.status, run.stderr).toBe(0);
      const row = JSON.parse(run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)![1]);
      const expected = Math.min(width, 1200) - (width <= 640 ? 32 : 48);
      expect(row.width, `${width}px hero width`).toBeCloseTo(expected, 0);
      expect(row.left, `${width}px centered hero`).toBeCloseTo((width - expected) / 2, 0);
      expect(row.fit, `${width}px poster fills the card`).toBe('cover');
      expect(row.height).toBeGreaterThanOrEqual(width <= 760 ? 176 : 220);
      if (width >= 1440) expect(row.feed).toBeGreaterThan(row.width);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 90000);
