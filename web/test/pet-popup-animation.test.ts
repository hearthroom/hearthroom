// @vitest-environment node
import { expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

it('keeps a fitted edge popup inside its safe area throughout the real entrance animation', () => {
  const chrome = process.env.CHROME_BIN || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
  expect(chrome, 'Chrome is required for CSS animation composition').toBeTruthy();
  const source = readFileSync('src/components/SukiPet.vue', 'utf8');
  const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const tokens = readFileSync('src/styles/tokens.css', 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'pet-popup-animation-'));
  try {
    const frames = [1440, 2560].flatMap(width => ['left', 'right'].map(side => {
      const x = side === 'left' ? -91 : width - 55, shift = side === 'left' ? 120 : -400;
      const markup = `<style>${tokens}\n${styles}</style><div class="suki-pet${side === 'right' ? ' suki-pet--right' : ''}" style="transform:translate(${x}px,585px)"><div class="suki-pet__hit" style="width:146px;height:220px"></div><div class="suki-pet__bubble suki-pet__bubble--in" style="translate:${shift}px">我在這邊等你喔～</div></div>`;
      const escaped = markup.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      return `<iframe style="border:0;width:${width}px;height:900px" srcdoc="${escaped}" onload="const w=this.contentWindow,b=this.contentDocument.querySelector('.suki-pet__bubble'),a=b.getAnimations()[0];if(!a)throw Error('popup entrance animation missing');a.pause();for(const ms of [0,50,125,250]){a.currentTime=ms;const r=b.getBoundingClientRect();window.rows.push({width:${width},side:'${side}',ms,left:r.left,right:r.right,inline:b.style.translate,computed:w.getComputedStyle(b).translate})}document.querySelector('#result').textContent=JSON.stringify(window.rows)"></iframe>`;
    })).join('');
    const file = join(dir, 'fixture.html');
    writeFileSync(file, `<script>window.rows=[]</script>${frames}<pre id="result"></pre>`);
    const run = spawnSync(chrome!, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(dir, 'profile')}`, '--dump-dom', '--virtual-time-budget=1000', `file://${file}`], { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
    expect(run.error, run.stderr).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    const json = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    expect(json, run.stdout).toBeTruthy();
    const rows = JSON.parse(json!);
    expect(rows).toHaveLength(16);
    for (const row of rows) {
      expect(row.left, JSON.stringify(row)).toBeGreaterThanOrEqual(8);
      expect(row.right, JSON.stringify(row)).toBeLessThanOrEqual(row.side === 'right' ? row.width - 312 : row.width - 8);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
