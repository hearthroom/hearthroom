// @vitest-environment node
import { expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

it('gives the fixed toast its available viewport width without covering the sandbox opening at phone and desktop sizes', () => {
  const chrome = process.env.CHROME_BIN || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find(existsSync);
  expect(chrome, 'Chrome is required for fixed-position layout').toBeTruthy();
  const source = readFileSync('src/pages/PlayPage.vue', 'utf8');
  const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
  const tokens = readFileSync('src/styles/tokens.css', 'utf8');
  const base = readFileSync('src/styles/base.css', 'utf8');
  const text = JSON.parse(readFileSync('../stage/src/locale/en.json', 'utf8'))['canvas.modelPreferenceFallback'];
  const dir = mkdtempSync(join(tmpdir(), 'play-toast-width-'));
  try {
    const widths = [320, 390, 1440];
    const frames = widths.map(width => {
      // 80px is the opening's observed top in the QA sandbox fixture. The real
      // fixed container, not an artificial width on the toast, determines layout.
      // Use the product's font stack: system-ui can resolve differently from
      // --font across platforms and change this wrapping case.
      const markup = `<style>${tokens}\n${base}\n${styles}</style><p id="opening" style="position:absolute;top:80px;margin:0">Opening</p><div class="play__toasts"><div class="play__toast"><span>${text}</span></div></div><div class="play__toasts" style="top:300px"><div class="play__toast" id="short-toast"><span>Saved.</span></div></div>`;
      const escaped = markup.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<iframe style="border:0;width:${width}px;height:844px" srcdoc="${escaped}" onload="const d=this.contentDocument,t=d.querySelector('.play__toast'),w=d.querySelector('.play__toasts'),r=t.getBoundingClientRect();window.results.push({viewport:this.contentWindow.innerWidth,width:w.getBoundingClientRect().width,bottom:r.bottom,opening:d.querySelector('#opening').getBoundingClientRect().top,shortWidth:d.querySelector('#short-toast').getBoundingClientRect().width,overflow:t.scrollWidth>t.clientWidth,hit:this.contentWindow.getComputedStyle(w).pointerEvents});document.querySelector('#result').textContent=JSON.stringify(window.results)"></iframe>`;
    }).join('');
    const file = join(dir, 'fixture.html');
    writeFileSync(file, `<script>window.results=[]</script>${frames}<pre id="result"></pre>`);
    const run = spawnSync(chrome!, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(dir, 'profile')}`, '--dump-dom', '--virtual-time-budget=1000', `file://${file}`], { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
    expect(run.error, run.stderr).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    const json = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    expect(json, run.stdout).toBeTruthy();
    const rows = JSON.parse(json!);
    expect(rows).toHaveLength(widths.length);
    for (const row of rows) {
      expect(row.bottom, `opening at ${row.viewport}`).toBeLessThanOrEqual(row.opening);
      expect(row.width, `viewport ${row.viewport}`).toBeCloseTo(Math.min(row.viewport - 16, 480), 1);
      expect(row.overflow).toBe(false);
      expect(row.hit).toBe('none');
      expect(row.shortWidth, 'short feedback stays compact').toBeLessThan(160);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
