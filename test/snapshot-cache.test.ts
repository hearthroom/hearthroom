import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { snapshot, snapshotCache } from '../src/snapshot-cache';
import type { Env } from '../src/types';
beforeEach(()=>{snapshotCache.namespace='snapshot-test-'+crypto.randomUUID();});
afterEach(()=>vi.restoreAllMocks());
it('warms another edge from KV without extending the expiry',async()=>{
 const source=vi.fn().mockResolvedValue({count:1});const ctx=createExecutionContext();
 expect((await snapshot(env,['key'],30,source,ctx)).layer).toBe('origin');await waitOnExecutionContext(ctx);
 const cache=await caches.open(snapshotCache.namespace);
 const match=vi.spyOn(cache,'match').mockResolvedValue(undefined);
 // Use the same underlying cache binding while simulating a different edge.
 vi.spyOn(caches,'open').mockResolvedValue(cache);
 const next=createExecutionContext();expect((await snapshot(env,['key'],30,source,next)).layer).toBe('kv');await waitOnExecutionContext(next);
 vi.spyOn(Date,'now').mockReturnValue(Date.now()+31000);
 expect((await snapshot(env,['key'],30,source)).layer).toBe('origin');expect(source).toHaveBeenCalledTimes(2);match.mockRestore();
});
it('fails open when either cache cannot read or write',async()=>{
 vi.spyOn(caches,'open').mockRejectedValue(new Error('offline'));
 const broken={...env,CACHE:{get:async()=>{throw new Error('offline');},put:async()=>{throw new Error('offline');}}} as unknown as Env;
 const ctx=createExecutionContext();expect(await snapshot(broken,['key'],300,async()=>42,ctx)).toEqual({value:42,layer:'origin'});await waitOnExecutionContext(ctx);
});
it('does not share different access partitions or revisions',async()=>{
 await snapshot(env,['author',1,false],300,async()=> 'general');
 expect((await snapshot(env,['author',1,true],300,async()=> 'adult')).value).toBe('adult');
 expect((await snapshot(env,['author',2,false],300,async()=> 'changed')).value).toBe('changed');
});
