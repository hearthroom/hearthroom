import {env,SELF} from 'cloudflare:test';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {defaultCountryRegion} from '../src/country-region';
import {resetDb,identities,bearer,restoreUpstream} from './helpers';

beforeEach(async()=>{await resetDb();identities({viewer:40004});});
afterEach(restoreUpstream);
it('maps the default once from supported IP countries and UI locale, never CN by IP',()=>{
 for(const code of ['HK','MO','TW','SG','MY','JP','KR','US'])expect(defaultCountryRegion(code,'zh-Hant')).toBe(code);
 for(const code of ['CN','FR','']){expect(defaultCountryRegion(code,'zh-Hans')).toBe('TW');expect(defaultCountryRegion(code,'en')).toBe('OTHER');}
});
it('persists the first default and accepts only listed region codes',async()=>{
 const me=()=>SELF.fetch('https://c.test/v1/me',{headers:{...bearer('viewer'),language:'ja','CF-IPCountry':'JP'}});
 expect((await (await me()).json() as any).countryRegion).toBe('JP');
 const settings=(countryRegion:unknown)=>SELF.fetch('https://c.test/v1/me/settings',{method:'POST',headers:{...bearer('viewer'),'Content-Type':'application/json'},body:JSON.stringify({countryRegion})});
 expect((await settings('CN')).status).toBe(200);
 expect((await (await me()).json() as any).countryRegion).toBe('CN');
 expect((await settings('FR')).status).toBe(400);
 expect((await (await me()).json() as any).countryRegion).toBe('CN');
 const row=await env.DB.prepare('SELECT country_region FROM members').first();
 expect(row?.country_region).toBe('CN');
});
it('emits bounded save and denial counters without member or card labels',async()=>{
 const save=await SELF.fetch('https://c.test/v1/me/settings',{method:'POST',headers:{...bearer('viewer'),'Content-Type':'application/json'},body:JSON.stringify({countryRegion:'CN'})});
 expect(save.status).toBe(200);
 const denied=await SELF.fetch('https://c.test/v1/me/settings',{method:'POST',headers:{...bearer('viewer'),'Content-Type':'application/json'},body:JSON.stringify({showNsfw:true})});
 expect(denied.status).toBe(403);
 const metrics=await (await SELF.fetch('https://c.test/metrics')).text();
 expect(metrics).toContain('hearthroom_country_region_operations_total{operation="save",outcome="success"} 1');
 expect(metrics).toContain('hearthroom_country_region_operations_total{operation="admission",outcome="denied"} 1');
 expect(metrics).not.toContain('countryRegion=');
});
