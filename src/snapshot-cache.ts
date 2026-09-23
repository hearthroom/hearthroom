import type { Env } from './types';
export const snapshotCache = { namespace: 'public-snapshot-harbor-v2' };
type Entry<T> = { value:T; expires:number };
type Context = Pick<ExecutionContext,'waitUntil'>;
/** Public projections only. Callers read the authoritative revision/access before this helper. */
export async function snapshot<T>(env:Env, keyParts:unknown[], ttl:number, load:()=>Promise<T>, ctx?:Context):Promise<{value:T;layer:'edge'|'kv'|'origin'}> {
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(keyParts)));
 const key=snapshotCache.namespace+':'+[...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('');
 const request=new Request('https://snapshot.internal/'+key);
 const live=(entry:Entry<T>|null):entry is Entry<T>=>!!entry&&typeof entry.expires==='number'&&entry.expires>Date.now()&&'value' in entry;
 async function edgeWrite(entry:Entry<T>) {
  const remaining=Math.floor((entry.expires-Date.now())/1000);if(remaining<1)return;
  await (await caches.open(snapshotCache.namespace)).put(request,new Response(JSON.stringify(entry),{headers:{'Cache-Control':`public, max-age=${remaining}`}}));
 }
 try {const response=await (await caches.open(snapshotCache.namespace)).match(request);const entry=response?await response.json<Entry<T>>():null;if(live(entry))return {value:entry.value,layer:'edge'};}catch{console.warn('Public snapshot edge unavailable');}
 try {const entry=await env.CACHE.get<Entry<T>>(key,'json');if(live(entry)){const write=edgeWrite(entry).catch(()=>{});if(ctx)ctx.waitUntil(write);else await write;return {value:entry.value,layer:'kv'};}}catch{console.warn('Public snapshot KV unavailable');}
 const value=await load();
 const entry={value,expires:Date.now()+ttl*1000};
 const write=Promise.all([edgeWrite(entry),env.CACHE.put(key,JSON.stringify(entry),{expirationTtl:Math.max(60,Math.ceil(ttl))})]).then(()=>{}).catch(()=>{console.warn('Public snapshot write unavailable');});
 if(ctx)ctx.waitUntil(write);else await write;
 return {value,layer:'origin'};
}
