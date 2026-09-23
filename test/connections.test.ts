import {SELF,env} from 'cloudflare:test';
import {beforeEach,expect,it} from 'vitest';
import {resetDb} from './helpers';
beforeEach(resetDb);
it.each(['/v1/me/connections','/v1/me/connections/preview'])('retires cross-service linking at %s before consuming any credential',async path=>{
 const r=await SELF.fetch('https://c.test'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'lunatalk',token:'old-token'})});
 expect(r.status).toBe(410);
 expect(await env.DB.prepare('SELECT count(*) AS n FROM member_connections').first()).toEqual({n:0});
});
