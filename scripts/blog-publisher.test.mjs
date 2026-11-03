import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publisherRequest} from './blog-publisher.mjs';

test('uses a private credential file and stable operation ID; shared API receives the body without secret output',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'blog-cli-'));try{
 const credential=join(dir,'credential.json'),body=join(dir,'post.json');
 await writeFile(credential,JSON.stringify({origin:'https://sukisuki.ai',key:'12'.repeat(32)}),{mode:0o600}); await writeFile(body,JSON.stringify({title:'Rules'}));
 let request;
 const result=await publisherRequest(['POST','/v1/blog/admin/posts','--credential',credential,'--json',body,'--operation-id','stable-operation-123'],{fetch:async(url,init)=>{request={url,init};return new Response(JSON.stringify({id:'post'}));}});
 assert.equal(result.id,'post'); assert.equal(request.url,'https://sukisuki.ai/v1/blog/admin/posts'); assert.equal(request.init.headers['X-Blog-Publisher-Key'],'12'.repeat(32));assert.equal(request.init.redirect,'error');
 assert.deepEqual(JSON.parse(request.init.body),{title:'Rules',operationId:'stable-operation-123'});
 for(const path of ['/v1/moderation/settings','https://evil.test/v1/blog/admin/posts','/v1/blog/admin/../posts','/v1/blog/admin/posts/../../../../x']) await assert.rejects(publisherRequest(['GET',path,'--credential',credential]),/blog admin path/);
 await chmod(credential,0o644);await assert.rejects(publisherRequest(['GET','/v1/blog/admin/posts','--credential',credential]),/private credential/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('rejects unsafe origin and missing operation ID before any network write',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'blog-cli-'));try{
 const credential=join(dir,'credential.json');
 await writeFile(credential,JSON.stringify({origin:'http://sukisuki.ai',key:'12'.repeat(32)}),{mode:0o600});
 await assert.rejects(publisherRequest(['GET','/v1/blog/admin/posts','--credential',credential]),/origin/);
 await writeFile(credential,JSON.stringify({origin:'https://sukisuki.ai',key:'12'.repeat(32)}));
 await assert.rejects(publisherRequest(['POST','/v1/blog/admin/posts','--credential',credential]),/operation ID/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('uploads a cover with a stable operation ID and reports HTTP failures',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'blog-cli-'));try{
 const credential=join(dir,'credential.json'),image=join(dir,'cover.webp');
 await writeFile(credential,JSON.stringify({origin:'http://127.0.0.1:8787',key:'12'.repeat(32)}),{mode:0o600});await writeFile(image,'synthetic');
 await publisherRequest(['POST','/v1/blog/admin/images','--credential',credential,'--image',image,'--operation-id','image-operation-123'],{fetch:async(url,init)=>{assert.equal(init.body.get('operationId'),'image-operation-123');assert.equal(init.body.get('file').type,'image/webp');assert.equal(init.headers['Content-Type'],undefined);return new Response('{}');}});
 await assert.rejects(publisherRequest(['GET','/v1/blog/admin/posts','--credential',credential],{fetch:async()=>new Response('{"error":"blog_write_forbidden"}',{status:403})}),/403.*blog_write_forbidden/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
