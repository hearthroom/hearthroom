import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearLibraryCache, fetchConversations, libraryRequest } from "../src/lib/library";

import {setProvider} from '../src/lib/provider';
beforeEach(()=>clearLibraryCache());
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();setProvider('lunatalk');clearLibraryCache();});
it("reads only the community conversation index with explicit paging and language", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ conversations: [], hasNextPage: false })));
  vi.stubGlobal("fetch", fetcher);
  expect((await fetchConversations("test-token", "en", 2)).conversations).toEqual([]);
  expect(fetcher.mock.calls[0][0]).toContain("/v1/me/conversations?pageNum=2&lang=en");
  expect(fetcher.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer test-token", 'X-Provider': 'lunatalk' });
});
it("does not turn an authentication failure into an empty library", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error":"unauthorized"}', { status: 401 })));
  await expect(libraryRequest("favorites", "expired")).rejects.toMatchObject({ status: 401 });
});

it("deduplicates private reads per session and invalidates after a mutation", async () => {
  const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({items:[]})));
  vi.stubGlobal("fetch",fetcher);
  await Promise.all([libraryRequest("favorites?lang=en","cache-user"),libraryRequest("favorites?lang=en","cache-user")]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await libraryRequest("favorites?lang=en","other-user"); expect(fetcher).toHaveBeenCalledTimes(2);
  await libraryRequest("favorites/item","cache-user","PUT");
  await libraryRequest("favorites?lang=en","cache-user"); expect(fetcher).toHaveBeenCalledTimes(4);
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
 await libraryRequest('following','same-token');setProvider('harbor');await libraryRequest('following','same-token');
 expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[1][1].headers['X-Provider']).toBe('harbor');
 clearLibraryCache();await libraryRequest('following','same-token');expect(fetcher).toHaveBeenCalledTimes(3);
});
it('does not resurrect an invalidated in-flight private read',async()=>{
 let finish!:(r:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{finish=r;})).mockImplementation(async()=>new Response('{"items":[]}'));vi.stubGlobal('fetch',fetcher);
 const old=libraryRequest('favorites','inflight');clearLibraryCache();finish(new Response('{"items":["old"]}'));await old;
 expect(await libraryRequest('favorites','inflight')).toEqual({items:[]});expect(fetcher).toHaveBeenCalledTimes(2);
});
