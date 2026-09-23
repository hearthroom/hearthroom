import { beforeEach, expect, it, vi } from 'vitest';
import { setProvider, currentProvider } from '../src/lib/provider';
import { playProvider } from '../src/lib/play-context';
beforeEach(()=>{localStorage.clear();sessionStorage.clear();setProvider('harbor');});
it('scopes play routing without changing the community identity',()=>{
 expect(playProvider('harbor')).toBe('harbor');
 expect(currentProvider()).toBe('harbor');
 expect(playProvider(undefined)).toBe('harbor');
 expect(()=>playProvider('unknown')).toThrow();
});
