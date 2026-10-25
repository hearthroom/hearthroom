import { MAINTENANCE_KEY, maintenanceOff, parseMaintenance, type MaintenanceState } from '../shared/maintenance';
import { allowedHarborProxyRequest } from './harbor-api-proxy';
import { isSandboxHost } from './sandbox';
import { bumpOp } from './ops-metrics';
import type { Env } from './types';
export { MAINTENANCE_KEY };

/** Read the primary before generic replica sessions; never cache this admission switch. */
export async function readMaintenance(db: D1Database): Promise<MaintenanceState> {
  const primary=typeof db.withSession==='function' ? db.withSession('first-primary') : db;
  const row=await primary.prepare('SELECT value FROM community_settings WHERE key=?').bind(MAINTENANCE_KEY).first<{value:string}>();
  return row ? parseMaintenance(JSON.parse(row.value)) : maintenanceOff();
}
const STATIC = /\.(?:js|mjs|css|png|webp|jpe?g|gif|svg|ico|woff2?|ttf|map|webmanifest|txt|xml|atom)$/i;
const noStore={'Cache-Control':'no-store','Retry-After':'15'};
/** Runs before sessions, identity reads, HTML metadata, proxy upgrades and Provider calls. */
export async function maintenanceResponse(request:Request,env:Env,ctx:ExecutionContext):Promise<Response|null> {
  const url=new URL(request.url),path=url.pathname;
  // Preserve local proxy refusals without a DB/Provider call.
  if ((path==='/hh-api'||path.startsWith('/hh-api/'))&&!allowedHarborProxyRequest(request))return null;
  const sandboxAsset=isSandboxHost(url.host)&&/^\/(?:assets|mascot)\//.test(path);
  const api=/^\/(?:v1|hh-api|auth)(?:\/|$)/.test(path);
  if(path==='/metrics'||path.startsWith('/internal/')||(!api&&!sandboxAsset&&STATIC.test(path)))return null;
  const status=path==='/v1/maintenance';
  const document=['GET','HEAD'].includes(request.method)&&(!path.split('/').pop()?.includes('.')||path.endsWith('.html')||request.headers.get('Accept')?.includes('text/html'));
  if(!status&&!api&&!document&&!sandboxAsset)return null;
  let state:MaintenanceState;
  try { state=await readMaintenance(env.DB); }
  catch {
    ctx.waitUntil(bumpOp(env.DB,'maintenance','status','error'));
    return Response.json({error:'maintenance_status_unavailable'}, {status:503,headers:noStore});
  }
  if(status)return Response.json(state,{headers:{'Cache-Control':'no-store'}});
  if(!state.enabled)return null;
  // Only while active: the isolated maintenance shell needs its public SPA assets.
  if(sandboxAsset)return env.ASSETS.fetch(request);
  ctx.waitUntil(bumpOp(env.DB,'maintenance',api?'api':'page','blocked'));
  if(api)return Response.json({error:'site_maintenance',maintenance:state},{status:503,headers:noStore});
  const shell=await env.ASSETS.fetch(new Request(new URL('/',url),{headers:{Accept:'text/html'}}));
  const headers=new Headers(shell.headers);
  for(const key of ['ETag','Last-Modified','Content-Length'])headers.delete(key);
  for(const [key,value] of Object.entries(noStore))headers.set(key,value);
  headers.set('X-Robots-Tag','noindex');
  // A direct sandbox shell resumes its original host document instead of a site route.
  const content=(await shell.text()).replace('<head>','<head><meta name="hearthroom-maintenance-shell" content="'+(isSandboxHost(url.host)?'sandbox':'site')+'">');
  return new Response(request.method==='HEAD'?null:content,{status:503,headers});
}
