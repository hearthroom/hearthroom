import {env} from 'cloudflare:test';
import {afterEach,it,expect,vi} from 'vitest';
import {transfers} from '../src/card-transfer';
import {hostingTransferMedia} from '../src/hosting-distribution';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()});
it('preserves authored rendering format, book order and imported priority in hosted transport',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
  const u=new URL(input);let value:unknown;
  if(u.pathname.endsWith('/role/detail'))value={roleId:'snapshot',accountNumId:10001,roleName:'A',roleDesc:'B',roleDetailDesc:'Private',roleWelcome:'Hi',language:'en'};
  else if(u.pathname.endsWith('/role/author-asset'))value={rules:[],pageMode:'sandbox',cardFormat:'mmd'};
  else if(u.pathname.endsWith('/worldbook/bindings'))value={bindings:[{worldbookId:'z'},{worldbookId:'a'}]};
  else if(u.pathname.endsWith('/worldbook/detail'))value={name:u.searchParams.get('worldbookId'),language:'en'};
  else if(u.pathname.endsWith('/worldbook/entry/list'))value={entries:[{name:'Lore',content:'Frozen',priority:90}]};
  else throw new Error('unexpected endpoint');
  return Response.json(value);
 }));
 const result=await transfers.readHosted(env,'lunatalk','author','snapshot',10001);
 expect(result.card.authorAsset?.cardFormat).toBe('mmd');
 expect(result.card.worldbooks?.map(b=>b.name)).toEqual(['z','a']);
 expect(result.card.worldbooks?.[0].entries[0].priority).toBe(90);
});
it('compares media bytes across providers rather than provider URLs',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('same image bytes',{headers:{'Content-Type':'image/png'}})));
 const card={name:'A',summary:'',description:'private',greeting:'hi',language:'en',media:{avatar:'https://objects.lunatalk.ai/source'}};
 const source=await hostingTransferMedia.hash(env,'lunatalk',card);
 const target=await hostingTransferMedia.hash(env,'harbor',{...card,media:{avatar:'https://assets.harperharbor.com/target'}});
 expect(target).toBe(source);
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('changed image bytes')));
 expect(await hostingTransferMedia.hash(env,'harbor',card)).not.toBe(source);
});
it('refuses a nonportable locale before accepting an incomplete immutable projection',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({roleId:'snapshot',accountNumId:10001,roleName:'A',roleDetailDesc:'Private',language:'en',availableLocales:['en','zh-Hant']})));
 await expect(transfers.readHosted(env,'harbor','author','snapshot',10001)).rejects.toThrow('sync_unsupported_content');
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('writes LunaTalk custom instructions under the supported document field',async()=>{
 const requests:{path:string;body:any}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  const path=new URL(input).pathname;requests.push({path,body:init?.body?JSON.parse(String(init.body)):null});
  return Response.json(path.endsWith('/worldbook/bindings')?{bindings:[]}:{});
 }));
 await transfers.update(env,'lunatalk','author','draft',{name:'A',summary:'B',description:'Private',greeting:'Hello',language:'en',fields:{customInstructions:'Retain this instruction'}});
 expect(requests.find(r=>r.path.endsWith('/document'))?.body.fields).toMatchObject({jailbreak:'Retain this instruction'});
});
