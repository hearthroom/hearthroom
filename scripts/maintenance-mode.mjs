#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function maintenanceCommand(args,now=Date.now(),operation=randomUUID()) {
 const [action,...options]=args;
 if(!['on','off','status'].includes(action))throw Error('Use on, off, or status');
 let target,minutes,until;
 for(let i=0;i<options.length;i++) {
  const option=options[i];
  if(option==='--local'||option==='--remote'){if(target)throw Error('Choose one of --local or --remote');target=option;}
  else if(option==='--minutes'){if(minutes!==undefined)throw Error('Duplicate minutes');minutes=options[++i];}
  else if(option==='--until'){if(until!==undefined)throw Error('Duplicate until');until=options[++i];}
  else throw Error('Unknown option: '+option);
 }
 if(!target)throw Error('Choose --local or --remote explicitly');
 if(minutes!==undefined&&until!==undefined)throw Error('Choose one estimate');
 if(action!=='on'&&(minutes!==undefined||until!==undefined))throw Error('Estimates are only valid with on');
 let endsAt=null;
 if(minutes!==undefined){const n=Number(minutes);if(!Number.isInteger(n)||n<1||n>10080)throw Error('minutes must be 1..10080');endsAt=now+n*60000;}
 if(until!==undefined){if(!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(until)||!Number.isFinite(Date.parse(until))||Date.parse(until)<=now)throw Error('until must be a future ISO date with timezone');endsAt=Date.parse(until);}
 if(action==='on'&&minutes===undefined&&until===undefined)throw Error('on requires --minutes or --until');
 const state={enabled:action==='on',endsAt,messages:{}};
 let sql="SELECT key,value,updated_at FROM community_settings WHERE key='site_maintenance';";
 if(action!=='status') {
  const value=JSON.stringify(state);
  sql=`INSERT INTO community_settings(key,value,updated_by,updated_at) VALUES('site_maintenance',${quote(value)},'maintenance-operator',${now}) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;\n`+
   `INSERT INTO community_settings(key,value,updated_by,updated_at) VALUES(${quote('maintenance_event_'+operation)},${quote(JSON.stringify({action,state,at:now,operation}))},'maintenance-operator',${now});\n`+sql;
 }
 return {target,sql,state};
}
export function executeMaintenance(args,runner=spawnSync) {
 const command=maintenanceCommand(args);
 return runner(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','DB',command.target,'--command',command.sql,'--json'],{cwd:root,stdio:'inherit'});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try {
  const result=executeMaintenance(process.argv.slice(2));
  if(result.error)throw result.error;
  process.exitCode=result.status??1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
