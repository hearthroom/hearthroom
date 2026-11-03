import test from 'node:test';
import assert from 'node:assert/strict';
import {readMessages} from './cli.mjs';
test('CLI 只讀 HTTPS /messages、帶 bearer、拒絕 redirects 和錯誤回應',async()=>{
 let called;
 const fetchImpl=async(url,options)=>{called={url,options};return new Response(JSON.stringify({messages:[{text:'code'}]}));};
 assert.deepEqual(await readMessages({endpoint:'https://mail.example.net',token:'a'.repeat(64)},5,fetchImpl),{messages:[{text:'code'}]});
 assert.equal(called.url,'https://mail.example.net/messages?limit=5');assert.equal(called.options.redirect,'error');assert.equal(called.options.headers.authorization,'Bearer '+'a'.repeat(64));
 await assert.rejects(readMessages({endpoint:'http://mail.example.net',token:'x'},5,fetchImpl),/HTTPS/);
 await assert.rejects(readMessages({endpoint:'https://mail.example.net/path',token:'x'},5,fetchImpl),/origin/);
 await assert.rejects(readMessages({endpoint:'https://mail.example.net',token:'a'.repeat(64)},5,async()=>new Response('secret',{status:401})),/401/);
});
