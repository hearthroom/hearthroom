import {beforeEach,expect,it} from 'vitest';
import {setProvider} from '@/lib/provider';
import {persist,restorePersisted,forgetSession} from '@/lib/oauth';
beforeEach(()=>{localStorage.clear();sessionStorage.clear();setProvider('harbor')});
it('retains Harper credentials across tabs with stale Luna selection, and clears them on logout',()=>{
 persist({accessToken:'harper',expiresAt:Date.now()+60000});
 localStorage.setItem('hearthroom.provider','lunatalk');
 localStorage.setItem('hearthroom.oauth.access',JSON.stringify({accessToken:'old-luna',expiresAt:Date.now()+60000}));
 setProvider('harbor');expect(restorePersisted()?.accessToken).toBe('harper');
 forgetSession('harbor');expect(restorePersisted()).toBeNull();
});
