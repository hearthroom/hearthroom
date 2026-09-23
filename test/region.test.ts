import {SELF} from 'cloudflare:test';
import {expect,it} from 'vitest';
it.each(['CN','TW','AQ'])('returns only Harbor in %s, never a retired gateway',async country=>{
 const r=await SELF.fetch('https://c.test/v1/region',{headers:{'cf-ipcountry':country}});
 expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');
 expect((await r.json() as {apiBase:string}).apiBase).toBe('https://api.harperharbor.com');
});
