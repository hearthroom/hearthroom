import {test} from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceCommand} from './maintenance-mode.mjs';
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
