import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearLibraryCache, fetchConversations, libraryRequest } from "../src/lib/library";

import {setProvider} from '../src/lib/provider';
beforeEach(()=>clearLibraryCache());
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();setProvider('harbor');clearLibraryCache();});
it("reads only the community conversation index with explicit paging and language", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversations: [], hasNextPage: false })));
  vi.stubGlobal("fetch", fetcher);
  expect((await fetchConversations("test-token", "en", 2)).conversations).toEqual([]);
  expect(fetcher.mock.calls[0][0]).toContain("/v1/me/conversations?pageNum=2&lang=en");
  expect(fetcher.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer test-token", 'X-Provider': 'harbor' });
});
it("does not turn an authentication failure into an empty library", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 })));
  await expect(libraryRequest("favorites", "expired")).rejects.toMatchObject({ status: 401 });
});

it("deduplicates private reads per session and invalidates after a mutation", async () => {
  const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({items:[]})));
  vi.stubGlobal("fetch",fetcher);
  await Promise.all([libraryRequest("following?lang=en","cache-user"),libraryRequest("following?lang=en","cache-user")]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await libraryRequest("following?lang=en","other-user"); expect(fetcher).toHaveBeenCalledTimes(2);
  await libraryRequest("following/item","cache-user","PUT");
  await libraryRequest("following?lang=en","cache-user"); expect(fetcher).toHaveBeenCalledTimes(4);
});
it.each(['favorites','feed'])('rechecks %s on each read instead of reusing cached permissions',async path=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json({items:[]}));vi.stubGlobal('fetch',fetcher);
 await libraryRequest(path,'same-user');await libraryRequest(path,'same-user');expect(fetcher).toHaveBeenCalledTimes(2);
});
it('expires private responses and never retains failed reads',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({items:[]})));
 vi.stubGlobal('fetch',fetcher);
 await libraryRequest('following','expiry-user');
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+31000);
 await libraryRequest('following','expiry-user');expect(fetcher).toHaveBeenCalledTimes(2);clock.mockRestore();
 fetcher.mockResolvedValueOnce(new Response('{}',{status:503}));
 await expect(libraryRequest('favorites','retry-user')).rejects.toMatchObject({status:503});
 await libraryRequest('favorites','retry-user');expect(fetcher).toHaveBeenCalledTimes(4);
});

it('isolates providers even with identical credential text and clears on logout',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({items:[]})));vi.stubGlobal('fetch',fetcher);
 await libraryRequest('following','first-account');await libraryRequest('following','same-token');
 expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].headers['X-Provider']).toBe('harbor');
 clearLibraryCache();await libraryRequest('following','same-token');expect(fetcher).toHaveBeenCalledTimes(3);
});
it('does not resurrect an invalidated in-flight private read',async()=>{
 let finish!:(r:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{finish=r;})).mockImplementation(async()=>new Response('{"items":[]}'));vi.stubGlobal('fetch',fetcher);
 const old=libraryRequest('favorites','inflight');clearLibraryCache();finish(new Response('{"items":["old"]}'));await old;
 expect(await libraryRequest('favorites','inflight')).toEqual({items:[]});expect(fetcher).toHaveBeenCalledTimes(2);
});
