import { readNativeFixture } from '../../stage/src/test-support/native-fixture';
// @vitest-environment node
import { expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('keeps Korean toast words together and retains emergency wrapping in Chrome', async () => {
  const chrome=process.env.CHROME_BIN||['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(existsSync);
  expect(chrome,'Chrome is required for actual Korean line wrapping').toBeTruthy();
  const source=readFileSync('src/pages/PlayPage.vue','utf8');
  const styles=[...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
  const text='작업을 완료하지 못했어요. 잠시 후 다시 시도해 보세요.';
  const dir=mkdtempSync(join(tmpdir(),'host-korean-toast-'));
    let clean = false;
  try{
    const file=join(dir,'fixture.html');
    writeFileSync(file,`<style>:root{--s-2:8px;--s-4:16px}${styles}</style>${[190,217,244,271].map(width=>`<section lang="ko" style="width:${width}px"><div class="play__toast"><span>${text}</span></div></section>`).join('')}<pre id="result"></pre><script>document.querySelector('#result').textContent=JSON.stringify(Array.from(document.querySelectorAll('.play__toast')).map(el=>{const n=el.firstChild.firstChild,words=n.textContent.split(' ');let start=0;const pieces=words.map(word=>{const r=document.createRange();r.setStart(n,start);r.setEnd(n,start+word.length);start+=word.length+1;return r.getClientRects().length});return {wordBreak:getComputedStyle(el).wordBreak,overflowWrap:getComputedStyle(el).overflowWrap,pieces,overflow:el.scrollWidth>el.clientWidth}}))</script>`);
    clean = false;
      const run = await readNativeFixture(chrome!, file, { profile: join(dir,'profile'), ready: "!!document.querySelector('#result')?.textContent", timeout: 20000 });
      clean = true;
    expect(run.error,run.stderr).toBeUndefined();expect(run.status,run.stderr).toBe(0);
    const json=run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];expect(json,run.stdout).toBeTruthy();
    const rows=JSON.parse(json!);expect(rows).toHaveLength(4);
    for(const row of rows){expect(row.wordBreak).toBe('keep-all');expect(row.overflowWrap).toBe('anywhere');expect(row.pieces.every((count:number)=>count===1)).toBe(true);expect(row.overflow).toBe(false);}
  }finally{if (clean) rmSync(dir,{recursive:true,force:true});}
},30000);
