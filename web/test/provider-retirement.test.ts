import {beforeEach,describe,expect,it} from 'vitest';
import {currentProvider,PROVIDERS,setProvider} from '@/lib/provider';
import {readCredential} from '@/lib/credential-store';
import {playProvider} from '@/lib/play-context';
import {resolveUpstream} from '@/lib/config';

beforeEach(()=>{localStorage.clear();sessionStorage.clear()});
describe('permanent provider retirement',()=>{
 it('offers Harper alone and refuses old play URLs',()=>{
  expect(PROVIDERS.map(p=>p.id)).toEqual(['harbor']);
  expect(currentProvider()).toBe('harbor');
  expect(()=>playProvider('lunatalk')).toThrow();
 });
 it.each(['lunatalk',null])('never adopts ambiguous legacy credentials (%s)',stored=>{
  if(stored)localStorage.setItem('hearthroom.provider',stored);
  localStorage.setItem('hearthroom.oauth.access','retired');
  localStorage.setItem('hearthroom.oauth.access.lunatalk','retired');
  expect(readCredential('hearthroom.oauth.access','harbor')).toBeNull();
  setProvider('harbor');
  expect(readCredential('hearthroom.oauth.access','harbor')).toBeNull();
  expect(localStorage.getItem('hearthroom.oauth.access.lunatalk')).toBeNull();
 });
 it('preserves existing Harper credentials',()=>{
  localStorage.setItem('hearthroom.provider','lunatalk');
  localStorage.setItem('hearthroom.oauth.access.harbor','harbor-token');
  setProvider('harbor');
  expect(readCredential('hearthroom.oauth.access','harbor')).toBe('harbor-token');
 });
 it('ignores retired regional gateway caches',async()=>{
  sessionStorage.setItem('hr.apiBase','https://api.lunatalk.pro');
  expect(await resolveUpstream()).toBe('https://api.harperharbor.com');
 });
});

it('rejects a pre-retirement OAuth callback before exchanging its code at Harper',async()=>{
 const {completeLogin}=await import('@/lib/oauth');
 const {resetManagedAuthForTest}=await import('@/lib/managed-auth');
 resetManagedAuthForTest(false);
 sessionStorage.setItem('hearthroom.oauth.pending',JSON.stringify({provider:'lunatalk'}));
 sessionStorage.setItem('hearthroom.oauth.state','state');
 sessionStorage.setItem('hearthroom.oauth.verifier','private-verifier');
 await expect(completeLogin(new URLSearchParams({state:'state',code:'old-code'}))).rejects.toThrow();
});
