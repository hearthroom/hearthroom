import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {maintenanceCommand,executeMaintenance} from './maintenance-mode.mjs';
test('requires explicit environment and bounded, unambiguous estimates',()=>{
 assert.throws(()=>maintenanceCommand(['on','--minutes','10']),/local.*remote/);
 assert.throws(()=>maintenanceCommand(['on','--remote','--minutes','0']),/minutes/);
 assert.throws(()=>maintenanceCommand(['on','--remote','--until','yesterday']),/until/);
 assert.throws(()=>maintenanceCommand(['on','--remote','--until','2030-01-01T01:00:00']),/until/);
 assert.throws(()=>maintenanceCommand(['on','--remote','--until','2030-01-01T01:00:00Z','--minutes','5']),/one/);
});
test('on is durable until explicit off; audit and status SQL never interpolate unescaped text',()=>{
 const command=maintenanceCommand(['on','--local','--minutes','10'],1000,'op-test');
 assert.equal(command.state.endsAt,601000);assert.equal(command.state.enabled,true);
 assert.match(command.sql,/site_maintenance/);assert.match(command.sql,/maintenance_event_op-test/);
 assert.equal(maintenanceCommand(['off','--remote'],1000,'op-off').state.enabled,false);
 assert.match(maintenanceCommand(['status','--local']).sql,/SELECT/);
});

test('real local CLI returns durable rows for on/status/off/status without touching the shared local database',()=>{
 const temp=mkdtempSync(join(tmpdir(),'maintenance-cli-test-'));
 const root=dirname(dirname(fileURLToPath(import.meta.url)));
 const run=(executable,args,options)=>spawnSync(executable,[...args,'--persist-to',temp],{...options,stdio:'pipe',encoding:'utf8'});
 try {
  const setup=run(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB','--local','--command','CREATE TABLE community_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_by TEXT,updated_at INTEGER NOT NULL)','--json'],{cwd:root});
  assert.equal(setup.status,0,setup.stderr);
  for(const [action,enabled] of [['on',true],['status',true],['off',false],['status',false]]){
   const result=executeMaintenance([action,'--local',...(action==='on'?['--minutes','10']:[])],run);
   assert.equal(result.status,0,result.stderr);
   const rows=JSON.parse(result.stdout).flatMap(r=>r.results);
   const state=rows.find(row=>row.key==='site_maintenance');
   assert.ok(state,'Command must return the durable setting, not an import summary');
   assert.equal(JSON.parse(state.value).enabled,enabled);
  }
 } finally {rmSync(temp,{recursive:true,force:true});}
});
